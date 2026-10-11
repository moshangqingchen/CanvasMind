import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, upstream: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; }, jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()), providerFetch: mocks.upstream, fetchProviderJson: mocks.upstream,
  discoverSupplierCatalog: mocks.upstream, scanProviderModelCatalog: mocks.upstream }));
import { readProviderModelInventory } from "./provider-model-inventory";

const enabled = Boolean(process.env.B6_R6_POST_STARTUP_FIXTURE_PATH && process.env.B6_R6_POST_STARTUP_PROOF_PATH && process.env.B6_R6_POST_STARTUP_COMPAT_PATH);
const fixturePath = process.env.B6_R6_POST_STARTUP_FIXTURE_PATH ? resolve(process.env.B6_R6_POST_STARTUP_FIXTURE_PATH) : "";
const allowedFixture = resolve("../../../.codex-temp/supplier-full-document-recheck-20261010/audit-b/fixtures") + sep;
if (enabled && (!fixturePath.startsWith(allowedFixture) || !fixturePath.endsWith(".json.gz"))) throw new Error("Only independent post-startup safe fixture is allowed");
const rawBytes = enabled ? readFileSync(fixturePath) : Buffer.from([]);
const sourcePaths = ["apps/desktop/renderer/lib/provider-model-inventory.ts", "apps/desktop/renderer/lib/scanned-model-protocols.ts", "apps/desktop/renderer/lib/supplier-image-menu-contract.ts",
  "apps/desktop/renderer/lib/supplier-capabilities.ts", "apps/desktop/renderer/lib/frimodel-presets.ts", "apps/desktop/renderer/lib/verified-image25-capabilities.ts", "apps/desktop/renderer/lib/image25-request-samples.ts",
  "apps/desktop/renderer/lib/chentu-catalog.ts", "apps/desktop/renderer/lib/cyberafei-catalog.ts", "packages/providers/src/weai-models.ts", "packages/providers/src/openai.ts", "packages/providers/src/c-open-image-contract.ts",
  "packages/providers/src/monster-image-capabilities.ts", "apps/desktop/renderer/lib/supplier-model-pricing.ts"];
const sourceFiles = sourcePaths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(resolve("../../..", path))).digest("hex") }));
const fixture = (enabled ? JSON.parse(gunzipSync(rawBytes).toString("utf8")) : { suppliers: [], connections: [] }) as {
  sourceSha256: string; sourceDatabaseSha256: string; rawFixtureSource: string; sourceSnapshotTime: string; suppliers: SupplierRecord[]; connections: ProviderConnectionRecord[];
};
if (enabled && (fixture.suppliers.length !== 6 || fixture.connections.length !== 74 || fixture.sourceSha256 !== "cf69e4c23e7a9843e0309bb9620b20769312c80772b1eeff3c0384cacbfdb89e" || fixture.sourceDatabaseSha256 !== "a29acd047b98f8ae9aeed21291d4b5b7deb0778af6e0983766df3c01a0ba4cfe")) throw new Error("Root-provided post-startup identity must match");
const compatibilityPath = enabled ? resolve(process.env.B6_R6_POST_STARTUP_COMPAT_PATH!) : "";
const compatibilityBytes = enabled ? readFileSync(compatibilityPath) : Buffer.from([]);
const compatibility = (enabled ? JSON.parse(compatibilityBytes.toString("utf8")) : {}) as {
  passed: boolean; oldFixtureReusableUnderNewGlobalBaseline: boolean; beforeProfileSha256: string; afterProfileSha256: string;
  sources: { path: string; sha256: string }[]; suppliers: { literalByteEquivalent: boolean; safeContentEquivalent: boolean }[];
  connections: { literalByteEquivalent: boolean; safeContentEquivalent: boolean }[];
};
const liveRawSource = enabled ? compatibility.sources.find(source => source.sha256 === "336c1af827b62457ef4a1a5dded2431d52dc35fd374b817aee32851320fbce6d") : undefined;
const liveRawBytes = enabled && liveRawSource ? readFileSync(liveRawSource.path) : Buffer.from([]);
if (enabled && (!compatibilityPath.startsWith(resolve("../../../.codex-temp/supplier-full-document-recheck-20261010/audit-b") + sep) ||
  !compatibility.passed || !compatibility.oldFixtureReusableUnderNewGlobalBaseline ||
  compatibility.beforeProfileSha256 !== fixture.sourceDatabaseSha256 || compatibility.afterProfileSha256 !== "bb497d2d8bf847edd53337022f9404a994053cea2857bd77c2edc7a1e67b26e3" ||
  compatibility.suppliers.length !== 6 || compatibility.connections.length !== 74 ||
  [...compatibility.suppliers, ...compatibility.connections].some(row => !row.literalByteEquivalent || !row.safeContentEquivalent) ||
  !liveRawSource || createHash("sha256").update(liveRawBytes).digest("hex") !== liveRawSource.sha256)) throw new Error("Final live raw compatibility has not been independently proven");
const containers = ["modelCatalogModels", "connector", "modelProtocolTemplate"] as const;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const bytesSha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const modelRows = (c: ProviderConnectionRecord, key: typeof containers[number]): ModelDescriptor[] => key === "modelCatalogModels" ? (Array.isArray(c.config[key]) ? c.config[key] as unknown as ModelDescriptor[] : [])
  : ((c.config[key] as { models?: ModelDescriptor[] } | undefined)?.models ?? []);
const modelsNonPrice = (m: ModelDescriptor) => ({ ...m, pricing: undefined });
type FieldDelta = { path: (string | number)[]; beforePresent: boolean; afterPresent: boolean; before?: unknown; after?: unknown };
function exactDelta(a: unknown, b: unknown, path: (string | number)[] = []): FieldDelta[] {
  if (a === b || a !== undefined && b !== undefined && sha(a) === sha(b)) return [];
  if (path.at(-1) === "updatedAt") return [];
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    return Object.keys({ ...a, ...b }).flatMap(k => exactDelta((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], [...path, k]));
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x && b[i] && typeof x === "object" && x.id === b[i].id))
    return a.flatMap((x, i) => exactDelta(x, b[i], [...path, i]));
  return [{ path, beforePresent: a !== undefined, afterPresent: b !== undefined, ...(a !== undefined ? { before: a } : {}), ...(b !== undefined ? { after: b } : {}) }];
}
function stage(before: ProviderConnectionRecord, after: ProviderConnectionRecord) {
  const delta = exactDelta(before, after);
  return { beforeConfigSha256: sha(before.config), afterConfigSha256: sha(after.config), exactFields: delta,
    containers: Object.fromEntries(containers.map(key => [key, { beforePresent: before.config[key] !== undefined, afterPresent: after.config[key] !== undefined,
      beforeSha256: sha(before.config[key] ?? null), afterSha256: sha(after.config[key] ?? null),
      beforeFullModelIds: modelRows(before, key).map(m => m.id), afterFullModelIds: modelRows(after, key).map(m => m.id),
      changedModels: modelRows(before, key).flatMap(m => { const n = modelRows(after, key).find(n => n.id === m.id); return n && sha(m) !== sha(n) ? [{ fullModelId: m.id, beforeSha256: sha(m), afterSha256: sha(n), priceChanged: sha(m.pricing ?? null) !== sha(n.pricing ?? null), nonPriceChanged: sha(modelsNonPrice(m)) !== sha(modelsNonPrice(n)) }] : []; }) }])) };
}
beforeEach(() => { mocks.repository = new MemoryRepository(); mocks.upstream.mockReset().mockRejectedValue(new Error("B6 saved inventory may not call upstream")); vi.stubGlobal("fetch", mocks.upstream); });
afterEach(() => { expect(mocks.upstream).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

(enabled ? describe : describe.skip)("B6 independent actual post-startup saved full contracts", () => {
  it("projects new raw cached without writes and records exact normal three-stage deltas without upstream", async () => {
    for (const supplier of fixture.suppliers) await mocks.repository.saveSupplier(structuredClone(supplier));
    for (const c of fixture.connections) await mocks.repository.saveConnection(structuredClone(c));
    const originalSuppliers = await mocks.repository.listSuppliers();
    const results = [];
    for (const original of fixture.connections) {
      const supplier = fixture.suppliers.find(s => s.id === original.config.supplierId)!;
      const connection = (await mocks.repository.getConnection(original.id))!;
      const read = (query = "") => readProviderModelInventory(new Request(`http://localhost/api/providers/${connection.id}/models${query}`), { params: Promise.resolve({ id: connection.id }) });
      const save = vi.spyOn(mocks.repository, "saveConnection");
      const cached = await read("?cached=1");
      expect(save, `${supplier.name}/${connection.id} cached write`).not.toHaveBeenCalled();
      expect(await mocks.repository.getConnection(connection.id)).toEqual(connection);
      const cachedPayload = await cached.json();
      if (Array.isArray(cachedPayload) && connection.config.modelScanStatus !== "empty")
        expect(cachedPayload.map((model: ModelDescriptor) => model.id), `${supplier.name}/${connection.id} complete cached full IDs`).toEqual(modelRows(connection, "modelCatalogModels").map(model => model.id));
      const parameterChangedIds = Array.isArray(cachedPayload) ? cachedPayload.filter((m: ModelDescriptor) => {
        const prior = modelRows(connection, "modelCatalogModels").find(n => n.id === m.id);
        return prior && sha(prior.parameters ?? []) !== sha(m.parameters ?? []);
      }).map((m: ModelDescriptor) => m.id) : [];
      const needsMigration = parameterChangedIds.length > 0;
      const ordinarySkipped = supplier.id === "supplier-afb81cb25dc70dfd4a77617d" && !needsMigration;
      const ordinarySkipReason = ordinarySkipped
        ? "All current exact Cangyuan parameters already match. A normal GET can intentionally request legacy Cangyuan catalog prices; that unnecessary free price refresh is outside this bounded parameter migration. Only all cached projections were tested for this connection, not ordinary GET."
        : undefined;
      const states = [connection]; const counts: number[] = [], http: number[] = [];
      for (let i = 0; i < 3; i++) {
        save.mockClear();
        if (!ordinarySkipped) { const response = await read(); http.push(response.status); await response.json(); }
        else http.push(cached.status);
        counts.push(save.mock.calls.length); states.push((await mocks.repository.getConnection(connection.id))!);
      }
      const deltas = [stage(states[0]!, states[1]!), stage(states[1]!, states[2]!), stage(states[2]!, states[3]!)];
      expect(counts[2], `${supplier.name}/${connection.id} third GET save`).toBe(0);
      expect(states[3], `${supplier.name}/${connection.id} third GET idempotence`).toEqual(states[2]);
      for (const d of deltas) {
        expect(d.exactFields.every(field => field.path[0] === "config" && containers.includes(String(field.path[1]) as typeof containers[number])), `${supplier.name}/${connection.id} protected config`).toBe(true);
        for (const [key, container] of Object.entries(d.containers)) expect(container.afterFullModelIds, `${connection.id}/${key} full IDs`).toEqual(container.beforeFullModelIds);
      }
      results.push({ supplierId: supplier.id, supplierName: supplier.name, connectionId: connection.id,
        sourceId: connection.config.supplierSourceId, officialGroupId: connection.config.accountKeyGroupId,
        group: connection.config.accountKeyGroup ?? connection.config.modelGroup, provider: connection.provider, origin: connection.config.baseUrl,
        modelCount: modelRows(connection, "modelCatalogModels").length, fullModelIds: modelRows(connection, "modelCatalogModels").map(m => m.id),
        cachedHttp: cached.status, cachedModelCount: Array.isArray(cachedPayload) ? cachedPayload.length : 0, cachedConfigSha256: sha(connection.config),
        cachedModelSha256: sha(cachedPayload), parameterChangedIds, ordinaryRequested: !ordinarySkipped, ordinarySkipped, ordinarySkipReason,
        parameterProjectionChanged: needsMigration, ordinaryHttp: http, ordinaryGetSaveCounts: counts, changed: counts.some(Boolean),
        cachedImageModels: Array.isArray(cachedPayload) ? cachedPayload.filter((m: ModelDescriptor) => m.operations.some(operation => operation.startsWith("image."))).map((m: ModelDescriptor) => ({ fullModelId: m.id,
          operations: m.operations, inputKinds: m.inputKinds, outputKinds: m.outputKinds, limits: m.limits,
          parameters: m.parameters?.filter(parameter => !/^(?:prompt|password|api_key|authorization|cookie|secret)$/iu.test(parameter.key)), metadata: m.metadata, pricing: m.pricing })) : [],
        sourceDelta: { firstGet: deltas[0], secondGet: deltas[1], thirdGet: deltas[2] }, protectedEncryptedSecretSha256: sha(connection.encryptedSecret),
        finalConfigSha256: sha(states[3]!.config) });
      save.mockRestore();
    }
    expect(await mocks.repository.listSuppliers()).toEqual(originalSuppliers);
    expect(mocks.upstream).not.toHaveBeenCalled();
    expect(sourcePaths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(resolve("../../..", path))).digest("hex") }))).toEqual(sourceFiles);
    if (process.env.B6_R6_POST_STARTUP_PROOF_PATH) {
      const out = resolve(process.env.B6_R6_POST_STARTUP_PROOF_PATH), allowed = resolve("../../../.codex-temp/supplier-full-document-recheck-20261010/audit-b") + sep;
      if (!out.startsWith(allowed) || !out.endsWith(".json")) throw new Error("Only audit-b safe proof output is permitted");
      writeFileSync(out, JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), evidenceLayer: "Independent new frozen post-startup raw source mock; original v6 proof is retained. Actual startup scan and later installed API/UI remain separate.", fixtureSource: fixturePath, fixtureSha256: bytesSha(rawBytes),
        rawFixtureSource: liveRawSource!.path, rawSnapshotTime: JSON.parse(liveRawBytes.toString("utf8")).checkedAt, rawFixtureSha256: liveRawSource!.sha256,
        rawProfileSha256: compatibility.afterProfileSha256,
        fixtureDerivedFrom: { rawFixtureSource: fixture.rawFixtureSource, rawFixtureSha256: fixture.sourceSha256, rawProfileSha256: fixture.sourceDatabaseSha256 },
        rawCompatibilityReceipt: { path: compatibilityPath, sha256: bytesSha(compatibilityBytes), supplierCount: 6, connectionCount: 74, wholeSafeContentAndLiteralBytesEquivalent: true },
        sourceFiles, ordinarySavedBranchNetworkRequests: mocks.upstream.mock.calls.length, profileWrites: 0,
        supplierCount: fixture.suppliers.length, connectionCount: fixture.connections.length, modelCount: results.reduce((a, r) => a + r.modelCount, 0),
        changedConnectionIds: results.filter(r => r.changed).map(r => r.connectionId), results }, null, 2) + "\n", { flag: "wx" });
    }
  }, 90000);
});

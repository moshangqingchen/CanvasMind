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

const rawBytes = readFileSync(new URL("./fixtures/b6-r6-whole-connections.json.gz", import.meta.url));
const sourcePaths = ["apps/desktop/renderer/lib/provider-model-inventory.ts", "apps/desktop/renderer/lib/scanned-model-protocols.ts", "apps/desktop/renderer/lib/supplier-image-menu-contract.ts",
  "apps/desktop/renderer/lib/supplier-capabilities.ts", "apps/desktop/renderer/lib/frimodel-presets.ts", "apps/desktop/renderer/lib/verified-image25-capabilities.ts", "apps/desktop/renderer/lib/image25-request-samples.ts",
  "apps/desktop/renderer/lib/chentu-catalog.ts", "apps/desktop/renderer/lib/cyberafei-catalog.ts", "packages/providers/src/weai-models.ts", "packages/providers/src/openai.ts", "packages/providers/src/c-open-image-contract.ts",
  "packages/providers/src/monster-image-capabilities.ts", "apps/desktop/renderer/lib/supplier-model-pricing.ts"];
const sourceFiles = sourcePaths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(resolve("../../..", path))).digest("hex") }));
const fixture = JSON.parse(gunzipSync(rawBytes).toString("utf8")) as { sourceSha256: string; sourceDatabaseSha256: string; suppliers: SupplierRecord[]; connections: ProviderConnectionRecord[] };
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

describe("B6 actual R6 saved full contracts", () => {
  it("projects cached without writes and records only finite ordinary parameter migrations", async () => {
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
      const parameterChangedIds = Array.isArray(cachedPayload) ? cachedPayload.filter((m: ModelDescriptor) => {
        const prior = modelRows(connection, "modelCatalogModels").find(n => n.id === m.id);
        return prior && sha(prior.parameters ?? []) !== sha(m.parameters ?? []);
      }).map((m: ModelDescriptor) => m.id) : [];
      const needsMigration = parameterChangedIds.length > 0;
      if (supplier.name === "沧元算力") for (const id of parameterChangedIds) {
        const row = (cachedPayload as ModelDescriptor[]).find(model => model.id === id)!;
        const prior = modelRows(connection, "modelCatalogModels").find(model => model.id === id)!;
        expect(row.metadata?.imageUserSizePresetSource, `${connection.id}/${id} Cangyuan user presets`).toBe("user-request");
        expect(row.pricing, `${connection.id}/${id} Cangyuan price identity`).toEqual(prior.pricing);
        expect(row.parameters?.find(parameter => parameter.key === "size")?.options?.some(option => /^\d+x\d+$/u.test(String(option.value)))).toBe(true);
      }
      const states = [connection]; const counts: number[] = [], http: number[] = [];
      for (let i = 0; i < 3; i++) {
        save.mockClear();
        if (needsMigration) { const response = await read(); http.push(response.status); await response.json(); }
        else http.push(cached.status);
        counts.push(save.mock.calls.length); states.push((await mocks.repository.getConnection(connection.id))!);
      }
      const deltas = [stage(states[0]!, states[1]!), stage(states[1]!, states[2]!), stage(states[2]!, states[3]!)];
      expect(counts[2], `${supplier.name}/${connection.id} third GET save: ${JSON.stringify(deltas[2]?.exactFields.map(field => ({ path: field.path,
        ...(field.path.includes("metadata") ? { before: field.before, after: field.after } : {}) })))}`).toBe(0);
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
        cachedModelSha256: sha(cachedPayload), parameterChangedIds, ordinaryRequested: needsMigration, ordinaryHttp: http, ordinaryGetSaveCounts: counts, changed: counts.some(Boolean),
        cachedImageModels: Array.isArray(cachedPayload) ? cachedPayload.filter((m: ModelDescriptor) => m.operations.some(operation => operation.startsWith("image."))).map((m: ModelDescriptor) => ({ fullModelId: m.id,
          parameters: m.parameters?.filter(parameter => !/^(?:prompt|password|api_key|authorization|cookie|secret)$/iu.test(parameter.key)), metadata: m.metadata, pricing: m.pricing })) : [],
        sourceDelta: { firstGet: deltas[0], secondGet: deltas[1], thirdGet: deltas[2] }, protectedEncryptedSecretSha256: sha(connection.encryptedSecret),
        finalConfigSha256: sha(states[3]!.config) });
      save.mockRestore();
    }
    expect(await mocks.repository.listSuppliers()).toEqual(originalSuppliers);
    expect(mocks.upstream).not.toHaveBeenCalled();
    expect(sourcePaths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(resolve("../../..", path))).digest("hex") }))).toEqual(sourceFiles);
    if (process.env.B6_R6_WHOLE_PROOF_PATH) {
      const out = resolve(process.env.B6_R6_WHOLE_PROOF_PATH), allowed = resolve("../../../.codex-temp/supplier-full-document-recheck-20261010/audit-b") + sep;
      if (!out.startsWith(allowed) || !out.endsWith(".json")) throw new Error("Only audit-b safe proof output is permitted");
      writeFileSync(out, JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), fixtureSource: "lib/fixtures/b6-r6-whole-connections.json.gz", fixtureSha256: bytesSha(rawBytes),
        rawFixtureSource: ".codex-temp/supplier-full-document-recheck-r6-20261010/all-161-raw-contracts-safe.json", rawFixtureSha256: fixture.sourceSha256,
        rawProfileSha256: fixture.sourceDatabaseSha256, sourceFiles, ordinarySavedBranchNetworkRequests: mocks.upstream.mock.calls.length, profileWrites: 0,
        supplierCount: fixture.suppliers.length, connectionCount: fixture.connections.length, modelCount: results.reduce((a, r) => a + r.modelCount, 0),
        changedConnectionIds: results.filter(r => r.changed).map(r => r.connectionId), results }, null, 2) + "\n", { flag: "wx" });
    }
  }, 60000);
});

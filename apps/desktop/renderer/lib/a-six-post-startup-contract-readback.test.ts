import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { pdogImageQualityOptions } from "@super-canvas/providers/pdog-image-contract";
const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, upstream: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; }, jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: mocks.upstream, discoverSupplierCatalog: mocks.upstream, scanProviderModelCatalog: mocks.upstream }));
import { readProviderModelInventory } from "./provider-model-inventory";
const oldFixture = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/a-six-r6-actual-connections.json.gz", import.meta.url))).toString("utf8")) as {
  source: Record<string, string>; connections: ProviderConnectionRecord[]; suppliers: SupplierRecord[];
};
const sourcePath = process.env.A_SIX_R6_POST_STARTUP_RAW_PATH;
const currentSource = sourcePath ? JSON.parse(readFileSync(sourcePath, "utf8")) as { sourceDatabaseSha256: string; connections: ProviderConnectionRecord[]; suppliers: SupplierRecord[] } : undefined;
const expectedIds = new Set(oldFixture.connections.map(connection => connection.id));
const fixture = currentSource ? { source: { path: sourcePath!, sha256: createHash("sha256").update(readFileSync(sourcePath!)).digest("hex"), databaseSha256: currentSource.sourceDatabaseSha256 },
  connections: currentSource.connections.filter(connection => expectedIds.has(connection.id)), suppliers: currentSource.suppliers } : oldFixture;
const sourceFiles = ["packages/providers/src/pdog-image-contract.ts", "packages/providers/src/pdog-image.ts", "packages/providers/src/transparent-image-evidence.ts",
  "packages/providers/src/tk1688-model-policy.ts", "packages/providers/src/tk1688-catalog.ts", "packages/providers/src/secure-skill-image-contract.ts", "packages/providers/src/secure-skill-image.ts",
  "packages/providers/src/jijiu-image-contract.ts", "packages/providers/src/jiasu-image-contract.ts", "packages/providers/src/jiasu-video-contract.ts",
  "packages/providers/src/miaowu-video-contract-pending.ts", "packages/providers/src/openai.ts", "packages/providers/src/rest.ts", "packages/runtime/src/service.ts",
  "apps/desktop/renderer/lib/provider-model-inventory.ts", "apps/desktop/renderer/lib/scanned-model-protocols.ts", "apps/desktop/renderer/lib/supplier-capabilities.ts",
  "apps/desktop/renderer/lib/supplier-image-menu-contract.ts", "apps/desktop/renderer/lib/supplier-model-pricing.ts", "apps/desktop/renderer/lib/model-parameters.ts",
  "apps/desktop/renderer/lib/miaowu-image-schema.ts", "apps/desktop/renderer/lib/miaowu-video-schema.ts", "apps/desktop/renderer/lib/tk1688-resolution-control.ts"]
  .map(path => ({ path, sha256: createHash("sha256").update(readFileSync(resolve("../../..", path))).digest("hex") }));
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value)) ?? "undefined").digest("hex");
const changed = (before: Record<string, unknown>, after: Record<string, unknown>) => Object.keys({ ...before, ...after }).filter(key => sha(before[key]) !== sha(after[key]));
let completedProof: Record<string, unknown> | undefined;
function contractDelta(before: ProviderConnectionRecord, after: ProviderConnectionRecord) {
  const keys = ["modelCatalogModels", "connector", "modelProtocolTemplate"];
  return { configFields: changed(before.config, after.config), configBeforeCanonicalSha256: sha(before.config), configAfterCanonicalSha256: sha(after.config),
    containers: Object.fromEntries(keys.map(key => {
      const leftValue = before.config[key], rightValue = after.config[key];
      const left = (key === "modelCatalogModels" ? leftValue : (leftValue as { models?: ModelDescriptor[] } | undefined)?.models) as ModelDescriptor[] | undefined;
      const right = (key === "modelCatalogModels" ? rightValue : (rightValue as { models?: ModelDescriptor[] } | undefined)?.models) as ModelDescriptor[] | undefined;
      return [key, { beforeIds: left?.map(row => row.id) ?? [], afterIds: right?.map(row => row.id) ?? [], beforeSha256: sha(leftValue), afterSha256: sha(rightValue),
        modelChanges: (left ?? []).flatMap<Record<string, unknown>>(row => {
          const next = right?.find(item => item.id === row.id); if (!next) return [{ id: row.id, removed: true }];
          const fields = changed(row as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
          return fields.length ? [{ id: row.id, fields, topLevel: Object.fromEntries(fields.filter(field => field !== "metadata").map(field => [field,
            { before: row[field as keyof ModelDescriptor], after: next[field as keyof ModelDescriptor] }])),
            metadata: Object.fromEntries(changed(row.metadata ?? {}, next.metadata ?? {}).map(field => [field, { before: row.metadata?.[field], after: next.metadata?.[field] }])) }] : [];
        }), nonModelContractChanged: key === "modelCatalogModels" ? false : sha({ ...(leftValue as object), models: undefined }) !== sha({ ...(rightValue as object), models: undefined }) }];
    })) };
}
afterEach(() => {
  expect(mocks.upstream).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (completedProof && process.env.A_SIX_R6_POST_STARTUP_WHOLE_PROOF_PATH) {
    const target = resolve(process.env.A_SIX_R6_POST_STARTUP_WHOLE_PROOF_PATH), allowed = resolve("../../../.codex-temp/supplier-full-document-recheck-20261010/audit-a") + sep;
    if (!target.startsWith(allowed) || !target.endsWith(".json")) throw new Error("Evidence path must stay in audit-a");
    writeFileSync(target, JSON.stringify({ ...completedProof, passed: true, finalGuardCompleted: true }, null, 2) + "\n", { flag: "wx" });
  }
});
describe.skipIf(!sourcePath)("six suppliers post-startup current immutable complete saved contracts", () => {
  it("clears old invented image matrices through the entire source route without losing IDs, source identity or supplier data", async () => {
    expect(process.env.A_SIX_R6_POST_STARTUP_RAW_SHA256).toMatch(/^[a-f\d]{64}$/u);
    expect(process.env.A_SIX_R6_POST_STARTUP_DATABASE_SHA256).toMatch(/^[a-f\d]{64}$/u);
    expect(fixture.source.sha256).toBe(process.env.A_SIX_R6_POST_STARTUP_RAW_SHA256);
    expect(fixture.source.databaseSha256).toBe(process.env.A_SIX_R6_POST_STARTUP_DATABASE_SHA256);
    expect(currentSource?.connections.length).toBe(161); expect(fixture.connections.length).toBe(49);
    expect(new Set(fixture.connections.map(connection => connection.id))).toEqual(expectedIds);
    mocks.repository = new MemoryRepository(); mocks.upstream.mockReset().mockRejectedValue(new Error("No upstream requests in actual saved contracts")); vi.stubGlobal("fetch", mocks.upstream);
    for (const supplier of fixture.suppliers) await mocks.repository.saveSupplier(structuredClone(supplier));
    for (const connection of fixture.connections) await mocks.repository.saveConnection(structuredClone(connection));
    const supplierBefore = await mocks.repository.listSuppliers();
    const proof: unknown[] = [];
    for (const original of fixture.connections) {
      const connection = (await mocks.repository.getConnection(original.id))!;
      const read = (query = "") => readProviderModelInventory(new Request(`http://localhost/api/providers/${connection.id}/models${query}`), { params: Promise.resolve({ id: connection.id }) });
      const save = vi.spyOn(mocks.repository, "saveConnection");
      const cached = await read("?cached=1"), cachedPayload: unknown = await cached.json();
      expect(save).not.toHaveBeenCalled(); expect(await mocks.repository.getConnection(connection.id)).toEqual(connection);
      if (!Array.isArray(cachedPayload) || !["live", "failed"].includes(String(connection.config.modelScanStatus))) {
        proof.push({ connectionId: connection.id, supplierId: connection.config.supplierId, group: connection.config.modelGroup, cachedStatus: cached.status, ordinarySkipped: true, scanStatus: connection.config.modelScanStatus }); save.mockRestore(); continue;
      }
      const rows = connection.config.modelCatalogModels as unknown as ModelDescriptor[];
      expect(cachedPayload.map((row: ModelDescriptor) => row.id)).toEqual(rows.map(row => row.id));
      const checks = (models: ModelDescriptor[]) => {
        for (const row of models) {
          if (row.metadata?.pdogImageProtocol === 1) {
            expect(row.parameters?.find(parameter => parameter.key === "size")?.options?.length).toBeLessThanOrEqual(20);
            expect(row.parameters?.find(parameter => parameter.key === "size")?.max).toBeUndefined();
            expect(row.parameters?.find(parameter => parameter.key === "quality")?.default,
              JSON.stringify({ connectionId: connection.id, group: connection.config.modelGroup, fullId: row.id, metadata: row.metadata, quality: row.parameters?.find(parameter => parameter.key === "quality") }))
              .toBe(pdogImageQualityOptions(row.id, connection.config).at(-1));
            expect(row.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value))
              .toEqual(pdogImageQualityOptions(row.id, connection.config));
          }
          if (row.metadata?.tk1688ImageSizeContract === 2 && !row.metadata.tk1688FixedSize) {
            expect(row.parameters?.find(parameter => parameter.key === "size")?.options?.map(option => option.value)).toEqual(["auto", "1024x1024", "1536x1024", "1024x1536"]);
            expect(row.parameters?.find(parameter => parameter.key === "size")?.max).toBeUndefined();
          }
        }
      };
      checks(cachedPayload);
      const stages: ReturnType<typeof contractDelta>[] = [], counts: number[] = [];
      let finalApiMediaModels: ModelDescriptor[] = [];
      let before = connection;
      for (let stage = 1; stage <= 3; stage++) {
        save.mockClear(); const response = await read(); expect(response.status).toBe(200); const api = await response.json() as ModelDescriptor[];
        expect(api.map(row => row.id)).toEqual(rows.map(row => row.id)); checks(api);
        finalApiMediaModels = api.filter(row => row.operations?.some(operation => operation.startsWith("image.") || operation.startsWith("video.")));
        const after = (await mocks.repository.getConnection(connection.id))!; stages.push(contractDelta(before, after)); counts.push(save.mock.calls.length);
        expect(json({ ...before, config: undefined, updatedAt: undefined })).toEqual(json({ ...after, config: undefined, updatedAt: undefined }));
        expect(Object.keys(after.config).filter(key => !["modelCatalogModels", "connector", "modelProtocolTemplate"].includes(key)).map(key => [key, after.config[key]]))
          .toEqual(Object.keys(before.config).filter(key => !["modelCatalogModels", "connector", "modelProtocolTemplate"].includes(key)).map(key => [key, before.config[key]]));
        before = after;
      }
      expect(counts[2]).toBe(0);
      expect(await mocks.repository.listSuppliers()).toEqual(supplierBefore);
      proof.push({ connectionId: connection.id, supplierId: connection.config.supplierId, sourceId: connection.config.supplierSourceId, group: connection.config.modelGroup,
        modelCount: rows.length, cachedStatus: cached.status, cachedApiMediaModels: cachedPayload.filter((row: ModelDescriptor) => row.operations?.some(operation => operation.startsWith("image.") || operation.startsWith("video."))),
        finalApiMediaModels, ordinaryGetSaveCounts: counts, sourceDelta: { firstGet: stages[0], secondGet: stages[1], thirdGet: stages[2] } }); save.mockRestore();
    }
    completedProof = { currentImmutableRawSource: fixture.source, source: fixture.source, sourceFiles, testSourceSha256: createHash("sha256").update(readFileSync(new URL("./a-six-post-startup-contract-readback.test.ts", import.meta.url))).digest("hex"), priorContractProof: "audit-a/a-six-r6-root-final-source-proof-v6-safe.json", connectionCount: fixture.connections.length,
      connections: proof, networkRequests: mocks.upstream.mock.calls.length, actualProfileWrites: 0 };
  }, 120000);
});

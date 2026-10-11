import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { pdogImageQualityOptions } from "@super-canvas/providers/pdog-image-contract";
const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, upstream: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; }, jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: mocks.upstream, discoverSupplierCatalog: mocks.upstream, scanProviderModelCatalog: mocks.upstream }));
import { readProviderModelInventory } from "./provider-model-inventory";
const fixture = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/a-six-r6-actual-connections.json.gz", import.meta.url))).toString("utf8")) as {
  source: Record<string, string>; connections: ProviderConnectionRecord[]; suppliers: SupplierRecord[];
};
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value)) ?? "undefined").digest("hex");
const changed = (before: Record<string, unknown>, after: Record<string, unknown>) => Object.keys({ ...before, ...after }).filter(key => sha(before[key]) !== sha(after[key]));
const proof: unknown[] = [];
let supplierBefore: SupplierRecord[];
let networkRequests = 0;
let connectionGuardsPassed = true;
let assertNoSupplierWrites = () => {};
function expectUnchanged(actual: unknown, expected: unknown, message: string) {
  // Keep the full comparison, but build Vitest's large diff only on failure.
  const equal = isDeepStrictEqual(actual, expected);
  if (!equal) expect(actual, message).toEqual(expected);
  expect(equal, message).toBe(true);
}
function contractDelta(before: ProviderConnectionRecord, after: ProviderConnectionRecord) {
  const keys = ["modelCatalogModels", "connector", "modelProtocolTemplate"];
  return { configFields: changed(before.config, after.config), configBeforeCanonicalSha256: sha(before.config), configAfterCanonicalSha256: sha(after.config),
    containers: Object.fromEntries(keys.map(key => {
      const leftValue = before.config[key], rightValue = after.config[key];
      const left = (key === "modelCatalogModels" ? leftValue : (leftValue as { models?: ModelDescriptor[] } | undefined)?.models) as ModelDescriptor[] | undefined;
      const right = (key === "modelCatalogModels" ? rightValue : (rightValue as { models?: ModelDescriptor[] } | undefined)?.models) as ModelDescriptor[] | undefined;
      const rightById = new Map(right?.map(row => [row.id, row]));
      return [key, { beforeIds: left?.map(row => row.id) ?? [], afterIds: right?.map(row => row.id) ?? [], beforeSha256: sha(leftValue), afterSha256: sha(rightValue),
        modelChanges: (left ?? []).flatMap<Record<string, unknown>>(row => {
          const next = rightById.get(row.id); if (!next) return [{ id: row.id, removed: true }];
          const fields = changed(row as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
          return fields.length ? [{ id: row.id, fields, topLevel: Object.fromEntries(fields.filter(field => field !== "metadata").map(field => [field,
            { before: row[field as keyof ModelDescriptor], after: next[field as keyof ModelDescriptor] }])),
            metadata: Object.fromEntries(changed(row.metadata ?? {}, next.metadata ?? {}).map(field => [field, { before: row.metadata?.[field], after: next.metadata?.[field] }])) }] : [];
        }), nonModelContractChanged: key === "modelCatalogModels" ? false : sha({ ...(leftValue as object), models: undefined }) !== sha({ ...(rightValue as object), models: undefined }) }];
    })) };
}
afterEach(() => {
  networkRequests += mocks.upstream.mock.calls.length;
  try { expect(mocks.upstream).not.toHaveBeenCalled(); assertNoSupplierWrites(); }
  catch (error) { connectionGuardsPassed = false; throw error; }
  finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
afterAll(async () => {
  expectUnchanged(await mocks.repository.listSuppliers(), supplierBefore, "Every original supplier catalog remains unchanged");
  if (process.env.A_SIX_R6_WHOLE_PROOF_PATH) {
    expect(connectionGuardsPassed).toBe(true);
    expect(proof).toHaveLength(fixture.connections.length); expect(networkRequests).toBe(0);
    const completedProof = { fixture: "lib/fixtures/a-six-r6-actual-connections.json.gz", source: fixture.source,
      connectionCount: fixture.connections.length, connections: proof, networkRequests, actualProfileWrites: 0 };
    const target = resolve(process.env.A_SIX_R6_WHOLE_PROOF_PATH), allowed = resolve("../../../.codex-temp/supplier-full-document-recheck-20261010/audit-a") + sep;
    if (!target.startsWith(allowed) || !target.endsWith(".json")) throw new Error("Evidence path must stay in audit-a");
    writeFileSync(target, JSON.stringify({ ...completedProof, passed: true, finalGuardCompleted: true }, null, 2) + "\n");
  }
});
describe.sequential("six suppliers actual complete saved connections to cached API and local persistence", () => {
  beforeAll(async () => {
    mocks.repository = new MemoryRepository();
    for (const supplier of fixture.suppliers) await mocks.repository.saveSupplier(structuredClone(supplier));
    for (const connection of fixture.connections) await mocks.repository.saveConnection(structuredClone(connection));
    supplierBefore = await mocks.repository.listSuppliers();
  });
  beforeEach(() => {
    mocks.upstream.mockReset().mockRejectedValue(new Error("No upstream requests in actual saved contracts")); vi.stubGlobal("fetch", mocks.upstream);
    const saveSupplier = vi.spyOn(mocks.repository, "saveSupplier"), commitSupplier = vi.spyOn(mocks.repository, "commitSupplier");
    // Reads return clones. Check both supplier write paths per connection,
    // including denied ones, then compare every full catalog in afterAll.
    assertNoSupplierWrites = () => { expect(saveSupplier).not.toHaveBeenCalled(); expect(commitSupplier).not.toHaveBeenCalled(); };
  });
  // Preserve the complete shared repository and original connection order.
  // Each connection gets a deadline instead of timing all 172 reads together.
  it.each(fixture.connections)("$name retains identity, presets, pricing and idempotence", async original => {
      const connection = (await mocks.repository.getConnection(original.id))!;
      const read = (query = "") => readProviderModelInventory(new Request(`http://localhost/api/providers/${connection.id}/models${query}`), { params: Promise.resolve({ id: connection.id }) });
      const save = vi.spyOn(mocks.repository, "saveConnection");
      const cached = await read("?cached=1"), cachedPayload: unknown = await cached.json();
      expect(save).not.toHaveBeenCalled(); expectUnchanged(await mocks.repository.getConnection(connection.id), connection, "Cached read must not alter the saved connection");
      if (!Array.isArray(cachedPayload) || !["live", "failed"].includes(String(connection.config.modelScanStatus))) {
        proof.push({ connectionId: connection.id, supplierId: connection.config.supplierId, group: connection.config.modelGroup, cachedStatus: cached.status, ordinarySkipped: true, scanStatus: connection.config.modelScanStatus }); save.mockRestore(); return;
      }
      const rows = connection.config.modelCatalogModels as unknown as ModelDescriptor[];
      expect(cachedPayload.map((row: ModelDescriptor) => row.id)).toEqual(rows.map(row => row.id));
      const checks = (models: ModelDescriptor[]) => {
        for (const row of models) {
          if (row.metadata?.pdogImageProtocol === 1) {
            const sourceSizes = row.metadata?.imageUserSizePresets ? row.metadata.imageUserSizeSourceOptions as unknown[]
              : row.parameters?.find(parameter => parameter.key === "size")?.options;
            expect(sourceSizes?.length).toBeLessThanOrEqual(20);
            expect(row.parameters?.find(parameter => parameter.key === "size")?.max).toBeUndefined();
            expect(row.parameters?.find(parameter => parameter.key === "quality")?.default,
              JSON.stringify({ connectionId: connection.id, group: connection.config.modelGroup, fullId: row.id, metadata: row.metadata, quality: row.parameters?.find(parameter => parameter.key === "quality") }))
              .toBe(row.id === "gpt-image-2" ? "high" : "max");
            expect(row.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value))
              .toEqual(row.id === "gpt-image-2" ? ["auto", "low", "medium", "high"] : ["auto", "low", "medium", "high", "xhigh", "max"]);
            expect((row.metadata?.imageUserQualitySourceParameter as { options?: { value: unknown }[] } | undefined)?.options?.map(option => option.value))
              .toEqual(pdogImageQualityOptions(row.id, connection.config));
          }
          if (row.metadata?.tk1688ImageSizeContract === 2 && !row.metadata.tk1688FixedSize) {
            expect(row.metadata?.imageUserSizePresetSource).toBe("user-request");
            const sizeOptions = row.parameters?.find(parameter => parameter.key === "size")?.options ?? [];
            // These three exact marketplace listings say “限4K”. Their old
            // generic examples remain reference metadata, not selectable sizes.
            const fixedFourK = ["gpt-image-2@s46c265", "gpt-image-2.5-flare@s46c265", "gpt-image-2.5-sunburst@s46c265"].includes(row.id);
            expect((row.metadata?.imageUserSizeSourceOptions as Array<{ value: unknown }>).map(option => option.value))
              .toEqual(fixedFourK ? ["auto"] : ["auto", "1024x1024", "1536x1024", "1024x1536"]);
            expect(sizeOptions.map(option => option.value)).toEqual(expect.arrayContaining(
              fixedFourK ? ["auto", "2880x2880", "3520x2336"] : ["auto", "1024x1024", "2048x2048", "2880x2880", "3520x2336"],
            ));
            if (fixedFourK) expect([...new Set(sizeOptions.flatMap(option => /^(1K|2K|4K) ·/u.exec(option.label)?.[1] ?? []))]).toEqual(["4K"]);
            expect(row.parameters?.find(parameter => parameter.key === "size")?.max).toBeUndefined();
          }
        }
      };
      checks(cachedPayload);
      const stages: ReturnType<typeof contractDelta>[] = [], counts: number[] = [];
      let before = connection;
      for (let stage = 1; stage <= 3; stage++) {
        save.mockClear(); const response = await read(); expect(response.status).toBe(200); const api = await response.json() as ModelDescriptor[];
        expect(api.map(row => row.id)).toEqual(rows.map(row => row.id)); checks(api);
        const after = (await mocks.repository.getConnection(connection.id))!;
        // This report was never an assertion. Build detailed hashes/diffs only
        // when an evidence export is requested; all CI assertions still run.
        if (process.env.A_SIX_R6_WHOLE_PROOF_PATH) stages.push(contractDelta(before, after));
        counts.push(save.mock.calls.length);
        expect(json({ ...before, config: undefined, updatedAt: undefined })).toEqual(json({ ...after, config: undefined, updatedAt: undefined }));
        expectUnchanged(Object.keys(after.config).filter(key => !["modelCatalogModels", "connector", "modelProtocolTemplate"].includes(key)).map(key => [key, after.config[key]]),
          Object.keys(before.config).filter(key => !["modelCatalogModels", "connector", "modelProtocolTemplate"].includes(key)).map(key => [key, before.config[key]]),
          "Non-contract configuration, including price and source identity, remains unchanged");
        if (stage === 3) expectUnchanged(after, before, "Third read must leave all descriptors, prices and timestamps unchanged");
        before = after;
      }
      expect(counts[2]).toBe(0);
      proof.push({ connectionId: connection.id, supplierId: connection.config.supplierId, sourceId: connection.config.supplierSourceId, group: connection.config.modelGroup,
        modelCount: rows.length, cachedStatus: cached.status, ordinaryGetSaveCounts: counts, sourceDelta: { firstGet: stages[0], secondGet: stages[1], thirdGet: stages[2] } }); save.mockRestore();
  }, 30000);
});

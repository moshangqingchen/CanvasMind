import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, upstream: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; }, jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: mocks.upstream, discoverSupplierCatalog: mocks.upstream, scanProviderModelCatalog: mocks.upstream }));
import { readProviderModelInventory } from "./provider-model-inventory";
const fixture = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/c-six-r6-actual-connections.json.gz", import.meta.url))).toString("utf8")) as {
  source: Record<string, string>; connections: ProviderConnectionRecord[]; suppliers: SupplierRecord[];
};
const retainedQuotes = JSON.parse(readFileSync(new URL("./fixtures/c-six-r6-quote-identities.json", import.meta.url), "utf8")) as {
  source: string; sourceSha256: string; rows: Array<{ connectionId: string; fullModelId: string; originalQuote: unknown }>;
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
  if (completedProof && process.env.C_SIX_R6_WHOLE_PROOF_PATH) {
    const target = resolve(process.env.C_SIX_R6_WHOLE_PROOF_PATH), allowed = resolve("../../../.codex-temp/supplier-full-document-recheck-20261010/audit-c") + sep;
    if (!target.startsWith(allowed) || !target.endsWith(".json")) throw new Error("Evidence path must stay in audit-c");
    writeFileSync(target, JSON.stringify({ ...completedProof, passed: true, finalGuardCompleted: true }, null, 2) + "\n");
  }
});
describe("C six suppliers actual complete saved connections to cached API and local persistence", () => {
  it("restores user size presets separately from supplier evidence without losing IDs, source identity or supplier data", async () => {
    mocks.repository = new MemoryRepository(); mocks.upstream.mockReset().mockRejectedValue(new Error("No upstream requests in actual saved contracts")); vi.stubGlobal("fetch", mocks.upstream);
    for (const supplier of fixture.suppliers) await mocks.repository.saveSupplier(structuredClone(supplier));
    for (const connection of fixture.connections) await mocks.repository.saveConnection(structuredClone(connection));
    const supplierBefore = await mocks.repository.listSuppliers();
    const proof: unknown[] = [];
    const checkedImageIdentities = new Set<string>();
    expect(retainedQuotes.rows).toHaveLength(43);
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
        const base=String(connection.config.baseUrl), group=String(connection.config.modelGroup);
        for (const row of models.filter(row=>row.operations.includes('image.generate'))) {
          checkedImageIdentities.add(`${connection.id}:${row.id}`);
          expect(row.metadata?.imageNativeParameterContract, JSON.stringify({group,id:row.id})).toBe(true);
          const size=row.parameters?.find(p=>p.key==='size');
          if(size && !(base.includes('chuangxiang') && /^gpt-image-2\.5-(?:flare|sunburst)-[124]k$/.test(row.id))) {
            expect(size.max,JSON.stringify({group,id:row.id,size})).toBeUndefined();
            expect(size.min,JSON.stringify({group,id:row.id,size})).toBeUndefined();
          }
          const supplierSizes = row.metadata?.imageUserSizePresets ? row.metadata.imageUserSizeSourceOptions as Array<{ value: unknown }> : size?.options;
          expect((supplierSizes?.filter(o=>/^\d+x\d+$/.test(String(o.value))).length??0),JSON.stringify({group,id:row.id,size})).toBeLessThanOrEqual(8);
          if (row.metadata?.imageUserSizePresets) {
            expect(row.metadata.imageUserSizePresetSource).toBe("user-request");
            for (const tier of row.metadata.imageUserSizePresetTiers as string[])
              expect(size?.options?.some(option => option.label.startsWith(`${tier} · `)), `${group}/${row.id}/${tier}`).toBe(true);
          }
          expect(row.metadata?.imageResolutionProfiles,JSON.stringify({group,id:row.id})).toBeUndefined();
          if(base.includes('genimage') && row.id==='gemini-3.1-flash-image-preview') expect(row.parameters?.find(p=>p.key==='image_size')?.options?.map(o=>o.value)).toEqual(['auto','512','1K','2K','4K']);
          if(base.includes('genimage') && row.id==='gemini-2.5-flash-image') expect(row.parameters?.find(p=>p.key==='image_size')?.options?.map(o=>o.value)).toEqual(['auto']);
          if(base.includes('eaheng') && /^gpt-image-2\.5-(?:flare|sunburst)-(high|max)$/.test(row.id)) expect(row.parameters?.find(p=>p.key==='quality')?.options?.map(o=>o.value)).toEqual([row.id.endsWith('-max')?'max':'high']);
          if(base.includes('synora') && group==='adobe中质量生图') expect(row.parameters?.find(p=>p.key==='quality')?.default).toBe('medium');
        }
      };
      checks(cachedPayload);
      const stages: ReturnType<typeof contractDelta>[] = [], counts: number[] = [];
      let before = connection;
      for (let stage = 1; stage <= 3; stage++) {
        save.mockClear(); const response = await read(); expect(response.status).toBe(200); const api = await response.json() as ModelDescriptor[];
        expect(api.map(row => row.id)).toEqual(rows.map(row => row.id)); checks(api);
        const after = (await mocks.repository.getConnection(connection.id))!; stages.push(contractDelta(before, after)); counts.push(save.mock.calls.length);
        for (const quote of retainedQuotes.rows.filter(row => row.connectionId === connection.id)) {
          const oldRow = (before.config.modelCatalogModels as ModelDescriptor[]).find(row => row.id === quote.fullModelId)!;
          const newRow = (after.config.modelCatalogModels as ModelDescriptor[]).find(row => row.id === quote.fullModelId)!;
          expect(oldRow.pricing, `${connection.id}:${quote.fullModelId} original actual quote`).toEqual(quote.originalQuote);
          expect(newRow.pricing, `${connection.id}:${quote.fullModelId} new parameter migration preserves original quote`).toEqual(oldRow.pricing);
          for (const key of ["priceLabel", "priceStatus", "priceSource", "priceCheckedAt", "priceLastAttemptAt", "priceLastAttemptStatus", "priceSupplierGroup", "priceBillingSummary"])
            expect(newRow.metadata?.[key], `${connection.id}:${quote.fullModelId}:${key}`).toEqual(oldRow.metadata?.[key]);
        }
        expect(json({ ...before, config: undefined, updatedAt: undefined })).toEqual(json({ ...after, config: undefined, updatedAt: undefined }));
        expect(Object.keys(after.config).filter(key => !["modelCatalogModels", "connector", "modelProtocolTemplate"].includes(key)).map(key => [key, after.config[key]]))
          .toEqual(Object.keys(before.config).filter(key => !["modelCatalogModels", "connector", "modelProtocolTemplate"].includes(key)).map(key => [key, before.config[key]]));
        before = after;
      }
      expect(counts[2]).toBe(0);
      expect(await mocks.repository.listSuppliers()).toEqual(supplierBefore);
      proof.push({ connectionId: connection.id, supplierId: connection.config.supplierId, sourceId: connection.config.supplierSourceId, group: connection.config.modelGroup,
        modelCount: rows.length, cachedStatus: cached.status, ordinaryGetSaveCounts: counts, sourceDelta: { firstGet: stages[0], secondGet: stages[1], thirdGet: stages[2] } }); save.mockRestore();
    }
    expect(checkedImageIdentities.size).toBe(100);
    completedProof = { fixture: "lib/fixtures/c-six-r6-actual-connections.json.gz", source: fixture.source, connectionCount: fixture.connections.length, cachedImageRowCount: checkedImageIdentities.size,
      retainedActualQuoteCount: retainedQuotes.rows.length, quoteSourcesAndOriginalDatesPreserved: true,
      connections: proof, networkRequests: mocks.upstream.mock.calls.length, actualProfileWrites: 0 };
  }, 120000);
});

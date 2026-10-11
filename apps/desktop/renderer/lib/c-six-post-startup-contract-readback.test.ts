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
const oldFixture = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/c-six-r6-actual-connections.json.gz", import.meta.url))).toString("utf8")) as {
  source: Record<string, string>; connections: ProviderConnectionRecord[]; suppliers: SupplierRecord[];
};
const sourcePath = process.env.C_SIX_R6_POST_STARTUP_RAW_PATH;
const expectedSourceSha256 = process.env.C_SIX_R6_POST_STARTUP_RAW_SHA256;
const expectedDatabaseSha256 = process.env.C_SIX_R6_POST_STARTUP_DATABASE_SHA256;
const currentSourceBytes = sourcePath ? readFileSync(sourcePath) : undefined;
const currentSource = currentSourceBytes ? JSON.parse(currentSourceBytes.toString("utf8")) as { sourceDatabaseSha256: string; connections: ProviderConnectionRecord[]; suppliers: SupplierRecord[] } : undefined;
const expectedConnectionIds = new Set(oldFixture.connections.map(connection => connection.id));
const expectedSupplierIds = new Set(oldFixture.suppliers.map(supplier => supplier.id));
const fixture = currentSource ? { source: { path: sourcePath!, sha256: createHash("sha256").update(currentSourceBytes!).digest("hex"), databaseSha256: currentSource.sourceDatabaseSha256 },
  connections: currentSource.connections.filter(connection => expectedConnectionIds.has(connection.id)), suppliers: currentSource.suppliers.filter(supplier => expectedSupplierIds.has(supplier.id)) } : oldFixture;
const priceMetadata = (model: ModelDescriptor) => Object.fromEntries(Object.entries(model.metadata ?? {}).filter(([key]) => /^price|^pricing|^billing|^supplierPrice|^supplierCatalogPrice|^measuredPrice$/iu.test(key)));
const productionSourcePaths = [
  "apps/desktop/renderer/lib/provider-model-inventory.ts", "apps/desktop/renderer/lib/supplier-capabilities.ts",
  "apps/desktop/renderer/lib/supplier-model-pricing.ts", "apps/desktop/renderer/lib/scanned-model-protocols.ts",
  "apps/desktop/renderer/lib/model-parameters.ts", "apps/desktop/renderer/components/canvas-app.tsx",
  "apps/desktop/renderer/components/node-parameter-fields.tsx", "packages/providers/src/c-open-image-contract.ts",
  "packages/providers/src/monster-image-capabilities.ts", "packages/providers/src/chuangxiang-image-capabilities.ts",
  "packages/providers/src/chuangxiang-image-contract.ts", "packages/providers/src/chuangxiang-midjourney-contract.ts",
  "packages/providers/src/chuangxiang-images-contract.ts", "packages/providers/src/chuangxiang-video-contract.ts",
  "packages/providers/src/genimage-image-capabilities.ts", "packages/providers/src/banana-image-contract.ts",
  "packages/providers/src/banana-image.ts", "packages/providers/src/openai.ts",
  "packages/providers/src/auto-interface-adapter.ts", "packages/providers/src/remaining-video-contracts.ts",
  "packages/runtime/src/service.ts",
];
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
  if (completedProof && process.env.C_SIX_R6_POST_STARTUP_WHOLE_PROOF_PATH) {
    const target = resolve(process.env.C_SIX_R6_POST_STARTUP_WHOLE_PROOF_PATH), allowed = resolve("../../../.codex-temp/supplier-full-document-recheck-20261010/audit-c") + sep;
    if (!target.startsWith(allowed) || !target.endsWith(".json")) throw new Error("Evidence path must stay in audit-c");
    writeFileSync(target, JSON.stringify({ ...completedProof, passed: true, finalGuardCompleted: true }, null, 2) + "\n", { flag: "wx" });
  }
});
describe.skipIf(!sourcePath)("C six suppliers post-startup current immutable contracts to cached API and local persistence", () => {
  it("clears old invented image matrices through the entire source route without losing IDs, source identity or supplier data", async () => {
    expect(currentSource?.connections.length).toBe(161); expect(fixture.connections.length).toBe(38); expect(fixture.suppliers.length).toBe(6);
    expect(new Set(fixture.connections.map(connection => connection.id))).toEqual(expectedConnectionIds);
    expect(expectedSourceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(expectedDatabaseSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(fixture.source.sha256).toBe(expectedSourceSha256);
    expect(currentSource?.sourceDatabaseSha256).toBe(expectedDatabaseSha256);
    mocks.repository = new MemoryRepository(); mocks.upstream.mockReset().mockRejectedValue(new Error("No upstream requests in actual saved contracts")); vi.stubGlobal("fetch", mocks.upstream);
    for (const supplier of fixture.suppliers) await mocks.repository.saveSupplier(structuredClone(supplier));
    for (const connection of fixture.connections) await mocks.repository.saveConnection(structuredClone(connection));
    const supplierBefore = await mocks.repository.listSuppliers();
    const proof: unknown[] = [];
    const checkedImageIdentities = new Set<string>();
    const oldConditionedVideoQuotes: unknown[] = [];
    const retainedMeasuredVideoQuotes: unknown[] = [];
    const historicalQuoteComparison = retainedQuotes.rows.map(quote => {
      const currentConnection = fixture.connections.find(connection => connection.id === quote.connectionId)!;
      const originalConnection = oldFixture.connections.find(connection => connection.id === quote.connectionId)!;
      const currentModel = (currentConnection.config.modelCatalogModels as ModelDescriptor[]).find(model => model.id === quote.fullModelId)!;
      const originalModel = (originalConnection.config.modelCatalogModels as ModelDescriptor[]).find(model => model.id === quote.fullModelId)!;
      const previous = priceMetadata(originalModel), current = priceMetadata(currentModel);
      const fields = changed(previous, current);
      // A later real free catalog attempt is distinct from the retained quote's
      // sample time.  The current immutable source remains the migration baseline.
      expect(currentModel.pricing).toEqual(quote.originalQuote);
      if (fields.length) {
        expect(currentConnection.id).toBe("f17e33fb-c96f-4826-a7e5-b0e989948b66");
        expect(String(currentConnection.config.accountKeyGroupId)).toBe("43");
        expect(fields).toEqual(["priceLastAttemptAt"]);
        expect(currentModel.metadata?.priceLastAttemptStatus).toBe("failed");
        expect(currentModel.metadata?.priceCheckedAt).toBe(originalModel.metadata?.priceCheckedAt);
      }
      return { connectionId: quote.connectionId, sourceId: currentConnection.config.supplierSourceId,
        officialGroupId: String(currentConnection.config.accountKeyGroupId), fullModelId: quote.fullModelId,
        originalPricingSha256: sha(quote.originalQuote), currentPricingSha256: sha(currentModel.pricing), pricingAndQuoteTimeUnchanged: true,
        priceMetadataChanges: Object.fromEntries(fields.map(field => [field, { before: previous[field], after: current[field] }])),
        classification: fields.length ? "real-free-catalog-failed-attempt-time-only; retained-quote-not-resampled" : "retained-quote-and-price-metadata-unchanged" };
    });
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
          expect((size?.options?.filter(o=>/^\d+x\d+$/.test(String(o.value))).length??0),JSON.stringify({group,id:row.id,size})).toBeLessThanOrEqual(8);
          expect(row.metadata?.imageResolutionProfiles,JSON.stringify({group,id:row.id})).toBeUndefined();
          if(base.includes('genimage') && row.id==='gemini-3.1-flash-image-preview') expect(row.parameters?.find(p=>p.key==='image_size')?.options?.map(o=>o.value)).toEqual(['auto','512','1K','2K','4K']);
          if(base.includes('genimage') && row.id==='gemini-2.5-flash-image') expect(row.parameters?.find(p=>p.key==='image_size')?.options?.map(o=>o.value)).toEqual(['auto']);
          if(base.includes('eaheng') && /^gpt-image-2\.5-(?:flare|sunburst)-(high|max)$/.test(row.id)) expect(row.parameters?.find(p=>p.key==='quality')?.options?.map(o=>o.value)).toEqual([row.id.endsWith('-max')?'max':'high']);
          if(base.includes('synora') && group==='adobe中质量生图') expect(row.parameters?.find(p=>p.key==='quality')?.default).toBe('medium');
        }
      };
      checks(cachedPayload);
      const stages: ReturnType<typeof contractDelta>[] = [], counts: number[] = [];
      let finalApiMediaModels: ModelDescriptor[] = [];
      let before = connection;
      for (let stage = 1; stage <= 3; stage++) {
        save.mockClear(); const response = await read(); expect(response.status).toBe(200); const api = await response.json() as ModelDescriptor[];
        expect(api.map(row => row.id)).toEqual(rows.map(row => row.id)); checks(api);
        finalApiMediaModels = api.filter(model => model.operations.some(operation => operation.startsWith("image.") || operation.startsWith("video.")));
        const after = (await mocks.repository.getConnection(connection.id))!; stages.push(contractDelta(before, after)); counts.push(save.mock.calls.length);
        for (const quote of retainedQuotes.rows.filter(row => row.connectionId === connection.id)) {
          const oldRow = (before.config.modelCatalogModels as ModelDescriptor[]).find(row => row.id === quote.fullModelId)!;
          const newRow = (after.config.modelCatalogModels as ModelDescriptor[]).find(row => row.id === quote.fullModelId)!;
          expect(oldRow.pricing, `${connection.id}:${quote.fullModelId} original actual quote`).toEqual(quote.originalQuote);
          expect(newRow.pricing, `${connection.id}:${quote.fullModelId} new parameter migration preserves original quote`).toEqual(oldRow.pricing);
          expect(priceMetadata(newRow), `${connection.id}:${quote.fullModelId}:all-price-metadata`).toEqual(priceMetadata(oldRow));
        }

        if (connection.id === "f17ea6ef-834d-4e10-a891-c432dcb77076") {
          const supplier = fixture.suppliers.find(supplier => supplier.id === connection.config.supplierId)!;
          expect(supplier.state?.sourceId).toBe(connection.config.supplierSourceId);
          expect(supplier.apiUrl).toBe(connection.config.baseUrl);
          const groups = supplier.catalog.groups.filter(group => group.supplierGroupId === String(connection.config.accountKeyGroupId));
          expect(groups).toHaveLength(1); expect(groups[0]!.supplierGroupId).toBe("27");
          const videoRows = (after.config.modelCatalogModels as ModelDescriptor[]).filter(model => model.operations.some(operation => operation.startsWith("video.")));
          expect(videoRows).toHaveLength(33);
          for (const model of videoRows) {
            const official = groups[0]!.models.find(row => row.id === model.id)!;
            const sourceQuote = official.metadata?.chuangxiangCatalogPricing;
            expect(sourceQuote).toBeDefined(); expect(model.pricing, model.id).toEqual(sourceQuote);
            expect(model.pricing?.checkedAt).toBe("2026-10-10T23:25:38.492Z");
            expect(model.metadata?.priceStatus).toBe("partial"); expect(model.metadata?.priceLastAttemptStatus).toBe("failed");
            expect(model.metadata?.priceLastAttemptAt).toBe("2026-10-11T04:52:27.826Z");
            if (stage === 3) oldConditionedVideoQuotes.push({ connectionId: connection.id, sourceId: connection.config.supplierSourceId, officialGroupId: "27", fullModelId: model.id,
              operations: model.operations, sourceCatalogField: "metadata.chuangxiangCatalogPricing", sourceQuote, sourceQuoteSha256: sha(sourceQuote), finalPricingSha256: sha(model.pricing), priceMetadata: priceMetadata(model), sourceQuoteTimePromoted: false });
          }
        }
        if (connection.id === "f17ec429-def0-4f79-aead-0ea49ead173a") {
          const beforeRows = connection.config.modelCatalogModels as ModelDescriptor[];
          for (const model of (after.config.modelCatalogModels as ModelDescriptor[]).filter(model => model.operations.some(operation => operation.startsWith("video.")))) {
            const original = beforeRows.find(row => row.id === model.id)!;
            expect(model.pricing).toEqual(original.pricing); expect(model.metadata?.measuredPrice).toEqual(original.metadata?.measuredPrice);
            expect(model.metadata?.priceCheckedAt).toBe(original.metadata?.priceCheckedAt);
            if (stage === 3) retainedMeasuredVideoQuotes.push({connectionId: connection.id, fullModelId: model.id, originalMeasuredEvidenceSha256: sha(original.metadata?.measuredPrice),
              finalMeasuredEvidenceSha256: sha(model.metadata?.measuredPrice), originalMeasurementTime: original.metadata?.priceCheckedAt, finalMeasurementTime: model.metadata?.priceCheckedAt,
              originalDirectoryAttemptAt: original.metadata?.priceLastAttemptAt, finalDirectoryAttemptAt: model.metadata?.priceLastAttemptAt, measuredQuoteScopeUnchanged: true });
          }
        }
        expect(json({ ...before, config: undefined, updatedAt: undefined })).toEqual(json({ ...after, config: undefined, updatedAt: undefined }));
        expect(Object.keys(after.config).filter(key => !["modelCatalogModels", "connector", "modelProtocolTemplate"].includes(key)).map(key => [key, after.config[key]]))
          .toEqual(Object.keys(before.config).filter(key => !["modelCatalogModels", "connector", "modelProtocolTemplate"].includes(key)).map(key => [key, before.config[key]]));
        before = after;
      }
      expect(counts[2]).toBe(0);
      expect(await mocks.repository.listSuppliers()).toEqual(supplierBefore);
      proof.push({ connectionId: connection.id, supplierId: connection.config.supplierId, sourceId: connection.config.supplierSourceId, group: connection.config.modelGroup,
        modelCount: rows.length, fullModelIds: rows.map(row => row.id), cachedStatus: cached.status,
        cachedApiMediaModels: cachedPayload.filter((model: ModelDescriptor) => model.operations.some(operation => operation.startsWith("image.") || operation.startsWith("video."))),
        finalApiMediaModels, ordinaryGetSaveCounts: counts, sourceDelta: { firstGet: stages[0], secondGet: stages[1], thirdGet: stages[2] } }); save.mockRestore();
    }
    expect(checkedImageIdentities.size).toBe(100);
    expect(oldConditionedVideoQuotes).toHaveLength(33); expect(retainedMeasuredVideoQuotes).toHaveLength(2);
    completedProof = { currentImmutableRawSource: fixture.source, priorBaselineContractProof: "audit-c/c-six-r6-root-final-source-proof-v6-safe.json", source: fixture.source,
      sourceFiles: productionSourcePaths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(resolve("../../../", path))).digest("hex") })),
      connectionCount: fixture.connections.length, cachedImageRowCount: checkedImageIdentities.size,
      retainedActualQuoteCount: retainedQuotes.rows.length, quoteSourcesAndOriginalDatesPreserved: true,
      currentImmutablePriceMetadataProtectedThroughAllStages: true, historicalQuoteComparison,
      oldConditionedVideoQuoteCount: oldConditionedVideoQuotes.length, oldConditionedVideoQuotes, retainedMeasuredVideoQuoteCount: retainedMeasuredVideoQuotes.length, retainedMeasuredVideoQuotes,
      connections: proof, networkRequests: mocks.upstream.mock.calls.length, actualProfileWrites: 0 };
  }, 120000);
});

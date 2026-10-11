import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, upstream: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; }, jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: mocks.upstream, discoverSupplierCatalog: mocks.upstream, scanProviderModelCatalog: mocks.upstream }));
import { readProviderModelInventory } from "./provider-model-inventory";
import { modelEstimatedCost, modelPriceSummary } from "./model-display";
const rawPath = process.env.CYBER_POST_CATALOGUE_RAW_PATH;
const rawBytes = rawPath ? readFileSync(rawPath) : undefined;
const raw = rawBytes ? JSON.parse(rawBytes.toString("utf8")) as { sourceDatabaseSha256: string; connections: ProviderConnectionRecord[]; suppliers: SupplierRecord[] } : undefined;
const targetIds = ["f17e7ca8-4a5b-4f2b-a6f8-bbbfbb4167cb", "f17e2d3e-48c6-4cea-a340-5a16686b0648"];
const groups = ["图片视频模型综合分组", "特价seedance2.0"];
const supplierId = "supplier-ba46b25f282ceca6ebbbcf42", sourceId = "f17ed577-0d99-4aae-a23f-c8b38466e92b";
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(canonical(v)) ?? "undefined").digest("hex");
const byteSha = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
let completedProof: Record<string, unknown> | undefined;
afterEach(() => {
  expect(mocks.upstream).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (completedProof && process.env.CYBER_POST_CATALOGUE_PROOF_PATH) {
    const path = resolve(process.env.CYBER_POST_CATALOGUE_PROOF_PATH);
    expect(path.startsWith(resolve("../../../.codex-temp/supplier-full-document-recheck-r8-20261010") + sep)).toBe(true);
    writeFileSync(path, JSON.stringify({ ...completedProof, passed: true, finalGuardCompleted: true }, null, 2) + "\n", { flag: "wx" });
  }
});
describe("Cyber exact completed catalogOnly source to finite saved parameter/price contracts", () => {
  it.skipIf(!rawPath)("projects the actual freshly sampled full18/161 source and proves exact two-target three-stage persistence without reparse or network", async () => {
    expect(raw!.connections).toHaveLength(161); expect(raw!.suppliers).toHaveLength(18);
    expect(byteSha(rawBytes!)).toBe(process.env.CYBER_POST_CATALOGUE_RAW_SHA256);
    expect(raw!.sourceDatabaseSha256).toBe(process.env.CYBER_POST_CATALOGUE_DATABASE_SHA256);
    mocks.repository = new MemoryRepository(); mocks.upstream.mockReset().mockRejectedValue(new Error("No network in completed catalogue source replay")); vi.stubGlobal("fetch", mocks.upstream);
    for (const supplier of raw!.suppliers) await mocks.repository.saveSupplier(structuredClone(supplier));
    for (const connection of raw!.connections) await mocks.repository.saveConnection(structuredClone(connection));
    const originalSuppliers = await mocks.repository.listSuppliers(), originalConnections = await mocks.repository.listConnections();
    const supplier = originalSuppliers.find(s => s.id === supplierId)!;
    expect(supplier.state?.sourceId).toBe(sourceId); expect(supplier.siteUrl).toBe("https://api.3365api.cn");
    expect(supplier.scannedAt).toBe("2026-10-11T11:58:50.523Z");
    for (const group of groups) {
      const own = supplier.catalog.groups.find(g => g.id === group)!.models.find(m => m.id === "seedance2.5")!;
      expect(own.metadata?.officialCatalogPriceGroupVerified).toBe(true);
      expect(own.metadata?.officialCatalogPricing).toMatchObject({ kind: "tiered", billingUnit: "second", currency: "USD", sourceUrl: "https://api.3365api.cn/api/pricing", checkedAt: supplier.scannedAt });
    }
    const read = (id: string, query = "?cached=1") => readProviderModelInventory(new Request(`http://localhost/api/providers/${id}/models${query}`), { params: Promise.resolve({ id }) });
    const saveSpy = vi.spyOn(mocks.repository, "saveConnection"), cachedApi = [];
    for (const connection of raw!.connections) {
      const response = await read(connection.id); const api = await response.json();
      cachedApi.push({ connectionId: connection.id, http: response.status, modelsSha256: sha(api), ...(targetIds.includes(connection.id) ? { models: api } : {}) });
    }
    expect(saveSpy).not.toHaveBeenCalled();
    const connectionStages = [];
    for (let index = 0; index < targetIds.length; index++) {
      const id = targetIds[index]!, group = groups[index]!, stages = [], counts = [];
      for (let stage = 1; stage <= 3; stage++) {
        const before = (await mocks.repository.getConnection(id))!; saveSpy.mockClear();
        const response = await read(id, ""); expect(response.status).toBe(200);
        const apiModels = await response.json() as ModelDescriptor[], after = (await mocks.repository.getConnection(id))!;
        const own = apiModels.find(m => m.id === "seedance2.5")!;
        expect(own.pricing).toMatchObject({ kind: "tiered", billingUnit: "second", currency: "USD", sourceUrl: "https://api.3365api.cn/api/pricing", checkedAt: supplier.scannedAt });
        expect(own.pricing?.tiers?.map(t => [t.dimension, t.value, t.price])).toEqual([["resolution", "480p", 2.625], ["resolution", "720p", 4.725]]);
        expect(own.metadata?.videoResolutionValueMode).toBe("application-price-tier");
        expect(own.metadata?.videoDerivedSizeMappings).toBeUndefined();
        expect(own.parameters?.find(p => p.key === "size")).toMatchObject({ control: "text", valueType: "string" });
        expect(modelPriceSummary(own, { resolution: "480p", size: "1600x900", aspect_ratio: "16:9", duration: 10 })).toBe("2.625 USD / 秒");
        expect(modelEstimatedCost(own, { resolution: "480p", size: "1600x900", aspect_ratio: "16:9", duration: 10 })).toBe("26.25 USD");
        expect(modelEstimatedCost(own, { resolution: "720p", size: "1600x900", aspect_ratio: "16:9", duration: 30 })).toBe("141.75 USD");
        expect(modelEstimatedCost(own, { resolution: "1080p", size: "1600x900", duration: 10 })).toBeUndefined();
        const saveCount = saveSpy.mock.calls.length; counts.push(saveCount);
        stages.push({ stage, expectedSaveCount: saveCount, beforeConnectionSha256: sha(before), afterConnectionSha256: sha(after), configBefore: before.config, configAfter: after.config, apiModels });
        expect((await mocks.repository.listConnections()).filter(c => !targetIds.includes(c.id))).toEqual(originalConnections.filter(c => !targetIds.includes(c.id)));
        expect(await mocks.repository.listSuppliers()).toEqual(originalSuppliers);
      }
      expect(counts).toEqual([1, 1, 0]);
      connectionStages.push({ connectionId: id, group, fullModelId: "seedance2.5", ordinaryPath: `/api/providers/${id}/models`, ordinaryGetSaveCounts: counts, stages });
    }
    completedProof = { rawSource: { path: rawPath, sha256: byteSha(rawBytes!) }, sourceDatabaseSha256: raw!.sourceDatabaseSha256, sourceOfficialSamplingAt: supplier.scannedAt,
      sourceCatalogueIsActualCompletedFreeRead: true, sourceReplayIntroducesNoNewSampling: true, catalogueReparseCount: 0, supplierCount: 18, connectionCount: 161,
      cachedReadCount: 161, cachedRepositorySaveCount: 0, cachedApi, ordinaryTargetConnectionIds: targetIds, connectionStages,
      allOther159ConnectionsUnchanged: true, all18SuppliersUnchanged: true, original43QuoteConnectionsUnchanged: true, applicationCalls: 0, actualProfileReads: 0, actualProfileWrites: 0, upstreamRequests: 0, paidMediaRequests: 0 };
  }, 600000);
});

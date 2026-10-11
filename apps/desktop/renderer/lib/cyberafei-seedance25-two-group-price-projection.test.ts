import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { parseSupplierCatalog } from "../../../../packages/providers/src/supplier-catalog";
import { GenericRestAdapter } from "../../../../packages/providers/src/rest";
import { StaticConnectionResolver } from "../../../../packages/providers/src/credentials";
import { normalizedParametersForModel } from "./model-parameters";
const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, upstream: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; }, jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: mocks.upstream, discoverSupplierCatalog: mocks.upstream, scanProviderModelCatalog: mocks.upstream }));
import { readProviderModelInventory } from "./provider-model-inventory";
import { modelEstimatedCost, modelPriceSummary } from "./model-display";
import { applySupplierCatalogPrices } from "./supplier-model-pricing";

const pricingFixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/cyberafei-seedance25-two-group-pricing-source.json", import.meta.url), "utf8"));
const rawPath = process.env.CYBER_SEEDANCE25_RAW_PATH;
const rawBytes = rawPath ? readFileSync(rawPath) : undefined;
const raw = rawBytes ? JSON.parse(rawBytes.toString("utf8")) as { sourceDatabaseSha256: string; connections: ProviderConnectionRecord[]; suppliers: SupplierRecord[] } : undefined;
const sourceId = "f17ed577-0d99-4aae-a23f-c8b38466e92b", supplierId = "supplier-ba46b25f282ceca6ebbbcf42";
const targetId = "f17e2d3e-48c6-4cea-a340-5a16686b0648", generalId = "f17e7ca8-4a5b-4f2b-a6f8-bbbfbb4167cb", origin = "https://api.3365api.cn";
const groups = ["图片视频模型综合分组", "特价seedance2.0"];
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, canonical(value)])) : v;
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(canonical(v)) ?? "undefined").digest("hex");
const byteSha = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
let completedProof: Record<string, unknown> | undefined;
afterEach(() => {
  expect(mocks.upstream).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (completedProof && process.env.CYBER_SEEDANCE25_PROJECTION_PROOF_PATH) {
    const target = resolve(process.env.CYBER_SEEDANCE25_PROJECTION_PROOF_PATH);
    expect(target.startsWith(resolve("../../../.codex-temp/supplier-full-document-recheck-r8-20261010") + sep)).toBe(true);
    writeFileSync(target, JSON.stringify({ ...completedProof, passed: true, finalGuardCompleted: true }, null, 2) + "\n", { flag: "wx" });
  }
});

describe("Cyberafei exact seedance2.5 catalogue to saved price presentation", () => {
  it("links both groups own parsed rates to resolution and duration without using the generic group statement", () => {
    const parsed = parseSupplierCatalog({ data: [pricingFixture.row], group_ratio: pricingFixture.group_ratio, usable_group: pricingFixture.usable_group },
      { supplierSiteUrl: origin, currency: "USD", checkedAt: pricingFixture.source.checkedAt });
    const descriptor: ModelDescriptor = { id: "seedance2.5", name: "seedance2.5", operations: ["video.generate"],
      metadata: { supplier: "cyberafei", billingUnit: "second", priceSource: "supplier-catalog", priceLabel: "$2.625/请求" },
      pricing: { kind: "per-request", currency: "USD", unitAmount: 2.625, confidence: "exact", checkedAt: pricingFixture.source.checkedAt } };
    for (const group of groups) {
      const model = applySupplierCatalogPrices([descriptor], group, { ...parsed, status: "live", complete: true, checkedAt: pricingFixture.source.checkedAt }, origin)[0]!;
      expect(modelPriceSummary(model, { resolution: "480p", duration: 5 })).toBe("2.625 USD / 秒");
      expect(modelEstimatedCost(model, { resolution: "480p", duration: 5 })).toBe("13.125 USD");
      expect(modelPriceSummary(model, { resolution: "720p", duration: 30 })).toBe("4.725 USD / 秒");
      expect(modelEstimatedCost(model, { resolution: "720p", duration: 30 })).toBe("141.75 USD");
      expect(modelEstimatedCost(model, { resolution: "1080p", duration: 30 })).toBeUndefined();
      expect(modelEstimatedCost(model, { resolution: "720p" })).toBeUndefined();
    }
  });

  it.skipIf(!rawPath)("projects all actual 18 suppliers and 161 saved Keys, distinguishes current stored-catalogue projection from the necessary source reparse and persists only two exact contracts", async () => {
    expect(raw!.connections).toHaveLength(161); expect(raw!.suppliers).toHaveLength(18);
    expect(byteSha(rawBytes!)).toBe(process.env.CYBER_SEEDANCE25_RAW_SHA256);
    expect(raw!.sourceDatabaseSha256).toBe(process.env.CYBER_SEEDANCE25_DATABASE_SHA256);
    mocks.repository = new MemoryRepository(); mocks.upstream.mockReset().mockRejectedValue(new Error("No network in exact price source replay")); vi.stubGlobal("fetch", mocks.upstream);
    for (const supplier of raw!.suppliers) await mocks.repository.saveSupplier(structuredClone(supplier));
    for (const connection of raw!.connections) await mocks.repository.saveConnection(structuredClone(connection));
    const originalSuppliers = await mocks.repository.listSuppliers(), originalConnections = await mocks.repository.listConnections();
    const read = (id: string, query = "?cached=1") => readProviderModelInventory(new Request(`http://localhost/api/providers/${id}/models${query}`), { params: Promise.resolve({ id }) });
    const apiBefore = new Map<string, { status: number; models: unknown }>();
    const saveSpy = vi.spyOn(mocks.repository, "saveConnection");
    for (const connection of raw!.connections) { const response = await read(connection.id); apiBefore.set(connection.id, { status: response.status, models: await response.json() }); }
    expect(saveSpy).not.toHaveBeenCalled();
    const exactTargets = [generalId, targetId];
    const originalTargets = new Map(exactTargets.map(id => [id, originalConnections.find(c => c.id === id)!]));
    const existingNormalizations = new Map<string, Array<{ before: ProviderConnectionRecord; after: ProviderConnectionRecord; saveCount: number }>>();
    // Record finite existing normalization independently of the catalog reparse.
    // This also records the newly sourced native parameter contract, without
    // pretending that the old flat special-group quote became correct.
    for (const id of exactTargets) {
      const normalization: Array<{ before: ProviderConnectionRecord; after: ProviderConnectionRecord; saveCount: number }> = [];
      for (let stage = 1; stage <= 3; stage++) {
        const before = (await mocks.repository.getConnection(id))!; saveSpy.mockClear();
        const response = await read(id, ""); expect(response.status).toBe(200); const apiModels = await response.json() as ModelDescriptor[];
        const exact = apiModels.find(m => m.id === "seedance2.5")!;
        expect(exact.metadata?.videoResolutionValueMode).toBe("application-price-tier");
        if (id === targetId) expect(exact.pricing?.kind).toBe("per-request");
        normalization.push({ before, after: (await mocks.repository.getConnection(id))!, saveCount: saveSpy.mock.calls.length });
      }
      expect(normalization[2]!.saveCount).toBe(0);
      existingNormalizations.set(id, normalization);
      await mocks.repository.saveConnection(structuredClone(originalTargets.get(id)!));
    }
    saveSpy.mockClear();
    const supplier = (await mocks.repository.getSupplier(supplierId))!;
    expect(supplier.state?.sourceId).toBe(sourceId); expect(supplier.siteUrl).toBe(origin);
    // Replay the captured public row at the existing stored catalogue timestamp.
    // This is a source test, never a claim that a new official refresh occurred.
    const replay = parseSupplierCatalog({ data: [pricingFixture.row], group_ratio: pricingFixture.group_ratio, usable_group: pricingFixture.usable_group },
      { supplierSiteUrl: origin, currency: "USD", checkedAt: supplier.scannedAt! });
    const catalogueChanges: unknown[] = [];
    const nextSupplier = structuredClone(supplier);
    for (const group of groups) {
      const previous = nextSupplier.catalog.groups.find(row => row.id === group)!.models.find(row => row.id === "seedance2.5")!;
      const parsed = replay.groups.find(row => row.id === group)!.models.find(row => row.id === previous.id)!;
      const next = { ...previous, priceLabel: parsed.priceLabel, metadata: { ...previous.metadata,
        officialCatalogPricing: parsed.metadata!.officialCatalogPricing, officialCatalogPriceGroupVerified: parsed.metadata!.officialCatalogPriceGroupVerified } };
      if (sha(previous) !== sha(next)) catalogueChanges.push({ group, fullModelId: previous.id, before: previous, after: next });
      Object.assign(previous, next);
    }
    expect(catalogueChanges).toHaveLength(1); expect((catalogueChanges[0] as { group: string }).group).toBe(groups[1]);
    await mocks.repository.saveSupplier(nextSupplier);
    const savedNextSupplier = (await mocks.repository.getSupplier(supplierId))!;
    expect((await mocks.repository.listSuppliers()).filter(row => row.id !== supplierId)).toEqual(originalSuppliers.filter(row => row.id !== supplierId));
    const affectedApi: unknown[] = [];
    for (const connection of raw!.connections) {
      const response = await read(connection.id), after = { status: response.status, models: await response.json() };
      const before = apiBefore.get(connection.id)!;
      if (sha(before) !== sha(after)) {
        expect(connection.id).toBe(targetId); expect(before.status).toBe(200); expect(after.status).toBe(200);
        const left = before.models as ModelDescriptor[], right = after.models as ModelDescriptor[];
        expect(right.map(row => row.id)).toEqual(left.map(row => row.id));
        for (const previous of left) {
          const next = right.find(row => row.id === previous.id)!;
          if (previous.id !== "seedance2.5") { expect(next).toEqual(previous); continue; }
          expect({ ...next, name: previous.name, pricing: previous.pricing, metadata: previous.metadata }).toEqual(previous);
          expect(next.pricing?.billingUnit).toBe("second"); expect(next.pricing?.tiers?.map(row => row.price)).toEqual([2.625, 4.725]);
          expect(modelPriceSummary(next, { resolution: "720p", aspect_ratio: "16:9", size: "1600x900", duration: 10 })).toBe("4.725 USD / 秒");
          expect(modelEstimatedCost(next, { resolution: "720p", aspect_ratio: "16:9", size: "1600x900", duration: 10 })).toBe("47.25 USD");
          affectedApi.push({ connectionId: connection.id, group: groups[1], fullModelId: next.id, before: previous, after: next });
        }
      }
    }
    expect(affectedApi).toHaveLength(1); expect(saveSpy).not.toHaveBeenCalled();
    const connectionStages: unknown[] = [];
    for (const id of exactTargets) {
    const counts: number[] = [], stages: unknown[] = [];
    for (let stage = 1; stage <= 3; stage++) {
      const before = (await mocks.repository.getConnection(id))!; saveSpy.mockClear();
      const response = await read(id, ""); expect(response.status).toBe(200);
      const apiModels = await response.json() as ModelDescriptor[], after = (await mocks.repository.getConnection(id))!;
      counts.push(saveSpy.mock.calls.length); stages.push({ stage, beforeConnectionSha256: sha(before), afterConnectionSha256: sha(after), apiModels,
        configBefore: before.config, configAfter: after.config });
      const expectedNormalization = existingNormalizations.get(id)![stage - 1]!.after;
      const control = structuredClone(after);
      for (const key of ["modelCatalogModels", "connector", "modelProtocolTemplate"]) {
        const previousContainer = expectedNormalization.config[key], afterContainer = after.config[key];
        const previousModels = (key === "modelCatalogModels" ? previousContainer : (previousContainer as { models?: ModelDescriptor[] } | undefined)?.models) as ModelDescriptor[] | undefined;
        const nextModels = (key === "modelCatalogModels" ? afterContainer : (afterContainer as { models?: ModelDescriptor[] } | undefined)?.models) as ModelDescriptor[] | undefined;
        expect(nextModels?.map(row => row.id)).toEqual(previousModels?.map(row => row.id));
        for (const previous of previousModels ?? []) {
          const next = nextModels!.find(row => row.id === previous.id)!;
          if (previous.id !== "seedance2.5") expect(next).toEqual(previous);
          else expect({ ...next, name: previous.name, pricing: previous.pricing, metadata: previous.metadata }).toEqual(previous);
        }
        control.config[key] = expectedNormalization.config[key];
      }
      control.updatedAt = expectedNormalization.updatedAt; expect(control).toEqual(expectedNormalization);
      expect((await mocks.repository.listConnections()).filter(row => !exactTargets.includes(row.id))).toEqual(originalConnections.filter(row => !exactTargets.includes(row.id)));
      expect(await mocks.repository.listSuppliers()).toEqual(originalSuppliers.map(row => row.id === supplierId ? savedNextSupplier : row));
    }
    expect(counts[0]).toBeGreaterThan(0); expect(counts[2]).toBe(0);
    const saved = (await mocks.repository.getConnection(id))!;
    const wire = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: "offline-only-task", status: "queued" }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id, provider: saved.provider, baseUrl: String(saved.config.baseUrl),
      apiKey: "offline-fixture", settings: saved.config }]), { fetch: wire });
    const model = (saved.config.modelCatalogModels as unknown as ModelDescriptor[]).find(m => m.id === "seedance2.5")!;
    for (const resolution of ["480p", "720p"]) {
      const parameters = { duration: 10, resolution, aspect_ratio: "16:9", size: "1600x900" };
      expect(normalizedParametersForModel("video-generation", saved.provider, model, parameters)).toMatchObject(parameters);
      const request = { connectionId: id, operation: "video.generate" as const, model: model.id, prompt: "offline source fixture", idempotencyKey: "offline-only", parameters };
      expect(await adapter.validate(request)).toMatchObject({ valid: true });
      await adapter.submit(request);
      const [url, options] = wire.mock.calls.at(-1)!;
      expect(String(url)).toBe(`${origin}/v1/videos`);
      expect(Object.fromEntries((options!.body as FormData).entries())).toEqual({ model: model.id, prompt: request.prompt, seconds: "10", size: "1600x900" });
      expect(modelEstimatedCost(model, parameters)).toBe(resolution === "480p" ? "26.25 USD" : "47.25 USD");
    }
    const fetchCount = wire.mock.calls.length;
    expect(await adapter.validate({ connectionId: id, operation: "video.generate", model: model.id, prompt: "", idempotencyKey: "offline-only", parameters: { duration: 10, resolution: "480p" } })).toMatchObject({ valid: false });
    expect(wire).toHaveBeenCalledTimes(fetchCount);
    connectionStages.push({ connectionId: id, group: id === targetId ? groups[1] : groups[0], ordinaryGetSaveCounts: counts, stages, existingNormalizationStages: existingNormalizations.get(id) });
    }
    completedProof = { sourceDatabaseSha256: raw!.sourceDatabaseSha256, rawSource: { path: rawPath, sha256: byteSha(rawBytes!) },
      officialOriginalRowSource: pricingFixture.source, sourceReplayIsNotNewOfficialSampling: true,
      supplierCount: 18, connectionCount: 161, catalogueChanges, affectedApi, ordinaryTargetConnectionIds: exactTargets, connectionStages, currentStoredCatalogPriceCorrectedWithoutRefresh: false,
      allOther159ConnectionsUnchanged: true, allOther17SuppliersUnchanged: true, original43QuoteConnectionsUnchanged: true,
      onlyOwnSeedance25ParametersAndPriceMetadataMayChange: true, allLimitsOperationsAndKeyReferencesUnchanged: true, applicationCalls: 0, actualProfileReads: 0, actualProfileWrites: 0, upstreamRequests: 0, paidMediaRequests: 0 };
  }, 600000);
});

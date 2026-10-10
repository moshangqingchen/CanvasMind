import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, SupplierCatalogDiscovery } from "@super-canvas/providers";
import type { ProviderConnectionView } from "./client-api";

vi.mock("./supplier-service", () => ({ getSupplierRecord: vi.fn() }));
vi.mock("./server", () => ({ repository: { getSupplierVerification: vi.fn(async () => null) } }));

import { getSupplierRecord } from "./supplier-service";
import { enrichSupplierModelPrices } from "./supplier-model-pricing";
import { withCurrentImageRequestParameters } from "./image-request-parameters";
import { modelEstimatedCost, modelPriceSummary } from "./model-display";
import { applyWeAiLivePricing, WEAI_ADOBE_PER_REQUEST_GROUP, WEAI_ADOBE_PER_REQUEST_URL_GROUP, weAiCanvasModelDescriptors } from "./weai-catalog";

const checkedAt = "2026-10-10T08:00:00.000Z";
const network = vi.fn();

beforeEach(() => {
  network.mockReset().mockRejectedValue(new Error("Cached price rehydration must not fetch"));
  vi.stubGlobal("fetch", network);
  vi.mocked(getSupplierRecord).mockReset();
});

afterEach(() => {
  try { expect(network).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

function savedSupplier(
  origin: string,
  group: string,
  modelId: string,
  metadata: Record<string, unknown>,
  priceLabel: string,
  provider = "openai",
  supplierGroupId = "42",
): ProviderConnectionView {
  const selected: SupplierCatalogDiscovery["groups"][number] = {
    id: group, label: group, supplierGroupId, source: "catalog",
    models: [{ id: modelId, name: modelId, capability: "image", protocol: "openai-images", priceLabel, metadata }],
  };
  // A plausible quote for the same model in another group must never win.
  const decoy = { ...selected, id: "other-group", supplierGroupId: "99", models: [{
    ...selected.models[0]!, priceLabel: "$99/张",
    metadata: { officialCatalogPricing: { kind: "per-image", currency: "USD", unitAmount: 99, confidence: "exact", checkedAt } },
  }] };
  const supplier = {
    id: "isolated-price-supplier", siteUrl: origin, apiUrl: `${origin}/v1`, kind: "sub2api",
    state: { sourceId: "isolated-price-source" }, catalog: { groups: [decoy, selected] },
    scanStatus: "live", scanComplete: true, scannedAt: checkedAt, updatedAt: checkedAt,
  };
  vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
  return {
    id: "isolated-price-connection", name: "Offline price rehydration", provider, apiKeySet: false, apiKey: "",
    config: { supplierId: supplier.id, supplierSourceId: supplier.state.sourceId, baseUrl: supplier.apiUrl,
      accountKeyGroup: group, modelGroup: group, accountKeyGroupId: supplierGroupId },
  };
}

async function restoreForUi(connection: ProviderConnectionView, cached: ModelDescriptor): Promise<ModelDescriptor> {
  // Exercise the same enrichment used by cached model GETs, then the canvas overlay.
  const received = await enrichSupplierModelPrices(connection, [cached], false, false);
  const saved = JSON.parse(JSON.stringify(received)) as ModelDescriptor[];
  const readBack = await enrichSupplierModelPrices(connection, saved, false, false);
  expect(readBack[0]?.pricing).toEqual(received[0]?.pricing);
  const ui = withCurrentImageRequestParameters(connection, readBack)[0]!;
  expect(ui.pricing).toEqual(received[0]?.pricing);
  expect(ui.metadata).toMatchObject({ priceStatus: "available", supplierPriceGroup: connection.config.modelGroup, supplierPriceGroupId: connection.config.accountKeyGroupId });
  return ui;
}

describe("cached supplier prices survive enrichment and the real UI contract", () => {
  const missingPrices: {
    supplier: string; origin: string; group: string; modelId: string; field: string;
    pricing: NonNullable<ModelDescriptor["pricing"]>; label: string; metadata: Record<string, unknown>;
    parameters: Record<string, unknown>; summary: string; total: string;
  }[] = [
    {
      supplier: "Fri", origin: "https://platform.frimodel.com", group: "gpt_image_adobe", modelId: "gpt-image-2-adobe",
      field: "officialCatalogPricing", label: "$0.04/请求",
      pricing: { kind: "per-request", billingUnit: "request", currency: "USD", unitAmount: .04, confidence: "exact", checkedAt,
        sourceUrl: "https://platform.frimodel.com/api/pricing" },
      metadata: { liveInventory: true, protocol: "frimodel-images", priceLabel: "$0.05/张" },
      parameters: { size: "auto", quality: "high", n: 1 }, summary: "0.04 USD / 次", total: "0.04 USD",
    },
    {
      supplier: "Chuangxiang", origin: "https://vapi.chuangxiangai.asia", group: "生图", modelId: "gemini-3-pro-image-preview",
      field: "chuangxiangCatalogPricing", label: "1K ¥0.0875/张 · 2K ¥0.1125/张 · 4K ¥0.1375/张",
      pricing: { kind: "per-image", billingUnit: "image", currency: "CNY", unitAmount: .0875, confidence: "snapshot", checkedAt,
        sourceUrl: "https://vapi.chuangxiangai.asia/model-plaza", tiers: [
          { id: "1K", label: "1K", dimension: "resolution", value: "1K", price: .0875 },
          { id: "2K", label: "2K", dimension: "resolution", value: "2K", price: .1125 },
          { id: "4K", label: "4K", dimension: "resolution", value: "4K", price: .1375 },
        ] },
      metadata: { protocol: "chuangxiang-banana-images", priceSource: "supplier-catalog", priceStatus: "partial", priceLabel: "价格未公布" },
      parameters: { image_size: "4K", aspect_ratio: "auto", n: 1 }, summary: "0.1375 CNY / 张（参考）", total: "0.1375 CNY（参考）",
    },
  ];

  it.each(missingPrices)("restores $supplier structured pricing from its own group before estimating", async fixture => {
    const connection = savedSupplier(fixture.origin, fixture.group, fixture.modelId,
      { [fixture.field]: fixture.pricing, officialCatalogPriceGroupVerified: true }, fixture.label);
    const cached: ModelDescriptor = { id: fixture.modelId, name: fixture.modelId, operations: ["image.generate"], outputKinds: ["image"],
      metadata: { canvasRunnable: true, ...fixture.metadata } };
    expect(cached.pricing).toBeUndefined();
    expect(modelEstimatedCost(cached, fixture.parameters)).toBeUndefined();
    const ui = await restoreForUi(connection, cached);
    expect(ui.pricing).toEqual(fixture.pricing);
    expect(ui.pricing).toMatchObject({ currency: fixture.pricing.currency, billingUnit: fixture.pricing.billingUnit });
    expect(modelPriceSummary(ui, fixture.parameters)).toBe(fixture.summary);
    expect(modelEstimatedCost(ui, fixture.parameters)).toBe(fixture.total);
  });

  const qualityPrices = [
    { quality: "low", old: .04, current: .03 },
    { quality: "medium", old: .07, current: .05 },
    { quality: "high", old: .15, current: .15 },
  ];
  const weaiGroups = [
    { group: WEAI_ADOBE_PER_REQUEST_GROUP, supplierGroupId: "23", fixedQuality: true },
    { group: WEAI_ADOBE_PER_REQUEST_URL_GROUP, supplierGroupId: "42", fixedQuality: false },
  ];
  it.each(weaiGroups.flatMap(group => qualityPrices.map(price => ({ ...group, ...price }))))(
    "replaces WeAI $group $quality docs pricing with the exact live group quote in the UI",
    async ({ group, supplierGroupId, fixedQuality, quality, old, current }) => {
    // The non-URL route accepts only the full fixed-quality model IDs.
    const modelId = fixedQuality ? `gpt-image-2-${quality}` : "gpt-image-2";
    const callable = weAiCanvasModelDescriptors(group);
    if (fixedQuality) expect(callable.some(model => model.id === "gpt-image-2")).toBe(false);
    const base = callable.find(model => model.id === modelId)!;
    expect(base).toBeDefined();
    const cached = applyWeAiLivePricing([base], {
      groupId: group, source: "official-docs", sourceUrl: "https://docs.we-ai.cc/guides/image-generation-service.html",
      checkedAt: "2026-10-01T00:00:00.000Z", complete: false, multiplier: 1,
      models: { [modelId]: { kind: "per-request", multiplier: 1, tiers: fixedQuality ? [{ id: "request", label: "单次", price: old }] : [
        { id: "low", label: "LOW", price: .04 }, { id: "medium", label: "MEDIUM", price: .07 }, { id: "high", label: "HIGH", price: .15 },
      ] } },
    })[0]!;
    const pricing: NonNullable<ModelDescriptor["pricing"]> = {
      kind: "per-request", billingUnit: "request", currency: "USD", confidence: "exact", checkedAt,
      sourceUrl: `https://asian-acc.we-token.cc/api/v1/model-plaza-legacy/models?group_id=${supplierGroupId}`,
      ...(fixedQuality ? { unitAmount: current } : {}),
      tiers: fixedQuality ? ["1K", "2K", "4K"].map(resolution => ({
        id: resolution, label: resolution, dimension: "resolution", value: resolution, price: current,
      })) : [
        { id: "price_low", label: "low", dimension: "quality", value: "low", price: .03 },
        { id: "price_medium", label: "medium", dimension: "quality", value: "medium", price: .05 },
        { id: "price_high", label: "high", dimension: "quality", value: "high", price: .15 },
      ],
    };
    const connection = savedSupplier("https://asian-acc.we-token.cc", group, modelId,
      { weaiLegacyPricing: pricing, weaiLegacyPriceEvidence: { imageTierPricesComplete: true } },
      fixedQuality ? `${quality} $${current}/次` : "low $0.03/次 · medium $0.05/次 · high $0.15/次", "weai", supplierGroupId);
    const parameters = fixedQuality ? { size: "auto", n: 1 } : { size: "auto", quality, n: 1 };
    expect(cached.metadata).toMatchObject({ pricingSource: "official-docs", pricingComplete: false });
    expect(modelEstimatedCost(cached, parameters)).toBe(`${old} USD（参考）`);
    const ui = await restoreForUi(connection, cached);
    expect(ui.pricing).toEqual(pricing);
    expect(ui.id).toBe(modelId);
    // Fixed quality is encoded by the full model ID, not a made-up dropdown.
    if (fixedQuality) expect(ui.parameters?.some(parameter => parameter.key === "quality")).toBe(false);
    expect(ui.pricing).toMatchObject({ currency: "USD", billingUnit: "request", confidence: "exact" });
    expect(modelPriceSummary(ui, parameters)).toBe(`${current} USD / 次`);
    expect(modelEstimatedCost(ui, parameters)).toBe(`${current} USD`);
  });
});

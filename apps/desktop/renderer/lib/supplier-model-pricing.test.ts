import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type {
  ModelDescriptor,
  SupplierCatalogDiscovery,
} from "@super-canvas/providers";
vi.mock("./supplier-service", () => ({
  getSupplierRecord: vi.fn(async () => null),
}));
vi.mock("./server", () => ({
  repository: { getSupplierVerification: vi.fn(async () => null) },
}));
vi.mock("@super-canvas/providers", async (original) => ({
  ...(await original<typeof import("@super-canvas/providers")>()),
  discoverSupplierCatalog: vi.fn(async () => ({
    kind: "newapi",
    status: "live",
    checkedAt: "now",
    groups: [
      {
        id: "new-group",
        label: "New group",
        source: "catalog",
        models: [{ id: "new-image", priceLabel: "$0.02/张" }],
      },
    ],
  })),
  loginSupplierSite: vi.fn(async () => ({ kind: "newapi", fetch: vi.fn() })),
}));
import { discoverSupplierCatalog, encryptSecret, loginSupplierSite, SupplierLoginError } from "@super-canvas/providers";
import { getSupplierRecord } from "./supplier-service";
import { repository } from "./server";
import { modelEstimatedCost, modelPriceSummary } from "./model-display";
import { requireServerMasterKey } from "./master-key";
import {
  applySupplierCatalogPrices,
  enrichSupplierModelPrices,
  measuredPricesFromVerification,
  applyDocumentedModelPrice,
} from "./supplier-model-pricing";
import { parseSupplierCatalog, parseSupplierPricingChannels } from "@super-canvas/providers";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
const model: ModelDescriptor = {
  id: "new-image",
  name: "new-image（价格以平台为准）",
  operations: [],
  metadata: { canvasRunnable: false },
};

const secureCatalog = (multiplier = 1): SupplierCatalogDiscovery => ({
  kind: "sub2api", status: "live", complete: true, checkedAt: "2026-10-08T11:21:08.582Z",
  groups: parseSupplierPricingChannels({ data: [{ name: "seedance官方token计费模型", platforms: [{ platform: "newtoken-sd",
    groups: [{ id: 37, name: "seedance-官方token版", rate_multiplier: multiplier }],
    supported_models: [{ name: "doubao-seedance-2-0-260128", pricing: { billing_mode: "token", input_price: .0000299,
      output_price: .000029, reference_video_output_price: .0000182, output_price_1080p: null, intervals: [] } }],
  }] }] }, "CNY", { supplierSiteUrl: "https://token.secure-skill.com", checkedAt: "2026-10-08T11:21:08.582Z" }),
});
const secureVideo: ModelDescriptor = { id: "doubao-seedance-2-0-260128", name: "Seedance 2.0", operations: ["video.generate"],
  parameters: [{ key: "resolution", label: "分辨率", control: "select", default: "720p", options: [{ label: "720p", value: "720p" }] }],
};

it.each([
  { field: "weaiLegacyPricing", origin: "https://asian-acc.we-token.cc", path: "/api/v1/model-plaza-legacy/models?group_id=42" },
  { field: "sub2apiPlazaPricing", origin: "https://ai.whyshy.cn", path: "/api/v1/model-plaza" },
])("carries $field conditions from catalog through saved connection and cached enrichment without label parsing or another multiplier", async ({ field, origin, path }) => {
  const group = "actual-image-group", priceAt = "2026-10-08T16:18:29.747Z", scanAt = "2026-10-08T16:20:00.000Z";
  const pricing: NonNullable<ModelDescriptor["pricing"]> = { kind: "tiered", billingUnit: "image", currency: "USD", checkedAt: priceAt,
    sourceUrl: origin + path, confidence: "exact", tiers: [
      { id: "1K-high", label: "1K high", price: .02, conditionMode: "all", conditions: [{ parameter: "resolution", operator: "equals", value: "1K" }, { parameter: "quality", operator: "equals", value: "high" }] },
      { id: "4K-high", label: "4K high", price: .08, conditionMode: "all", conditions: [{ parameter: "resolution", operator: "equals", value: "4K" }, { parameter: "quality", operator: "equals", value: "high" }] },
    ] };
  const unpriced: ModelDescriptor = { id: "gpt-image-2", name: "GPT Image 2", operations: ["image.generate"], outputKinds: ["image"], metadata: { canvasRunnable: false } };
  const lookup: SupplierCatalogDiscovery = { kind: "sub2api", status: "live", complete: true, checkedAt: scanAt,
    groups: [{ id: group, label: group, source: "catalog", details: { source: "model-plaza", rateMultiplier: 7 },
      models: [{ id: unpriced.id, capability: "image", outputKinds: ["image"], priceLabel: "已按官方组倍率报价 · 1K/4K quality conditions",
        metadata: { [field]: pricing } }] }] };
  const fresh = applySupplierCatalogPrices([unpriced], group, lookup, origin)[0]!;
  expect(fresh.pricing).toEqual(pricing);
  expect(fresh.metadata).toMatchObject({ canvasRunnable: false, priceSource: "supplier-catalog", supplierPriceGroup: group, priceCheckedAt: priceAt, priceLastAttemptAt: scanAt });
  expect(modelPriceSummary(fresh, { resolution: "4K", quality: "high" })).toBe("0.08 USD / 张");
  const saved = JSON.parse(JSON.stringify(fresh)) as ModelDescriptor;
  const supplier = { id: `${field}-cached-supplier`, siteUrl: origin, apiUrl: origin, kind: "sub2api", state: { sourceId: `${field}-source` },
    catalog: { groups: lookup.groups }, scanStatus: "live", scanComplete: true, scannedAt: scanAt, updatedAt: scanAt };
  vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
  const reads = vi.mocked(discoverSupplierCatalog).mock.calls.length;
  try {
    const config = { supplierId: supplier.id, supplierSourceId: supplier.state.sourceId, baseUrl: origin, modelGroup: group };
    const cached = await enrichSupplierModelPrices({ config }, [saved], false, false);
    expect(cached[0]?.pricing).toEqual(pricing);
    expect(cached[0]?.metadata?.priceCheckedAt).toBe(priceAt);
    expect(discoverSupplierCatalog).toHaveBeenCalledTimes(reads);
    const partial = applySupplierCatalogPrices(cached, group, { ...lookup, groups: [], complete: false, checkedAt: "2026-10-08T16:30:00.000Z" })[0]!;
    expect(partial.pricing).toEqual(pricing);
    expect(partial.metadata).toMatchObject({ priceStatus: "partial", priceCheckedAt: priceAt, priceLastAttemptAt: "2026-10-08T16:30:00.000Z" });
    expect(modelPriceSummary(partial, { resolution: "4K", quality: "high" })).toBe("上次 0.08 USD / 张");
    const removed = applySupplierCatalogPrices([partial], group, { ...lookup, groups: [], checkedAt: "2026-10-08T16:35:00.000Z" })[0]!;
    expect(removed.pricing).toBeUndefined();
    const manual = { ...saved, metadata: { ...saved.metadata, priceSource: "manual" } };
    expect(applySupplierCatalogPrices([manual], group, lookup)[0]?.pricing).toBe(manual.pricing);
    expect(applySupplierCatalogPrices([saved], "different-group", lookup)[0]?.pricing).toBeUndefined();
    const stale = structuredClone(lookup);
    stale.groups[0]!.models[0]!.metadata = { ...stale.groups[0]!.models[0]!.metadata, supplierCatalogModelStale: true };
    const historical = applySupplierCatalogPrices([unpriced], group, stale)[0]!;
    expect(historical.pricing).toEqual(pricing);
    expect(historical.metadata).toMatchObject({ priceStatus: "partial", priceCheckedAt: priceAt });
    const conflict = structuredClone(lookup);
    conflict.groups[0]!.models[0]!.metadata = { supplierPriceConflict: true };
    const conflicted = applySupplierCatalogPrices([{ ...fresh, metadata: { ...fresh.metadata, [field]: pricing } }], group, conflict)[0]!;
    expect(conflicted.pricing).toBeUndefined();
    expect(conflicted.metadata?.[field]).toBeUndefined();
    const unsupported = structuredClone(lookup);
    unsupported.groups[0]!.models[0]!.metadata = { [`${field}Incomplete`]: true };
    unsupported.groups[0]!.models[0]!.priceLabel = "$0.02/张";
    const pending = applySupplierCatalogPrices([fresh], group, unsupported)[0]!;
    expect(pending.pricing).toBeUndefined();
    expect(pending.metadata).toMatchObject({ priceStatus: "unconfirmed", priceLabel: "价格条件待确认" });
    expect(applySupplierCatalogPrices([manual], group, unsupported)[0]?.pricing).toBe(manual.pricing);
    const recovered = applySupplierCatalogPrices([pending], group, lookup)[0]!;
    expect(recovered.pricing).toEqual(pricing);
    expect(recovered.metadata?.[`${field}Incomplete`]).toBeUndefined();
  } finally { vi.mocked(getSupplierRecord).mockResolvedValue(null); }
});

it("uses the real We-AI legacy discovery before persisting token, cache and image-tier quotes in cached inventory", async () => {
  const fixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/__fixtures__/weai-legacy-price-20261008.json", import.meta.url), "utf8")) as {
    initial: { data: { groups: { id: number; name: string }[] } };
    groups: { groupId: number; payload: unknown }[];
  };
  const actual = await vi.importActual<typeof import("@super-canvas/providers")>("@super-canvas/providers");
  const origin = "https://asian-acc.we-token.cc", requests: string[] = [];
  const discoverFixture = (currency?: string) => actual.discoverSupplierCatalog({ kind: "sub2api", siteUrl: origin, apiUrl: `${origin}/v1` }, async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin).toBe(origin);
    expect(init?.method ?? "GET").toBe("GET");
    requests.push(url.pathname + url.search);
    if (url.pathname === "/api/v1/groups/available") return Response.json({ code: 0, data: fixture.initial.data.groups });
    if (url.pathname === "/api/v1/model-plaza-legacy/models") {
      const id = url.searchParams.get("group_id");
      const payload = id ? fixture.groups.find(group => group.groupId === Number(id))?.payload : fixture.initial;
      if (!payload) return Response.json({ code: 404 }, { status: 404 });
      const copied = structuredClone(payload) as { data: { selected_group_id: number; models: Record<string, unknown>[] } };
      if (currency && copied.data.selected_group_id === 101) copied.data.models[0]!.currency = currency;
      return Response.json(copied);
    }
    return Response.json({ code: 404 }, { status: 404 });
  });
  const discovered = await discoverFixture();
  expect(discovered).toMatchObject({ status: "live", complete: true });
  expect(requests).toContain("/api/v1/model-plaza-legacy/models");
  expect(requests).toContain("/api/v1/model-plaza-legacy/models?group_id=104");
  const reads = vi.mocked(discoverSupplierCatalog).mock.calls.length;
  for (const [groupId, id] of [[101, "gpt-image-2"], [104, "gemini-3-pro-image"], [107, "gpt-image-2"]] as const) {
    const group = discovered.groups.find(item => item.id === `fixture-group-${groupId - 100}`)!;
    const catalogModel = group.models.find(item => item.id === id)!;
    const expected = catalogModel.metadata?.weaiLegacyPricing as ModelDescriptor["pricing"];
    expect(expected?.currency).toBe("USD");
    const models = [{ id, name: id, operations: ["image.generate" as const], outputKinds: ["image" as const] }];
    const current = applySupplierCatalogPrices(models, group.id, discovered, origin)[0]!;
    expect(current.pricing).toEqual(expected);
    const supplier = { id: `actual-weai-${groupId}`, siteUrl: origin, apiUrl: `${origin}/v1`, kind: "sub2api", state: { sourceId: "weai-fixture-source" },
      catalog: { groups: discovered.groups }, scanStatus: "live", scanComplete: true, scannedAt: discovered.checkedAt, updatedAt: discovered.checkedAt };
    vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    try {
      const saved = JSON.parse(JSON.stringify(current)) as ModelDescriptor;
      const cached = await enrichSupplierModelPrices({ config: { supplierId: supplier.id, supplierSourceId: supplier.state.sourceId,
        baseUrl: supplier.apiUrl, modelGroup: group.id } }, [saved], false, false);
      expect(cached[0]?.pricing).toEqual(expected);
      expect(cached[0]?.metadata?.priceCheckedAt).toBe(expected?.checkedAt);
      if (groupId === 101) {
        expect(cached[0]?.pricing).toMatchObject({ kind: "token", inputPerMillion: 3.5, outputPerMillion: 7, imageOutputPerMillion: 21 });
        expect(cached[0]?.pricing?.tiers?.some(tier => tier.id.includes("cache"))).toBe(true);
        expect(modelEstimatedCost(cached[0], { n: 2 })).toBeUndefined();
        for (const currency of ["EUR", "CNY"]) {
          const undecodable = await discoverFixture(currency);
          const pending = applySupplierCatalogPrices(cached, group.id, undecodable, origin)[0]!;
          expect(pending.pricing).toBeUndefined();
          expect(pending.metadata).toMatchObject({ weaiLegacyPricingIncomplete: true, priceStatus: "unconfirmed", priceLabel: "价格条件待确认" });
          const restored = applySupplierCatalogPrices([pending], group.id, discovered, origin)[0]!;
          expect(restored.pricing).toEqual(expected);
          expect(restored.metadata?.weaiLegacyPricingIncomplete).toBeUndefined();
        }
      } else {
        expect(cached[0]?.pricing).toMatchObject({ kind: "per-request", billingUnit: "request" });
        expect(cached[0]?.pricing?.tiers).toHaveLength(3);
        const parameters = groupId === 104 ? { resolution: "4K" } : { quality: "high" };
        expect(modelPriceSummary(cached[0], parameters)).toBe(groupId === 104 ? "0.1 USD / 次" : "0.15 USD / 次");
        expect(modelEstimatedCost(cached[0], { ...parameters, n: 2 })).toBe(groupId === 104 ? "0.2 USD" : "0.3 USD");
      }
    } finally { vi.mocked(getSupplierRecord).mockResolvedValue(null); }
  }
  expect(discoverSupplierCatalog).toHaveBeenCalledTimes(reads);
});

it("parses pDog's exact official resolution intervals before saved cached pricing and never borrows another group", async () => {
  const group = "【生图】image2/2.5-1K", origin = "https://ai.whyshy.cn", checkedAt = "2026-10-08T16:18:29.747Z";
  const parsed = parseSupplierCatalog({ code: 0, data: { groups: [{ id: 4, name: group, rate_multiplier: 1, peak_rate_enabled: false,
    image_rate_independent: false, image_rate_multiplier: 1, models: [{ name: "gpt-image-2", platform: "openai", pricing: {
      billing_mode: "image", input_price: .000005, output_price: .00001, cache_write_price: 0, cache_read_price: .00000125,
      per_request_price: .02, intervals: ["1K", "2K", "4K"].map(tier_label => ({ min_tokens: 0, max_tokens: null, tier_label, per_request_price: .02 })),
    } }] }] } }, { supplierSiteUrl: origin, checkedAt });
  const lookup: SupplierCatalogDiscovery = { ...parsed, status: "live", complete: true, checkedAt };
  const keyModel: ModelDescriptor = { id: "gpt-image-2", name: "GPT Image 2", operations: ["image.generate"], outputKinds: ["image"] };
  const fresh = applySupplierCatalogPrices([keyModel], group, lookup, origin)[0]!;
  expect(fresh.pricing).toMatchObject({ kind: "tiered", currency: "USD", billingUnit: "image", tiers: [{ price: .02 }, { price: .02 }, { price: .02 }] });
  expect(fresh.pricing?.sourceUrl).toBe(`${origin}/api/v1/model-plaza`);
  expect(modelPriceSummary(fresh, { resolution: "4K" })).toBe("0.02 USD / 张");
  const unsupported = structuredClone(lookup);
  unsupported.groups[0]!.models[0]!.metadata = { sub2apiPlazaPricingIncomplete: true };
  unsupported.groups[0]!.models[0]!.priceLabel = "$0.02/张";
  const pending = applySupplierCatalogPrices([fresh], group, unsupported, origin)[0]!;
  expect(pending.pricing).toBeUndefined();
  expect(pending.metadata).toMatchObject({ priceStatus: "unconfirmed", priceLabel: "价格条件待确认" });
  expect(modelEstimatedCost(pending, { resolution: "4K", n: 2 })).toBeUndefined();
  unsupported.groups[0]!.models[0]!.metadata = { ...unsupported.groups[0]!.models[0]!.metadata, supplierCatalogModelStale: true };
  expect(applySupplierCatalogPrices([fresh], group, unsupported, origin)[0]?.pricing).toBeUndefined();
  const restored = applySupplierCatalogPrices([pending], group, lookup, origin)[0]!;
  expect(restored.pricing).toEqual(fresh.pricing);
  expect(restored.metadata?.sub2apiPlazaPricingIncomplete).toBeUndefined();
  const supplier = { id: "actual-pdog", siteUrl: origin, apiUrl: origin, kind: "sub2api", state: { sourceId: "pdog-fixture-source" },
    catalog: { groups: lookup.groups }, scanStatus: "live", scanComplete: true, scannedAt: checkedAt, updatedAt: checkedAt };
  vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
  const reads = vi.mocked(discoverSupplierCatalog).mock.calls.length;
  try {
    const saved = JSON.parse(JSON.stringify(fresh)) as ModelDescriptor;
    const cached = await enrichSupplierModelPrices({ config: { supplierId: supplier.id, supplierSourceId: supplier.state.sourceId,
      baseUrl: origin, modelGroup: group } }, [saved], false, false);
    expect(cached[0]?.pricing).toEqual(saved.pricing);
    expect(modelPriceSummary(cached[0], { resolution: "2K" })).toBe("0.02 USD / 张");
    expect(discoverSupplierCatalog).toHaveBeenCalledTimes(reads);
    expect(applySupplierCatalogPrices([keyModel], "【生图】image2/2.5-2K4K(原生)", lookup)[0]?.pricing).toBeUndefined();
  } finally { vi.mocked(getSupplierRecord).mockResolvedValue(null); }
});

it("opening cached inventory cannot replace a newer same-group quote with the old supplier directory", async () => {
  const group = "sd2.5特价分组-2";
  const siteUrl = "https://token.secure-skill.com";
  const supplier = { id: "saved-secure", siteUrl, apiUrl: `${siteUrl}/v1`, kind: "sub2api", scanStatus: "live", scanComplete: true,
    state: { sourceId: "current-source" }, scannedAt: "2026-10-08T11:26:22.084Z", updatedAt: "2026-10-08T11:26:22.084Z",
    catalog: { groups: [{ id: group, label: group, models: [{ id: "seedance-2.5", capability: "video" }] }] } };
  const saved: ModelDescriptor = { id: "seedance-2.5", name: "seedance-2.5", operations: ["video.generate"],
    metadata: { catalogGroup: group, priceSource: "supplier-catalog", priceStatus: "available",
      priceLabel: "480p ¥0.4/秒 · 720p ¥0.62/秒 · 1080p ¥1.45/秒", priceCheckedAt: "2026-10-08T14:30:53.685Z" } };
  vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
  const reads = vi.mocked(discoverSupplierCatalog).mock.calls.length;
  try {
    const result = await enrichSupplierModelPrices({ config: { supplierId: supplier.id, supplierSourceId: "current-source",
      baseUrl: supplier.apiUrl, modelGroup: group } }, [saved], false, false);
    expect(result[0]?.metadata).toEqual(saved.metadata);
    expect(discoverSupplierCatalog).toHaveBeenCalledTimes(reads);
  } finally { vi.mocked(getSupplierRecord).mockResolvedValue(null); }
});

it("snapshot age protection is group scoped and still accepts authoritative newer price removal", () => {
  const current = secureCatalog();
  const priced = applySupplierCatalogPrices([secureVideo], "seedance-官方token版", current)[0]!;
  const older: SupplierCatalogDiscovery = { ...current, checkedAt: "2026-10-08T10:00:00Z", groups: [] };
  expect(applySupplierCatalogPrices([priced], "seedance-官方token版", older, undefined, { savedCatalog: true })[0]).toBe(priced);
  expect(applySupplierCatalogPrices([priced], "other-group", older, undefined, { savedCatalog: true })[0]?.pricing).toBeUndefined();
  const removed: SupplierCatalogDiscovery = { ...older, checkedAt: "2026-10-08T15:00:00Z" };
  expect(applySupplierCatalogPrices([priced], "seedance-官方token版", removed, undefined, { savedCatalog: true })[0]?.pricing).toBeUndefined();
  // Explicit online refresh remains authoritative even with an older supplied timestamp.
  expect(applySupplierCatalogPrices([priced], "seedance-官方token版", older)[0]?.pricing).toBeUndefined();
});

it("retained account-group quotes stay historical and keep their own checked time", () => {
  const group = "private-video";
  const oldAt = "2026-10-08T11:26:00Z", attemptAt = "2026-10-08T15:00:00Z";
  const lookup: SupplierCatalogDiscovery = { kind: "sub2api", status: "live", complete: true, checkedAt: attemptAt,
    groups: [{ id: group, label: group, source: "catalog", details: { source: "key-groups", stale: true },
      models: [{ id: "seedance-2.5", capability: "video", priceLabel: "¥5.5/请求",
        metadata: { supplierCatalogModelStale: true, supplierCatalogPriceCheckedAt: oldAt } }] }] };
  const unpriced: ModelDescriptor = { id: "seedance-2.5", name: "Seedance", operations: ["video.generate"] };
  const historical = applySupplierCatalogPrices([unpriced], group, lookup)[0]!;
  expect(historical.metadata).toMatchObject({ priceStatus: "partial", priceCheckedAt: oldAt, priceLastAttemptAt: attemptAt,
    priceLabel: "¥5.5/请求（上次价格）" });
  expect(historical.pricing?.checkedAt).toBe(oldAt);
  expect(modelPriceSummary(historical, {})).toBe("上次 5.5 CNY / 次");
  expect(modelEstimatedCost(historical, {})).toBeUndefined();
  const connectionQuote = { ...historical, pricing: { ...historical.pricing!, unitAmount: 4.8, checkedAt: "2026-10-08T14:00:00Z" },
    metadata: { ...historical.metadata, priceLabel: "¥4.8/请求", priceCheckedAt: "2026-10-08T14:00:00Z", priceStatus: "available" } };
  expect(applySupplierCatalogPrices([connectionQuote], group, lookup)[0]!.metadata).toMatchObject({
    priceLabel: "¥4.8/请求（上次价格）", priceCheckedAt: "2026-10-08T14:00:00Z", priceStatus: "partial" });
  const fresh = structuredClone(lookup);
  fresh.groups[0]!.details = { source: "model-plaza" };
  fresh.groups[0]!.models[0]!.metadata = {};
  fresh.groups[0]!.models[0]!.priceLabel = "¥6/请求";
  expect(applySupplierCatalogPrices([historical], group, fresh)[0]!.metadata).toMatchObject({
    priceLabel: "¥6/请求", priceStatus: "available", priceCheckedAt: attemptAt });
});

it("persists exact supplier token conditions and shows compact rates without inventing task totals", () => {
  const enriched = applySupplierCatalogPrices([secureVideo], "seedance-官方token版", secureCatalog())[0]!;
  const saved = JSON.parse(JSON.stringify(enriched)) as ModelDescriptor;
  expect(saved.pricing).toMatchObject({ kind: "token", currency: "CNY", tiers: [{ price: 29.9 }, { price: 29 }, { price: 18.2 }] });
  expect(saved.metadata?.priceStatus).toBe("available");
  expect(saved.metadata?.priceLabel).toContain("输入 ¥29.9/1M tokens");
  expect(modelPriceSummary(saved, { resolution: "720p", has_reference_video: false })).toBe("720p · 不含参考视频 ¥29/1M tokens");
  expect(modelPriceSummary(saved, { resolution: "720p", has_reference_video: true })).toBe("720p · 含参考视频 ¥18.2/1M tokens");
  expect(modelPriceSummary(saved, { duration: 15 })).toBe("720p · 输出 ¥18.2–29/1M tokens（参考视频条件未确认）");
  expect(modelPriceSummary(saved, { resolution: "1080p", has_reference_video: false })).toBe("当前分辨率/参考视频组合未报价（按 token 计费）");
  expect(modelPriceSummary({ ...saved, parameters: [] }, {})).toBe("输出 ¥18.2–29/1M tokens（分辨率未确认，参考视频条件未确认）");
  for (const parameters of [{ duration: 15, n: 3 }, { duration: 15, resolution: "720p", has_reference_video: true, token_kind: "output" }]) {
    expect(modelEstimatedCost(saved, parameters)).toBeUndefined();
  }
  expect(applySupplierCatalogPrices([secureVideo], "doubao-full", secureCatalog())[0]?.pricing).toBeUndefined();
  expect(applySupplierCatalogPrices([{ ...secureVideo, id: "doubao-seedance-2-0-260128-preview" }], "seedance-官方token版", secureCatalog())[0]?.pricing).toBeUndefined();
});

it("refreshes imported conditional token rates without overwriting a user's explicit price", () => {
  const old = applySupplierCatalogPrices([secureVideo], "seedance-官方token版", secureCatalog())[0]!;
  const refreshed = applySupplierCatalogPrices([old], "seedance-官方token版", secureCatalog(.5))[0]!;
  expect(refreshed.pricing?.tiers?.map(tier => tier.price)).toEqual([14.95,14.5,9.1]);
  expect(modelPriceSummary(refreshed, { has_reference_video: true })).toBe("720p · 含参考视频 ¥9.1/1M tokens");
  const manual = { ...old, metadata: { ...old.metadata, priceSource: "manual" } };
  expect(applySupplierCatalogPrices([manual], "seedance-官方token版", secureCatalog(.5))[0]?.pricing).toBe(manual.pricing);
  const removed = secureCatalog();
  removed.groups[0]!.models[0]!.priceLabel = undefined;
  removed.groups[0]!.models[0]!.metadata = {};
  const cleared = applySupplierCatalogPrices([old], "seedance-官方token版", removed)[0]!;
  expect(cleared.pricing).toBeUndefined();
  expect(cleared.metadata?.priceLabel).toBe("价格未公布");
  const partial = applySupplierCatalogPrices([old], "seedance-官方token版", { ...removed, complete: false })[0]!;
  expect(partial.pricing).toBe(old.pricing);
  expect(partial.metadata?.priceLabel).toContain("上次价格");
  expect(modelPriceSummary(partial, { has_reference_video: true })).toBe("上次 720p · 含参考视频 ¥18.2/1M tokens");
});

it("clears conflicting imported prices before conditional fallback and recovers on fresh agreement", () => {
  const old = applySupplierCatalogPrices([secureVideo], "seedance-官方token版", secureCatalog())[0]!;
  const lookup = secureCatalog();
  const current = lookup.groups[0]!.models[0]!;
  current.priceLabel = "价格存在冲突，待确认";
  current.metadata = { supplierPriceConflict: true, supplierPriceAlternatives: [{ label: "720p ¥29/1M tokens", channel: "A" }, { label: "720p ¥30/1M tokens", channel: "B" }] };
  const conflicted = applySupplierCatalogPrices([old], "seedance-官方token版", lookup)[0]!;
  expect(conflicted.pricing).toBeUndefined();
  expect(conflicted.metadata).toMatchObject({ supplierPriceConflict: true, priceStatus: "conflict", priceLabel: "价格存在冲突，待确认" });
  expect(modelPriceSummary(conflicted, {})).toBe("价格存在冲突，待确认");
  expect(modelEstimatedCost(conflicted, { duration: 10 })).toBeUndefined();
  const resolved = applySupplierCatalogPrices([conflicted], "seedance-官方token版", secureCatalog())[0]!;
  expect(resolved.metadata?.supplierPriceConflict).toBeUndefined();
  expect(resolved.metadata?.supplierPriceAlternatives).toBeUndefined();
  expect(resolved.pricing?.tiers?.map(tier => tier.price)).toEqual([29.9,29,18.2]);
});

it("retains Chuangxiang's structured resolution prices through saved-model enrichment and video binding", () => {
  const parsed = parseSupplierCatalog({ data: { groups: [{ name: "视频", models: [{ name: "sd10-seedance-2.0", effective_rate_multiplier: .1,
    video_pricing: { billing_mode: "per_request", prices: { "720p": 52 } } }] }] } }, { supplierSiteUrl: "https://vapi.chuangxiangai.asia", checkedAt: "2026-10-07" });
  const enriched = applySupplierCatalogPrices([{ id: "sd10-seedance-2.0", name: "SD10", operations: ["video.generate"], metadata: { canvasRunnable: true } }], "视频",
    { groups: parsed.groups, kind: "sub2api", status: "live", checkedAt: "2026-10-07" });
  const bound = bindScannedModelProtocols({ provider: "rest", config: { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "视频" } }, enriched).models[0]!;
  expect(modelPriceSummary(bound, { resolution: "720p", duration: 15 })).toBe("5.2 CNY / 次（参考）");
  expect(bound.parameters?.find(p => p.key === "resolution")?.options).toEqual([{ label: "720p", value: "720p" }]);
  expect(bound.parameters?.find(p => p.key === "duration")?.options?.map(o => o.value)).toEqual([5, 10, 15]);
});
it("imports explicit video seconds from the exact group's already multiplied catalog price", () => {
  const parsed = parseSupplierCatalog({ currency: "CNY", group_ratio: { default: .5, vip: 2 }, data: [
    { model_name: "future-video", quota_type: 1, model_price: .24, request_unit: "second", enable_groups: ["default", "vip"] },
  ] });
  const lookup: SupplierCatalogDiscovery = { ...parsed, status: "live", complete: true, checkedAt: "2026-10-08" };
  const video: ModelDescriptor = { id: "future-video", name: "Future video", operations: ["video.generate"] };
  const current = applySupplierCatalogPrices([video], "default", lookup, "https://supplier.invalid")[0]!;
  expect(current.pricing).toEqual({ kind: "per-second", currency: "CNY", unitAmount: .12, billingUnit: "second", checkedAt: "2026-10-08", sourceUrl: "https://supplier.invalid", confidence: "exact" });
  expect(modelPriceSummary(current, { duration: 10 })).toBe("0.12 CNY / 秒");
  expect(modelEstimatedCost(current, { duration: 10, n: 2 })).toBe("2.4 CNY");
  expect(modelEstimatedCost(current, {})).toBeUndefined();
  expect(modelEstimatedCost(current, { duration: 0 })).toBeUndefined();
  expect(modelEstimatedCost({ ...current, metadata: { ...current.metadata, billingIncludesInputDuration: true } }, { duration: 10 })).toBeUndefined();
  expect(applySupplierCatalogPrices([video], "vip", lookup)[0]?.pricing?.unitAmount).toBe(.48);
  expect(applySupplierCatalogPrices([video], "missing", lookup)[0]?.pricing).toBeUndefined();
  expect(applySupplierCatalogPrices([{ ...video, id: "future-video-fast" }], "default", lookup)[0]?.pricing).toBeUndefined();
});
it("does not flatten conditional, tiered, token or unpriced video labels into a second rate", () => {
  const video: ModelDescriptor = { id: "future-video", name: "Future video", operations: ["video.generate"] };
  for (const priceLabel of ["720p ¥0.12/秒", "¥0.12/秒起", "¥0.12/秒 · 1080p ¥0.24/秒", "¥0.12/秒（无参考视频）", "¥0.12/1M token", "0.12/秒（币种未注明）", "¥0.12/秒/张", "¥0.12/秒；¥0.24/秒", "价格未公布"]) {
    const lookup: SupplierCatalogDiscovery = { kind: "sub2api", status: "live", checkedAt: "now", groups: [
      { id: "video", label: "Video", source: "catalog", models: [{ id: video.id, capability: "video", priceLabel }] },
    ] };
    const result = applySupplierCatalogPrices([video], "video", lookup)[0]!;
    expect(result.pricing, priceLabel).toBeUndefined();
    expect(result.metadata?.priceLabel).toBe(priceLabel);
    expect(modelEstimatedCost(result, { duration: 10 })).toBeUndefined();
    const conditional: ModelDescriptor = { ...video, pricing: { kind: "tiered", currency: "CNY", billingUnit: "second", confidence: "exact", checkedAt: "old", tiers: [
      { id: "720p", label: "720p", price: .2, conditions: [{ parameter: "resolution", operator: "equals", value: "720p" }] },
      { id: "fallback", label: "Fallback", price: .3, otherwise: true },
    ] } };
    expect(applySupplierCatalogPrices([conditional], "video", lookup)[0]?.pricing).toBe(conditional.pricing);
  }
});
it("keeps explicit second-rate currencies and preserves the meaning of a declared zero rate", () => {
  const video: ModelDescriptor = { id: "future-video", name: "Future video", operations: ["video.generate"] };
  for (const [priceLabel, currency, amount] of [["$0.25/秒", "USD", .25], ["0.25 USD/秒", "USD", .25], ["0.25 RMB/秒", "CNY", .25], ["¥0/秒", "CNY", 0]] as const) {
    const lookup: SupplierCatalogDiscovery = { kind: "sub2api", status: "live", checkedAt: "now", groups: [
      { id: "video", label: "Video", source: "catalog", models: [{ id: video.id, capability: "video", priceLabel }] },
    ] };
    const result = applySupplierCatalogPrices([video], "video", lookup)[0]!;
    expect(result.pricing).toMatchObject({ kind: "per-second", billingUnit: "second", currency, unitAmount: amount });
    expect(modelEstimatedCost(result, { duration: 4 })).toBe(`${amount * 4} ${currency}`);
  }
});
const catalog: SupplierCatalogDiscovery = {
  kind: "newapi",
  status: "live",
  checkedAt: "now",
  groups: [
    {
      id: "cheap",
      label: "cheap",
      source: "catalog",
      models: [
        { id: "new-image", capability: "image", priceLabel: "$0.02/张" },
      ],
    },
    {
      id: "expensive",
      label: "expensive",
      source: "catalog",
      models: [{ id: "new-image", capability: "image", priceLabel: "$0.2/张" }],
    },
  ],
};

const mikotoHighQualityGroup = "生图（2k4k 高质量）";
const mikotoHighQualityLines = [
  "image2 0.1一张 能高质量",
  "image2.5 flare 0.13一张 支持五档质量",
  "image2.5 sub 0.16一张 支持五档质量",
];
const mikotoHighQualityCatalog: SupplierCatalogDiscovery = {
  kind: "newapi",
  status: "live",
  complete: true,
  checkedAt: "2026-10-01T00:00:00Z",
  groups: [{
    id: mikotoHighQualityGroup,
    label: mikotoHighQualityGroup,
    source: "catalog",
    models: [],
    details: {
      source: "key-groups",
      description: mikotoHighQualityLines.join("\n"),
      referencePrice: mikotoHighQualityLines.join("；"),
      supportedResolutions: ["2K", "4K"],
      imagePrices: [{ resolution: "2K", amount: 0.1 }, { resolution: "4K", amount: 0.1 }],
    },
  }],
};
const mikotoImageModel = (id: string): ModelDescriptor => ({
  id,
  name: id,
  operations: ["image.generate", "image.edit"],
  metadata: { priceSource: "supplier-catalog", priceLabel: "价格未公布" },
});
const mikotoHighQualityModels = ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].map(mikotoImageModel);
const withLegacyMikotoGroupPrice = (item: ModelDescriptor): ModelDescriptor => ({
  ...item,
  pricing: { kind: "tiered", currency: "credits", checkedAt: "2026-09-21T00:00:00Z", confidence: "exact",
    tiers: [{ id: "2K", label: "2K · 后台额度/张", dimension: "resolution", value: "2K", price: 0.1 },
      { id: "4K", label: "4K · 后台额度/张", dimension: "resolution", value: "4K", price: 0.1 }] },
  metadata: { ...item.metadata, priceSource: "supplier-group", priceLabel: mikotoHighQualityLines.join("；") + "（分组说明参考）" },
});

describe("universal supplier price lookup", () => {
  it.each([true, false])("scopes Gemini prices to complete model IDs and repairs shared cached prices when completeness is %s", complete => {
    const ids = ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"];
    const quotes = ["gemini-3.1-flash-image-preview 0.065/张", "gemini-3-pro-image-preview 0.085/张"];
    const geminiCatalog: SupplierCatalogDiscovery = {
      kind: "sub2api", status: "live", complete, checkedAt: "2026-10-01T00:00:00Z",
      groups: [{ id: "gemini生图", label: "gemini生图", source: "catalog", models: [], details: {
        source: "key-groups", description: [...quotes, "1k2k4k一个价"].join("\n"), referencePrice: quotes.join("；"),
        imagePrices: ["1K", "2K", "4K"].map(resolution => ({ resolution, amount: 0.065 })),
      } }],
    };
    const cached = ids.map<ModelDescriptor>(id => ({ ...mikotoImageModel(id),
      pricing: { kind: "tiered", currency: "credits", checkedAt: "2026-09-21T00:00:00Z", confidence: "exact",
        tiers: [{ id: "4K", label: "4K · 后台额度/张", dimension: "resolution", value: "4K", price: 0.065 }] },
      metadata: { priceSource: "supplier-group", priceLabel: quotes.join("；") + "（分组说明参考）" },
    }));
    const results = applySupplierCatalogPrices(cached, "gemini生图", geminiCatalog);
    for (const [index, result] of results.entries()) {
      expect(result.pricing).toBeUndefined();
      expect(result.metadata).toMatchObject({ priceSource: "supplier-group", priceStatus: "available" });
      expect(result.metadata?.priceLabel).toContain(quotes[index]);
      expect(result.metadata?.priceLabel).not.toContain(quotes[1 - index]);
      expect(modelPriceSummary(result, { size_tier: "4K" })).toBe(result.metadata?.priceLabel);
      expect(modelPriceSummary(result, { size_tier: "4K" })).not.toContain("credits");
    }
  });
  it.each(["\n", " "])("scopes arbitrary future image model declarations with separator %j and keeps suffixes exact", separator => {
    const ids = ["future-image-v99", "future-image-v99-pro", "future-image-v99-pro-fast"];
    const quotes = ["future-image-v99 0.11/张", "future-image-v99-pro 0.22/张"];
    const futureCatalog: SupplierCatalogDiscovery = {
      kind: "sub2api", status: "live", complete: false, checkedAt: "2026-10-01T00:00:00Z",
      groups: [{ id: "future-images", label: "future-images", source: "catalog", models: [], details: {
        source: "key-groups", description: quotes.join(separator), referencePrice: quotes.join("；"),
        imagePrices: [{ resolution: "4K", amount: 0.11 }],
      } }],
    };
    const cached = ids.map<ModelDescriptor>(id => ({ ...mikotoImageModel(id),
      pricing: { kind: "tiered", currency: "credits", checkedAt: "2026-09-21T00:00:00Z", confidence: "exact",
        tiers: [{ id: "4K", label: "4K · 后台额度/张", dimension: "resolution", value: "4K", price: 0.11 }] },
      metadata: { priceSource: "supplier-group", priceLabel: quotes.join("；") + "（分组说明参考）" },
    }));
    const results = applySupplierCatalogPrices(cached, "future-images", futureCatalog);
    for (const [index, quote] of quotes.entries()) {
      const result = results[index]!;
      expect(result.pricing).toBeUndefined();
      expect(result.metadata?.priceLabel).toContain(quote);
      expect(result.metadata?.priceLabel).not.toContain(quotes[1 - index]);
      expect(modelPriceSummary(result, { size_tier: "4K" })).toBe(result.metadata?.priceLabel);
    }
    expect(results[2]?.pricing).toBeUndefined();
    expect(results[2]?.metadata?.priceLabel).toBe("价格未公布");
    expect(modelPriceSummary(results[2], { size_tier: "4K" })).toBe("价格目录未完整读取");
  });
  it("recognizes catalog model IDs so a future pro declaration cannot price a base-only inventory", () => {
    const futureCatalog: SupplierCatalogDiscovery = {
      kind: "newapi", status: "live", complete: true, checkedAt: "2026-10-01T00:00:00Z",
      groups: [{ id: "future-images", label: "future-images", source: "catalog",
        models: [{ id: "future-image-v99-pro", capability: "image" }], details: {
          source: "key-groups", description: "future-image-v99-pro 0.22/张",
          imagePrices: [{ resolution: "4K", amount: 0.22 }],
        } }],
    };
    const result = applySupplierCatalogPrices([mikotoImageModel("future-image-v99")], "future-images", futureCatalog)[0]!;
    expect(result.pricing).toBeUndefined();
    expect(result.metadata?.priceLabel).toBe("价格未公布");
    expect(result.metadata?.priceLabel).not.toContain("0.22");
  });
  it("quotes each Mikoto image model from its own declaration instead of the shared 0.1 credits field", () => {
    const results = applySupplierCatalogPrices(mikotoHighQualityModels, mikotoHighQualityGroup, mikotoHighQualityCatalog);
    for (const [index, result] of results.entries()) {
      expect(result.pricing).toBeUndefined(); // The declaration does not specify a currency.
      expect(result.metadata).toMatchObject({ priceSource: "supplier-group", priceStatus: "available" });
      expect(result.metadata?.priceLabel).toContain(mikotoHighQualityLines[index]);
      expect(result.metadata?.priceLabel).toContain("分组说明参考");
      for (const other of mikotoHighQualityLines.filter((_, otherIndex) => otherIndex !== index))
        expect(result.metadata?.priceLabel).not.toContain(other);
      for (const size_tier of ["2K", "4K"]) {
        const quote = modelPriceSummary(result, { size_tier, quality: index === 0 ? "high" : "max" });
        expect(quote).toBe(result.metadata?.priceLabel);
        expect(quote).not.toContain("额度");
        expect(quote).not.toContain("credits");
      }
    }
  });
  it.each([true, false])("repairs saved Mikoto group pricing during cached enrichment without another catalog read when completeness is %s", async scanComplete => {
    const cached = mikotoHighQualityModels.map(withLegacyMikotoGroupPrice);
    const supplier = { id: "mikoto-cached-model-prices", apiUrl: "https://api.mikoto.vip", siteUrl: "https://api.mikoto.vip", kind: "newapi",
      state: { sourceId: "mikoto-price-source" }, catalog: { groups: mikotoHighQualityCatalog.groups },
      scanStatus: "live", scanComplete, scannedAt: mikotoHighQualityCatalog.checkedAt, updatedAt: mikotoHighQualityCatalog.checkedAt };
    vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    const count = vi.mocked(discoverSupplierCatalog).mock.calls.length;
    try {
      const results = await enrichSupplierModelPrices({ config: { supplierId: supplier.id, supplierSourceId: "mikoto-price-source",
        baseUrl: supplier.apiUrl, modelGroup: mikotoHighQualityGroup } }, cached, false, false);
      expect(discoverSupplierCatalog).toHaveBeenCalledTimes(count);
      for (const [index, result] of results.entries()) {
        expect(result.pricing).toBeUndefined();
        expect(result.metadata?.priceLabel).toContain(mikotoHighQualityLines[index]);
        expect(modelPriceSummary(result, { size_tier: "4K", quality: "max" })).toBe(result.metadata?.priceLabel);
        for (const other of mikotoHighQualityLines.filter((_, otherIndex) => otherIndex !== index))
          expect(result.metadata?.priceLabel).not.toContain(other);
      }
    } finally {
      vi.mocked(getSupplierRecord).mockResolvedValue(null);
    }
  });
  it("keeps exact catalog and model API prices ahead of Mikoto model-specific group wording", () => {
    const exactCatalog = { ...mikotoHighQualityCatalog, groups: [{ ...mikotoHighQualityCatalog.groups[0]!,
      models: [{ id: "gpt-image-2.5-sunburst", capability: "image" as const, priceLabel: "$0.25/张" }] }] };
    const modelApi = { ...mikotoImageModel("gpt-image-2.5-flare"),
      pricing: { kind: "per-image" as const, currency: "CNY", unitAmount: 0.24, checkedAt: "2026-10-01T00:00:00Z", confidence: "exact" as const },
      metadata: { priceSource: "model-api", priceLabel: "¥0.24/张" } };
    const results = applySupplierCatalogPrices([mikotoImageModel("gpt-image-2.5-sunburst"), modelApi], mikotoHighQualityGroup, exactCatalog);
    expect(modelPriceSummary(results[0], { size_tier: "4K", quality: "max" })).toBe("0.25 USD / 张");
    expect(results[0]?.metadata?.priceSource).toBe("supplier-catalog");
    expect(modelPriceSummary(results[1], { size_tier: "4K", quality: "max" })).toBe("0.24 CNY / 张");
    expect(results[1]?.metadata?.priceSource).toBe("model-api");
  });
  it.each(["gpt-image-2-high", "gpt-image-2.5-flare-fast", "gpt-image-2.5-sunburst-custom"])("does not lend a Mikoto declaration to suffixed model %s", id => {
    const result = applySupplierCatalogPrices([mikotoImageModel(id)], mikotoHighQualityGroup, mikotoHighQualityCatalog)[0]!;
    expect(result.pricing).toBeUndefined();
    for (const line of mikotoHighQualityLines) expect(result.metadata?.priceLabel).not.toContain(line);
    expect(result.metadata?.priceLabel).toBe("价格未公布");
  });
  it("does not treat stale Mikoto group declarations as new model prices", () => {
    const staleCatalog = { ...mikotoHighQualityCatalog, groups: [{ ...mikotoHighQualityCatalog.groups[0]!,
      details: { ...mikotoHighQualityCatalog.groups[0]!.details!, stale: true } }] };
    const results = applySupplierCatalogPrices(mikotoHighQualityModels, mikotoHighQualityGroup, staleCatalog);
    for (const result of results) {
      expect(result.pricing).toBeUndefined();
      expect(result.metadata).toMatchObject({ priceLabel: "价格未公布", priceStatus: "unpublished", supplierGroupInfoStale: true });
    }
  });
  it.each([true, false])("clears legacy shared Mikoto prices from suffixed models when catalog completeness is %s", complete => {
    const cached = ["gpt-image-2-high", "gpt-image-2.5-flare-fast", "gpt-image-2.5-sunburst-custom"]
      .map(mikotoImageModel).map(withLegacyMikotoGroupPrice);
    const results = applySupplierCatalogPrices(cached, mikotoHighQualityGroup, { ...mikotoHighQualityCatalog, complete });
    for (const result of results) {
      expect(result.pricing).toBeUndefined();
      expect(result.metadata?.priceLabel).toBe("价格未公布");
      expect(modelPriceSummary(result, { size_tier: "4K", quality: "max" })).toBe(complete ? "暂未取得报价" : "价格目录未完整读取");
      expect(result.metadata?.priceLabel).not.toContain("上次价格");
      for (const line of mikotoHighQualityLines) expect(result.metadata?.priceLabel).not.toContain(line);
    }
  });
  it.each([true, false])("clears legacy shared Mikoto prices from canonical models when group declarations are stale and catalog completeness is %s", complete => {
    const staleCatalog = { ...mikotoHighQualityCatalog, complete, groups: [{ ...mikotoHighQualityCatalog.groups[0]!,
      details: { ...mikotoHighQualityCatalog.groups[0]!.details!, stale: true } }] };
    const results = applySupplierCatalogPrices(mikotoHighQualityModels.map(withLegacyMikotoGroupPrice), mikotoHighQualityGroup, staleCatalog);
    for (const result of results) {
      expect(result.pricing).toBeUndefined();
      expect(result.metadata).toMatchObject({ priceLabel: "价格未公布", supplierGroupInfoStale: true });
      expect(modelPriceSummary(result, { size_tier: "4K", quality: "max" })).toBe(complete ? "暂未取得报价" : "价格目录未完整读取");
      expect(result.metadata?.priceLabel).not.toContain("上次价格");
      for (const line of mikotoHighQualityLines) expect(result.metadata?.priceLabel).not.toContain(line);
    }
  });
  it("refreshes catalog-owned interface evidence while protecting manual and model API fields", () => {
    const lookup = (endpoint: string, document: string, checkedAt = "2026-09-01T00:00:00Z") => ({ ...catalog, checkedAt,
      groups: [{ ...catalog.groups[0]!, models: [{ id: model.id, capability: "image" as const, metadata: { endpointTypes: [endpoint], documentationUrl: document } }] }] });
    const first = applySupplierCatalogPrices([model], "cheap", lookup("/old", "https://site.invalid/old.json"))[0]!;
    expect(first.metadata).toMatchObject({ endpointTypes: ["/old"], supplierCatalogEndpointTypes: ["/old"], supplierCatalogDocumentationUrl: "https://site.invalid/old.json" });
    const second = applySupplierCatalogPrices([first], "cheap", lookup("/new", "https://site.invalid/new.json", "2026-10-01T00:00:00Z"))[0]!;
    expect(second.metadata).toMatchObject({ endpointTypes: ["/new"], documentationUrl: "https://site.invalid/new.json", supplierCatalogCheckedAt: "2026-10-01T00:00:00Z", supplierCatalogInterfaceStale: false });
    const manual = { ...first, metadata: { ...first.metadata, endpointTypes: ["/manual"], documentationUrl: "https://site.invalid/manual.json" } };
    const protectedModel = applySupplierCatalogPrices([manual], "cheap", lookup("/new", "https://site.invalid/new.json"))[0]!;
    expect(protectedModel.metadata).toMatchObject({ endpointTypes: ["/manual"], documentationUrl: "https://site.invalid/manual.json" });
    expect(protectedModel.metadata?.supplierCatalogEndpointTypes).toBeUndefined();
    const mutated = structuredClone(first);
    (mutated.metadata!.endpointTypes as string[]).push("/manual-added");
    expect(applySupplierCatalogPrices([mutated], "cheap", lookup("/new", "https://site.invalid/new.json"))[0]?.metadata?.endpointTypes).toEqual(["/old", "/manual-added"]);
    const native = { ...model, metadata: { modelFactsSource: "model-api", endpointTypes: ["/native"], documentationUrl: "https://site.invalid/native.json" } };
    expect(applySupplierCatalogPrices([native], "cheap", lookup("/new", "https://site.invalid/new.json"))[0]?.metadata).toMatchObject(native.metadata);
  });
  it("removes withdrawn catalog fields only after a complete nonstale catalog row", () => {
    const initial = { ...catalog, groups: [{ ...catalog.groups[0]!, models: [{ id: model.id, capability: "image" as const, metadata: { endpointTypes: ["/old"], documentationUrl: "https://site.invalid/old.json" } }] }] };
    const first = applySupplierCatalogPrices([model], "cheap", initial)[0]!;
    const missing = { ...catalog, groups: [{ ...catalog.groups[0]!, models: [{ id: model.id, capability: "image" as const }] }] };
    const partial = applySupplierCatalogPrices([first], "cheap", { ...missing, complete: false })[0]!;
    expect(partial.metadata).toMatchObject({ endpointTypes: ["/old"], documentationUrl: "https://site.invalid/old.json", supplierCatalogInterfaceStale: true });
    const stale = applySupplierCatalogPrices([first], "cheap", { ...missing, groups: [{ ...missing.groups[0]!, details: { source: "key-groups" as const, stale: true } }] })[0]!;
    expect(stale.metadata?.endpointTypes).toEqual(["/old"]);
    const failed = applySupplierCatalogPrices([first], "cheap", { ...missing, status: "failed" })[0]!;
    expect(failed.metadata?.endpointTypes).toEqual(["/old"]);
    const cleared = applySupplierCatalogPrices([first], "cheap", missing)[0]!;
    expect(cleared.metadata?.endpointTypes).toBeUndefined();
    expect(cleared.metadata?.documentationUrl).toBeUndefined();
  });
  it.each([false, undefined])("preserves owned interface fields when saved catalog completeness is %j", async scanComplete => {
    const initial = { ...catalog, groups: [{ ...catalog.groups[0]!, models: [{ id: model.id, capability: "image" as const, metadata: { endpointTypes: ["/old"], documentationUrl: "https://site.invalid/old.json" } }] }] };
    const first = applySupplierCatalogPrices([model], "cheap", initial)[0]!;
    const supplier = { id: "saved-interface", apiUrl: "https://saved-interface.invalid/v1", siteUrl: "https://saved-interface.invalid", kind: "newapi", scanStatus: "live", scanComplete,
      state: { sourceId: "saved-source" }, catalog: { groups: [{ id: "cheap", label: "Cheap", models: [{ id: model.id, capability: "image" }] }] }, scannedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
    vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    const result = await enrichSupplierModelPrices({ config: { supplierId: supplier.id, supplierSourceId: "saved-source", baseUrl: supplier.apiUrl, modelGroup: "cheap" } }, [first], false, false);
    expect(result[0]?.metadata).toMatchObject({ endpointTypes: ["/old"], documentationUrl: "https://site.invalid/old.json", supplierCatalogInterfaceStale: true });
    vi.mocked(getSupplierRecord).mockResolvedValue(null);
  });
  it("reinterprets cached group descriptions with compact resolutions and Chinese price units", () => {
    const image: ModelDescriptor = { ...model, id: "gpt-image-2.5-all", operations: ["image.generate"], metadata: { priceLabel: "价格未公布", priceSource: "supplier-catalog" } };
    const group = { id: "image2.5特价", label: "image2.5特价", source: "catalog" as const, models: [], details: { source: "key-groups" as const, description: "image2.5特价，0.06一张 124K" } };
    const result = applySupplierCatalogPrices([image], group.id, { ...catalog, groups: [group] })[0]!;
    expect(result.metadata).toMatchObject({ priceLabel: "0.06一张 124K（分组说明参考）", priceSource: "supplier-group", priceStatus: "available", supplierGroupResolutionLabel: "说明支持 1K / 2K / 4K" });
    expect(result.pricing).toBeUndefined(); // The supplier's wording does not specify a currency.
    for (const size_tier of ["1K", "2K", "4K"])
      expect(modelPriceSummary(result, { size_tier, quality: "high" })).toBe("0.06一张 124K（分组说明参考）");
    expect(applySupplierCatalogPrices([image], group.id, { ...catalog, groups: [{ ...group, details: { ...group.details, stale: true } }] })[0]?.metadata?.priceStatus).toBe("unpublished");
    expect(group.details).not.toHaveProperty("referencePrice");
  });
  it("repairs saved pDog banana prices and exposes native versus upscaled group declarations", () => {
    const ids = ["gemini-3.1-flash-image-preview", "gemini-3-pro-image"];
    const images = ids.map(id => ({ ...model, id, operations: ["image.generate" as const], metadata: {} }));
    const group = { id: "香蕉", label: "香蕉", source: "catalog" as const, models: [], details: { source: "key-groups" as const,
      description: `香蕉2：0.07/张, ID：${ids[0]}\n香蕉pro：0.08/张, ID：${ids[1]}` } };
    const priced = applySupplierCatalogPrices(images, group.id, { ...catalog, groups: [group] });
    expect(priced.map(image => image.metadata?.priceLabel)).toEqual(["香蕉2：0.07/张（分组说明参考）", "香蕉pro：0.08/张（分组说明参考）"]);
    const supersampled = { ...group, id: "1K2K4K(超分组)", details: { ...group.details,
      description: "0.03/张，1K为原生，2K4K为超分" } };
    const result = applySupplierCatalogPrices(images, supersampled.id, { ...catalog, groups: [supersampled] })[0]!;
    expect(result.metadata?.imageResolutionOrigins).toEqual({ "1K": "native", "2K": "upscaled", "4K": "upscaled" });
    expect(result.metadata?.supplierGroupResolutionLabel).toContain("说明超分 2K / 4K");
  });
  it("reads scoped documentation before measured fallback and retains conditional wording", () => {
    const missing = {...model, metadata:{priceLabel:"价格未公布"}};
    expect(applyDocumentedModelPrice(missing, "new-image：¥0.16/张", "https://example.com/docs").pricing?.unitAmount).toBe(0.16);
    expect(applyDocumentedModelPrice(missing, "other-image：¥0.99/张", "https://example.com/docs").pricing).toBeUndefined();
    const tiered = applyDocumentedModelPrice(missing, "new-image：4K max ¥0.3/张，high ¥0.1/张", "https://example.com/docs");
    expect(tiered.pricing).toBeUndefined();
    expect(tiered.metadata?.priceLabel).toContain("4K max");
  });
  it("does not borrow a pro suffix price from documentation and selects exact future model lines", () => {
    const base = mikotoImageModel("future-image-v99");
    const pro = mikotoImageModel("future-image-v99-pro");
    const proOnly = "future-image-v99-pro：¥0.22/张";
    const missing = applyDocumentedModelPrice(base, proOnly, "https://example.com/docs");
    expect(missing.pricing).toBeUndefined();
    expect(missing.metadata?.priceLabel).toBe("价格未公布");
    const document = [proOnly, "future-image-v99：¥0.11/张"].join("\n");
    const baseQuote = applyDocumentedModelPrice(base, document, "https://example.com/docs");
    expect(baseQuote.pricing).toMatchObject({ kind: "per-image", currency: "CNY", unitAmount: 0.11 });
    expect(baseQuote.metadata?.priceLabel).toBe("¥0.11/张");
    const proQuote = applyDocumentedModelPrice(pro, document, "https://example.com/docs");
    expect(proQuote.pricing).toMatchObject({ kind: "per-image", currency: "CNY", unitAmount: 0.22 });
    expect(proQuote.metadata?.priceLabel).toBe("¥0.22/张");
    const suffixed = applyDocumentedModelPrice(mikotoImageModel("future-image-v99-pro-fast"), document, "https://example.com/docs");
    expect(suffixed.pricing).toBeUndefined();
    expect(suffixed.metadata?.priceLabel).toBe("价格未公布");
  });
  it("fills an unpublished price from a successful exact charge and keeps published prices first", async () => {
    const image: ModelDescriptor = { ...model, operations: ["image.generate"] };
    const supplier = { id: "supplier", apiUrl: "https://price-evidence.example/v1", siteUrl: "https://price-evidence.example", state: { sourceId: "source" },
      catalog: { groups: [{ id: "images", label: "images", models: [] }] }, kind: "newapi", scanStatus: "live", scannedAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z" };
    vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    vi.mocked(repository.getSupplierVerification).mockResolvedValue({ sourceId: "source", cases: [{ sourceId: "source", status: "succeeded", requestId: "request", group: "images", modelId: image.id, resolution: "4K", quality: "max",
      actualCharge: { amount: 0.4, currency: "CNY", unit: "image", requestId: "request", checkedAt: "2026-09-23T00:00:00.000Z" } }] } as unknown as Awaited<ReturnType<typeof repository.getSupplierVerification>>);
    const connection = { config: { supplierId: "supplier", supplierSourceId: "source", baseUrl: supplier.apiUrl, modelGroup: "images" } };
    const result = await enrichSupplierModelPrices(connection, [image], false, false);
    expect(result[0]?.metadata).toMatchObject({ priceLabel: "¥0.4/张（生成实测） · 4K / max", priceSource: "generated-result" });
    expect(result[0]?.pricing).toBeUndefined();
    vi.mocked(getSupplierRecord).mockResolvedValue({ ...supplier, catalog: { groups: [{ id: "images", label: "images", models: [{ id: image.id, capability: "image", priceLabel: "¥0.2/张" }] }] } } as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    const published = await enrichSupplierModelPrices(connection, result, false, false);
    expect(published[0]?.metadata).toMatchObject({ priceLabel: "¥0.2/张", priceSource: "supplier-catalog" });
    const wrongSource = await enrichSupplierModelPrices({ config: { ...connection.config, baseUrl: "https://other-price-evidence.example/v1" } }, [image], false, false);
    expect(wrongSource[0]?.metadata?.priceSource).toBeUndefined();
    vi.mocked(getSupplierRecord).mockResolvedValue(null);
    vi.mocked(repository.getSupplierVerification).mockResolvedValue(null);
  });

  it("uses the latest exact generation charge as the final pricing evidence", () => {
    const prices = measuredPricesFromVerification({
      cases: [
        {
          group: "cheap",
          modelId: "new-image",
          status: "succeeded",
          requestId: "old-request",
          updatedAt: "2026-09-20T00:00:00.000Z",
          actualCharge: {
            amount: 0.11,
            currency: "USD",
            unit: "image",
            checkedAt: "2026-09-20T00:00:00.000Z",
            requestId: "old-request",
          },
        },
        {
          group: "cheap",
          modelId: "new-image",
          status: "succeeded",
          requestId: "new-request",
          resolution: "4K",
          quality: "max",
          parameters: { size: "3840x2160", quality: "max", n: 1 },
          updatedAt: "2026-09-21T00:00:00.000Z",
          actualCharge: {
            amount: 0.12,
            currency: "USD",
            unit: "image",
            checkedAt: "2026-09-21T00:00:00.000Z",
            requestId: "new-request",
          },
        },
        {
          group: "cheap",
          modelId: "text-model",
          status: "succeeded",
          requestId: "text-request",
          actualCharge: {
            amount: 9,
            currency: "USD",
            unit: "request",
            requestId: "text-request",
          },
        },
      ],
    });
    expect(prices.get("cheap\u0000new-image")).toMatchObject({
      label: "$0.12/张（生成实测） · 4K / max",
      amount: 0.12,
      currency: "USD",
      unit: "image",
      resolution: "4K",
      quality: "max",
      parameters: { size: "3840x2160", quality: "max", n: 1 },
    });
    expect(prices.has("cheap\u0000text-model")).toBe(true);
    expect(measuredPricesFromVerification({ cases: [{ group: "cheap", modelId: "bad", actualCharge: { amount: -1, currency: "USD", unit: "image" } }] })).toEqual(new Map());
    expect(measuredPricesFromVerification({ sourceId: "new", cases: [{ sourceId: "old", status: "succeeded", requestId: "request", group: "cheap", modelId: "old-image", actualCharge: { requestId: "request", amount: 0.12, currency: "USD", unit: "image" } }] })).toEqual(new Map());
    expect(measuredPricesFromVerification({ cases: [{ status: "succeeded", requestId: "request", group: "cheap", modelId: "unmatched", actualCharge: { requestId: "other", amount: 0.12, currency: "USD", unit: "image" } }] })).toEqual(new Map());
  });

  it("uses group prices only as image references and keeps explicit model prices first", () => {
    const image = { ...model, id: "gpt-image-2", operations: ["image.generate"] as const };
    const groups = [{id:"images", label:"Images", source:"catalog" as const, models:[], details:{source:"key-groups" as const, description:"1张0.015，仅支持1K2K，不支持4K", referencePrice:"1张0.015", supportedResolutions:["1K","2K"], unsupportedResolutions:["4K"],exclusiveResolutions:true}}];
    const result = applySupplierCatalogPrices([image, model], "images", { ...catalog, groups });
    expect(result[0]?.metadata).toMatchObject({ priceLabel:"1张0.015（分组说明参考）", priceSource:"supplier-group", supplierGroupResolutionLabel:"仅支持 1K / 2K；不支持 4K" });
    expect(result[0]?.parameters).toEqual(image.parameters);
    expect(result[1]?.metadata?.priceLabel).toBe("1张0.015（分组说明参考）"); // Image ID is sufficient even before protocol adaptation.
    expect(applySupplierCatalogPrices([{ ...model, id:"chat-model" }], "images", { ...catalog, groups })[0]?.metadata?.priceLabel).toBe("价格未公布");
    expect(applySupplierCatalogPrices([image], "other", { ...catalog, groups })[0]?.metadata?.priceLabel).toBe("价格未公布");
    const explicit = { ...groups[0]!, models:[{id:image.id, capability:"image" as const,priceLabel:"$0.3/张"}] };
    expect(applySupplierCatalogPrices([image], "images", { ...catalog, groups:[explicit] })[0]?.metadata?.priceLabel).toBe("$0.3/张");
    const failed = applySupplierCatalogPrices(result, "images", { ...catalog, groups:[],status:"failed" });
    expect(failed[0]?.metadata).toMatchObject({priceLabel:"1张0.015（分组说明参考）（上次价格）",supplierGroupInfoStale:true});
    const cleared = applySupplierCatalogPrices(result, "images", { ...catalog, groups: [{...groups[0]!,details:undefined}] });
    expect(cleared[0]?.metadata?.priceLabel).toBe("价格未公布");
    expect(cleared[0]?.metadata?.supplierGroupResolutionLabel).toBeUndefined();
  });
  it("joins exact group/model IDs without granting model availability", () => {
    const priced = applySupplierCatalogPrices(
      [model, { ...model, id: "NEW-image" }],
      "cheap",
      catalog,
    );
    expect(priced[0]?.metadata).toMatchObject({
      priceLabel: "$0.02/张",
      canvasRunnable: false,
    });
    expect(priced[1]?.metadata?.priceLabel).toBe("价格未公布");
    expect(
      applySupplierCatalogPrices([model], "expensive", catalog)[0]?.metadata
        ?.priceLabel,
    ).toBe("$0.2/张");
    expect(
      applySupplierCatalogPrices([model], "missing", catalog)[0]?.metadata
        ?.priceLabel,
    ).toBe("价格未公布");
  });
  it("updates previously discovered prices and labels cached prices on failure", () => {
    const old = applySupplierCatalogPrices([model], "expensive", catalog);
    expect(
      applySupplierCatalogPrices(old, "cheap", catalog)[0]?.metadata
        ?.priceLabel,
    ).toBe("$0.02/张");
    const failed = applySupplierCatalogPrices(old, "cheap", {
      ...catalog,
      groups: [],
      status: "failed",
    });
    expect(failed[0]?.metadata).toMatchObject({
      priceLabel: "$0.2/张（上次价格）",
      priceStatus: "failed",
    });
    expect(
      applySupplierCatalogPrices([model], "cheap", {
        ...catalog,
        groups: [],
        status: "unauthorized",
      })[0]?.metadata?.priceLabel,
    ).toBe("价格需登录查询");
  });
  it("clears an unknown-price snapshot label after a login-gated lookup", () => {
    const result = applySupplierCatalogPrices([{ ...model, name: "new-image（价格以平台为准·快照）" }], "cheap", { ...catalog, status: "unauthorized", groups: [] });
    expect(result[0]?.name).toBe("new-image");
    expect(result[0]?.metadata?.priceLabel).toBe("价格需登录查询");
  });
  it("preserves a supplier adapter's own structured currency and price", () => {
    const known: ModelDescriptor = {
      ...model,
      pricing: {
        kind: "per-image",
        currency: "CNY",
        unitAmount: 0.025,
        checkedAt: "now",
        confidence: "exact",
      },
    };
    expect(applySupplierCatalogPrices([known], "cheap", catalog)[0]).toBe(
      known,
    );
  });
  it("never replaces manual prices with a more recent catalog timestamp", () => {
    const own: ModelDescriptor = { ...model, metadata: { priceSource: "manual", priceLabel: "¥0.123/张" },
      pricing: { kind: "per-image", currency: "CNY", unitAmount: .123, checkedAt: "2026-09-01T00:00:00Z", confidence: "exact" } };
    expect(applySupplierCatalogPrices([own], "cheap", { ...catalog, checkedAt: "2026-10-01T00:00:00Z" })[0]).toBe(own);
  });
  it("keeps the price's successful read time and source when the next lookup fails", () => {
    const old = applySupplierCatalogPrices([model], "cheap", { ...catalog, checkedAt: "2026-09-01T00:00:00Z" });
    const failed = applySupplierCatalogPrices(old, "cheap", { ...catalog, groups: [], status: "failed", checkedAt: "2026-10-01T00:00:00Z" });
    expect(failed[0]?.metadata).toMatchObject({ priceLabel: "$0.02/张（上次价格）", priceSource: "supplier-catalog", priceCheckedAt: "2026-09-01T00:00:00Z", priceLastAttemptAt: "2026-10-01T00:00:00Z" });
  });
  it("retries a failed catalog immediately instead of caching it for five minutes", async () => {
    vi.mocked(getSupplierRecord).mockResolvedValue(null);
    vi.mocked(discoverSupplierCatalog).mockResolvedValueOnce({ kind: "newapi", status: "failed", checkedAt: "2026-10-01T00:00:00Z", groups: [] });
    const connection = { config: { baseUrl: "https://failed-price-retry.invalid/v1", modelGroup: "new-group" } };
    const first = await enrichSupplierModelPrices(connection, [model]);
    expect(first[0]?.metadata?.priceStatus).toBe("failed");
    const count = vi.mocked(discoverSupplierCatalog).mock.calls.length;
    const second = await enrichSupplierModelPrices(connection, [model]);
    expect(discoverSupplierCatalog).toHaveBeenCalledTimes(count + 1);
    expect(second[0]?.metadata?.priceLabel).toBe("$0.02/张");
  });
  it("shares a force read only within its operation ID even when two operations overlap", async () => {
    vi.mocked(getSupplierRecord).mockResolvedValue(null);
    let release!: (catalog: SupplierCatalogDiscovery) => void;
    vi.mocked(discoverSupplierCatalog).mockReturnValueOnce(new Promise(resolve => { release = resolve; }))
      .mockResolvedValueOnce({ ...catalog, groups: [{ ...catalog.groups[0]!, models: [{ id: model.id, capability: "image", priceLabel: "$0.3/张" }] }] });
    const config = { baseUrl: "https://operation-price-cache.invalid/v1", modelGroup: "cheap" };
    const count = vi.mocked(discoverSupplierCatalog).mock.calls.length;
    const first = enrichSupplierModelPrices({ config }, [model], true, true, { refreshId: "operation-a" });
    const newer = enrichSupplierModelPrices({ config }, [model], true, true, { refreshId: "operation-b" });
    const sameOperation = enrichSupplierModelPrices({ config: { ...config, modelGroup: "expensive" } }, [model], true, true, { refreshId: "operation-a" });
    expect(discoverSupplierCatalog).toHaveBeenCalledTimes(count + 2);
    release(catalog);
    const [a, b, otherGroup] = await Promise.all([first, newer, sameOperation]);
    expect(a[0]?.metadata?.priceLabel).toBe("$0.02/张");
    expect(b[0]?.metadata?.priceLabel).toBe("$0.3/张");
    expect(otherGroup[0]?.metadata?.priceLabel).toBe("$0.2/张");
    const ordinary = await enrichSupplierModelPrices({ config }, [model]);
    expect(ordinary[0]?.metadata?.priceLabel).toBe("$0.3/张");
    expect(discoverSupplierCatalog).toHaveBeenCalledTimes(count + 2);
  });
  it("shares partial catalog results across one operation's later batches but lets the next operation retry", async () => {
    vi.mocked(getSupplierRecord).mockResolvedValue(null);
    const partial: SupplierCatalogDiscovery = { ...catalog, complete: false, checkedAt: "2026-10-08T16:00:00Z" };
    const fresh: SupplierCatalogDiscovery = { ...catalog, complete: true, checkedAt: "2026-10-08T16:01:00Z" };
    vi.mocked(discoverSupplierCatalog).mockResolvedValueOnce(partial).mockResolvedValueOnce(fresh);
    const config = { baseUrl: "https://partial-operation-price-cache.invalid/v1", modelGroup: "cheap" };
    const count = vi.mocked(discoverSupplierCatalog).mock.calls.length;
    const first = await enrichSupplierModelPrices({ config }, [model], true, true, { refreshId: "partial-operation-a" });
    expect(first[0]?.metadata?.priceLabel).toBe("$0.02/张");
    const batch = await Promise.all(["cheap", "expensive", "cheap"].map(modelGroup => enrichSupplierModelPrices({ config: { ...config, modelGroup } },
      [model], true, true, { refreshId: "partial-operation-a" })));
    expect(batch.map(result => result[0]?.metadata?.priceLabel)).toEqual(["$0.02/张", "$0.2/张", "$0.02/张"]);
    expect(discoverSupplierCatalog).toHaveBeenCalledTimes(count + 1);
    await enrichSupplierModelPrices({ config }, [model], true, true, { refreshId: "partial-operation-b" });
    expect(discoverSupplierCatalog).toHaveBeenCalledTimes(count + 2);
    await enrichSupplierModelPrices({ config }, [model]);
    expect(discoverSupplierCatalog).toHaveBeenCalledTimes(count + 2);
  });
  it("makes every force read without an operation ID fresh while ordinary reads retain their TTL", async () => {
    vi.mocked(getSupplierRecord).mockResolvedValue(null);
    const connection = { config: { baseUrl: "https://force-price-no-id.invalid/v1", modelGroup: "new-group" } };
    const count = vi.mocked(discoverSupplierCatalog).mock.calls.length;
    await enrichSupplierModelPrices(connection, [model], true);
    await enrichSupplierModelPrices(connection, [model], true);
    await enrichSupplierModelPrices(connection, [model]);
    expect(discoverSupplierCatalog).toHaveBeenCalledTimes(count + 2);
  });
  it("queries the marketplace automatically for a new supplier and newly added model", async () => {
    const connection = {
      config: {
        baseUrl: "https://brand-new.example/v1",
        modelGroup: "new-group",
      },
    };
    const enriched = await enrichSupplierModelPrices(connection, [model], true);
    expect(discoverSupplierCatalog).toHaveBeenCalledWith(
      {
        siteUrl: "https://brand-new.example",
        apiUrl: "https://brand-new.example/v1",
        kind: "auto",
        signal: expect.any(AbortSignal),
      },
      expect.any(Function),
    );
    expect(enriched[0]?.metadata?.priceLabel).toBe("$0.02/张");
    expect(enriched[0]?.name).toBe("new-image");
  });
  it("isolates price sessions and cache entries after token, user ID and authentication mode change", async () => {
    const siteUrl = "https://token-price-cache.invalid", apiUrl = `${siteUrl}/v1`;
    const encrypted = (secret: string) => encryptSecret(secret, requireServerMasterKey());
    const token = encrypted("fixture-price-token");
    const state = { version: 1, revision: 1, visibility: "visible", sourceId: "token-price-source", fingerprint: "fp", history: [],
      siteLogin: { authMode: "access-token", siteUrl, encryptedAccessToken: token, userId: "42" } };
    const supplier = { id: "token-price", apiUrl, siteUrl, state, catalog: { groups: [] }, kind: "newapi", scanStatus: "unscanned", updatedAt: "now" };
    const use = (login: Record<string, unknown>) => vi.mocked(getSupplierRecord).mockResolvedValue({ ...supplier, state: { ...state, siteLogin: login } } as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    const connection = { config: { supplierId: supplier.id, supplierSourceId: state.sourceId, baseUrl: apiUrl, modelGroup: "new-group" } };
    vi.mocked(loginSupplierSite).mockClear();
    use(state.siteLogin);
    await enrichSupplierModelPrices(connection, [model], false, true);
    await enrichSupplierModelPrices(connection, [model], false, true);
    expect(loginSupplierSite).toHaveBeenCalledTimes(1);
    expect(loginSupplierSite).toHaveBeenLastCalledWith({ siteUrl, kind: "newapi", credentials: { accessToken: "fixture-price-token", userId: "42" } });
    use({ ...state.siteLogin, userId: "43" });
    await enrichSupplierModelPrices(connection, [model], false, true);
    expect(loginSupplierSite).toHaveBeenCalledTimes(2);
    use({ ...state.siteLogin, encryptedAccessToken: encrypted("replacement-price-token") });
    await enrichSupplierModelPrices(connection, [model], false, true);
    expect(loginSupplierSite).toHaveBeenCalledTimes(3);
    use({ authMode: "password", siteUrl, username: "account", encryptedPassword: encrypted("fixture-price-password") });
    await enrichSupplierModelPrices(connection, [model], false, true);
    expect(loginSupplierSite).toHaveBeenCalledTimes(4);
    expect(loginSupplierSite).toHaveBeenLastCalledWith({ siteUrl, kind: "newapi", credentials: { username: "account", password: "fixture-price-password" } });
    vi.mocked(getSupplierRecord).mockResolvedValue(null);
  });
  it("reports a token session network failure as failed pricing rather than expired authentication", async () => {
    const siteUrl = "https://token-price-network.invalid", apiUrl = `${siteUrl}/v1`;
    const supplier = { id: "token-network", apiUrl, siteUrl, kind: "newapi", catalog: { groups: [] }, updatedAt: "now", scanStatus: "unscanned",
      state: { sourceId: "network-source", siteLogin: { authMode: "access-token", siteUrl, encryptedAccessToken: encryptSecret("fixture-network-token", requireServerMasterKey()) } } };
    vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    vi.mocked(loginSupplierSite).mockRejectedValueOnce(new SupplierLoginError("temporary network error", 502, "network"));
    const result = await enrichSupplierModelPrices({ config: { supplierId: supplier.id, supplierSourceId: "network-source", baseUrl: apiUrl } }, [model], false, true);
    expect(result[0]?.metadata?.priceLabel).toBe("价格查询失败");
    expect(result[0]?.metadata?.priceStatus).toBe("failed");
    vi.mocked(getSupplierRecord).mockResolvedValue(null);
  });
});

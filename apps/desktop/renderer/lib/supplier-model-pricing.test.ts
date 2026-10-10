import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const isolatedPricingNetwork = vi.hoisted(() => ({ fetch: vi.fn(), lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));
vi.mock("node:dns/promises", () => ({ lookup: isolatedPricingNetwork.lookup }));
beforeEach(() => {
  isolatedPricingNetwork.fetch.mockReset().mockRejectedValue(new Error("Unexpected real HTTP in supplier price test"));
  vi.stubGlobal("fetch", isolatedPricingNetwork.fetch);
});
afterEach(() => { try { expect(isolatedPricingNetwork.fetch).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); } });
import { readFileSync } from "node:fs";
import type {
  ModelDescriptor,
  SupplierCatalogDiscovery,
} from "@super-canvas/providers";
import { remainingVideoModel } from "@super-canvas/providers/remaining-video-contracts";
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
  applySavedMeasuredPrices,
} from "./supplier-model-pricing";
import { parseSupplierCatalog, parseSupplierPricingChannels } from "@super-canvas/providers";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { cyberAfeiCatalogFromPricing, resolveCyberAfeiScannedGroup } from "./cyberafei-catalog";
import { applyWeAiLivePricing, type WeAiLiveModelPricing } from "./weai-catalog";

const weaiSnapshotOrigin = "https://asian-acc.we-token.cc";
describe("durable exact ledger observations", () => {
  const scope = { sourceId: "source-a", supplierGroupId: "74", apiUrl: "https://supplier.example/v1" };
  const model: ModelDescriptor = { id: "video-exact", name: "Video", operations: ["video.generate"], metadata: {
    priceLabel: "暂未取得报价", invokable: false, invocationBlockedReason: "INSUFFICIENT_BALANCE" } };
  const sample = { sourceId: "source-a", supplierGroupId: "74", accountKeyId: "key-a", modelId: "video-exact",
    checkedAt: "2026-10-09T12:00:00Z", providerTaskId: "task-a", requestId: "request-a", parameterScope: "exact", parameters: {},
    originalStatus: "awaiting-download", actualCharge: { taskId: "task-a", requestId: "ledger-request", amount: .8, unit: "request",
      sourceUrl: "https://supplier.example/api/v1/usage?group_id=74" } };
  const config = { accountKeyId: "key-a", measuredPriceEvidence: [sample] };
  it("survives a catalog replacement and restart without declaring the original accepted or guessing currency", () => {
    const first = applySavedMeasuredPrices([model], config, scope)[0]!;
    expect(first.metadata).toMatchObject({ priceStatus: "measured", invokable: false, invocationBlockedReason: "INSUFFICIENT_BALANCE",
      measuredPrice: { parameterScope: "exact", originalStatus: "awaiting-download", providerTaskId: "task-a" } });
    expect(modelPriceSummary(first, {})).toBe("0.8 账户计价单位/次（账单实测，仅默认请求；原件待取回）");
    expect(modelPriceSummary(first, { ratio: "1:1" })).toContain("当前组合未测价");
    expect(first.pricing).toBeUndefined();
    const restarted = applySavedMeasuredPrices([model], JSON.parse(JSON.stringify(config)), scope)[0]!;
    expect(restarted).toEqual(first);
  });
  it("requires exact source, stable group, current Key, full model and same task/request", () => {
    for (const changed of [{ sourceId: "other" }, { supplierGroupId: "75" }, { accountKeyId: "other" }, { modelId: "video-exact-alias" },
      { providerTaskId: "other" }, { actualCharge: { ...sample.actualCharge, sourceUrl: "https://other.example/usage" } },
      { actualCharge: { ...sample.actualCharge, amount: Number.NaN } }, { checkedAt: "invalid" }, { parameterScope: "partial" }]) {
      expect(applySavedMeasuredPrices([model], { ...config, measuredPriceEvidence: [{ ...sample, ...changed }] }, scope)[0]).toEqual(model);
    }
  });
  it("keeps published prices authoritative and does not treat observations as invocation permission", () => {
    const quoted = { ...model, metadata: { ...model.metadata, priceSource: "supplier-group", priceLabel: "$1/次" } };
    expect(applySavedMeasuredPrices([quoted], config, scope)[0]).toEqual(quoted);
    expect(modelEstimatedCost(applySavedMeasuredPrices([model], config, scope)[0], {})).toBeUndefined();
  });
});
it("repairs Jiasu video token placeholders, carries its public contract, and accepts a later exact billing tier", () => {
  const id = "doubao-seedance-2-0-260128", source = "https://ai.jiasuapi.com";
  const group = parseSupplierCatalog({ group_ratio: { vip: 1 }, data: [{ model_name: id, quota_type: 0, model_ratio: 23,
    completion_ratio: 1, enable_groups: ["vip"], supported_endpoint_types: ["openai-video"], api_parameters: JSON.stringify([
      { name: "duration", type: "integer", range: "5-15", default: "5" },
    ]), billing_usage_schema: { resolution: { enum: ["480p", "720p", "1080p"] }, video_input: { enum: ["none", "video"] }, tokens: { type: "number", unit: "token" } } }] },
    { supplierSiteUrl: source, currency: "CNY", checkedAt: "2026-10-09T12:00:00Z" }).groups[0]!;
  const catalog: SupplierCatalogDiscovery = { groups: [group], kind: "newapi", status: "live", complete: true, checkedAt: "2026-10-09T12:00:00Z" };
  const old: ModelDescriptor = { id, name: `${id} · 输入 ¥46/1M · 输出 ¥46/1M`, operations: ["video.generate"], outputKinds: ["video"],
    pricing: { kind: "token", currency: "CNY", inputPerMillion: 46, outputPerMillion: 46, confidence: "estimate", checkedAt: "2026-10-08T12:00:00Z" },
    metadata: { priceLabel: "输入 ¥46/1M · 输出 ¥46/1M" } };
  const pending = applySupplierCatalogPrices([old], "vip", catalog, source)[0]!;
  expect(pending.pricing).toBeUndefined();
  expect(pending.name).toBe(id);
  expect(pending.metadata).toMatchObject({ priceLabel: "价格条件待确认", priceStatus: "unconfirmed", jiasuCatalogPricingIncomplete: true,
    jiasuCatalogRecord: { supportedEndpointTypes: ["openai-video"], apiParameters: [{ name: "duration", type: "integer", range: "5-15", default: "5" }] } });
  const fresh = structuredClone(catalog);
  fresh.groups[0]!.models[0]!.priceLabel = "720p ¥0.3/秒";
  fresh.groups[0]!.models[0]!.metadata = { ...fresh.groups[0]!.models[0]!.metadata, jiasuCatalogPricingIncomplete: false, jiasuCatalogPricingEvidence: "video-final",
    officialCatalogPricing: { kind: "tiered", currency: "CNY", billingUnit: "second", confidence: "exact", checkedAt: fresh.checkedAt, sourceUrl: `${source}/api/pricing`,
      tiers: [{ id: "720p", label: "720p", dimension: "resolution", value: "720p", price: .3 }] } };
  const priced = applySupplierCatalogPrices([pending], "vip", fresh, source)[0]!;
  expect(priced.pricing).toMatchObject({ billingUnit: "second", tiers: [{ price: .3 }] });
  expect(priced.metadata?.jiasuCatalogPricingIncomplete).toBeUndefined();
});

it("uses a successful Jiasu video charge only for its measured parameters when conditional rates are unavailable", async () => {
  const id = "doubao-seedance-2-0-260128", source = "https://ai.jiasuapi.com";
  const supplier = { id: "jiasu-price", apiUrl: `${source}/v1`, siteUrl: source, state: { sourceId: "jiasu-source" },
    catalog: { groups: [{ id: "vip", label: "vip", models: [{ id, capability: "video", priceLabel: "价格条件待确认", metadata: {
      jiasuCatalogPricingIncomplete: true, priceUnavailableReason: "官方视频用量/条件费率未完整公布", jiasuCatalogRecord: { supportedEndpointTypes: ["openai-video"], apiParameters: [] },
    } }] }] }, kind: "newapi", scanStatus: "live", scanComplete: true, scannedAt: "2026-10-09T12:00:00Z", updatedAt: "2026-10-09T12:00:00Z" };
  vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
  vi.mocked(repository.getSupplierVerification).mockResolvedValue({ sourceId: "jiasu-source", cases: [{ sourceId: "jiasu-source", status: "succeeded", requestId: "video-request", group: "vip", modelId: id,
    resolution: "720p", parameters: { resolution: "720p", duration: 5, video_input: "none" },
    actualCharge: { amount: 4.968, currency: "CNY", unit: "request", requestId: "video-request", checkedAt: "2026-10-09T12:00:00Z" } }] } as unknown as Awaited<ReturnType<typeof repository.getSupplierVerification>>);
  const video: ModelDescriptor = { id, name: id, operations: ["video.generate"], outputKinds: ["video"], metadata: {} };
  const priced = (await enrichSupplierModelPrices({ config: { supplierId: supplier.id, supplierSourceId: "jiasu-source", baseUrl: supplier.apiUrl, modelGroup: "vip" } }, [video], false, false))[0]!;
  expect(priced.pricing).toBeUndefined();
  expect(priced.metadata).toMatchObject({ priceSource: "generated-result", priceStatus: "measured", measuredPrice: { amount: 4.968, parameters: { duration: 5, resolution: "720p", video_input: "none" } } });
  expect(modelEstimatedCost(priced, { duration: 5 })).toBeUndefined();
  vi.mocked(getSupplierRecord).mockResolvedValue(null);
  vi.mocked(repository.getSupplierVerification).mockResolvedValue(null);
});

it("uses the latest exact Synora ledger sample instead of an obsolete common group rate", () => {
  const id = "gpt-image-2.5-sunburst";
  // Synthetic timestamps preserve ordering without retaining account billing times.
  const ledger = { modelId: id, supplierGroupId: "115", amount: .08, currency: "USD", unit: "image" as const,
    resolution: "4K", parameters: { n: 1, resolution: "4K" }, sample: true as const, billingMode: "image",
    checkedAt: "2001-01-03T13:00:00Z", observedAt: "2001-01-03T08:00:00Z", sourceUrl: "https://synoralink.com/api/v1/usage?page=1&page_size=100" };
  const catalog: SupplierCatalogDiscovery = { kind: "sub2api", status: "live", complete: false, checkedAt: ledger.checkedAt,
    groups: [{ id: "全参生图专线", label: "全参生图专线", source: "catalog", supplierGroupId: "115", models: [],
      details: { source: "key-groups", description: "原生4K，0.07/张", ledgerPrices: [ledger] } }] };
  const image: ModelDescriptor = { id, name: id, operations: ["image.generate"], outputKinds: ["image"], metadata: { priceLabel: "价格目录未完整读取" } };
  const priced = applySupplierCatalogPrices([image], "旧组名称", catalog, "https://synoralink.com", { supplierGroupId: "115" })[0]!;
  expect(priced.metadata).toMatchObject({ priceLabel: "$0.08/张（账单实测） · 4K", priceSource: "generated-result", priceStatus: "measured", supplierPriceGroupId: "115" });
  expect(modelPriceSummary(priced, { size_tier: "4K", n: 1 })).toBe("$0.08/张（账单实测） · 4K");
  expect(modelPriceSummary(priced, { size_tier: "2K", n: 1 })).toContain("当前组合未测价");
  expect(modelPriceSummary(priced, { size_tier: "4K", n: 2 })).toContain("当前组合未测价");
  expect(modelEstimatedCost(priced, { size_tier: "4K", n: 1 })).toBeUndefined();
  const unavailableLedger = structuredClone(catalog); delete unavailableLedger.groups[0]!.details!.ledgerPrices;
  const retained = applySupplierCatalogPrices([priced], "全参生图专线", unavailableLedger, "https://synoralink.com", { supplierGroupId: "115" })[0]!;
  expect(retained.metadata?.priceLabel).toBe("$0.08/张（上次账单实测） · 4K");
  expect(retained.metadata?.priceStatus).toBe("partial");
  const retainedInCatalog = { ...catalog, checkedAt: "2001-01-03T13:20:00Z" };
  expect(applySupplierCatalogPrices([priced], "全参生图专线", retainedInCatalog, "https://synoralink.com", { supplierGroupId: "115" })[0]?.metadata?.priceLabel).toContain("上次账单实测");
  const newerNotice = structuredClone(catalog); newerNotice.groups[0]!.details!.ledgerPrices![0]!.notificationAt = "2001-01-03T12:00:00Z";
  const adjusted = applySupplierCatalogPrices([image], "全参生图专线", newerNotice, "https://synoralink.com", { supplierGroupId: "115" })[0]!;
  expect(adjusted.metadata?.priceLabel).toBe("价格已调整；$0.08/张（上次账单实测） · 4K");
  expect(adjusted.metadata?.priceStatus).toBe("partial");
  expect(applySupplierCatalogPrices([{ ...image, id: "gpt-image-2.5-flare" }], "全参生图专线", catalog, "https://synoralink.com", { supplierGroupId: "115" })[0]?.metadata?.priceLabel).toBe("0.07/张（分组说明参考）");
  for (const changed of [{ supplierGroupId: "116" }, { modelId: id + "-preview" }, { currency: "credits" }, { parameters: { n: 2, resolution: "4K" } },
    { sourceUrl: "https://other.example/api/v1/usage" }, { sourceUrl: "https://synoralink.com/api/v1/usage?token=private" }, { amount: NaN }]) {
    const invalid = structuredClone(catalog); invalid.groups[0]!.details!.ledgerPrices = [{ ...ledger, ...changed }];
    expect(applySupplierCatalogPrices([image], "全参生图专线", invalid, "https://synoralink.com", { supplierGroupId: "115" })[0]?.metadata?.priceSource).toBe("supplier-group");
  }
  expect(applySupplierCatalogPrices([image], "全参生图专线", catalog, "https://unrelated.example", { supplierGroupId: "115" })[0]?.metadata?.priceSource).toBe("supplier-group");
  const manual = { ...image, pricing: { kind: "per-image" as const, currency: "USD", unitAmount: 99, confidence: "exact" as const, checkedAt: ledger.checkedAt }, metadata: { priceSource: "manual" } };
  expect(applySupplierCatalogPrices([manual], "全参生图专线", catalog, "https://synoralink.com", { supplierGroupId: "115" })[0]).toBe(manual);
});
it("uses a stable group identity after rename while retaining the exact group's description quote", () => {
  const oldName = "高质量生图专线", newName = "全参生图专线";
  const image: ModelDescriptor = { id: "gpt-image-2", name: "GPT Image 2", operations: ["image.generate"], outputKinds: ["image"],
    metadata: { priceLabel: "价格目录未完整读取", priceStatus: "partial" } };
  const catalog: SupplierCatalogDiscovery = { kind: "sub2api", status: "live", complete: false, checkedAt: "2026-10-09T08:00:00Z", groups: [{
    id: newName, label: newName, supplierGroupId: "115", source: "catalog", models: [],
    details: { source: "key-groups", description: "原生4k，image2和2.5均支持所有参数，0.07/张", rateMultiplier: 1 },
  }] };
  const priced = applySupplierCatalogPrices([image], oldName, catalog, "https://synoralink.com", { supplierGroupId: "115" })[0]!;
  expect(priced.metadata).toMatchObject({ priceLabel: "0.07/张（分组说明参考）", priceSource: "supplier-group", priceStatus: "available" });
  expect(modelPriceSummary(priced, { size_tier: "4K" })).toBe("0.07/张（分组说明参考）");
  // The description has no currency: it is still a useful displayed quote, but cannot become a made-up total.
  expect(priced.pricing).toBeUndefined();
  expect(modelEstimatedCost(priced, { n: 1 })).toBeUndefined();
  expect(applySupplierCatalogPrices([image], oldName, catalog, "https://synoralink.com")[0]?.metadata?.priceStatus).toBe("partial");
  const reusedName = { ...catalog, groups: [{ ...catalog.groups[0]!, id: oldName, supplierGroupId: "116" }] };
  expect(applySupplierCatalogPrices([image], oldName, reusedName, undefined, { supplierGroupId: "115" })[0]?.metadata?.priceStatus).toBe("partial");
  const history = { ...catalog, groups: [{ ...catalog.groups[0]!, id: oldName, details: { ...catalog.groups[0]!.details!, stale: true } }, ...catalog.groups] };
  expect(applySupplierCatalogPrices([image], oldName, history, undefined, { supplierGroupId: "115" })[0]?.metadata?.priceLabel).toBe(priced.metadata?.priceLabel);
  const ambiguous = { ...catalog, groups: [...catalog.groups, { ...catalog.groups[0]!, id: "another-name" }] };
  expect(applySupplierCatalogPrices([image], oldName, ambiguous, undefined, { supplierGroupId: "115" })[0]?.metadata?.priceStatus).toBe("partial");
  const oldQuote: ModelDescriptor = { ...image, pricing: { kind: "per-image", currency: "USD", unitAmount: .99, checkedAt: "2026-10-09T09:00:00Z", confidence: "exact" },
    metadata: { priceSource: "supplier-group", priceLabel: "$0.99/张", supplierPriceGroup: oldName, supplierPriceGroupId: "116", priceCheckedAt: "2026-10-09T09:00:00Z" } };
  expect(applySupplierCatalogPrices([oldQuote], oldName, catalog, undefined, { supplierGroupId: "115", savedCatalog: true })[0]?.metadata?.priceLabel).toBe(priced.metadata?.priceLabel);
  const missing = { ...catalog, groups: [] };
  expect(applySupplierCatalogPrices([oldQuote], oldName, missing, undefined, { supplierGroupId: "115", savedCatalog: true })[0]?.pricing).toBeUndefined();
  expect(applySupplierCatalogPrices([oldQuote], oldName, missing, undefined, { supplierGroupId: "115", savedCatalog: true })[0]?.metadata?.priceLabel).toBe("价格未公布");
});

it("passes the saved official identity to offline price reads without joining a changed source", async () => {
  const supplier = { id: "stable-group-prices", apiUrl: "https://stable-price.example/v1", siteUrl: "https://stable-price.example", state: { sourceId: "stable-source" },
    catalog: { groups: [{ id: "renamed-images", label: "Renamed", supplierGroupId: "115", models: [], details: { source: "key-groups", description: "$0.07/张" } }] },
    kind: "sub2api", scanStatus: "live", scanComplete: false, scannedAt: "2026-10-09T08:00:00Z", updatedAt: "2026-10-09T08:00:00Z" };
  vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
  const config = { supplierId: supplier.id, supplierSourceId: "stable-source", baseUrl: supplier.apiUrl, accountKeyGroup: "old-images", accountKeyGroupId: "115" };
  const image: ModelDescriptor = { id: "gpt-image-2", name: "GPT Image 2", operations: ["image.generate"], outputKinds: ["image"] };
  expect((await enrichSupplierModelPrices({ config }, [image], false, false))[0]?.metadata?.priceLabel).toBe("$0.07/张（分组说明参考）");
  expect((await enrichSupplierModelPrices({ config: { ...config, supplierSourceId: "different-source" } }, [image], false, false))[0]?.metadata?.priceLabel).toBeUndefined();
  vi.mocked(getSupplierRecord).mockResolvedValue(null);
});
it("replaces only proven automatic Fri snapshots with current exact account group prices and titles", async () => {
  const origin = "https://platform.frimodel.com", actual = await vi.importActual<typeof import("@super-canvas/providers")>("@super-canvas/providers");
  const rows = [
    { model_name: "gpt-image-2-adobe", quota_type: 1, model_price: .04, enable_groups: ["gpt_image_adobe"] },
    { model_name: "gemini-3-pro-image-preview", quota_type: 1, model_price: .086, enable_groups: ["gemini_image", "gemini_pro"] },
    { model_name: "gemini-3.1-flash-image-preview", quota_type: 1, model_price: .072, enable_groups: ["gemini_image", "gemini_pro"] },
    { model_name: "gpt-image-2-w", quota_type: 1, model_price: 1, enable_groups: ["codex_image", "gpt_image_web"] },
    { model_name: "gpt-image-2-wc", quota_type: 1, model_price: 1, enable_groups: ["gpt_image_wc"] },
  ];
  const groups = Object.fromEntries(rows.flatMap(row => row.enable_groups).map(group => [group, { ratio: /codex_image|gpt_image_web|gpt_image_wc/u.test(group) ? .02 : 1, desc: group }]));
  const catalog = await actual.discoverSupplierCatalog({ kind: "newapi", siteUrl: origin, apiUrl: origin + "/v1", token: "synthetic-account-token:42" }, async input => {
    const url = new URL(String(input)); expect(url.origin).toBe(origin);
    if (url.pathname === "/api/pricing") return Response.json({ data: rows, group_ratio: {}, usable_group: Object.fromEntries(Object.keys(groups).map(group => [group, group])) });
    if (url.pathname === "/api/status") return Response.json({ data: { quota_display_type: "USD", usd_exchange_rate: 7 } });
    if (url.pathname === "/api/user/self/groups") return Response.json({ success: true, data: groups });
    throw new Error("Unexpected mock Fri endpoint");
  });
  for (const group of catalog.groups) for (const row of group.models) {
    const oldLabel = row.id === "gpt-image-2-adobe" ? "$0.05/张" : row.id.startsWith("gemini") ? "$0.1/次" : "$0.025/次";
    const old: ModelDescriptor = { id: row.id, name: `${row.id}（${oldLabel}·快照）`, operations: ["image.generate"], outputKinds: ["image"],
      metadata: { liveInventory: true, protocol: row.id.startsWith("gemini") ? "gemini-generate-content" : "frimodel-images", fixedOutputCount: 1,
        priceLabel: oldLabel, billingLabel: "价格快照", canvasRunnable: false } };
    const fresh = applySupplierCatalogPrices([old], group.id, catalog, origin)[0]!;
    expect(fresh.pricing).toEqual(row.metadata!.officialCatalogPricing);
    expect(fresh.name).toBe(row.id);
    expect(fresh.metadata?.canvasRunnable).toBe(false);
    expect(fresh.metadata?.priceSource).toBe("supplier-catalog");
    expect(fresh.pricing?.currency).toBe("USD");
    expect(fresh.pricing?.unitAmount).toBe(row.id.includes("gemini-3.1") ? .072 : row.id.includes("gemini-3-pro") ? .086 : row.id.includes("adobe") ? .04 : .02);
    expect(applySupplierCatalogPrices([structuredClone(fresh)], group.id, catalog, origin)[0]?.pricing).toEqual(fresh.pricing);
    for (const bad of [{ ...catalog, complete: false }, { ...catalog, status: "failed" as const }])
      expect(applySupplierCatalogPrices([old], group.id, bad, origin)[0]?.name).toBe(old.name);
    for (const priceSource of ["manual", "generated-result"]) {
      const manual = { ...old, name: "用户标题", pricing: { kind: "per-request" as const, currency: "CNY", unitAmount: 99, confidence: "exact" as const, checkedAt: "then" }, metadata: { ...old.metadata, priceSource } };
      expect(applySupplierCatalogPrices([manual], group.id, catalog, origin)[0]).toBe(manual);
    }
    expect(applySupplierCatalogPrices([old], "unrelated-group", catalog, origin)[0]?.name).toBe(old.name);
    expect(applySupplierCatalogPrices([old], group.id, catalog, "https://other.example")[0]?.name).toBe(old.name);
    expect(applySupplierCatalogPrices([{ ...old, metadata: { ...old.metadata, liveInventory: false } }], group.id, catalog, origin)[0]?.name).toBe(old.name);
    const custom = { ...old, name: `自定义（${oldLabel}·快照·备注）` };
    expect(applySupplierCatalogPrices([custom], group.id, catalog, origin)[0]?.name).toBe(custom.name);
  }
});

it("imports and preserves secure/CX/Hang chat cache components without a fabricated media total", async () => {
  const cases: SupplierCatalogDiscovery[] = [
    { kind: "sub2api", status: "live", complete: true, checkedAt: "now", groups: parseSupplierPricingChannels({ data: [{ name: "channel", platforms: [{
      name: "gpt", supported_models: [{ name: "gpt-5.4", pricing: { billing_mode: "token", input_price: 2.5e-6, output_price: 15e-6, cache_read_price: .25e-6, cache_write_price: 0 } }],
      groups: [{ id: 2, name: "GPT", rate_multiplier: .3 }] }] }] }, "CNY", { supplierSiteUrl: "https://token.secure-skill.com", checkedAt: "now" }) },
    { ...parseSupplierCatalog({ data: { groups: [{ name: "ccmax", rate_multiplier: 10, models: [{ name: "claude-fable-5-1", effective_rate_multiplier: .75,
      pricing: { billing_mode: "token", input_price: .00001, output_price: .00005, cache_read_price: .000001, cache_write_price: .0000125, cache_write_1h_price: .00002 } }] }] } },
    { supplierSiteUrl: "https://vapi.chuangxiangai.asia", checkedAt: "now" }), status: "live", complete: true, checkedAt: "now" },
  ];
  const actual = await vi.importActual<typeof import("@super-canvas/providers")>("@super-canvas/providers");
  cases.push(await actual.discoverSupplierCatalog({ siteUrl: "https://api.hangzhale.com", apiUrl: "https://api.hangzhale.com/v1", kind: "sub2api" }, async input => {
    const url = new URL(String(input));
    if (url.origin === "https://price.hangzhale.com") return Response.json({ data: { currency: "CNY", price_unit: "per_1m_tokens", models: [
      { group_name: "GPT 稳定", model_name: "gpt-5.5", enabled: true, input_price: 1.25, output_price: 7.5, cache_input_price: .125, group_multiplier: .25 } ] } });
    if (url.pathname === "/api/v1/groups/available") return Response.json({ code: 0, data: [{ id: 77, name: "GPT 稳定" }] });
    return Response.json({}, { status: 404 });
  }));
  for (const catalog of cases) {
    const group = catalog.groups[0]!, row = group.models[0]!, model: ModelDescriptor = { id: row.id, name: row.id, operations: [], outputKinds: ["text"] };
    const fresh = applySupplierCatalogPrices([model], group.id, catalog)[0]!;
    expect(fresh.pricing?.kind).toBe("token");
    expect(fresh.pricing?.inputPerMillion).toBeUndefined();
    expect(fresh.pricing?.tiers?.some(t => t.conditions?.some(c => c.value === "cache_read"))).toBe(true);
    expect(modelPriceSummary(fresh, {})).toContain("缓存条件");
    expect(modelEstimatedCost(fresh, { duration: 30, n: 2 })).toBeUndefined();
    const cached = applySupplierCatalogPrices([structuredClone(fresh)], group.id, catalog)[0]!;
    expect(cached.pricing).toEqual(fresh.pricing);
    expect(applySupplierCatalogPrices([model], "wrong-group", catalog)[0]?.pricing).toBeUndefined();
    const old: ModelDescriptor = { ...model, pricing: { kind: "token", currency: "CNY", inputPerMillion: 99, outputPerMillion: 199, confidence: "snapshot", checkedAt: "then" },
      metadata: { priceSource: "supplier-catalog", priceLabel: "输入 ¥99/1M", supplierPriceGroup: group.id } };
    expect(applySupplierCatalogPrices([old], group.id, catalog)[0]?.pricing).toEqual(fresh.pricing);
    if (catalog === cases[2]) {
      const media: ModelDescriptor = { ...old, operations: ["image.generate"], outputKinds: ["image"],
        pricing: { kind: "per-request", currency: "USD", unitAmount: .1, confidence: "exact", checkedAt: "then" } };
      for (const origin of ["https://api.hangzhale.com", "https://api.hangzhale.com/v1"])
        expect(applySupplierCatalogPrices([media], group.id, catalog, origin)[0]).toBe(media);
      expect(applySupplierCatalogPrices([old], group.id, catalog, "https://api.hangzhale.com/v1")[0]?.pricing).toEqual(fresh.pricing);
    }
  }
});
async function discoverWeAiSnapshotFixture(): Promise<SupplierCatalogDiscovery> {
  const fixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/__fixtures__/weai-legacy-price-20261008.json", import.meta.url), "utf8")) as {
    initial: { data: { groups: { id: number; name: string }[] } }; groups: { groupId: number; payload: unknown }[];
  };
  const actual = await vi.importActual<typeof import("@super-canvas/providers")>("@super-canvas/providers");
  return actual.discoverSupplierCatalog({ kind: "sub2api", siteUrl: weaiSnapshotOrigin, apiUrl: weaiSnapshotOrigin + "/v1" }, async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin).toBe(weaiSnapshotOrigin);
    if (url.pathname === "/api/v1/groups/available") return Response.json({ code: 0, data: fixture.initial.data.groups });
    if (url.pathname === "/api/v1/model-plaza-legacy/models") {
      const id = url.searchParams.get("group_id"), payload = id ? fixture.groups.find(g => String(g.groupId) === id)?.payload : fixture.initial;
      return payload ? Response.json(payload) : Response.json({ code: 404 }, { status: 404 });
    }
    return Response.json({ code: 404 }, { status: 404 });
  });
}
function automaticWeAiDocsSnapshot(id: string, pricing: WeAiLiveModelPricing): ModelDescriptor {
  return applyWeAiLivePricing([{ id, name: id, operations: ["image.generate"], outputKinds: ["image"], metadata: { canvasRunnable: false } }], {
    groupId: "fixture-group-1", source: "official-docs", sourceUrl: "https://docs.we-ai.cc/guides/image-generation-service.html",
    checkedAt: "2026-10-08T23:23:19.298Z", complete: false, multiplier: 1, models: { [id]: pricing },
  })[0]!;
}

it("replaces the five real automatic We-AI docs snapshots with exact account quotes through saved and cached readback", async () => {
  const catalog = await discoverWeAiSnapshotFixture();
  expect(catalog.complete).toBe(true);
  const reads = vi.mocked(discoverSupplierCatalog).mock.calls.length;
  const cases: [number, string, WeAiLiveModelPricing][] = [
    [101, "gpt-image-2", { kind: "token", multiplier: 1, input: 5, output: 10, imageOutput: 30, cacheRead: 1.25 }],
    [105, "gpt-image-2", { kind: "token", multiplier: 3, input: 15, output: 30, imageOutput: 90, cacheRead: 3.75 }],
    ...(["low", "medium", "high"] as const).map((quality, index): [number, string, WeAiLiveModelPricing] => [107, `gpt-image-2-${quality}`, {
      kind: "per-request", multiplier: 1, tiers: [{ id: "request", label: "单次", price: [.04, .07, .15][index]! }],
    }]),
  ];
  for (const [groupId, id, docsPricing] of cases) {
    const group = catalog.groups.find(g => g.supplierGroupId === String(groupId))!;
    const expected = group.models.find(m => m.id === id)!.metadata!.weaiLegacyPricing as NonNullable<ModelDescriptor["pricing"]>;
    const old = automaticWeAiDocsSnapshot(id, docsPricing);
    expect(old.metadata).toMatchObject({ pricingSource: "official-docs", pricingComplete: false });
    expect(old.metadata?.priceSource).toBeUndefined();
    const current = applySupplierCatalogPrices([old], group.id, catalog, weaiSnapshotOrigin)[0]!;
    expect(current.pricing).toEqual(expected);
    expect(current.name).toBe(id);
    // The first source-priority repair imported the quote but left its old
    // generated title. A subsequent cached refresh must repair that title too.
    const previouslyImported = { ...current, name: old.name };
    const rebound = applySupplierCatalogPrices([previouslyImported], group.id, catalog, weaiSnapshotOrigin)[0]!;
    expect(rebound.name).toBe(id);
    expect(rebound.pricing).toEqual(expected);
    for (const unrelated of [
      { ...previouslyImported, metadata: { ...previouslyImported.metadata, pricingSourceUrl: "https://unrelated.invalid/guides/image-generation-service.html" } },
      { ...previouslyImported, metadata: { ...previouslyImported.metadata, supplierPriceGroup: "other-group" } },
    ]) expect(applySupplierCatalogPrices([unrelated], group.id, catalog, weaiSnapshotOrigin)[0]?.name).toBe(old.name);
    const titled = { ...old, name: `用户标题（保留）${old.name.slice(id.length)}` };
    expect(applySupplierCatalogPrices([titled], group.id, catalog, weaiSnapshotOrigin)[0]?.name).toBe("用户标题（保留）");
    const custom = { ...old, name: `用户标题（${String(old.metadata?.priceLabel)} · 1K/2K/4K · 自定义备注）` };
    expect(applySupplierCatalogPrices([custom], group.id, catalog, weaiSnapshotOrigin)[0]?.name).toBe(custom.name);
    expect(current.metadata).toMatchObject({ priceSource: "supplier-catalog", priceStatus: "available", supplierPriceGroup: group.id, canvasRunnable: false });
    if (groupId === 101) expect(current.pricing).toMatchObject({ inputPerMillion: 3.5, outputPerMillion: 7, imageOutputPerMillion: 21 });
    if (groupId === 101 || groupId === 105) {
      expect(current.pricing?.inputPerMillion).not.toBe(old.pricing?.inputPerMillion);
      expect(current.pricing?.tiers?.some(t => t.conditions?.some(c => c.parameter === "token_kind" && c.value === "cache_read"))).toBe(true);
      expect(modelEstimatedCost(current, { n: 2 })).toBeUndefined();
    } else {
      const amount = id.endsWith("low") ? .03 : id.endsWith("medium") ? .05 : .15;
      expect(current.pricing).toMatchObject({ kind: "per-request", currency: "USD", billingUnit: "request", unitAmount: amount });
      expect(current.pricing?.tiers?.map(t => t.value)).toEqual(["1K", "2K", "4K"]);
      for (const resolution of ["1K", "2K", "4K"]) {
        expect(modelPriceSummary(current, { resolution })).toBe(`${amount} USD / 次`);
        expect(modelEstimatedCost(current, { resolution, n: 2 })).toBe(`${Number((amount * 2).toPrecision(12))} USD`);
      }
    }
    const supplier = { id: `weai-docs-repair-${groupId}-${id}`, siteUrl: weaiSnapshotOrigin, apiUrl: weaiSnapshotOrigin + "/v1", kind: "sub2api",
      state: { sourceId: "weai-docs-source" }, catalog: { groups: catalog.groups }, scanStatus: "live", scanComplete: true, scannedAt: catalog.checkedAt, updatedAt: catalog.checkedAt };
    vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    try {
      const saved = JSON.parse(JSON.stringify(current)) as ModelDescriptor;
      const cached = await enrichSupplierModelPrices({ config: { supplierId: supplier.id, supplierSourceId: supplier.state.sourceId, baseUrl: supplier.apiUrl, modelGroup: group.id } }, [saved], false, false);
      expect(cached[0]?.pricing).toEqual(expected);
      expect(cached[0]?.name).toBe(id);
      const partial = applySupplierCatalogPrices(cached, group.id, { ...catalog, complete: false, groups: [], checkedAt: "2026-10-09T00:00:00Z" }, weaiSnapshotOrigin)[0]!;
      expect(partial.pricing).toEqual(expected);
      expect(partial.metadata).toMatchObject({ priceStatus: "partial", priceCheckedAt: expected.checkedAt });
    } finally { vi.mocked(getSupplierRecord).mockResolvedValue(null); }
  }
  expect(discoverSupplierCatalog).toHaveBeenCalledTimes(reads);
});

it("preserves explicit manual and measured We-AI prices instead of treating them as docs snapshots", async () => {
  const catalog = await discoverWeAiSnapshotFixture(), group = catalog.groups.find(g => g.supplierGroupId === "101")!;
  const old = automaticWeAiDocsSnapshot("gpt-image-2", { kind: "token", multiplier: 1, input: 5, output: 10, imageOutput: 30 });
  for (const priceSource of ["manual", "generated-result"]) {
    const own = { ...old, metadata: { ...old.metadata, priceSource }, pricing: { ...old.pricing!, inputPerMillion: 123 } };
    const current = applySupplierCatalogPrices([own], group.id, catalog, weaiSnapshotOrigin)[0]!;
    expect(current.pricing).toBe(own.pricing);
    expect(current.name).toBe(own.name);
    expect(current.metadata).toMatchObject({ priceSource, pricingSource: "official-docs", pricingComplete: false });
    const unknown = structuredClone(catalog); const row = unknown.groups.find(g => g.id === group.id)!.models.find(m => m.id === old.id)!;
    row.metadata = { weaiLegacyPricingIncomplete: true };
    const unconfirmed = applySupplierCatalogPrices([own], group.id, unknown, weaiSnapshotOrigin)[0]!;
    expect(unconfirmed.pricing).toBe(own.pricing);
    expect(unconfirmed.name).toBe(own.name);
    expect(unconfirmed.metadata).toMatchObject({ priceSource, pricingSource: "official-docs", pricingComplete: false });
  }
});

it("never borrows another group or supplier quote, or replaces a known We-AI snapshot with partial or undecoded pricing", async () => {
  const catalog = await discoverWeAiSnapshotFixture(), group = catalog.groups.find(g => g.supplierGroupId === "101")!;
  const old = automaticWeAiDocsSnapshot("gpt-image-2", { kind: "token", multiplier: 1, input: 5, output: 10, imageOutput: 30 });
  for (const mutate of [
    (c: SupplierCatalogDiscovery) => { c.complete = false; },
    (c: SupplierCatalogDiscovery) => { c.status = "unauthorized"; },
    (c: SupplierCatalogDiscovery) => { c.groups.find(g => g.id === group.id)!.details = { source: "model-plaza", stale: true }; },
    (c: SupplierCatalogDiscovery) => { c.groups.find(g => g.id === group.id)!.supplierGroupId = "105"; },
    (c: SupplierCatalogDiscovery) => { const row = c.groups.find(g => g.id === group.id)!.models.find(m => m.id === old.id)!; row.metadata = { weaiLegacyPricingIncomplete: true }; },
    (c: SupplierCatalogDiscovery) => { const p = c.groups.find(g => g.id === group.id)!.models.find(m => m.id === old.id)!.metadata!.weaiLegacyPricing as NonNullable<ModelDescriptor["pricing"]>; p.currency = "EUR"; },
    (c: SupplierCatalogDiscovery) => { const row = c.groups.find(g => g.id === group.id)!.models.find(m => m.id === old.id)!; row.metadata = { ...row.metadata, weaiLegacyPriceEvidence: { imageTierPricesComplete: false } }; },
  ]) {
    const incomplete = structuredClone(catalog); mutate(incomplete);
    const preserved = applySupplierCatalogPrices([old], group.id, incomplete, weaiSnapshotOrigin)[0]!;
    expect(preserved.pricing).toBe(old.pricing);
    expect(preserved.name).toBe(old.name);
  }
  expect(applySupplierCatalogPrices([old], "unknown-group", catalog, weaiSnapshotOrigin)[0]?.pricing).toBe(old.pricing);
  expect(applySupplierCatalogPrices([old], group.id, catalog, "https://other.invalid")[0]?.pricing).toBe(old.pricing);
  const alias = { ...old, id: old.id + "-preview" };
  expect(applySupplierCatalogPrices([alias], group.id, catalog, weaiSnapshotOrigin)[0]?.pricing).toBe(old.pricing);
});

it("keeps Afei's pending declared video unpriced through public parsing and an old serialized token catalog", () => {
  const origin = "https://api.3365api.cn", id = "ya-sd25-30s", group = "special", checkedAt = "2026-10-08T23:10:00Z";
  const raw = { model_name: id, quota_type: 0, model_price: 0, model_ratio: 37.5, completion_ratio: 1, enable_groups: [group] };
  const payload = { data: [raw], group_ratio: { [group]: 1 }, usable_group: { [group]: "视频特价，0.3/秒" } };
  const current: SupplierCatalogDiscovery = { ...parseSupplierCatalog(payload, { supplierSiteUrl: origin }), checkedAt, status: "live", complete: true };
  const legacy: ModelDescriptor = { id, name: `${id} · 输入 $75 / 1M · 输出 $75 / 1M`, operations: ["video.generate"], metadata: { supplier: "cyberafei", canvasRunnable: false,
    priceLabel: "输入 $75 / 1M · 输出 $75 / 1M" } };
  const repaired = applySupplierCatalogPrices([legacy], group, current, origin)[0]!;
  expect(repaired.metadata).toMatchObject({ canvasRunnable: false, cyberAfeiCatalogPricingIncomplete: true, priceStatus: "unconfirmed", priceLabel: "价格条件待确认" });
  expect(repaired.pricing).toBeUndefined();
  expect(repaired.name).toBe(id);
  expect(modelEstimatedCost(repaired, { duration: 30 })).toBeUndefined();
  const resolved = resolveCyberAfeiScannedGroup(cyberAfeiCatalogFromPricing(payload), group, [id]);
  const pending: ModelDescriptor = JSON.parse(JSON.stringify(resolved.canvasDisplayModels[0]));
  const oldCatalog: SupplierCatalogDiscovery = { ...parseSupplierCatalog(payload), checkedAt: "2026-10-07T23:10:00Z", status: "live", complete: true };
  const cached = applySupplierCatalogPrices([pending], group, oldCatalog, origin, { savedCatalog: true })[0]!;
  expect(cached.metadata?.priceLabel).toBe("价格条件待确认");
  expect(cached.pricing).toBeUndefined();
  expect(modelEstimatedCost(cached, { duration: 30 })).toBeUndefined();
  const manual: ModelDescriptor = { ...legacy, pricing: { kind: "per-second", currency: "CNY", unitAmount: .3, confidence: "exact", checkedAt },
    metadata: { ...legacy.metadata, priceSource: "manual", priceLabel: "¥0.3/秒" } };
  expect(applySupplierCatalogPrices([manual], group, current, origin)[0]?.pricing).toBe(manual.pricing);
  const unrelated = applySupplierCatalogPrices([{ ...legacy, metadata: { ...legacy.metadata, priceSource: "supplier-catalog" } }], group, oldCatalog, "https://other.invalid")[0]!;
  expect(unrelated.metadata?.priceLabel).toContain("$75/1M");
});
const model: ModelDescriptor = {
  id: "new-image",
  name: "new-image（价格以平台为准）",
  operations: [],
  metadata: { canvasRunnable: false },
};
it.each(["nano-banana-pro", "veo3.1-lite"])("generic enrichment preserves %s high-resolution quotes from the exact current Cyber group", id => {
  const group = "图片视频模型综合分组", origin = "https://api.3365api.cn", description = id === "nano-banana-pro"
    ? "高质量图片生成。1K/2K 1.125额度/次，4K 1.65额度/次。" : "轻量视频生成。720p 3、1080p 3.75、4K 15额度/次。";
  const parsed = parseSupplierCatalog({ group_ratio: { [group]: 1 }, data: [{ model_name: id, quota_type: 1, model_price: 1.125, description, enable_groups: [group] }] },
    { supplierSiteUrl: origin, checkedAt: "now" });
  const quote = parsed.groups[0]!.models[0]!.metadata?.officialCatalogPricing as NonNullable<ModelDescriptor["pricing"]>;
  const descriptor: ModelDescriptor = { id, name: id, operations: id.includes("banana") ? ["image.generate"] : ["video.generate"], pricing: quote,
    metadata: { priceSource: "supplier-catalog", priceLabel: parsed.groups[0]!.models[0]!.priceLabel } };
  const enriched = applySupplierCatalogPrices([descriptor], group, { ...parsed, status: "live", kind: "newapi", complete: true, checkedAt: "now" }, origin)[0]!;
  expect(enriched.pricing).toEqual(quote);
  expect(modelPriceSummary(enriched, { resolution: "4K" })).toBe(`${id.includes("banana") ? 1.65 : 15} USD / 次`);
  expect(modelEstimatedCost(enriched, { resolution: "4K", n: 1 })).toBe(`${id.includes("banana") ? 1.65 : 15} USD`);
  expect(modelEstimatedCost(enriched, {})).toBeUndefined();
  expect(modelPriceSummary(enriched, { resolution: "{{resolution}}" })).toBe(enriched.metadata?.priceLabel);
  expect(modelEstimatedCost(enriched, { resolution: "{{resolution}}", n: 1 })).toBeUndefined();
});
it("preserves Cyber Omni's generate/edit resolution prices through generic supplier enrichment", () => {
  const origin = "https://api.3365api.cn", group = "图片视频模型综合分组", id = "omni-flash";
  const payload = { group_ratio: { [group]: 1 }, data: [{ model_name: id, quota_type: 1, model_price: 8.25, enable_groups: [group],
    supported_endpoint_types: ["openai"], description: "Omni 生成编辑视频。生成：720p 8.25、1080p 15、4K 21额度/次；编辑：720p 10.5、1080p 15、4K 21额度/次。" }] };
  const descriptor = resolveCyberAfeiScannedGroup(cyberAfeiCatalogFromPricing(payload), group, [id]).canvasDisplayModels.find(model => model.id === id)!;
  const parsed = parseSupplierCatalog(payload, { supplierSiteUrl: origin, checkedAt: "now" });
  const enriched = applySupplierCatalogPrices([descriptor], group, { ...parsed, status: "live", kind: "newapi", complete: true, checkedAt: "now" }, origin)[0]!;
  expect(enriched.pricing).toEqual(descriptor.pricing);
  expect(enriched.pricing?.unitAmount).toBeUndefined();
  expect(modelEstimatedCost(enriched, { mode: "generate", resolution: "720p" })).toBe("8.25 USD");
  expect(modelEstimatedCost(enriched, { mode: "edit", resolution: "720p" })).toBe("10.5 USD");
  expect(modelEstimatedCost(enriched, { mode: "{{mode}}", resolution: "720p" })).toBeUndefined();
  expect(modelPriceSummary(enriched, { mode: "{{mode}}", resolution: "{{resolution}}" })).toBe(descriptor.metadata?.priceLabel);
});

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
describe("Secure group-specific optional video resolutions", () => {
  const origin = "https://token.secure-skill.com", group = "海外sd2.0/2.5-7.5折", checkedAt = "2026-10-09T14:03:13.004Z";
  const ids = ["doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628"];
  const catalog = (): SupplierCatalogDiscovery => ({ kind: "sub2api", status: "live", complete: true, checkedAt,
    groups: [{ id: group, label: group, supplierGroupId: "56", source: "catalog", details: { source: "key-groups" }, models: ids.map((id, index) => ({ id, capability: "video" as const,
      priceLabel: index ? "480p · 不含参考视频 ¥53.4375/1M tokens" : "480p ¥35/1M tokens · 4K ¥9.8/1M tokens",
      metadata: { secureSkillCatalogPricing: { kind: "token", currency: "CNY", confidence: "exact", checkedAt,
        sourceUrl: origin + "/api/v1/pricing/channels", tiers: (index ? ["480p"] : ["480p", "4K"]).map(resolution => ({
          id: resolution, label: resolution, price: 35, conditionMode: "all", conditions: [
            { parameter: "token_kind", operator: "equals", value: "output" }, { parameter: "resolution", operator: "equals", value: resolution },
          ],
        })) } },
    })) }],
  });
  const model = (id = ids[0]!) => remainingVideoModel("secure", id, undefined, { group })!;
  const resolutions = (m: ModelDescriptor) => m.parameters?.find(p => p.key === "resolution")?.options?.map(o => o.value);
  it("applies only each exact group's model-specific tiers and withdraws old optional resolution evidence", () => {
    const lookup = catalog();
    const output = applySupplierCatalogPrices(ids.map(id => model(id)), group, lookup, origin, { supplierGroupId: "56" });
    expect(resolutions(output[0]!)).toEqual(["720p", "1080p", "480p", "4K"]);
    expect(resolutions(output[1]!)).toEqual(["720p", "1080p", "480p"]);
    expect(output[0]?.pricing).toBe(lookup.groups[0]?.models[0]?.metadata?.secureSkillCatalogPricing);
    expect(output[0]?.metadata?.protocol).toBe("openai-videos");
    const no4K = catalog();
    const pricing = no4K.groups[0]!.models[0]!.metadata!.secureSkillCatalogPricing as NonNullable<ModelDescriptor["pricing"]>;
    pricing.tiers = pricing.tiers!.filter(tier => tier.id !== "4K");
    expect(resolutions(applySupplierCatalogPrices([output[0]!], group, no4K, origin, { supplierGroupId: "56" })[0]!)).toEqual(["720p", "1080p", "480p"]);
    expect(resolutions(applySupplierCatalogPrices([model()], "doubao-full", lookup, origin, { supplierGroupId: "42" })[0]!)).toEqual(["720p", "1080p"]);
  });
  it.each(["stale-group", "stale-model", "estimate", "wrong-price-origin", "manual", "paid-test", "custom-protocol"])(
    "does not let %s evidence modify automatic video controls", kind => {
      const lookup = catalog(), original = model();
      if (kind === "stale-group") lookup.groups[0]!.details!.stale = true;
      if (kind === "stale-model") lookup.groups[0]!.models[0]!.metadata = { ...lookup.groups[0]!.models[0]!.metadata, supplierCatalogModelStale: true };
      const pricing = lookup.groups[0]!.models[0]!.metadata!.secureSkillCatalogPricing as NonNullable<ModelDescriptor["pricing"]>;
      if (kind === "estimate") pricing.confidence = "estimate";
      if (kind === "wrong-price-origin") pricing.sourceUrl = "https://other.example/pricing";
      if (kind === "manual") original.metadata = { ...original.metadata, source: "manual" };
      if (kind === "paid-test") original.metadata = { ...original.metadata, protocolEvidence: "paid-test" };
      if (kind === "custom-protocol") original.metadata = { ...original.metadata, protocol: "user-saved-native" };
      const output = applySupplierCatalogPrices([original], group, lookup, origin, { supplierGroupId: "56" })[0]!;
      expect(output.parameters).toBe(original.parameters);
    });
});
it.each(["https://token.secure-skill.com", "https://token.secure-skill.com/api/v1/pricing/channels"])(
  "explains an unquoted exact Secure Wan ID without borrowing or overwriting Prime's price (%s)", origin => {
    const checkedAt = "2026-10-09T11:59:00Z", group = "Wan", sourceUrl = "https://token.secure-skill.com/api/v1/pricing/channels";
    const primePricing: NonNullable<ModelDescriptor["pricing"]> = { kind: "per-second", currency: "CNY", unitAmount: .5,
      billingUnit: "second", confidence: "exact", checkedAt, sourceUrl };
    const current: SupplierCatalogDiscovery = { kind: "sub2api", status: "live", complete: true, checkedAt,
      groups: [{ id: group, label: group, source: "catalog", models: [{ id: "wan3.0-prime", capability: "video", priceLabel: "¥0.5/秒",
        metadata: { secureSkillCatalogPricing: primePricing } }] }] };
    const models: ModelDescriptor[] = ["wan3.0", "wan3.0-prime"].map(id => ({ id, name: id, operations: ["video.generate"], outputKinds: ["video"],
      metadata: { canvasRunnable: true } }));
    const [wan, prime] = applySupplierCatalogPrices(models, group, current, origin);
    expect(wan?.pricing).toBeUndefined();
    expect(wan?.metadata).toMatchObject({ canvasRunnable: true, priceStatus: "unpublished", priceLabel: "价格未公布", priceCheckedAt: checkedAt,
      priceSourceUrl: sourceUrl, priceUnavailableReason: `${checkedAt} 已查询 ${sourceUrl}：当前分组 Wan 未列出完整型号 wan3.0 的报价` });
    expect(modelEstimatedCost(wan!, { duration: 6 })).toBeUndefined();
    expect(prime?.pricing).toEqual(primePricing);
    expect(prime?.metadata?.priceUnavailableReason).toBeUndefined();
    expect(prime?.metadata?.canvasRunnable).toBe(true);
    expect(modelEstimatedCost(prime!, { duration: 6 })).toBe("3 CNY");
  });

it("replaces Miaowu's catalog-owned token placeholder with exact native video rules through saved and cached enrichment", async () => {
  const checkedAt = "2026-10-08T22:37:14.000Z", origin = "https://api.miaowuai.store";
  const payload = JSON.parse(readFileSync(new URL("./miaowu-catalog-20261008.fixture.json", import.meta.url), "utf8"));
  const parsed = parseSupplierCatalog(payload, { supplierSiteUrl: origin, currency: "CNY", multiplier: 7, checkedAt });
  const group = parsed.groups.find(item => item.id === "default")!;
  expect(group.models.filter(item => item.capability === "video")).toHaveLength(11);
  expect(group.models.filter(item => item.capability === "image")).toHaveLength(7);
  const old: ModelDescriptor = { id: "dola-seedance-2.0-fast", name: "Dola", operations: ["video.generate"], outputKinds: ["video"],
    pricing: { kind: "token", currency: "CNY", inputPerMillion: 525, checkedAt: "2026-10-08T11:24:06Z", confidence: "exact", sourceUrl: origin + "/api/pricing" },
    metadata: { priceSource: "supplier-catalog", priceLabel: "输入 ¥525/1M", supplierPriceGroup: "default", canvasRunnable: false } };
  const catalog: SupplierCatalogDiscovery = { groups: parsed.groups, status: "live", kind: "newapi", complete: true, checkedAt };
  const model = applySupplierCatalogPrices([old], "default", catalog, origin)[0]!;
  expect(model.pricing).toMatchObject({ kind: "per-request", currency: "CNY", billingUnit: "request", tiers: [{ value: "720p", price: .875 }] });
  expect(model.metadata).toMatchObject({ priceSource: "supplier-catalog", priceCheckedAt: checkedAt, supplierPriceGroup: "default", canvasRunnable: false });
  expect(modelPriceSummary(model, { resolution: "720p" })).toBe("0.875 CNY / 次");
  expect(modelEstimatedCost(model, { resolution: "720p", duration: 30 })).toBe("0.875 CNY");
  expect(modelEstimatedCost(model, { resolution: "1080p", duration: 30 })).toBeUndefined();
  const saved = JSON.parse(JSON.stringify(model)) as ModelDescriptor;
  const supplier = { id: "miaowu-cached-price-fixture", siteUrl: origin, apiUrl: origin, kind: "newapi", state: { sourceId: "miaowu-fixture-source" },
    catalog: { groups: parsed.groups }, scanStatus: "live", scanComplete: true, scannedAt: checkedAt, updatedAt: checkedAt };
  vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
  const reads = vi.mocked(discoverSupplierCatalog).mock.calls.length;
  const cached = await enrichSupplierModelPrices({ config: { supplierId: supplier.id, supplierSourceId: supplier.state.sourceId, baseUrl: origin, modelGroup: "default" } }, [saved], false, false);
  expect(cached[0]?.pricing).toEqual(saved.pricing);
  expect(modelPriceSummary(cached[0], { resolution: "720p" })).toBe("0.875 CNY / 次");
  expect(vi.mocked(discoverSupplierCatalog).mock.calls.length).toBe(reads);
  // A native adapter's same-model quote is independently owned, so the
  // placeholder catalog cannot replace its established media pricing.
  const own = { ...saved, metadata: { priceLabel: "¥0.875/次", parameterSource: "pricing.video_api" } };
  expect(applySupplierCatalogPrices([own], "default", { ...catalog, groups: [{ ...group, models: [{ id: own.id, capability: "video", priceLabel: "输入 ¥525/1M" }] }] }, origin)[0]).toBe(own);
  vi.mocked(getSupplierRecord).mockResolvedValue(null);
});

it("keeps unknown Miaowu media price conditions pending and recovers only from fresh exact rules", () => {
  const origin = "https://api.miaowuai.store", id = "dola-seedance-2.5", checkedAt = "2026-10-08T22:37:14Z";
  const row = { model_name: id, quota_type: 0, model_ratio: 37.5, enable_groups: ["default"], video_api: { pricing: { unit: "per_call", rules: [{ size: "720p", price: .125 }] } } };
  const discovery = (payload: unknown): SupplierCatalogDiscovery => ({ kind: "newapi", status: "live", complete: true, checkedAt,
    groups: parseSupplierCatalog({ data: [payload] }, { supplierSiteUrl: origin, currency: "CNY", multiplier: 7, checkedAt }).groups });
  const model: ModelDescriptor = { id, name: id, operations: ["video.generate"], metadata: { canvasRunnable: false } };
  const current = applySupplierCatalogPrices([model], "default", discovery(row), origin)[0]!;
  const pending = applySupplierCatalogPrices([current], "default", discovery({ ...row, video_api: { pricing: { unit: "token", rules: row.video_api.pricing.rules } } }), origin)[0]!;
  expect(pending.pricing).toBeUndefined();
  expect(pending.metadata).toMatchObject({ priceStatus: "unconfirmed", priceLabel: "价格条件待确认", miaowuCatalogPricingIncomplete: true });
  expect(modelEstimatedCost(pending, { resolution: "720p" })).toBeUndefined();
  const restored = applySupplierCatalogPrices([pending], "default", discovery(row), origin)[0]!;
  expect(restored.metadata?.miaowuCatalogPricingIncomplete).toBeUndefined();
  expect(modelPriceSummary(restored, { resolution: "720p" })).toBe("0.875 CNY / 次");
  const partial = applySupplierCatalogPrices([restored], "default", { ...discovery(row), groups: [], complete: false }, origin)[0]!;
  expect(partial.pricing).toEqual(restored.pricing);
  expect(partial.metadata?.priceStatus).toBe("partial");
  expect(modelEstimatedCost(partial, { resolution: "720p" })).toBeUndefined();
});

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
  it("uses explicit yuan in a group quote before shared backend credit amounts", () => {
    const catalog: SupplierCatalogDiscovery = { kind: "sub2api", status: "live", complete: false, checkedAt: "2026-10-09T13:00:00Z", groups: [{
      id: "banana-pro", label: "banana-pro", supplierGroupId: "43", source: "catalog", models: [], details: {
        source: "key-groups", description: "0.05元/张分组", imagePrices: ["1K", "2K", "4K"].map(resolution => ({ resolution, amount: .05 })),
      },
    }] };
    const model = withLegacyMikotoGroupPrice(mikotoImageModel("N nano-banana-pro"));
    const priced = applySupplierCatalogPrices([model], "banana-pro", catalog, "https://token.secure-skill.com", { supplierGroupId: "43" })[0]!;
    expect(priced.pricing).toMatchObject({ kind: "per-image", currency: "CNY", unitAmount: .05 });
    expect(modelPriceSummary(priced, { size_tier: "4K" })).toBe("0.05 CNY / 张");
    expect(modelEstimatedCost(priced, { n: 1, size_tier: "4K" })).toBe("0.05 CNY");
    const conditional = structuredClone(catalog); conditional.groups[0]!.details!.description = "4K 0.05元/张分组";
    const condition = applySupplierCatalogPrices([mikotoImageModel("N nano-banana-pro")], "banana-pro", conditional, "https://token.secure-skill.com", { supplierGroupId: "43" })[0]!;
    expect(condition.pricing?.kind).not.toBe("per-image");
  });
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
  it("repairs both explicitly priced pDog aliases while their old protocol cache is pending", () => {
    const ids = ["gemini-3.1-flash-image-preview", "gemini-3-pro-image", "gemini-3.6-flash-image", "gemini-nano-banana-2.1"];
    const images = ids.map(id => ({ id, name: id, operations: [], outputKinds: ["image" as const],
      metadata: { canvasRunnable: false, protocol: "unknown", priceLabel: "价格未公布", priceSource: "supplier-catalog" } }));
    const group = { id: "香蕉", label: "香蕉", source: "catalog" as const,
      models: ids.map(id => ({ id, capability: "image" as const })), details: { source: "key-groups" as const,
        description: `香蕉2：0.07/张, ID：${ids[0]}\n香蕉pro：0.08/张, ID：${ids[1]}\n香蕉2.1：0.07/张，ID：${ids[3]}(${ids[2]})` } };
    const priced = applySupplierCatalogPrices(images, group.id, { ...catalog, groups: [group] });
    expect(priced.slice(2).map(image => image.metadata?.priceLabel)).toEqual([
      "香蕉2.1：0.07/张（分组说明参考）", "香蕉2.1：0.07/张（分组说明参考）",
    ]);
    for (const image of priced.slice(2)) {
      expect(image.metadata).toMatchObject({ priceStatus: "available", priceSource: "supplier-group", canvasRunnable: false });
      expect(image.pricing).toBeUndefined(); // Public group wording supplies no currency.
    }
  });
  it("uses declared image output for Midjourney pricing and excludes declared text output from image group prices", () => {
    const pending: ModelDescriptor = { id: "midjourney-1k", name: "midjourney-1k", operations: [], outputKinds: ["image"], metadata: {} };
    const text: ModelDescriptor = { id: "gemini-3.6-flash-image", name: "text only", operations: [], outputKinds: ["text"], metadata: { outputKindsSource: "declared" } };
    const group = { id: "images", label: "images", source: "catalog" as const,
      models: [{ id: pending.id, capability: "image" as const }, { id: text.id, capability: "chat" as const }],
      details: { source: "key-groups" as const, description: "¥0.4/次" } };
    const priced = applySupplierCatalogPrices([pending, text], group.id, { ...catalog, groups: [group] });
    expect(priced[0]?.pricing).toMatchObject({ kind: "per-request", currency: "CNY", unitAmount: .4 });
    expect(priced[1]?.metadata?.priceLabel).toBe("价格未公布");
    expect(priced[1]?.pricing).toBeUndefined();
    const conditional = { ...group, details: { ...group.details, description: "1K ¥0.2/张；4K ¥0.4/张" } };
    const quoted = applySupplierCatalogPrices([pending], group.id, { ...catalog, groups: [conditional] })[0]!;
    expect(quoted.metadata?.priceLabel).toContain("1K ¥0.2/张");
    expect(quoted.pricing).toBeUndefined();
  });
  it("displays the current mixed Grok group's video rate separately from its image quote", () => {
    const ids = ["grok-imagine-image", "grok-imagine-video", "grok-imagine-video-1.5"];
    const models: ModelDescriptor[] = ids.map((id, index) => ({ id, name: id, operations: [], outputKinds: [index ? "video" : "image"], metadata: {} }));
    const group = { id: "grok heavy", label: "grok heavy", source: "catalog" as const,
      models: ids.map((id, index) => ({ id, capability: index ? "video" as const : "image" as const })),
      details: { source: "key-groups" as const, description: "图片 0.02一张\n视频 0.18/s", rateMultiplier: .1 } };
    const priced = applySupplierCatalogPrices(models, group.id, { ...catalog, groups: [group] });
    expect(priced.map(model => model.metadata?.priceLabel)).toEqual([
      "图片 0.02一张（分组说明参考）", "视频 0.18/s（分组说明参考）", "视频 0.18/s（分组说明参考）",
    ]);
    expect(priced.every(model => model.pricing === undefined)).toBe(true); // No currency or further multiplier is implied.
    const imageOnly = { ...group, details: { ...group.details, description: "生图5分一张" } };
    const unquoted = applySupplierCatalogPrices([models[1]!], group.id, { ...catalog, groups: [imageOnly] })[0]!;
    expect(unquoted.metadata?.priceLabel).toBe("价格未公布");
    expect(unquoted.pricing).toBeUndefined();
    const stale = { ...group, details: { ...group.details, stale: true } };
    expect(applySupplierCatalogPrices(models, group.id, { ...catalog, groups: [stale] })[1]?.metadata?.priceStatus).toBe("unpublished");
  });
  it("records the current source and date for unquoted exact Miaowu aliases and Hang video while keeping their interfaces runnable", () => {
    for (const [origin, groupId, ids] of [
      ["https://api.miaowuai.store", "default", ["dreamina-seedance-2.0-fast", "dreamina-seedance-2.0-mini", "seedance-2.0-fast-deal", "seedance-2.5-deal", "video-editing"]],
      ["https://api.hangzhale.com", "grok heavy", ["grok-imagine-video", "grok-imagine-video-1.5"]],
    ] as const) {
      const models: ModelDescriptor[] = ids.map(id => ({ id, name: id, operations: ["video.generate"], outputKinds: ["video"], metadata: { canvasRunnable: true } }));
      const current: SupplierCatalogDiscovery = { kind: "newapi", status: "live", complete: true, checkedAt: "2026-10-09T04:20:00Z",
        groups: [{ id: groupId, label: groupId, source: "catalog", models: [{ id: "another-video", capability: "video", priceLabel: "¥9/次" }],
          details: { source: "key-groups", description: "生图5分一张" } }] };
      const priced = applySupplierCatalogPrices(models, groupId, current, origin);
      for (const model of priced) {
        expect(model.metadata).toMatchObject({ canvasRunnable: true, priceLabel: "价格未公布", priceStatus: "unpublished", priceCheckedAt: current.checkedAt });
        expect(model.metadata?.priceUnavailableReason).toContain(current.checkedAt);
        expect(model.metadata?.priceUnavailableReason).toContain(`完整型号 ${model.id}`);
        expect(model.metadata?.priceUnavailableReason).toContain(String(model.metadata?.priceSourceUrl));
        expect(model.pricing).toBeUndefined();
        expect(modelEstimatedCost(model, {})).toBeUndefined();
      }
    }
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

  it("fills partial-directory placeholders from an exact successful test charge", async () => {
    const supplier = { id: "partial-price", apiUrl: "https://partial-evidence.example/v1", siteUrl: "https://partial-evidence.example", state: { sourceId: "source" },
      catalog: { groups: [] }, kind: "sub2api", scanStatus: "live", scanComplete: false, scannedAt: "2026-10-09T08:00:00Z", updatedAt: "2026-10-09T08:00:00Z" };
    vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    vi.mocked(repository.getSupplierVerification).mockResolvedValue({ sourceId: "source", cases: [{ sourceId: "source", status: "succeeded", requestId: "request", group: "images", modelId: "gpt-image-2", resolution: "4K", quality: "high",
      actualCharge: { amount: "0.07", currency: "USD", unit: "request", requestId: "request", checkedAt: "2026-10-09T08:00:00Z" } }] } as unknown as Awaited<ReturnType<typeof repository.getSupplierVerification>>);
    const config = { supplierId: supplier.id, supplierSourceId: "source", baseUrl: supplier.apiUrl, modelGroup: "images" };
    for (const priceLabel of ["价格目录未完整读取", "暂未取得报价", "价格未知", "价格未确定"]) {
      const image: ModelDescriptor = { id: "gpt-image-2", name: "GPT Image 2", operations: ["image.generate"], outputKinds: ["image"], metadata: { priceLabel } };
      const priced = (await enrichSupplierModelPrices({ config }, [image], false, false))[0]!;
      expect(priced.metadata?.priceSource).toBe("generated-result");
      expect(modelPriceSummary(priced, { size_tier: "4K", quality: "high" })).toBe("$0.07/次（生成实测） · 4K / high");
      expect(modelPriceSummary(priced, { size_tier: "1K", quality: "high" })).toBe("当前组合未测价；上次 $0.07/次（生成实测） · 4K / high");
      expect(modelEstimatedCost(priced, { n: 3 })).toBeUndefined();
    }
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

  it("never fills a known official group's price with a same-name test from another group", () => {
    const test = { sourceId: "source", status: "succeeded", requestId: "request", group: "images", modelId: "gpt-image-2",
      actualCharge: { amount: .07, currency: "USD", unit: "request", requestId: "request" } };
    for (const supplierGroupId of [undefined, "116"]) {
      expect(measuredPricesFromVerification({ sourceId: "source", cases: [{ ...test, supplierGroupId }] }, { supplierGroupId: "115" }).size).toBe(0);
    }
    expect(measuredPricesFromVerification({ sourceId: "source", cases: [{ ...test, supplierGroupId: "115" }] }, { supplierGroupId: "115" }).get("images\u0000gpt-image-2")?.amount).toBe(.07);
    expect(measuredPricesFromVerification({ sourceId: "source", cases: [{ ...test, supplierGroupId: "115" }] }, { supplierGroupId: "115", group: "renamed-images" }).get("renamed-images\u0000gpt-image-2")?.amount).toBe(.07);
  });

  it("uses group prices only as image references and keeps explicit model prices first", () => {
    const image = { ...model, id: "gpt-image-2", operations: ["image.generate"] as const };
    const groups = [{id:"images", label:"Images", source:"catalog" as const, models:[], details:{source:"key-groups" as const, description:"1张0.015，仅支持1K2K，不支持4K", referencePrice:"1张0.015", supportedResolutions:["1K","2K"], unsupportedResolutions:["4K"],exclusiveResolutions:true}}];
    const pendingImage = { ...model, id: "midjourney-1k" };
    const result = applySupplierCatalogPrices([image, pendingImage], "images", { ...catalog, groups });
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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jiasuCatalogMediaKind, jiasuCatalogMediaPricing } from "./jiasu-catalog-pricing.js";
import { discoverSupplierCatalog, parseSupplierCatalog } from "./supplier-catalog.js";
import { modelPriceAmount } from "./media-billing.js";
import type { StructuredModelPricing } from "./contracts.js";

const frozen = JSON.parse(readFileSync(new URL("./fixtures/jiasu-pricing-20261009.json", import.meta.url), "utf8")) as {
  data: Record<string, unknown>[]; group_ratio: Record<string, number>;
};
const options = { supplierSiteUrl: "https://ai.jiasuapi.com", group: "vip", groupMultiplier: 1, currency: "CNY", currencyMultiplier: 1, checkedAt: "2026-10-09T12:00:00Z" };
const row = (id: string) => frozen.data.find(value => value.model_name === id)!;

describe("Jiasu's exact catalog currency, billing units and media declarations", () => {
  it("classifies all 35 full IDs from official endpoints and preserves 9 image / 26 video outputs", () => {
    const catalog = parseSupplierCatalog(frozen, { supplierSiteUrl: options.supplierSiteUrl, currency: "CNY", checkedAt: options.checkedAt });
    expect(catalog.groups).toHaveLength(1);
    const models = catalog.groups[0]!.models;
    expect(models).toHaveLength(35);
    expect(models.filter(model => model.capability === "image")).toHaveLength(9);
    expect(models.filter(model => model.capability === "video")).toHaveLength(26);
    expect(models.find(model => model.id === "wan3")).toMatchObject({ capability: "video", outputKinds: ["video"], protocol: "openai-videos" });
    for (const model of models) {
      expect(model.priceLabel).not.toContain("输入");
      expect(model.priceLabel).not.toContain("输出");
      expect(model.metadata?.jiasuCatalogRecord).toBeDefined();
    }
    expect(models.find(model => model.id === "sd-2.0-J2")?.metadata?.jiasuCatalogRecord).toMatchObject({
      supportedEndpointTypes: ["openai-video"], apiParameters: expect.arrayContaining([{ name: "duration", type: "integer", required: true,
        default: "5", range: "5-15", description: "视频时长（秒）。客户端未传时长时使用此默认值。" }]), billingUnit: "second",
    });
  });

  it("uses final per-second tiers instead of incompatible quota/model-price fields and ignores the group multiplier once", () => {
    const seconds = jiasuCatalogMediaPricing(row("sd-2.0-J2"), { ...options, groupMultiplier: .5, currencyMultiplier: 7 })!;
    expect(seconds.priceLabel).toBe("720p ¥2.1/秒");
    expect(seconds.pricing).toMatchObject({ kind: "tiered", currency: "CNY", billingUnit: "second", sourceUrl: "https://ai.jiasuapi.com/api/pricing",
      tiers: [{ price: 2.1, dimension: "resolution", value: "720p" }] });
    const sd25 = jiasuCatalogMediaPricing(row("sd-2.5-J2"), options)!;
    expect(sd25.priceLabel).toBe("1080p ¥1.1/秒 · 480p ¥0.4/秒 · 720p ¥0.65/秒");
    expect(modelPriceAmount(sd25.pricing, { resolution: "480p" })).toBe(.4);
    expect(modelPriceAmount(sd25.pricing, { resolution: "4K" })).toBeUndefined();
  });

  it("uses legacy selected per-item/per-second fields and applies that group's multiplier exactly once", () => {
    expect(jiasuCatalogMediaPricing(row("wan3"), { ...options, groupMultiplier: .5 })?.priceLabel).toBe("720p ¥0.08/秒 · 1080p ¥0.15/秒");
    expect(jiasuCatalogMediaPricing(row("sd-2.0-mini-J1"), { ...options, groupMultiplier: .5 })?.priceLabel).toBe("480p ¥0.5/请求 · 720p ¥0.5/请求");
    expect(jiasuCatalogMediaPricing(row("minimax-h3"), options)?.priceLabel).toBe("2k ¥1/请求");
    expect(jiasuCatalogMediaPricing(row("sd-2.0-J1"), options)?.priceLabel).toBe("¥4/请求");
  });

  it("keeps exact per-request prices for every image ID and does not call them per-image prices", () => {
    const expected = new Map([["gpt-image-2-1k", .02], ["gpt-image-2-2k", .1], ["gpt-image-2-4k", .4], ["gpt-image-2-high", .6],
      ["gpt-image-2.5-1k", .02], ["gpt-image-2.5-flare-1k", .02], ["gpt-image-2.5-flare-4k", .6],
      ["gpt-image-2.5-sunburst-1k", .03], ["gpt-image-2.5-sunburst-4k", .5]]);
    for (const [id, price] of expected) expect(jiasuCatalogMediaPricing(row(id), options)?.pricing).toMatchObject({ kind: "per-request", billingUnit: "request", unitAmount: price });
  });

  it("does not invent resolution/reference-video matrices or ordinary input/output prices from video token placeholders", () => {
    const catalog = parseSupplierCatalog(frozen, { supplierSiteUrl: options.supplierSiteUrl, currency: "CNY" });
    const missing = catalog.groups[0]!.models.filter(model => model.metadata?.jiasuCatalogPricingIncomplete);
    expect(missing).toHaveLength(12);
    for (const model of missing) {
      expect(model.priceLabel).toBe("价格条件待确认");
      expect(model.metadata?.officialCatalogPricing).toBeUndefined();
    }
    expect(missing.map(model => model.id)).toContain("doubao-seedance-2-0-260128");
    expect(missing.map(model => model.id)).toContain("doubao-seedance-2-5-260628");
  });

  it("binds final tiers to the exact group or its explicit wildcard and rejects unknown billing conditions", () => {
    const raw = { ...row("sd-2.0-J2"), enable_groups: ["vip", "discount"], video_pricing: { enabled: true, mode: "per_second", unit: "per_second", final_price: true,
      by_group: { vip: { tiers: [{ resolution: "720p", price: ".3" }] }, discount: { tiers: [{ resolution: "720p", price: "0.1" }] } } } };
    expect(jiasuCatalogMediaPricing(raw, { ...options, group: "discount" })?.priceLabel).toBe("720p ¥0.1/秒");
    expect(jiasuCatalogMediaPricing(raw, { ...options, group: "another" })).toBeUndefined();
    expect(jiasuCatalogMediaPricing({ ...raw, video_pricing: { ...raw.video_pricing, by_group: { vip: raw.video_pricing.by_group.vip } } }, { ...options, group: "discount" })).toBeUndefined();
    const unsupported = { ...raw, video_pricing: { ...raw.video_pricing, by_group: { vip: { tiers: [{ resolution: "720p", price: "0.3", audio: true }] } } } };
    expect(jiasuCatalogMediaPricing(unsupported, options)).toBeUndefined();
    expect(jiasuCatalogMediaPricing({ ...raw, video_pricing: { ...raw.video_pricing, unit: "per_request" } }, options)).toBeUndefined();
    expect(jiasuCatalogMediaPricing({ ...row("wan3"), video_billing: { enabled: true, unit: "per_second", tiers: [{ key: "720p", price_per_second: .16 }, { key: "720p", price_per_second: .3 }] } }, options)).toBeUndefined();
  });

  it.each(["https://other.invalid", "https://ai.jiasuapi.com.evil.invalid", "http://ai.jiasuapi.com", "https://user@ai.jiasuapi.com", "https://ai.jiasuapi.com/?token=fixture", "https://ai.jiasuapi.com/proxy"])("does not borrow source-specific rules for %s", supplierSiteUrl => {
    expect(jiasuCatalogMediaKind(row("wan3"), supplierSiteUrl)).toBeUndefined();
    expect(jiasuCatalogMediaPricing(row("wan3"), { ...options, supplierSiteUrl })).toBeUndefined();
  });

  it("reads configured CNY and an exchange rate of one in live discovery, keeping already-final overrides", async () => {
    const result = await discoverSupplierCatalog({ siteUrl: options.supplierSiteUrl, apiUrl: `${options.supplierSiteUrl}/v1`, kind: "newapi" }, async url => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/pricing") return Response.json(frozen);
      if (path === "/api/status") return Response.json({ data: { quota_display_type: "CUSTOM", custom_currency_symbol: "¥", custom_currency_exchange_rate: 1 } });
      if (path === "/api/user/self/groups") return Response.json({ data: { vip: { desc: "vip分组", ratio: 1 } } });
      return Response.json({}, { status: 404 });
    });
    expect(result.status).toBe("live");
    const model = result.groups[0]!.models.find(model => model.id === "sd-2.0-J2")!;
    expect(model.priceLabel).toBe("720p ¥0.3/秒");
    expect((model.metadata?.officialCatalogPricing as StructuredModelPricing).currency).toBe("CNY");
  });
});

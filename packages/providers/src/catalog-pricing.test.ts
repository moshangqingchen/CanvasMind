import { describe, expect, it } from "vitest";
import { catalogPriceLabel, scopedCatalogMediaPricing } from "./catalog-pricing.js";
import { parseSupplierCatalog } from "./supplier-catalog.js";
import { discoverSupplierCatalog } from "./supplier-catalog.js";
import { scanProviderModelCatalog } from "./model-catalog.js";

describe("catalog prices for arbitrary new models", () => {
  it("keeps the three exact official Afei seconds and all resolution quotes in the generic catalog", () => {
    const descriptions = [
      ["minimax-h3", "MiniMax H3 视频生成，按时长计费。768p 1.875额度/秒，2K 3额度/秒。", [1.875, 3]],
      ["seedance2.0", "Seedance 2.0 视频生成，按时长计费。480p 2.025、720p 3.15、1080p 6.375、4K 15额度/秒。", [2.025, 3.15, 6.375, 15]],
      ["seedance2.5", "Seedance 2.5 视频生成，按时长计费。480p 2.625额度/秒，720p 4.725额度/秒。", [2.625, 4.725]],
    ] as const;
    for (const [id, description, prices] of descriptions) {
      const raw = { model_name: id, quota_type: 1, model_price: prices[0], description, tags: "视频生成,按秒计费", enable_groups: ["图片视频模型综合分组"] };
      const parsed = parseSupplierCatalog({ group_ratio: { 图片视频模型综合分组: .5 }, data: [raw] },
        { supplierSiteUrl: "https://api.3365api.cn", checkedAt: "now", currency: "USD" }).groups[0]!.models[0]!;
      expect(parsed.priceLabel).toContain("/秒");
      expect(parsed.metadata?.officialCatalogPricing).toMatchObject({ currency: "USD", kind: "tiered", billingUnit: "second", confidence: "exact" });
      expect((parsed.metadata?.officialCatalogPricing as { tiers: { price: number }[] }).tiers.map(t => t.price)).toEqual(prices.map(n => n / 2));
      for (const supplierSiteUrl of ["https://other.example", "https://user@api.3365api.cn", "https://api.3365api.cn/gateway"]) expect(scopedCatalogMediaPricing(raw,
        { supplierSiteUrl, group: "图片视频模型综合分组", multiplier: 1 })).toBeUndefined();
      expect(scopedCatalogMediaPricing({ ...raw, model_name: "ya-sd25-30s" }, { supplierSiteUrl: "https://api.3365api.cn", group: "图片视频模型综合分组", multiplier: 1 })).toBeUndefined();
    }
  });
  it("honors a New API site's declared display currency and exchange rate", async () => {
    const result = await discoverSupplierCatalog(
      { siteUrl: "https://new.example", apiUrl: "", kind: "newapi" },
      async (url) =>
        String(url).endsWith("/api/status")
          ? Response.json({
              data: { quota_display_type: "CNY", usd_exchange_rate: 7 },
            })
          : Response.json({
              group_ratio: { image: 0.5 },
              data: [
                {
                  model_name: "future-image",
                  model_price: 0.1,
                  quota_type: 1,
                  request_unit: "image",
                  enable_groups: ["image"],
                },
              ],
            }),
    );
    expect(result.groups[0]?.models[0]?.priceLabel).toBe("¥0.35/张");
  });
  it("decodes fixed prices, free prices and per-group multipliers", () => {
    const catalog = parseSupplierCatalog({
      group_ratio: { basic: 1, vip: 0.5 },
      data: [
        {
          model_name: "future-image-v9",
          quota_type: 1,
          model_price: 0.12,
          request_unit: "image",
          enable_groups: ["basic", "vip"],
        },
        {
          model_name: "future-free",
          quota_type: 1,
          model_price: 0,
          enable_groups: ["vip"],
        },
      ],
    });
    expect(catalog.groups[0]?.models[0]?.priceLabel).toBe("$0.12/张");
    expect(catalog.groups[1]?.models.map((m) => m.priceLabel)).toEqual([
      "$0.06/张",
      "$0/请求",
    ]);
  });
  it("decodes token pricing without mistaking model_price=0 for free usage", () => {
    expect(
      catalogPriceLabel(
        {
          quota_type: 0,
          model_price: 0,
          model_ratio: 1.25,
          completion_ratio: 4,
        },
        { newApi: true, multiplier: 0.5 },
      ),
    ).toBe("输入 $1.25/1M · 输出 $5/1M");
  });
  it("preserves explicit labels and currency while refusing unknown billing units", () => {
    expect(
      catalogPriceLabel(
        { price_label: "¥0.1/张", model_price: 8 },
        { newApi: true },
      ),
    ).toBe("¥0.1/张");
    expect(
      catalogPriceLabel({
        price: 0.1,
        request_unit: "second",
        currency: "CNY",
      }),
    ).toBe("¥0.1/秒");
    expect(catalogPriceLabel({ price: 0.1, request_unit: "image" })).toBe(
      "0.1/张（币种未注明）",
    );
    expect(catalogPriceLabel({ price: 0.1 })).toBeUndefined();
  });
  it("retains structured price data from a generic model endpoint", () => {
    const scanned = scanProviderModelCatalog({
      data: [
        {
          id: "future-image",
          pricing: { kind: "per-image", currency: "CNY", unitAmount: 0.015 },
        },
      ],
    });
    expect(scanned.models[0]?.metadata?.priceLabel).toBe("¥0.015/张");
  });
  it("prices all-group models separately and keeps exact IDs", () => {
    const groups = parseSupplierCatalog({
      usable_group: { a: "A", b: "B" },
      group_ratio: { a: 1, b: 2 },
      data: [
        {
          model_name: "Case/Image-v99",
          quota_type: 1,
          model_price: 0.1,
          enable_group: ["all"],
        },
      ],
    }).groups;
    expect(
      groups.map((g) => [g.models[0]?.id, g.models[0]?.priceLabel]),
    ).toEqual([
      ["Case/Image-v99", "$0.1/请求"],
      ["Case/Image-v99", "$0.2/请求"],
    ]);
  });
  it.each([undefined, null, false, true, "", " ", {}, ["0"]])("refuses undeclared billing modes instead of coercing %j into token pricing", quota_type => {
    expect(catalogPriceLabel({ quota_type, model_ratio: 1, completion_ratio: 2, model_price: 0 }, { newApi: true })).toBeUndefined();
  });
  it("normalizes declared currencies and units while prioritizing nested video units", () => {
    expect(catalogPriceLabel({ currency: "usd", price: .1, request_unit: "per_call" })).toBe("$0.1/请求");
    expect(catalogPriceLabel({ currency: "cny", price: .1, request_unit: "per image" })).toBe("¥0.1/张");
    expect(catalogPriceLabel({ model_price: .1, quota_type: 1, request_unit: "request", video_api: { pricing: { unit: "per_second" } } }, { newApi: true })).toBe("$0.1/秒");
    expect(catalogPriceLabel({ quota_type: "0", model_ratio: 1 }, { newApi: true })).toBe("输入 $2/1M");
    expect(catalogPriceLabel({ price: Number.MAX_VALUE, request_unit: "image" }, { multiplier: 2 })).toBeUndefined();
    expect(catalogPriceLabel({ quota_type: 0, model_ratio: Number.MAX_VALUE }, { newApi: true })).toBeUndefined();
    expect(catalogPriceLabel({ quota_type: 0, model_price: 0, request_unit: "image" }, { newApi: true })).toBeUndefined();
  });
});

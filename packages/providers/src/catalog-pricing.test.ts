import { describe, expect, it } from "vitest";
import { catalogPriceLabel } from "./catalog-pricing.js";
import { parseSupplierCatalog } from "./supplier-catalog.js";
import { discoverSupplierCatalog } from "./supplier-catalog.js";
import { scanProviderModelCatalog } from "./model-catalog.js";

describe("catalog prices for arbitrary new models", () => {
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
});

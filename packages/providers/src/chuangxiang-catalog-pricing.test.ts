import { describe, expect, it } from "vitest";
import { chuangxiangCatalogPricing } from "./chuangxiang-catalog-pricing.js";
import { parseSupplierCatalog, discoverSupplierCatalog } from "./supplier-catalog.js";
import { modelPriceAmount } from "./media-billing.js";
import { chuangxiangVideoModel } from "./chuangxiang-video-contract.js";

describe("Chuangxiang plaza prices", () => {
  it("prices SD8's fixed thirty-second task at 5.2 CNY without inventing a resolution", () => {
    const row = { name: "sd8-seedance-2.5", effective_rate_multiplier: .1, video_pricing: { billing_mode: "per_request", prices: { per_request: 52 } } };
    const priced = chuangxiangCatalogPricing(row)!;
    expect(priced).toMatchObject({ priceLabel: "¥5.2/次", pricing: { kind: "per-request", billingUnit: "request", currency: "CNY", unitAmount: 5.2 } });
    expect(priced.resolutions).toBeUndefined();
    expect(priced.pricing.tiers).toBeUndefined();
    const model = chuangxiangVideoModel(row.name, { id: row.name, name: row.name, operations: [], pricing: priced.pricing });
    expect(model.parameters?.some(p => p.key === "resolution")).toBe(false);
    expect(modelPriceAmount(model.pricing!, { duration: 30, n: 1 })).toBe(5.2);
    expect(parseSupplierCatalog({ data: { groups: [{ name: "视频", models: [row] }] } }, { supplierSiteUrl: "https://vapi.chuangxiangai.asia" }).groups[0]?.models[0]?.priceLabel).toBe("¥5.2/次");
  });
  it("multiplies raw prices once by the model's effective rate and preserves video units", () => {
    const result = chuangxiangCatalogPricing({ effective_rate_multiplier: .1, pricing: { billing_mode: "video" }, video_pricing: { billing_mode: "per_request", prices: { "720p": 52, "1080p": 252 } } })!;
    expect(result.priceLabel).toBe("720p ¥5.2/次 · 1080p ¥25.2/次");
    expect(result.pricing).toMatchObject({ kind: "per-request", currency: "CNY", billingUnit: "request" });
    expect(modelPriceAmount(result.pricing, { resolution: "720p", duration: 15 })).toBe(5.2);
    expect(chuangxiangCatalogPricing({ effective_rate_multiplier: .1, video_pricing: { billing_mode: "per_second", prices: { "480p": 1.1 } } })?.priceLabel).toBe("480p ¥0.11/秒");
  });
  it("converts documented token rates to per-million and keeps image resolution tiers", () => {
    expect(chuangxiangCatalogPricing({ effective_rate_multiplier: .11, pricing: { billing_mode: "token", input_price: 7.5e-7, output_price: 3.75e-6 } })?.priceLabel).toBe("输入 ¥0.0825/1M · 输出 ¥0.4125/1M");
    const image = chuangxiangCatalogPricing({ effective_rate_multiplier: .1, pricing: { billing_mode: "image", per_request_price: .8, intervals: [{ tier_label: "1K", per_request_price: .8 }, { tier_label: "2K", per_request_price: 1.1 }, { tier_label: "4K", per_request_price: 1.3 }] } })!;
    expect(image.priceLabel).toBe("1K ¥0.08/张 · 2K ¥0.11/张 · 4K ¥0.13/张");
    expect(modelPriceAmount(image.pricing, { resolution: "4K" })).toBe(.13);
  });
  it("never applies the group's raw multiplier again and never labels an unrelated plaza CNY", () => {
    const payload = { data: { groups: [{ name: "生图", rate_multiplier: 10, models: [{ name: "gpt-image-2-1k", effective_rate_multiplier: .1, pricing: { billing_mode: "image", per_request_price: .7 } }] }] } };
    expect(parseSupplierCatalog(payload, { supplierSiteUrl: "https://vapi.chuangxiangai.asia" }).groups[0]?.models[0]?.priceLabel).toBe("¥0.07/张");
    expect(parseSupplierCatalog(payload, { supplierSiteUrl: "https://other.example" }).groups[0]?.models[0]?.priceLabel).toBe("0.7/张（币种未注明）");
    expect(chuangxiangCatalogPricing({ pricing: { billing_mode: "image", per_request_price: .7 } })).toBeUndefined();
  });
  it("passes official source context during discovery without using Key permissions as a public fact", async () => {
    const result = await discoverSupplierCatalog({ kind: "sub2api", siteUrl: "https://vapi.chuangxiangai.asia" }, async url => String(url).endsWith("/api/v1/model-plaza") ? Response.json({ data: { groups: [{ name: "视频", models: [{ name: "sd10-seedance-2.0", effective_rate_multiplier: .1, video_pricing: { billing_mode: "per_request", prices: { "720p": 52 } } }] }] } }) : Response.json({ data: [] }));
    expect(result.groups[0]?.models[0]?.priceLabel).toBe("720p ¥5.2/次");
    expect(result.groups[0]?.models[0]?.metadata?.chuangxiangCatalogPricing).toMatchObject({ kind: "per-request", currency: "CNY" });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const isolatedNetwork = vi.hoisted(() => ({ fetch: vi.fn(), lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));
vi.mock("node:dns/promises", () => ({ lookup: isolatedNetwork.lookup }));
beforeEach(() => { isolatedNetwork.fetch.mockReset().mockRejectedValue(new Error("Unexpected real HTTP in plaza price test")); vi.stubGlobal("fetch", isolatedNetwork.fetch); });
afterEach(() => { try { expect(isolatedNetwork.fetch).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); } });
import { chuangxiangCatalogPricing } from "./chuangxiang-catalog-pricing.js";
import { parseSupplierCatalog, discoverSupplierCatalog } from "./supplier-catalog.js";
import { modelPriceAmount } from "./media-billing.js";
import { chuangxiangVideoModel } from "./chuangxiang-video-contract.js";

describe("Chuangxiang plaza prices", () => {
  it("preserves published cache components with only the model's effective multiplier", () => {
    const decoded = chuangxiangCatalogPricing({ effective_rate_multiplier: .75, pricing: { billing_mode: "token", input_price: 1e-5,
      output_price: 5e-5, cache_write_price: .0000125, cache_write_1h_price: .00002, cache_read_price: .000001, intervals: [] } })!;
    expect(decoded.pricing.tiers?.map(t => t.price)).toEqual([7.5, 37.5, .75, 9.375, 15]);
    expect(decoded.priceLabel).toContain("缓存写入 5m ¥9.375/1M");
    expect(decoded.priceLabel).toContain("缓存写入 1h ¥15/1M");
    expect(decoded.pricing.inputPerMillion).toBeUndefined();
    expect(modelPriceAmount(decoded.pricing, {})).toBeUndefined();
  });
  it("preserves context tiers without flattening overlapping official boundaries", () => {
    const decoded = chuangxiangCatalogPricing({ effective_rate_multiplier: .2, pricing: { billing_mode: "token", input_price: 2e-6,
      intervals: [{ tier_label: "<200K", min_tokens: 0, max_tokens: 199999, input_price: 2e-6, output_price: 6e-6, cache_read_price: 3e-7 },
        { tier_label: "≥200K", min_tokens: 199999, max_tokens: null, input_price: 4e-6, output_price: 12e-6, cache_read_price: 6e-7 }] } })!;
    expect(decoded.pricing.tiers?.map(t => t.price)).toEqual([.4, 1.2, .06, .8, 2.4, .12]);
    expect(decoded.pricing.inputPerMillion).toBeUndefined();
    expect(modelPriceAmount(decoded.pricing, { token_kind: "input" })).toBeUndefined();
    expect(modelPriceAmount(decoded.pricing, { token_kind: "input", token_context_tier: "≥200K" })).toBe(.8);
    expect(chuangxiangCatalogPricing({ effective_rate_multiplier: 1, pricing: { billing_mode: "token", input_price: 2e-6,
      intervals: [{ min_tokens: 0, max_tokens: null, input_price: 2e-6 }] } })).toBeUndefined();
  });
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

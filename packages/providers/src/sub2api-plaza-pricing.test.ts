import { describe, expect, it } from "vitest";
import { modelPriceAmount } from "./media-billing.js";
import { isSub2apiPlazaPricingSource, sub2apiPlazaPricing } from "./sub2api-plaza-pricing.js";

const monster = { supplierSiteUrl: "https://api.eaheng.com", checkedAt: "2026-10-08T16:00:00Z" };
const pdog = { supplierSiteUrl: "https://ai.whyshy.cn", checkedAt: monster.checkedAt };
const group = { rate_multiplier: 1, image_rate_independent: false, image_rate_multiplier: 1, peak_rate_enabled: false };
const image = (price: number, name = "image-test") => ({ name, pricing: { billing_mode: "image", per_request_price: price, intervals: [] } });
const resolutionImage = (price: number) => ({ name: "image-test", pricing: { billing_mode: "image", per_request_price: price,
  intervals: ["1K", "2K", "4K"].map(tier_label => ({ min_tokens: 0, max_tokens: null, tier_label, per_request_price: price })) } });

describe("official Monster and pDog plaza ledger prices", () => {
  it("uses C1's actual USD ledger rate without treating its cash advertisement as another multiplier", () => {
    const advertised = { ...group, description: "香蕉pro 0.07，香蕉2 0.05，实付一刀1毛" };
    expect(sub2apiPlazaPricing(image(.7, "gemini-3-pro-image-preview"), advertised, monster)).toMatchObject({
      priceLabel: "$0.7/张", pricing: { kind: "per-image", currency: "USD", unitAmount: .7, checkedAt: monster.checkedAt,
        sourceUrl: "https://api.eaheng.com/api/v1/model-plaza" } });
    expect(sub2apiPlazaPricing(image(.5, "gemini-3.1-flash-image-preview"), advertised, monster)?.priceLabel).toBe("$0.5/张");
  });
  it("keeps exact model IDs' distinct image prices and ignores unrelated token list prices", () => {
    const rows = [["gpt-image-2.5-flare", .6], ["gpt-image-2.5-flare-high", .9], ["gpt-image-2.5-sunburst-high", 1]] as const;
    expect(rows.map(([name, price]) => sub2apiPlazaPricing({ ...image(price, name), official_pricing: { input_price: 999 },
      pricing: { ...image(price).pricing, input_price: .000005, output_price: .00001 } }, group, monster)?.pricing.unitAmount)).toEqual([.6, .9, 1]);
  });
  it("preserves pDog's three explicit resolution tiers independently for each group", () => {
    for (const price of [.02, .08]) {
      const priced = sub2apiPlazaPricing(resolutionImage(price), group, pdog)!;
      expect(priced.pricing).toMatchObject({ kind: "tiered", billingUnit: "image", currency: "USD", sourceUrl: "https://ai.whyshy.cn/api/v1/model-plaza" });
      expect(priced.pricing.tiers?.map(t => [t.value, t.price])).toEqual([["1K", price], ["2K", price], ["4K", price]]);
      expect(modelPriceAmount(priced.pricing, { resolution: "4k" })).toBe(price);
      expect(modelPriceAmount(priced.pricing, {})).toBeUndefined();
      expect(modelPriceAmount(priced.pricing, { resolution: "8K" })).toBeUndefined();
      expect(priced.pricing.unitAmount).toBeUndefined();
    }
  });
  it("selects user or independent image multipliers once and never substitutes group image prices", () => {
    const rated = { ...group, rate_multiplier: 8, user_rate_multiplier: .5, image_rate_multiplier: .1, image_price_1k: 999 };
    expect(sub2apiPlazaPricing(image(.7), rated, monster)?.pricing.unitAmount).toBe(.35);
    expect(sub2apiPlazaPricing(image(.7), { ...rated, image_rate_independent: true }, monster)?.pricing.unitAmount).toBe(.07);
    expect(sub2apiPlazaPricing(image(.7), { rate_multiplier: 8, image_rate_independent: true }, pdog)?.pricing.unitAmount).toBe(.7);
    expect(sub2apiPlazaPricing(image(.7), { ...group, rate_multiplier: 0 }, pdog)?.pricing.unitAmount).toBe(0);
  });
  it("converts token rates to per-million with the user multiplier instead of the image multiplier", () => {
    const priced = sub2apiPlazaPricing({ name: "token-test", pricing: { billing_mode: "token", input_price: 2e-6, output_price: 8e-6 } },
      { ...group, rate_multiplier: 3, user_rate_multiplier: .5, image_rate_independent: true, image_rate_multiplier: .1 }, pdog)!;
    expect(priced.pricing).toMatchObject({ kind: "token", currency: "USD", inputPerMillion: 1, outputPerMillion: 4 });
    expect(priced.priceLabel).toBe("输入 $1/1M tokens · 输出 $4/1M tokens");
  });
  it("preserves explicit cache rates as conditional token prices rather than guessing cache usage", () => {
    const priced = sub2apiPlazaPricing({ name: "token-test", pricing: { billing_mode: "token", input_price: 2e-6,
      output_price: 8e-6, cache_write_price: 0, cache_write_1h_price: 3e-6, cache_read_price: 1e-6 } }, group, pdog)!;
    expect(priced.pricing.tiers?.map(t => [t.conditions?.[0]?.value, t.price])).toEqual([
      ["input", 2], ["output", 8], ["cache_write", 0], ["cache_write_1h", 3], ["cache_read", 1] ]);
    expect(priced.pricing.inputPerMillion).toBeUndefined();
    expect(priced.pricing.outputPerMillion).toBeUndefined();
    expect(modelPriceAmount(priced.pricing, { token_kind: "cache_read" })).toBe(1);
    expect(modelPriceAmount(priced.pricing, {})).toBeUndefined();
  });
  it("keeps request and image units distinct, including a published zero price", () => {
    expect(sub2apiPlazaPricing({ name: "request-test", pricing: { billing_mode: "per_request", per_request_price: .2 } },
      { ...group, rate_multiplier: 2, image_rate_independent: true, image_rate_multiplier: 10 }, pdog)).toMatchObject({
        priceLabel: "$0.4/请求", pricing: { kind: "per-request", billingUnit: "request", unitAmount: .4 } });
    expect(sub2apiPlazaPricing(image(0), group, monster)?.priceLabel).toBe("$0/张");
  });
  it("limits the ledger convention to the two exact official roots and rejects currency contradictions", () => {
    expect(isSub2apiPlazaPricingSource(monster.supplierSiteUrl)).toBe(true);
    expect(isSub2apiPlazaPricingSource(pdog.supplierSiteUrl)).toBe(true);
    for (const supplierSiteUrl of ["https://other.example", "http://api.eaheng.com", "https://api.eaheng.com.evil.example",
      "https://user@api.eaheng.com", "https://api.eaheng.com/v1", "https://ai.whyshy.cn/?currency=USD", "https://ai.whyshy.cn/#USD"]) {
      expect(sub2apiPlazaPricing(image(.7), group, { supplierSiteUrl })).toBeUndefined();
      expect(isSub2apiPlazaPricingSource(supplierSiteUrl)).toBe(false);
    }
    for (const level of ["row", "pricing", "group"]) {
      expect(sub2apiPlazaPricing({ ...image(.7), ...(level === "row" ? { currency: "CNY" } : {}),
        pricing: { ...image(.7).pricing, ...(level === "pricing" ? { currency: "CNY" } : {}) } },
      { ...group, ...(level === "group" ? { currency: "CNY" } : {}) }, monster)).toBeUndefined();
    }
  });
  it("rejects malformed prices, multipliers and overflow instead of emitting a partial quote", () => {
    for (const invalid of [-1, Infinity, NaN, "0.5"]) {
      expect(sub2apiPlazaPricing({ name: "image-test", pricing: { billing_mode: "image", per_request_price: invalid } }, group, pdog)).toBeUndefined();
      expect(sub2apiPlazaPricing(image(.7), { ...group, user_rate_multiplier: invalid }, pdog)).toBeUndefined();
    }
    expect(sub2apiPlazaPricing(image(.7), {}, pdog)).toBeUndefined();
    expect(sub2apiPlazaPricing(image(1e308), { ...group, rate_multiplier: 2 }, pdog)).toBeUndefined();
    expect(sub2apiPlazaPricing(image(.7), { ...group, image_rate_independent: "true" }, pdog)).toBeUndefined();
  });
  it("does not flatten unknown peak, time, token-volume or reasoning conditions", () => {
    expect(sub2apiPlazaPricing(image(.7), { ...group, peak_rate_enabled: true }, pdog)).toBeUndefined();
    expect(sub2apiPlazaPricing({ ...image(.7), time_pricing: { periods: [{ multiplier: 2 }] } }, group, pdog)).toBeUndefined();
    expect(sub2apiPlazaPricing({ ...image(.7), time_pricing: "unknown" }, group, pdog)).toBeUndefined();
    for (const condition of [{ intervals: [{ min_tokens: 100, input_price: 3e-6 }] }, { reasoning_effort_multipliers: { high: 2 } },
      { reasoning_effort_multipliers: "unknown" }, { reasoning_effort_multipliers: [2] }]) {
      expect(sub2apiPlazaPricing({ name: "token-test", pricing: { billing_mode: "token", input_price: 2e-6, ...condition } }, group, pdog)).toBeUndefined();
    }
  });
  it("does not fall back to a flat price when an image interval is unknown or conflicting", () => {
    for (const intervals of [[{ tier_label: "quality-high", per_request_price: .1 }], [{ tier_label: "4K", min_tokens: 100, per_request_price: .1 }],
      [{ tier_label: "4K", per_request_price: .1 }, { tier_label: "4k", per_request_price: .2 }], "unknown"]) {
      expect(sub2apiPlazaPricing({ ...image(.7), pricing: { ...image(.7).pricing, intervals } }, group, pdog)).toBeUndefined();
    }
  });
  it("keeps unconfigured prices and other billing modes unknown instead of borrowing list prices", () => {
    for (const billing_mode of ["image", "token", "video"]) {
      expect(sub2apiPlazaPricing({ name: "unconfigured", pricing: { billing_mode },
        official_pricing: { per_request_price: .7, input_price: 2e-6 } }, group, pdog)).toBeUndefined();
    }
  });
});

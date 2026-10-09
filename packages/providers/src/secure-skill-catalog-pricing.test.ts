import { describe, expect, it } from "vitest";
import { secureSkillCatalogPricing, secureSkillCatalogVideoDeclaration } from "./secure-skill-catalog-pricing.js";
import { modelPriceAmount } from "./media-billing.js";

const options = { supplierSiteUrl: "https://token.secure-skill.com", checkedAt: "2026-10-08T11:21:08.582Z" };
const id = "doubao-seedance-2-0-260128";
const row = { name: id, pricing: { billing_mode: "token", input_price: .0000299, output_price: .000029,
  reference_video_output_price: .0000182, output_price_1080p: null, intervals: [] } };

describe("Secure Skill official video token prices", () => {
  it("imports exact GPT/Grok chat components per million, with one group multiplier", () => {
    const gpt = secureSkillCatalogPricing({ name: "gpt-5.4", pricing: { billing_mode: "token", input_price: 2.5e-6,
      output_price: 15e-6, cache_read_price: 2.5e-7, cache_write_price: 0, intervals: [] } }, { ...options, multiplier: .3 })!;
    expect(gpt.pricing.tiers?.map(t => t.price)).toEqual([.75, 4.5, .075, 0]);
    expect(gpt.pricing.inputPerMillion).toBeUndefined();
    expect(modelPriceAmount(gpt.pricing, {})).toBeUndefined();
    expect(modelPriceAmount(gpt.pricing, { token_kind: "cache_read" })).toBe(.075);
    const grok = secureSkillCatalogPricing({ name: "grok-4.7", pricing: { billing_mode: "token", input_price: 2e-6, output_price: 6e-6,
      cache_read_price: .5e-6, cache_write_price: 0 } }, { ...options, multiplier: .2 })!;
    expect(grok.pricing.tiers?.map(t => t.price)).toEqual([.4, 1.2, .1, 0]);
    for (const name of ["gpt-image-2", "gpt-5.4-preview/extra", "grok-4.8"]) expect(secureSkillCatalogPricing({ name,
      pricing: { billing_mode: "token", input_price: 2e-6 } }, options)).toBeUndefined();
    expect(secureSkillCatalogPricing({ name: "gpt-5.4", pricing: { billing_mode: "token", input_price: 2e-6, cache_read_price: "0" } }, options)).toBeUndefined();
  });
  it("preserves current input and separate 720p reference-video rates in CNY/1M tokens", () => {
    const decoded = secureSkillCatalogPricing(row, options)!;
    expect(decoded.pricing).toMatchObject({ kind: "token", currency: "CNY", confidence: "exact", checkedAt: options.checkedAt });
    expect(decoded.pricing.tiers).toEqual([
      { id: "input_price", label: "输入", price: 29.9, conditionMode: "all", conditions: [{ parameter: "token_kind", operator: "equals", value: "input" }] },
      { id: "output_price", label: "720p · 不含参考视频", price: 29, conditionMode: "all", conditions: [
        { parameter: "token_kind", operator: "equals", value: "output" }, { parameter: "resolution", operator: "equals", value: "720p" }, { parameter: "has_reference_video", operator: "equals", value: "false" }] },
      { id: "reference_video_output_price", label: "720p · 含参考视频", price: 18.2, conditionMode: "all", conditions: [
        { parameter: "token_kind", operator: "equals", value: "output" }, { parameter: "resolution", operator: "equals", value: "720p" }, { parameter: "has_reference_video", operator: "equals", value: "true" }] },
    ]);
    expect(decoded.pricing.inputPerMillion).toBeUndefined();
    expect(decoded.pricing.outputPerMillion).toBeUndefined();
    expect(decoded.priceLabel).toBe("输入 ¥29.9/1M tokens；720p · 不含参考视频 ¥29/1M tokens；720p · 含参考视频 ¥18.2/1M tokens");
    expect(decoded.priceLabel).not.toContain("1080p");
  });

  it("applies the selected group multiplier once without a recharge exchange rate", () => {
    expect(secureSkillCatalogPricing(row, { ...options, multiplier: .5 })?.pricing.tiers?.map(tier => tier.price)).toEqual([14.95,14.5,9.1]);
    expect(secureSkillCatalogPricing(row, { ...options, multiplier: 2 })?.pricing.tiers?.map(tier => tier.price)).toEqual([59.8,58,36.4]);
  });

  it("keeps independent 480p, 1080p and 4K fields and zero amounts without filling nulls", () => {
    const decoded = secureSkillCatalogPricing({ id: "doubao-seedance-2-5-260628", pricing: { billing_mode: "token",
      output_price_480p: .0000511, reference_video_output_price_480p: 0,
      output_price_1080p: .00005621, reference_video_output_price_1080p: .00003358,
      output_price_4k: null, reference_video_output_price_4k: null } }, options)!;
    expect(decoded.pricing.tiers?.map(tier => [tier.id,tier.price])).toEqual([
      ["output_price_480p",51.1], ["reference_video_output_price_480p",0],
      ["output_price_1080p",56.21], ["reference_video_output_price_1080p",33.58],
    ]);
    expect(decoded.priceLabel).not.toContain("720p");
    expect(decoded.priceLabel).not.toContain("4K");
    expect(decoded.pricing.unitAmount).toBeUndefined();
  });

  it("restricts this unit convention to the exact official host, supported full IDs and token mode", () => {
    for (const supplierSiteUrl of ["https://other.example", "https://token.secure-skill.com.evil.example", "https://user@token.secure-skill.com", "http://token.secure-skill.com", "https://token.secure-skill.com/gateway", "https://token.secure-skill.com?auth=example"]) {
      expect(secureSkillCatalogPricing(row, { ...options, supplierSiteUrl })).toBeUndefined();
    }
    for (const name of ["doubao-seedance-2-0-260128-preview","doubao-seedance-2-0","gpt-image-2"]) expect(secureSkillCatalogPricing({ ...row,name },options)).toBeUndefined();
    for (const billing_mode of ["per_second","per_request","image",undefined]) expect(secureSkillCatalogPricing({ ...row,pricing:{ ...row.pricing,billing_mode } },options)).toBeUndefined();
    expect(secureSkillCatalogPricing({ ...row,name:"doubao-seedance-2-0-fast-260128" },options)).toBeDefined();
  });

  it("does not flatten unknown token intervals or contradictory currency declarations", () => {
    expect(secureSkillCatalogPricing({ ...row,pricing:{ ...row.pricing,intervals:[{ min_tokens:0,max_tokens:1000,output_price:.00001 }] } },options)).toBeUndefined();
    expect(secureSkillCatalogPricing({ ...row,pricing:{ ...row.pricing,currency:"USD" } },options)).toBeUndefined();
    expect(secureSkillCatalogPricing({ ...row,currency:"USD" },options)).toBeUndefined();
    expect(secureSkillCatalogPricing({ ...row,pricing:{ ...row.pricing,intervals:{} } },options)).toBeUndefined();
  });

  it("rejects missing, malformed, negative and overflowing rates and multipliers", () => {
    for (const price of [null,undefined,"", "0.01", -1,Number.NaN,Number.POSITIVE_INFINITY,1e308]) expect(secureSkillCatalogPricing({ id,pricing:{billing_mode:"token",output_price:price} },options)).toBeUndefined();
    for (const multiplier of [-1,Number.NaN,Number.POSITIVE_INFINITY,1e308]) expect(secureSkillCatalogPricing(row,{ ...options,multiplier })).toBeUndefined();
    expect(secureSkillCatalogPricing(row,{ ...options,multiplier:0 })?.pricing.tiers?.every(tier=>tier.price===0)).toBe(true);
  });
});

describe("Secure Skill declared media units and resolution prices", () => {
  const seconds = { name: "seedance-2.5", pricing: { billing_mode: "per_second", per_request_price: 1.2,
    intervals: [
      { min_tokens: 0, max_tokens: null, tier_label: "480p", per_request_price: .4 },
      { min_tokens: 0, max_tokens: null, tier_label: "720p", per_request_price: .62 },
      { min_tokens: 0, max_tokens: null, tier_label: "1080p", per_request_price: 1.45 },
    ] } };

  it("preserves the live group 54 second prices and selects only the requested resolution", () => {
    const decoded = secureSkillCatalogPricing(seconds, options)!;
    expect(decoded.pricing).toMatchObject({ kind: "tiered", currency: "CNY", billingUnit: "second", confidence: "exact" });
    expect(decoded.priceLabel).toBe("480p ¥0.4/秒 · 720p ¥0.62/秒 · 1080p ¥1.45/秒");
    expect(["480p", "720p", "1080p"].map(resolution => modelPriceAmount(decoded.pricing, { resolution }))).toEqual([.4, .62, 1.45]);
    expect(modelPriceAmount(decoded.pricing, {})).toBeUndefined();
    expect(modelPriceAmount(decoded.pricing, { resolution: "4K" })).toBeUndefined();
    expect(decoded.pricing.unitAmount).toBeUndefined();
  });

  it("keeps other groups of the same model separate and applies only their own multiplier once", () => {
    const first = secureSkillCatalogPricing({ ...seconds, pricing: { ...seconds.pricing, intervals: [
      { tier_label: "480p", per_request_price: .45 }, { tier_label: "720p", per_request_price: .55 },
    ] } }, { ...options, multiplier: .5 })!;
    const second = secureSkillCatalogPricing(seconds, { ...options, multiplier: 2 })!;
    expect(first.pricing.tiers?.map(tier => tier.price)).toEqual([.225, .275]);
    expect(second.pricing.tiers?.map(tier => tier.price)).toEqual([.8, 1.24, 2.9]);
    expect(modelPriceAmount(first.pricing, { resolution: "1080p" })).toBeUndefined();
  });

  it("retains request billing when its interval is resolution dependent instead of converting it to seconds", () => {
    const decoded = secureSkillCatalogPricing({ name: "seedance2.0", pricing: { billing_mode: "per_request",
      intervals: [{ tier_label: "720p", per_request_price: 3.5 }] } }, options)!;
    expect(decoded.pricing).toMatchObject({ kind: "tiered", billingUnit: "request" });
    expect(decoded.priceLabel).toBe("720p ¥3.5/请求");
    expect(modelPriceAmount(decoded.pricing, { resolution: "720p", duration: 15 })).toBe(3.5);
    expect(modelPriceAmount(decoded.pricing, { resolution: "1080p" })).toBeUndefined();
  });

  it("imports explicit flat image, request and second rates without the token-unit conversion", () => {
    for (const [billing_mode, kind, billingUnit] of [["image", "per-image", "image"], ["per_request", "per-request", "request"], ["per_second", "per-second", "second"]]) {
      const decoded = secureSkillCatalogPricing({ name: "grok-imagine-video-1.5", pricing: { billing_mode, per_request_price: .48, intervals: [] } }, { ...options, multiplier: .5 })!;
      expect(decoded.pricing).toMatchObject({ kind, billingUnit, unitAmount: .24, currency: "CNY" });
      expect(modelPriceAmount(decoded.pricing, {})).toBe(.24);
    }
    expect(secureSkillCatalogPricing({ name: "seedance-2.5", pricing: { billing_mode: "per_second", per_request_price: 0 } }, options)?.pricing.unitAmount).toBe(0);
  });

  it("uses final group image rates without multiplying again or substituting the model's higher interval", () => {
    const decoded = secureSkillCatalogPricing({ name: "gpt-image-2", pricing: { billing_mode: "image", per_request_price: .9,
      intervals: [{ tier_label: "1K", per_request_price: .7 }] } }, { ...options, multiplier: .3,
      group: { image_price_1k: .17, image_price_2k: .17, image_price_4k: .17 } })!;
    expect(decoded.pricing).toMatchObject({ kind: "tiered", billingUnit: "image" });
    expect(decoded.pricing.tiers?.map(tier => tier.price)).toEqual([.17, .17, .17]);
    expect(modelPriceAmount(decoded.pricing, { resolution: "2k" })).toBe(.17);
    expect(decoded.priceLabel).toBe("1K ¥0.17/张 · 2K ¥0.17/张 · 4K ¥0.17/张");
  });

  it("rejects unrepresentable intervals and conflicting resolution prices rather than using a flat fallback", () => {
    for (const intervals of [[{ tier_label: "480p with audio", per_request_price: .4 }], [{ tier_label: "480p", min_tokens: 1, per_request_price: .4 }],
      [{ tier_label: "480p", max_tokens: 1000, per_request_price: .4 }], [{ tier_label: "480p", per_request_price: null }],
      [{ tier_label: "480p", per_request_price: "0.4" }], [{ tier_label: "480p", per_request_price: .4 }, { tier_label: "480p", per_request_price: .5 }], {}]) {
      expect(secureSkillCatalogPricing({ ...seconds, pricing: { ...seconds.pricing, intervals } }, options)).toBeUndefined();
    }
  });

  it("does not extend the official currency and host convention to other suppliers or malformed media amounts", () => {
    expect(secureSkillCatalogPricing(seconds, { ...options, supplierSiteUrl: "https://other.example" })).toBeUndefined();
    expect(secureSkillCatalogPricing({ ...seconds, pricing: { ...seconds.pricing, currency: "USD" } }, options)).toBeUndefined();
    for (const per_request_price of [-1, "0.4", Number.NaN, Number.POSITIVE_INFINITY, 1e308]) {
      expect(secureSkillCatalogPricing({ name: "seedance-2.5", pricing: { billing_mode: "per_second", per_request_price } }, { ...options, multiplier: 2 })).toBeUndefined();
    }
    expect(secureSkillCatalogPricing({ ...seconds, name: "" }, options)).toBeUndefined();
  });

  it("restricts additional video-directory declarations to the exact official host, platform and full model ID", () => {
    for (const [platform, modelId] of [["flow2", "omni"], ["newtoken-sd", "video-2.0-fast"], ["newtoken-sd", "video-2.0-pro"]]) {
      expect(secureSkillCatalogVideoDeclaration(modelId, platform, options.supplierSiteUrl)).toBe(true);
      expect(secureSkillCatalogVideoDeclaration(`${modelId}-preview`, platform, options.supplierSiteUrl)).toBe(false);
      expect(secureSkillCatalogVideoDeclaration(modelId, "unknown", options.supplierSiteUrl)).toBe(false);
      for (const url of ["https://other.example", "https://token.secure-skill.com.evil.example", "http://token.secure-skill.com", "https://user@token.secure-skill.com", "https://token.secure-skill.com/gateway", "https://token.secure-skill.com?auth=example"]) {
        expect(secureSkillCatalogVideoDeclaration(modelId, platform, url)).toBe(false);
      }
    }
    expect(secureSkillCatalogVideoDeclaration("gemini-3-pro-image", "flow2", options.supplierSiteUrl)).toBe(false);
    expect(secureSkillCatalogVideoDeclaration("omni", "newtoken-sd", options.supplierSiteUrl)).toBe(false);
  });
});

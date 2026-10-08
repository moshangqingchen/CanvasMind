import { describe, expect, it } from "vitest";
import { secureSkillCatalogPricing } from "./secure-skill-catalog-pricing.js";

const options = { supplierSiteUrl: "https://token.secure-skill.com", checkedAt: "2026-10-08T11:21:08.582Z" };
const id = "doubao-seedance-2-0-260128";
const row = { name: id, pricing: { billing_mode: "token", input_price: .0000299, output_price: .000029,
  reference_video_output_price: .0000182, output_price_1080p: null, intervals: [] } };

describe("Secure Skill official video token prices", () => {
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

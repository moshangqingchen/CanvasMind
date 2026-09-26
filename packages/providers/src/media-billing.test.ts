import { describe, expect, it } from "vitest";
import { mediaExpressionPricing, modelPriceAmount, mediaPricingLabel } from "./media-billing.js";
import { catalogPriceLabel } from "./catalog-pricing.js";
const quality = '(param("quality") == "xhigh" || param("quality") == "max") ? tier("xhigh", n * 0.40) : tier("std", n * 0.20)';
const options = { currency: "CNY", checkedAt: "2026-09-21", unit: "image" as const };
describe("documented media billing expressions", () => {
  it("prices both premium qualities and the ordinary/default branch with group multipliers", () => {
    const pricing = mediaExpressionPricing(quality, { ...options, multiplier: 1.5 })!;
    for (const value of ["xhigh", "max"]) expect(modelPriceAmount(pricing, { quality: value })).toBe(0.6);
    for (const value of ["low", "medium", "high", "auto", undefined]) expect(modelPriceAmount(pricing, { quality: value })).toBe(0.3);
    expect(mediaPricingLabel(pricing)).toContain("xhigh/max ¥0.6/张");
    expect(catalogPriceLabel({ billing_mode: "tiered_expr", billing_expr: quality, quota_type: 1, model_price: 0.2, request_unit: "image" }, { newApi: true, currency: "CNY" })).toContain("xhigh/max ¥0.4/张");
  });
  it("handles resolution chains and per-second units separately from per-task pricing", () => {
    const task = mediaExpressionPricing('has(param("resolution"), "1080") ? tier("1080p", n * 29) : has(param("resolution"), "720") ? tier("720p", n * 19) : tier("480p", n * 12.8)', { ...options, unit: "request" })!;
    expect(modelPriceAmount(task, { resolution: "720p" })).toBe(19);
    expect(modelPriceAmount(task, { resolution: "1080p" })).toBe(29);
    expect(task.billingUnit).toBe("request");
    const seconds = mediaExpressionPricing('has(param("resolution"), "720") ? tier("720p", (vs == 0 ? 6 : vs) * 0.11) : tier("480p", (vs == 0 ? 6 : vs) * 0.08)', options)!;
    expect(seconds.billingUnit).toBe("second");
    expect(modelPriceAmount(seconds, { resolution: "720p" })).toBe(0.11);
  });
  it("includes prompt speed switches and refuses unknown expression syntax", () => {
    const speed = mediaExpressionPricing('!(param("speed") == "fast" || has(param("prompt"), "--fast")) ? tier("relax", n * 0.29) : tier("fast", n * 0.39)', { ...options, unit: "request" })!;
    expect(modelPriceAmount(speed, {})).toBe(0.29);
    expect(modelPriceAmount(speed, { prompt: "a poster --fast" })).toBe(0.39);
    for (const expression of [quality + '; evil()', quality.replace('n * 0.40', 'n * unknown()'), 'tier("base", tin * 5)', quality.replace('||', '&&')]) {
      expect(mediaExpressionPricing(expression, options)).toBeUndefined();
      expect(catalogPriceLabel({ billing_mode: "tiered_expr", billing_expr: expression, model_price: 0.2, quota_type: 1 })).toContain("按条件/用量计费");
    }
  });
});

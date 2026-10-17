import { describe, expect, it } from "vitest";
import type { ModelDescriptor, StructuredModelPricing } from "./contracts.js";
import { selectModelQuote } from "./media-billing.js";

const at = "2026-10-17T00:00:00Z";
const pricing: StructuredModelPricing = { kind: "tiered", currency: "CNY", billingUnit: "image", checkedAt: at, confidence: "exact",
  evidence: { sourceKey: "source", status: "published", checkedAt: at },
  tiers: [{ id: "2", label: "2K", dimension: "resolution", value: "2K", price: 1,
    evidence: { sourceKey: "source", status: "retained", checkedAt: "2026-10-01T00:00:00Z" } },
  { id: "4", label: "4K", dimension: "resolution", value: "4K", price: 2,
    evidence: { sourceKey: "source", status: "published", checkedAt: at } }] };
const model: ModelDescriptor = { id: "full-id", name: "Full", operations: ["image.generate"], pricing, metadata: { priceStatus: "partial" } };
describe("shared quote selector", () => {
  it("shows retained branches but only estimates the exact fresh branch", () => {
    expect(selectModelQuote(model, { resolution: "2K" })).toMatchObject({ historical: true, pricing });
    expect(selectModelQuote(model, { resolution: "2K" }).estimatePricing).toBeUndefined();
    expect(selectModelQuote(model, { resolution: "4K" }).amount).toBe(2);
    expect(selectModelQuote(model, { resolution: "8K" }).amount).toBeUndefined();
  });
  it("keeps ordered any/contains/otherwise matching intact", () => {
    const tariff = { ...pricing, tiers: [{ id: "first", label: "first", price: 4, conditions: [{ parameter: "quality", operator: "contains" as const, value: "high" }] },
      { id: "fallback", label: "fallback", price: 7, otherwise: true }] };
    expect(selectModelQuote({ ...model, pricing: tariff }, { quality: "ultra-high" }).amount).toBe(4);
    expect(selectModelQuote({ ...model, pricing: tariff }, { quality: "low" }).amount).toBe(7);
  });
  it("never treats generated results, legacy partial or conflicts as fixed estimates", () => {
    for (const metadata of [{ priceSource: "generated-result" }, { priceStatus: "partial" }, { supplierPriceConflict: true }]) {
      expect(selectModelQuote({ ...model, pricing: { kind: "per-image", currency: "CNY", unitAmount: .5, checkedAt: at, confidence: "exact" }, metadata }).amount).toBeUndefined();
    }
  });
  it("does not lend an operation-scoped price to another operation", () => {
    const scoped = { ...pricing, tiers: undefined, kind: "per-image" as const, unitAmount: .5,
      evidence: { sourceKey: "s", status: "published" as const, checkedAt: at, operations: ["image.edit" as const] } };
    expect(selectModelQuote({ ...model, pricing: scoped }, {}, { operation: "image.generate" }).amount).toBeUndefined();
    expect(selectModelQuote({ ...model, pricing: scoped }, {}, { operation: "image.edit" }).amount).toBe(.5);
  });
  it("keeps manual prices ahead of directory historical status and measured evidence separate", () => {
    const measured = { amount: 3, currency: "CNY", parameters: { quality: "high" }, requestId: "r" };
    const result = selectModelQuote({ pricing: { kind: "per-image", currency: "CNY", unitAmount: .7, checkedAt: at, confidence: "exact" },
      metadata: { priceSource: "manual", priceStatus: "partial", measuredPrice: measured } });
    expect(result.amount).toBe(.7); expect(result.measured).toEqual([measured]);
  });
});

import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { quoteCandidate } from "@super-canvas/director";
import { modelEstimatedCost } from "./model-display";
import { modelPickerPriceData } from "./model-picker-data";
import { designBatchPrice } from "./design-batch-price";
import { applySupplierCatalogPrices } from "./supplier-model-pricing";
import { catalogPriceDescriptor } from "./supplier-catalog-price-merge";
import type { CanvasNode } from "../components/types";

const freshAt = "2026-10-17T00:00:00Z", oldAt = "2026-10-01T00:00:00Z";
const model: ModelDescriptor = { id: "image-full-id", name: "Image", operations: ["image.generate"],
  parameters: [{ key: "quality", label: "质量", control: "select", options: [{ label: "旧", value: "old" }, { label: "新", value: "new" }] }],
  pricing: { kind: "tiered", currency: "CNY", billingUnit: "image", checkedAt: freshAt, confidence: "exact",
    evidence: { sourceKey: "source", checkedAt: freshAt, status: "published" },
    tiers: [{ id: "old", label: "old", dimension: "quality", value: "old", price: 1, evidence: { sourceKey: "source", checkedAt: oldAt, status: "retained" } },
      { id: "new", label: "new", dimension: "quality", value: "new", price: 2, evidence: { sourceKey: "source", checkedAt: freshAt, status: "published" } }] },
  metadata: { priceStatus: "partial", priceSource: "supplier-catalog", catalogPriceEvidence: { schemaVersion: 1, status: "published", entries: [] } } };
const candidate = { connectionId: "key", connectionName: "Key", provider: "rest", supplier: "Fixture", model,
  authoritative: true, catalogCheckedAt: freshAt };
describe("catalog quote consumers", () => {
  it("uses the same fresh condition in the menu, parameter preview, batch and final fee confirmation", () => {
    expect(modelPickerPriceData(model)).toContain(`上次价格 · 采样时间 ${oldAt}`);
    for (const quality of ["old", "new"]) {
      const expected = quality === "new" ? 2 : undefined;
      expect(modelEstimatedCost(model, { quality })).toBe(expected === undefined ? undefined : "2 CNY");
      const node: CanvasNode = { id: "n", position: { x: 0, y: 0 }, data: { nodeType: "image-generation", label: "N", parameters: { quality } } };
      expect(designBatchPrice(model, [node])).toMatchObject({ unknown: expected === undefined ? 1 : 0, total: expected ?? 0 });
      const quote = quoteCandidate(candidate, { operation: "image.generate", count: 1, quality }, undefined, { now: new Date(freshAt) });
      expect(quote.originalMaximum).toBe(expected); expect(quote.pricingStatus).toBe(expected === undefined ? "unknown" : "known");
    }
  });
  it("does not revive an explicitly withdrawn pipeline price through old enrichment metadata", () => {
    const withdrawn: ModelDescriptor = { ...model, pricing: undefined, metadata: { ...model.metadata, priceStatus: "explicit-unpublished",
      catalogPriceEvidence: { schemaVersion: 1, status: "explicit-unpublished", entries: [] }, priceLabel: "价格未公布" } };
    const result = applySupplierCatalogPrices([withdrawn], "default", { kind: "newapi", status: "live", checkedAt: freshAt, complete: true,
      groups: [{ id: "default", label: "default", source: "catalog", models: [{ id: model.id, capability: "image", priceLabel: "¥99/张" }] }] }, "https://fixture.invalid");
    expect(result[0]?.pricing).toBeUndefined(); expect(modelPickerPriceData(result[0])).toBe("—");
  });
  it("never resurrects a withdrawn tariff from legacy metadata after a JSON roundtrip", () => {
    const stored = JSON.parse(JSON.stringify({ ...model, pricing: undefined, metadata: { ...model.metadata, priceLabel: "价格未公布",
      priceStatus: "explicit-unpublished", officialCatalogPricing: model.pricing,
      catalogPriceEvidence: { schemaVersion: 1, status: "explicit-unpublished", entries: [] } } }));
    const hydrated = catalogPriceDescriptor(stored);
    expect(hydrated.pricing).toBeUndefined(); expect(modelPickerPriceData(hydrated)).toBe("—");
    expect(modelEstimatedCost(hydrated, { quality: "new" })).toBeUndefined();
    expect(quoteCandidate({ ...candidate, model: hydrated }, { operation: "image.generate", count: 1, quality: "new" },
      undefined, { now: new Date(freshAt) }).pricingStatus).toBe("unknown");
    for (const protection of [{ priceSource: "manual" }, { customBilling: true }])
      expect(catalogPriceDescriptor({ ...stored, metadata: { ...stored.metadata, ...protection } }).pricing).toEqual(model.pricing);
    // A manually declared model/protocol is not a manually authored quote.
    expect(catalogPriceDescriptor({ ...stored, metadata: { ...stored.metadata, source: "manual" } }).pricing).toBeUndefined();
  });
  it("uses explicit request billing count consistently and never infers included units from capacity", () => {
    const requestModel: ModelDescriptor = { ...model,
      limits: { maxOutputImages: 4 },
      parameters: [{ key: "n", label: "数量", control: "number", min: 1, max: 4 }],
      pricing: { kind: "per-request", currency: "CNY", unitAmount: 6, checkedAt: freshAt, confidence: "exact",
        evidence: { sourceKey: "source", checkedAt: freshAt, status: "published" } } };
    expect(modelEstimatedCost(requestModel, { n: 2 })).toBe("12 CNY");
    const node: CanvasNode = { id: "request", position: { x: 0, y: 0 }, data: {
      nodeType: "image-generation", label: "N", parameters: { n: 2 } } };
    expect(designBatchPrice(requestModel, [node])).toMatchObject({ unknown: 0, total: 12 });
    const chosen = { ...candidate, model: requestModel };
    expect(quoteCandidate(chosen, { operation: "image.generate", count: 2, pricingParameters: { n: 2 } },
      undefined, { now: new Date(freshAt) }).originalMaximum).toBe(12);
    expect(quoteCandidate(chosen, { operation: "image.generate", count: 2 },
      undefined, { now: new Date(freshAt) }).pricingStatus).toBe("unknown");
    const retained = { ...requestModel, metadata: { ...requestModel.metadata, source: "manual", priceStatus: "partial" },
      pricing: { ...requestModel.pricing!, evidence: { sourceKey: "source", checkedAt: oldAt, status: "retained" as const } } };
    expect(modelEstimatedCost(retained, { n: 2 })).toBeUndefined();
  });
});

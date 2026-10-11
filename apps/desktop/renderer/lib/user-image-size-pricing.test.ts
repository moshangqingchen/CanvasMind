import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { applyUserImageSizePresets } from "@super-canvas/providers/image-size-presets";
import { normalizeTk1688CnyModel } from "@super-canvas/providers/tk1688-catalog";
import { ModelPriceDetails } from "../components/model-price-details";
import { modelEstimatedCost, modelPriceSummary } from "./model-display";
import { modelPickerPriceData } from "./model-picker-data";

const tkOpenSize: ModelDescriptor = {
  id: "gpt-image-2@s1c1", name: "隔离 TK 图片报价", operations: ["image.generate"],
  metadata: { tk1688Catalog: true, tk1688FxRate: 7, tk1688SupportedResolutions: ["1K", "2K", "4K"] },
  parameters: [
    { key: "resolution", label: "分辨率", control: "select", default: "auto",
      options: ["auto", "1K", "2K", "4K"].map(value => ({ value, label: value })) },
    { key: "quality", label: "质量", control: "select", default: "high", options: [{ value: "high", label: "高" }] },
    { key: "n", label: "数量", control: "number", min: 1, max: 4, default: 1 },
  ],
  pricing: { kind: "tiered", billingUnit: "request", currency: "USD", checkedAt: "2026-10-11", confidence: "exact",
    tiers: [
      { id: "2k", label: "2K", price: 0.1, conditions: [{ parameter: "resolution", operator: "equals", value: "2K" }] },
      { id: "4k", label: "4K", price: 0.2, conditions: [{ parameter: "resolution", operator: "equals", value: "4K" }] },
    ] },
};

describe("user image presets remain available after quote currency normalization", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("quotes selected open pixel presets and quantities without treating TK examples as a closed enum", () => {
    const restored = applyUserImageSizePresets(normalizeTk1688CnyModel(tkOpenSize));
    const before = structuredClone(restored);
    for (const model of [tkOpenSize, restored]) {
      expect(modelEstimatedCost(model, { size: "3840x2160", size_tier: "4K", n: 2 })).toBe("2.8 CNY");
      expect(modelPriceSummary(model, { size: "3840x2160", size_tier: "4K" })).toBe("¥1.4 / 次");
      expect(modelEstimatedCost(model, { size: "2048x2048", size_tier: "2K" })).toBe("0.7 CNY");
      expect(modelEstimatedCost(model, { size: "auto", size_tier: "4K" })).toBe("1.4 CNY");
      expect(modelEstimatedCost(model, { size: "3840x2160", size_tier: "4K", n: 5 })).toBeUndefined();
    }
    expect(restored).toEqual(before);
    expect(tkOpenSize.pricing?.currency).toBe("USD");
  });

  it("retains the matching selected quote without duplicating the parameter controls as prose", () => {
    const restored = applyUserImageSizePresets(normalizeTk1688CnyModel(tkOpenSize));
    for (const model of [tkOpenSize, restored]) {
      expect(modelPickerPriceData(model)).toContain("分辨率=4K · 1.4 CNY / 次");
      const html = renderToStaticMarkup(React.createElement(ModelPriceDetails, {
        model, parameters: { size: "3840x2160", size_tier: "4K" },
      }));
      expect(html).toContain("本次预计费用");
      expect(html).toContain("1.4 CNY");
      expect(html).not.toContain("型号参数数据");
      expect(html).not.toContain("4K · 3:2 · 3520 × 2336");
    }
  });

  it("continues to withhold a quote for pixels outside a supplier's explicit fixed-size contract", () => {
    const fixed: ModelDescriptor = { ...tkOpenSize, metadata: { ...tkOpenSize.metadata, tk1688FixedSize: "1024x1024" },
      parameters: [{ key: "size", label: "固定尺寸", control: "select", default: "1024x1024",
        options: [{ value: "1024x1024", label: "1024 × 1024" }] }],
      pricing: { kind: "per-request", currency: "USD", unitAmount: 0.1, checkedAt: "2026-10-11", confidence: "exact" } };
    expect(modelEstimatedCost(fixed, { size: "3840x2160", size_tier: "4K" })).toBeUndefined();
    expect(modelEstimatedCost(fixed, { size: "1024x1024" })).toBe("0.7 CNY");
  });
});

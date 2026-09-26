import { describe, expect, it } from "vitest";
import { appendPriceLabelOnce, cleanModelDisplayName, modelPriceSummary, comparableModelPrice } from "./model-display";
import { mediaExpressionPricing, type ModelDescriptor } from "@super-canvas/providers";

describe("appendPriceLabelOnce", () => {
  it("compares exact supplier model prices and refuses unsupported parameter combinations", () => {
    const models: ModelDescriptor[] = [{ id: "image", name: "Image", operations: ["image.generate"], metadata: { priceLabel: "¥0.3/张" },
      parameters: [{ key: "quality", label: "质量", control: "select", options: [{ value: "high", label: "高" }] }] }];
    expect(comparableModelPrice(models, "image", { quality: "high" })).toBe("同型号 ¥0.3/张");
    expect(comparableModelPrice(models, "image", { quality: "max" })).toBe("当前参数不支持");
    expect(comparableModelPrice(models, "different-image", {})).toBe("同型号未报价");
  });
  it("labels measured prices with their tested quality and resolution", () => {
    const label = "¥0.4/张（生成实测） · 4K / max";
    const model: ModelDescriptor = { id: "image", name: "Image", operations: ["image.generate"],
      parameters: [{ key: "quality", label: "质量", control: "select", default: "max" }],
      metadata: { priceSource: "generated-result", priceLabel: label, measuredPrice: { resolution: "4K", quality: "max", parameters: { size: "3840x2160" } } } };
    expect(modelPriceSummary(model, { size: "3840x2160", quality: "max" })).toBe(label);
    expect(modelPriceSummary(model, { quality: "high" })).toBe(`当前组合未测价；上次 ${label}`);
    expect(modelPriceSummary(model, { size_tier: "2K" })).toBe(`当前组合未测价；上次 ${label}`);
  });

  it("updates the displayed price when quality or video resolution changes", () => {
    const model: ModelDescriptor = { id: "flare-4k", name: "Flare", operations: ["image.generate"],
      parameters: [{ key: "quality", label: "质量", control: "select", default: "max" }],
      pricing: mediaExpressionPricing('(param("quality") == "xhigh" || param("quality") == "max") ? tier("xhigh", n * 0.40) : tier("std", n * 0.20)', { currency: "CNY", checkedAt: "now", unit: "image" })!,
    };
    expect(modelPriceSummary(model, {})).toBe("0.4 CNY / 张");
    expect(modelPriceSummary(model, { quality: "high" })).toBe("0.2 CNY / 张");
    model.pricing = mediaExpressionPricing('has(param("resolution"), "720") ? tier("720p", n * 22.14) : tier("480p", n * 10.32)', { currency: "CNY", checkedAt: "now", unit: "request" })!;
    expect(modelPriceSummary(model, { resolution: "720p" })).toBe("22.14 CNY / 次");
  });
  it("keeps video names separate from prices when the catalog uses 次 and 请求 interchangeably", () => {
    expect(cleanModelDisplayName("grok-imagine-video（¥0.08/次）", "¥0.08/请求")).toBe("grok-imagine-video");
    expect(cleanModelDisplayName("grok-imagine-video · $2 / 请求", "$2 / 请求")).toBe("grok-imagine-video");
  });
  it("does not duplicate a price already embedded in the model name", () => {
    expect(appendPriceLabelOnce("kling-3.0-omni（¥0.1/秒）", "¥0.1/秒")).toBe(
      "kling-3.0-omni（¥0.1/秒）",
    );
  });

  it("adds metadata-only prices", () => {
    expect(appendPriceLabelOnce("kling-3.0-omni", "¥0.1/秒")).toBe(
      "kling-3.0-omni（¥0.1/秒）",
    );
  });

  it("replaces a stale unknown-price placeholder instead of showing both", () => {
    expect(appendPriceLabelOnce("new-image（价格以平台为准）", "¥0.025/张")).toBe("new-image（¥0.025/张）");
  });
});

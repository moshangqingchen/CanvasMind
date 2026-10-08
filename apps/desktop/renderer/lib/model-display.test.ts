import { describe, expect, it } from "vitest";
import { appendPriceLabelOnce, cleanModelDisplayName, modelPriceSummary, comparableModelPrice, modelEstimatedCost } from "./model-display";
import { mediaExpressionPricing, type ModelDescriptor } from "@super-canvas/providers";

describe("appendPriceLabelOnce", () => {
  it("estimates request quantities and per-second video costs with selected tiers", () => {
    const model: ModelDescriptor = { id: "video", name: "Video", operations: ["video.generate"],
      parameters: [{ key: "duration", label: "时长", control: "number", valueType: "integer", min: 4, max: 15, default: 5 },
        { key: "resolution", label: "分辨率", control: "select", default: "720p", options: ["720p", "1080p"].map(value => ({ label: value, value })) }],
      pricing: { kind: "tiered", billingUnit: "second", currency: "CNY", checkedAt: "now", confidence: "exact",
        tiers: [{ id: "720", label: "720p", dimension: "resolution", value: "720p", price: .12 }, { id: "1080", label: "1080p", dimension: "resolution", value: "1080p", price: .24 }] } };
    expect(modelEstimatedCost(model, { duration: 10 })).toBe("1.2 CNY");
    expect(modelEstimatedCost(model, { duration: 10, resolution: "1080p" })).toBe("2.4 CNY");
    expect(modelEstimatedCost(model, { duration: 99 })).toBeUndefined();
    expect(modelEstimatedCost({ ...model, metadata: { billingIncludesInputDuration: true } }, {})).toBeUndefined();
    expect(modelEstimatedCost({ ...model, pricing: { kind: "per-request", currency: "CNY", unitAmount: .25, confidence: "snapshot", checkedAt: "now" } }, { n: 2 })).toBe("0.5 CNY（参考）");
    expect(modelEstimatedCost(undefined, {})).toBeUndefined();
  });
  it("uses CNY for saved Tk1688 quotes while retaining other suppliers' currencies", () => {
    const model: ModelDescriptor = { id: "gpt-image-2@s1c1", name: "Image", operations: ["image.generate"],
      metadata: { tk1688Catalog: true, tk1688FxRate: 6.8896, priceLabel: "$0.03/次（¥0.206688/次）" },
      pricing: { kind: "per-request", currency: "USD", unitAmount: .03, checkedAt: "then", confidence: "snapshot" } };
    expect(modelPriceSummary(model, {})).toBe("¥0.206688 / 次（参考）");
    expect(model.pricing?.currency).toBe("USD");
    expect(modelPriceSummary({ ...model, metadata: { tk1688Catalog: true } }, {})).toBe("人民币价格暂不可用（汇率未读取）");
    expect(modelPriceSummary({ ...model, metadata: {} }, {})).toBe("0.03 USD / 次（参考）");
  });
  it("compares exact supplier model prices and refuses unsupported parameter combinations", () => {
    const models: ModelDescriptor[] = [{ id: "image", name: "Image", operations: ["image.generate"], metadata: { priceLabel: "¥0.3/张" },
      parameters: [{ key: "quality", label: "质量", control: "select", options: [{ value: "high", label: "高" }] }] }];
    expect(comparableModelPrice(models, "image", { quality: "high" })).toBe("同型号 ¥0.3/张");
    expect(comparableModelPrice(models, "image", { quality: "max" })).toBe("当前参数不支持");
    expect(comparableModelPrice(models, "different-image", {})).toBe("当前分组无此型号");
    expect(comparableModelPrice(models, undefined, {})).toBe("未选择型号");
  });
  it("distinguishes a missing exact Synora model from an existing model without a quote", () => {
    const models: ModelDescriptor[] = [{ id: "gpt-image-2.5-flare", name: "Flare", operations: ["image.generate"], metadata: { priceLabel: "0.07 额度 / 张" } },
      { id: "gpt-image-2", name: "Image 2", operations: ["image.generate"] }];
    expect(comparableModelPrice(models, "gpt-image-2.5", {})).toBe("当前分组无此型号");
    expect(comparableModelPrice(models, "gpt-image-2.5-flare", {})).toBe("同型号 0.07 额度 / 张");
    expect(comparableModelPrice(models, "gpt-image-2", {})).toBe("同型号未报价");
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

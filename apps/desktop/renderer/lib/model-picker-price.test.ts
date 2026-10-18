import { describe, expect, it } from "vitest";
import { remainingVideoModel, type ModelDescriptor } from "@super-canvas/providers";
import { modelEstimatedCost, modelPriceSummary } from "./model-display";
import { modelPickerDirectoryFact, modelPickerInventoryFact, modelPickerPriceData } from "./model-picker-data";

const bounded: ModelDescriptor = {
  id: "candidate-video", name: "Candidate", operations: ["video.generate"],
  parameters: [
    { key: "duration", label: "时长", control: "number", valueType: "integer", min: 5, max: 15, step: 1, default: 5 },
    { key: "resolution", label: "分辨率", control: "select", default: "480p", options: ["480p", "720p"].map(value => ({ label: value, value })) },
  ],
  pricing: { kind: "tiered", billingUnit: "second", currency: "CNY", checkedAt: "now", confidence: "exact",
    tiers: [{ id: "480", label: "480p", dimension: "resolution", value: "480p", price: .1 },
      { id: "720", label: "720p", dimension: "resolution", value: "720p", price: .2 }] },
};

describe("model picker directory facts and tariff data", () => {
  it("shows each model's full tariff independent of the selected model's 30-second parameters", () => {
    const current = Object.freeze({ duration: 30, resolution: "720p" });
    expect(modelPickerPriceData(bounded))
      .toBe("分辨率=480p · 0.1 CNY / 秒；分辨率=720p · 0.2 CNY / 秒");
    // A display change must not allow an invalid request or silently clip it.
    expect(modelPriceSummary(bounded, current)).toBe("当前参数不支持，请重新选择");
    expect(modelEstimatedCost(bounded, current)).toBeUndefined();
    expect(current).toEqual({ duration: 30, resolution: "720p" });
    expect(bounded.parameters?.[0]?.default).toBe(5);
  });

  it("keeps Jiasu's exact quote usable for declared open fields without claiming a supplier duration range", () => {
    const model = remainingVideoModel("jiasu", "seedance2.5-全参真人", {
      id: "seedance2.5-全参真人", name: "seedance2.5-全参真人", operations: ["video.generate"],
      pricing: { kind: "per-request", unitAmount: 1.1, currency: "CNY", checkedAt: "now", confidence: "exact" },
    }, { group: "vip" })!;
    const current = { duration: 30, resolution: "720p" };
    expect(modelPickerPriceData(model)).toBe("1.1 CNY / 次");
    expect(modelEstimatedCost(model, current)).toBe("1.1 CNY");
    expect(modelEstimatedCost(model, { ...current, duration: 31 })).toBeUndefined();
    expect(current).toEqual({ duration: 30, resolution: "720p" });
    const resolutionQuote: ModelDescriptor = { ...model, pricing: {
      kind: "tiered", billingUnit: "request", currency: "CNY", checkedAt: "now", confidence: "exact",
      tiers: [{ id: "720p", label: "720p", dimension: "resolution", value: "720p", price: 1.1 }],
    } };
    expect(modelEstimatedCost(resolutionQuote, current)).toBe("1.1 CNY");
    expect(modelEstimatedCost(resolutionQuote, { ...current, resolution: "1440p" })).toBeUndefined();
    expect(modelEstimatedCost(resolutionQuote, { duration: 30 })).toBeUndefined();
  });

  it("preserves every price condition instead of quoting only the cheapest or default tier", () => {
    const model: ModelDescriptor = { ...bounded, pricing: {
      kind: "tiered", billingUnit: "request", currency: "CNY", checkedAt: "now", confidence: "exact",
      tiers: [{ id: "default", label: "480p 5 秒", price: .5, conditionMode: "all", conditions: [
        { parameter: "resolution", operator: "equals", value: "480p" },
        { parameter: "duration", operator: "equals", value: "5" },
      ] }, { id: "selected", label: "720p 10 秒", price: 2, conditionMode: "all", conditions: [
        { parameter: "resolution", operator: "equals", value: "720p" },
        { parameter: "duration", operator: "equals", value: "10" },
      ] }],
    } };
    expect(modelPickerPriceData(model)).toBe("分辨率=480p 且 时长=5 · 0.5 CNY / 次；分辨率=720p 且 时长=10 · 2 CNY / 次");
    expect(modelEstimatedCost(model, { duration: 10, resolution: "720p" })).toBe("2 CNY");
  });

  it("displays exact measured request facts as a sample regardless of menu selection", () => {
    const label = "1 CNY / 次（生成实测） · 10 秒 / 720p";
    const measured: ModelDescriptor = { ...bounded, pricing: undefined, metadata: {
      priceSource: "generated-result", priceLabel: label,
      measuredPrice: { parameterScope: "exact", parameters: { duration: 10, resolution: "720p", video_input: "none", reference_video_count: 0, reference_video_duration_seconds: 0 } },
    } };
    expect(modelPickerPriceData(measured))
      .toBe(`${label} · 实测参数：时长=10，分辨率=720p，视频输入=none，参考视频数量=0，参考视频总秒数=0`);
    expect(modelPickerPriceData(measured)).not.toMatch(/当前组合|未确认|不支持/u);
    expect(modelEstimatedCost(measured, {})).toBeUndefined();
  });

  it("keeps pricing separate from incomplete parameter ranges and status messages", () => {
    const model: ModelDescriptor = { ...bounded, metadata: { durationRangeUnverified: true, resolutionRangeUnverified: true } };
    expect(modelPickerPriceData(model)).toContain("分辨率=480p · 0.1 CNY / 秒");
    expect(modelPickerPriceData({ ...model, pricing: undefined, metadata: { priceLabel: "价格条件待确认" } })).toBe("—");
    for (const label of ["价格读取 HTTP 404", "价格待核验（HTTP 200）", "0.5 CNY / 次（待验证）"])
      expect(modelPickerPriceData({ ...model, pricing: undefined, metadata: { priceLabel: label } })).toBe("—");
    expect(modelPickerPriceData({ ...model, pricing: undefined, metadata: { priceLabel: "¥0.5/次 · 720p" } })).toBe("¥0.5/次 · 720p");
  });

  it("lists image tariff tiers without inheriting another image's size or quality", () => {
    const image: ModelDescriptor = { id: "image", name: "Image", operations: ["image.generate"],
      parameters: [{ key: "size_tier", label: "档位", control: "select", default: "1K", options: ["1K", "4K"].map(value => ({ label: value, value })) }],
      pricing: { kind: "tiered", currency: "CNY", checkedAt: "now", confidence: "exact",
        tiers: [{ id: "1k", label: "1K", dimension: "resolution", value: "1K", price: .1 },
          { id: "4k", label: "4K", dimension: "resolution", value: "4K", price: .4 }] } };
    expect(modelPickerPriceData(image))
      .toBe("分辨率=1K · 0.1 CNY / 张；分辨率=4K · 0.4 CNY / 张");
    expect(modelPickerPriceData(undefined)).toBe("—");
  });

  it("preserves a supplier group's Chinese per-image price without inventing a currency", () => {
    const nativeGroup: ModelDescriptor = { id: "gpt-image-2", name: "GPT Image 2", operations: ["image.generate"],
      metadata: { priceSource: "supplier-group", priceLabel: "0.08一张，原生2K/4K" } };
    expect(modelPickerPriceData(nativeGroup)).toBe("0.08一张，原生2K/4K");
    expect(modelPickerPriceData({ ...nativeGroup, metadata: { ...nativeGroup.metadata, priceLabel: "0.08一张（待核验）" } })).toBe("—");
  });

  it("retains token billing components and reference-video conditions", () => {
    const model: ModelDescriptor = { ...bounded, pricing: { kind: "token", currency: "CNY", checkedAt: "now", confidence: "exact",
      inputPerMillion: 1, tiers: [{ id: "ref-output", label: "视频输出", price: 4, conditionMode: "all", conditions: [
        { parameter: "token_kind", operator: "equals", value: "output" },
        { parameter: "resolution", operator: "equals", value: "720p" },
        { parameter: "has_reference_video", operator: "equals", value: "true" },
      ] }] } };
    expect(modelPickerPriceData(model)).toBe("输入 1 CNY / 1M tokens；Token 类型=output 且 分辨率=720p 且 参考视频=true · 4 CNY / 1M tokens");
  });

  it("preserves historical quote and time multiplier scope without applying an unreported current multiplier", () => {
    const model: ModelDescriptor = { ...bounded, metadata: { priceStatus: "partial" }, pricing: { kind: "per-request", currency: "CNY", unitAmount: 1,
      checkedAt: "2026-10-10T03:04:05.000Z", confidence: "snapshot", timeMultipliers: [{ timeZone: "Asia/Shanghai", startHour: 14, endHour: 16, multiplier: 1.4 }] } };
    expect(modelPickerPriceData(model)).toBe("上次价格 · 采样时间 2026-10-10T03:04:05.000Z · 1 CNY / 次（目录快照）；时段倍率：上海 14:00–16:00 ×1.4");
  });

  it("separates completed Key comparisons from failed or incomplete directory reads", () => {
    const publicModel: ModelDescriptor = { ...bounded, metadata: { publicCatalogOnly: true, canvasRunnable: false } };
    expect(modelPickerDirectoryFact(publicModel, true)).toBe("官网目录 · 当前 Key 返回：0");
    expect(modelPickerDirectoryFact(publicModel, false)).toBe("官网目录 · 本次 Key 目录：—");
    expect(modelPickerDirectoryFact(bounded, true)).toBeUndefined();
    expect(publicModel.metadata?.canvasRunnable).toBe(false);
  });

  it("records partial inventory completeness and protocol data without emitting a runnable verdict", () => {
    const model = { ...bounded, metadata: { canvasRunnable: false, canvasUnavailableReason: "不支持", protocol: "openai-videos", endpointPath: "/v1/videos" } };
    expect(modelPickerInventoryFact(model, "live", false)).toEqual({ label: "Key 局部目录", tone: "ok",
      detail: "扫描状态：live · 完整目录：false · 协议：openai-videos · 提交接口：/v1/videos" });
    expect(modelPickerInventoryFact(model, "failed").detail).not.toMatch(/未确认|不支持|不可运行/u);
    expect(model.metadata.canvasRunnable).toBe(false);
  });
});

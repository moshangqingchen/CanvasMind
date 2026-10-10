import { describe, expect, it } from "vitest";
import { appendPriceLabelOnce, cleanModelDisplayName, modelPriceSummary, comparableModelPrice, modelEstimatedCost, displayPriceLabel } from "./model-display";
import { mediaExpressionPricing, type ModelDescriptor } from "@super-canvas/providers";
import { chuangxiangCatalogPricing } from "../../../../packages/providers/src/chuangxiang-catalog-pricing";
import { applyChuangxiangMidjourneyCapabilities } from "@super-canvas/providers/chuangxiang-midjourney-contract";

describe("appendPriceLabelOnce", () => {
  it("formats raw image names from saved catalogs without rewriting IDs or custom names", () => {
    expect(cleanModelDisplayName("gpt-image-2.5-sunburs")).toBe("GPT Image 2.5 Sunburst");
    expect(cleanModelDisplayName("gpt-image-2.5-sunburst（¥0.08/次）", "¥0.08/次")).toBe("GPT Image 2.5 Sunburst");
    expect(cleanModelDisplayName("gpt-image-2.5-flare-4k")).toBe("GPT Image 2.5 Flare 4K");
    expect(cleanModelDisplayName("Image-nano-banana-pro")).toBe("Nano Banana Pro");
    expect(cleanModelDisplayName("Image-nano-banana-2")).toBe("Nano Banana 2");
    expect(cleanModelDisplayName("nano-banana2-1k")).toBe("Nano Banana 2 1K");
    expect(cleanModelDisplayName("nano-banana-2-lite")).toBe("Nano Banana 2 Lite");
    expect(cleanModelDisplayName("N nano-banana-pro")).toBe("N Nano Banana Pro");
    expect(cleanModelDisplayName("gemini-nano-banana-2.1")).toBe("Gemini Nano Banana 2.1");
    expect(cleanModelDisplayName("gemini-3-pro-image-preview（FriModel）")).toBe("Gemini 3 Pro Image Preview（FriModel）");
    expect(cleanModelDisplayName("ad-gemini-3.1-flash-image-preview")).toBe("AD · Gemini 3.1 Flash Image Preview");
    expect(cleanModelDisplayName("gemini-3-pro-image-as")).toBe("Gemini 3 Pro Image AS");
    expect(cleanModelDisplayName("gpt-image-2 · 商家 s1c1")).toBe("GPT Image 2 · 商家 s1c1");
    expect(cleanModelDisplayName("高质量生图专线")).toBe("高质量生图专线");
    expect(cleanModelDisplayName("grok-imagine-video-1080p")).toBe("grok-imagine-video-1080p");
  });
  it("does not summarize media token billing with only the text input/output rates", () => {
    const media: ModelDescriptor = { id: "gpt-image-2", name: "Image", operations: ["image.generate"],
      pricing: { kind: "token", currency: "USD", inputPerMillion: 3.5, outputPerMillion: 7, imageOutputPerMillion: 21,
        checkedAt: "now", confidence: "exact" } };
    expect(modelPriceSummary(media, {})).toBe("按实际用量计费，详见价格说明");
    expect(modelEstimatedCost(media, {})).toBeUndefined();
  });
  it("distinguishes missing local quotes from failed, restricted and incomplete price reads", () => {
    expect(displayPriceLabel("价格未公布", "unpublished")).toBe("暂未取得报价");
    expect(displayPriceLabel(undefined, "unauthorized")).toBe("价格需登录查询");
    expect(displayPriceLabel("价格未公布", "partial")).toBe("价格目录未完整读取");
    expect(displayPriceLabel(undefined, "failed")).toBe("价格查询失败");
    expect(displayPriceLabel("¥0.875/次", "partial")).toBe("¥0.875/次");
    expect(modelPriceSummary({ id: "model", name: "model", operations: [], metadata: { priceLabel: "价格未公布" } }, {})).toBe("暂未取得报价");
  });
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
  it("quotes one Midjourney task with four returned images using the selected speed", () => {
    const name = "midjourney-1k", quoted = chuangxiangCatalogPricing({ name, effective_rate_multiplier: .1,
      pricing: { billing_mode: "per_request", per_request_price: 3.625,
        intervals: [{ tier_label: "relax", per_request_price: 3.625 }, { tier_label: "fast", per_request_price: 4.875 }] } }, "now")!;
    const model = applyChuangxiangMidjourneyCapabilities({ provider: "openai", config: {
      baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图", scannedModelIds: [name], modelScanStatus: "live",
    } }, { id: name, name, operations: [], pricing: quoted.pricing, metadata: { priceLabel: quoted.priceLabel } });
    expect(model.metadata?.fixedOutputCount).toBe(4);
    expect(modelPriceSummary(model, {})).toBe("0.3625 CNY / 次（参考）");
    expect(modelEstimatedCost(model, {})).toBe("0.3625 CNY（参考）");
    expect(modelEstimatedCost(model, { speed: "fast" })).toBe("0.4875 CNY（参考）");
    expect(modelPriceSummary(model, { speed: "{{speed}}" })).toBe("relax ¥0.3625/请求 · fast ¥0.4875/请求");
    expect(modelEstimatedCost(model, { speed: "{{speed}}" })).toBeUndefined();
    expect(modelEstimatedCost({ ...model, pricing: { kind: "per-image", currency: "CNY", unitAmount: .1, checkedAt: "now", confidence: "exact" },
      parameters: model.parameters?.filter(parameter => parameter.key !== "n") }, {})).toBe("0.4 CNY");
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
  it("keeps a complete default-request ledger observation exact after control or catalog changes", () => {
    const label = "0.8 账户计价单位/次（账单实测，仅默认请求；原件待取回）";
    const model: ModelDescriptor = { id: "video", name: "Video", operations: ["video.generate"],
      parameters: [{ key: "n", label: "数量", control: "number", default: 1 }],
      metadata: { priceSource: "generated-result", priceLabel: label, measuredPrice: {
        parameterScope: "exact", parameters: {}, equivalentDefaults: { n: 1 }, originalStatus: "awaiting-download" } } };
    expect(modelPriceSummary(model, { prompt: "different text", has_reference_video: false })).toBe(label);
    for (const parameters of [{ ratio: "16:9" }, { reference_images: ["https://media.example/a.png"] }, { has_reference_image: true },
      { mode: "edit" }, { n: 2 }, { fps: 24 }, { quality: "auto" }])
      expect(modelPriceSummary(model, parameters)).toBe(`当前组合未测价；上次 ${label}`);
    expect(modelPriceSummary({ ...model, parameters: [{ key: "ratio", label: "比例", control: "select", default: "16:9" }] }, {}))
      .toBe(`当前组合未测价；上次 ${label}`);
    expect(modelEstimatedCost(model, {})).toBeUndefined();
    expect(modelPriceSummary({ ...model, metadata: { ...model.metadata, measuredPrice: {
      parameterScope: "exact", parameters: { ratio: "16:9", n: 1 } } } }, {})).toBe(`当前组合未测价；上次 ${label}`);
  });
  it("keeps Jiasu video samples scoped to known reference mode, count and actual input duration", () => {
    const label = "¥4.968/次（生成实测） · 720p";
    const base = { duration: 5, resolution: "720p" };
    const model = (parameters: Record<string, unknown>): ModelDescriptor => ({ id: "doubao-seedance-2-0-260128", name: "Video", operations: ["video.generate"],
      metadata: { jiasuVideoContract: true, priceSource: "generated-result", priceLabel: label, measuredPrice: { resolution: "720p", parameters } } });
    const none = model({ ...base, video_input: "none" });
    expect(modelPriceSummary(none, { ...base, video_input: "none" })).toBe(label);
    expect(modelPriceSummary(none, { ...base, has_reference_video: false })).toBe(label);
    expect(modelPriceSummary(none, base)).toBe(`当前组合未测价；上次 ${label}`);
    expect(modelPriceSummary(none, { ...base, video_input: "video" })).toBe(`当前组合未测价；上次 ${label}`);
    const sampled = model({ ...base, video_input: "video", reference_video_count: 2, reference_video_duration_seconds: 15 });
    const current = { ...base, video_input: "video", reference_video_count: 2, reference_video_duration_seconds: 15 };
    expect(modelPriceSummary(sampled, current)).toBe(label);
    for (const changed of [{ reference_video_count: 1 }, { reference_video_duration_seconds: 14 }, { video_input: "none" }])
      expect(modelPriceSummary(sampled, { ...current, ...changed })).toBe(`当前组合未测价；上次 ${label}`);
    expect(modelPriceSummary(sampled, { ...base, videos: [{ url: "https://media.example/one.mp4", duration_seconds: 7 }, { url: "https://media.example/two.mp4", duration_seconds: 8 }] })).toBe(label);
    expect(modelPriceSummary(sampled, { ...base, videos: ["https://media.example/unknown-duration.mp4"] })).toBe(`当前组合未测价；上次 ${label}`);
    for (const conflicting of [
      { ...current, has_reference_video: false }, { ...current, input_video_count: 1 },
      { ...current, total_input_video_duration_seconds: 14 },
      { ...current, videos: [{ url: "https://media.example/one.mp4", duration_seconds: 15 }] },
      { ...current, videos: [{ url: "https://media.example/one.mp4", duration_seconds: 7 }, { url: "https://media.example/two.mp4", duration_seconds: 7 }] },
      { ...current, videos: [{ url: "https://media.example/one.mp4", duration_seconds: -1 }, { url: "https://media.example/two.mp4", duration_seconds: 16 }] },
    ]) expect(modelPriceSummary(sampled, conflicting)).toBe(`当前组合未测价；上次 ${label}`);
    expect(modelPriceSummary(none, { ...base, video_input: "none", reference_video_count: 0, reference_video_duration_seconds: 0,
      videos: ["https://media.example/reference.mp4"] })).toBe(`当前组合未测价；上次 ${label}`);
    expect(modelEstimatedCost(sampled, current)).toBeUndefined();
    const other = { ...sampled, metadata: { ...sampled.metadata, jiasuVideoContract: false } };
    expect(modelPriceSummary(other, base)).toBe(label);
  });

  it("keeps unknown billing conditions outside an exact ledger sample", () => {
    const label = "$0.08/张（账单实测） · 4K";
    const model: ModelDescriptor = { id: "image", name: "Image", operations: ["image.generate"],
      metadata: { priceSource: "generated-result", priceLabel: label,
        measuredPrice: { resolution: "4K", parameters: { n: 1, resolution: "4K" } } } };
    expect(modelPriceSummary(model, { size_tier: "4K", n: 1 })).toBe(label);
    for (const parameters of [{ quality: "high" }, { quality: "low" }, { n: 2 }, { mode: "edit" }, { size: "2048x1024" }])
      expect(modelPriceSummary(model, parameters)).toBe(`当前组合未测价；上次 ${label}`);
    expect(modelPriceSummary({ ...model, parameters: [{ key: "quality", label: "质量", control: "select", default: "high" }] }, {}))
      .toBe(`当前组合未测价；上次 ${label}`);
    const pixelSample = { ...model, metadata: { ...model.metadata,
      measuredPrice: { resolution: "1024X1024", parameters: { n: 1, resolution: "1024X1024" } } } };
    expect(modelPriceSummary(pixelSample, { size: "1024x1024", n: 1 })).toBe(label);
    expect(modelPriceSummary(pixelSample, { size: "2048x2048", n: 1 })).toBe(`当前组合未测价；上次 ${label}`);
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
  it("uses connected source videos to select Omni's editing quote and rejects contradictory modes", () => {
    const model: ModelDescriptor = { id: "omni-flash", name: "Omni Flash", operations: ["video.generate"],
      metadata: { sourceVideoPriceMode: "edit", priceLabel: "生成 8.25 USD；编辑 10.5 USD" },
      parameters: [{ key: "mode", label: "模式", control: "select", default: "auto", options: [
        { label: "自动", value: "auto" }, { label: "生成", value: "generate" }, { label: "编辑", value: "edit" } ] }],
      pricing: { kind: "tiered", currency: "USD", billingUnit: "request", confidence: "exact", checkedAt: "2026-10-09", tiers: [
        { id: "generate", label: "生成", price: 8.25, conditions: [{ parameter: "mode", operator: "equals", value: "generate" }] },
        { id: "edit", label: "编辑", price: 10.5, conditions: [{ parameter: "mode", operator: "equals", value: "edit" }] } ] } };
    expect(modelPriceSummary(model, { mode: "auto", has_reference_video: false })).toBe("8.25 USD / 次");
    expect(modelPriceSummary(model, { mode: "auto", has_reference_video: true })).toBe("10.5 USD / 次");
    expect(modelEstimatedCost(model, { mode: "auto", has_reference_video: true })).toBe("10.5 USD");
    expect(modelEstimatedCost(model, { mode: "auto" })).toBeUndefined();
    expect(modelPriceSummary(model, { mode: "generate", has_reference_video: true })).toBe("当前模式与参考视频不匹配");
    expect(modelEstimatedCost(model, { mode: "edit", has_reference_video: false })).toBeUndefined();
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

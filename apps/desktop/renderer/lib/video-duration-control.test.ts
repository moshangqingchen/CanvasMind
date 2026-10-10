import { describe, expect, it } from "vitest";
import type { ModelParameterDescriptor } from "@super-canvas/providers";
import { parameterDescriptorsForValues, coerceParameterInput, normalizedParametersForModel } from "./model-parameters";
import { videoDurationControl, videoDurationControlContext } from "./video-duration-control";

const duration: ModelParameterDescriptor = {
  key: "duration", label: "视频时长", control: "number", valueType: "integer",
  default: 5, min: 4, max: 30, step: 1,
};

describe("supplier video duration controls", () => {
  it("uses exact supplied bounds and keeps the numeric wire value", () => {
    expect(videoDurationControl("video-generation", duration, 5)).toEqual({ kind: "range", value: 5, min: 4, max: 30, step: 1 });
    expect(coerceParameterInput(duration, "30")).toBe(30);
    expect(videoDurationControl("video-generation", { ...duration, key: "seconds" }, "4")).toMatchObject({ kind: "range", value: 4 });
  });

  it("uses the current resolution constraint rather than the base model maximum", () => {
    const model = { parameters: [duration], metadata: { durationMaxByResolution: { "720p": 30, "1080p": 12 } } };
    const resolved = parameterDescriptorsForValues("video-generation", "rest", model, { resolution: "1080p", duration: 12 })[0]!;
    expect(videoDurationControl("video-generation", resolved, 12)).toMatchObject({ kind: "range", max: 12 });
    expect(videoDurationControl("video-generation", resolved, 30)).toMatchObject({ kind: "range", max: 12, invalidValue: "30" });
    const unknownGlobalUpper = { ...resolved, description: "未公开该模型上限；有独立分辨率上限。" };
    expect(videoDurationControl("video-generation", unknownGlobalUpper, 12, true, true)).toMatchObject({ kind: "range", max: 12 });
    const defaultsModel = { parameters: [duration, {
      key: "resolution", label: "分辨率", control: "select" as const, default: "720p",
      options: [{ value: "720p", label: "720p" }],
    }], metadata: model.metadata };
    const defaultResolutionDuration = parameterDescriptorsForValues("video-generation", "rest", defaultsModel, { duration: 5 })[0]!;
    expect(defaultResolutionDuration.max).toBe(30);
    const oldPreset = { ...defaultsModel, metadata: { durationMaxByResolution: { "720p": 12 } } };
    expect(parameterDescriptorsForValues("video-generation", "rest", oldPreset, { duration: 5 })[0]!.max).toBe(12);
  });

  it("uses the reference-video limit only for explicit videos or linked video context", () => {
    const model = { parameters: [duration], metadata: { durationMaxWithReferenceVideo: 18 } };
    const bound = (parameters: Record<string, unknown>, hasReferenceVideo = false) =>
      parameterDescriptorsForValues("video-generation", "rest", model, parameters, undefined, { hasReferenceVideo })[0]!.max;
    expect(bound({ duration: 5 })).toBe(30);
    expect(bound({ reference_videos: [] })).toBe(30);
    expect(bound({ reference_image_urls: ["https://example.invalid/image.png"], reference_audios: ["https://example.invalid/audio.mp3"] })).toBe(30);
    expect(bound({ reference_videos: ["https://example.invalid/video.mp4"] })).toBe(18);
    expect(bound({}, true)).toBe(18);
  });

  it("keeps every confirmed enum, including single durations, as a select", () => {
    const select: ModelParameterDescriptor = { ...duration, control: "select", options: [5, 10].map(value => ({ value, label: `${value} 秒` })) };
    expect(videoDurationControl("video-generation", select, 5)).toEqual({ kind: "select", options: select.options });
    expect(videoDurationControl("video-generation", { ...select, options: [{ value: 30, label: "30 秒" }] }, 30)).toEqual({ kind: "select", options: [{ value: 30, label: "30 秒" }] });
    expect(videoDurationControl("video-generation", { ...duration, min: 30, max: 30, default: 30 }, 30)).toEqual({ kind: "select", options: [{ value: 30, label: "30 秒" }] });
  });

  it("does not disguise unknown bounds, hints, automatic sentinels or invalid saved values", () => {
    expect(videoDurationControl("video-generation", duration, 5, true)).toMatchObject({ kind: "unavailable" });
    expect(videoDurationControl("video-generation", { ...duration, description: "未公开该模型上限；画布防误输入暂限制 30 秒。" }, 5)).toMatchObject({ kind: "unavailable" });
    for (const descriptor of [
      { ...duration, max: undefined }, { ...duration, min: undefined },
      { ...duration, max: Infinity }, { ...duration, step: 0 },
      { ...duration, min: -1 }, { ...duration, options: [{ value: -1, label: "自动" }] },
    ]) expect(videoDurationControl("video-generation", descriptor, 5)).toMatchObject({ kind: "unavailable" });
    for (const value of [undefined, "", null, true, -1, 3, 31, "auto", Number.NaN])
      expect(videoDurationControl("video-generation", duration, value)).toMatchObject({ kind: "range", value: 5, invalidValue: expect.any(String) });
    expect(videoDurationControl("video-generation", { ...duration, control: "select", options: [{ value: 30, label: "30 秒" }] }, 5)).toMatchObject({ kind: "select" });
    expect(videoDurationControl("video-generation", duration, 35)).toMatchObject({ kind: "range", value: 5, invalidValue: "35", min: 4, max: 30 });
  });

  it("keeps the supplier step and only offers reachable endpoints", () => {
    expect(videoDurationControl("video-generation", { ...duration, min: 4, max: 15, step: 2 }, 6)).toMatchObject({ min: 4, max: 14, step: 2 });
    expect(videoDurationControl("video-generation", { ...duration, step: 2 }, 5)).toMatchObject({ kind: "range", value: 4, invalidValue: "5" });
    expect(videoDurationControl("video-generation", { ...duration, valueType: "number", min: 0.5, max: 2, step: 0.5 }, 1.5)).toMatchObject({ min: 0.5, max: 2, step: 0.5 });
  });

  it("does not turn music duration, quantity or text parameters into video sliders", () => {
    expect(videoDurationControl("music-generation", duration, 5)).toBeUndefined();
    expect(videoDurationControl("image-generation", duration, 5)).toBeUndefined();
    expect(videoDurationControl("video-generation", { ...duration, key: "n" }, 5)).toBeUndefined();
    expect(videoDurationControl("video-generation", { ...duration, control: "text" }, 5)).toMatchObject({ kind: "unavailable" });
  });

  it("does not restore an old unverified default after explicitly choosing supplier defaults", () => {
    const model = { parameters: [duration], metadata: { durationRangeUnverified: true, clampNumericParameters: true } };
    expect(normalizedParametersForModel("video-generation", "rest", model, {})).not.toHaveProperty("duration");
    expect(normalizedParametersForModel("video-generation", "rest", model, { duration: 35 })).toMatchObject({ duration: 35 });
  });

  it("retains explicitly configured manual controls without broadening supplier unknown contracts", () => {
    for (const metadata of [{ source: "manual" }, { protocolEvidence: "paid-test" }]) {
      const model = { parameters: [{ ...duration, max: undefined }], metadata };
      const context = videoDurationControlContext(model);
      expect(videoDurationControl("video-generation", model.parameters[0]!, 38, false, false, context)).toBeUndefined();
      expect(normalizedParametersForModel("video-generation", "rest", model, {})).toHaveProperty("duration", 5);
      const marked = { ...model, metadata: { ...metadata, durationRangeUnverified: true } };
      expect(videoDurationControl("video-generation", model.parameters[0]!, 38, true, false, videoDurationControlContext(marked))).toMatchObject({ kind: "unavailable" });
      expect(videoDurationControl("video-generation", duration, 5, false, false, context)).toMatchObject({ kind: "range" });
    }
  });

  it("offers only an exact documented default when the full range remains unknown", () => {
    const descriptor = { ...duration, min: undefined, max: undefined, default: 8 };
    const model = { metadata: { durationRangeUnverified: true, videoParameterConfirmedDefaults: { duration: 8 } } };
    expect(videoDurationControl("video-generation", descriptor, 8, true, false, videoDurationControlContext(model))).toMatchObject({ kind: "unavailable", confirmedDefault: 8 });
    expect(videoDurationControl("video-generation", { ...descriptor, default: 5 }, 5, true, false, videoDurationControlContext(model))).not.toHaveProperty("confirmedDefault");
    expect(videoDurationControl("video-generation", descriptor, 8, true)).not.toHaveProperty("confirmedDefault");
  });
});

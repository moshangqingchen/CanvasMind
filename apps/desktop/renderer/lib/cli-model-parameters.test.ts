import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { resolveModelParameters, validateModelParameters } from "@super-canvas/providers/cli-contracts";
import { parameterDescriptorsFor, parameterDescriptorsForValues, parametersWithDefaults } from "./model-parameters";

const model: ModelDescriptor = { id: "dynamic-video", name: "动态视频", operations: ["video.generate"], parameters: [
  { key: "quality", label: "质量", control: "select", default: "low", options: [{ label: "标准", value: "low" }, { label: "高", value: "high" }] },
  { key: "resolution", label: "分辨率", control: "select", default: "720p", options: [{ label: "720p", value: "720p" }, { label: "1080p", value: "1080p" }] },
  { key: "duration", label: "秒数", control: "number", valueType: "integer", default: 5, min: 1, max: 15, constraints: [{ when: [{ parameter: "resolution", values: ["1080p"] }], max: 8 }] },
  { key: "audio", label: "音频", control: "toggle", default: false, visibleWhen: [{ parameter: "quality", values: ["high"] }] },
] };

describe("CLI dynamic canvas parameters", () => {
  it("has no guessed duration or ratio controls before capabilities arrive", () => {
    expect(parameterDescriptorsFor("video-generation", "cli", null)).toEqual([]);
    expect(parameterDescriptorsFor("image-generation", "cli", { parameters: [] })).toEqual([]);
  });
  it("keeps declared image count choices and scopes controls to the current operation", () => {
    const scoped: ModelDescriptor = { ...model, operations: ["image.generate", "image.edit"], parameters: [
      { key: "n", label: "数量", control: "select", options: [{ label: "1 张", value: 1 }, { label: "2 张", value: 2 }] },
      { key: "strength", label: "参考强度", control: "number", operations: ["image.edit"] },
    ] };
    const pure = parameterDescriptorsForValues("image-generation", "cli", scoped, {}, "image.generate");
    expect(pure.map(parameter => parameter.key)).toEqual(["n"]);
    expect(parameterDescriptorsForValues("image-generation", "cli", scoped, {}, "image.edit").map(parameter => parameter.key)).toEqual(["n", "strength"]);
  });
  it("keeps platform defaults and applies live cross-field limits", () => {
    const descriptors = parameterDescriptorsFor("video-generation", "cli", model);
    expect(parametersWithDefaults(descriptors, {}, true).quality).toBe("low");
    const effective = parameterDescriptorsForValues("video-generation", "cli", model, { resolution: "1080p", quality: "low" });
    expect(effective.find(parameter => parameter.key === "duration")?.max).toBe(8);
    expect(effective.some(parameter => parameter.key === "audio")).toBe(false);
  });
  it("reports old invalid values without rewriting them, and clears them only on explicit model change", () => {
    const saved = { resolution: "1080p", duration: 15, quality: "low", obsolete: true };
    expect(validateModelParameters(model, saved).valid).toBe(false);
    expect(saved.duration).toBe(15);
    const switched = resolveModelParameters(model, saved);
    expect(switched.parameters.duration).toBe(5);
    expect(switched.removedKeys).toContain("obsolete");
    expect(switched.parameters.quality).toBe("low");
  });
});

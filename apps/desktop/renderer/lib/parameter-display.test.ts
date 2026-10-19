import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { nodeParameterSummary, parameterOptionDisplayLabel } from "./parameter-display";

describe("parameter display labels", () => {
  it("uses quality display names without changing protocol values or supplier-specific labels", () => {
    const values = Object.freeze({ size: "4096x4096", quality: "max", n: 2 });
    const model: ModelDescriptor = { id: "image", name: "Image", operations: ["image.generate"], parameters: [
      { key: "quality", label: "质量", control: "select", options: [{ value: "max", label: "max" }] },
    ] };
    expect(nodeParameterSummary("image-generation", model, values)).toBe("4096x4096 · 最高 · 数量 2");
    expect(values.quality).toBe("max");
    expect(parameterOptionDisplayLabel("quality", "high", "精细（供应商质量）")).toBe("精细（供应商质量）");
    expect(parameterOptionDisplayLabel("quality", "max", "最高（max）")).toBe("最高");
    expect(parameterOptionDisplayLabel("quality", "4K", "4K")).toBe("4K");
    expect(parameterOptionDisplayLabel("resolution", "high", "high")).toBe("high");
    expect(parameterOptionDisplayLabel("quality", "new-mode")).toBe("new-mode");
  });

  it("uses option labels for video and leaves unavailable controls out", () => {
    const model: ModelDescriptor = { id: "video", name: "Video", operations: ["video.generate"], parameters: [
      { key: "resolution", label: "分辨率", control: "select", options: [{ value: "high", label: "1080p" }] },
    ] };
    expect(nodeParameterSummary("video-generation", model, { duration: 10, resolution: "high" })).toBe("10s · 1080p");
    expect(nodeParameterSummary("video-generation", { ...model, metadata: { parameterControlsUnavailable: true } }, { resolution: "high" })).toBe("");
  });
});

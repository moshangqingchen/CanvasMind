import { describe, expect, it } from "vitest";
import { aspectRatioFromPrompt, aspectRatioString } from "./aspect-ratio";

describe("automatic image aspect ratios", () => {
  it("prefers an explicit ratio or pixel dimensions in the prompt", () => {
    expect(aspectRatioFromPrompt("做一张 3:4 的竖版海报")).toBe("3:4");
    expect(aspectRatioFromPrompt("输出 1920x1080 横屏画面")).toBe("16:9");
  });

  it("understands clear orientation words", () => {
    expect(aspectRatioFromPrompt("正方形产品图")).toBe("1:1");
    expect(aspectRatioFromPrompt("portrait poster")).toBe("9:16");
    expect(aspectRatioFromPrompt("wide landscape banner")).toBe("16:9");
  });

  it("returns no forced ratio for ambiguous prompts", () => {
    expect(aspectRatioFromPrompt("一只猫在窗边")).toBeUndefined();
    expect(aspectRatioString(4 / 3)).toBe("4:3");
  });
});

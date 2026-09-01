import { describe, expect, it } from "vitest";
import {
  aspectRatioFromPrompt,
  aspectRatioString,
  chentuSizeForResolutionTier,
  gptImage4KSizeForAspectRatio,
} from "./aspect-ratio";

describe("automatic image aspect ratios", () => {
  it("prefers an explicit ratio or pixel dimensions in the prompt", () => {
    expect(aspectRatioFromPrompt("做一张 3:4 的竖版海报")).toBe("3:4");
    expect(aspectRatioFromPrompt("宣传单尺寸比例 1175:1310")).toBe("235:262");
    expect(aspectRatioFromPrompt("输出 1920x1080 横屏画面")).toBe("16:9");
  });

  it("understands clear orientation words", () => {
    expect(aspectRatioFromPrompt("正方形产品图")).toBe("1:1");
    expect(aspectRatioFromPrompt("portrait poster")).toBe("9:16");
    expect(aspectRatioFromPrompt("wide landscape banner")).toBe("16:9");
  });

  it("recognizes A-series paper requests before generic orientation words", () => {
    expect(aspectRatioFromPrompt("做一张 A4 大小的宣传单")).toBe("70:99");
    expect(aspectRatioFromPrompt("A3 横版海报")).toBe("99:70");
  });

  it("returns no forced ratio for ambiguous prompts", () => {
    expect(aspectRatioFromPrompt("一只猫在窗边")).toBeUndefined();
    expect(aspectRatioString(4 / 3)).toBe("4:3");
  });

  it("maps 辰途 K tiers to documented pixel sizes", () => {
    expect(chentuSizeForResolutionTier("1K", "16:9")).toBe("1280x720");
    expect(chentuSizeForResolutionTier("2K", "9:16")).toBe("1152x2048");
    expect(chentuSizeForResolutionTier("4K", "21:28")).toBe("2480x3312");
    expect(chentuSizeForResolutionTier("4K", "1175:1310")).toBe("2720x3040");
    expect(chentuSizeForResolutionTier("4k")).toBe("2880x2880");
  });

  it("keeps a custom prompt ratio when resolving the Cangyuan 4K canvas", () => {
    expect(gptImage4KSizeForAspectRatio("1175:1310")).toBe("2720x3040");
    expect(gptImage4KSizeForAspectRatio("16:9")).toBe("3840x2160");
  });
});

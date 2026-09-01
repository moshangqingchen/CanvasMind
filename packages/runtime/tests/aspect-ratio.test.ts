import { describe, expect, it } from "vitest";
import {
  aspectRatioFromPrompt,
  cyberAfei4KSizeForAspectRatio,
  cyberAfei4KValidSize,
  dimensionsFromPrompt,
  friModelSizeForResolutionTier,
  gptImage4KSizeForAspectRatio,
  mikotoSizeForResolutionTier,
  weAiResolutionTier,
  weAiSizeForResolutionTier,
} from "../src/aspect-ratio.js";

describe("prompt dimensions and Cyber Afei 4K automatic sizing", () => {
  it("reads exact custom paper dimensions from prompts", () => {
    expect(dimensionsFromPrompt("请生成 2100×2970 的 A4 海报")).toBe(
      "2100x2970",
    );
    expect(dimensionsFromPrompt("A3 print at 3508x4961")).toBe("3508x4961");
    expect(dimensionsFromPrompt("invalid 100x2000 ratio")).toBeUndefined();
  });

  it("recognizes A-series orientation before generic orientation words", () => {
    expect(aspectRatioFromPrompt("A4 竖版海报")).toBe("70:99");
    expect(aspectRatioFromPrompt("A3 landscape poster")).toBe("99:70");
  });

  it("recognizes multi-digit custom ratios before falling back to references", () => {
    expect(aspectRatioFromPrompt("按照尺寸比例 1175:1310 输出宣传单")).toBe(
      "235:262",
    );
  });

  it("maps prompt or reference ratios to paid-tested 4K inputs", () => {
    expect(cyberAfei4KSizeForAspectRatio("70:99")).toBe("2416x3424");
    expect(cyberAfei4KSizeForAspectRatio("99:70")).toBe("3424x2416");
    expect(cyberAfei4KSizeForAspectRatio("16:9")).toBe("3840x2160");
    expect(cyberAfei4KSizeForAspectRatio("3:4")).toBe("2160x2880");
  });

  it("keeps We-AI automatic ratios inside the selected resolution tier", () => {
    expect(weAiResolutionTier("4k")).toBe("4K");
    expect(weAiSizeForResolutionTier("4K", "16:9")).toBe("3840x2160");
    expect(weAiSizeForResolutionTier("4K", "2:3")).toBe("2176x3264");
    expect(weAiSizeForResolutionTier("4K", "204:284")).toBe("2448x3376");
    expect(weAiSizeForResolutionTier("4K", "1175:1310")).toBe("2720x3040");
    expect(weAiSizeForResolutionTier("4K")).toBe("2160x2160");
    expect(weAiSizeForResolutionTier("2K", "16:9")).toBe("2048x1152");
    expect(weAiSizeForResolutionTier("1K", "16:9")).toBe("1824x1024");
  });

  it("maps Cangyuan GPT Image 4K automatic ratios to explicit pixels", () => {
    expect(gptImage4KSizeForAspectRatio()).toBe("2160x2160");
    expect(gptImage4KSizeForAspectRatio("16:9")).toBe("3840x2160");
    expect(gptImage4KSizeForAspectRatio("9:16")).toBe("2160x3840");
    expect(gptImage4KSizeForAspectRatio("2:3")).toBe("2176x3264");
    expect(gptImage4KSizeForAspectRatio("1175:1310")).toBe("2720x3040");
  });

  it("keeps custom ratios for every OpenAI-compatible supplier tier", () => {
    expect(friModelSizeForResolutionTier("4K", "1175:1310")).toBe(
      "2720x3040",
    );
    expect(mikotoSizeForResolutionTier("4K", "1175:1310")).toBe(
      "2720x3040",
    );
    expect(cyberAfei4KSizeForAspectRatio("1175:1310")).toBe("2720x3040");
  });

  it("maps FriModel and Mikoto K tiers to their documented pixels", () => {
    expect(friModelSizeForResolutionTier("4K", "16:9")).toBe("3840x2160");
    expect(friModelSizeForResolutionTier("4K", "9:16")).toBe("2160x3840");
    expect(friModelSizeForResolutionTier("4K", "3:2")).toBe("3520x2352");
    expect(mikotoSizeForResolutionTier("4K", "16:9")).toBe("3840x2160");
    expect(mikotoSizeForResolutionTier("4K", "2:3")).toBe("2160x3240");
    expect(mikotoSizeForResolutionTier("4K", "21:9")).toBe("3840x1646");
  });

  it("aligns and bounds custom GPT Image 2 sizes before submission", () => {
    expect(cyberAfei4KValidSize("2160x3240")).toBe("2160x3248");
    expect(cyberAfei4KValidSize("3240x2160")).toBe("3248x2160");
    expect(cyberAfei4KValidSize("3840x1646")).toBe("3840x1648");
    expect(cyberAfei4KValidSize("2100x2970")).toBe("2096x2976");
    expect(cyberAfei4KValidSize("2480x3508")).toBe("2416x3424");
    expect(cyberAfei4KValidSize("3508x4961")).toBe("2416x3424");
    expect(cyberAfei4KValidSize("3840x2715")).toBe("3424x2416");
    expect(cyberAfei4KValidSize("100x2000")).toBeUndefined();
  });
});

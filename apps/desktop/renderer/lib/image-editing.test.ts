import { describe, expect, it } from "vitest";
import { imageModeParameters, preserveImageMaskParameters } from "./image-editing";
import { normalizedParametersForModel, parametersWithDefaults } from "./model-parameters";

describe("image editing configuration", () => {
  it("keeps the mask when a supplier change resets its ordinary parameters", () => {
    expect(preserveImageMaskParameters({ quality: "high" }, { maskAssetId: "mask", maskSourceAssetId: "source", size: "old" }))
      .toEqual({ quality: "high", maskAssetId: "mask", maskSourceAssetId: "source" });
  });
  it("uses PNG for transparency and restores normal without deleting a mask", () => {
    const transparent = imageModeParameters({ output_format: "jpeg", output_compression: 40, maskAssetId: "mask" }, true, "transparent");
    expect(transparent).toEqual({ background: "transparent", output_format: "png", maskAssetId: "mask" });
    expect(imageModeParameters(transparent, true, "normal").background).toBe("opaque");
    expect(imageModeParameters(transparent, false)).toEqual({ output_format: "png", maskAssetId: "mask" });
  });
  it("retains explicit modes and mask references during catalog normalization and execution preparation", () => {
    const current = { background: "transparent", output_format: "jpeg", maskAssetId: "mask", maskSourceAssetId: "source" };
    const expected = { background: "transparent", output_format: "png", maskAssetId: "mask", maskSourceAssetId: "source" };
    expect(parametersWithDefaults([], current)).toEqual(expected);
    expect(normalizedParametersForModel("image-generation", "openai", {
      parameters: [{ key: "quality", label: "质量", control: "select", default: "high" }],
    }, current)).toMatchObject(expected);
    expect(parametersWithDefaults([], { mask: "https://example.invalid/old-mask.png" })).toEqual({ mask: "https://example.invalid/old-mask.png" });
  });
});

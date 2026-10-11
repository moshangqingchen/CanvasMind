import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { applyGenimageImageCapabilities } from "../../../../packages/providers/src/genimage-image-capabilities";
import { NativeImageResolutionFields, genimageSizeForDimensions } from "../components/native-image-resolution-fields";
import { nativeImageResolutionControl } from "./native-image-resolution";
import { normalizedParametersForModel, parameterDescriptorsForValues } from "./model-parameters";

const connection = { provider: "openai", config: { baseUrl: "https://genimage.pro/v1", modelGroup: "default", usage: "canvas" } };
const model = applyGenimageImageCapabilities(connection, { id: "gpt-image-2.5-sunburst", name: "Sunburst", operations: ["image.generate"] });
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

describe("Genimage declared tiers and open size UI", () => {
  it("renders every declared tier and editable saved W/H without fabricated bounds", () => {
    const saved = { size: "2496x3312", quality: "max", n: 1 };
    const descriptors = parameterDescriptorsForValues("image-generation", "openai", model, saved);
    const native = nativeImageResolutionControl(descriptors, model)!;
    expect(native.resolution.options?.map(option => option.value)).toEqual(["auto", "1K", "2K", "4K"]);
    const html = renderToStaticMarkup(React.createElement(NativeImageResolutionFields, { id: "gen", model,
      resolution: native.resolution, parameters: saved, onChange: () => undefined }));
    expect(html).toContain('aria-label="基因形象自定义尺寸参数"');
    expect(html).toContain('value="2496x3312"');
    expect(html).toContain('value="2496"');
    expect(html).toContain('value="3312"');
    expect(html).not.toContain('readOnly=""');
    expect(html).not.toContain('max="3840"');
    expect(html).not.toContain('step="16"');
    expect(normalizedParametersForModel("image-generation", "openai", model, saved)).toMatchObject(saved);
    expect(saved).toEqual({ size: "2496x3312", quality: "max", n: 1 });
  });

  it("preserves unusual positive integer dimensions exactly instead of rounding to 16 or capping the edge", () => {
    expect(genimageSizeForDimensions("4097", "2049")).toBe("4097x2049");
    for (const [width, height] of [["", "3312"], ["2496", ""], ["0", "1"], ["-1", "2"], ["1.5", "2"]])
      expect(genimageSizeForDimensions(width!, height!)).toBeUndefined();
  });

  it.each(["aspect_ratio", "aspectRatio", "ratio"])("displays saved %s beside the W/H mapping and keeps it on normalization", key => {
    const saved = { size: "4K", quality: "max", [key]: "16:9" };
    const descriptors = parameterDescriptorsForValues("image-generation", "openai", model, saved);
    const native = nativeImageResolutionControl(descriptors, model)!;
    const html = renderToStaticMarkup(React.createElement(NativeImageResolutionFields, { id: "gen", model,
      resolution: native.resolution, ratio: native.ratio, parameters: saved, hasExactSizeControl: true, onChange: () => undefined }));
    expect(html).toContain('aria-label="基因形象画面比例偏好"');
    expect(html).toContain('value="16:9"');
    expect(html).toContain("请输入对应 W/H");
    expect(html).toContain('aria-label="图片宽度"');
    expect(html).toContain('aria-label="图片高度"');
    expect(normalizedParametersForModel("image-generation", "openai", model, saved)).toMatchObject({ ...saved, aspect_ratio: "16:9" });
    expect(saved).toEqual({ size: "4K", quality: "max", [key]: "16:9" });
  });

  it("keeps other suppliers' native W/H read-only and their saved values unchanged", () => {
    const other = { ...model, id: "gpt-image-2-2K/4K", metadata: { imageNativeParameterContract: true } };
    const html = renderToStaticMarkup(React.createElement(NativeImageResolutionFields, { id: "other", model: other,
      resolution: model.parameters!.find(p => p.key === "size")!, parameters: { size: "4K" }, onChange: () => undefined }));
    expect(html).not.toContain("基因形象自定义尺寸参数");
    expect(html).toContain('readOnly=""');
  });
});

import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "./contracts.js";
import { evaluateImageParameters, imageParameterControls } from "./image-parameter-contract.js";
import { applyUserImageSizePresets } from "./image-size-presets.js";

const model: ModelDescriptor = applyUserImageSizePresets({
  id: "gpt-image-2.5", name: "Offline image contract", operations: ["image.generate", "image.edit"],
  parameters: [
    { key: "size", label: "尺寸", control: "dimensions", default: "auto", allowCustomValue: true },
    { key: "quality", label: "质量", control: "select", default: "max", options: [{ value: "max", label: "最高（max）" }] },
  ],
});

describe("image parameter evaluation across controls, request and pricing", () => {
  it("preserves explicit pixels, invalid saved quality and opaque adapter fields without injecting defaults", () => {
    const source = structuredClone(model);
    const parameters = Object.freeze({ size: "2051x2049", quality: "old-value", size_tier: "4K", vendor_extension: "keep" });
    const result = evaluateImageParameters(model, parameters);
    expect(result.requestParameters).toEqual(parameters);
    expect(result.pricingParameters).toMatchObject(parameters);
    expect(model).toEqual(source);
    expect(evaluateImageParameters(model, {}).requestParameters).toEqual({});
  });

  it("uses one exact preset for automatic request dimensions and the quoted tier", () => {
    const parameters = Object.freeze({ size: "auto", size_tier: "4K", aspect_ratio: "16:9", quality: "max" });
    const result = evaluateImageParameters(model, parameters);
    expect(result.requestParameters).toEqual({ ...parameters, size: "3840x2160" });
    expect(result.pricingParameters).toMatchObject({ size: "3840x2160", resolution: "4K", quality: "max" });
    expect(result.requestParameters).not.toHaveProperty("resolution");
    expect(parameters.size).toBe("auto");
    expect(evaluateImageParameters(model, result.requestParameters).requestParameters).toEqual(result.requestParameters);
  });

  it("quotes labelled pixels from this model and never infers a tier from arbitrary pixel counts", () => {
    expect(evaluateImageParameters(model, { size: "3840x2160" }).resolutionTier).toBe("4K");
    expect(evaluateImageParameters(model, { size: "3999x2222" }).resolutionTier).toBeUndefined();
    const other = { ...model, parameters: [{ key: "size", label: "尺寸", control: "select" as const,
      options: [{ value: "3840x2160", label: "供应商自定义尺寸" }] }] };
    expect(evaluateImageParameters(other, { size: "3840x2160" }).resolutionTier).toBeUndefined();
  });

  it("retains explicit W/H and uses an inferred ratio only for automatic dimensions", () => {
    const explicit = { width: 2051, height: 2049, size: "auto", size_tier: "4K" };
    expect(evaluateImageParameters(model, explicit, { inferredRatio: "16:9" }).requestParameters).toEqual(explicit);
    expect(evaluateImageParameters(model, { size: "auto", size_tier: "4K" }, { inferredRatio: "9:16" })
      .requestParameters.size).toBe("2160x3840");
  });

  it.each(["size_tier", "image_size"])("uses this contract's default %s for pricing without sending an extra default", key => {
    const native: ModelDescriptor = { id: "native-image", name: "Native image", operations: ["image.generate"],
      parameters: [{ key, label: "档位", control: "select", default: "4K", options: ["auto", "2K", "4K"].map(value => ({ value, label: value })) }] };
    const result = evaluateImageParameters(native, {});
    expect(result.pricingParameters.resolution).toBe("4K");
    expect(result.requestParameters).toEqual({});
    expect(evaluateImageParameters(native, { [key]: "2K" }).pricingParameters.resolution).toBe("2K");
    expect(evaluateImageParameters(native, { [key]: "auto" }).pricingParameters.resolution).toBe("auto");
    for (const value of ["custom-tier", "2k"]) {
      const explicit = { [key]: value };
      expect(evaluateImageParameters(native, explicit).pricingParameters.resolution).toBe(value);
      expect(evaluateImageParameters(native, explicit).requestParameters).toEqual(explicit);
    }
  });

  it("keeps operation-specific and conditional controls while retaining incompatible saved choices", () => {
    const conditional: ModelDescriptor = { ...model, parameters: [
      { key: "mode", label: "模式", control: "select", default: "ordinary", options: ["ordinary", "fixed"].map(value => ({ value, label: value })) },
      { key: "quality", label: "质量", control: "select", default: "max", options: ["high", "max"].map(value => ({ value, label: value })),
        constraints: [{ when: [{ parameter: "mode", values: ["fixed"] }], options: [{ value: "high", label: "高" }] }] },
      { key: "strength", label: "强度", control: "number", operations: ["image.edit"] },
    ] };
    const values = Object.freeze({ mode: "fixed", quality: "max", strength: 0.7 });
    const result = evaluateImageParameters(conditional, values, { operation: "image.generate" });
    expect(result.controls.map(field => field.key)).toEqual(["mode", "quality"]);
    expect(result.controls[1]).toMatchObject({ default: "high", options: [{ value: "high", label: "高" }] });
    expect(result.requestParameters).toEqual(values);
    expect(imageParameterControls(conditional, values, "image.edit").map(field => field.key)).toContain("strength");
  });
});

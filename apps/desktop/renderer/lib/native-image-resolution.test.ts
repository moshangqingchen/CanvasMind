import { describe, expect, it } from "vitest";
import type { ModelDescriptor, ModelParameterDescriptor } from "@super-canvas/providers";
import { declaredImageOutputDimensions, imageResolutionOptionLabel, isImageRatioParameter, nativeImageResolutionControl, nativeImageRatioOptionLabel } from "./native-image-resolution";

const ratio: ModelParameterDescriptor = { key: "aspect_ratio", label: "画面比例", control: "select", options: [{ label: "1:1", value: "1:1" }] };
const resolution: ModelParameterDescriptor = { key: "resolution", label: "输出分辨率", control: "select", options: ["1080p", "2K"].map(value => ({ label: value, value })) };

describe("native image resolution presentation", () => {
  it("retains native tiers and aliases without granting extra image controls", () => {
    const control = nativeImageResolutionControl([ratio, resolution]);
    expect(control).toEqual({ resolution, ratio });
    expect(control?.resolution.options?.map(imageResolutionOptionLabel)).toEqual(["标准", "2K"]);
    expect(control?.resolution.options?.map(option => option.value)).toEqual(["1080p", "2K"]);
    for (const key of ["image_size", "size", "tier", "quality"])
      expect(nativeImageResolutionControl([{ ...resolution, key }])?.resolution.key).toBe(key);
    expect(nativeImageResolutionControl([{ ...resolution, key: "vendor_size" }], { metadata: { imageNativeResolutionParameter: "vendor_size" } })?.resolution.key)
      .toBe("vendor_size");
  });

  it("leaves exact dimensions and actual quality enums with their own controls", () => {
    expect(nativeImageResolutionControl([{ ...resolution, key: "size", options: [{ label: "1K", value: "1024x1024" }] }])).toBeUndefined();
    expect(nativeImageResolutionControl([{ ...resolution, key: "quality", options: [{ label: "最高", value: "max" }] }])).toBeUndefined();
    expect(nativeImageResolutionControl([{ ...resolution, key: "size", control: "dimensions" }])).toBeUndefined();
  });
  it("uses declared legacy tier labels while preserving quality and size wire values", () => {
    const legacy = { ...resolution, key: "quality", label: "分辨率", options: [
      { label: "1K", value: "low" }, { label: "2K", value: "medium" }, { label: "4K", value: "high" },
    ] };
    const sizeRatio = { ...ratio, key: "size", options: [{ label: "自动", value: "auto" }, { label: "方图", value: "1:1" }] };
    const control = nativeImageResolutionControl([sizeRatio, legacy]);
    expect(control).toEqual({ resolution: legacy, ratio: sizeRatio });
    expect(control?.resolution.options?.map(imageResolutionOptionLabel)).toEqual(["1K", "2K", "4K"]);
    expect(control?.resolution.options?.map(option => option.value)).toEqual(["low", "medium", "high"]);
    expect(isImageRatioParameter({ ...sizeRatio, options: [{ label: "错误比例", value: "0:1" }] })).toBe(false);
  });

  it("shows only declared pixels for the exact enum and ratio combination", () => {
    const model: ModelDescriptor = { id: "image", name: "Image", operations: ["image.generate"], metadata: {
      imageOutputDimensions: [{ resolution: "1080p", aspectRatio: "1:1", width: 1080, height: 1080 }],
    } };
    expect(declaredImageOutputDimensions(model, "1080p", "1:1")).toEqual({ width: 1080, height: 1080 });
    expect(declaredImageOutputDimensions(model, "1080p", "16:9")).toBeUndefined();
    expect(declaredImageOutputDimensions(model, "2K", "1:1")).toBeUndefined();
    expect(declaredImageOutputDimensions({ ...model, metadata: {} }, "1080p", "1:1")).toBeUndefined();
    for (const width of [0, -1, 1.5, "1080"])
      expect(declaredImageOutputDimensions({ ...model, metadata: { imageOutputDimensions: [{ resolution: "1080p", aspectRatio: "1:1", width, height: 1080 }] } }, "1080p", "1:1")).toBeUndefined();
    expect(declaredImageOutputDimensions({ ...model, metadata: { imageOutputDimensions: [
      { resolution: "1080p", aspectRatio: "1:1", width: 1080, height: 1080 },
      { resolution: "1080p", aspectRatio: "1:1", width: 1024, height: 1024 },
    ] } }, "1080p", "1:1")).toBeUndefined();
  });

  it("updates compound ratio labels with declared pixels for the selected tier only", () => {
    const model: ModelDescriptor = { id: "image", name: "Image", operations: ["image.generate"], metadata: {
      imageOutputDimensions: [
        { resolution: "1080p", aspectRatio: "1:1", width: 1080, height: 1080 },
        { resolution: "2K", aspectRatio: "1:1", width: 1440, height: 1440 },
      ],
    } };
    const option = { label: "1:1", value: "1:1" };
    expect(nativeImageRatioOptionLabel(model, resolution, "1080p", option)).toBe("标准 · 1:1 · 1080 × 1080");
    expect(nativeImageRatioOptionLabel(model, resolution, "2K", option)).toBe("2K · 1:1 · 1440 × 1440");
    expect(nativeImageRatioOptionLabel(model, resolution, "4K", option)).toBe("4K · 1:1");
    expect(nativeImageRatioOptionLabel(undefined, resolution, "2K", { label: "自动（跟随参考图）", value: "auto" }))
      .toBe("2K · 自动（跟随参考图）");
    const legacy = { ...resolution, options: [{ value: "medium", label: "2K" }] };
    expect(nativeImageRatioOptionLabel(model, legacy, "medium", option)).toBe("2K · 1:1");
  });
});

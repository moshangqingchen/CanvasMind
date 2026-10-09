import { describe, expect, it } from "vitest";
import type { ModelParameterDescriptor } from "@super-canvas/providers";
import {
  activeResolutionTierForValue,
  imageDimensionsPresentation,
  resolutionOptionsForTier,
  resolutionTierForValue,
  resolutionTierShortcuts,
  savedSelectValueMissingFromDescriptor,
  setParameterValueWithSizeExclusivity,
  shouldUseUnifiedResolutionControl,
  sizeOnTierChange,
} from "../components/node-parameter-fields";

const dimensionsDescriptor: ModelParameterDescriptor = {
  key: "size",
  label: "输出分辨率",
  control: "dimensions",
  options: [
    { label: "自动（提示词优先，其次参考图）", value: "auto" },
    { label: "1K 方图 · 1024 × 1024", value: "1024x1024" },
    {
      label: "常用横图 · 1536 × 1024（非 1K 档）",
      value: "1536x1024",
    },
    { label: "2K 方图 · 2048 × 2048", value: "2048x2048" },
    { label: "2K 横图 16:9 · 2048 × 1152", value: "2048x1152" },
    { label: "4K 横图 16:9 · 3840 × 2160", value: "3840x2160" },
    { label: "4K 竖图 9:16 · 2160 × 3840", value: "2160x3840" },
  ],
};

describe("resolution tier shortcuts", () => {
  it("presents exact select/text sizes in the shared layout without inventing options or bounds", () => {
    for (const control of ["select", "text"] as const) {
      const descriptor = { ...dimensionsDescriptor, control };
      const presentation = imageDimensionsPresentation(descriptor);
      expect(presentation).toEqual({ ...descriptor, control: "dimensions", label: "分辨率" });
      expect(presentation.options).toBe(descriptor.options);
    }
    const tier = { ...dimensionsDescriptor, control: "select" as const, options: [{ label: "4K", value: "4K" }] };
    expect(imageDimensionsPresentation(tier)).toBe(tier);
  });
  it("builds 1K, 2K, and 4K shortcuts only from explicit tier options", () => {
    expect(resolutionTierShortcuts(dimensionsDescriptor)).toEqual([
      {
        label: "1K",
        value: "1024x1024",
        values: ["1024x1024"],
      },
      {
        label: "2K",
        value: "2048x2048",
        values: ["2048x2048", "2048x1152"],
      },
      {
        label: "4K",
        value: "3840x2160",
        values: ["3840x2160", "2160x3840"],
      },
    ]);
  });

  it("shows only the supported tiers when 4K is absent", () => {
    expect(
      resolutionTierShortcuts({
        ...dimensionsDescriptor,
        options: dimensionsDescriptor.options?.filter(
          (option) => !option.label.startsWith("4K"),
        ),
      }).map(s => s.label),
    ).toEqual(["1K", "2K"]);
  });

  it("preserves the selected ratio when switching tiers, including automatic", () => {
    expect(sizeOnTierChange(dimensionsDescriptor, "2048x1152", "4K")).toBe("3840x2160");
    expect(sizeOnTierChange(dimensionsDescriptor, "3840x2160", "2K")).toBe("2048x1152");
    expect(sizeOnTierChange(dimensionsDescriptor, "auto", "2K")).toBe("auto");
  });

  it("derives the active tier from the current exact descriptor size", () => {
    const shortcuts = resolutionTierShortcuts(dimensionsDescriptor);
    expect(resolutionTierForValue(shortcuts, "2048x1152")).toBe("2K");
    expect(resolutionTierForValue(shortcuts, "2160x3840")).toBe("4K");
    expect(resolutionTierForValue(shortcuts, "1536x1024")).toBeUndefined();
    expect(resolutionTierForValue(shortcuts, "auto")).toBeUndefined();
  });

  it("keeps a selected tier active while its ratio is automatic", () => {
    const shortcuts = resolutionTierShortcuts(dimensionsDescriptor);
    expect(activeResolutionTierForValue(shortcuts, "auto", "4K")).toBe("4K");
    expect(activeResolutionTierForValue(shortcuts, "auto", "2k")).toBe("2K");
    expect(activeResolutionTierForValue(shortcuts, "auto", undefined)).toBeUndefined();
    expect(activeResolutionTierForValue(shortcuts, "2160x3840", "2K")).toBe(
      "4K",
    );
  });

  it("shows only the proportions belonging to the selected resolution tier", () => {
    expect(
      resolutionOptionsForTier(dimensionsDescriptor, "4K").map(
        (option) => option.value,
      ),
    ).toEqual(["auto", "3840x2160", "2160x3840"]);
    expect(
      resolutionOptionsForTier(dimensionsDescriptor, "2K").map(
        (option) => option.value,
      ),
    ).toEqual(["auto", "2048x2048", "2048x1152"]);
    expect(resolutionOptionsForTier(dimensionsDescriptor, undefined)).toEqual(
      dimensionsDescriptor.options,
    );
  });

  it("uses one unified ratio control after an exact or automatic size exists", () => {
    const descriptors: ModelParameterDescriptor[] = [
      {
        key: "aspect_ratio",
        label: "画面比例",
        control: "select",
        options: [{ label: "竖向 2:3", value: "2:3" }],
      },
      dimensionsDescriptor,
    ];

    expect(
      shouldUseUnifiedResolutionControl(descriptors, {
        size: "2176x3264",
        aspect_ratio: "2:3",
      }),
    ).toBe(true);
    expect(
      shouldUseUnifiedResolutionControl(descriptors, { size: "auto" }),
    ).toBe(true);
    expect(
      shouldUseUnifiedResolutionControl(descriptors, { aspect_ratio: "2:3" }),
    ).toBe(false);
    for (const key of ["aspectRatio", "ratio"]) {
      expect(shouldUseUnifiedResolutionControl([{ ...descriptors[0]!, key }, dimensionsDescriptor], { [key]: "2:3" })).toBe(false);
    }
  });
});

describe("size and aspect-ratio exclusivity", () => {
  const context = {
    hasSizeControl: true,
    hasAspectRatioControl: true,
    defaultAspectRatio: "auto",
  } as const;

  it.each([
    ["text", "1024x1024"],
    ["select", "1536x1024"],
    ["dimensions", "2160x3840"],
  ])("clears aspect_ratio when a %s size control is filled", (_, size) => {
    expect(
      setParameterValueWithSizeExclusivity(
        { aspect_ratio: "16:9", quality: "high" },
        "size",
        size,
        context,
      ),
    ).toEqual({ size, quality: "high" });
  });

  it("restores the descriptor's default ratio when size is cleared", () => {
    expect(
      setParameterValueWithSizeExclusivity(
        { size: "1024x1024", quality: "high" },
        "size",
        undefined,
        { ...context, defaultAspectRatio: "4:3" },
      ),
    ).toEqual({ aspect_ratio: "4:3", quality: "high" });
  });

  it("clears size when an aspect ratio is selected", () => {
    expect(
      setParameterValueWithSizeExclusivity(
        { size: "1024x1024", quality: "high" },
        "aspect_ratio",
        "9:16",
        context,
      ),
    ).toEqual({ aspect_ratio: "9:16", quality: "high" });
  });

  it("clears the saved resolution tier when exact sizing is abandoned", () => {
    expect(
      setParameterValueWithSizeExclusivity(
        { size: "auto", size_tier: "4K", quality: "high" },
        "aspect_ratio",
        "9:16",
        context,
      ),
    ).toEqual({ aspect_ratio: "9:16", quality: "high" });
  });
  it.each(["ratio", "aspectRatio"])("keeps native %s aliases exclusive with exact dimensions", aspectRatioKey => {
    const aliased = { ...context, aspectRatioKey };
    expect(setParameterValueWithSizeExclusivity({ [aspectRatioKey]: "1:1" }, "size", "1024x1024", aliased))
      .toEqual({ size: "1024x1024" });
    expect(setParameterValueWithSizeExclusivity({ size: "1024x1024", size_tier: "1K" }, aspectRatioKey, "9:16", aliased))
      .toEqual({ [aspectRatioKey]: "9:16" });
    expect(setParameterValueWithSizeExclusivity({ size: "1024x1024" }, "size", undefined, aliased))
      .toEqual({ [aspectRatioKey]: "auto" });
  });
  it("does not delete a supplier's ratio-valued size field", () => {
    const ratioOnly = { hasSizeControl: false, hasAspectRatioControl: true, aspectRatioKey: "size", defaultAspectRatio: "auto" };
    expect(setParameterValueWithSizeExclusivity({ size: "1:1" }, "size", "9:16", ratioOnly)).toEqual({ size: "9:16" });
  });
});

describe("saved select values", () => {
  const descriptor: ModelParameterDescriptor = {
    key: "duration",
    label: "时长（秒）",
    control: "select",
    options: [
      { label: "5", value: 5 },
      { label: "10", value: 10 },
    ],
  };

  it("keeps a persisted value visible when a refreshed catalog omits it", () => {
    expect(savedSelectValueMissingFromDescriptor(descriptor, 15)).toBe(true);
    expect(savedSelectValueMissingFromDescriptor(descriptor, 10)).toBe(false);
    expect(savedSelectValueMissingFromDescriptor(descriptor, "")).toBe(false);
  });
});

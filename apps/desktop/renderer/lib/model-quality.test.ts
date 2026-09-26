import { describe, expect, it } from "vitest";
import type { ModelParameterDescriptor } from "@super-canvas/providers";
import { withHighestQualityDefault } from "./model-quality";
import {
  parameterDescriptorsFor,
  parametersWithDefaults,
} from "./model-parameters";

const quality = (
  values: string[],
  defaultValue = "medium",
): ModelParameterDescriptor => ({
  key: "quality",
  label: "质量",
  control: "select",
  default: defaultValue,
  options: values.map((value) => ({ value, label: value })),
});

describe("highest supported quality defaults", () => {
  it.each([
    [["max", "low", "high", "auto", "xhigh"], "max"],
    [["high", "auto", "medium", "low"], "high"],
    [["high", "xhigh", "auto"], "xhigh"],
    [["low"], "low"],
    [["standard"], "standard"],
    [["auto"], "auto"],
    [["4k", "1k", "2k"], "4k"],
    [["自动", "高", "最高", "中"], "最高"],
  ])("selects the highest available tier from %j", (values, expected) => {
    const descriptor = quality(values as string[]);
    expect(withHighestQualityDefault(descriptor).default).toBe(expected);
    expect(parametersWithDefaults([descriptor])).toEqual({ quality: expected });
  });

  it("keeps explicit lower/auto selections and repairs an unavailable selection", () => {
    const descriptor = quality(["auto", "low", "high", "max"]);
    expect(parametersWithDefaults([descriptor], { quality: "low" })).toEqual({
      quality: "low",
    });
    expect(parametersWithDefaults([descriptor], { quality: "auto" })).toEqual({
      quality: "auto",
    });
    expect(parametersWithDefaults([descriptor], { quality: "xhigh" })).toEqual({
      quality: "max",
    });
  });

  it("uses the same default in the displayed descriptor and submitted parameters", () => {
    const descriptors = parameterDescriptorsFor("image-generation", "rest", {
      parameters: [quality(["auto", "medium", "high", "max"])],
    });
    expect(descriptors[0]?.default).toBe("max");
    expect(parametersWithDefaults(descriptors).quality).toBe("max");
  });

  it("does not change non-quality fields or guess the order of custom tiers", () => {
    const ratio = { ...quality(["low", "high"]), key: "mode" };
    expect(withHighestQualityDefault(ratio)).toBe(ratio);
    const custom = quality(["economy-v2", "studio-v2"], "studio-v2");
    expect(withHighestQualityDefault(custom)).toBe(custom);
  });

  it("removes the obsolete default label without mutating the catalog", () => {
    const descriptor = quality(["medium", "max"]);
    descriptor.options![0]!.label = "中（默认）";
    const result = withHighestQualityDefault(descriptor);
    expect(result.options?.[0]?.label).toBe("中");
    expect(descriptor.options?.[0]?.label).toBe("中（默认）");
    expect(withHighestQualityDefault(result)).toBe(result);
  });
});

import { describe, expect, it } from "vitest";
import { imageSizeForTier, parseTk1688Marketplace, type ModelDescriptor } from "@super-canvas/providers";
import { parametersWithDefaults } from "./model-parameters";
import { tk1688ParametersForResolutionChange, tk1688ResolutionControl } from "./tk1688-resolution-control";

function modelFor(description: string): ModelDescriptor {
  return parseTk1688Marketplace({ success: true, data: { total: 1, items: [{
    base_model: "gpt-image-2.5-sunburst", alias: "gpt-image-2.5-sunburst@s1c23",
    status: "active", charge_type: "per_request", description,
  }] } }).models[1]!;
}

function controlFor(model: ModelDescriptor, parameters: Record<string, unknown> = {}) {
  return tk1688ResolutionControl(model, model.parameters ?? [], parameters)!;
}

describe("Tk1688 shared resolution presentation", () => {
  it("adapts only image models from the exact Tk1688 catalog", () => {
    const model = modelFor("支持1K/2K");
    expect(tk1688ResolutionControl({ ...model, metadata: {} }, model.parameters!, {})).toBeUndefined();
    expect(tk1688ResolutionControl({ ...model, operations: [] }, model.parameters!, {})).toBeUndefined();
    expect(tk1688ResolutionControl(model, [], {})).toBeUndefined();
  });

  it("uses current declared tiers and keeps physical dimensions read-only", () => {
    const model = modelFor("支持1K/2K");
    const before = JSON.stringify(model.parameters);
    const control = controlFor(model, { resolution: "2K", aspect_ratio: "3:2" });
    expect(control).toMatchObject({ readOnlyDimensions: true, savedTier: "2K",
      value: imageSizeForTier("2K", "3:2"), descriptor: { key: "size", control: "dimensions", label: "分辨率" } });
    expect(control.supportedTiers).toEqual(["1K", "2K"]);
    expect(control.descriptor.options?.some(option => option.label.includes("4K"))).toBe(false);
    const values = control.descriptor.options!.map(option => option.value);
    expect(new Set(values).size).toBe(values.length);
    expect(control.automaticOptions.map(option => option.value)).toEqual([
      "auto", "1024x1024", "1536x1024", "1024x1536",
    ]);
    expect(control.automaticOptions.some(option => /[124]K/u.test(option.label))).toBe(false);
    expect(JSON.stringify(model.parameters)).toBe(before);
  });

  it("does not expose a tier omitted from current metadata", () => {
    const model = modelFor("支持1K/2K");
    const control = controlFor({ ...model, metadata: { ...model.metadata, tk1688SupportedResolutions: ["1K"] } });
    expect(control.supportedTiers).toEqual(["1K"]);
    expect(control.descriptor.options?.some(option => option.label.includes("2K"))).toBe(false);
  });

  it("shows official default proportions without inventing named tiers", () => {
    const control = controlFor(modelFor("稳定生图渠道"), { resolution: "auto", aspect_ratio: "3:2" });
    expect(control.savedTier).toBeUndefined();
    expect(control.value).toBe("1536x1024");
    expect(control.descriptor.options?.map(option => option.value)).toEqual([
      "auto", "1024x1024", "1536x1024", "1024x1536",
    ]);
    expect(control.descriptor.options?.some(option => /[124]K/u.test(option.label))).toBe(false);
    expect(tk1688ParametersForResolutionChange(control, { quality: "high" }, "1024x1536", null))
      .toEqual({ quality: "high", resolution: "auto", aspect_ratio: "2:3" });
  });

  it("retains default-ratio presets alongside higher supported tiers", () => {
    const control = controlFor(modelFor("支持2K/4K"));
    expect(control.descriptor.options?.some(option => option.value === "1536x1024" && !option.label.includes("1K"))).toBe(true);
    expect(tk1688ParametersForResolutionChange(control, {}, "1536x1024", null))
      .toEqual({ resolution: "auto", aspect_ratio: "3:2" });
  });

  it("keeps a named resolution while the proportion stays automatic", () => {
    const control = controlFor(modelFor("支持1K/2K"));
    const changed = tk1688ParametersForResolutionChange(control, { quality: "high", size: "auto", size_tier: "4K" }, "auto", "2K");
    expect(changed).toEqual({ quality: "high", resolution: "2K", aspect_ratio: "auto" });
    expect(controlFor(modelFor("支持1K/2K"), changed)).toMatchObject({ value: "auto", savedTier: "2K" });
    expect(tk1688ParametersForResolutionChange(control, changed, "auto"))
      .toEqual({ quality: "high", resolution: "2K", aspect_ratio: "auto" });
    expect(tk1688ParametersForResolutionChange(control, changed, "auto", null))
      .toEqual({ quality: "high", resolution: "auto", aspect_ratio: "auto" });
  });

  it("maps precise presets to resolution and proportion without persisting virtual size", () => {
    const model = modelFor("支持1K/2K");
    const control = controlFor(model);
    const changed = tk1688ParametersForResolutionChange(control, { quality: "medium", response_format: "b64_json" },
      imageSizeForTier("2K", "3:2"), "2K");
    expect(changed).toEqual({ quality: "medium", response_format: "b64_json", resolution: "2K", aspect_ratio: "3:2" });
    const restored = parametersWithDefaults(model.parameters!, changed);
    expect(restored).toMatchObject(changed);
    expect(controlFor(model, restored)).toMatchObject({ value: imageSizeForTier("2K", "3:2"), savedTier: "2K" });
  });

  it("distinguishes identical 1K and default pixels by the selected real resolution", () => {
    const control = controlFor(modelFor("支持1K/2K"));
    expect(tk1688ParametersForResolutionChange(control, {}, "1536x1024", "1K"))
      .toEqual({ resolution: "1K", aspect_ratio: "3:2" });
    expect(tk1688ParametersForResolutionChange(control, {}, "1536x1024", null))
      .toEqual({ resolution: "auto", aspect_ratio: "3:2" });
    expect(controlFor(modelFor("支持1K/2K"), { resolution: "auto", aspect_ratio: "3:2" }).savedTier).toBeUndefined();
  });

  it("rejects unsupported tiers and arbitrary pixels without modifying real parameters", () => {
    const control = controlFor(modelFor("支持1K/2K"));
    const current = { resolution: "2K", aspect_ratio: "3:2", quality: "high" };
    expect(tk1688ParametersForResolutionChange(control, current, "auto", "4K")).toEqual(current);
    expect(tk1688ParametersForResolutionChange(control, current, "1600x1200", "2K")).toEqual(current);
    expect(tk1688ParametersForResolutionChange(control, current, "1024x1024", "2K")).toEqual(current);
  });

  it("keeps fixed merchant pixels locked and preserves independent controls", () => {
    const model = modelFor("Adobe支持原生4K(3840*2160)，不支持N。");
    const control = controlFor(model);
    expect(control).toMatchObject({ value: "3840x2160", fixedSize: "3840x2160", savedTier: "4K",
      readOnlyDimensions: true, automaticResolution: false, automaticRatio: false });
    expect(control.descriptor.options).toEqual([{ label: "4K · 固定 · 3840 × 2160", value: "3840x2160" }]);
    expect(tk1688ParametersForResolutionChange(control, { quality: "high", response_format: "url", resolution: "1K", size_tier: "1K", aspect_ratio: "1:1" }, "auto", null))
      .toEqual({ size: "3840x2160", quality: "high", response_format: "url" });
    expect(model.parameters?.some(parameter => parameter.key === "n")).toBe(false);
  });
});

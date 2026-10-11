import { describe, expect, it } from "vitest";
import { normalizeTk1688CnyModel, parseTk1688Marketplace, type ModelDescriptor } from "@super-canvas/providers";
import { normalizedParametersForModel } from "./model-parameters";
import { tk1688ParametersForResolutionChange, tk1688ResolutionControl } from "./tk1688-resolution-control";

function modelFor(description: string): ModelDescriptor {
  return parseTk1688Marketplace({ success: true, data: { total: 1, items: [{
    base_model: "gpt-image-2.5-sunburst", alias: "gpt-image-2.5-sunburst@s1c23",
    status: "active", charge_type: "per_request", description,
  }] } }).models[1]!;
}

describe("Tk1688 source based resolution presentation", () => {
  it("adapts only fixed pixels from an exact image merchant", () => {
    const model = modelFor("Adobe支持原生4K(3840*2160)，不支持N。");
    expect(tk1688ResolutionControl({ ...model, metadata: {} }, model.parameters!)).toBeUndefined();
    expect(tk1688ResolutionControl({ ...model, operations: [] }, model.parameters!)).toBeUndefined();
    expect(tk1688ResolutionControl(model, [])).toBeUndefined();
  });

  it.each(["支持1K/2K", "支持2K/4K", "稳定生图渠道"])("keeps %s as independent tiers and open W/H instead of guessed pixels", description => {
    const model = modelFor(description);
    const before = structuredClone(model);
    const saved = { resolution: description.includes("4K") ? "4K" : "2K", aspect_ratio: "5:4", size: "1001x801", quality: "high" };
    expect(tk1688ResolutionControl(model, model.parameters!)).toBeUndefined();
    const size = model.parameters!.find(parameter => parameter.key === "size")!;
    expect(size.control).toBe("dimensions");
    expect([size.min, size.max, size.step]).toEqual([undefined, undefined, undefined]);
    expect(size.options?.map(option => option.value)).toEqual(["auto", "1024x1024", "1536x1024", "1024x1536"]);
    expect(size.options?.some(option => /[124]K/u.test(option.label))).toBe(false);
    expect(model.parameters!.find(parameter => parameter.key === "aspect_ratio")?.allowCustomValue).toBe(true);
    expect(normalizedParametersForModel("image-generation", "openai", model, saved)).toMatchObject(saved);
    expect(model).toEqual(before);
  });

  it("repairs saved generic size metadata without changing SKU, tariff, current user size or other parameters", () => {
    const model = modelFor("支持1K/2K/4K");
    const saved = { resolution: "4K", aspect_ratio: "5:4", size: "5000x4000", quality: "high" };
    const legacy = { ...model, parameters: model.parameters!.map(parameter => parameter.key === "size" ? {
      ...parameter, min: 256, max: 3840, step: 16, options: [{ value: "1360x768", label: "1K · 16:9" }],
    } : parameter), metadata: { ...model.metadata, imageOutputDimensions: [{ resolution: "4K", width: 3840, height: 3072 }], imageSizeStep: 16, imageSizeMax: 3840 } };
    const repaired = normalizeTk1688CnyModel(legacy);
    expect(repaired.id).toBe(model.id);
    expect(repaired.pricing).toEqual(model.pricing);
    expect(repaired.parameters!.find(parameter => parameter.key === "quality")).toEqual(model.parameters!.find(parameter => parameter.key === "quality"));
    expect(repaired.metadata?.imageOutputDimensions).toBeUndefined();
    expect(repaired.metadata?.imageSizeMax).toBeUndefined();
    expect(repaired.parameters!.find(parameter => parameter.key === "size")?.max).toBeUndefined();
    expect(normalizedParametersForModel("image-generation", "openai", repaired, saved)).toMatchObject(saved);
    expect(normalizeTk1688CnyModel(repaired)).toEqual(repaired);
  });
  it("shows saved tier and ratio aliases without replacing them with injected automatic defaults", () => {
    const model = modelFor("支持1K/2K/4K");
    const saved = { size_tier: "4K", aspectRatio: "5:4", size: "5000x4000", quality: "high" };
    expect(normalizedParametersForModel("image-generation", "openai", model, saved)).toMatchObject({ ...saved, resolution: "4K", aspect_ratio: "5:4" });
  });

  it("keeps fixed merchant pixels locked and preserves its independent quality and result controls", () => {
    const model = modelFor("原生4K，固定3840*2160，不支持N。");
    const control = tk1688ResolutionControl(model, model.parameters!)!;
    expect(control).toMatchObject({ value: "3840x2160", fixedSize: "3840x2160", savedTier: "4K",
      readOnlyDimensions: true });
    expect(control.descriptor.options).toEqual([{ label: "4K · 固定 · 3840 × 2160", value: "3840x2160" }]);
    expect(tk1688ParametersForResolutionChange(control, { quality: "high", response_format: "url", resolution: "1K", size_tier: "1K", aspect_ratio: "1:1" }))
      .toEqual({ size: "3840x2160", quality: "high", response_format: "url" });
    expect(model.parameters?.some(parameter => parameter.key === "n")).toBe(false);
  });
});

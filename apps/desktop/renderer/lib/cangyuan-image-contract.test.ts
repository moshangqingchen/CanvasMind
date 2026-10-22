import { describe, expect, it } from "vitest";
import { cangyuanCurrentModel, cangyuanCurrentRequestIssues, type ModelDescriptor } from "@super-canvas/providers";
import { cangyuanConnectorForModels } from "./cangyuan-catalog";
import { normalizedParametersForModel, parameterDescriptorsForValues, parametersWithDefaults } from "./model-parameters";
import { nativeImageResolutionControl, nativeImageRatioOptionLabel, declaredImageOutputDimensions, declaredImageReferenceDimensions } from "./native-image-resolution";
import { effectiveImageCapabilities } from "./supplier-capabilities";
import type { SupplierRecord } from "@super-canvas/db";

const model = (id: string) => cangyuanCurrentModel({ id, name: id, operations: ["image.generate"] });
const supplier: SupplierRecord = { id: "cangyuan", name: "沧元", supplierKey: "cangyuan", apiUrl: "https://ai.cangyuansuanli.cn",
  siteUrl: "https://ai.cangyuansuanli.cn", kind: "newapi", scanStatus: "live", createdAt: "now", updatedAt: "now", catalog: { groups: [] } };

describe("Cangyuan exact image contracts across refresh, switch and reload", () => {
  it.each(["flux-3-image", "flux-3-klein"])("keeps %s native resolution, ratio and optional fields through the actual UI defaults and save/reload", id => {
    const descriptor = model(id), expected = id === "flux-3-image" ? ["768sq", "1K", "1.5K", "2K", "4K"] : ["1K", "2K", "4K"];
    const connection = { id: "key", provider: "rest", config: { baseUrl: supplier.apiUrl, preset: "cangyuan-gpt-image-2", accountKeyGroup: "IMAGE", connector: cangyuanConnectorForModels("IMAGE", [descriptor]) } };
    const result = effectiveImageCapabilities({ supplier, connection, model: JSON.parse(JSON.stringify(descriptor)), fingerprint: "flux-exact" });
    const controls = parameterDescriptorsForValues("image-generation", "rest", result.model, {});
    const native = nativeImageResolutionControl(controls, result.model)!;
    expect(native.resolution.key).toBe("resolution");
    expect(native.resolution.options?.map(o => o.value)).toEqual(expected);
    expect(controls.find(p => p.key === "quality")).toBeUndefined();
    expect(controls.find(p => p.key === "size" && p.control === "dimensions")).toBeUndefined();
    const saved = { resolution: "4K", aspect_ratio: "9:21", ...(id === "flux-3-klein" ? { output_format: "webp", enable_prompt_expansion: false, seed: "0" } : {}) };
    const parameters = parametersWithDefaults(controls, saved), restored = JSON.parse(JSON.stringify(parameters));
    expect(normalizedParametersForModel("image-generation", "rest", result.model, restored)).toMatchObject(saved);
    expect(cangyuanCurrentRequestIssues({ connectionId: "key", operation: "image.edit", model: id, prompt: "offline", parameters: restored, idempotencyKey: "offline" }, supplier.apiUrl)).toEqual([]);
    expect(declaredImageOutputDimensions(result.model, "4K", "9:21")).toBeUndefined();
    expect(nativeImageRatioOptionLabel(result.model, native.resolution, "4K", { label: "9:21", value: "9:21" })).toBe("4K · 9:21");
  });
  it("shows Nano 2.1's declared reference pixels without promising or sending exact output dimensions", () => {
    const current = model("gemini-nano-banana-2.1");
    const control = nativeImageResolutionControl(parameterDescriptorsForValues("image-generation", "rest", current, {}), current)!;
    expect(declaredImageOutputDimensions(current, "4k", "21:9")).toBeUndefined();
    expect(declaredImageReferenceDimensions(current, "4k", "21:9")).toEqual({ width: 6336, height: 2688 });
    expect(nativeImageRatioOptionLabel(current, control.resolution, "2k", { label: "9:16", value: "9:16" })).toBe("2K · 9:16 · 1536 × 2752（参考）");
  });
  it.each(["gpt-image-2.5-sunburst", "grok-imagine-image", "grok-imagine-image-2.0"])("replaces assumed pixel tiers for saved %s", id => {
    const seed: ModelDescriptor = { id, name: id, operations: ["image.generate"], parameters: [{ key: "size", label: "尺寸", control: "dimensions", options: [{ label: "4K 默认假设", value: "3840x2160" }] }],
      metadata: { imageSupportedResolutions: ["1K", "4K"], imageOutputDimensions: [{ resolution: "4K", aspectRatio: "1:1", width: 2160, height: 2160 }] } };
    const connection = { id: "key", provider: "rest", config: { baseUrl: supplier.apiUrl, preset: "cangyuan-gpt-image-2", accountKeyGroup: "IMAGE", connector: cangyuanConnectorForModels("IMAGE", [seed]) } };
    const result = effectiveImageCapabilities({ supplier, connection, model: seed, fingerprint: "scope" });
    expect(result.tiers).toEqual([]);
    expect(result.probeTiers).toEqual([]);
    expect(result.model.metadata?.imageOutputDimensions).toBeUndefined();
    const control = nativeImageResolutionControl(parameterDescriptorsForValues("image-generation", "rest", result.model, {}), result.model)!;
    expect(control.resolution.key).toBe("__fixed_resolution");
    expect(nativeImageRatioOptionLabel(result.model, control.resolution, control.resolution.default, { label: "16:9", value: "16:9" })).toBe("供应商原生 · 16:9");
    expect(effectiveImageCapabilities({ supplier, connection, model: JSON.parse(JSON.stringify(result.model)), fingerprint: "scope" }).model.parameters).toEqual(result.model.parameters);
  });

  it.each(["gpt-image-2-x", "seedream-5.0-pro-x"])("retains open saved %s ratio through reload and runtime normalization", id => {
    const descriptor = model(id);
    const saved = { aspect_ratio: "9:21", size: "3840x2160", ...(id.startsWith("gpt") ? { tier: "4k", quality: "max" } : {}) };
    const restored = JSON.parse(JSON.stringify(saved));
    const normalized = normalizedParametersForModel("image-generation", "rest", descriptor, restored);
    expect(normalized).toMatchObject(saved);
    expect(restored).toEqual(saved);
    expect(cangyuanCurrentRequestIssues({ idempotencyKey: "saved", connectionId: "key", model: id, operation: "image.generate", prompt: "test", parameters: normalized }, supplier.apiUrl)
      .some(issue => issue.path === "parameters.aspect_ratio")).toBe(false);
  });

  it("preserves legal exact dimensions across a switch between current open-size models", () => {
    const descriptor = model("gpt-image-2.5-sunburst");
    const saved = { size: "1234x2345" };
    expect(normalizedParametersForModel("image-generation", "rest", descriptor, saved)).toMatchObject(saved);
    expect(descriptor.parameters?.find(p => p.key === "size")).toMatchObject({ min: 1, step: 1 });
    expect(descriptor.parameters?.find(p => p.key === "size")?.max).toBeUndefined();
    const switched = model("grok-imagine-image");
    const reset = parametersWithDefaults(parameterDescriptorsForValues("image-generation", "rest", switched, {}), saved);
    expect(reset.size).toBe("1234x2345");
    expect(normalizedParametersForModel("image-generation", "rest", switched, JSON.parse(JSON.stringify(reset)))).toEqual(reset);
  });
});

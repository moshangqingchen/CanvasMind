import { describe, expect, it } from "vitest";
import type { SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { applyUserImageSizePresets } from "@super-canvas/providers/image-size-presets";
import { effectiveImageCapabilities, verificationParameters } from "./supplier-capabilities";
import { supplierImageMenuContract } from "./supplier-image-menu-contract";
import { setParameterValueWithSizeExclusivity, resolutionTierShortcuts, undeclaredCOpenImageParameterKeys, sizeOnTierChange } from "../components/node-parameter-fields";
const supplier: SupplierRecord = { id: "source", name: "供应商", supplierKey: "other", siteUrl: "https://unknown.invalid", apiUrl: "https://unknown.invalid", kind: "newapi", scanStatus: "live", createdAt: "now", updatedAt: "now", catalog: { groups: [{ id: "group", label: "group", models: [], details: { source: "model-plaza", description: "支持1K/2K/4K" } }] } };
const raw: ModelDescriptor = { id: "documented-image", name: "image", operations: ["image.generate", "image.edit"], parameters: [
  { key: "size", label: "size", control: "dimensions", default: "auto", options: [{ value: "auto", label: "自动" }, { value: "1920x1088", label: "1K · 16:9 · 1920 × 1088" }] },
  { key: "aspect_ratio", label: "ratio", control: "select", default: "auto", options: [{ value: "auto", label: "自动" }, { value: "16:9", label: "16:9" }] },
] };
function cached(origin: string, id: string, group = "group", key = "other") {
  return supplierImageMenuContract({ provider: "openai", config: { baseUrl: origin, supplierKey: key, modelGroup: group } }, { ...raw, id });
}
describe("supplier source pixel contract", () => {
  it("preserves declared pixels and ratios without filling other tier/ratio combinations", () => {
    const result = effectiveImageCapabilities({ supplier, connection: { id: "key", provider: "openai", config: { baseUrl: supplier.apiUrl, modelGroup: "group" } }, model: raw, fingerprint: "f" });
    expect(result.model.parameters?.find(p => p.key === "size")?.options).toEqual(raw.parameters![0]!.options);
    expect(result.model.parameters?.find(p => p.key === "aspect_ratio")?.options).toEqual(raw.parameters![1]!.options);
    expect(verificationParameters(result, "4K")).toMatchObject({ width: 0, height: 0 });
    expect(verificationParameters(result, "4K").parameters.size).toBeUndefined();
    expect(result.probeTiers).not.toContain("4K");
  });
  it("repairs old WeAI GPT2 injected matrix using only chapter 6 examples", () => {
    const result = cached("https://asian-acc.we-token.cc/v1", "gpt-image-2", "生图-openai-adobe-token计费", "weai");
    const size = result.parameters?.find(p => p.key === "size");
    expect(size).toMatchObject({ step: 16, min: 16, max: 3840 });
    expect(size?.options).toHaveLength(8);
    expect(size?.options?.map(o => o.value)).not.toContain("2160x2160");
    expect(result.metadata?.imageNativeParameterContract).toBe(true);
    for (const id of ["gpt-image-1", "gpt-image-1.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
      const exact = cached("https://asian-acc.we-token.cc/v1", id, "group", "weai").parameters?.find(p => p.key === "size");
      expect(exact?.options?.map(o => o.value)).toEqual(["auto"]);
      expect(exact?.step).toBe(1); expect(exact?.min).toBeUndefined(); expect(exact?.max).toBeUndefined();
    }
  });
  it("restores Fri's own GPT2 1K landscape rather than the generic pixel formula", () => {
    const size = cached("https://api.frimodel.com/v1", "gpt-image-2", "gpt_image", "frimodel").parameters?.find(p => p.key === "size");
    expect(size?.options?.map(o => o.value)).toContain("1920x1088");
    expect(size?.options?.map(o => o.value)).not.toContain("1360x768");
    expect(size?.options).toHaveLength(42);
    expect(size?.options?.map(o => o.value)).toEqual(expect.arrayContaining(["1024x2048", "2048x1024", "672x2016", "2016x672", "1920x3840", "3840x1920", "1280x3840", "3840x1280"]));
    expect(size?.options?.map(o => o.value)).not.toContain("512x1024");
    expect(sizeOnTierChange(size!, "1024x2048", "1K", { ratio: "1:2" })).toBe("1024x2048");
    expect(sizeOnTierChange(size!, "1024x1024", "1K", { ratio: "16:9" })).toBe("1920x1088");
  });
  it("retains Chentu's 1K tier and old pixel examples without treating its static table as a complete enum", () => {
    const result = cached("https://tu.988236.xyz/v1", "gpt-image-2-1k", "1k低价生图", "chentu");
    const size = result.parameters?.find(p => p.key === "size");
    expect(size?.control).toBe("dimensions"); expect(size?.options).toHaveLength(17);
    expect(size?.allowCustomValue).toBe(true);
    expect(size?.options?.map(o => o.value)).toContain("1680x720");
    expect(result.metadata?.imageNativeResolutionOptions).toBe(true);
    const projected = applyUserImageSizePresets(result);
    expect(projected.metadata?.imageUserSizePresetTiers).toEqual(["1K"]);
    expect(projected.parameters?.find(parameter => parameter.key === "size")?.options?.map(option => option.value)).toContain("1680x720");
    const free = cached("https://tu.988236.xyz/v1", "gpt-image-2自由传参", "group", "chentu").parameters?.find(p => p.key === "size");
    expect(free?.step).toBe(1); expect(free?.min).toBeUndefined(); expect(free?.max).toBeUndefined();
  });
  it.each([["frimodel", "https://api.frimodel.com/v1", "gpt_image_adobe", "gpt-image-2.5-flare-adobe"], ["chentu", "https://tu.988236.xyz/v1", "低价Adobe生图", "gpt-image-2.5-flare"], ["cyberafei", "https://api.3365api.cn", "image-2稳定生图", "gpt-image-2.5"]])("keeps %s exact historical request sizes open without a matrix", (key, origin, group, id) => {
    const result = cached(origin, id, group, key), size = result.parameters?.find(p => p.key === "size");
    expect(size?.step).toBe(1); expect(size?.min).toBeUndefined(); expect(size?.max).toBeUndefined();
    expect(size?.options?.length).toBeLessThan(12);
    expect(size?.options?.map(o => o.value)).toContain("2048x2048");
    expect(size?.options?.map(o => o.value)).not.toContain("2048x1536");
    expect(result.metadata?.imageNativeParameterContract).toBe(true);
    expect(resolutionTierShortcuts(size!).map(t => t.label)).toContain("2K");
  });
  it("preserves manual/paid contracts and independently saved ratio/size/tier preferences", () => {
    for (const metadata of [{ source: "manual" }, { protocolEvidence: "paid-test" }]) {
      const custom = { ...raw, id: "gpt-image-2", metadata };
      expect(supplierImageMenuContract({ provider: "openai", config: { baseUrl: "https://api.frimodel.com/v1" } }, custom)).toBe(custom);
    }
    for (const metadata of [{ imageOpenSizePreferences: true }, { pdogImageProtocol: 1, imageResolutionTierParameter: "size_tier" }, { tk1688ImageSizeContract: 2, imageResolutionTierParameter: "resolution" }]) {
      const parameters = { size: "2051x2049", size_tier: "4K", resolution: "4K", aspect_ratio: "16:9", quality: "max" };
      expect(setParameterValueWithSizeExclusivity(parameters, "size", "4097x2051", { model: { ...raw, metadata }, hasSizeControl: true, hasAspectRatioControl: true })).toEqual({ ...parameters, size: "4097x2051" });
    }
  });
  it("exposes a precise user clearing path for historical C fields without altering any saved value", () => {
    const current = { output_format: "jpeg", output_compression: 80, background: "transparent", quality: "max", size: "2051x2049" };
    const model = { ...raw, metadata: { cOpenImageContract: 1, imageAdditionalFieldContract: "not-declared-in-exact-supplier-material" } };
    expect(undeclaredCOpenImageParameterKeys(model, current)).toEqual(["output_format", "output_compression", "background"]);
    expect(current).toEqual({ output_format: "jpeg", output_compression: 80, background: "transparent", quality: "max", size: "2051x2049" });
    expect(undeclaredCOpenImageParameterKeys({ ...raw, metadata: { cOpenImageContract: 1, imageAdditionalFieldContract: "official-linked-openai-images-schema" } }, current)).toEqual([]);
    expect(undeclaredCOpenImageParameterKeys(raw, current)).toEqual([]);
  });
  it.each(["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("keeps exact Hang75 measured generate PNG fields out of the undeclared clearing list for %s", id => {
    const current = { background: "transparent", output_format: "png", output_compression: 80, quality: "max" };
    const measured = { origin: "https://api.hangzhale.com", officialGroupId: "75", fullModelId: id, operation: "image.generate",
      background: "transparent", output_format: "png", source: "same-exact-identity-original-transparent-png-evidence" };
    const model = { ...raw, id, metadata: { cOpenImageContract: 1, imageAdditionalFieldContract: "not-declared-in-exact-supplier-material", imageMeasuredAdditionalFields: measured } };
    expect(undeclaredCOpenImageParameterKeys(model, current, "image.generate")).toEqual(["output_compression"]);
    expect(undeclaredCOpenImageParameterKeys(model, current, "image.edit")).toEqual(["output_format", "output_compression", "background"]);
    expect(undeclaredCOpenImageParameterKeys(model, { ...current, output_format: "jpeg" }, "image.generate")).toEqual(["output_format", "output_compression", "background"]);
    for (const changed of [{ origin: "https://other.invalid" }, { officialGroupId: "21" }, { fullModelId: "other-image" }]) {
      expect(undeclaredCOpenImageParameterKeys({ ...model, metadata: { ...model.metadata, imageMeasuredAdditionalFields: { ...measured, ...changed } } }, current, "image.generate"))
        .toEqual(["output_format", "output_compression", "background"]);
    }
    expect(current).toEqual({ background: "transparent", output_format: "png", output_compression: 80, quality: "max" });
  });
});

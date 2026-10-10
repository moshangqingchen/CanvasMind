import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { JIASU_IMAGE_MODELS, JIASU_RESOLUTION_IMAGE_MODELS, jiasuImageRequestIssues, jiasuImageSizes } from "@super-canvas/providers/jiasu-image-contract";
import type { ProviderConnectionView } from "./client-api";
import { withCurrentImageRequestParameters } from "./image-request-parameters";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { normalizedParametersForModel, parameterDescriptorsFor, parametersWithDefaults } from "./model-parameters";
import { modelImageCapabilities } from "./model-image-capabilities";
import { effectiveImageCapabilities, verificationParameters } from "./supplier-capabilities";
import { savedModelAvailabilityError } from "./model-availability";
import { parametersForResolutionModelChange } from "./model-resolution-family";
import type { SupplierRecord } from "@super-canvas/db";

const cached = (id: string): ModelDescriptor => ({ id, name: id, operations: ["image.generate", "image.edit"],
  parameters: [{ key: "size", label: "尺寸", control: "dimensions", default: "3840x2160", options: [{ value: "3840x2160", label: "4K" }] },
    { key: "quality", label: "质量", control: "select", default: "max", options: ["high", "max"].map(value => ({ value, label: value })) }],
  metadata: { canvasRunnable: false, canvasUnavailableReason: "画布协议尚未内置", autoInterfaceStatus: "incomplete", priceLabel: "$0.03/请求（佳速模型卡）" } });
const connection: ProviderConnectionView = { id: "jiasu-current", name: "佳速", provider: "openai", apiKey: "", apiKeySet: true, apiKeyUsable: true,
  config: { baseUrl: "https://ai.jiasuapi.com/v1", usage: "canvas", modelGroup: "vip", accountKeyGroup: "vip", modelScanStatus: "live",
    scannedModelIds: [...JIASU_IMAGE_MODELS], modelCatalogModels: JIASU_IMAGE_MODELS.map(cached) } };
const supplier: SupplierRecord = { id: "jiasu", name: "佳速", supplierKey: "custom-jiasu", siteUrl: "https://ai.jiasuapi.com", apiUrl: "https://ai.jiasuapi.com/v1",
  kind: "newapi", scanStatus: "live", catalog: { groups: [] }, createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" };

describe("Jiasu image picker and saved catalog recovery", () => {
  it.each(JIASU_IMAGE_MODELS)("restores %s with precise current controls without rewriting stored parameters", id => {
    const original = cached(id);
    const snapshot = structuredClone(original);
    const model = withCurrentImageRequestParameters(connection, [original])[0]!;
    expect(model.metadata).toMatchObject({ canvasRunnable: true, jiasuImageProtocol: 1, priceLabel: original.metadata!.priceLabel });
    expect(model.metadata?.canvasUnavailableReason).toBeUndefined();
    expect(model.operations).toEqual(["image.generate", "image.edit"]);
    const defaults = parametersWithDefaults(parameterDescriptorsFor("image-generation", "openai", model));
    if (JIASU_RESOLUTION_IMAGE_MODELS.includes(id)) {
      expect(defaults).toEqual({ resolution: "1K", ratio: "1:1", quality: "auto" });
      expect(model.parameters?.find(item => item.key === "ratio")?.options?.map(item => item.value)).toEqual(["1:1", "16:9", "9:16", "3:4", "4:3"]);
    } else {
      expect(defaults).toEqual({ size: jiasuImageSizes(id)[0], quality: id === "gpt-image-2-high" ? "high" : "medium" });
      expect(model.parameters?.find(item => item.key === "size")?.options?.map(item => item.value)).toEqual(jiasuImageSizes(id));
      expect(model.parameters?.some(item => item.control === "dimensions")).toBe(false);
    }
    expect(modelImageCapabilities({ ...connection, config: { ...connection.config, modelCatalogModels: [model] } }, model)).toEqual({ transparent: false, mask: null });
    expect(original).toEqual(snapshot);
  });
  it("binds all nine current Key models after live scan while retaining the original price evidence", () => {
    const models = bindScannedModelProtocols(connection, JIASU_IMAGE_MODELS.map(cached)).models;
    expect(models).toHaveLength(9);
    for (const model of models) {
      expect(model.metadata?.canvasRunnable).toBe(true);
      expect(model.parameters?.find(item => item.key === "quality")?.default).toBe(JIASU_RESOLUTION_IMAGE_MODELS.includes(model.id) ? "auto" : model.id === "gpt-image-2-high" ? "high" : "medium");
      expect(model.metadata?.priceLabel).toContain("佳速模型卡");
    }
  });
  it("keeps exact native size options and avoids expanding 4K into another model's 2K presets", () => {
    const model = withCurrentImageRequestParameters(connection, [cached("gpt-image-2-4k")])[0]!;
    const capabilities = effectiveImageCapabilities({ supplier, connection, model, fingerprint: "current-jiasu-key" });
    expect(capabilities.tiers).toEqual([{ tier: "4K", status: "declared" }]);
    expect(capabilities.probeTiers).toEqual([]);
    expect(capabilities.quality).toBe("medium");
    expect(capabilities.model.parameters?.find(item => item.key === "size")?.options?.map(item => item.value)).toEqual(["4096x4096", "4096x2304", "2304x4096"]);
    expect(verificationParameters(capabilities, "4K")).toEqual({ parameters: { size: "4096x4096", quality: "medium", n: 1 }, width: 4096, height: 4096 });
  });
  it("leaves manual legacy values in the canvas and rejects illegal upstream combinations before submit", () => {
    const parameters = { size: "3840x2160", quality: "max", n: 1 };
    const model = withCurrentImageRequestParameters(connection, [cached("gpt-image-2-4k")])[0]!;
    const restored = normalizedParametersForModel("image-generation", "openai", model, parameters);
    expect(restored).toMatchObject(parameters);
    expect(jiasuImageRequestIssues(connection, { connectionId: connection.id, model: model.id, operation: "image.generate", prompt: "Cup", idempotencyKey: "existing-node", parameters: restored }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid_size" }), expect.objectContaining({ code: "invalid_quality" })]));
  });
  it("does not grant another group or a removed model access through catalog repair", () => {
    const original = cached("gpt-image-2-1k");
    const wrongGroup = { ...connection, config: { ...connection.config, accountKeyGroup: "another" } };
    expect(withCurrentImageRequestParameters(wrongGroup, [original])[0]).toBe(original);
    const missing = { ...connection, config: { ...connection.config, scannedModelIds: ["gpt-image-2-high"] } };
    expect(withCurrentImageRequestParameters(missing, [original])[0]).toBe(original);
    const unauthorized = { ...connection, config: { ...connection.config, modelScanStatus: "unauthorized" } };
    expect(withCurrentImageRequestParameters(unauthorized, [original])[0]).toBe(original);
    expect(savedModelAvailabilityError(unauthorized.config, original.id)).toMatch(/鉴权/u);
  });
  it("drops obsolete hidden pixel fields when the user actively switches to a resolution model, then preserves its saved ratio", () => {
    const [previous, next] = withCurrentImageRequestParameters(connection, [cached("gpt-image-2-4k"), cached("gpt-image-2.5-1k")]);
    const selected: Record<string, unknown> = { size: "4096x2304", quality: "medium", size_tier: "4K", aspect_ratio: "16:9", n: 1 };
    const resolution = parametersForResolutionModelChange(previous, next, selected);
    for (const key of ["quality", "size", "size_tier", "aspect_ratio", "n"]) delete selected[key];
    if (resolution) Object.assign(selected, resolution);
    const switched = parametersWithDefaults(parameterDescriptorsFor("image-generation", "openai", next), selected);
    expect(switched).toEqual({ resolution: "1K", ratio: "1:1", quality: "auto" });
    const restored = normalizedParametersForModel("image-generation", "openai", next, { ...switched, ratio: "9:16" });
    expect(restored).toEqual({ resolution: "1K", ratio: "9:16", quality: "auto" });
    expect(jiasuImageRequestIssues(connection, { connectionId: connection.id, operation: "image.generate", model: next!.id, prompt: "Cup", idempotencyKey: "user-changed-model", parameters: restored })).toEqual([]);
  });
});

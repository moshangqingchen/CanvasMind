import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { imageSizeOptions, type ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "./client-api";
import type { CanvasNode } from "../components/types";
import { withCurrentImageRequestParameters } from "./image-request-parameters";
import { normalizedParametersForModel, parameterDescriptorsFor, parameterValueForModel, setParameterValue } from "./model-parameters";
import { jijiuGptImageRequestIssues, jijiuGptImageParameters } from "@super-canvas/providers/jijiu-image-contract";
import { NodeParameterFields, isGenimageNativeImageContractModel, undeclaredGenimageNativeImageParameterKeys, resolutionTierForValue, resolutionTierShortcuts } from "../components/node-parameter-fields";
import { applyBananaImageCapabilities } from "@super-canvas/providers/banana-image-contract";

const cached: ModelDescriptor = { id: "gpt-image-2", name: "Cached pDog GPT", operations: ["image.generate", "image.edit"],
  parameters: [
    { key: "size", label: "尺寸", control: "dimensions", default: "auto", options: imageSizeOptions(["1K", "2K", "4K"], 4096) },
    { key: "quality", label: "质量", control: "select", default: "max", options: ["low", "medium", "high", "xhigh", "max"].map(value => ({ value, label: value })) },
  ], metadata: { qualitySupport: "assumed", priceLabel: "0.03/张（分组说明参考）" } };
const connection: ProviderConnectionView = { id: "cached-pdog", name: "Renamed provider", provider: "openai", apiKey: "", apiKeySet: true, apiKeyUsable: true,
  config: { supplierKey: "custom-pdog", usage: "canvas", baseUrl: "https://ai.whyshy.cn", modelGroup: "【生图】image2/2.5-1K2K4K(超分组)",
    defaultModel: cached.id, modelScanStatus: "live", modelCatalogModels: [cached] } };
const source = (): CanvasNode => ({ id: "image", type: "workflow", position: { x: 0, y: 0 }, data: {
  nodeType: "image-generation", label: "Image", provider: "openai", connectionId: connection.id, model: cached.id,
  qualityMode: "highest", parameters: { quality: "max", size: "2160x3840", size_tier: "4K" }, parts: [],
  inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }],
} });

describe("current image contracts in saved canvas catalogs", () => {
  let canvasModule: Pick<typeof import("../components/canvas-app"), "configureNewGenerationNode" | "modelDiscoveryMigrationPatch" | "normalizeGenerationNodeForRun">;
  beforeAll(async () => { vi.stubGlobal("React", React); canvasModule = await import("../components/canvas-app"); });
  afterAll(() => vi.unstubAllGlobals());

  it.each(["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview", "gemini-2.5-flash-image", "gemini-3.1-flash-lite-image", "gemini-nano-banana-2.1"])("preserves every Gen native saved field through same-model discovery for %s", id => {
    const raw: ModelDescriptor = { id, name: id, operations: ["image.generate", "image.edit"] };
    const model = applyBananaImageCapabilities({ provider: "openai", config: { baseUrl: "https://genimage.pro/v1" } }, raw);
    const current = { quality: "max", output_format: "png", size: "auto", size_tier: "2K", resolution: "4K", aspectRatio: "16:9", ratio: "4:3", n: 1 };
    const data = { ...source().data, model: id, provider: "openai", connectionId: "gen-native", parameters: current };
    const patch = canvasModule.modelDiscoveryMigrationPatch("image-generation", data, "openai", model);
    const next = { ...data, ...patch };
    expect(next.parameters).toMatchObject(current);
    expect(canvasModule.modelDiscoveryMigrationPatch("image-generation", next, "openai", model)?.parameters).toBeUndefined();
    expect(undeclaredGenimageNativeImageParameterKeys(model, next.parameters!)).toEqual(["quality", "output_format"]);
    expect(current).toEqual({ quality: "max", output_format: "png", size: "auto", size_tier: "2K", resolution: "4K", aspectRatio: "16:9", ratio: "4:3", n: 1 });
    expect(isGenimageNativeImageContractModel(applyBananaImageCapabilities({ provider: "openai", config: { baseUrl: "https://other.invalid/v1" } }, raw))).toBe(false);
    for (const metadata of [{ source: "manual" }, { source: "paid-test" }, { protocolEvidence: "paid-test" }])
      expect(isGenimageNativeImageContractModel({ ...model, metadata: { ...model.metadata, ...metadata } })).toBe(false);
    expect(isGenimageNativeImageContractModel({ ...model, id: "gemini-unknown-image" })).toBe(false);
    expect(isGenimageNativeImageContractModel({ ...model, metadata: { ...model.metadata, imageContractParameterCoverage: undefined } })).toBe(false);
  });

  it("shows Gen unknown native fields for explicit clearing even with advanced UI hidden", () => {
    const model = applyBananaImageCapabilities({ provider: "openai", config: { baseUrl: "https://genimage.pro/v1" } },
      { id: "gemini-3-pro-image-preview", name: "Gen Pro", operations: ["image.generate", "image.edit"] });
    const current = { quality: "max", output_format: "auto", image_size: "4K", size_tier: "2K", aspectRatio: "16:9", n: 1 };
    const onChange = vi.fn();
    const html = renderToStaticMarkup(React.createElement(NodeParameterFields, { nodeId: "gen-native", nodeType: "image-generation", provider: "openai", model,
      parameters: current, onChange, showAdvanced: false, operation: "image.generate" }));
    expect(html).toContain("清除 quality"); expect(html).toContain("清除 output_format");
    expect(html).not.toContain("清除 size_tier"); expect(html).not.toContain("清除 aspectRatio");
    expect(onChange).not.toHaveBeenCalled();
    expect(undeclaredGenimageNativeImageParameterKeys(model, { quality: "", image_size: "4K" })).toEqual(["quality"]);
    expect(current.quality).toBe("max"); expect(current.size_tier).toBe("2K");
  });

  it.each(["3240x2160", "3840x1646", "2560x1097", "1440x1440"])("retains Mikoto source pixels %s and invalid saved quality through refresh and run", size => {
    const mikoto = { ...connection, id: "mikoto-image", config: { baseUrl: "https://api.mikoto.vip/v1", supplierKey: "mikoto",
      modelGroup: "生图（2k4k 中质量）", usage: "canvas", defaultModel: cached.id, modelCatalogModels: [cached] } };
    const model = withCurrentImageRequestParameters(mikoto, [cached])[0]!;
    const descriptor = model.parameters!.find(p => p.key === "size")!;
    expect(descriptor.step).toBe(1);
    expect(resolutionTierForValue(resolutionTierShortcuts(descriptor), size)).toBe(["1440x1440", "2560x1097"].includes(size) ? "2K" : "4K");
    const saved = { size, quality: "max", response_format: "b64_json", n: 2 };
    expect(normalizedParametersForModel("image-generation", "openai", model, saved)).toMatchObject(saved);
    const restored = { ...source(), data: { ...source().data, connectionId: mikoto.id, parameters: saved } } as CanvasNode;
    expect(canvasModule.modelDiscoveryMigrationPatch("image-generation", restored.data, "openai", model)?.parameters).toBeUndefined();
    const normalized = canvasModule.normalizeGenerationNodeForRun(restored, [mikoto], { connectionId: mikoto.id, items: [cached], authoritative: true });
    expect(normalized.data.parameters).toMatchObject(saved);
    expect(model.metadata?.priceLabel).toBe(cached.metadata?.priceLabel);
    expect(model.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["medium"]);
  });

  it.each(["2K", "4K"])("restores Jijiu %s/high from an auto-only saved catalog through refresh and run", size => {
    const legacy: ModelDescriptor = { id: "gpt-image-2-2K/4K", name: "极九 GPT Image 2 2K/4K", operations: ["image.generate", "image.edit"],
      parameters: [{ key: "size", label: "尺寸", control: "select", default: "auto", options: [{ value: "auto", label: "自动" }] }],
      metadata: { jijiuImageContract: true, imageNativeParameterContract: true, imageNativeResolutionOptions: true,
        priceLabel: "0.13 元/张", imageSupportedResolutions: ["1K", "2K", "4K"] } };
    const jijiu: ProviderConnectionView = { ...connection, id: "jijiu-native", config: { baseUrl: "https://newapi.jijiucanvas.com/v1",
      modelGroup: "图片-GPT-image-2-2K/4K", accountKeyGroup: "图片-GPT-image-2-2K/4K", usage: "canvas", defaultModel: legacy.id,
      scannedModelIds: [legacy.id], modelScanStatus: "live", modelCatalogModels: [legacy] } };
    const restored = JSON.parse(JSON.stringify({ ...source(), data: { ...source().data, connectionId: jijiu.id, model: legacy.id,
      qualityMode: "custom", parameters: { size, quality: "high" } } })) as CanvasNode;
    const model = withCurrentImageRequestParameters(jijiu, [legacy])[0]!;
    expect(model.parameters?.find(parameter => parameter.key === "size")?.options?.map(option => option.value)).toEqual(["auto", "1K", "2K", "4K"]);
    expect(parameterDescriptorsFor("image-generation", "openai", model).find(parameter => parameter.key === "quality")?.default).toBe("high");
    expect(model.metadata?.priceLabel).toBe("0.13 元/张");
    expect(canvasModule.modelDiscoveryMigrationPatch("image-generation", restored.data, "openai", model)?.parameters).toBeUndefined();
    const normalized = canvasModule.normalizeGenerationNodeForRun(restored, [jijiu], { connectionId: jijiu.id, items: [legacy], authoritative: true });
    expect(normalized.data.parameters).toMatchObject({ size, quality: "high" });
    const request = { idempotencyKey: "jijiu-saved-tier", connectionId: jijiu.id, model: legacy.id, operation: "image.generate" as const,
      prompt: "saved selection", parameters: normalized.data.parameters };
    expect(jijiuGptImageRequestIssues(jijiu, request)).toEqual([]);
    expect(jijiuGptImageParameters(normalized.data.parameters, legacy.id)).toEqual({ n: 1, size, quality: "high" });
    expect(legacy.parameters).toHaveLength(1);
  });

  it.each(["resolution", "image_size", "imageSize", "size_tier"])("shows and restores Jijiu's saved %s alias without injecting a conflicting auto size", alias => {
    const jijiu = { ...connection, config: { baseUrl: "https://newapi.jijiucanvas.com/v1", modelGroup: "图片-GPT-image-2-2K/4K" } };
    const model = withCurrentImageRequestParameters(jijiu, [{ ...cached, id: "gpt-image-2-2K/4K" }])[0]!;
    const current = { [alias]: "4K", quality: "high" };
    expect(parameterValueForModel(model, current, "size")).toBe("4K");
    const normalized = normalizedParametersForModel("image-generation", "openai", model, current);
    expect(normalized).toMatchObject({ ...current, size: "4K" });
    expect(jijiuGptImageParameters(normalized, model.id)).toEqual({ n: 1, size: "4K", quality: "high" });
    expect(setParameterValue(normalized, "size", "2K", model)).toEqual({ size: "2K", quality: "high" });
    const conflict = normalizedParametersForModel("image-generation", "openai", model, { ...current, size: "2K" });
    expect(conflict).toMatchObject({ ...current, size: "2K" });
    expect(jijiuGptImageRequestIssues(jijiu, { idempotencyKey: "conflict", connectionId: jijiu.id, model: model.id,
      operation: "image.generate", prompt: "saved conflict", parameters: conflict }).some(issue => issue.code === "conflicting_resolution")).toBe(true);
  });

  it("replaces a generic max schema without mutating the cache or its price evidence", () => {
    const snapshot = structuredClone(cached);
    const model = withCurrentImageRequestParameters(connection, [cached])[0]!;
    const quality = model.parameters!.find(parameter => parameter.key === "quality")!;
    expect(quality.default).toBe("high");
    expect(quality.options!.map(option => option.value)).toEqual(["auto", "low", "medium", "high"]);
    const size = model.parameters!.find(parameter => parameter.key === "size")!;
    expect(size.options?.map(option => option.value)).toEqual(expect.arrayContaining(["1360x768", "2880x2880", "3840x2160"]));
    expect(model.metadata?.imageUserSizePresetSource).toBe("user-request");
    expect(size).toMatchObject({ control: "dimensions", valueType: "string" });
    expect(size.min).toBeUndefined(); expect(size.max).toBeUndefined();
    expect(normalizedParametersForModel("image-generation", "openai", model, { size: "2051x2049" }).size).toBe("2051x2049");
    expect(model.metadata?.priceLabel).toBe(cached.metadata?.priceLabel);
    expect(cached).toEqual(snapshot);
  });

  it("initializes a new pDog node from the saved catalog at high, never max", () => {
    const node = source();
    delete node.data.model; delete node.data.connectionId; delete node.data.provider;
    node.data.parameters = {};
    expect(canvasModule.configureNewGenerationNode(node, [connection])?.data).toMatchObject({
      connectionId: connection.id, model: cached.id, parameters: { quality: "high" },
    });
  });

  it("corrects an automatic highest selection after discovery while preserving its dimensions", () => {
    const node = source();
    const model = withCurrentImageRequestParameters(connection, [cached])[0]!;
    expect(canvasModule.modelDiscoveryMigrationPatch("image-generation", node.data, "openai", model)?.parameters)
      .toEqual({ quality: "high", size: "2160x3840", size_tier: "4K" });
  });

  it("preserves the saved explicit quality during run normalization when the latest schema is generic", () => {
    const node = source();
    expect(canvasModule.normalizeGenerationNodeForRun(node, [connection], {
      connectionId: connection.id, items: [cached], authoritative: true,
    }).data.parameters).toMatchObject({ quality: "max", size: "2160x3840", size_tier: "4K" });
  });

  it("preserves a manual low quality and exact 2K ratio through discovery and run normalization", () => {
    const node = source();
    node.data.qualityMode = "custom";
    node.data.parameters = { quality: "low", size: "2048x896", size_tier: "2K" };
    const model = withCurrentImageRequestParameters(connection, [cached])[0]!;
    expect(canvasModule.modelDiscoveryMigrationPatch("image-generation", node.data, "openai", model)?.parameters).toBeUndefined();
    expect(canvasModule.normalizeGenerationNodeForRun(node, [connection], {
      connectionId: connection.id, items: [cached], authoritative: true,
    }).data.parameters).toMatchObject({ quality: "low", size: "2048x896", size_tier: "2K" });
  });

  it("restores user shortcuts across endpoints without changing a denied model's availability", () => {
    const other = { ...connection, config: { ...connection.config, baseUrl: "https://another.invalid/v1" } };
    expect(withCurrentImageRequestParameters(other, [cached])[0]?.metadata).toMatchObject({ ...cached.metadata, imageUserSizePresetSource: "user-request" });
    const denied = { ...cached, metadata: { ...cached.metadata, canvasRunnable: false, canvasUnavailableReason: "403" } };
    expect(withCurrentImageRequestParameters(connection, [denied])[0]?.metadata).toMatchObject(denied.metadata);
  });

  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("retains max quality for upscaling %s with exact reference-edit request evidence", id => {
    const image25 = { ...cached, id };
    const configured: ProviderConnectionView = { ...connection, config: { ...connection.config, defaultModel: image25.id, modelCatalogModels: [image25] } };
    const model = withCurrentImageRequestParameters(configured, [image25])[0]!;
    const quality = model.parameters!.find(parameter => parameter.key === "quality")!;
    expect(quality.default).toBe("max");
    expect(quality.options!.map(option => option.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    expect(model.metadata).toMatchObject({ qualitySupport: "declared", pdogQualityDocumented: true, pdogQualityVerified: true,
      pdogQualitySource: "official-gpt-images-common-field+same-identity-accepted-reference-request",
      pdogMeasuredQuality: { fullModelId: id, group: configured.config.modelGroup, request: { quality: "max" } } });
    expect(model.metadata?.imageUserQualityPresetSource).toBe("user-request");
    expect(model.metadata?.image25VerifiedAt).toBeUndefined();
    const node = source();
    node.data.model = image25.id;
    expect(canvasModule.normalizeGenerationNodeForRun(node, [configured], {
      connectionId: configured.id, items: [image25], authoritative: true,
    }).data.parameters?.quality).toBe("max");
    node.data.qualityMode = "custom";
    node.data.parameters = { quality: "high" };
    expect(canvasModule.modelDiscoveryMigrationPatch("image-generation", node.data, "openai", model)?.parameters).toBeUndefined();
  });
});

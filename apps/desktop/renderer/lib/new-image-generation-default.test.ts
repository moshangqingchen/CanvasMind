import React from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { imageSizeOptions, type ModelDescriptor } from "@super-canvas/providers";
import type { CanvasNode } from "../components/types";
import type { ProviderConnectionView } from "./client-api";
import { image25Highest4KParameters, weAiImageGenerationDefault, withWeAiImage25RequestParameters } from "./new-image-generation-default";

const rawModels: ModelDescriptor[] = ["flare", "sunburst"].map(variant => ({
  id: `gpt-image-2.5-${variant}`, name: `Image 2.5 ${variant}`,
  operations: ["image.generate", "image.edit"], parameters: [],
}));
function connection(overrides: Partial<ProviderConnectionView> = {}): ProviderConnectionView {
  return { id: "weai-image25", name: "An arbitrary renamed supplier", provider: "openai", apiKeySet: true, apiKeyUsable: true, apiKey: "",
    config: { supplierKey: "weai", usage: "canvas", baseUrl: "https://asian-acc.we-token.cc/v1",
      modelGroup: "生图-openai-adobe-image2.5专属", accountKeyGroup: "生图-openai-adobe-image2.5专属",
      defaultModel: "gpt-image-2.5-sunburst", modelScanStatus: "live", modelCatalogModels: rawModels }, ...overrides };
}
function node(): CanvasNode {
  return { id: "new", type: "workflow", position: { x: 0, y: 0 }, data: {
    nodeType: "image-generation", label: "图片生成", parts: [],
    inputs: [{ id: "prompt", kind: "text", label: "提示词" }, { id: "references", kind: "image[]", label: "参考图" }],
    outputs: [{ id: "images", kind: "image", label: "图片" }],
  } };
}
function declaredModel(qualities = ["high", "max"], tiers: ("1K" | "2K" | "4K")[] = ["1K", "2K", "4K"]): ModelDescriptor {
  return { ...rawModels[0]!, parameters: [
    { key: "size", label: "尺寸", control: "dimensions", default: "auto", options: imageSizeOptions(tiers, 3840) },
    { key: "quality", label: "质量", control: "select", default: "high", options: qualities.map(value => ({ value, label: value })) },
  ] };
}

describe("new We-AI Image 2.5 default", () => {
  it("uses supplier identity with the OpenAI adapter and the configured Sunburst model", () => {
    const selected = weAiImageGenerationDefault(connection(), rawModels);
    expect(selected?.model.id).toBe("gpt-image-2.5-sunburst");
    expect(selected?.parameters).toMatchObject({ quality: "max", size: "2880x2880", size_tier: "4K" });
    expect(rawModels.every(model => model.parameters?.length === 0)).toBe(true);
    expect(selected?.model.metadata?.image25VerifiedAt).toBeUndefined();
    expect(selected?.model.metadata?.imageSupportedResolutions).toBeUndefined();
  });

  it("preserves the group's existing preferred Flare model instead of comparing prices", () => {
    const configured = connection();
    configured.config.defaultModel = "gpt-image-2.5-flare";
    expect(weAiImageGenerationDefault(configured, rawModels)?.model.id).toBe("gpt-image-2.5-flare");
  });

  it("keeps the exact request preset when scanning supplies generic assumed high-only controls", () => {
    const generic = { ...declaredModel(["low", "medium", "high"], ["1K", "2K"]), metadata: {
      qualitySupport: "assumed", imageRequestResolutions: ["4K"],
      imageCapabilityEvidence: [{ resolution: "4K", status: "assumed" }],
    } };
    expect(weAiImageGenerationDefault(connection(), [generic])?.parameters)
      .toMatchObject({ quality: "max", size: "2880x2880", size_tier: "4K" });
    expect(withWeAiImage25RequestParameters(connection(), [generic])[0]?.metadata)
      .toMatchObject({ qualitySupport: "assumed", imageCapabilityEvidence: generic.metadata.imageCapabilityEvidence });
  });

  it.each([
    { supplierKey: "custom-other" }, { usage: "agent" }, { usage: "disabled" },
    { baseUrl: "https://another.invalid/v1" }, { modelGroup: "生图-openai-adobe-按次" },
    { accountKeyGroup: "different-key-group" }, { modelScanStatus: "unauthorized" }, { supplierArchived: true },
  ])("does not invent request controls for another identity, endpoint, group or unavailable inventory: %o", change => {
    const configured = connection();
    Object.assign(configured.config, change);
    expect(weAiImageGenerationDefault(configured, rawModels)).toBeUndefined();
  });

  it.each([
    { canvasRunnable: false, canvasUnavailableReason: "403 权限拒绝" },
    { imageUnsupportedResolutions: ["4K"] }, { imageApproximateResolutions: ["4K"] },
    { imageCapabilityEvidence: [{ resolution: "4K", status: "unsupported" }] },
    { imageCapabilityEvidence: [{ quality: "max", status: "unsupported" }] },
    { imageCapabilityEvidence: [{ quality: "max", status: "conflict" }] },
    { qualitySupport: "unsupported" }, { fixedQuality: "high" }, { parameterControlsUnavailable: true },
  ])("retains explicit negative capability or permission evidence: %o", metadata => {
    const models = rawModels.map(model => ({ ...model, metadata }));
    expect(withWeAiImage25RequestParameters(connection(), models)).toEqual(models);
    expect(weAiImageGenerationDefault(connection(), models)).toBeUndefined();
  });

  it("keeps an existing schema and excludes high-only, 2K-only, ordinary Image 2 and Gemini 2.5", () => {
    const highOnly = declaredModel(["high"]);
    expect(withWeAiImage25RequestParameters(connection(), [highOnly])[0]).toBe(highOnly);
    for (const model of [highOnly, declaredModel(["max"], ["1K", "2K"]),
      { ...declaredModel(), id: "gpt-image-2" }, { ...declaredModel(), id: "gemini-2.5-flash-image" }])
      expect(weAiImageGenerationDefault(connection(), [model])).toBeUndefined();
  });

  it("does not overwrite declared high-only quality because a resolution has assumed evidence", () => {
    const highOnly = { ...declaredModel(["high"]), metadata: {
      qualitySupport: "declared", imageCapabilityEvidence: [{ resolution: "4K", status: "assumed" }],
    } };
    expect(withWeAiImage25RequestParameters(connection(), [highOnly])[0]).toBe(highOnly);
    expect(weAiImageGenerationDefault(connection(), [highOnly])).toBeUndefined();
  });

  it("does not turn a resolution-only quality control into max picture quality", () => {
    const model: ModelDescriptor = { ...rawModels[0]!, parameters: [
      { key: "quality", label: "分辨率", control: "select", default: "4k", options: [{ value: "4k", label: "4K" }] },
    ] };
    expect(image25Highest4KParameters("openai", model)).toBeUndefined();
  });

  it("honors negative max-quality evidence even with a declared schema, while a rejected low tier does not block max", () => {
    for (const status of ["unsupported", "conflict"])
      expect(weAiImageGenerationDefault(connection(), [{ ...declaredModel(), metadata: {
        imageCapabilityEvidence: [{ quality: "max", status }],
      } }])).toBeUndefined();
    expect(weAiImageGenerationDefault(connection(), [{ ...declaredModel(), metadata: {
      imageCapabilityEvidence: [{ quality: "low", status: "unsupported" }],
    } }])?.parameters.quality).toBe("max");
  });
});

describe("creation and subsequent discovery", () => {
  let canvasModule: Pick<typeof import("../components/canvas-app"), "configureNewGenerationNode" | "modelDiscoveryMigrationPatch" | "normalizeGenerationNodeForRun">;
  beforeAll(async () => {
    vi.stubGlobal("React", React);
    canvasModule = await import("../components/canvas-app");
  });
  afterAll(() => vi.unstubAllGlobals());

  const otherModel: ModelDescriptor = { id: "gpt-image-2", name: "Another model", operations: ["image.generate"],
    parameters: [{ key: "quality", label: "质量", control: "select", default: "high", options: [{ value: "high", label: "高" }] }] };
  const other: ProviderConnectionView = { ...connection(), id: "another", config: {
    supplierKey: "custom-other", modelScanStatus: "live", defaultModel: otherModel.id, modelCatalogModels: [otherModel],
  } };

  it("prefers configured We-AI over an earlier supplier and leaves the source node untouched", () => {
    const source = node();
    const snapshot = structuredClone(source);
    const result = canvasModule.configureNewGenerationNode(source, [other, connection()]);
    expect(result?.data).toMatchObject({ connectionId: "weai-image25", provider: "openai", model: "gpt-image-2.5-sunburst",
      parameters: { size: "2880x2880", quality: "max", size_tier: "4K" } });
    expect(source).toEqual(snapshot);
  });

  it.each([{ apiKeyUsable: false }, { config: { ...connection().config, usage: "agent" } },
    { config: { ...connection().config, modelCatalogModels: [] } }])("keeps the previous safe default when We-AI is unavailable: %o", overrides => {
    expect(canvasModule.configureNewGenerationNode(node(), [other, connection(overrides)])?.data.connectionId).toBe("another");
  });

  it("preserves max and 4K when raw inventory is refreshed and parameters are normalized for a run", () => {
    const configured = connection();
    const created = canvasModule.configureNewGenerationNode(node(), [configured])!;
    const refreshed = withWeAiImage25RequestParameters(configured, rawModels);
    const model = refreshed.find(item => item.id === created.data.model)!;
    const patch = canvasModule.modelDiscoveryMigrationPatch("image-generation", created.data, "openai", model);
    expect(patch?.parameters).toBeUndefined();
    expect(canvasModule.normalizeGenerationNodeForRun(created, [configured], { connectionId: configured.id, items: rawModels, authoritative: true }).data.parameters)
      .toMatchObject({ quality: "max", size: "2880x2880", size_tier: "4K" });
  });

  it("keeps an existing custom low-quality 2K selection through discovery and run normalization", () => {
    const configured = connection();
    const existing: CanvasNode = { ...node(), data: { ...node().data, provider: "openai", connectionId: configured.id,
      model: "gpt-image-2.5-flare", qualityMode: "custom", parameters: { quality: "low", size: "2048x2048", size_tier: "2K" } } };
    const model = withWeAiImage25RequestParameters(configured, rawModels)[0]!;
    expect(canvasModule.modelDiscoveryMigrationPatch("image-generation", existing.data, "openai", model)?.parameters).toBeUndefined();
    expect(canvasModule.normalizeGenerationNodeForRun(existing, [configured], { connectionId: configured.id, items: rawModels, authoritative: true }).data)
      .toMatchObject({ model: existing.data.model, connectionId: configured.id, parameters: existing.data.parameters });
  });
});

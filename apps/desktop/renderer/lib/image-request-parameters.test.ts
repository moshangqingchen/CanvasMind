import React from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { imageSizeOptions, type ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "./client-api";
import type { CanvasNode } from "../components/types";
import { withCurrentImageRequestParameters } from "./image-request-parameters";

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

  it("replaces a generic max schema without mutating the cache or its price evidence", () => {
    const snapshot = structuredClone(cached);
    const model = withCurrentImageRequestParameters(connection, [cached])[0]!;
    const quality = model.parameters!.find(parameter => parameter.key === "quality")!;
    expect(quality.default).toBe("high");
    expect(quality.options!.map(option => option.value)).toEqual(["low", "medium", "high"]);
    expect(model.parameters!.find(parameter => parameter.key === "size")!.options).toHaveLength(34);
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

  it("normalizes the run against the contract even when the latest scan has a generic schema", () => {
    const node = source();
    expect(canvasModule.normalizeGenerationNodeForRun(node, [connection], {
      connectionId: connection.id, items: [cached], authoritative: true,
    }).data.parameters).toMatchObject({ quality: "high", size: "2160x3840", size_tier: "4K" });
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

  it("leaves other endpoints and an explicitly denied pDog model untouched", () => {
    const other = { ...connection, config: { ...connection.config, baseUrl: "https://another.invalid/v1" } };
    expect(withCurrentImageRequestParameters(other, [cached])[0]).toBe(cached);
    const denied = { ...cached, metadata: { ...cached.metadata, canvasRunnable: false, canvasUnavailableReason: "403" } };
    expect(withCurrentImageRequestParameters(connection, [denied])[0]).toBe(denied);
  });

  it("keeps Image 2.5 max as a highest candidate without claiming a paid verification", () => {
    const image25 = { ...cached, id: "gpt-image-2.5-flare" };
    const configured = { ...connection, config: { ...connection.config, defaultModel: image25.id, modelCatalogModels: [image25] } };
    const model = withCurrentImageRequestParameters(configured, [image25])[0]!;
    const quality = model.parameters!.find(parameter => parameter.key === "quality")!;
    expect(quality.default).toBe("max");
    expect(quality.options!.some(option => option.value === "max")).toBe(true);
    expect(model.metadata).toMatchObject({ qualitySupport: "assumed", pdogQualityDocumented: false, pdogQualityVerified: false });
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

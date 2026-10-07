import React from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cangyuanMusicModel, type ModelDescriptor } from "@super-canvas/providers";
import type { CanvasNode } from "../components/types";
import type { ProviderConnectionView } from "./client-api";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { discoverSupplierModelInterfaces } from "./supplier-interface-discovery";
import { getAutoConnectionOptions, modelSupportsNodeType } from "./graph-ui";

const model = cangyuanMusicModel({ id: "lyria-3-pro", name: "Lyria 3 Pro", operations: [] });
function connection(models: ModelDescriptor[] = [model]): ProviderConnectionView {
  return { id: "music-fixture", name: "沧元音乐 mock", provider: "rest", apiKeySet: true, apiKeyUsable: true, apiKey: "", config: {
    supplierKey: "cangyuan", preset: "cangyuan-gpt-image-2", usage: "canvas", baseUrl: "https://ai.cangyuansuanli.cn", modelGroup: "全模型", accountKeyGroup: "全模型", defaultModel: model.id,
    modelScanStatus: "live", scannedModelIds: models.map(item => item.id), modelCatalogModels: models,
    connector: { auth: { type: "bearer" }, models, restrictModels: true, submit: { path: "/v1/images/generations", method: "POST", bodyMode: "json" }, output: { path: "$.data", kind: "image" } },
  } };
}
function node(): CanvasNode {
  return { id: "music", type: "workflow", position: { x: 0, y: 0 }, data: { nodeType: "music-generation", label: "音乐生成", provider: "fake", model: "fake-music-v1", parts: [], parameters: {}, inputs: [{ id: "prompt", kind: "text", label: "音乐描述" }], outputs: [{ id: "audio", kind: "audio", label: "音乐" }] } };
}

describe("music canvas integration", () => {
  let canvas: Pick<typeof import("../components/canvas-app"), "configureNewGenerationNode" | "normalizeGenerationNodeForRun">;
  beforeAll(async () => { vi.stubGlobal("React", React); canvas = await import("../components/canvas-app"); });
  afterAll(() => vi.unstubAllGlobals());

  it("selects a live music model and creates only a text input, preserving explicit saved music parameters", () => {
    const configured = canvas.configureNewGenerationNode(node(), [connection()]);
    expect(configured?.data).toMatchObject({ provider: "rest", connectionId: "music-fixture", model: "lyria-3-pro", parameters: { instrumental: false, audio_format: "mp3" } });
    expect(configured?.data.inputs).toEqual([{ id: "prompt", kind: "text", label: "音乐描述", required: false, multiple: false }]);
    const original = { ...configured!, data: { ...configured!.data, parameters: { instrumental: true, title: "晨光", lyrics: "保留在节点中的歌词", duration: 90, bpm: 72, seed: 0, audio_format: "wav" } } };
    expect(canvas.normalizeGenerationNodeForRun(original, [connection()], { connectionId: "music-fixture", items: [model] }).data.parameters).toEqual(original.data.parameters);
    expect(node().data.provider).toBe("fake");
  });

  it("keeps audio outputs and music models out of image/video selectors", () => {
    expect(modelSupportsNodeType(model, "music-generation")).toBe(true);
    expect(modelSupportsNodeType(model, "image-generation")).toBe(false);
    expect(modelSupportsNodeType(model, "video-generation")).toBe(false);
    expect(modelSupportsNodeType({ operations: [], outputKinds: ["audio[]"] }, "music-generation")).toBe(true);
    expect(getAutoConnectionOptions("text").some(option => option.nodeType === "music-generation")).toBe(true);
    expect(getAutoConnectionOptions("audio")).toEqual(expect.arrayContaining([expect.objectContaining({ nodeType: "preview", targetHandle: "audio" })]));
  });

  it("retains the exact native music contract through inventory binding and document discovery", async () => {
    const old = { ...model, parameters: [], metadata: { canvasRunnable: false, autoInterfaceStatus: "incomplete", canvasUnavailableReason: "音乐协议尚未内置", endpointTypes: ["/v1/music"] } };
    const configured = connection([old]);
    const bound = bindScannedModelProtocols(configured, [old]);
    expect(bound.models[0]?.metadata).toMatchObject({ canvasRunnable: true, protocol: "cangyuan-music" });
    const read = vi.fn(async () => []);
    const discovered = await discoverSupplierModelInterfaces(configured, bound.models, configured, read);
    expect(read).not.toHaveBeenCalled();
    expect(discovered.models[0]?.operations).toEqual(["music.generate"]);
    expect(discovered.models[0]?.parameters?.some(parameter => parameter.key === "lyrics")).toBe(true);
    expect(discovered.bindings).toEqual({});
  });

  it.each(["403 权限拒绝", "当前 Key 未返回模型", "401 unauthorized"])("does not restore a denied music model: %s", reason => {
    const blocked = { ...model, metadata: { canvasRunnable: false, autoInterfaceStatus: "incomplete", canvasUnavailableReason: reason } };
    const configured = connection([blocked]);
    expect(bindScannedModelProtocols(configured, [blocked]).models[0]?.metadata).toMatchObject({ canvasRunnable: false, canvasUnavailableReason: reason });
    expect(canvas.configureNewGenerationNode(node(), [configured])).toBeNull();
  });
});

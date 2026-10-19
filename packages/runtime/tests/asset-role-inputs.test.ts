import { describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import type { NormalizedRequest, ProviderAdapter } from "@super-canvas/providers";
import type { ObjectStorage } from "@super-canvas/storage";
import { RunService } from "../src/service.js";
import { validPngBytes } from "./fixtures/image-bytes.js";
import { validWebmBytes } from "./fixtures/video-bytes.js";

class IsolatedService extends RunService {
  constructor(repository: MemoryRepository, storage: ObjectStorage, private readonly adapter: ProviderAdapter) { super({ repository, storage, pollIntervalMs: 0 }); }
  override adapters() { return new Map([["fake", this.adapter]]); }
}

describe("ordered role-bearing input entries", () => {
  it.each([
    { connectedRoles: ["firstFrame"], promptRoles: ["reference"], expectedRoles: ["firstFrame"], expectedPrompt: "Loop [参考素材 1]" },
    { connectedRoles: ["firstFrame", "lastFrame"], promptRoles: ["reference"], expectedRoles: ["firstFrame", "lastFrame"], expectedPrompt: "Loop [参考素材 1]" },
    { connectedRoles: [], promptRoles: ["reference"], expectedRoles: ["reference"], expectedPrompt: "Loop [参考素材 1]" },
    { connectedRoles: ["firstFrame"], promptRoles: ["reference", "lastFrame"], expectedRoles: ["firstFrame", "lastFrame"], expectedPrompt: "Loop [参考素材 1] [参考素材 2]" },
  ])("resolves ordinary mentions to the first connected role: $connectedRoles / $promptRoles", async scenario => {
    const repository = new MemoryRepository(), bytes = new Uint8Array(validPngBytes);
    const get = vi.fn<ObjectStorage["get"]>(async () => ({ bytes, contentType: "image/png" }));
    const storage: ObjectStorage = { get, put: async () => {} };
    await repository.saveAsset({ id: "same-original", name: "Original.png", kind: "image", mimeType: "image/png", size: bytes.length, storageKey: "original.png", metadata: {} });
    await repository.saveCanvas({ id: "canvas", graph: { schemaVersion: 1, nodes: [
      { id: "source", type: "workflow", data: { nodeType: "asset-input", assetId: "same-original", assetKind: "image", outputs: [{ id: "asset", kind: "image" }] } },
      { id: "video", type: "workflow", data: { nodeType: "video-generation", provider: "fake", connectionId: "fake-default",
        parts: [{ type: "text", text: "Loop" }, ...scenario.promptRoles.map(role => ({ type: "asset", assetId: "same-original", role }))],
        inputs: [{ id: "firstFrame", kind: "image" }, { id: "lastFrame", kind: "image" }], outputs: [{ id: "video", kind: "video" }] } },
    ], edges: scenario.connectedRoles.map((role, index) => ({ id: `edge-${index}`, source: "source", sourceHandle: "asset", target: "video", targetHandle: role })) } });
    let submitted: NormalizedRequest | undefined;
    const adapter: ProviderAdapter = { testConnection: async () => {}, listModels: async () => [], validate: async () => ({ valid: true, issues: [] }),
      submit: vi.fn(async request => { submitted = request; return { providerTaskId: "mocked-result", status: "succeeded", result: {} }; }),
      extractOutputs: async () => [{ kind: "video", data: new Uint8Array(validWebmBytes), mimeType: "video/webm", metadata: { fake: true } }],
    };
    const service = new IsolatedService(repository, storage, adapter);
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "ordinary-mention", scope: "node", nodeId: "video" });
    await vi.waitFor(async () => expect((await service.getRun(run.id))?.run.status).toBe("succeeded"), { timeout: 4000 });
    expect(adapter.submit).toHaveBeenCalledOnce(); expect(get).toHaveBeenCalledOnce();
    expect(submitted?.assets?.map(asset => asset.role)).toEqual(scenario.expectedRoles);
    expect(submitted?.prompt).toBe(scenario.expectedPrompt);
    const saved = (await service.getRun(run.id))?.nodes.find(node => node.nodeId === "video");
    expect(saved?.inputJson.inputAssets).toEqual(scenario.expectedRoles.map(role => ({ id: "same-original", name: "Original.png", kind: "image", role })));
  });

  it.each(["connections", "prompt", "both"] as const)("preserves same-ID frame roles from %s while reading one original", async source => {
    const repository = new MemoryRepository(), bytes = new Uint8Array(validPngBytes);
    const get = vi.fn<ObjectStorage["get"]>(async key => key === "original.png" ? { bytes, contentType: "image/png" } : null);
    const storage: ObjectStorage = { get, put: async () => {} };
    await repository.saveAsset({ id: "same-original", name: "Original.png", kind: "image", mimeType: "image/png", size: bytes.length, storageKey: "original.png", metadata: {} });
    const promptParts = source === "connections" ? [] : [
      { type: "asset", assetId: "same-original", role: "firstFrame" },
      { type: "asset", assetId: "same-original", role: "lastFrame" },
      { type: "asset", assetId: "same-original", role: "firstFrame" },
    ];
    const nodes: JsonObject[] = [{ id: "video", type: "workflow", data: { nodeType: "video-generation", provider: "fake", connectionId: "fake-default",
      parts: [{ type: "text", text: "Loop" }, ...promptParts], inputs: [{ id: "firstFrame", kind: "image" }, { id: "lastFrame", kind: "image" }], outputs: [{ id: "video", kind: "video" }] } }];
    if (source !== "prompt") nodes.unshift({ id: "source", type: "workflow", data: { nodeType: "asset-input", assetId: "same-original", assetKind: "image", outputs: [{ id: "asset", kind: "image" }] } });
    await repository.saveCanvas({ id: "canvas", graph: { schemaVersion: 1, nodes, edges: source === "prompt" ? [] : [
      { id: "last", source: "source", sourceHandle: "asset", target: "video", targetHandle: "lastFrame" },
      { id: "first", source: "source", sourceHandle: "asset", target: "video", targetHandle: "firstFrame" },
    ] } });
    let submitted: NormalizedRequest | undefined;
    const adapter: ProviderAdapter = { testConnection: async () => {}, listModels: async () => [], validate: async () => ({ valid: true, issues: [] }),
      submit: vi.fn(async request => { submitted = request; return { providerTaskId: "mocked-result", status: "succeeded", result: {} }; }),
      extractOutputs: async () => [{ kind: "video", data: new Uint8Array(validWebmBytes), mimeType: "video/webm", metadata: { fake: true } }],
    };
    const service = new IsolatedService(repository, storage, adapter);
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "one-run", scope: "node", nodeId: "video" });
    await vi.waitFor(async () => expect((await service.getRun(run.id))?.run.status).toBe("succeeded"), { timeout: 4000 });
    expect(adapter.submit).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
    expect(submitted?.assets?.map(asset => [asset.id, asset.role])).toEqual(source === "prompt"
      ? [["same-original", "firstFrame"], ["same-original", "lastFrame"]]
      : [["same-original", "lastFrame"], ["same-original", "firstFrame"]]);
    expect(submitted?.assets?.[0]?.data).toBe(submitted?.assets?.[1]?.data);
    if (source === "prompt") expect(submitted?.prompt).toBe("Loop [参考素材 1] [参考素材 2] [参考素材 1]");
    if (source === "both") expect(submitted?.prompt).toBe("Loop [参考素材 2] [参考素材 1] [参考素材 2]");
    const node = (await service.getRun(run.id))?.nodes.find(item => item.nodeId === "video");
    expect(node?.inputJson.inputAssets).toEqual(submitted?.assets?.map(asset => ({ id: asset.id, name: asset.filename, kind: asset.kind, role: asset.role })));
    expect(node?.inputJson.assetIds).toEqual(["same-original"]);
  });
});

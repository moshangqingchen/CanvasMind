import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import { FakeProviderAdapter, GenericRestAdapter, cangyuanMusicModel, type NormalizedRequest, type ProviderAdapter, type ProviderConnectionResolver } from "@super-canvas/providers";
import type { ObjectStorage, StoredObject } from "@super-canvas/storage";
import { RunService } from "../src/service.js";
import * as remoteDownloads from "../src/remote-download.js";

class MemoryStorage implements ObjectStorage {
  readonly values = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) { this.values.set(key, { bytes, contentType }); }
  async get(key: string) { return this.values.get(key) ?? null; }
}
class MusicService extends RunService {
  constructor(repository: MemoryRepository, storage: ObjectStorage, private readonly adapter: ProviderAdapter, private readonly providerName = "fake") {
    super({ repository, storage, pollIntervalMs: 0, retryBaseDelayMs: 1 });
  }
  override adapters() { return new Map([[this.providerName, this.adapter]]); }
}
class RestMusicService extends RunService {
  constructor(repository: MemoryRepository, storage: ObjectStorage, private readonly fetcher: typeof fetch) { super({ repository, storage, pollIntervalMs: 0, retryBaseDelayMs: 1 }); }
  override adapters(resolver?: ProviderConnectionResolver) {
    if (!resolver) throw new Error("Expected immutable run resolver");
    return new Map([["rest", new GenericRestAdapter(resolver, { fetch: this.fetcher })]]);
  }
}
const musicConfig = (): JsonObject => ({ baseUrl: "https://ai.cangyuansuanli.cn", supplierKey: "cangyuan", modelCatalogModels: [cangyuanMusicModel({ id: "lyria-3-pro", name: "Lyria", operations: [] })] as unknown as JsonObject[], connector: { auth: { type: "none" }, submit: { path: "/v1/images/generations", method: "POST" }, poll: { path: "/v1/images/{taskId}", method: "GET" }, output: { path: "$.data", kind: "image" } } });
function graph(provider = "fake"): JsonObject {
  return { schemaVersion: 1, nodes: [
    { id: "prompt", type: "workflow", data: { nodeType: "prompt", parts: [{ type: "text", text: "温柔的钢琴与弦乐" }], outputs: [{ id: "prompt", kind: "text" }] } },
    { id: "music", type: "workflow", data: { nodeType: "music-generation", provider, connectionId: provider === "fake" ? "fake-default" : "music-fixture", model: provider === "fake" ? "fake-music-v1" : "lyria-3-pro", parts: [], parameters: { title: "晨光", instrumental: false, lyrics: "[Verse]\n晨光照进窗", duration: 60, audio_format: "wav" }, inputs: [{ id: "prompt", kind: "text", required: true }], outputs: [{ id: "audio", kind: "audio" }] } },
    { id: "preview", type: "workflow", data: { nodeType: "preview", inputs: [{ id: "audio", kind: "audio[]", required: true }] } },
  ], edges: [
    { id: "prompt-music", source: "prompt", sourceHandle: "prompt", target: "music", targetHandle: "prompt" },
    { id: "music-preview", source: "music", sourceHandle: "audio", target: "preview", targetHandle: "audio" },
  ] };
}
async function wait(service: RunService, id: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const snapshot = await service.getRun(id);
    if (snapshot && ["succeeded", "failed", "needs_attention", "cancelled"].includes(snapshot.run.status)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Music run timeout");
}

describe("music workflow runtime", () => {
  afterEach(() => vi.restoreAllMocks());
  it("executes prompt → music → preview and archives a playable WAV without network", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: graph() });
    const adapter = new FakeProviderAdapter(undefined, { pollsBeforeSuccess: 1 });
    const submit = vi.spyOn(adapter, "submit");
    const service = new MusicService(repository, storage, adapter);
    const run = await service.createRun({ canvasId: canvas.id, clientRequestId: "music-all", scope: "all" });
    const result = await wait(service, run.id);
    expect(result.run.status, JSON.stringify(result.nodes.map(node => ({ nodeId: node.nodeId, status: node.status, error: node.errorJson })))).toBe("succeeded");
    expect(result.nodes.map(node => node.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[0]).toMatchObject({ operation: "music.generate", model: "fake-music-v1", prompt: "温柔的钢琴与弦乐", parameters: { title: "晨光", instrumental: false, lyrics: "[Verse]\n晨光照进窗" } });
    const assets = await repository.listAssets();
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ kind: "audio", mimeType: "audio/wav" });
    expect(assets[0]?.storageKey).toMatch(/\.wav$/u);
    expect(Buffer.from((await storage.get(assets[0]!.storageKey))!.bytes).subarray(0, 12).toString()).toMatch(/^RIFF.{4}WAVE$/su);
    expect(result.nodes.find(node => node.nodeId === "preview")?.outputAssetIds).toEqual([assets[0]!.id]);
    expect((await repository.getCanvas(canvas.id))?.graph).toMatchObject({ nodes: expect.arrayContaining([expect.objectContaining({ id: "music", data: expect.objectContaining({ nodeType: "music-generation" }) })]) });
  });

  it.each([["audio/mpeg", "mp3"], ["audio/wav", "wav"], ["audio/mp4", "m4a"]])("resumes an existing %s music task without resubmitting and keeps its format", async (mimeType, extension) => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    const revisionGraph = graph("rest");
    await repository.saveConnection({ id: "music-fixture", name: "Isolated music fixture", provider: "rest", encryptedSecret: null, config: {} });
    const run = await repository.createRun({ id: `recover-${extension}`, canvasId: canvas.id, clientRequestId: `recover-${extension}`, scope: "node", nodeId: "music", status: "running", revisionGraph });
    await repository.createNodeRun({ id: `music-${extension}`, workflowRunId: run.id, nodeId: "music", status: "running", attempt: 1, providerTaskId: "audio_original", inputJson: { provider: "rest", connectionId: "music-fixture", model: "lyria-3-pro", operation: "music.generate", prompt: "保存的音乐描述", parameters: { audio_format: extension }, assetIds: [], providerTask: { providerTaskId: "audio_original", status: "running", connectionId: "music-fixture" } }, outputAssetIds: [], errorJson: null });
    const submit = vi.fn(async (_request: NormalizedRequest) => ({ providerTaskId: "unexpected", status: "succeeded" as const }));
    const poll = vi.fn(async () => ({ providerTaskId: "audio_original", status: "succeeded" as const, result: {} }));
    const adapter: ProviderAdapter = { async testConnection() {}, async listModels() { return []; }, async validate() { return { valid: true, issues: [] }; }, submit, poll,
      async extractOutputs() { return [{ kind: "audio", data: new Uint8Array([1, 2, 3]), mimeType }]; } };
    const service = new MusicService(repository, storage, adapter, "rest");
    await service.resumeRun(run.id);
    const snapshot = await wait(service, run.id);
    expect(snapshot.run.status, JSON.stringify(snapshot.nodes)).toBe("succeeded");
    expect(submit).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledOnce();
    const [asset] = await repository.listAssets();
    expect(asset).toMatchObject({ kind: "audio", mimeType });
    expect(asset?.storageKey).toMatch(new RegExp(`\\.${extension}$`, "u"));
  });

  it("restores a missing REST receipt using the saved music format and frozen host, then downloads the public CDN without credentials", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    const revisionGraph = graph("rest");
    const nodes = revisionGraph.nodes as JsonObject[];
    const data = nodes.find(node => node.id === "music")!.data as JsonObject;
    data.__runtimeConnection = { id: "music-fixture", name: "Original immutable fixture", provider: "rest", encryptedSecret: null, config: musicConfig() };
    // The selected connection was changed after submission; recovery uses the frozen record.
    await repository.saveConnection({ id: "music-fixture", name: "Original immutable fixture", provider: "rest", encryptedSecret: null, config: musicConfig() });
    const run = await repository.createRun({ id: "receipt-lost", canvasId: canvas.id, clientRequestId: "receipt-lost", scope: "node", nodeId: "music", status: "running", revisionGraph });
    await repository.saveConnection({ id: "music-fixture", name: "Changed fixture", provider: "rest", encryptedSecret: null, config: { ...musicConfig(), baseUrl: "https://changed.example.test" } });
    await repository.createNodeRun({ id: "receipt-lost-node", workflowRunId: run.id, nodeId: "music", status: "running", attempt: 1, providerTaskId: "audio_existing", inputJson: { provider: "rest", connectionId: "music-fixture", model: "lyria-3-pro", operation: "music.generate", prompt: "保存的音乐描述", parameters: { audio_format: "m4a" }, assetIds: [] }, outputAssetIds: [], errorJson: null });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "audio_existing", status: "completed", music_url: "https://cdn.example.test/music.m4a" }));
    const download = vi.spyOn(remoteDownloads, "downloadRemoteArtifact").mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]) });
    const service = new RestMusicService(repository, storage, fetcher);
    await service.resumeRun(run.id);
    const result = await wait(service, run.id);
    expect(result.run.status, JSON.stringify(result.nodes.map(node => node.errorJson))).toBe("succeeded");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://ai.cangyuansuanli.cn/v1/music/audio_existing");
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("GET");
    expect(download).toHaveBeenCalledWith("https://cdn.example.test/music.m4a", { maxBytes: expect.any(Number) });
    const [asset] = await repository.listAssets();
    expect(asset).toMatchObject({ kind: "audio", mimeType: "audio/mp4" });
    expect(asset?.storageKey).toMatch(/\.m4a$/u);
    expect(result.nodes[0]?.providerTaskId).toBe("audio_existing");
  });

  it("keeps a missing submit task ID uncertain, preserves the request, and prevents retry/resume from creating another music task", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveConnection({ id: "music-fixture", name: "Isolated mock music", provider: "rest", encryptedSecret: null, config: musicConfig() });
    await repository.saveCanvas({ id: canvas.id, graph: graph("rest") });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "queued", progress: 0 }));
    const service = new RestMusicService(repository, storage, fetcher);
    const run = await service.createRun({ canvasId: canvas.id, clientRequestId: "music-missing-id", scope: "all" });
    const result = await wait(service, run.id);
    expect(result.run.status).toBe("needs_attention");
    const music = result.nodes.find(node => node.nodeId === "music");
    expect(music?.inputJson).toMatchObject({ operation: "music.generate", model: "lyria-3-pro", prompt: "温柔的钢琴与弦乐", parameters: { audio_format: "wav" } });
    expect(music?.errorJson).toMatchObject({ code: "music_submit_missing_id" });
    expect(music?.errorJson?.message).toContain("任务 ID");
    await expect(service.retryRun(run.id)).rejects.toThrow("ID");
    await service.resumeRun(run.id);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await repository.listAssets()).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import type { ProviderAdapter } from "@super-canvas/providers";
import type { ObjectStorage } from "@super-canvas/storage";
import { RunService } from "../src/service.js";
import * as channel from "../src/reference-channel.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("supplier runtime reference delivery", () => {
  it.each([
    { baseUrl: "https://token.secure-skill.com/v1", model: "gpt-image-2.5-flare", modelGroup: undefined },
    { baseUrl: "https://vapi.chuangxiangai.asia", model: "gpt-image-2.5-flare-4k", modelGroup: "生图" },
  ])("passes signed references through the configured channel for $baseUrl before submitting", async ({ baseUrl, model, modelGroup }) => {
    vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
    vi.spyOn(channel, "localReferenceChannelConfigured").mockReturnValue(true);
    vi.spyOn(channel, "localReferenceChannel").mockReturnValue({ enabled: true, ready: true, baseUrl: "https://assets.example.com", instance: "test", updatedAt: Date.now() });
    const urls = vi.spyOn(channel, "localReferenceUrls").mockResolvedValue(["https://assets.example.com/api/provider-assets/ref?token=signed-test"]);
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveConnection({ id: "secure", name: "Secure Skill", provider: "openai", encryptedSecret: null,
      config: { baseUrl, defaultModel: model, ...(modelGroup ? { modelGroup } : {}) } });
    await repository.saveAsset({ id: "ref", name: "Reference", kind: "image", mimeType: "image/png", size: 3, storageKey: "ref.png", metadata: {} });
    await repository.saveCanvas({ id: canvas.id, graph: { schemaVersion: 1, nodes: [{ id: "image", type: "workflow", data: {
      nodeType: "image-generation", provider: "openai", connectionId: "secure", model,
      parts: [{ type: "text", text: "Keep this subject" }, { type: "asset", assetId: "ref", role: "reference" }],
      outputs: [{ id: "image", kind: "image" }],
    } }], edges: [] } });
    const submit = vi.fn<ProviderAdapter["submit"]>(async request => {
      expect(urls).toHaveBeenCalledWith(["ref"]);
      expect(request.operation).toBe("image.edit");
      expect(request.assets?.[0]?.url).toBe("https://assets.example.com/api/provider-assets/ref?token=signed-test");
      return { providerTaskId: "img-one", status: "succeeded" };
    });
    const adapter: ProviderAdapter = { submit, async testConnection() {}, async listModels() { return []; },
      async validate() { return { valid: true, issues: [] }; },
      async extractOutputs() { return [{ kind: "image", data: new Uint8Array([4, 5, 6]), mimeType: "image/png" }]; } };
    class Service extends RunService { override adapters() { return new Map([["openai", adapter]]); } }
    const storage: ObjectStorage = { async get() { return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" }; }, async put() {} };
    const service = new Service({ repository, storage, pollIntervalMs: 0, executionMode: "queue", enqueueRun: async () => {} });
    const run = await service.createRun({ canvasId: canvas.id, clientRequestId: "secure-signed-reference", scope: "all" });
    await service.execute(run.id, new AbortController().signal);
    const snapshot = await service.getRun(run.id);
    expect(snapshot?.run.status, JSON.stringify(snapshot?.nodes.map(node => node.errorJson))).toBe("succeeded");
    expect(submit).toHaveBeenCalledOnce();
    expect(snapshot?.nodes.find(node => node.nodeId === "image")?.inputJson.inputAssets).toEqual([
      { id: "ref", name: "Reference", kind: "image", role: "reference" },
    ]);
  });
});

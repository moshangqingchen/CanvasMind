import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import { createDefaultProviderRegistry, encryptSecret, remainingVideoModel,
  type FetchImplementation, type ProviderAdapter, type ProviderConnectionResolver } from "@super-canvas/providers";
import type { ObjectStorage } from "@super-canvas/storage";
import { RunService, type RuntimeOptions } from "../src/service.js";

const masterKey = "offline-video-parameter-fixture";
class VideoParameterService extends RunService {
  constructor(private readonly fixtureFetch: FetchImplementation, options: RuntimeOptions) { super({ ...options, pollIntervalMs: 0 }); }
  override adapters(resolver?: ProviderConnectionResolver): Map<string, ProviderAdapter> {
    if (!resolver) return new Map();
    const registry = createDefaultProviderRegistry(resolver, { fetch: this.fixtureFetch });
    return new Map([["openai", registry.get("openai")], ["rest", registry.get("rest")]]);
  }
}

describe("saved Jiasu video parameters through the execution runtime", () => {
  let priorMasterKey: string | undefined;
  beforeEach(() => { priorMasterKey = process.env.MASTER_KEY; process.env.MASTER_KEY = masterKey; });
  afterEach(() => { if (priorMasterKey === undefined) delete process.env.MASTER_KEY; else process.env.MASTER_KEY = priorMasterKey; });

  it.each(["openai", "rest"])("rejects outdated duration, resolution and alias choices through %s before HTTP", async provider => {
    for (const { model, parameters } of [
      { model: "sd-2.5-J2", parameters: { duration: 38, resolution: "720p", aspect_ratio: "16:9" } },
      { model: "sd-2.5-J2", parameters: { duration: 5, resolution: "2160p", aspect_ratio: "16:9" } },
      { model: "sd-2.5-J2", parameters: { duration: 5, seconds: 38, resolution: "720p", aspect_ratio: "16:9" } },
      { model: "sd-2.5-J2", parameters: { seconds: 38, resolution: "720p", ratio: "16:9" } },
      { model: "seedance2.5-全参真人", parameters: { duration: 38, resolution: "720p", aspect_ratio: "16:9" } },
      { model: "seedance2.5-全参真人", parameters: { seconds: 38, ratio: "16:9" } },
      { model: "seedance2.5-全参真人", parameters: { duration: 31, ratio: "16:9" } },
      { model: "seedance2.0-满血", parameters: { duration: 16, ratio: "16:9" } },
      { model: "seedance2.0-满血", parameters: { seconds: 0, ratio: "16:9" } },
    ]) {
      const repository = new MemoryRepository();
      const storage: ObjectStorage = { put: async () => { throw Error("Invalid request must not archive"); }, get: async () => null };
      const descriptor = remainingVideoModel("jiasu", model, undefined, { group: "vip" })!;
      await repository.saveConnection({ id: "jiasu", name: "Offline fixture", provider,
        encryptedSecret: encryptSecret("fixture-key", masterKey), config: {
          baseUrl: "https://ai.jiasuapi.com/v1", usage: "canvas", defaultModel: model,
          modelGroup: "vip", accountKeyGroup: "vip", modelScanStatus: "live", scannedModelIds: [model],
          modelCatalogModels: [descriptor],
        } as unknown as JsonObject });
      await repository.saveCanvas({ id: "canvas", title: "Offline video fixture", graph: {
        schemaVersion: 1, nodes: [{ id: "video", type: "workflow", data: { nodeType: "video-generation", provider,
          connectionId: "jiasu", model, parameters, parts: [{ type: "text", text: "Offline parameter validation" }], outputs: [{ id: "video", kind: "video" }] } }], edges: [],
      } });
      const fixtureFetch = vi.fn<FetchImplementation>(async () => { throw Error("No network allowed for invalid video parameters"); });
      const service = new VideoParameterService(fixtureFetch, { repository, storage, executionMode: "inline" });
      const run = await service.createRun({ canvasId: "canvas", clientRequestId: `invalid-${provider}-${JSON.stringify(parameters)}`, scope: "all" });
      await expect.poll(async () => (await service.getRun(run.id))?.run.status, { timeout: 4000 }).toBe("failed");
      expect(fixtureFetch).not.toHaveBeenCalled();
      expect((await repository.getCanvas("canvas"))!.graph.nodes[0]!.data.parameters).toEqual(parameters);
      expect(await repository.listAssets()).toEqual([]);
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import { createDefaultProviderRegistry, encryptSecret, LangframeAdapter, type FetchImplementation, type ModelDescriptor, type ProviderAdapter, type ProviderConnectionResolver } from "@super-canvas/providers";
import type { ObjectStorage, StoredObject } from "@super-canvas/storage";
import { RunService, type RuntimeOptions } from "../src/service.js";
import { validPngBase64 } from "./fixtures/image-bytes.js";

const masterKey = "langframe-runtime-fixture", model = "image-2.5-flare-1K-2k-4kMAX品质", base = "https://vipprompt.cn";
const descriptor: ModelDescriptor = { id: model, name: model, operations: ["image.generate", "image.edit"], outputKinds: ["image"],
  metadata: { langframeCatalog: true, rawParams: { resolutions: ["1K", "2K", "4K"], ratios: ["16:9", "1:1"] } } };
class MemoryStorage implements ObjectStorage {
  private values = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) { this.values.set(key, { bytes: new Uint8Array(bytes), contentType }); }
  async get(key: string) { return this.values.get(key) ?? null; }
}
class FixtureService extends RunService {
  constructor(private readonly fixtureFetch: FetchImplementation, options: RuntimeOptions) { super({ ...options, pollIntervalMs: 0 }); }
  override adapters(resolver?: ProviderConnectionResolver): Map<string, ProviderAdapter> {
    return resolver ? new Map([["langframe", createDefaultProviderRegistry(resolver, { fetch: this.fixtureFetch }).get("langframe")]]) : new Map();
  }
}
async function fixture(parameters: JsonObject) {
  const repository = new MemoryRepository(), storage = new MemoryStorage();
  await repository.saveConnection({ id: "wolf", name: "Wolf fixture", provider: "langframe", encryptedSecret: encryptSecret("frozen-key", masterKey),
    config: { baseUrl: `${base}/v1`, usage: "canvas", defaultModel: model, modelScanStatus: "live", scannedModelIds: [model], modelCatalogModels: [descriptor] } as unknown as JsonObject });
  await repository.saveCanvas({ id: "canvas", title: "Wolf fixture", graph: { schemaVersion: 1, nodes: [{ id: "image", type: "workflow", data: {
    nodeType: "image-generation", provider: "langframe", connectionId: "wolf", model, parts: [{ type: "text", text: "16:9 original preferences" }], parameters, outputs: [{ id: "image", kind: "image" }],
  } }], edges: [] } });
  return { repository, storage };
}
afterEach(() => { vi.unstubAllEnvs(); });

describe("Langframe through the actual execution runtime", () => {
  it("registers the adapter in RunService's hand-built map", () => {
    const service = new RunService({ repository: new MemoryRepository(), storage: new MemoryStorage() });
    expect(service.adapters().get("langframe")).toBeInstanceOf(LangframeAdapter);
  });
  it("keeps independent tier/size/quality parameters and archives the original synchronous image bytes", async () => {
    vi.stubEnv("MASTER_KEY", masterKey);
    const parameters = { resolution: "4K", aspect_ratio: "16:9", quality: "max", n: 1 };
    const f = await fixture(parameters), fetcher = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ b64_json: validPngBase64 }] }));
    const service = new FixtureService(fetcher, { ...f, executionMode: "inline" });
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "tier-without-fake-pixels", scope: "all" });
    await expect.poll(async () => (await service.getRun(run.id))?.run.status).toBe("succeeded");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model, prompt: "16:9 original preferences", ...parameters });
    expect((await f.repository.getCanvas("canvas"))?.graph.nodes[0]?.data.parameters).toEqual(parameters);
    const assets = await f.repository.listAssets();
    expect(assets).toHaveLength(1);
    expect(Buffer.from((await f.storage.get(assets[0]!.storageKey))!.bytes)).toEqual(Buffer.from(validPngBase64, "base64"));
  });
  it("restores a stored task ID without a full task envelope using its frozen original connection and GET only", async () => {
    vi.stubEnv("MASTER_KEY", masterKey);
    const f = await fixture({ resolution: "4K", quality: "max" });
    const queue = new FixtureService(async () => { throw new Error("queue may not contact a provider"); }, { ...f, executionMode: "queue", enqueueRun: async () => {} });
    const run = await queue.createRun({ canvasId: "canvas", clientRequestId: "resume-exact-original", scope: "all" });
    const [node] = await f.repository.listNodeRuns(run.id);
    await f.repository.updateNodeRun(node!.id, { status: "running", providerTaskId: "original-task", inputJson: { provider: "langframe", connectionId: "wolf", model, operation: "image.generate", parameters: { resolution: "4K", quality: "max" }, prompt: "frozen original prompt", assetIds: [] } });
    await f.repository.updateRun(run.id, { status: "running" });
    await f.repository.saveConnection({ id: "wolf", name: "Changed fixture", provider: "langframe", encryptedSecret: encryptSecret("changed-key", masterKey), config: { baseUrl: "https://changed.invalid/v1" } });
    const fetcher = vi.fn<FetchImplementation>(async () => Response.json({ task: { status: "succeeded", images: [{ b64_json: validPngBase64 }] } }));
    const service = new FixtureService(fetcher, { ...f, executionMode: "inline" });
    await service.resumeRun(run.id);
    await expect.poll(async () => (await service.getRun(run.id))?.run.status).toBe("succeeded");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`${base}/v1/images/tasks/original-task`);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("GET");
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer frozen-key");
    expect((await service.getRun(run.id))?.nodes[0]?.providerTaskId).toBe("original-task");
  });
});

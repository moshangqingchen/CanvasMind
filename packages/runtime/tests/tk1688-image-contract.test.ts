import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import { createDefaultProviderRegistry, encryptSecret, parseTk1688Marketplace,
  type FetchImplementation, type ProviderAdapter, type ProviderConnectionResolver } from "@super-canvas/providers";
import type { ObjectStorage, StoredObject } from "@super-canvas/storage";
import { RunService, type RuntimeOptions } from "../src/service.js";
import { validPngBase64 } from "./fixtures/image-bytes.js";

const model = "gpt-image-2.5-sunburst@s1c23";
const masterKey = "tk1688-runtime-fixture-master";
class MemoryStorage implements ObjectStorage {
  private readonly values = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) { this.values.set(key, { bytes, contentType }); }
  async get(key: string) { return this.values.get(key) ?? null; }
}
class TkRunService extends RunService {
  constructor(private readonly fixtureFetch: FetchImplementation, options: RuntimeOptions) { super(options); }
  override adapters(resolver?: ProviderConnectionResolver): Map<string, ProviderAdapter> {
    return resolver ? new Map([["openai", createDefaultProviderRegistry(resolver, { fetch: this.fixtureFetch }).get("openai")]]) : new Map();
  }
}
async function fixture(parameters: JsonObject) {
  const repository = new MemoryRepository(), storage = new MemoryStorage();
  const models = parseTk1688Marketplace({ success: true, data: { total: 1, items: [{ base_model: "gpt-image-2.5-sunburst", alias: model,
    status: "active", charge_type: "per_request", description: "支持1K/2K/4K" }] } }).models;
  await repository.saveConnection({ id: "tk", name: "exact merchant", provider: "openai", encryptedSecret: encryptSecret("mock-key", masterKey), config: {
    baseUrl: "https://api.tk1688.com/v1", modelGroup: "default", defaultModel: model, modelCatalogModels: models as unknown as JsonObject[],
  } });
  await repository.saveCanvas({ id: "canvas", title: "saved Tk parameters", graph: { schemaVersion: 1, nodes: [{ id: "image", type: "workflow", data: {
    nodeType: "image-generation", provider: "openai", connectionId: "tk", model, parts: [{ type: "text", text: "画一张16:9横图" }], parameters,
    outputs: [{ id: "image", kind: "image" }],
  } }], edges: [] } });
  const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ b64_json: validPngBase64 }] }));
  return { repository, storage, fetch };
}
describe("Tk1688 actual runtime preserves independent size and merchant preferences", () => {
  let prior: string | undefined;
  beforeEach(() => { prior = process.env.MASTER_KEY; process.env.MASTER_KEY = masterKey; });
  afterEach(() => { if (prior === undefined) delete process.env.MASTER_KEY; else process.env.MASTER_KEY = prior; });
  it("sends explicit W/H unchanged despite a different prompt ratio and higher tier", async () => {
    const parameters = { resolution: "4K", size: "5000x4000", aspect_ratio: "5:4", quality: "high" };
    const f = await fixture(parameters);
    const service = new TkRunService(f.fetch, { ...f, executionMode: "inline" });
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "explicit-size", scope: "all" });
    await expect.poll(async () => (await service.getRun(run.id))?.run.status, { timeout: 4000 }).toBe("succeeded");
    expect(JSON.parse(String(f.fetch.mock.calls[0]?.[1]?.body))).toEqual({ model, prompt: "画一张16:9横图", size: "5000x4000", quality: "high" });
    expect((await f.repository.getCanvas("canvas"))?.graph.nodes[0]?.data.parameters).toEqual(parameters);
    expect(f.fetch).toHaveBeenCalledOnce();
  });
  it.each([{ resolution: "4K", aspect_ratio: "5:4", size: "auto" }, { resolution: "2K", aspect_ratio: "3:2", size: "auto" }])(
    "resolves the selected merchant tier and ratio into the user preset for %j", async parameters => {
      const f = await fixture(parameters), service = new TkRunService(f.fetch, { ...f, executionMode: "inline" });
      const run = await service.createRun({ canvasId: "canvas", clientRequestId: JSON.stringify(parameters), scope: "all" });
      await expect.poll(async () => (await service.getRun(run.id))?.run.status, { timeout: 4000 }).toBe("succeeded");
      expect(f.fetch).toHaveBeenCalledOnce();
      expect(JSON.parse(String(f.fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ size: parameters.resolution === "4K" ? "3216x2576" : "2496x1680" });
      expect((await f.repository.getCanvas("canvas"))?.graph.nodes[0]?.data.parameters).toEqual(parameters);
    },
  );
  it("uses the actual studio default map without replacing a saved ratio from the prompt", async () => {
    const parameters = { resolution: "auto", size: "auto", aspect_ratio: "3:2", quality: "high" };
    const f = await fixture(parameters), service = new TkRunService(f.fetch, { ...f, executionMode: "inline" });
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "default-source-map", scope: "all" });
    await expect.poll(async () => (await service.getRun(run.id))?.run.status, { timeout: 4000 }).toBe("succeeded");
    expect(JSON.parse(String(f.fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ size: "1536x1024" });
    expect((await f.repository.getCanvas("canvas"))?.graph.nodes[0]?.data.parameters).toEqual(parameters);
  });
});

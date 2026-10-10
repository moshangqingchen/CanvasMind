import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import { applyJiasuImageCapabilities, createDefaultProviderRegistry, encryptSecret, JIASU_IMAGE_MODELS, JIASU_RESOLUTION_IMAGE_MODELS,
  jiasuImageConnector, jiasuImageSizes, type FetchImplementation, type ProviderAdapter, type ProviderConnectionResolver } from "@super-canvas/providers";
import type { ObjectStorage, StoredObject } from "@super-canvas/storage";
import { RunService, type RuntimeOptions } from "../src/service.js";
import { validPngBase64 } from "./fixtures/image-bytes.js";

const baseUrl = "https://ai.jiasuapi.com/v1";
const masterKey = "jiasu-runtime-fixture-master";
const png = validPngBase64;
class MemoryStorage implements ObjectStorage {
  private values = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) { this.values.set(key, { bytes, contentType }); }
  async get(key: string) { return this.values.get(key) ?? null; }
}
class JiasuRunService extends RunService {
  constructor(private readonly fixtureFetch: FetchImplementation, options: RuntimeOptions) { super({ ...options, pollIntervalMs: 0 }); }
  override adapters(resolver?: ProviderConnectionResolver): Map<string, ProviderAdapter> {
    if (!resolver) return new Map();
    const registry = createDefaultProviderRegistry(resolver, { fetch: this.fixtureFetch });
    return new Map([["openai", registry.get("openai")], ["rest", registry.get("rest")]]);
  }
}
async function fixture(model: string, parameters: JsonObject, provider = "openai") {
  const repository = new MemoryRepository();
  const storage = new MemoryStorage();
  const config = { baseUrl, usage: "canvas", defaultModel: model, modelGroup: "vip", accountKeyGroup: "vip", modelScanStatus: "live", scannedModelIds: [model] };
  const descriptor = applyJiasuImageCapabilities({ provider, config }, { id: model, name: model, operations: ["image.generate", "image.edit"] });
  await repository.saveConnection({ id: "jiasu", name: "Jiasu fixture", provider, encryptedSecret: encryptSecret("original-fixture-key", masterKey), config: { ...config, modelCatalogModels: [descriptor] } as JsonObject });
  await repository.saveCanvas({ id: "canvas", title: "Jiasu fixture", graph: { schemaVersion: 1, nodes: [{ id: "image", type: "workflow", data: {
    nodeType: "image-generation", provider, connectionId: "jiasu", model, parts: [{ type: "text", text: "16:9 landscape fixture" }], parameters,
    outputs: [{ id: "image", kind: "image" }],
  } }], edges: [] } });
  return { repository, storage };
}
const completedFetch = () => vi.fn<FetchImplementation>(async (_url, init) => init?.method === "POST"
  ? Response.json({ id: "image_original", status: "queued" })
  : Response.json({ id: "image_original", object: "image", status: "completed", progress: 100, result_urls: [`data:image/png;base64,${png}`] }));
async function finished(service: RunService, id: string, status: "succeeded" | "failed") {
  await expect.poll(async () => (await service.getRun(id))?.run.status, { timeout: 4000 }).toBe(status);
  return (await service.getRun(id))!;
}
describe("Jiasu exact image contracts through the execution runtime", () => {
  let priorMasterKey: string | undefined;
  beforeEach(() => { priorMasterKey = process.env.MASTER_KEY; process.env.MASTER_KEY = masterKey; });
  afterEach(() => { if (priorMasterKey === undefined) delete process.env.MASTER_KEY; else process.env.MASTER_KEY = priorMasterKey; });

  it.each(JIASU_IMAGE_MODELS)("keeps %s native fields unchanged and archives the original returned bytes", async model => {
    const resolution = JIASU_RESOLUTION_IMAGE_MODELS.includes(model);
    const parameters = resolution ? { resolution: "1K", ratio: "9:16", quality: "auto" } : { size: jiasuImageSizes(model)[2]!, quality: model === "gpt-image-2-high" ? "high" : "medium" };
    const f = await fixture(model, parameters);
    const fetch = completedFetch();
    const service = new JiasuRunService(fetch, { ...f, executionMode: "inline" });
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: `native-${model}`, scope: "all" });
    const snapshot = await finished(service, run.id, "succeeded");
    expect(snapshot.nodes[0]?.inputJson.parameters).toEqual(parameters);
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(body).toEqual({ model, prompt: "16:9 landscape fixture", n: 1, ...(resolution ? { resolution: "1K", ratio: "9:16" } : parameters) });
    expect(fetch.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([[`${baseUrl}/images/create`, "POST"], [`${baseUrl}/images/tasks/image_original`, "GET"]]);
    const assets = await f.repository.listAssets();
    expect(assets).toHaveLength(1);
    expect(Buffer.from((await f.storage.get(assets[0]!.storageKey))!.bytes)).toEqual(Buffer.from(png, "base64"));
  });
  it.each([
    { model: "gpt-image-2-1k", parameters: { size: "1024x1024", quality: "medium", size_tier: "4K" }, provider: "openai" },
    { model: "gpt-image-2.5-1k", parameters: { resolution: "1K", ratio: "1:1", size_tier: "4K" }, provider: "openai" },
    { model: "gpt-image-2.5-1k", parameters: { resolution: "1K", ratio: "1:1", aspect_ratio: "9:16" }, provider: "openai" },
    { model: "gpt-image-2.5-1k", parameters: { image_size: "4K" }, provider: "openai" },
    { model: "gpt-image-2-1k", parameters: { size: "1024x1024", n: 2 }, provider: "rest" },
    { model: "gpt-image-2-1k", parameters: { size: "1024x1024", width: 2048 }, provider: "openai" },
  ])("rejects saved conflicting/unsupported $parameters through $provider before any HTTP request", async example => {
    const f = await fixture(example.model, example.parameters, example.provider);
    const fetch = completedFetch();
    const service = new JiasuRunService(fetch, { ...f, executionMode: "inline" });
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "reject-conflict", scope: "all" });
    await finished(service, run.id, "failed");
    expect(fetch).not.toHaveBeenCalled();
    const saved = await f.repository.getCanvas("canvas");
    expect((saved!.graph.nodes[0]!.data as JsonObject).parameters).toEqual(example.parameters);
  });
  it("preserves native auto sizing without inferring pixels or ratio from the prompt", async () => {
    const f = await fixture("gpt-image-2-4k", { size: "auto", quality: "auto" });
    const fetch = completedFetch();
    const service = new JiasuRunService(fetch, { ...f, executionMode: "inline" });
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "auto-sizing", scope: "all" });
    const snapshot = await finished(service, run.id, "succeeded");
    expect(snapshot.nodes[0]?.inputJson.parameters).toEqual({ size: "auto", quality: "auto" });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ model: "gpt-image-2-4k", prompt: "16:9 landscape fixture", n: 1 });
  });
  it("resumes an old serialized task with its frozen source/Key and archives flat results using only GET", async () => {
    const model = "gpt-image-2.5-1k";
    const f = await fixture(model, { resolution: "1K", ratio: "1:1" });
    const queue = new JiasuRunService(async () => { throw new Error("queue must not fetch"); }, { ...f, executionMode: "queue", enqueueRun: async () => {} });
    const run = await queue.createRun({ canvasId: "canvas", clientRequestId: "resume-original", scope: "all" });
    const config = jiasuImageConnector(model);
    config.poll!.response = { statusPath: "$.data.status" };
    config.output = { path: "$.data.result_url", kind: "image", urlPath: "$.url" };
    const savedTask = { id: "local-retained", providerTaskId: "image_original", status: "running", result: { connectionId: "jiasu", model, baseUrl, config,
      taskId: "image_original", jiasuImage: true, autoInterface: true, remote: { id: "image_original", status: "queued" } } };
    const [node] = await f.repository.listNodeRuns(run.id);
    await f.repository.updateNodeRun(node!.id, { status: "running", providerTaskId: "image_original", inputJson: { providerTask: JSON.parse(JSON.stringify(savedTask)) } });
    await f.repository.updateRun(run.id, { status: "running" });
    await f.repository.saveConnection({ id: "jiasu", name: "Changed fixture", provider: "openai", encryptedSecret: encryptSecret("changed-key", masterKey),
      config: { baseUrl: "https://changed.example/custom", modelGroup: "changed" } });
    const fetch = completedFetch();
    const service = new JiasuRunService(fetch, { ...f, executionMode: "inline" });
    await service.resumeRun(run.id);
    const snapshot = await finished(service, run.id, "succeeded");
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]![0])).toBe(`${baseUrl}/images/tasks/image_original`);
    expect(fetch.mock.calls[0]![1]?.method).toBe("GET");
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get("authorization")).toBe("Bearer original-fixture-key");
    expect(snapshot.nodes[0]?.providerTaskId).toBe("image_original");
  });
});

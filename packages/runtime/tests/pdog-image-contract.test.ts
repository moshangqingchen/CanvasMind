import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import { createDefaultProviderRegistry, encryptSecret, imageSizeOptions, StaticConnectionResolver,
  type FetchImplementation, type ProviderAdapter, type ProviderConnectionResolver } from "@super-canvas/providers";
import type { ObjectStorage, StoredObject } from "@super-canvas/storage";
import { RunService, type RuntimeOptions } from "../src/service.js";

const model = "gpt-image-2.5-sunburst";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKcAAAAASUVORK5CYII=";
const fixtureMasterKey = "pdog-runtime-fixture-master";
class MemoryStorage implements ObjectStorage {
  private values = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) { this.values.set(key, { bytes, contentType }); }
  async get(key: string) { return this.values.get(key) ?? null; }
}
class PdogRunService extends RunService {
  constructor(private readonly fixtureFetch: FetchImplementation, options: RuntimeOptions) { super({ ...options, pollIntervalMs: 0 }); }
  override adapters(resolver?: ProviderConnectionResolver): Map<string, ProviderAdapter> {
    if (!resolver) return new Map();
    return new Map([["openai", createDefaultProviderRegistry(resolver, { fetch: this.fixtureFetch }).get("openai")]]);
  }
}
const originalConfig = { baseUrl: "https://ai.whyshy.cn", modelGroup: "生图原生2K4K", defaultModel: model, scannedModelIds: [model],
  // Reproduce an old scan cache whose generic 2K pixels disagree with PDog's table.
  modelCatalogModels: [{ id: model, name: model, operations: ["image.generate", "image.edit"], parameters: [{ key: "size", control: "select", options: imageSizeOptions(["1K", "2K", "4K"]) },
    { key: "quality", control: "select", default: "max", options: [{ value: "max", label: "max" }] }], metadata: { canvasRunnable: true } }] };
async function fixture(parameters: JsonObject, prompt = "生成 16:9 横图") {
  const repository = new MemoryRepository();
  const storage = new MemoryStorage();
  await repository.saveConnection({ id: "pdog", name: "PDog fixture", provider: "openai", encryptedSecret: encryptSecret("original-fixture-key", fixtureMasterKey), config: originalConfig });
  await repository.saveCanvas({ id: "canvas", title: "PDog", graph: { schemaVersion: 1, nodes: [{ id: "image", type: "workflow", data: {
    nodeType: "image-generation", provider: "openai", connectionId: "pdog", model, parts: [{ type: "text", text: prompt }], parameters,
    outputs: [{ id: "image", kind: "image" }],
  } }], edges: [] } });
  return { repository, storage };
}
async function completed(service: RunService, id: string) {
  await expect.poll(async () => (await service.getRun(id))?.run.status, { timeout: 4000 }).toBe("succeeded");
  return (await service.getRun(id))!;
}

describe("PDog actual runtime contracts", () => {
  let priorMasterKey: string | undefined;
  beforeEach(() => { priorMasterKey = process.env.MASTER_KEY; process.env.MASTER_KEY = fixtureMasterKey; });
  afterEach(() => { if (priorMasterKey === undefined) delete process.env.MASTER_KEY; else process.env.MASTER_KEY = priorMasterKey; });

  it.each([
    { tier: "2K", ratio: "auto", expected: "2048x1152" },
    { tier: "2K", ratio: "9:16", expected: "1152x2048" },
    { tier: "4K", ratio: "auto", expected: "3840x2160" },
  ])("sends documented $tier pixels with a stale scan cache and ratio=$ratio", async ({ tier, ratio, expected }) => {
    const f = await fixture({ size: "auto", size_tier: tier, aspect_ratio: ratio, quality: "max" });
    const fetch = vi.fn<FetchImplementation>(async (_url, init) => init?.method === "POST"
      ? Response.json({ task_id: "imgtask_runtime", status: "processing" }, { status: 202 })
      : Response.json({ task_id: "imgtask_runtime", status: "completed", result: { data: [{ b64_json: png }] } }));
    const service = new PdogRunService(fetch, { ...f, executionMode: "inline" });
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: `pixels-${tier}-${ratio}`, scope: "all" });
    const snapshot = await completed(service, run.id);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({ model, size: expected, quality: "max", n: 1 });
    expect(snapshot.nodes[0]?.inputJson.parameters).toMatchObject({ size: expected });
    expect(fetch.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["https://ai.whyshy.cn/v1/images/generations/async", "POST"], ["https://ai.whyshy.cn/v1/images/tasks/imgtask_runtime", "GET"],
    ]);
  });

  it("resumes a serialized async task with the original frozen Key and connection using only GET", async () => {
    const f = await fixture({ size: "auto", size_tier: "2K", quality: "max" });
    const queue = new PdogRunService(async () => { throw new Error("queue must not fetch"); }, { ...f, executionMode: "queue", enqueueRun: async () => {} });
    const run = await queue.createRun({ canvasId: "canvas", clientRequestId: "freeze-task", scope: "all" });
    const initialFetch = vi.fn<FetchImplementation>(async () => Response.json({ task_id: "imgtask_saved", status: "processing" }, { status: 202 }));
    const initialAdapter = createDefaultProviderRegistry(new StaticConnectionResolver([{ id: "pdog", provider: "openai", baseUrl: originalConfig.baseUrl, apiKey: "original-fixture-key", settings: originalConfig }]), { fetch: initialFetch }).get("openai");
    const savedTask = await initialAdapter.submit({ connectionId: "pdog", model, operation: "image.generate", prompt: "fixture", parameters: { size: "2048x1152", quality: "max" }, idempotencyKey: "original-paid-request" });
    const [node] = await f.repository.listNodeRuns(run.id);
    await f.repository.updateNodeRun(node!.id, { status: "running", providerTaskId: savedTask.providerTaskId, inputJson: { providerTask: JSON.parse(JSON.stringify(savedTask)) } });
    await f.repository.updateRun(run.id, { status: "running" });
    await f.repository.saveConnection({ id: "pdog", name: "Changed connection", provider: "openai", encryptedSecret: encryptSecret("changed-fixture-key", fixtureMasterKey), config: { ...originalConfig, baseUrl: "https://changed.example/custom", pdogImageMode: "sync" } });
    const resumedFetch = vi.fn<FetchImplementation>(async () => Response.json({ task_id: "imgtask_saved", status: "completed", result: { data: [{ b64_json: png }] } }));
    const resumed = new PdogRunService(resumedFetch, { ...f, executionMode: "inline" });
    await resumed.resumeRun(run.id);
    const snapshot = await completed(resumed, run.id);
    expect(initialFetch).toHaveBeenCalledOnce();
    expect(resumedFetch).toHaveBeenCalledOnce();
    expect(resumedFetch.mock.calls[0]![0]).toBe("https://ai.whyshy.cn/v1/images/tasks/imgtask_saved");
    expect(resumedFetch.mock.calls[0]![1]?.method).toBe("GET");
    expect(new Headers(resumedFetch.mock.calls[0]![1]?.headers).get("authorization")).toBe("Bearer original-fixture-key");
    expect(snapshot.nodes[0]?.providerTaskId).toBe("imgtask_saved");
  });
});

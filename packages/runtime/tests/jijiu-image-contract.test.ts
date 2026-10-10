import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import { createDefaultProviderRegistry, encryptSecret, type FetchImplementation, type ProviderAdapter, type ProviderConnectionResolver } from "@super-canvas/providers";
import type { ObjectStorage, StoredObject } from "@super-canvas/storage";
import { RunService, type RuntimeOptions } from "../src/service.js";
import { validPngBase64 } from "./fixtures/image-bytes.js";

const baseUrl = "https://newapi.jijiucanvas.com/v1";
const masterKey = "jijiu-runtime-fixture-master";
const highTier = "gpt-image-2-2K/4K";
class MemoryStorage implements ObjectStorage {
  private values = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) { this.values.set(key, { bytes, contentType }); }
  async get(key: string) { return this.values.get(key) ?? null; }
}
class JijiuRunService extends RunService {
  constructor(private readonly fixtureFetch: FetchImplementation, options: RuntimeOptions) { super({ ...options, pollIntervalMs: 0 }); }
  override adapters(resolver?: ProviderConnectionResolver): Map<string, ProviderAdapter> {
    if (!resolver) return new Map();
    const registry = createDefaultProviderRegistry(resolver, { fetch: this.fixtureFetch });
    return new Map([["openai", registry.get("openai")], ["rest", registry.get("rest")]]);
  }
}
async function fixture(model: string, parameters: JsonObject, options: { provider?: "openai" | "rest"; binding?: "missing-fields" | "auto-only" } = {}) {
  const repository = new MemoryRepository(), storage = new MemoryStorage();
  const provider = options.provider ?? "openai";
  const group = model.startsWith("gemini") ? "图片-香蕉Pro1K/2K/4K" : model === highTier ? "图片-GPT-image-2-2K/4K" : "图片-GPT-image-2/2.5-1K";
  const autoModelInterfaces = options.binding ? { [model]: {
    sourceUrl: "https://newapi.jijiucanvas.com/docs/api-docs.md",
    model: { id: model, name: model, operations: ["image.generate"], outputKinds: ["image"],
      parameters: options.binding === "auto-only" ? [
        { key: "size", label: "尺寸", control: "select", valueType: "string", options: [{ value: "auto", label: "自动" }] },
        { key: "quality", label: "质量", control: "select", valueType: "string", options: [{ value: "auto", label: "自动" }] },
      ] : [], metadata: { source: "supplier-documentation" } },
    connector: { auth: { type: "bearer" }, submit: { path: "/v1/images/generations", method: "POST", bodyMode: "json", template: { model },
      mappings: [{ target: "/prompt", source: { kind: "request", path: "$.prompt" } },
        ...(options.binding === "auto-only" ? [
          { target: "/size", source: { kind: "request", path: "$.parameters.size" } },
          { target: "/quality", source: { kind: "request", path: "$.parameters.quality" } },
        ] : [])] }, output: { path: "$.data[*]", kind: "image", base64Path: "$.b64_json", defaultMimeType: "image/png" } },
  } } : undefined;
  // Deliberately retain the 0.2.85 cached contract. Execution must apply the
  // current exact supplier contract without creating a new Key or scanning.
  await repository.saveConnection({ id: "jijiu", name: "Offline Jijiu fixture", provider,
    encryptedSecret: encryptSecret("fixture-only", masterKey), config: {
      baseUrl, usage: "canvas", defaultModel: model, modelGroup: group, accountKeyGroup: group,
      modelScanStatus: "live", modelScanComplete: true, scannedModelIds: [model],
      ...(autoModelInterfaces ? { autoModelInterfaces } : {}),
      modelCatalogModels: [{ id: model, name: model, operations: ["image.generate", "image.edit"], outputKinds: ["image"],
        parameters: [{ key: "size", label: "输出尺寸", control: "select", valueType: "string", options: [{ value: "auto", label: "自动" }] }],
        metadata: { jijiuImageContract: true, imageNativeParameterContract: true, imageRequestResolutions: [], imagePixelBudgetPublished: false } }],
    } as JsonObject });
  await repository.saveCanvas({ id: "canvas", title: "Offline Jijiu fixture", graph: { schemaVersion: 1, nodes: [{ id: "image", type: "workflow", data: {
    nodeType: "image-generation", provider, connectionId: "jijiu", model,
    parts: [{ type: "text", text: "16:9 landscape fixture" }], parameters, outputs: [{ id: "image", kind: "image" }],
  } }], edges: [] } });
  const fetch = vi.fn<FetchImplementation>(async (url, init) => {
    if (init?.method !== "POST" || ![`${baseUrl}/images/generations`, `https://newapi.jijiucanvas.com/v1beta/models/${model}:generateContent`].includes(String(url)))
      throw new Error("Unexpected request in offline Jijiu runtime fixture");
    return Response.json(model.startsWith("gemini")
      ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: validPngBase64 } }] } }] }
      : { data: [{ b64_json: validPngBase64 }] });
  });
  const service = new JijiuRunService(fetch, { repository, storage, executionMode: "inline" });
  return { repository, storage, fetch, service };
}
async function finished(f: Awaited<ReturnType<typeof fixture>>, status: "succeeded" | "failed") {
  const run = await f.service.createRun({ canvasId: "canvas", clientRequestId: "offline-jijiu", scope: "all" });
  await expect.poll(async () => (await f.service.getRun(run.id))?.run.status, { timeout: 4000 }).toBe(status);
  return (await f.service.getRun(run.id))!;
}

describe("Jijiu image parameters through the execution runtime (no network)", () => {
  let previousMasterKey: string | undefined;
  const forbiddenNetwork = vi.fn(async () => { throw new Error("Real network forbidden in runtime regression"); });
  beforeEach(() => { previousMasterKey = process.env.MASTER_KEY; process.env.MASTER_KEY = masterKey; forbiddenNetwork.mockClear(); vi.stubGlobal("fetch", forbiddenNetwork); });
  afterEach(() => {
    try { expect(forbiddenNetwork).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); if (previousMasterKey === undefined) delete process.env.MASTER_KEY; else process.env.MASTER_KEY = previousMasterKey; }
  });

  it.each(["2K", "4K"])("preserves requested %s and high quality through an older cached contract", async size => {
    const parameters = { size, quality: "high" }, f = await fixture(highTier, parameters);
    const result = await finished(f, "succeeded");
    expect(result.nodes[0]?.inputJson.parameters).toEqual(parameters);
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model: highTier, prompt: "16:9 landscape fixture", n: 1, size, quality: "high" });
    const [asset] = await f.repository.listAssets();
    expect(Buffer.from((await f.storage.get(asset!.storageKey))!.bytes)).toEqual(Buffer.from(validPngBase64, "base64"));
    expect(((await f.repository.getCanvas("canvas"))!.graph.nodes[0]!.data as JsonObject).parameters).toEqual(parameters);
  });
  it.each(["resolution", "image_size", "imageSize", "size_tier"])("keeps saved %s until the exact adapter maps it to native size", async key => {
    const parameters = { [key]: "4K", quality: "high" }, f = await fixture(highTier, parameters);
    const result = await finished(f, "succeeded");
    expect(result.nodes[0]?.inputJson.parameters).toEqual(parameters);
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model: highTier, prompt: "16:9 landscape fixture", n: 1, size: "4K", quality: "high" });
  });
  const oldBindings = (["openai", "rest"] as const).flatMap(provider =>
    (["missing-fields", "auto-only"] as const).map(binding => ({ provider, binding })));
  it.each(oldBindings.flatMap(example => ["2K", "4K"].map(size => ({ ...example, size }))))(
    "routes $provider $binding old autoModelInterfaces through native $size/high and archives original PNG", async ({ provider, binding, size }) => {
      const parameters = { size, quality: "high" }, f = await fixture(highTier, parameters, { provider, binding });
      const savedConnection = await f.repository.getConnection("jijiu");
      const result = await finished(f, "succeeded");
      expect(result.nodes[0]?.inputJson.parameters).toEqual(parameters);
      expect(f.fetch).toHaveBeenCalledOnce();
      expect(String(f.fetch.mock.calls[0]![0])).toBe(`${baseUrl}/images/generations`);
      expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model: highTier, prompt: "16:9 landscape fixture", n: 1, size, quality: "high" });
      const assets = await f.repository.listAssets();
      expect(assets).toHaveLength(1);
      expect(Buffer.from((await f.storage.get(assets[0]!.storageKey))!.bytes)).toEqual(Buffer.from(validPngBase64, "base64"));
      expect(((await f.repository.getCanvas("canvas"))!.graph.nodes[0]!.data as JsonObject).parameters).toEqual(parameters);
      expect(await f.repository.getConnection("jijiu")).toEqual(savedConnection);
    });
  it.each(oldBindings)("keeps native validation ahead of $provider $binding legacy mapping", async options => {
    const parameters = { size: "4K", quality: "max" }, f = await fixture(highTier, parameters, options);
    await finished(f, "failed");
    expect(f.fetch).not.toHaveBeenCalled();
    expect(((await f.repository.getCanvas("canvas"))!.graph.nodes[0]!.data as JsonObject).parameters).toEqual(parameters);
  });
  it.each(["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-sunburst", highTier,
    "gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-nano-banana-2.1"])("retains %s native auto/tier without inventing pixels or prompt ratios", async model => {
    const gemini = model.startsWith("gemini"), parameters = gemini ? { image_size: "2K", aspect_ratio: "auto" } : { size: "auto" };
    const f = await fixture(model, parameters), result = await finished(f, "succeeded");
    // Native Gemini normalization supplies its declared single-image default.
    expect(result.nodes[0]?.inputJson.parameters).toEqual(gemini ? { ...parameters, n: 1 } : parameters);
    expect(((await f.repository.getCanvas("canvas"))!.graph.nodes[0]!.data as JsonObject).parameters).toEqual(parameters);
    expect(f.fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(String(f.fetch.mock.calls[0]![1]?.body));
    if (gemini) expect(body.generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { imageSize: "2K" } });
    else expect(body).toEqual({ model, prompt: "16:9 landscape fixture", n: 1 });
  });
  it.each([
    { size: "4K", resolution: "2K" }, { size: "auto", image_size: "4K" }, { size: "4096x4096" }, { size: "8K" },
    { size: "4K", quality: "max" }, { size: "4K", width: 4096 }, { size: "4K", ratio: "16:9" },
  ])("rejects saved $parameters before any provider HTTP and preserves the user's parameters", async parameters => {
    const f = await fixture(highTier, parameters);
    await finished(f, "failed");
    expect(f.fetch).not.toHaveBeenCalled();
    expect(((await f.repository.getCanvas("canvas"))!.graph.nodes[0]!.data as JsonObject).parameters).toEqual(parameters);
  });
});

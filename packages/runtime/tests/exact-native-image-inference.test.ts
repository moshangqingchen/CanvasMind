import { describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import type { NormalizedRequest, ProviderAdapter } from "@super-canvas/providers";
import type { ObjectStorage, StoredObject } from "@super-canvas/storage";
import { RunService } from "../src/service.js";
import { validPngBytes } from "./fixtures/image-bytes.js";

class MemoryStorage implements ObjectStorage {
  private readonly values = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) { this.values.set(key, { bytes, contentType }); }
  async get(key: string) { return this.values.get(key) ?? null; }
}
class ExactRunService extends RunService {
  constructor(private readonly adapter: ProviderAdapter, repository: MemoryRepository, storage: ObjectStorage) {
    super({ repository, storage, executionMode: "inline" });
  }
  override adapters() { return new Map([["openai", this.adapter]]); }
}
const scopes = [
  { baseUrl: "https://api.eaheng.com", modelGroup: "B1-GPT生图原生渠道V1", model: "gpt-image-2.5" },
  { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图", model: "gpt-image-2-cf" },
  { baseUrl: "https://genimage.pro", modelGroup: "default", model: "gpt-image-2" },
  { baseUrl: "https://synoralink.com", modelGroup: "全参生图专线", accountKeyGroupId: "115", model: "gpt-image-2.5-flare" },
] as const;
async function fixture(scope: { baseUrl: string; modelGroup: string; model: string; accountKeyGroupId?: string }, parameters: JsonObject) {
  const repository = new MemoryRepository(), storage = new MemoryStorage();
  // Keep the old verified marker to prove that it cannot reactivate the generic
  // tier-to-pixel check before the supplier's current exact field contract.
  await repository.saveConnection({ id: "exact", name: "exact saved contract", provider: "openai", config: {
    ...scope, defaultModel: scope.model, modelCatalogModels: [{ id: scope.model, name: scope.model, operations: ["image.generate"],
      metadata: { imageCapabilitiesVerifiedAt: "2026-09-20T00:00:00Z" }, parameters: [] }],
  } });
  await repository.saveCanvas({ id: "canvas", title: "saved preferences", graph: { schemaVersion: 1, nodes: [{ id: "image", type: "workflow", data: {
    nodeType: "image-generation", provider: "openai", connectionId: "exact", model: scope.model,
    parts: [{ type: "text", text: "横图16:9" }], parameters, outputs: [{ id: "image", kind: "image" }],
  } }], edges: [] } });
  const submit = vi.fn(async (_request: NormalizedRequest) => ({ providerTaskId: "mock", status: "succeeded" as const, result: {} }));
  const adapter: ProviderAdapter = { testConnection: async () => {}, listModels: async () => [], validate: async () => ({ valid: true, issues: [] }),
    submit, extractOutputs: async () => [{ kind: "image", data: new Uint8Array(validPngBytes), mimeType: "image/png" }] };
  return { repository, submit, service: new ExactRunService(adapter, repository, storage) };
}
describe("exact image contracts run before generic size inference", () => {
  it.each(scopes)("resolves the restored 4K preset before $baseUrl/$model exact validation", async scope => {
    const parameters = { size: "auto", size_tier: "4K", aspect_ratio: "16:9", quality: "high" };
    const f = await fixture(scope, parameters);
    const saved = (await f.repository.getConnection("exact"))!;
    await f.repository.saveConnection({ ...saved, config: { ...saved.config, modelCatalogModels: [{ id: scope.model, name: scope.model,
      operations: ["image.generate"], parameters: [{ key: "size", label: "尺寸", control: "dimensions", default: "auto" }],
      metadata: { imageNativeParameterContract: true } }] } });
    const run = await f.service.createRun({ canvasId: "canvas", clientRequestId: "restored-preset", scope: "all" });
    await expect.poll(async () => (await f.service.getRun(run.id))?.run.status).toBe("succeeded");
    expect(f.submit).toHaveBeenCalledOnce();
    expect(f.submit.mock.calls[0]?.[0].parameters).toMatchObject({ size: "3840x2160", quality: "high" });
    expect((await f.repository.getCanvas("canvas"))?.graph.nodes[0]?.data.parameters).toEqual(parameters);
  });
  it.each(["gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("preserves PDog's exact measured max request for %s through the service", async model => {
    const parameters = { size: "3840x2160", size_tier: "4K", aspect_ratio: "16:9", quality: "max", n: 1 };
    const f = await fixture({ baseUrl: "https://ai.whyshy.cn", modelGroup: "【生图】image2/2.5-2K4K(原生)", model }, parameters);
    const run = await f.service.createRun({ canvasId: "canvas", clientRequestId: "pdog-history-max", scope: "all" });
    await expect.poll(async () => (await f.service.getRun(run.id))?.run.status).toBe("succeeded");
    expect(f.submit).toHaveBeenCalledOnce();
    expect(f.submit.mock.calls[0]?.[0].parameters).toMatchObject({ size: "3840x2160", quality: "max", n: 1 });
    expect((await f.repository.getCanvas("canvas"))?.graph.nodes[0]?.data.parameters).toEqual(parameters);
  });
  it.each([
    { size: "2048x896", aspect_ratio: "21:9" },
    { size: "896x2048", aspect_ratio: "9:21" },
  ])("keeps PDog's exact official rounded pair through service preflight: %j", async published => {
    const parameters = { ...published, size_tier: "2K", quality: "high", n: 1 };
    const f = await fixture({ baseUrl: "https://ai.whyshy.cn", modelGroup: "【生图】image2/2.5-2K4K(原生)", model: "gpt-image-2.5-flare" }, parameters);
    const run = await f.service.createRun({ canvasId: "canvas", clientRequestId: "pdog-published-rounding", scope: "all" });
    await expect.poll(async () => (await f.service.getRun(run.id))?.run.status).toBe("succeeded");
    expect(f.submit).toHaveBeenCalledOnce();
    expect(f.submit.mock.calls[0]?.[0].parameters).toMatchObject({ size: published.size, quality: "high", n: 1 });
    expect((await f.repository.getCanvas("canvas"))?.graph.nodes[0]?.data.parameters).toEqual(parameters);
  });
  it.each(scopes)("keeps $baseUrl/$model saved W/H and ratio despite old verified metadata", async scope => {
    const parameters = { size: "5000x4000", size_tier: "4K", aspect_ratio: "5:4", quality: "high" };
    const f = await fixture(scope, parameters), run = await f.service.createRun({ canvasId: "canvas", clientRequestId: scope.model, scope: "all" });
    await expect.poll(async () => (await f.service.getRun(run.id))?.run.status).toBe("succeeded");
    expect(f.submit).toHaveBeenCalledOnce();
    expect(f.submit.mock.calls[0]?.[0].parameters).toMatchObject({ size: "5000x4000", aspect_ratio: "5:4", quality: "high" });
    expect((await f.repository.getCanvas("canvas"))?.graph.nodes[0]?.data.parameters).toEqual(parameters);
  });
  it.each(scopes)("requires explicit W/H for $baseUrl/$model tier preference", async scope => {
    const parameters = { size: "auto", size_tier: "4K", aspect_ratio: "5:4", quality: "high" };
    const f = await fixture(scope, parameters), run = await f.service.createRun({ canvasId: "canvas", clientRequestId: "missing-size", scope: "all" });
    await expect.poll(async () => (await f.service.getRun(run.id))?.run.status).toBe("failed");
    expect(f.submit).not.toHaveBeenCalled();
    expect((await f.repository.getCanvas("canvas"))?.graph.nodes[0]?.data.parameters).toEqual(parameters);
  });
  it.each([{ size: "512x512", size_tier: "1K", aspect_ratio: "1:1" },
    { size: "auto", image_size: "2K", aspect_ratio: "5:4" }])("passes Secure actual native fields without generic matrix inference: %j", async parameters => {
    const f = await fixture({ baseUrl: "https://token.secure-skill.com", modelGroup: "adobe-image2-mid", model: "gpt-image-2" }, { ...parameters, quality: "high" });
    const run = await f.service.createRun({ canvasId: "canvas", clientRequestId: "secure-native", scope: "all" });
    await expect.poll(async () => (await f.service.getRun(run.id))?.run.status).toBe("succeeded");
    expect(f.submit.mock.calls[0]?.[0].parameters).toMatchObject({ size: parameters.size, aspect_ratio: parameters.aspect_ratio,
      image_size: "image_size" in parameters ? parameters.image_size : parameters.size_tier });
    expect(f.submit.mock.calls[0]?.[0].parameters).not.toHaveProperty("quality");
    expect((await f.repository.getCanvas("canvas"))?.graph.nodes[0]?.data.parameters).toEqual({ ...parameters, quality: "high" });
  });
});

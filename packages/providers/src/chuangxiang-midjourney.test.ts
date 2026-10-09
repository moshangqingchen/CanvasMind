import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const offline = vi.hoisted(() => ({
  lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]),
  fetch: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup: offline.lookup }));
import type { FetchImplementation, ModelDescriptor, NormalizedRequest, ProviderAssetInput } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { getImageEditingCapabilities } from "./image-editing-capabilities.js";
import { applyChuangxiangMidjourneyCapabilities, ChuangxiangMidjourneyAdapter, chuangxiangMidjourneyRequiresPublicAssets,
  isChuangxiangMidjourneyConnection, isChuangxiangMidjourneyResult } from "./chuangxiang-midjourney.js";

const config = { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图", usage: "canvas" };
const original: ProviderAssetInput = { id: "original", kind: "image", mimeType: "image/png", url: "https://assets.example/original.png" };
const mask: ProviderAssetInput = { id: "mask", kind: "image", mimeType: "image/png", role: "mask", url: "https://assets.example/mask.png" };
const request: NormalizedRequest = { connectionId: "cx", model: "midjourney-2k", operation: "image.generate", prompt: "A paper garden",
  idempotencyKey: "offline-one", parameters: { n: 1, size: "16:9" } };
beforeEach(() => {
  offline.lookup.mockClear();
  offline.fetch.mockReset().mockRejectedValue(new Error("Unexpected real HTTP"));
  vi.stubGlobal("fetch", offline.fetch);
});
afterEach(() => {
  try { expect(offline.fetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});
function fixture(baseUrl = config.baseUrl, provider = "openai", settings: Record<string, unknown> = {}) {
  const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: Array.from({ length: 4 }, (_, i) => ({ url: `https://assets.example/result-${i}.png` })) }));
  const resolver = new StaticConnectionResolver([{ id: "cx", provider, baseUrl, apiKey: "offline-key",
    settings: { ...config, baseUrl, scannedModelIds: ["midjourney-1k", "midjourney-2k", "other-model"], ...settings } }]);
  return { adapter: new ChuangxiangMidjourneyAdapter(resolver, { fetch }), fetch };
}
function body(f: ReturnType<typeof fixture>) { return JSON.parse(String(f.fetch.mock.calls[0]?.[1]?.body)); }

describe("Chuangxiang Midjourney exact synchronous contract", () => {
  it.each([{}, { data: [] }, { data: [{ revised_prompt: "A paper garden" }] }])("rejects a paid response without images without retrying it", async response => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(Response.json(response));
    await expect(f.adapter.submit(request)).rejects.toMatchObject({ details: {
      kind: "invalid_response", phase: "submit", submissionMayHaveOccurred: true, retryable: false,
    } });
    expect(f.fetch).toHaveBeenCalledOnce();
  });
  it.each([config.baseUrl, `${config.baseUrl}/v1`])("uses one synchronous request and retains four outputs for %s", async baseUrl => {
    const f = fixture(baseUrl);
    const task = await f.adapter.submit({ ...request, parameters: { ...request.parameters, quality: "max", resolution: "4K", image_size: "4K",
      output_resolution: "4K", output_format: "webp", stream: true, async: true, response_format: "b64_json" } });
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(String(f.fetch.mock.calls[0]?.[0])).toBe(`${config.baseUrl}/v1/images/generations`);
    expect(new Headers(f.fetch.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer offline-key");
    expect(new Headers(f.fetch.mock.calls[0]?.[1]?.headers).get("content-type")).toBe("application/json");
    expect(body(f)).toEqual({ model: request.model, prompt: request.prompt, n: 1, response_format: "url", size: "16:9", speed: "relax" });
    expect(task.status).toBe("succeeded");
    expect(isChuangxiangMidjourneyResult(task.result)).toBe(true);
    const outputs = await f.adapter.extractOutputs(task.result);
    expect(outputs).toHaveLength(4);
    expect(outputs[0]).toMatchObject({ kind: "image", url: "https://assets.example/result-0.png" });
  });
  it.each(["image", "style", "edit", "moodboard"])("uses generations for %s reference mode without dropping images", async reference => {
    const f = fixture();
    await f.adapter.submit({ ...request, operation: "image.edit", assets: [original, { ...original, id: "second", url: "https://assets.example/second.png" }],
      parameters: { reference, speed: "fast", aspect_ratio: "3:4" } });
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(String(f.fetch.mock.calls[0]?.[0])).toBe(`${config.baseUrl}/v1/images/generations`);
    expect(body(f)).toEqual({ model: request.model, prompt: request.prompt, n: 1, response_format: "url", reference, speed: "fast", size: "3:4",
      images: [original.url, "https://assets.example/second.png"] });
  });
  it("defaults connected reference images to ordinary reference mode", async () => {
    const f = fixture();
    await f.adapter.submit({ ...request, assets: [original], parameters: { reference: "auto", size: "auto" } });
    expect(body(f)).toEqual({ model: request.model, prompt: request.prompt, n: 1, response_format: "url", speed: "relax", reference: "image", images: [original.url] });
  });
  it.each(["openai", "rest"])("uses edits for the editor and keeps the %s PNG mask outside images", async provider => {
    const f = fixture(config.baseUrl, provider);
    await f.adapter.submit({ ...request, operation: "image.edit", assets: [original, mask], parameters: { reference: "editor" } });
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(String(f.fetch.mock.calls[0]?.[0])).toBe(`${config.baseUrl}/v1/images/edits`);
    expect(body(f)).toEqual({ model: request.model, prompt: request.prompt, n: 1, response_format: "url", speed: "relax", reference: "editor",
      images: [original.url], mask: mask.url });
  });
  it("allows editor without a mask and supports an existing HTTPS mask parameter", async () => {
    for (const parameters of [{ reference: "editor" }, { reference: "editor", mask: mask.url }]) {
      const f = fixture();
      await f.adapter.submit({ ...request, operation: "image.edit", assets: [original], parameters });
      expect(String(f.fetch.mock.calls[0]?.[0])).toBe(`${config.baseUrl}/v1/images/edits`);
      expect(body(f).images).toEqual([original.url]);
      expect(body(f).mask).toBe(parameters.mask);
    }
  });
  it("rejects invalid counts, modes, masks, speeds and references before network submission", async () => {
    const f = fixture();
    const cases: NormalizedRequest[] = [
      { ...request, parameters: { n: 4 } },
      { ...request, parameters: { speed: "turbo" } },
      { ...request, parameters: { reference: "unknown" }, assets: [original] },
      { ...request, parameters: { reference: "style" } },
      { ...request, parameters: { size: "2048x2048" } },
      { ...request, prompt: "Garden --turbo" },
      { ...request, prompt: "Garden --hd" },
      { ...request, prompt: "Garden --fast", parameters: { speed: "relax" } },
      { ...request, operation: "image.edit", parameters: { reference: "editor" }, assets: [original, original] },
      { ...request, parameters: { reference: "editor" }, assets: [original] },
      { ...request, operation: "image.edit", parameters: { reference: "image" }, assets: [original, mask] },
      { ...request, operation: "image.edit", parameters: { reference: "editor" }, assets: [original, { ...mask, mimeType: "image/jpeg" }] },
      { ...request, assets: [{ ...original, url: "http://assets.example/original.png" }] },
      { ...request, operation: "image.edit", parameters: { reference: "edit" }, assets: Array.from({ length: 5 }, () => original) },
    ];
    for (const invalid of cases) await expect(f.adapter.submit(invalid)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("accepts exactly four edit references and labels the ordinary reference bound as adapter-owned", async () => {
    const f = fixture();
    expect(await f.adapter.validate({ ...request, operation: "image.edit", parameters: { reference: "edit" }, assets: Array.from({ length: 4 }, () => original) }))
      .toEqual({ valid: true, issues: [] });
    const ordinary = await f.adapter.validate({ ...request, assets: Array.from({ length: 17 }, () => original) });
    expect(ordinary.issues).toContainEqual(expect.objectContaining({ code: "adapter_reference_limit", message: expect.stringContaining("官方未声明") }));
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("honors a single prompt speed flag and rejects conflicting flags", async () => {
    const f = fixture();
    await f.adapter.submit({ ...request, prompt: "Garden --fast" });
    expect(body(f).speed).toBe("fast");
    f.fetch.mockClear();
    await expect(f.adapter.submit({ ...request, prompt: "Garden --fast --relax" })).rejects.toThrow(/一致/u);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("requires the saved public hosting choice before submitting local image bytes", async () => {
    const f = fixture();
    await expect(f.adapter.submit({ ...request, assets: [{ id: "local", kind: "image", mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }] }))
      .rejects.toThrow(/临时链接/u);
    expect(f.fetch).not.toHaveBeenCalled();
  });
});

describe("exact Midjourney capabilities and cache recovery", () => {
  it("restores cached missing protocols, preserves price data, and exposes task/output counts separately", async () => {
    const cached: ModelDescriptor = { id: "midjourney-1k", name: "Saved model", operations: [], limits: { maxInputImages: 9, maxOutputImages: 1 },
      parameters: [{ key: "quality", label: "Old quality", control: "select" }], metadata: { canvasRunnable: false,
        canvasUnavailableReason: "当前分组没有匹配的调用协议，请选择对应的图片或视频分组", autoInterfaceStatus: "incomplete", priceLabel: "fixture price" } };
    const restored = applyChuangxiangMidjourneyCapabilities({ provider: "openai", config }, cached);
    expect(restored).toMatchObject({ id: cached.id, name: cached.name, operations: ["image.generate", "image.edit"], limits: { maxOutputImages: 4 },
      metadata: { canvasRunnable: true, priceLabel: "fixture price", fixedOutputCount: 4, fixedRequestCount: 1, imageSupportedResolutions: ["1K"],
        midjourneyReferenceLimits: { edit: 4, editor: 1 }, midjourneyAdapterReferenceLimit: 16 } });
    expect(restored.limits?.maxInputImages).toBeUndefined();
    expect(restored.metadata?.canvasUnavailableReason).toBeUndefined();
    expect(restored.metadata?.autoInterfaceStatus).toBeUndefined();
    expect(restored.parameters?.map(parameter => parameter.key)).toEqual(["size", "speed", "reference", "n"]);
    expect((await fixture().adapter.listModels("cx")).map(model => model.id)).toEqual(["midjourney-1k", "midjourney-2k"]);
  });
  it("keeps permission and unsupported-scope rejections intact", () => {
    for (const reason of ["403 当前Key无权限", "模型已下架", "当前分组未开通"]) {
      const rejected: ModelDescriptor = { id: "midjourney-2k", name: "Rejected", operations: [], metadata: { canvasRunnable: false, canvasUnavailableReason: reason, autoInterfaceStatus: "incomplete" } };
      expect(applyChuangxiangMidjourneyCapabilities({ provider: "openai", config }, rejected)).toBe(rejected);
    }
    for (const changed of [{ modelGroup: "视频" }, { usage: "agent" }, { usage: "disabled" }, { supplierArchived: true },
      { baseUrl: "http://vapi.chuangxiangai.asia" }, { baseUrl: "https://vapi.chuangxiangai.asia.example" },
      { baseUrl: "https://user@vapi.chuangxiangai.asia" }, { baseUrl: "https://vapi.chuangxiangai.asia/custom" }, { baseUrl: "https://vapi.chuangxiangai.asia:8443" }])
      expect(isChuangxiangMidjourneyConnection({ ...config, ...changed }, "midjourney-2k")).toBe(false);
    expect(isChuangxiangMidjourneyConnection(config, "midjourney-v7")).toBe(false);
    expect(isChuangxiangMidjourneyConnection({ ...config, accountKeyGroup: "视频" }, "midjourney-1k")).toBe(false);
    expect(chuangxiangMidjourneyRequiresPublicAssets("openai", config, "midjourney-1k", "image.edit")).toBe(true);
    expect(chuangxiangMidjourneyRequiresPublicAssets("openai", config, "midjourney-1k", "image.generate")).toBe(false);
    expect(chuangxiangMidjourneyRequiresPublicAssets("openai", config, "midjourney-1k", "video.generate")).toBe(false);
  });
  it("advertises a HTTPS mask only for the two exact editor contracts", () => {
    for (const provider of ["openai", "rest"]) for (const model of ["midjourney-1k", "midjourney-2k"]) {
      expect(getImageEditingCapabilities({ provider, config }, model, { reference: "editor" })).toEqual({ transparent: false, mask: "url" });
      for (const reference of ["auto", "image", "style", "edit", "moodboard"])
        expect(getImageEditingCapabilities({ provider, config }, model, { reference }).mask).toBe(null);
    }
    expect(getImageEditingCapabilities({ provider: "openai", config }, "midjourney-4k", { reference: "editor" }).mask).toBe(null);
    expect(getImageEditingCapabilities({ provider: "openai", config: { ...config, modelGroup: "视频" } }, "midjourney-1k", { reference: "editor" }).mask).toBe(null);
  });
  it("keeps exact inventory failures and declared text outputs from becoming runnable images", async () => {
    const model: ModelDescriptor = { id: "midjourney-2k", name: "Saved", operations: [], metadata: { canvasRunnable: false,
      canvasUnavailableReason: "调用协议待确认", autoInterfaceStatus: "incomplete" } };
    for (const unavailable of [ { scannedModelIds: ["midjourney-1k"] }, { modelScanStatus: "empty" },
      { modelScanStatus: "unauthorized" }, { unavailableModels: ["midjourney-2k"] }, { unavailableModels: [{ id: "midjourney-2k" }] } ]) {
      expect(applyChuangxiangMidjourneyCapabilities({ provider: "openai", config: { ...config, ...unavailable } }, model).metadata?.canvasRunnable).toBe(false);
      const f = fixture(config.baseUrl, "openai", unavailable);
      await expect(f.adapter.submit(request)).rejects.toThrow(/Key|目录|权限/u);
      expect(f.fetch).not.toHaveBeenCalled();
    }
    const textModel: ModelDescriptor = { ...model, outputKinds: ["text"], metadata: { ...model.metadata, outputKindsSource: "declared" } };
    expect(applyChuangxiangMidjourneyCapabilities({ provider: "openai", config }, textModel)).toBe(textModel);
    const undeclaredBlock: ModelDescriptor = { ...model, metadata: { canvasRunnable: false, canvasUnavailableReason: "用户停用" } };
    expect(applyChuangxiangMidjourneyCapabilities({ provider: "openai", config }, undeclaredBlock)).toBe(undeclaredBlock);
    for (const unavailable of [textModel, undeclaredBlock]) {
      const f = fixture(config.baseUrl, "openai", { modelCatalogModels: [unavailable] });
      await expect(f.adapter.submit(request)).rejects.toThrow();
      expect(f.fetch).not.toHaveBeenCalled();
    }
    const repairable = fixture(config.baseUrl, "openai", { modelCatalogModels: [model] });
    expect((await repairable.adapter.validate(request)).valid).toBe(true);
  });
});

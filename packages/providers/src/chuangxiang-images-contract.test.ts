import { describe, expect, it, vi } from "vitest";
import type { FetchImplementation, NormalizedRequest } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { OpenAIImageAdapter } from "./openai.js";
import { applyChuangxiangCurrentImageCapabilities, ChuangxiangImageAdapter, chuangxiangRequiresPublicAssets, isChuangxiangImageConnection, isChuangxiangImageResult } from "./chuangxiang-images-contract.js";

const model = "gpt-image-2.5-flare-4k";
const config = { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图", usage: "canvas" };
const request: NormalizedRequest = { connectionId: "cx", operation: "image.generate", model, prompt: "A vase", idempotencyKey: "one-submit", parameters: { size: "3840x2160", quality: "max", n: 1 } };
const reference = { id: "ref", kind: "image" as const, mimeType: "image/png", url: "https://assets.example/reference.png" };
function fixture(baseUrl = config.baseUrl) {
  const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ url: "https://assets.example/generated.png" }] }));
  const adapter = new ChuangxiangImageAdapter(new StaticConnectionResolver([{ id: "cx", provider: "openai", baseUrl, apiKey: "fixture-key", settings: config }]), { fetch });
  return { adapter, fetch };
}

describe("Chuangxiang current GPT Images contract", () => {
  it("keeps GPT2's own open size/ratio contract and only the documented 2.5 targets and bounds", async () => {
    for (const tier of ["1k", "2k", "4k"]) {
      for (const family of ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
        const id = `${family}-${tier}`, descriptor = applyChuangxiangCurrentImageCapabilities({ provider: "openai", config },
          { id, name: id, operations: ["image.generate"], parameters: [{ key: "size", control: "dimensions", label: "old", min: 16, max: 3840, step: 16 }],
            metadata: { imageResolutionProfiles: { "4K": { "1:1": "2880x2880" } } } });
        const size = descriptor.parameters?.find(parameter => parameter.key === "size")!;
        expect(descriptor.metadata?.imageNativeParameterContract).toBe(true);
        expect(descriptor.metadata?.imageResolutionProfiles).toBeUndefined();
        expect(size.options).toHaveLength(family === "gpt-image-2" ? 8 : 4);
        expect(size.min).toBe(family === "gpt-image-2" ? undefined : 16);
        expect(size.max).toBe(family === "gpt-image-2" ? undefined : 3840);
        expect(size.step).toBe(family === "gpt-image-2" ? undefined : 16);
        expect(descriptor.parameters?.find(parameter => parameter.key === "quality")?.default).toBe("max");
      }
    }
    const f = fixture();
    await f.adapter.submit({ ...request, model: "gpt-image-2-4k", parameters: { size: "2497x3313", quality: "max" } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toMatchObject({ model: "gpt-image-2-4k", size: "2497x3313", quality: "max" });
    f.fetch.mockClear();
    await expect(f.adapter.submit({ ...request, parameters: { size: "2497x3313", quality: "max" } })).rejects.toThrow(/16/u);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each(["direct", "registry"])("uses the current contract through the %s OpenAI entry point", async mode => {
    const fetch = vi.fn<FetchImplementation>(async url => String(url).endsWith("/models")
      ? Response.json({ data: [{ id: model }] })
      : Response.json({ data: [{ url: "https://assets.example/generated.png" }] }));
    const resolver = new StaticConnectionResolver([{ id: "cx", provider: "openai", baseUrl: config.baseUrl, apiKey: "fixture-key",
      settings: { ...config, defaultModel: model, scannedModelIds: [model] } }]);
    const adapter = mode === "direct" ? new OpenAIImageAdapter(resolver, { fetch }) : createDefaultProviderRegistry(resolver, { fetch }).get("openai");
    await adapter.testConnection("cx");
    const models = await adapter.listModels("cx");
    expect(models.find(item => item.id === model)?.limits).toMatchObject({ maxInputImages: 9, maxOutputImages: 1 });
    const task = await adapter.submit({ ...request, operation: "image.edit", assets: [reference] });
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(String(posts[0]![0])).toBe(`${config.baseUrl}/v1/images/edits`);
    expect(JSON.parse(String(posts[0]![1]?.body))).toMatchObject({ model, images: [reference.url], quality: "max", n: 1, response_format: "url" });
    expect(await adapter.extractOutputs(task.result)).toMatchObject([{ kind: "image", url: "https://assets.example/generated.png" }]);
    expect(fetch.mock.calls.filter(([, init]) => init?.method !== "POST").every(([url]) => String(url) === `${config.baseUrl}/v1/models`)).toBe(true);
  });
  it.each([config.baseUrl, `${config.baseUrl}/v1`])("uses the versioned synchronous JSON endpoint for %s", async baseUrl => {
    const f = fixture(baseUrl);
    const task = await f.adapter.submit({ ...request, parameters: { ...request.parameters, output_format: "webp", background: "opaque", response_format: "b64_json" } });
    expect(f.fetch).toHaveBeenCalledOnce();
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${config.baseUrl}/v1/images/generations`);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-key");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ model, prompt: request.prompt, size: "3840x2160", quality: "max", n: 1, response_format: "url" });
    expect(task.status).toBe("succeeded");
    expect(isChuangxiangImageResult(task.result)).toBe(true);
    expect(await f.adapter.extractOutputs(task.result)).toMatchObject([{ kind: "image", url: "https://assets.example/generated.png" }]);
  });
  it("sends all public references as JSON images without downloading or multipart", async () => {
    const f = fixture();
    await f.adapter.submit({ ...request, operation: "image.edit", assets: [reference, { ...reference, id: "ref2", url: "https://assets.example/second.png" }] });
    expect(f.fetch).toHaveBeenCalledOnce();
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${config.baseUrl}/v1/images/edits`);
    expect(JSON.parse(String(init?.body))).toMatchObject({ images: [reference.url, "https://assets.example/second.png"], n: 1, response_format: "url" });
  });
  it("omits automatic fields and sends a requested ratio directly as size", async () => {
    const f = fixture();
    await f.adapter.submit({ ...request, parameters: { size: "auto", aspect_ratio: "16:9", quality: "auto" } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model, prompt: request.prompt, size: "16:9", n: 1, response_format: "url" });
  });
  it("rejects excess references and counts before making a paid request", async () => {
    const f = fixture();
    const tooMany = { ...request, operation: "image.edit" as const, assets: Array.from({ length: 10 }, (_, id) => ({ ...reference, id: String(id) })) };
    expect((await f.adapter.validate(tooMany)).issues).toContainEqual(expect.objectContaining({ code: "too_many_images" }));
    await expect(f.adapter.submit(tooMany)).rejects.toThrow(/9/u);
    await expect(f.adapter.submit({ ...request, parameters: { n: 2 } })).rejects.toThrow(/一张/u);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("requires the existing explicit hosting choice before uploading local images", async () => {
    const f = fixture();
    await expect(f.adapter.submit({ ...request, operation: "image.edit", assets: [{ id: "local", kind: "image", mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }] })).rejects.toThrow(/临时链接/u);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("keeps unrelated origins, groups, legacy IDs and models on their existing adapters", () => {
    for (const changed of [{ baseUrl: "https://vapi.chuangxiangai.asia.example/v1" }, { baseUrl: "http://vapi.chuangxiangai.asia" },
      { baseUrl: "https://user@vapi.chuangxiangai.asia" }, { baseUrl: "https://vapi.chuangxiangai.asia/custom" }, { modelGroup: "视频" }, { usage: "agent" }])
      expect(isChuangxiangImageConnection({ ...config, ...changed }, model)).toBe(false);
    expect(isChuangxiangImageConnection(config, "gemini-3-pro-image-preview")).toBe(false);
    expect(isChuangxiangImageConnection(config, "gpt-image-2.5-yf")).toBe(false);
    expect(chuangxiangRequiresPublicAssets("openai", config, model, "image.edit")).toBe(true);
    expect(chuangxiangRequiresPublicAssets("openai", config, model, "image.generate")).toBe(false);
  });
  it("publishes the model's exact tier and documented count/reference limits", () => {
    const descriptor = applyChuangxiangCurrentImageCapabilities({ provider: "openai", config }, { id: model, name: model, operations: ["image.generate"], metadata: { customEvidence: true } });
    expect(descriptor).toMatchObject({ id: model, operations: ["image.generate", "image.edit"], limits: { maxInputImages: 9, maxOutputImages: 1 }, metadata: { customEvidence: true, imageSupportedResolutions: ["4K"], imageUnsupportedResolutions: ["1K", "2K"] } });
    expect(descriptor.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["auto", "medium", "max"]);
    expect(descriptor.metadata).toMatchObject({ imageSupplierQualityDefault: "medium", imageApplicationQualityDefault: "max" });
    expect(descriptor.parameters?.find(parameter => parameter.key === "size")?.options).toContainEqual({ value: "2880x2880", label: "4K · 1:1 · 2880 × 2880" });
  });
  it("keeps GPT2 quality values and sends its HTTPS mask separately from references", async () => {
    const f = fixture();
    await f.adapter.submit({ ...request, model: "gpt-image-2-4k", operation: "image.edit", parameters: { quality: "xhigh" },
      assets: [reference, { ...reference, id: "mask", role: "mask", url: "https://assets.example/mask.png" }] });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toMatchObject({ model: "gpt-image-2-4k", images: [reference.url], mask: "https://assets.example/mask.png", quality: "xhigh" });
    const descriptor = applyChuangxiangCurrentImageCapabilities({ provider: "openai", config }, { id: "gpt-image-2-4k", name: "GPT2", operations: ["image.generate"] });
    expect(descriptor.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
  });
  it.each(["gpt-image-2.5-flare-4k", "gpt-image-2.5-sunburst-2k"])("rejects the documented illegal quality and mask for %s without changing saved parameters", async selected => {
    const f = fixture();
    const input = { ...request, model: selected, parameters: { quality: "high", size: "16:9" } };
    await expect(f.adapter.submit(input)).rejects.toThrow(/medium.*max/u);
    expect(input.parameters).toEqual({ quality: "high", size: "16:9" });
    await expect(f.adapter.submit({ ...input, operation: "image.edit", parameters: { quality: "max" }, assets: [reference,
      { ...reference, id: "mask", role: "mask" }] })).rejects.toThrow(/蒙版|mask/u);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["gpt-image-2.5-flare-4k", "4096x4096", "invalid_custom_dimensions"],
    ["gpt-image-2.5-sunburst-2k", "2561x1440", "invalid_custom_dimensions"],
    ["gpt-image-2.5-flare-1k", "2048x2048", "image_tier_mismatch"],
    ["gpt-image-2.5-sunburst-2k", "1024x1024", "image_tier_mismatch"],
    ["gpt-image-2.5-flare-4k", "2560x1440", "image_tier_mismatch"],
    ["gpt-image-2.5-flare-1k", "2048x512", "invalid_custom_dimensions"],
  ])("checks documented pixel restrictions for %s %s before submitting", async (selected, size, code) => {
    const f = fixture();
    const input = { ...request, model: selected, parameters: { quality: "max", size } };
    expect((await f.adapter.validate(input)).issues).toContainEqual(expect.objectContaining({ code }));
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(input.parameters.size).toBe(size);
  });
  it.each([
    ["gpt-image-2.5-flare-1k", "1280x720"], ["gpt-image-2.5-flare-2k", "2560x1440"],
    ["gpt-image-2.5-sunburst-4k", "2880x2880"], ["gpt-image-2.5-flare-4k", "16:9"],
  ])("forwards documented dimensions and open ratios unchanged for %s %s", async (selected, size) => {
    const f = fixture();
    await f.adapter.submit({ ...request, model: selected, parameters: { quality: "medium", size } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toMatchObject({ model: selected, size, quality: "medium" });
  });
});

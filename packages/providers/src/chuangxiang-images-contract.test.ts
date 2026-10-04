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
    const task = await f.adapter.submit({ ...request, parameters: { ...request.parameters, output_format: "webp", background: "transparent", response_format: "b64_json" } });
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
    expect(descriptor.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
  });
});

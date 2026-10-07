import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { applyBananaImageCapabilities, bananaImageRoute, normalizeBananaParameters } from "./banana-image.js";
import type { FetchImplementation, NormalizedRequest } from "./contracts.js";

const model = "gemini-3-pro-image-preview";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKcAAAAASUVORK5CYII=";
const request: NormalizedRequest = { connectionId: "test", model, operation: "image.generate", prompt: "a blue vase", idempotencyKey: "one-paid-request", parameters: { image_size: "4K", aspect_ratio: "16:9" } };
function fixture(baseUrl: string, options: { model?: string; group?: string; reply?: unknown; fetch?: FetchImplementation; settings?: Record<string, unknown> } = {}) {
  const selected = options.model ?? model;
  const config = { baseUrl, modelGroup: options.group, scannedModelIds: [selected], ...options.settings };
  const fetch = vi.fn<FetchImplementation>(options.fetch ?? (async () => Response.json(options.reply ?? { candidates: [{ content: { parts: [{ text: "done" }, { inlineData: { mimeType: "image/png", data: png } }] } }] })));
  const resolver = new StaticConnectionResolver([{ id: "test", provider: "openai", baseUrl, apiKey: "fixture-key", settings: config }]);
  return { adapter: createDefaultProviderRegistry(resolver, { fetch }).get("openai"), fetch, config };
}

describe("supplier banana image protocols", () => {
  it.each([
    ["https://genimage.pro/v1", undefined, "Authorization", "Bearer fixture-key", model],
    ["https://api.frimodel.com/v1", "gemini_image", "x-goog-api-key", "fixture-key", model],
    ["https://asian-acc.we-token.cc/v1", "adobe香蕉", "Authorization", "Bearer fixture-key", "gemini-3-pro-image"],
  ])("sends native image requests for %s without GPT fields", async (baseUrl, group, header, credential, sentModel) => {
    const f = fixture(baseUrl!, { group });
    const result = await f.adapter.submit({ ...request, parameters: { size: "auto", size_tier: "4K", aspect_ratio: "16:9", quality: "max", background: "opaque" } });
    expect(f.fetch).toHaveBeenCalledOnce();
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${new URL(baseUrl!).origin}/v1beta/models/${sentModel}:generateContent`);
    expect(new Headers(init?.headers).get(header!)).toBe(credential);
    expect(JSON.parse(String(init?.body))).toEqual({ contents: [{ role: "user", parts: [{ text: request.prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "4K" } } });
    expect((await f.adapter.extractOutputs(result.result))[0]).toMatchObject({ kind: "image", mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) });
  });

  it("sends reference bytes inline, including when the source is a URL", async () => {
    const f = fixture("https://genimage.pro/v1", { fetch: async (url) => String(url) === "https://assets.example/ref.png"
      ? new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } })
      : Response.json({ candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/png", data: png } }] } }] }) });
    expect((await f.adapter.validate({ ...request, operation: "image.edit", assets: [{ id: "ref", kind: "image", mimeType: "image/png", url: "https://assets.example/ref.png" }] })).valid).toBe(true);
    const task = await f.adapter.submit({ ...request, operation: "image.edit", assets: [{ id: "ref", kind: "image", mimeType: "image/png", url: "https://assets.example/ref.png" }] });
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    const body = JSON.parse(String(f.fetch.mock.calls.at(-1)![1]?.body));
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: png } });
    expect(JSON.stringify(body)).not.toContain("file_uri");
    expect(await f.adapter.extractOutputs(task.result)).toHaveLength(1);
  });

  it("uses Secure Skill native inline references and its documented authentication", async () => {
    const f = fixture("https://token.secure-skill.com/v1", { group: "banana-全系列" });
    await f.adapter.submit({ ...request, operation: "image.edit", assets: [{ id: "ref", kind: "image", mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) }] });
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(String(url)).toBe(`https://token.secure-skill.com/v1beta/models/${model}:generateContent`);
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("fixture-key");
    expect(JSON.parse(String(init?.body)).contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: png } });
  });

  it.each(["banana-全系列", "banana-pro统一价格"].flatMap(group =>
    ["4:1", "1:4", "8:1", "1:8"].map(ratio => [group, ratio]),
  ))("preserves Secure Skill nano2.1's documented %s / %s ratio in controls and native requests", async (group, ratio) => {
    const selected = "gemini-nano-banana-2.1";
    const f = fixture("https://token.secure-skill.com/v1", { model: selected, group });
    const descriptor = applyBananaImageCapabilities({ provider: "openai", config: f.config },
      { id: selected, name: selected, operations: ["image.generate"] });
    expect(descriptor.parameters?.find(parameter => parameter.key === "aspect_ratio")?.options?.map(option => option.value)).toContain(ratio);
    expect(descriptor.limits?.maxInputImages).toBe(16);
    const task = await f.adapter.submit({ ...request, model: selected, parameters: { image_size: "2K", aspect_ratio: ratio } });
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(String(url)).toBe(`https://token.secure-skill.com/v1beta/models/${selected}:generateContent`);
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("fixture-key");
    expect(JSON.parse(String(init?.body)).generationConfig.imageConfig).toEqual({ aspectRatio: ratio, imageSize: "2K" });
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(await f.adapter.extractOutputs(task.result)).toHaveLength(1);
  });

  it("keeps Secure Skill nano2.1's sixteen-reference contract and rejects a seventeenth before submission", async () => {
    const selected = "gemini-nano-banana-2.1";
    const f = fixture("https://token.secure-skill.com/v1", { model: selected, group: "banana-全系列" });
    const assets = Array.from({ length: 16 }, (_, index) => ({ id: `ref-${index}`, kind: "image" as const, mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) }));
    await f.adapter.submit({ ...request, model: selected, operation: "image.edit", assets, parameters: { image_size: "4K", aspect_ratio: "1:8" } });
    const body = JSON.parse(String(f.fetch.mock.calls[0]![1]?.body));
    expect(body.contents[0].parts).toHaveLength(17);
    expect(body.contents[0].parts.slice(1).every((part: { inlineData?: unknown }) => Boolean(part.inlineData))).toBe(true);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: "1:8", imageSize: "4K" });
    f.fetch.mockClear();
    await expect(f.adapter.submit({ ...request, model: selected, operation: "image.edit", assets: [...assets, { ...assets[0]!, id: "ref-17" }] })).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("does not expand other Secure Skill groups/models or Genimage nano2.1 ratios", () => {
    for (const [baseUrl, group, selected] of [
      ["https://token.secure-skill.com/v1", "banana-全系列", model],
      ["https://token.secure-skill.com/v1", "banana-pro统一价格", "gemini-3.1-flash-image"],
      ["https://token.secure-skill.com/v1", "unrelated-group", "gemini-nano-banana-2.1"],
      ["https://genimage.pro/v1", "default", "gemini-nano-banana-2.1"],
      ["https://genimage.pro/v1", "geminiResponseUrl", "gemini-nano-banana-2.1"],
    ]) {
      const route = bananaImageRoute({ provider: "openai", config: { baseUrl, modelGroup: group } }, selected!)!;
      for (const ratio of ["4:1", "1:4", "8:1", "1:8"]) expect(route.ratios).not.toContain(ratio);
    }
    const route = bananaImageRoute({ provider: "openai", config: { baseUrl: "https://token.secure-skill.com/v1", modelGroup: "different", accountKeyGroup: "banana-pro统一价格" } }, "gemini-nano-banana-2.1")!;
    expect(normalizeBananaParameters(route, { image_size: "4K", aspect_ratio: "4:1" }).aspect_ratio).toBe("4:1");
  });

  it("persists Secure Skill's async generation ID and resumes querying without another POST", async () => {
    let queries = 0;
    const f = fixture("https://token.secure-skill.com/v1", { group: "banana-全系列", fetch: async (_url, init) => {
      if (init?.method === "POST") return Response.json({ id: "generation-123", status: "in_progress" }, { status: 202 });
      queries++;
      return Response.json(queries === 1 ? { id: "generation-123", status: "in_progress" } : queries === 2 ? { id: "generation-123", status: "succeeded", data: [] } : { id: "generation-123", status: "succeeded", data: [{ url: "https://assets.example/result.png" }] });
    } });
    let task = await f.adapter.submit(request);
    expect(task).toMatchObject({ providerTaskId: "generation-123", status: "running", pollAfterMs: 3000 });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model, prompt: request.prompt, size: "4K", aspect_ratio: "16:9", n: 1 });
    task = { ...task, ...await f.adapter.poll!(JSON.parse(JSON.stringify(task))) };
    expect(task.status).toBe("running");
    task = { ...task, ...await f.adapter.poll!(JSON.parse(JSON.stringify(task))) };
    expect(task.status).toBe("running");
    task = { ...task, ...await f.adapter.poll!(JSON.parse(JSON.stringify(task))) };
    expect(task.status).toBe("succeeded");
    expect(await f.adapter.extractOutputs(task.result)).toEqual([{ kind: "image", url: "https://assets.example/result.png" }]);
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(f.fetch.mock.calls.slice(1).every(([url]) => String(url) === "https://token.secure-skill.com/v1/images/generations/generation-123")).toBe(true);
  });

  it("keeps documented wide ratios and rejects unsupported Lite resolution before paying", async () => {
    const weai = fixture("https://asian-acc.we-token.cc/v1", { group: "adobe香蕉" });
    await weai.adapter.submit({ ...request, parameters: { aspect_ratio: "8:1", image_size: "512" } });
    expect(JSON.parse(String(weai.fetch.mock.calls[0]![1]?.body)).generationConfig.imageConfig).toEqual({ aspectRatio: "8:1", imageSize: "512" });
    const lite = fixture("https://token.secure-skill.com/v1", { model: "gemini-3.1-flash-lite-image" });
    expect((await lite.adapter.validate({ ...request, model: "gemini-3.1-flash-lite-image" })).valid).toBe(false);
    expect(lite.fetch).not.toHaveBeenCalled();
    const unsupported = fixture("https://asian-acc.we-token.cc/v1", { group: "adobe香蕉", model: "gemini-3.0-pro-image" });
    await expect(unsupported.adapter.submit({ ...request, model: "gemini-3.0-pro-image" })).rejects.toThrow(/已支持的型号/);
    expect(unsupported.fetch).not.toHaveBeenCalled();
    const route = bananaImageRoute({ provider: "openai", config: { baseUrl: "https://genimage.pro/v1" } }, model)!;
    expect(normalizeBananaParameters(route, { aspect_ratio: "1000:1501", image_size: "2K" }).aspect_ratio).toBe("2:3");
  });

  it.each([
    { text: "![image](https://assets.example/generated.png)" },
    { fileData: { mimeType: "image/png", fileUri: "https://assets.example/generated.png" } },
    { inlineData: { mimeType: "image/png", data: "https://assets.example/generated.png" } },
  ])("accepts URL results from the geminiResponseUrl group", async part => {
    const f = fixture("https://genimage.pro/v1", { group: "geminiResponseUrl", reply: { candidates: [{ content: { parts: [part] } }] } });
    const task = await f.adapter.submit(request);
    expect(await f.adapter.extractOutputs(task.result)).toEqual([{ kind: "image", url: "https://assets.example/generated.png" }]);
  });

  it("uses Chuangxiang ratio, tier quality and JSON URL references", async () => {
    const f = fixture("https://vapi.chuangxiangai.asia", { group: "生图", reply: { data: [{ url: "https://assets.example/generated.png" }] } });
    const task = await f.adapter.submit({ ...request, operation: "image.edit", assets: [{ id: "ref", kind: "image", mimeType: "image/png", url: "https://assets.example/ref.png" }] });
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://vapi.chuangxiangai.asia/v1/images/edits");
    expect(JSON.parse(String(init?.body))).toEqual({ model, prompt: request.prompt, size: "16:9", quality: "4k", n: 1, response_format: "url", images: ["https://assets.example/ref.png"] });
    expect(await f.adapter.extractOutputs(task.result)).toHaveLength(1);
  });

  it("keeps a fixed Banana SKU and does not send quality", async () => {
    const selected = "nano-banana2-2k";
    const f = fixture("https://vapi.chuangxiangai.asia", { group: "生图", model: selected, reply: { data: [{ url: "https://assets.example/generated.png" }] } });
    await f.adapter.submit({ ...request, model: selected, parameters: { image_size: "2K", aspect_ratio: "1:1" } });
    const body = JSON.parse(String(f.fetch.mock.calls[0]![1]?.body));
    expect(body.model).toBe(selected); expect(body.size).toBe("1:1"); expect(body).not.toHaveProperty("quality");
  });

  it("rejects unsupported tiers and absent reference images before submission", async () => {
    const f = fixture("https://genimage.pro/v1", { model: "gemini-2.5-flash-image" });
    expect((await f.adapter.validate({ ...request, model: "gemini-2.5-flash-image" })).valid).toBe(false);
    expect((await f.adapter.validate({ ...request, model: "gemini-2.5-flash-image", operation: "image.edit", parameters: { image_size: "1K" } })).valid).toBe(false);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("retains GPT descriptors and Images request payloads", async () => {
    const gpt = "gpt-image-2.5-sunburst";
    const f = fixture("https://genimage.pro/v1", { model: gpt, reply: { data: [{ b64_json: png }] } });
    const descriptor = { id: gpt, name: gpt, operations: ["image.generate" as const], parameters: [{ key: "quality", label: "质量", control: "select" as const, default: "max" }] };
    expect(applyBananaImageCapabilities({ provider: "openai", config: f.config }, descriptor)).toBe(descriptor);
    await f.adapter.submit({ ...request, model: gpt, parameters: { size: "2880x2880", quality: "max", n: 1 } });
    expect(String(f.fetch.mock.calls[0]![0])).toBe("https://genimage.pro/v1/images/generations");
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model: gpt, prompt: request.prompt, size: "2880x2880", quality: "max", n: 1 });
  });

  it("does not change unrelated origins, REST native connectors, or GPT IDs", () => {
    for (const [provider, baseUrl, selected] of [["openai", "https://unknown.example/v1", model], ["rest", "https://api.3365api.cn", model], ["weai", "https://api.mikoto.vip", model], ["openai", "https://genimage.pro/v1", "gpt-image-2"]])
      expect(bananaImageRoute({ provider: provider!, config: { baseUrl } }, selected!)).toBeUndefined();
    const route = bananaImageRoute({ provider: "openai", config: { baseUrl: "https://api.frimodel.com/v1" } }, model)!;
    expect(normalizeBananaParameters(route, { size: "3840x2160", quality: "max" })).toEqual({ image_size: "4K", aspect_ratio: "16:9", n: 1 });
  });
});

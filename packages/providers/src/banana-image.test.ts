import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { applyBananaImageCapabilities, bananaImageRoute, normalizeBananaParameters, CHENTU_GEMINI_PENDING_PROTOCOL_REASON } from "./banana-image.js";
import type { FetchImplementation, ModelDescriptor, NormalizedRequest } from "./contracts.js";

const model = "gemini-3-pro-image-preview";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKcAAAAASUVORK5CYII=";
const request: NormalizedRequest = { connectionId: "test", model, operation: "image.generate", prompt: "a blue vase", idempotencyKey: "one-paid-request", parameters: { image_size: "4K", aspect_ratio: "16:9" } };
function fixture(baseUrl: string, options: { model?: string; group?: string; provider?: "openai" | "weai" | "rest"; reply?: unknown; fetch?: FetchImplementation; settings?: Record<string, unknown> } = {}) {
  const selected = options.model ?? model;
  const config = { baseUrl, modelGroup: options.group, scannedModelIds: [selected], ...options.settings };
  const fetch = vi.fn<FetchImplementation>(options.fetch ?? (async () => Response.json(options.reply ?? { candidates: [{ content: { parts: [{ text: "done" }, { inlineData: { mimeType: "image/png", data: png } }] } }] })));
  const provider = options.provider ?? "openai";
  const resolver = new StaticConnectionResolver([{ id: "test", provider, baseUrl, apiKey: "fixture-key", settings: config }]);
  return { adapter: createDefaultProviderRegistry(resolver, { fetch }).get(provider), fetch, config };
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
    await weai.adapter.submit({ ...request, parameters: { aspect_ratio: "8:1", image_size: "2K" } });
    expect(JSON.parse(String(weai.fetch.mock.calls[0]![1]?.body)).generationConfig.imageConfig).toEqual({ aspectRatio: "8:1", imageSize: "2K" });
    const lite = fixture("https://token.secure-skill.com/v1", { model: "gemini-3.1-flash-lite-image" });
    expect((await lite.adapter.validate({ ...request, model: "gemini-3.1-flash-lite-image" })).valid).toBe(false);
    expect(lite.fetch).not.toHaveBeenCalled();
    const unsupported = fixture("https://asian-acc.we-token.cc/v1", { group: "adobe香蕉", model: "gemini-3.1-flash-lite-image" });
    await expect(unsupported.adapter.submit({ ...request, model: "gemini-3.1-flash-lite-image" })).rejects.toThrow(/当前分组/);
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

describe("Chentu keyed native Gemini image contract", () => {
  const nativeModels = ["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"];
  const pending = (id: string): ModelDescriptor => ({ id, name: id, operations: [], metadata: {
    canvasRunnable: false, canvasUnavailableReason: CHENTU_GEMINI_PENDING_PROTOCOL_REASON, autoInterfaceStatus: "incomplete", pendingLiveScan: true,
  } });

  it.each(nativeModels.flatMap(id => (["openai", "rest"] as const).map(provider => ({ id, provider }))))(
    "restores $id through the $provider connection with the exact native endpoint and inline references", async ({ id, provider }) => {
      const f = fixture("https://tu.988236.xyz/v1", { model: id, provider, settings: { supplierKey: "chentu", modelCatalogModels: [pending(id)] } });
      const descriptor = applyBananaImageCapabilities({ provider, config: f.config }, pending(id));
      expect(descriptor.operations).toEqual(["image.generate", "image.edit"]);
      expect(descriptor.metadata?.canvasRunnable).toBe(true);
      expect(descriptor.metadata?.canvasUnavailableReason).toBeUndefined();
      expect(descriptor.metadata?.autoInterfaceStatus).toBeUndefined();
      expect(descriptor.metadata?.pendingLiveScan).toBeUndefined();
      expect(descriptor.limits?.maxInputImages).toBeUndefined();
      await f.adapter.submit({ ...request, model: id, operation: "image.edit", parameters: { image_size: "2K", aspect_ratio: "16:9" },
        assets: [{ id: "ref", kind: "image", mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) }] });
      expect(f.fetch).toHaveBeenCalledOnce();
      const [url, init] = f.fetch.mock.calls[0]!;
      expect(String(url)).toBe(`https://tu.988236.xyz/v1beta/models/${id}:generateContent`);
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("fixture-key");
      expect(JSON.parse(String(init?.body))).toEqual({ contents: [{ role: "user", parts: [{ text: request.prompt }, { inlineData: { mimeType: "image/png", data: png } }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { imageSize: "2K", aspectRatio: "16:9" } } });
    },
  );

  it("keeps the keyed inventory and explicit output declarations authoritative", async () => {
    const id = nativeModels[0]!;
    for (const settings of [
      { scannedModelIds: [] }, { modelScanStatus: "unauthorized" }, { unavailableModels: [id] },
      { modelCatalogModels: [{ ...pending(id), metadata: { canvasRunnable: false, canvasUnavailableReason: "403 Key 未授权" } }] },
      { modelCatalogModels: [{ ...pending(id), outputKinds: ["text"], metadata: { ...pending(id).metadata, outputKindsSource: "declared" } }] },
      { modelCatalogModels: [{ id, name: id, operations: ["image.generate"], outputKinds: ["text"], metadata: { canvasRunnable: true, outputKindsSource: "declared" } }] },
      { supplierKey: "chentu", supplierArchived: true }, { supplierKey: "chentu", usage: "disabled" },
    ]) {
      const f = fixture("https://tu.988236.xyz/v1", { model: id, settings });
      await expect(f.adapter.submit({ ...request, model: id })).rejects.toThrow();
      expect(f.fetch).not.toHaveBeenCalled();
    }
  });

  it("preserves fixed-tier Images routes and other suppliers", () => {
    const config = { baseUrl: "https://tu.988236.xyz/v1", scannedModelIds: ["gemini-3.1-flash-image-2k"] };
    expect(bananaImageRoute({ provider: "openai", config }, "gemini-3.1-flash-image-2k")).toBeUndefined();
    expect(bananaImageRoute({ provider: "rest", config: { ...config, baseUrl: "https://api.frimodel.com/v1" } }, nativeModels[0]!)).toBeUndefined();
  });
  it("repairs the saved REST group-mapping gap only with current native Key inventory", () => {
    const id = nativeModels[0]!;
    const old = { ...pending(id), metadata: { ...pending(id).metadata, catalogCapability: "image", canvasUnavailableReason: "当前分组没有匹配的调用协议，请选择对应的图片或视频分组" } };
    const config = { baseUrl: "https://tu.988236.xyz/v1", scannedModelIds: [id] };
    expect(applyBananaImageCapabilities({ provider: "rest", config }, old).metadata?.canvasRunnable).toBe(true);
    expect(applyBananaImageCapabilities({ provider: "rest", config: { ...config, scannedModelIds: [] } }, old)).toBe(old);
    const denied = { ...old, metadata: { ...old.metadata, canvasUnavailableReason: "403 当前分组没有匹配的调用协议，请选择对应的图片或视频分组" } };
    expect(applyBananaImageCapabilities({ provider: "rest", config }, denied)).toBe(denied);
  });
});

describe("We-AI current group-scoped Gemini contracts", () => {
  it.each(["us-la.we-token.cc", "asian-acc.we-token.cc", "sub2api.we-token.cc"].flatMap(host =>
    ["gemini-3.0-pro-image", "gemini-3.0-pro-image-preview"].map(alias => [host, alias])))
  ("routes %s Adobe alias %s to the documented base model with the correct default", async (host, alias) => {
    const f = fixture(`https://${host}/v1`, { model: alias, group: "adobe香蕉" });
    const descriptor = applyBananaImageCapabilities({ provider: "openai", config: f.config }, { id: alias!, name: alias!, operations: ["image.generate"] });
    expect(descriptor.parameters?.find(p => p.key === "image_size")).toMatchObject({ default: "2K" });
    expect(descriptor.parameters?.find(p => p.key === "image_size")?.options?.map(o => o.value)).toEqual(["1K", "2K", "4K"]);
    expect(descriptor.parameters?.find(p => p.key === "thinking_level")).toBeUndefined();
    const task = await f.adapter.submit({ ...request, model: alias, parameters: {} });
    expect(f.fetch.mock.calls[0]![0]).toBe(`https://${host}/v1beta/models/gemini-3-pro-image:generateContent`);
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body)).generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { imageSize: "2K" } });
    expect(await f.adapter.extractOutputs(task.result)).toHaveLength(1);
  });
  it.each([
    ["gemini-3-pro-image", ["high"], "high", "high"],
    ["gemini-3.1-flash-image", ["minimal", "high"], "minimal", "high"],
    ["gemini-nano-banana-2.1", ["minimal", "medium", "high"], "medium", "medium"],
  ] as const)("declares aistudio %s thinking levels and sends only a supported selection", async (selected, values, defaultValue, thinking) => {
    const f = fixture("https://asian-acc.we-token.cc/v1", { model: selected, group: "aistudio香蕉",
      reply: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: png } }] } }] } });
    const descriptor = applyBananaImageCapabilities({ provider: "openai", config: f.config }, { id: selected, name: selected, operations: ["image.generate"] });
    expect(descriptor.parameters?.find(p => p.key === "thinking_level")).toMatchObject({ default: defaultValue });
    expect(descriptor.parameters?.find(p => p.key === "thinking_level")?.options?.map(o => o.value)).toEqual(values);
    expect(descriptor.parameters?.find(p => p.key === "image_size")?.default).toBe("1K");
    expect(descriptor.limits?.maxInputImages).toBe(14);
    const task = await f.adapter.submit({ ...request, model: selected, parameters: { thinkingLevel: thinking.toUpperCase() } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body)).generationConfig).toEqual({ responseModalities: ["IMAGE"],
      imageConfig: { imageSize: "1K" }, thinkingConfig: { thinkingLevel: thinking } });
    expect((await f.adapter.extractOutputs(task.result))[0]).toMatchObject({ kind: "image", mimeType: "image/jpeg" });
  });
  it("preserves exact size/ratio precedence and never invents nearest ratios", async () => {
    const f = fixture("https://asian-acc.we-token.cc/v1", { model: "gemini-3.1-flash-image", group: "aistudio香蕉" });
    await f.adapter.submit({ ...request, model: "gemini-3.1-flash-image", parameters: {
      resolution: "2k", size: "4K", aspect_ratio: "9:16", aspectRatio: "16:9", thinking_level: "high" } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body)).generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { imageSize: "2K", aspectRatio: "9:16" }, thinkingConfig: { thinkingLevel: "high" } });
    const adobe = bananaImageRoute({ provider: "openai", config: { baseUrl: "https://asian-acc.we-token.cc", modelGroup: "adobe香蕉" } }, "gemini-3-pro-image")!;
    const aistudio = bananaImageRoute({ provider: "openai", config: f.config }, "gemini-3.1-flash-image")!;
    expect(normalizeBananaParameters(adobe, { aspect_ratio: "1000:1501", size: "1024x1024" })).toEqual({ aspect_ratio: "1000:1501", image_size: "2K", n: 1 });
    expect(normalizeBananaParameters(aistudio, { aspect_ratio: "8:1", size: "auto" })).toEqual({ aspect_ratio: "8:1", image_size: "1K", n: 1 });
    f.fetch.mockClear();
    await expect(f.adapter.submit({ ...request, model: "gemini-3.1-flash-image", parameters: { aspect_ratio: "8:1" } })).rejects.toThrow(/画面比例/);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("rejects explicit invalid aistudio thinking before reference download or submission while Adobe ignores it", async () => {
    const selected = "gemini-3.1-flash-image";
    const f = fixture("https://asian-acc.we-token.cc/v1", { model: selected, group: "aistudio香蕉" });
    const assets = [{ id: "weai-ref", kind: "image" as const, mimeType: "image/png", url: "https://assets.example/ref.png" }];
    for (const parameters of [{ thinking_level: "medium" }, { thinkingLevel: "unknown" }, { thinking_level: 0 }, { thinkingLevel: null }, { thinking_level: "" }]) {
      const invalid = { ...request, model: selected, operation: "image.edit" as const, assets, parameters };
      expect(await f.adapter.validate(invalid)).toMatchObject({ valid: false, issues: expect.arrayContaining([
        expect.objectContaining({ path: "parameters.thinking_level", code: "invalid_thinking_level" }),
      ]) });
      await expect(f.adapter.submit(invalid)).rejects.toThrow(/思考档位/);
    }
    expect(f.fetch).not.toHaveBeenCalled();
    const adobe = fixture("https://asian-acc.we-token.cc/v1", { model: selected, group: "adobe香蕉" });
    await adobe.adapter.submit({ ...request, model: selected, parameters: { thinking_level: "unknown" } });
    expect(adobe.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(adobe.fetch.mock.calls[0]![1]?.body)).generationConfig).not.toHaveProperty("thinkingConfig");
  });
  it("sends all fourteen inline references and rejects fifteen, unavailable groups, tiers and case variants without submission", async () => {
    const selected = "gemini-nano-banana-2.1";
    const f = fixture("https://asian-acc.we-token.cc/v1", { model: selected, group: "aistudio香蕉" });
    const assets = Array.from({ length: 14 }, (_, i) => ({ id: `weai-ref-${i}`, kind: "image" as const, mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) }));
    await f.adapter.submit({ ...request, model: selected, operation: "image.edit", assets, parameters: { image_size: "4K", aspect_ratio: "8:1", thinking_level: "high" } });
    const body = JSON.parse(String(f.fetch.mock.calls[0]![1]?.body));
    expect(body.contents[0].parts).toHaveLength(15);
    expect(body.generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { imageSize: "4K", aspectRatio: "8:1" }, thinkingConfig: { thinkingLevel: "high" } });
    f.fetch.mockClear();
    await expect(f.adapter.submit({ ...request, model: selected, operation: "image.edit", assets: [...assets, assets[0]!] })).rejects.toThrow();
    await expect(f.adapter.submit({ ...request, model: selected, parameters: { image_size: "512" } })).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
    for (const [group, id] of [["adobe香蕉", selected], ["aistudio香蕉", "gemini-3.0-pro-image"], ["adobe香蕉", "Gemini-3-pro-image"]]) {
      const denied = fixture("https://asian-acc.we-token.cc/v1", { model: id, group });
      await expect(denied.adapter.submit({ ...request, model: id, parameters: { image_size: "1K" } })).rejects.toThrow();
      expect(denied.fetch).not.toHaveBeenCalled();
    }
  });
  it("repairs only its exact obsolete alias blocker and preserves permissions and unrelated supplier routes", () => {
    const config = { baseUrl: "https://asian-acc.we-token.cc/v1", modelGroup: "unrelated", accountKeyGroup: "adobe香蕉" };
    const original = { id: "gemini-3.0-pro-image", name: "Alias", operations: [], metadata: { canvasRunnable: false, autoInterfaceStatus: "incomplete", pendingLiveScan: true,
      canvasUnavailableReason: "此模型虽在分组列表中，但供应商香蕉接口仅声明支持 gemini-3-pro-image 和 gemini-3.1-flash-image；请选已支持的型号" } };
    const repaired = applyBananaImageCapabilities({ provider: "openai", config }, original);
    expect(repaired.metadata).toMatchObject({ canvasRunnable: true, pendingLiveScan: true });
    expect(repaired.metadata?.autoInterfaceStatus).toBeUndefined();
    expect(repaired.metadata?.canvasUnavailableReason).toBeUndefined();
    const denied = { ...original, metadata: { ...original.metadata, canvasUnavailableReason: "401 Key 未授权" } };
    expect(applyBananaImageCapabilities({ provider: "openai", config }, denied)).toBe(denied);
    expect(bananaImageRoute({ provider: "openai", config: { baseUrl: "https://unrelated.we-token.cc/v1", modelGroup: "aistudio香蕉" } }, "gemini-nano-banana-2.1")).toBeUndefined();
    expect(bananaImageRoute({ provider: "openai", config: { baseUrl: "https://sub2api.aitu.art/v1", modelGroup: "aistudio香蕉" } }, "gemini-nano-banana-2.1")).toBeUndefined();
    expect(bananaImageRoute({ provider: "weai", config: { baseUrl: "https://asian-acc.we-token.cc/v1", modelGroup: "gemini香蕉" } }, "gemini-3-pro-image")).toBeUndefined();
    expect(bananaImageRoute({ provider: "weai", config: { baseUrl: "https://genimage.pro/v1", modelGroup: "adobe香蕉" } }, "gemini-3-pro-image")).toBeUndefined();
  });
  it("uses the same exact official contracts through the WeAI provider without expanding its unrelated routes", async () => {
    for (const [selected, group, canonical, size] of [
      ["gemini-3.0-pro-image-preview", "adobe香蕉", "gemini-3-pro-image", "2K"],
      ["gemini-3.1-flash-image", "aistudio香蕉", "gemini-3.1-flash-image", "1K"],
      ["gemini-nano-banana-2.1", "aistudio香蕉", "gemini-nano-banana-2.1", "1K"],
    ]) {
      const f = fixture("https://sub2api.we-token.cc/v1", { model: selected, group, provider: "weai" });
      await f.adapter.submit({ ...request, model: selected, parameters: {} });
      expect(f.fetch).toHaveBeenCalledOnce();
      expect(f.fetch.mock.calls[0]![0]).toBe(`https://sub2api.we-token.cc/v1beta/models/${canonical}:generateContent`);
      expect(new Headers(f.fetch.mock.calls[0]![1]?.headers).get("Authorization")).toBe("Bearer fixture-key");
      expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body)).generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { imageSize: size } });
    }
  });
});

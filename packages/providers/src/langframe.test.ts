import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials.js";
import type { ModelDescriptor, NormalizedRequest, ProviderAssetInput, ResolvedProviderConnection } from "./contracts.js";
import { LangframeAdapter, langframeConnector, langframeParameters } from "./langframe.js";
import { ProviderHttpError } from "./http.js";
import { createDefaultProviderRegistry } from "./registry.js";

const picture = "image-2.5-flare-1K-2k-4kMAX品质", video = "SD-2.5-M2支持真人满血";
const imageModel: ModelDescriptor = { id: picture, name: picture, operations: ["image.generate", "image.edit"],
  metadata: { rawParams: { resolutions: ["1K", "2K", "4K"], ratios: ["1:1", "16:9"] } } };
const videoModel: ModelDescriptor = { id: video, name: video, operations: ["video.generate", "video.image-to-video"],
  limits: { maxInputImages: 30, maxInputVideos: 10, maxInputAudios: 10 }, metadata: { rawParams: { resolutions: ["480P", "720P", "1080P"], ratios: ["16:9", "9:16"], durations: [4, 5, 6, 7, 8, 9, 10] } } };
const original = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 19, 255, 1]);
const image: ProviderAssetInput = { id: "source", kind: "image", mimeType: "image/png", filename: "reference.png", data: original };
const request = (overrides: Partial<NormalizedRequest> = {}): NormalizedRequest => ({ connectionId: "wolf", operation: "image.generate", prompt: "test", idempotencyKey: "run:node", model: picture, parameters: { resolution: "4K", aspect_ratio: "16:9", size: "3840x2160", quality: "max", n: 1 }, ...overrides });
const connection = (): ResolvedProviderConnection => ({ id: "wolf", provider: "langframe", apiKey: "sk-lf-fixture", baseUrl: "https://vipprompt.cn/v1",
  settings: { scannedModelIds: [picture, video], modelCatalogModels: [imageModel, videoModel] } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("LangframeAdapter", () => {
  it("registers the dedicated runtime and uses Key model IDs without inferring media from names", async () => {
    const resolver = new StaticConnectionResolver([connection()]);
    const fetcher = vi.fn(async () => json({ data: [{ id: picture }, { id: "unknown" }] }));
    const adapter = createDefaultProviderRegistry(resolver, { fetch: fetcher }).get("langframe");
    expect(adapter).toBeInstanceOf(LangframeAdapter);
    expect(await adapter.listModels("wolf")).toMatchObject([{ id: picture, operations: ["image.generate", "image.edit"] }, { id: "unknown", operations: [] }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://vipprompt.cn/v1/models");
  });

  it("preserves full downstream name, 4K, max and original reference bytes on the shared image route", async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown>; headers: Headers }> = [];
    const fetcher: typeof fetch = async (url, init) => { calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) }); return json({ taskId: "img-original", status: "queued" }); };
    const adapter = new LangframeAdapter(new StaticConnectionResolver([connection()]), { fetch: fetcher });
    const task = await adapter.submit(request({ operation: "image.edit", assets: [image] }));
    expect(task).toMatchObject({ providerTaskId: "img-original", status: "queued" });
    expect(calls[0]?.url).toBe("https://vipprompt.cn/v1/images/generations");
    expect(calls[0]?.body).toMatchObject({ model: picture, resolution: "4K", quality: "max", aspect_ratio: "16:9", size: "3840x2160", n: 1 });
    const values = calls[0]?.body?.image;
    expect(values).toBe(`data:image/png;base64,${Buffer.from(original).toString("base64")}`);
    expect(calls[0]?.headers.get("prefer")).toBe("respond-async");
    expect(calls[0]?.headers.get("x-lf-task-id")).toMatch(/^lf-[a-f0-9]{64}$/u);
    expect(calls[0]?.body).not.toHaveProperty("output_format");
    expect(calls[0]?.body).not.toHaveProperty("background");
  });

  it("validates explicit supplier enums and unknown fields before a POST without changing saved choices", async () => {
    const fetcher = vi.fn(async () => json({}));
    const adapter = new LangframeAdapter(new StaticConnectionResolver([connection()]), { fetch: fetcher });
    for (const parameters of [{ resolution: "8K" }, { background: "transparent", output_format: "png" }, { resolution: "4K", size_tier: "1K" }, { size: "2048x2048", width: 3000, height: 3000 }]) {
      const value = request({ parameters });
      const before = structuredClone(value);
      await expect(adapter.submit(value)).rejects.toThrow();
      expect(value).toEqual(before);
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(langframeParameters(request({ parameters: { resolution: "4K", width: 3011, height: 1999, quality: "max" } }))).toMatchObject({ resolution: "4K", size: "3011x1999", quality: "max" });
  });

  it("sends an explicitly selected auto image quality instead of dropping it into the supplier default", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ taskId: "quality-auto", status: "queued" }));
    const adapter = new LangframeAdapter(new StaticConnectionResolver([connection()]), { fetch: fetcher });
    const input = request({ parameters: { resolution: "4K", quality: "auto", n: 1 } });
    const before = structuredClone(input);
    await adapter.submit(input);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      model: picture, prompt: "test", resolution: "4K", quality: "auto", n: 1,
    });
    expect(input).toEqual(before);
    const omitted = request({ idempotencyKey: "unset-quality", parameters: { resolution: "4K" } });
    await adapter.submit(omitted);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).not.toHaveProperty("quality");
  });

  it("rejects a saved auto string in integer image fields without substituting default values or submitting", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new LangframeAdapter(new StaticConnectionResolver([connection()]), { fetch: fetcher });
    for (const parameters of [{ n: "auto" }, { width: "auto", height: "auto" }]) {
      const input = request({ parameters }), before = structuredClone(input);
      await expect(adapter.submit(input)).rejects.toThrow("不能使用字符串 auto");
      expect(input).toEqual(before);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uploads local video media through the website hook, reuses public URLs and preserves media order", async () => {
    const assets: ProviderAssetInput[] = [image, { id: "clip", kind: "video", mimeType: "video/mp4", data: new Uint8Array([1, 2, 3]) },
      { id: "sound", kind: "audio", mimeType: "audio/wav", url: "https://media.example/voice.wav" }];
    const upload = vi.fn(async (_id: string, asset: ProviderAssetInput) => `https://vipprompt.cn/uploads/${asset.id}`);
    let sent: Record<string, unknown> = {};
    const adapter = new LangframeAdapter(new StaticConnectionResolver([connection()]), { uploadReference: upload,
      fetch: async (_url, init) => { sent = JSON.parse(String(init?.body)); return json({ task_id: "video-original", status: "queued" }); } });
    await adapter.submit(request({ model: video, operation: "video.generate", parameters: { resolution: "720P", ratio: "16:9", duration: 5 }, assets }));
    expect(sent).toEqual({ model: video, prompt: "test", resolution: "720P", ratio: "16:9", duration: 5,
      media: [{ type: "reference_image", url: "https://vipprompt.cn/uploads/source" }, { type: "reference_video", url: "https://vipprompt.cn/uploads/clip" }, { type: "audio", url: "https://media.example/voice.wav" }] });
    expect(upload.mock.calls).toEqual([["wolf", image], ["wolf", assets[1]]]);
  });

  it("does not generate when a required upload fails or first/last frame roles lack a documented mapping", async () => {
    const fetcher = vi.fn(async () => json({}));
    const adapter = new LangframeAdapter(new StaticConnectionResolver([connection()]), { fetch: fetcher, uploadReference: async () => { throw new Error("upload failed"); } });
    await expect(adapter.submit(request({ model: video, operation: "video.generate", parameters: { duration: 5, resolution: "720P" }, assets: [image] }))).rejects.toThrow("upload failed");
    const validation = await adapter.validate(request({ model: video, operation: "video.image-to-video", parameters: { duration: 5, resolution: "720P" }, assets: [{ ...image, role: "firstFrame" }, { ...image, id: "tail", role: "lastFrame" }] }));
    expect(validation.issues.some(issue => issue.code === "undeclared_frame_role")).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("recovers an interrupted POST by the preassigned identity using GET only, including after restart", async () => {
    const methods: string[] = [], urls: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      methods.push(String(init?.method)); urls.push(String(url));
      if (init?.method === "POST") throw new TypeError("socket disconnected after send");
      return json({ task: { status: "succeeded", images: [{ b64_json: Buffer.from(original).toString("base64") }] } });
    };
    const resolver = new StaticConnectionResolver([connection()]);
    const first = new LangframeAdapter(resolver, { fetch: fetcher });
    const pending = await first.submit(request());
    expect(pending.status).toBe("running");
    expect(pending.result).toMatchObject({ submissionUncertain: true });
    const restored = new LangframeAdapter(resolver, { fetch: fetcher });
    const complete = await restored.poll(JSON.parse(JSON.stringify(pending)));
    expect(complete.status).toBe("succeeded");
    expect(await restored.extractOutputs(complete.result)).toEqual([{ kind: "image", data: original }]);
    expect(methods).toEqual(["POST", "GET"]);
    expect(urls[1]).toBe(`https://vipprompt.cn/v1/images/tasks/${pending.providerTaskId}`);
  });

  it("does not turn explicit authentication rejection into a new task or repeat the POST", async () => {
    const fetcher = vi.fn(async () => json({ error: "wrong key" }, 401));
    const adapter = new LangframeAdapter(new StaticConnectionResolver([connection()]), { fetch: fetcher });
    await expect(adapter.submit(request())).rejects.toBeInstanceOf(ProviderHttpError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects an undeclared public v1 image array before uploading or generating without discarding references", async () => {
    const fetcher = vi.fn<typeof fetch>(), upload = vi.fn();
    const adapter = new LangframeAdapter(new StaticConnectionResolver([connection()]), { fetch: fetcher, uploadReference: upload });
    const input = request({ operation: "image.edit", assets: [image, { ...image, id: "second" }] });
    const before = structuredClone(input);
    await expect(adapter.submit(input)).rejects.toThrow("公共 v1");
    expect(input).toEqual(before);
    expect(fetcher).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });

  it("uses the official shared X-LF-Task-ID header for video and recovers a lost response by that exact ID", async () => {
    const calls: Array<{ url: string; method: string; headers: Headers }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), method: String(init?.method), headers: new Headers(init?.headers) });
      if (init?.method === "POST") throw new TypeError("lost video response after request sent");
      return json({ status: "succeeded", video_url: "https://media.example/original-video.mp4" });
    };
    const adapter = new LangframeAdapter(new StaticConnectionResolver([connection()]), { fetch: fetcher });
    const pending = await adapter.submit(request({ model: video, operation: "video.generate", parameters: { resolution: "720P", duration: 5, ratio: "16:9" } }));
    const headerId = calls[0]?.headers.get("x-lf-task-id");
    expect(headerId).toMatch(/^lf-[a-f0-9]{64}$/u);
    expect(calls[0]?.url).toBe("https://vipprompt.cn/v1/videos");
    expect(calls[0]?.headers.get("prefer")).toBe("respond-async");
    expect(pending.providerTaskId).toBe(headerId);
    const state = await adapter.poll(JSON.parse(JSON.stringify(pending)));
    expect(state.status).toBe("succeeded");
    expect(calls.map(call => call.method)).toEqual(["POST", "GET"]);
    expect(calls[1]?.url).toBe(`https://vipprompt.cn/v1/videos/tasks/${headerId}`);
  });

  it("continues polling the original host when a connection is edited, and preserves provider download URL", async () => {
    let current = connection(), method = "POST";
    const resolver = { resolve: async () => current };
    const urls: string[] = [];
    const adapter = new LangframeAdapter(resolver, { fetch: async (url, init) => {
      urls.push(String(url)); method = String(init?.method);
      return json(method === "POST" ? { id: "v-001", status: "queued" } : { status: "completed", video_url: "https://cdn.example/preview.mp4", download_url: "https://cdn.example/original.mov" });
    } });
    const pending = await adapter.submit(request({ model: video, operation: "video.generate", parameters: { duration: 5, resolution: "720P", ratio: "16:9" } }));
    current = { ...current, baseUrl: "https://unrelated.example/v1" };
    const state = await adapter.poll(pending);
    expect(await adapter.extractOutputs(state.result)).toEqual([{ kind: "video", url: "https://cdn.example/original.mov" }]);
    expect(urls).toEqual(["https://vipprompt.cn/v1/videos", "https://vipprompt.cn/v1/videos/tasks/v-001"]);
  });

  it("keeps synchronous result bytes and content MIME without assuming PNG or reencoding", async () => {
    const adapter = new LangframeAdapter(new StaticConnectionResolver([connection()]));
    const config = langframeConnector("image");
    const outputs = await adapter.extractOutputs({ config, remote: { images: [], data: [{ b64_json: `data:image/webp;base64,${Buffer.from(original).toString("base64")}` }] } });
    expect(outputs).toEqual([{ kind: "image", data: original, mimeType: "image/webp" }]);
  });

  it("sends a supplier-declared video auto ratio while rejecting auto at models whose explicit enum excludes it", async () => {
    const value = connection(), target = structuredClone(videoModel);
    target.metadata = { rawParams: { resolutions: ["720P"], ratios: ["auto", "16:9"], durations: [5] } };
    value.settings = { ...value.settings, modelCatalogModels: [target] };
    const fetcher = vi.fn<typeof fetch>(async () => json({ taskId: "auto-ratio", status: "queued" }));
    const adapter = new LangframeAdapter(new StaticConnectionResolver([value]), { fetch: fetcher });
    const input = request({ model: video, operation: "video.generate", parameters: { resolution: "720P", ratio: "auto", duration: 5 } });
    await adapter.submit(input);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).ratio).toBe("auto");
    const strict = new LangframeAdapter(new StaticConnectionResolver([connection()]), { fetch: fetcher });
    expect((await strict.validate(input)).issues.some(issue => issue.path === "parameters.ratio")).toBe(true);
    expect((await adapter.validate({ ...input, parameters: { ...input.parameters, aspect_ratio: "16:9" } })).issues.some(issue => issue.path === "parameters.aspect_ratio")).toBe(true);
  });

  it("enforces zero media limits, measured durations and exact counts without inventing a general n maximum", async () => {
    const value = connection(), target = structuredClone(videoModel);
    target.limits = { maxInputVideos: 0, maxInputImages: 1, maxInputAudios: 1, maxInputAudioDurationSeconds: 15 };
    value.settings = { ...value.settings, modelCatalogModels: [imageModel, target] };
    const adapter = new LangframeAdapter(new StaticConnectionResolver([value]));
    const input = request({ model: video, operation: "video.generate", parameters: { resolution: "720P", duration: 5 }, assets: [
      { id: "clip", kind: "video", mimeType: "video/mp4", url: "https://media.example/clip.mp4", durationSeconds: 4 },
      { id: "voice", kind: "audio", mimeType: "audio/wav", url: "https://media.example/voice.wav", durationSeconds: 16 },
    ] });
    const validation = await adapter.validate(input);
    expect(validation.issues.some(issue => issue.message.includes("最多接收 0"))).toBe(true);
    expect(validation.issues.some(issue => issue.code === "media_duration_exceeded")).toBe(true);
    expect((await adapter.validate(request({ parameters: { n: 11 } }))).valid).toBe(true);
  });

  it("rejects private reference links before generation and does not send credentials to a path from saved polling metadata", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ status: "failed", error: "original failed" }));
    const adapter = new LangframeAdapter(new StaticConnectionResolver([connection()]), { fetch: fetcher });
    const input = request({ model: video, operation: "video.generate", parameters: { resolution: "720P", duration: 5 }, assets: [
      { id: "clip", kind: "video", mimeType: "video/mp4", url: "http://127.0.0.1/private" },
    ] });
    await expect(adapter.submit(input)).rejects.toThrow("安全的公开");
    expect(fetcher).not.toHaveBeenCalled();
    const config = langframeConnector("video");
    config.poll!.path = "https://attacker.example/steal"; config.allowedHosts = ["attacker.example"];
    const task = { providerTaskId: "original", status: "running" as const, result: { langframe: true, connectionId: "wolf", baseUrl: "https://vipprompt.cn", config, taskId: "original", remote: {} } };
    await adapter.poll(task);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://vipprompt.cn/v1/videos/tasks/original");
    await expect(adapter.poll({ ...task, providerTaskId: ".." })).rejects.toThrow("编号无效");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import type {
  ModelDescriptor, NormalizedRequest, ProviderAdapter, ProviderAssetInput,
  ProviderName, ProviderTask, ResolvedProviderConnection,
} from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { remainingVideoModel, type RemainingVideoSupplier } from "./remaining-video-contracts.js";
import type { RestConnectorConfig } from "./rest.js";

const connectionId = "isolated-native-video";
const apiKey = "isolated-key-of-original-group";
const prompt = "Ocean sunrise";
const image: ProviderAssetInput = { id: "image", kind: "image", mimeType: "image/png", url: "https://media.example/reference.png" };
const video: ProviderAssetInput = { id: "video", kind: "video", mimeType: "video/mp4", url: "https://media.example/reference.mp4", durationSeconds: 4 };
const audio: ProviderAssetInput = { id: "audio", kind: "audio", mimeType: "audio/mpeg", url: "https://media.example/reference.mp3", durationSeconds: 3 };
const first: ProviderAssetInput = { ...image, id: "first", role: "firstFrame", url: "https://media.example/first.png" };
const last: ProviderAssetInput = { ...image, id: "last", role: "lastFrame", url: "https://media.example/last.png" };
const request = (model: string, parameters: Record<string, unknown> = {}, assets: readonly ProviderAssetInput[] = [],
  operation: NormalizedRequest["operation"] = "video.generate"): NormalizedRequest => ({
  connectionId, model, parameters, assets, operation, prompt, idempotencyKey: "single-native-video-submit",
});

function imageFallback() {
  // A permissive validation stub makes an accidental image fallback observable.
  return {
    testConnection: vi.fn(async () => undefined), listModels: vi.fn(async () => []),
    validate: vi.fn(async () => ({ valid: true, issues: [] })),
    submit: vi.fn(async (): Promise<ProviderTask> => { throw new Error("Unexpected image adapter fallback"); }),
    poll: vi.fn(async (): Promise<ProviderTask> => { throw new Error("Unexpected image adapter polling"); }),
    extractOutputs: vi.fn(async () => []),
  } satisfies ProviderAdapter;
}

function fixture(supplier: RemainingVideoSupplier, baseUrl: string, modelId: string, group: string,
  responses: Response[] = [], extra: Record<string, unknown> = {}, provider: ProviderName = "openai",
  selectedModel?: ModelDescriptor) {
  const model = selectedModel ?? remainingVideoModel(supplier, modelId, undefined, { group })!;
  const settings: Record<string, unknown> = {
    accountKeyGroup: group, modelGroup: group, modelScanStatus: "live",
    scannedModelIds: [modelId], modelCatalogModels: [model], ...extra,
  };
  const connection: ResolvedProviderConnection = { id: connectionId, provider, apiKey, baseUrl, settings };
  const resolver = new StaticConnectionResolver([connection]);
  const fallback = imageFallback();
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("Unexpected mocked network call"); });
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  const adapter = new AutoInterfaceAdapter(resolver, fallback, { fetch: fetcher });
  return { adapter, fetcher, fallback, resolver, connection, settings, model };
}

interface NativeCase {
  label: string; supplier: RemainingVideoSupplier; baseUrl: string; model: string; group: string;
  provider?: ProviderName; parameters: Record<string, unknown>; assets?: readonly ProviderAssetInput[];
  operation?: NormalizedRequest["operation"]; path: string; body: Record<string, unknown>;
}
const cases: NativeCase[] = [
  { label: "Secure Flow quality", supplier: "secure", baseUrl: "https://token.secure-skill.com/v1", model: "veo_quan", group: "Flow",
    parameters: { duration: 8, aspect_ratio: "16:9", resolution: "1080p" }, path: "/v1/jobs",
    body: { aspect_ratio: "16:9", resolution: "1080p", messages: [{ role: "user", content: prompt }] } },
  { label: "Secure Flow on a We-AI adapter connection", supplier: "secure", baseUrl: "https://token.secure-skill.com/v1", model: "veo_fast", group: "Flow", provider: "weai",
    parameters: { duration: 8, aspect_ratio: "16:9", resolution: "720p" }, path: "/v1/jobs",
    body: { aspect_ratio: "16:9", resolution: "720p", messages: [{ role: "user", content: prompt }] } },
  { label: "Secure Wan3 native media", supplier: "secure", baseUrl: "https://token.secure-skill.com/v1", model: "wan3.0-video", group: "Wan3",
    parameters: { duration: 6, aspect_ratio: "16:9", resolution: "720P", prompt_extend: false }, assets: [first], path: "/v1/videos/generations",
    body: { prompt, duration: 6, ratio: "16:9", resolution: "720P", prompt_extend: false, media: [{ type: "first_frame", url: first.url }] } },
  { label: "Secure Wan3 current bare directory model", supplier: "secure", baseUrl: "https://token.secure-skill.com/v1", model: "wan3.0", group: "Wan3",
    parameters: { duration: 6, aspect_ratio: "16:9", resolution: "720P" }, assets: [image, video, audio], path: "/v1/videos/generations",
    body: { prompt, duration: 6, ratio: "16:9", resolution: "720P", media: [{ type: "reference_image", url: image.url }, { type: "reference_video", url: video.url }, { type: "audio", url: audio.url }] } },
  { label: "Secure Grok voice IDs", supplier: "secure", baseUrl: "https://token.secure-skill.com/v1", model: "grok-imagine-video-1.5", group: "grok视频",
    parameters: { duration: 6, aspect_ratio: "9:16", resolution: "720p", reference_voice_ids: "voice_a, voice_b" }, assets: [image], path: "/openai/v1/videos",
    body: { prompt, seconds: 6, aspect_ratio: "9:16", resolution: "720p", image: { url: image.url }, reference_audios: [{ voice_id: "voice_a" }, { voice_id: "voice_b" }] } },
  { label: "Secure MiniMax native first and last frames", supplier: "secure", baseUrl: "https://token.secure-skill.com/v1", model: "minimax-h3", group: "MiniMax",
    parameters: { duration: 8, aspect_ratio: "16:9" }, assets: [first, last], path: "/v1/videos",
    body: { prompt, duration: 8, ratio: "16:9", first_frame: first.url, last_frame: last.url } },
  { label: "Secure SD2.5 by-seconds group", supplier: "secure", baseUrl: "https://token.secure-skill.com/v1", model: "seedance-2.5", group: "sd特价分组1",
    parameters: { duration: 10, aspect_ratio: "9:16", resolution: "720p" }, assets: [image, video, audio], path: "/v1/videos",
    body: { prompt, seconds: 10, aspect_ratio: "9:16", resolution: "720p", images: [image.url], videos: [video.url], audios: [audio.url] } },
  { label: "Secure SD2 by-request group", supplier: "secure", baseUrl: "https://token.secure-skill.com/v1", model: "seedance2.0", group: "sd特价分组1",
    parameters: { duration: 10, aspect_ratio: "16:9", resolution: "720p" }, assets: [image], path: "/v1/videos",
    body: { prompt, duration: 10, aspect_ratio: "16:9", resolution: "720p", images: [image.url] } },
  { label: "Secure shared SD2.5 ID in VividAI group", supplier: "secure", baseUrl: "https://token.secure-skill.com/v1", model: "seedance-2.5", group: "vividai-video",
    parameters: { duration: 15, aspect_ratio: "9:16", resolution: "1080p" }, assets: [image], path: "/v1/videos",
    body: { prompt, duration: 15, resolution: "1080p", image_urls: [image.url] } },
  { label: "FriModel Seedance camel-case references", supplier: "frimodel", baseUrl: "https://api.frimodel.com/v1", model: "videos-standard", group: "视频",
    parameters: { duration: 6, aspect_ratio: "9:16", resolution: "1080p" }, assets: [image, video, audio], path: "/v1/videos",
    body: { prompt, duration: 6, ratio: "9:16", resolution: "1080p", referenceImages: [image.url], referenceVideos: [video.url], referenceAudios: [audio.url] } },
  { label: "FriModel Grok single-image mode", supplier: "frimodel", baseUrl: "https://api.frimodel.com/v1", model: "grok-imagine-video-1.5-preview", group: "grok",
    parameters: { duration: 6, aspect_ratio: "16:9", resolution: "1080p" }, assets: [image], operation: "video.image-to-video", path: "/v1/videos",
    body: { prompt, duration: 6, aspect_ratio: "16:9", resolution: "1080p", image: image.url, mode: "image-to-video" } },
  { label: "Afei fixed-duration SD", supplier: "cyberafei", baseUrl: "https://api.3365api.cn/v1", model: "video-v1-10s", group: "视频",
    parameters: { duration: 10, aspect_ratio: "9:16" }, assets: [image], path: "/v1/video/generations",
    body: { prompt, ratio: "9:16", images: [image.url] } },
  { label: "Afei fixed-resolution Grok", supplier: "cyberafei", baseUrl: "https://api.3365api.cn/v1", model: "grok-imagine-video-1.5-1080p", group: "grok",
    parameters: { duration: 6, aspect_ratio: "16:9", resolution: "1080p" }, assets: [image], operation: "video.image-to-video", path: "/v1/videos/generations",
    body: { prompt, duration: 6, aspect_ratio: "16:9", image: { url: image.url } } },
  { label: "We-AI Omni components", supplier: "weai", baseUrl: "https://video.we-token.cc/v1", model: "omni-flash-components-1080p", group: "视频", provider: "weai",
    parameters: { duration: 6, aspect_ratio: "9:16", resolution: "1080p" }, assets: [image], operation: "video.image-to-video", path: "/v1/videos",
    body: { prompt, seconds: 6, aspect_ratio: "9:16", images: [image.url] } },
];

describe("native video routing without a saved REST connector", () => {
  it("uses Omni's Video endpoint for generation without forwarding its price mode", async () => {
    const localImage: ProviderAssetInput = { id: "local", kind: "image", mimeType: "image/png", data: new Uint8Array([3, 2, 1]) };
    const f = fixture("cyberafei", "https://api.3365api.cn/v1", "omni-flash", "图片视频模型综合分组", [
      Response.json({ id: "omni-generation", status: "queued" }), Response.json({ status: "completed", url: "https://media.example/omni.mp4" }),
    ]);
    const input = request("omni-flash", { mode: "generate", duration: 6, size: "1280x720" }, [localImage]);
    expect((await f.adapter.validate(input)).valid).toBe(true);
    const task = await f.adapter.submit(input);
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://api.3365api.cn/v1/videos");
    const body = f.fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("model")).toBe("omni-flash");
    expect(body.get("seconds")).toBe("6");
    expect(body.get("size")).toBe("1280x720");
    expect(body.has("mode")).toBe(false);
    expect(new Uint8Array(await (body.get("input_reference") as Blob).arrayBuffer())).toEqual(localImage.data);
    const finished = await f.adapter.poll(task);
    expect(f.fetcher.mock.calls[1]?.[0]).toBe("https://api.3365api.cn/v1/videos/omni-generation");
    expect(await f.adapter.extractOutputs(finished.result)).toMatchObject([{ kind: "video", url: "https://media.example/omni.mp4" }]);
  });

  it("uses Omni's Chat endpoint for source-video editing and preserves URLs", async () => {
    const f = fixture("cyberafei", "https://api.3365api.cn/v1", "omni-flash", "图片视频模型综合分组", [
      Response.json({ id: "sync-omni", choices: [{ message: { content: "[视频](https://media.example/omni-edited.mp4)" } }] }),
    ]);
    const input = request("omni-flash", { mode: "edit", duration: 6, resolution: "720p", crop: "unimplemented" }, [image, video]);
    expect((await f.adapter.validate(input)).valid).toBe(true);
    const task = await f.adapter.submit(input);
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://api.3365api.cn/v1/chat/completions");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: "omni-flash", stream: false, messages: [{ role: "user", content: [
      { type: "text", text: `${prompt}\n参考视频 1: ${video.url}` },
      { type: "image_url", image_url: { url: image.url, detail: "high" } },
    ] }] });
    expect(task.status).toBe("succeeded");
    expect(await f.adapter.extractOutputs(task.result)).toMatchObject([{ kind: "video", url: "https://media.example/omni-edited.mp4" }]);
    expect(f.fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    { label: "edit without source video", parameters: { mode: "edit" }, assets: [image] },
    { label: "generation price with source video", parameters: { mode: "generate" }, assets: [video] },
    { label: "insecure source video", parameters: { mode: "edit" }, assets: [{ ...video, url: "http://media.example/video.mp4" }] },
  ])("rejects Omni $label before transport", async entry => {
    const f = fixture("cyberafei", "https://api.3365api.cn/v1", "omni-flash", "图片视频模型综合分组");
    const input = request("omni-flash", entry.parameters, entry.assets);
    expect((await f.adapter.validate(input)).valid).toBe(false);
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("does not resubmit Omni editing when Chat returns only text or an ID", async () => {
    const f = fixture("cyberafei", "https://api.3365api.cn/v1", "omni-flash", "图片视频模型综合分组", [
      Response.json({ id: "chat-only-id", choices: [{ message: { content: "accepted" } }] }),
    ]);
    await expect(f.adapter.submit(request("omni-flash", { mode: "auto" }, [video])))
      .rejects.toMatchObject({ details: { kind: "invalid_response", retryable: false, submissionMayHaveOccurred: true } });
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it.each([
    { supplier: "cyberafei" as const, base: "https://api.3365api.cn", endpoint: "openai" },
    { supplier: "miaowu" as const, base: "https://api.miaowuai.store", endpoint: "openai" },
  ])("accepts a future $supplier video directory alias through its declared chat endpoint", async entry => {
    const id = "future-video-directory-alias";
    const current: ModelDescriptor = { id, name: id, operations: ["video.generate"], outputKinds: ["video"], metadata: {
      endpointTypes: [entry.endpoint], outputKindsSource: "declared", operationsSource: "declared", canvasRunnable: false,
      canvasUnavailableReason: "该型号的视频参数与调用协议待供应商文档确认" } };
    const f = fixture(entry.supplier, entry.base, id, "video-group", [Response.json({ choices: [{ message: { video_url: "https://media.example/future.mp4" } }] })], {}, "openai", current);
    const task = await f.adapter.submit(request(id, { duration: 20, provider_unknown_field: true }));
    expect(f.fetcher.mock.calls[0]?.[0]).toBe(`${entry.base}/v1/chat/completions`);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, stream: false, messages: [{ role: "user", content: prompt }] });
    expect(task.status).toBe("succeeded");
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });
  it("accepts a future Cyber video alias through its declared generic multipart endpoint", async () => {
    const id = "future-openai-video-directory-alias";
    const current: ModelDescriptor = { id, name: id, operations: ["video.generate"], outputKinds: ["video"], metadata: {
      endpointTypes: ["openai", "openai-video"], outputKindsSource: "declared", operationsSource: "declared" } };
    const f = fixture("cyberafei", "https://api.3365api.cn", id, "video-group", [Response.json({ id: "future-native-task", status: "queued" })], {}, "openai", current);
    await f.adapter.submit(request(id, { duration: 9, provider_unknown_field: true }));
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://api.3365api.cn/v1/videos");
    const body = f.fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("model")).toBe(id);
    expect(body.get("seconds")).toBe("9");
    expect(body.has("provider_unknown_field")).toBe(false);
  });
  it.each([
    { label: "text output", output: "text" as const, endpoints: ["openai"] },
    { label: "unsupported endpoint", output: "video" as const, endpoints: ["custom-video"] },
    { label: "missing endpoint", output: "video" as const, endpoints: [] },
  ])("does not infer a future directory contract with $label", async entry => {
    const id = "future-directory-alias";
    const current: ModelDescriptor = { id, name: id, operations: ["video.generate"], outputKinds: [entry.output], metadata: { endpointTypes: entry.endpoints, outputKindsSource: "declared" } };
    const f = fixture("cyberafei", "https://api.3365api.cn", id, "video-group", [], {}, "openai", current);
    await expect(f.adapter.submit(request(id))).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });
  it.each(["kling-3.0", "grok-imagine-video", "grok-imagine-video-1.5"])("uses Cyber's declared OpenAI chat video protocol for %s", async id => {
    const f = fixture("cyberafei", "https://api.3365api.cn/v1", id, "图片视频模型综合分组",
      [Response.json({ id: "chat-not-a-task", choices: [{ message: { role: "assistant", content: "[视频](https://media.example/result.mp4)" } }] })]);
    const task = await f.adapter.submit(request(id, { duration: 12, resolution: "invented" }, [image]));
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://api.3365api.cn/v1/chat/completions");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, stream: false, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: image.url, detail: "high" } }] }] });
    expect(task.status).toBe("succeeded");
    expect(await f.adapter.extractOutputs(task.result)).toMatchObject([{ kind: "video", url: "https://media.example/result.mp4" }]);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });
  it("does not retry or accept Cyber chat text without video output", async () => {
    const f = fixture("cyberafei", "https://api.3365api.cn", "kling-3.0", "视频",
      [Response.json({ id: "not-a-video", choices: [{ message: { content: "Task accepted but no video" } }] })]);
    await expect(f.adapter.submit(request("kling-3.0"))).rejects.toMatchObject({ details: { kind: "invalid_response", retryable: false, submissionMayHaveOccurred: true } });
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });
  it.each(["veo_3_1_i2v_lite", "veo_3_1_interpolation_lite"])("submits Flow's current bare ID %s using only the common Job message contract", async id => {
    const f = fixture("secure", "https://token.secure-skill.com/v1", id, "Flow", [Response.json({ id: "flow-bare-task", status: "queued" }), Response.json({ status: "completed", url: "https://media.example/flow.mp4" })]);
    const task = await f.adapter.submit(request(id, { duration: 8, aspect_ratio: "9:16", resolution: "4k", mode: "invented" }, [image, { ...image, id: "second-image" }], "video.image-to-video"));
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://token.secure-skill.com/v1/jobs");
    const body = JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ model: id, messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...Array.from({ length: 2 }, () => ({ type: "image_url", image_url: { url: image.url } }))] }] });
    expect((await f.adapter.poll(task)).status).toBe("succeeded");
    expect(f.fetcher.mock.calls[1]?.[0]).toBe("https://token.secure-skill.com/v1/jobs/flow-bare-task");
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });
  it.each(["grok-imagine-video", "grok-imagine-video-1.5"])("submits and recovers Hang's deployed Grok %s async contract", async id => {
    const f = fixture("hangzhale", "https://api.hangzhale.com", id, "Grok Heavy",
      [Response.json({ request_id: "hang-video-task", status: "pending" }), Response.json({ status: "done", video: { url: "https://media.example/hang.mp4" } })]);
    const task = await f.adapter.submit(request(id, { duration: 8, aspect_ratio: "16:9", resolution: "720p", seconds_wrong: 42 }, [image], id.endsWith("1.5") ? "video.image-to-video" : "video.generate"));
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://api.hangzhale.com/v1/videos/generations");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt, duration: 8, aspect_ratio: "16:9", resolution: "720p", reference_images: [{ url: image.url }] });
    const state = await f.adapter.poll(JSON.parse(JSON.stringify(task)) as ProviderTask);
    expect(state.status).toBe("succeeded");
    expect(f.fetcher.mock.calls[1]?.[0]).toBe("https://api.hangzhale.com/v1/videos/hang-video-task");
    expect(await f.adapter.extractOutputs(state.result)).toEqual([{ kind: "video", url: "https://media.example/hang.mp4", mimeType: "video/mp4" }]);
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });
  it("repairs only an exact directory video's old missing-contract gate without mutating the connection", async () => {
    const id = "grok-imagine-video-1.5（按次）";
    const current: ModelDescriptor = { id, name: id, operations: [], outputKinds: ["text"], metadata: { canvasRunnable: false,
      canvasUnavailableReason: "该型号的视频参数与调用协议待供应商文档确认", outputKindsSource: "inferred", operationsSource: "inferred", autoInterfaceStatus: "incomplete" } };
    const f = fixture("chentu", "https://tu.988236.xyz", id, "grok纯享视频", [Response.json({ id: "restored-video-task", status: "queued" })], {}, "openai", current);
    const before = structuredClone(f.connection);
    expect((await f.adapter.validate(request(id, { duration: 8 }, [image]))).valid).toBe(true);
    await f.adapter.submit(request(id, { duration: 8 }, [image]));
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://tu.988236.xyz/v1/videos");
    expect(f.connection).toEqual(before);
  });
  it.each(["minimax-h3", "seedance2.0", "seedance2.5", "veo3.1", "veo3.1-fast", "veo3.1-lite"])("uses Afei's published openai-video endpoint for %s", async id => {
    const f = fixture("cyberafei", "https://api.3365api.cn", id, "图片视频模型综合分组", [Response.json({ id: "afei-openai-task", status: "queued" })]);
    const data = new Uint8Array([137, 80, 78, 71]);
    const task = await f.adapter.submit(request(id, { duration: 8, aspect_ratio: "16:9", resolution: "720p" }, [{ id: "local-ref", kind: "image", mimeType: "image/png", data }], "video.image-to-video"));
    expect(f.fetcher).toHaveBeenCalledOnce();
    const [url, init] = f.fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.3365api.cn/v1/videos");
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model")).toBe(id);
    expect(form.get("seconds")).toBe("8");
    expect(form.get("size")).toBe("1280x720");
    expect(new Uint8Array(await (form.get("input_reference") as Blob).arrayBuffer())).toEqual(data);
    expect(form.has("resolution")).toBe(false);
    f.fetcher.mockResolvedValueOnce(Response.json({ id: "afei-openai-task", status: "completed", video_url: "https://media.example/afei.mp4" }));
    expect(await f.adapter.poll(JSON.parse(JSON.stringify(task)) as ProviderTask)).toMatchObject({ status: "succeeded" });
    expect(f.fetcher.mock.calls[1]?.[0]).toBe("https://api.3365api.cn/v1/videos/afei-openai-task");
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });
  it("uploads Mikoto's local frame bytes and preserves its multipart task for recovery", async () => {
    const f = fixture("mikoto", "https://api.mikoto.vip/v1", "grok-imagine-video-1.5", "grok heavy", [Response.json({ id: "mikoto-task", status: "queued" })]);
    const firstBytes = new Uint8Array([137, 80, 78, 71]), lastBytes = new Uint8Array([137, 80, 78, 72]);
    const inputs: ProviderAssetInput[] = [{ id: "first-local", kind: "image", role: "firstFrame", mimeType: "image/png", data: firstBytes },
      { id: "last-local", kind: "image", role: "lastFrame", mimeType: "image/png", data: lastBytes }];
    const task = await f.adapter.submit(request("grok-imagine-video-1.5", { duration: 6, resolution: "720p", aspect_ratio: "16:9" }, inputs, "video.image-to-video"));
    expect(f.fetcher).toHaveBeenCalledOnce();
    const [url, init] = f.fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.mikoto.vip/v1/videos");
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model")).toBe("grok-imagine-video-1.5");
    expect(form.get("seconds")).toBe("6");
    expect(form.get("size")).toBe("1280x720");
    expect(form.get("resolution_name")).toBe("720p");
    expect(form.get("mode")).toBe("frames");
    expect(new Uint8Array(await (form.get("first_frame") as Blob).arrayBuffer())).toEqual(firstBytes);
    expect(new Uint8Array(await (form.get("last_frame") as Blob).arrayBuffer())).toEqual(lastBytes);
    expect(form.has("image[]")).toBe(false);
    f.fetcher.mockResolvedValueOnce(Response.json({ id: "mikoto-task", status: "completed", video_url: "https://media.example/mikoto.mp4" }));
    expect(await f.adapter.poll(JSON.parse(JSON.stringify(task)) as ProviderTask)).toMatchObject({ status: "succeeded" });
    expect(f.fetcher.mock.calls[1]?.[0]).toBe("https://api.mikoto.vip/v1/videos/mikoto-task");
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });
  it.each(cases)("validates and submits $label through its exact supplier contract", async entry => {
    const f = fixture(entry.supplier, entry.baseUrl, entry.model, entry.group,
      [Response.json({ id: "native_task", status: "queued" })], {}, entry.provider);
    const originalSettings = structuredClone(f.settings);
    const input = request(entry.model, entry.parameters, entry.assets, entry.operation);
    expect((await f.adapter.validate(input)).valid).toBe(true);
    expect(f.fetcher).not.toHaveBeenCalled();
    const task = await f.adapter.submit(input);
    expect(task).toMatchObject({ providerTaskId: "native_task", status: "queued", result: { autoInterface: true } });
    expect(f.fetcher).toHaveBeenCalledOnce();
    const [url, init] = f.fetcher.mock.calls[0]!;
    expect(url).toBe(new URL(entry.path, entry.baseUrl).toString());
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
    expect(JSON.parse(String(init?.body))).toEqual({ model: entry.model, ...entry.body });
    expect(f.fallback.validate).not.toHaveBeenCalled();
    expect(f.fallback.submit).not.toHaveBeenCalled();
    expect(f.settings).toEqual(originalSettings);
    expect(f.settings).not.toHaveProperty("connector");
  });

  it.each([
    { supplier: "secure" as const, baseUrl: "https://token.secure-skill.com/v1", model: "wan3.0-video", group: "Wan3", parameters: { duration: 6, aspect_ratio: "16:9", resolution: "720P" }, poll: "/v1/videos/tasks/recovered_task", output: "https://media.example/result.mp4" },
    { supplier: "secure" as const, baseUrl: "https://token.secure-skill.com/v1", model: "veo_quan", group: "Flow", parameters: { duration: 8, aspect_ratio: "16:9", resolution: "1080p" }, poll: "/v1/jobs/recovered_task", output: "https://media.example/result.mp4" },
  ])("restores $model with its frozen poll and output contract after settings change", async entry => {
    const f = fixture(entry.supplier, entry.baseUrl, entry.model, entry.group, [Response.json({ task_id: "recovered_task", status: "queued" })]);
    const task = JSON.parse(JSON.stringify(await f.adapter.submit(request(entry.model, entry.parameters)))) as ProviderTask;
    const restartedFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ status: "completed", video_url: entry.output }));
    const restartedFallback = imageFallback();
    const changed = new StaticConnectionResolver([{ ...f.connection, settings: {
      accountKeyGroup: "different-group", modelScanStatus: "unauthorized", scannedModelIds: [], modelCatalogModels: [],
      connector: { submit: { path: "/wrong-images", method: "POST", bodyMode: "json" },
        poll: { path: "/wrong-poll/{taskId}", method: "GET" }, output: { kind: "image", path: "$.wrong_images" } },
    } }]);
    const restarted = new AutoInterfaceAdapter(changed, restartedFallback, { fetch: restartedFetch });
    const state = await restarted.poll(task);
    expect(state.status).toBe("succeeded");
    expect(restartedFetch.mock.calls[0]?.[0]).toBe(new URL(entry.poll, entry.baseUrl).toString());
    expect(new Headers(restartedFetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
    expect(await restarted.extractOutputs(state.result)).toEqual([{ kind: "video", url: entry.output, mimeType: "video/mp4" }]);
    expect(restartedFallback.poll).not.toHaveBeenCalled();
    expect(restartedFallback.extractOutputs).not.toHaveBeenCalled();
    expect(restartedFetch.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(0);
  });

  it("recovers Secure Grok and downloads relative task content using the original connection Key", async () => {
    const model = "grok-imagine-video-1.5";
    const f = fixture("secure", "https://token.secure-skill.com/v1", model, "grok视频",
      [Response.json({ request_id: "grok_task", status: "queued" })]);
    const task = JSON.parse(JSON.stringify(await f.adapter.submit(request(model, { duration: 6, aspect_ratio: "16:9", resolution: "720p" })))) as ProviderTask;
    const content = "/openai/v1/videos/grok_task/content";
    const restartedFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "completed", video: { url: content } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }));
    const fallback = imageFallback();
    const restarted = new AutoInterfaceAdapter(new StaticConnectionResolver([{ ...f.connection,
      settings: { accountKeyGroup: "Flow", scannedModelIds: [], modelCatalogModels: [] } }]), fallback, { fetch: restartedFetch });
    const state = await restarted.poll(task);
    expect(state.status).toBe("succeeded");
    expect(await restarted.extractOutputs(state.result)).toEqual([{ kind: "video", data: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" }]);
    expect(restartedFetch.mock.calls.map(call => call[0])).toEqual([
      "https://token.secure-skill.com/v1/videos/grok_task", "https://token.secure-skill.com/openai/v1/videos/grok_task/content",
    ]);
    for (const [, init] of restartedFetch.mock.calls) {
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
    }
    expect(fallback.poll).not.toHaveBeenCalled();
    expect(fallback.extractOutputs).not.toHaveBeenCalled();
  });

  it.each(["unauthorized", "empty"])("rejects a cached native contract when the current Key scan is %s", async modelScanStatus => {
    const f = fixture("secure", "https://token.secure-skill.com/v1", "veo_quan", "Flow", [], { modelScanStatus });
    const input = request("veo_quan", { duration: 8, aspect_ratio: "16:9", resolution: "720p" });
    expect((await f.adapter.validate(input)).valid).toBe(false);
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.fallback.validate).not.toHaveBeenCalled();
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it.each([{ scannedModelIds: [] }, { scannedModelIds: ["veo_fast"] }])("does not add a documented model excluded by $scannedModelIds", async entry => {
    const f = fixture("secure", "https://token.secure-skill.com/v1", "veo_quan", "Flow", [], entry);
    const input = request("veo_quan", { duration: 8, aspect_ratio: "16:9", resolution: "720p" });
    expect((await f.adapter.validate(input)).valid).toBe(false);
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it.each(["text", "image", "audio"] as const)("does not overwrite explicit %s output evidence with a known video ID", async output => {
    const known = remainingVideoModel("secure", "veo_quan", undefined, { group: "Flow" })!;
    const model: ModelDescriptor = { ...known, outputKinds: [output], metadata: { ...known.metadata, outputKindsSource: "declared" } };
    const f = fixture("secure", "https://token.secure-skill.com/v1", model.id, "Flow", [], {}, "openai", model);
    const input = request(model.id, { duration: 8, aspect_ratio: "16:9", resolution: "720p" });
    expect((await f.adapter.validate(input)).valid).toBe(false);
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it.each([
    { model: "veo_quan", realGroup: "普通默认", catalogGroup: "Flow", duration: 8 },
    { model: "seedance-2.5", realGroup: "default", catalogGroup: "sd特价分组1", duration: 10 },
  ])("does not borrow $model from a different group cached in model metadata", async entry => {
    const model = remainingVideoModel("secure", entry.model, undefined, { group: entry.catalogGroup })!;
    const f = fixture("secure", "https://token.secure-skill.com/v1", entry.model, entry.realGroup, [], {}, "openai", model);
    const input = request(entry.model, { duration: entry.duration, aspect_ratio: "16:9", resolution: "720p" });
    expect((await f.adapter.validate(input)).valid).toBe(false);
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it.each([
    { label: "missing current group", settings: { accountKeyGroup: undefined, modelGroup: undefined } },
    { label: "default current group", settings: { accountKeyGroup: "default", modelGroup: "default" } },
  ])("does not use cached Flow group metadata with $label", async entry => {
    const known = remainingVideoModel("secure", "veo_quan", undefined, { group: "Flow" })!;
    const model: ModelDescriptor = { ...known,
      metadata: { ...known.metadata, modelGroup: "Flow", groupDescription: "Flow video group", supplierGroupDescription: "Flow" } };
    const f = fixture("secure", "https://token.secure-skill.com/v1", model.id, "default", [], entry.settings, "openai", model);
    const input = request(model.id, { duration: 8, aspect_ratio: "16:9", resolution: "720p" });
    expect((await f.adapter.validate(input)).valid).toBe(false);
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.fallback.validate).not.toHaveBeenCalled();
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it("checks native voice and resolution constraints before submitting", async () => {
    const model = "grok-imagine-video-1.5";
    const f = fixture("secure", "https://token.secure-skill.com/v1", model, "grok视频");
    const input = request(model, { duration: 6, aspect_ratio: "16:9", resolution: "1080p", reference_voice_ids: "voice_a" });
    const validation = await f.adapter.validate(input);
    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.resolution" })]));
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it("does not freeze out native validation and normalization with an old options.config", async () => {
    const model = "grok-imagine-video-1.5";
    const f = fixture("secure", "https://token.secure-skill.com/v1", model, "grok视频", [Response.json({ id: "dynamic_native", status: "queued" })]);
    const fixedImages: RestConnectorConfig = {
      submit: { path: "/wrong-images", method: "POST", bodyMode: "json", template: { image_only: true } },
      output: { kind: "image", path: "$.data" },
    };
    const adapter = new AutoInterfaceAdapter(f.resolver, f.fallback, { fetch: f.fetcher, config: fixedImages });
    const invalid = request(model, { duration: 6, aspect_ratio: "16:9", resolution: "1080p", reference_voice_ids: "voice_a" });
    expect((await adapter.validate(invalid)).valid).toBe(false);
    await expect(adapter.submit(invalid)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    await adapter.submit(request(model, { duration: 6, aspect_ratio: "16:9", resolution: "720p", reference_voice_ids: "voice_a" }));
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://token.secure-skill.com/openai/v1/videos");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      model, prompt, seconds: 6, aspect_ratio: "16:9", resolution: "720p", reference_audios: [{ voice_id: "voice_a" }],
    });
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it.each([
    { id: "custom-documented-video", operation: "video.generate" as const, output: "video" as const, provider: "openai" as const },
    { id: "custom-documented-music", operation: "music.generate" as const, output: "audio" as const, provider: "weai" as const },
  ])("preserves an exact explicitly saved media contract for $id", async entry => {
    const model: ModelDescriptor = { id: entry.id, name: entry.id, operations: [entry.operation], outputKinds: [entry.output],
      metadata: { outputKindsSource: "declared", operationsSource: "declared" } };
    const connector: RestConnectorConfig = { auth: { type: "bearer" },
      submit: { path: "/v1/custom-media", method: "POST", bodyMode: "json", mappings: [
        { target: "/model", source: { kind: "request", path: "$.model" } },
        { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      ] }, output: { kind: entry.output, path: "$.result_url", defaultMimeType: entry.output === "video" ? "video/mp4" : "audio/mpeg" },
    };
    const url = `https://media.example/result.${entry.output === "video" ? "mp4" : "mp3"}`;
    const f = fixture("secure", "https://token.secure-skill.com/v1", entry.id, "custom", [Response.json({ result_url: url })],
      { autoModelInterfaces: { [entry.id]: { model, connector, sourceUrl: "https://token.secure-skill.com/custom-docs" } } }, entry.provider, model);
    const input = request(entry.id, {}, [], entry.operation);
    expect((await f.adapter.validate(input)).valid).toBe(true);
    const task = await f.adapter.submit(input);
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://token.secure-skill.com/v1/custom-media");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: entry.id, prompt });
    expect(await f.adapter.extractOutputs(task.result)).toEqual([{ kind: entry.output, url, mimeType: entry.output === "video" ? "video/mp4" : "audio/mpeg" }]);
    expect(f.fallback.validate).not.toHaveBeenCalled();
    expect(f.fallback.submit).not.toHaveBeenCalled();
    expect(f.fallback.extractOutputs).not.toHaveBeenCalled();
  });

  it("does not submit a native contract when its connection Key is missing", async () => {
    const f = fixture("secure", "https://token.secure-skill.com/v1", "veo_quan", "Flow");
    const missingKey = { ...f.connection };
    delete missingKey.apiKey;
    f.resolver.add(missingKey);
    const input = request("veo_quan", { duration: 8, aspect_ratio: "16:9", resolution: "720p" });
    expect((await f.adapter.validate(input)).valid).toBe(false);
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it.each([
    { supplier: "secure" as const, baseUrl: "https://token.secure-skill.com/v1", id: "suno-new-unconfirmed", operation: "music.generate" as const, output: "audio" as const, provider: "openai" as const },
    { supplier: "weai" as const, baseUrl: "https://video.we-token.cc/v1", id: "seedance-2.0", operation: "video.generate" as const, output: "video" as const, provider: "weai" as const },
  ])("does not enable an unconfirmed native contract for $id", async entry => {
    const model: ModelDescriptor = { id: entry.id, name: entry.id, operations: [entry.operation], outputKinds: [entry.output],
      metadata: { outputKindsSource: "declared", operationsSource: "declared" } };
    const f = fixture(entry.supplier, entry.baseUrl, entry.id, "视频", [], {}, entry.provider, model);
    const input = request(entry.id, {}, [], entry.operation);
    expect((await f.adapter.validate(input)).valid).toBe(false);
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it("keeps an accepted native response without a task ID uncertain and never tries an image retry", async () => {
    const f = fixture("secure", "https://token.secure-skill.com/v1", "veo_quan", "Flow", [Response.json({ status: "queued" })]);
    await expect(f.adapter.submit(request("veo_quan", { duration: 8, aspect_ratio: "16:9", resolution: "720p" })))
      .rejects.toMatchObject({ details: { kind: "invalid_response", retryable: false, submissionMayHaveOccurred: true } });
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });
});

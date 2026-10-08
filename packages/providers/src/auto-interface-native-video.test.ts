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

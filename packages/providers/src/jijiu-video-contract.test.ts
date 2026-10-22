import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, NormalizedRequest, ProviderAdapter, ProviderAssetInput, ProviderTask } from "./contracts.js";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import { StaticConnectionResolver } from "./credentials.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";
import { scanProviderModelCatalog } from "./model-catalog.js";
import { remainingVideoModel, remainingVideoSupplier } from "./remaining-video-contracts.js";
import { isJijiuApiUrl, isJijiuWanVideoModel, jijiuVideoModel, jijiuVideoModelIds, jijiuVideoRequestIssues, jijiuVideoTransport, normalizeJijiuVideoParameters } from "./jijiu-video-contract.js";

const request = (model = "MinimaxH3", parameters: Record<string, unknown> = {}, assets: readonly ProviderAssetInput[] = []): NormalizedRequest => ({ connectionId: "jijiu-offline-fixture", operation: "video.generate", prompt: "Offline contract fixture", idempotencyKey: "single-fixture-request", model, parameters, assets });
const image: ProviderAssetInput = { id: "fixture-image", kind: "image", mimeType: "image/png", url: "https://media.example/ref.png" };
const audio: ProviderAssetInput = { id: "fixture-audio", kind: "audio", mimeType: "audio/mpeg", url: "https://media.example/ref.mp3", durationSeconds: 3 };
const video: ProviderAssetInput = { id: "fixture-video", kind: "video", mimeType: "video/mp4", url: "https://media.example/ref.mp4", durationSeconds: 6 };
function fixture(id = "MinimaxH3", responses: Response[] = [], extra: Record<string, unknown> = {}) {
  const model = jijiuVideoModel(id)!;
  const resolver = new StaticConnectionResolver([{ id: "jijiu-offline-fixture", provider: "openai", apiKey: "fixture-key-only", baseUrl: "https://newapi.jijiucanvas.com/v1",
    settings: { scannedModelIds: [id], modelCatalogModels: [model], modelScanStatus: "live", usage: "canvas", ...extra } }]);
  const fallback: ProviderAdapter = { testConnection: vi.fn(), listModels: vi.fn(async () => []), validate: vi.fn(async () => ({ valid: true, issues: [] })), submit: vi.fn(async () => { throw new Error("unexpected image submit"); }), poll: vi.fn(async () => { throw new Error("unexpected image poll"); }), extractOutputs: vi.fn(async () => []) };
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("unexpected network"); });
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  return { resolver, fetcher, fallback, adapter: new AutoInterfaceAdapter(resolver, fallback, { fetch: fetcher }) };
}

describe("Jijiu exact official video contracts (offline only)", () => {
  it("replaces stale cached fixed durations and keeps current discrete values without clipping old inputs", () => {
    const old = { id: "SD2.5特价30-10-10-线路一", name: "fixture", operations: ["video.generate"], metadata: { videoDurationValues: [5], videoSupportsAutomaticDuration: true } } as ModelDescriptor;
    expect(jijiuVideoModel(old.id, old)?.metadata?.videoDurationValues).toBeUndefined();
    expect(jijiuVideoModel(old.id, old)?.metadata?.videoSupportsAutomaticDuration).toBeUndefined();
    const id = "SD2.0fast稳定900D", input = request(id, { duration: 7, aspect_ratio: "16:9" }), before = structuredClone(input);
    expect(jijiuVideoRequestIssues(input)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" }), expect.objectContaining({ path: "parameters.aspect_ratio" })]));
    expect(input).toEqual(before);
    expect(jijiuVideoModel(id)?.metadata?.videoAspectRatioPresets).toEqual([{ label: "9:16", value: "9:16" }]);
  });

  it.each([
    ["满血seedance-2.5全参A", "imageUrls", undefined, "audioUrls"],
    ["SD2.0满血稳定933-线路一", "images", undefined, "audios"],
    ["SD2.0满血稳定933-线路四", "images", "videos", "audios"],
    ["SD2.0mini稳定903C", "image_urls", undefined, "audio_urls"],
    ["SD2.5特价30-10线路二", "images", "videos", "audios"],
    ["SD2.5特价30-10-10-线路三", "images", "video_refs", "audio_refs"],
    ["SD2.5特价30-10-10-线路二", "image_urls", "video_urls", "audio_urls"],
    ["满血seedance-2.5全参C", "images", "video_refs", "audio_refs"],
    ["稳定seedance-2.5全参E", "image_refs", undefined, "audio_refs"],
    ["稳定seedance-2.5全参D", "images", undefined, "audio_refs"],
    ["SD2.5特价30-10-10-线路四", "images", "videos", "audios"],
  ])("maps %s to its current exact material fields", async (id, imageField, videoField, audioField) => {
    const assets = [image, ...(videoField ? [video] : []), ...(audioField ? [audio] : [])];
    const input = request(id!, { duration: 5 }, assets);
    const f = fixture(id!, [Response.json({ id: "task-fixture", status: "queued" })]);
    await f.adapter.submit(input);
    const body = JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body));
    expect(body[imageField!]).toEqual([image.url]);
    if (videoField) expect(body[videoField]).toEqual([video.url]);
    if (audioField) expect(body[audioField]).toEqual([audio.url]);
    if (id === "稳定seedance-2.5全参E") expect(body.reference_video_seconds).toBeUndefined();
  });

  it("rejects E reference videos and does not turn H3 canvas presets into API bounds", () => {
    expect(jijiuVideoRequestIssues(request("稳定seedance-2.5全参E", { duration: 5 }, [video]))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "assets" })]));
    const h3 = jijiuVideoModel("MinimaxH3")!;
    expect(h3.metadata).toMatchObject({ videoDocumentedCanvasDurationRange: { min: 4, max: 15 }, videoApiDurationRangeUnverified: true, videoResolutionOutputUnverified: true });
    expect(h3.metadata?.videoMaxDuration).toBeUndefined();
    expect(jijiuVideoRequestIssues(request("MinimaxH3", { duration: 120 }))).toEqual([]);
  });
  it("only identifies the precise origin and approved API root", () => {
    expect(remainingVideoSupplier("https://newapi.jijiucanvas.com/v1")).toBe("jijiu");
    for (const url of ["http://newapi.jijiucanvas.com/v1", "https://newapi.jijiucanvas.com/proxy/v1", "https://newapi.jijiucanvas.com/v1?x=1", "https://user@newapi.jijiucanvas.com", "https://newapi.jijiucanvas.com.example/v1", "https://ai.jiasuapi.com/v1"]) expect(isJijiuApiUrl(url)).toBe(false);
    expect(jijiuVideoModel("minimax-h3")).toBeUndefined();
    expect(jijiuVideoModel("gpt-image-2")).toBeUndefined();
  });

  it("discovers the new exact IDs and retains historical contracts with chat endpoint labels", () => {
    const ids = jijiuVideoModelIds(); expect(ids).toHaveLength(31);
    const scan = scanProviderModelCatalog({ data: ids.map(id => ({ id, supported_endpoint_types: ["openai"] })) }, { baseUrl: "https://newapi.jijiucanvas.com/v1" });
    expect(scan.models).toHaveLength(31);
    expect(scan.models.every(m => m.outputKinds?.includes("video") && m.metadata?.canvasRunnable === true)).toBe(true);
    expect(scanProviderModelCatalog({ data: [{ id: "SD2.5特价30-10-10-线路一" }] }, { baseUrl: "https://other.example/v1" }).models[0]?.metadata?.jijiuVideoContract).toBeUndefined();
  });

  it.each(jijiuVideoModelIds().filter(id => id !== "SD2.0特价933-线路五"))("submits the exact model %s and its legal bounds without real network", async id => {
    const model = remainingVideoModel("jijiu", id)!, duration = model.parameters!.find(p => p.key === "duration")!;
    const openDuration = model.metadata?.videoApiDurationRangeUnverified === true;
    const min = openDuration ? 1 : Number(model.metadata?.videoMinDuration), max = openDuration ? 120 : Number(model.metadata?.videoMaxDuration);
    const values = [...new Set([min, max])];
    for (const value of values) {
      const f = fixture(id, [Response.json({ id: "task_fixture", status: "queued" })]);
      expect((await f.adapter.validate(request(id, { duration: value }))).issues).toEqual([]);
      await f.adapter.submit(request(id, { duration: value }));
      expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://newapi.jijiucanvas.com/v1/videos");
      expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: "Offline contract fixture", seconds: value });
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(f.fallback.submit).not.toHaveBeenCalled();
    }
    const f = fixture(id);
    for (const value of [min - 1, ...(openDuration ? [] : [max + 1]), 1.5]) {
      expect((await f.adapter.validate(request(id, { duration: value }))).valid).toBe(false);
      await expect(f.adapter.submit(request(id, { duration: value }))).rejects.toThrow();
    }
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("uses the current first-line 5–30 contract, F 4–30 and the 480p mini cap", () => {
    expect(jijiuVideoModel("SD2.5特价30-10-10-线路一")?.parameters?.find(p => p.key === "duration")).toMatchObject({ control: "number", min: 5, max: 30 });
    expect(normalizeJijiuVideoParameters(request("SD2.5特价30-10-10-线路一"))).toEqual({});
    expect(jijiuVideoModel("SD2.5特价30-10-10-线路二")?.parameters?.find(p => p.key === "duration")).toMatchObject({ min: 4, max: 30 });
    expect(jijiuVideoModel("稳定seedance-2.5参图参音F")?.parameters?.find(p => p.key === "duration")).toMatchObject({ min: 4, max: 30 });
    expect(jijiuVideoModel("SD2.0mini稳定903C")?.parameters?.find(p => p.key === "resolution")?.options).toEqual([{ label: "480p", value: "480p" }]);
    expect(jijiuVideoModel("SD2.0mini稳定903C")?.parameters?.find(p => p.key === "duration")).toMatchObject({ min: 5, max: 10 });
    expect(jijiuVideoRequestIssues(request("SD2.0mini稳定903C", { duration: 12, resolution: "720p" }))).toHaveLength(2);
    expect(jijiuVideoModel("SD2.5特价30-10-10-线路一")?.metadata?.durationRangeSource).toBeUndefined();
  });

  it("keeps the new full C and SD2.5 third line separate from historical B and second line", async () => {
    expect(jijiuVideoModel("SD2.0fast稳定900D")?.limits).toMatchObject({ maxInputImages: 9, maxInputVideos: 0, maxInputAudios: 0 });
    expect(jijiuVideoModel("SD2.0fast稳定903A")?.limits?.maxInputAudios).toBe(3);
    const fast = fixture("SD2.0fast稳定900D");
    await expect(fast.adapter.submit(request("SD2.0fast稳定900D", {}, [audio]))).rejects.toThrow();
    expect(fast.fetcher).not.toHaveBeenCalled();
    expect(jijiuVideoModel("SD2.5特价30-10-10-线路三")?.metadata?.videoSupportedResolutions).toEqual(["720p"]);
    expect(jijiuVideoModel("SD2.5特价30-10-10-线路二")?.metadata?.videoSupportedResolutions).toEqual(["720p"]);
    const id = "满血seedance-2.5全参C";
    expect(jijiuVideoModel(id)?.metadata).toMatchObject({ supportsFirstLastFrames: false, videoReferenceImageLimit: 30, videoReferenceVideoLimit: 10, videoReferenceAudioLimit: 10 });
    expect(jijiuVideoModel(id)?.parameters?.find(p => p.key === "aspect_ratio")?.options?.map(o => o.value)).toEqual(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
    expect(jijiuVideoRequestIssues(request(id, { duration: 5, aspect_ratio: "21:9" }, [image, video, audio]))).toEqual([]);
    const cases = [request(id, {}, [{ ...image, role: "firstFrame" }]), request(id, { ratio: "2:1" }), request(id, {}, [{ ...image, url: "http://media.example/ref.png" }]),
      request(id, {}, [{ ...audio, durationSeconds: 1 }]), request(id, {}, Array.from({ length: 3 }, (_, i) => ({ ...video, id: `long-${i}`, url: `https://media.example/${i}.mp4`, durationSeconds: 11 })))];
    for (const input of cases) { const f = fixture(id); await expect(f.adapter.submit(input)).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled(); }
  });

  it("updates the second SD2.5 line without clipping saved 480p or borrowing the first line", async () => {
    const id = "SD2.5特价30-10-10-线路二", group = "视频SD2.5";
    const stale = request(id, { duration: 30, resolution: "480p" }), saved = structuredClone(stale);
    const f = fixture(id, [], { modelGroup: group, accountKeyGroup: group });
    await expect(f.adapter.submit(stale)).rejects.toThrow("分辨率");
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(stale).toEqual(saved);
    expect(jijiuVideoRequestIssues(request(id, { duration: 4, resolution: "720p" }, [image, video, audio]), undefined, group)).toEqual([]);
    expect(jijiuVideoModel(id, undefined, group)?.metadata?.jijiuGroupUnavailable).toBe(false);
  });

  it.each(["wan3.0-video-S", "wan3.0-video-prime-S"])("sends %s as exact JSON URL fields without multipart downloads", async id => {
    const input = request(id, { duration: 30, resolution: "1080p", aspect_ratio: "16:9" }, [image, { ...video, durationSeconds: 20 }, audio]);
    const saved = structuredClone(input), model = jijiuVideoModel(id)!;
    expect(isJijiuWanVideoModel(id)).toBe(false);
    expect(model.metadata).toMatchObject({ videoMediaTransport: "json-urls", remoteMediaUrlsOnly: true, supportsFirstLastFrames: false });
    expect(model.metadata?.billingIncludesInputDuration).toBeUndefined();
    expect(model.limits).toMatchObject({ maxInputImages: 10, maxInputVideos: 5, maxInputAudios: 5 });
    const f = fixture(id, [Response.json({ id: "task_json_s", status: "queued" })], { modelGroup: "视频WAN3", accountKeyGroup: "视频WAN3" });
    await f.adapter.submit(input);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = f.fetcher.mock.calls[0]!;
    expect(url).toBe("https://newapi.jijiucanvas.com/v1/videos");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ model: id, prompt: input.prompt, seconds: 30, resolution: "1080p", aspect_ratio: "16:9",
      reference_images: [image.url], videos: [video.url], audios: [audio.url] });
    expect(input).toEqual(saved);
    // The non-S-specific 15s reference / 30s combined bound does not apply here.
    expect(jijiuVideoRequestIssues(input)).toEqual([]);
    const wrongGroup = jijiuVideoRequestIssues(input, undefined, "视频SD2.5");
    expect(wrongGroup).toContainEqual(expect.objectContaining({ path: "model" }));
    for (const bad of [request(id, { duration: -1 }), request(id, { duration: 31 }),
      request(id, {}, [{ ...image, url: "http://media.example/image.png" }]),
      request(id, {}, [{ ...image, url: undefined, data: new Uint8Array([1]) }]),
      request(id, {}, Array.from({ length: 11 }, (_, i) => ({ ...image, id: `image-${i}` })))]) {
      expect(jijiuVideoRequestIssues(bad).length).toBeGreaterThan(0);
    }
  });

  it.each(["MinimaxH3特价版"])("keeps declared free-string resolution for %s without inventing an enum", async id => {
    const model = jijiuVideoModel(id)!; expect(model.metadata?.resolutionRangeUnverified).toBe(true);
    expect(model.parameters?.find(p => p.key === "resolution")).toMatchObject({ control: "text", allowCustomValue: true });
    expect(normalizeJijiuVideoParameters(request(id))).not.toHaveProperty("resolution");
    const f = fixture(id, [Response.json({ id: "fixture_only", status: "queued" })]);
    expect((await f.adapter.validate(request(id))).valid).toBe(true);
    const input = request(id, { resolution: "720p" });
    await f.adapter.submit(input);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ resolution: "720p" });
    expect(input.parameters).toEqual({ resolution: "720p" });
  });

  it("uses the current full-parameter E 480p/720p declaration without changing saved values or borrowing another line's price", async () => {
    const id = "稳定seedance-2.5全参E", group = "稳定满血视频模型";
    expect(jijiuVideoModel(id, undefined, group)?.parameters?.find(p => p.key === "resolution")?.options).toEqual([{ label: "480p", value: "480p" }, { label: "720p", value: "720p" }]);
    expect(jijiuVideoModel(id, undefined, group)?.metadata?.videoSupportedResolutions).toEqual(["480p", "720p"]);
    const old = request(id, { resolution: "1080p", duration: 5 }), original = structuredClone(old);
    const f = fixture(id, [], { accountKeyGroup: group, modelGroup: group });
    expect((await f.adapter.validate(old)).issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.resolution" })]));
    await expect(f.adapter.submit(old)).rejects.toThrow("分辨率");
    expect(old).toEqual(original);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(jijiuVideoRequestIssues(request(id, { resolution: "480p", duration: 5 }), undefined, group)).toEqual([]);
    expect(jijiuVideoModel("满血seedance-2.5全参B", undefined, group)?.metadata?.videoSupportedResolutions).toEqual(["480p", "720p"]);
    expect(jijiuVideoModel("稳定seedance-2.5全参D", undefined, group)?.metadata?.videoSupportedResolutions).toEqual(["480p", "720p", "1080p"]);
    expect(jijiuVideoRequestIssues(request(id, { resolution: "480p" }), undefined, "视频SD.2.5")).toEqual(expect.arrayContaining([expect.objectContaining({ path: "model" })]));
  });

  it("never claims animated 1080p or upscaled output as native resolution", async () => {
    const f = fixture("Minimax漫剧优化版");
    await expect(f.adapter.submit(request("Minimax漫剧优化版", { resolution: "1080p" }))).rejects.toThrow("分辨率");
    expect(jijiuVideoModel("MinimaxH3")?.parameters?.find(p => p.key === "resolution")?.options?.map(o => o.value)).toEqual(["480p", "768p", "1080p", "2k-upscale", "4k-upscale"]);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each([false, true])("preserves duration_seconds through the supplier's universal seconds field, direct=%s", async direct => {
    const id = "SD2.0满血稳定933-线路一", model = jijiuVideoModel(id)!;
    expect(model.metadata?.videoParameterAliases).toMatchObject({ duration: ["seconds", "duration_seconds"] });
    const f = fixture(id, [Response.json({ id: "fixture-alias", status: "queued" })], {
      accountKeyGroup: "视频SD2.0", modelGroup: "视频SD2.0", connector: { ...jijiuVideoTransport(), models: [model], restrictModels: true },
    });
    const adapter = direct ? new GenericRestAdapter(f.resolver, { fetch: f.fetcher }) : f.adapter;
    const input = request(id, { duration_seconds: 7, resolution: "720p" }), original = structuredClone(input);
    expect((await adapter.validate(input)).valid).toBe(true);
    await adapter.submit(input);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ seconds: 7, resolution: "720p" });
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).not.toHaveProperty("duration_seconds");
    expect(input).toEqual(original);
    for (const parameters of [{ duration: 7, duration_seconds: 8 }, { seconds: 7, duration_seconds: 8 }, { duration: 7, seconds: 8, duration_seconds: 7 }, { duration_seconds: 16 }, { duration_seconds: "7" }]) {
      expect(jijiuVideoRequestIssues(request(id, parameters))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
    }
    expect(jijiuVideoRequestIssues(request(id, { duration: 7, seconds: 7, duration_seconds: 7 }))).toEqual([]);
  });

  it.each(["MinimaxH3", "Minimax漫剧优化版"])("offers and sends the exact documented callback field for %s", async id => {
    const model = jijiuVideoModel(id)!;
    expect(model.parameters?.find(p => p.key === "callback_url")).toMatchObject({ control: "text", valueType: "string" });
    const f = fixture(id, [Response.json({ id: "fixture-callback", status: "queued" })]);
    const input = request(id, { callback_url: "https://media.example/completion", metadata: { clientTag: "fixture" } });
    await f.adapter.submit(input);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toMatchObject(input.parameters);
    expect(jijiuVideoModel("MinimaxH3特价版")?.parameters?.some(p => p.key === "callback_url")).toBe(false);
    expect(jijiuVideoRequestIssues(request("MinimaxH3特价版", input.parameters))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.callback_url" }), expect.objectContaining({ path: "parameters.metadata" })]));
  });

  it.each([false, true])("submits the supplier's declared size field without deriving unpublished resolutions, direct=%s", async direct => {
    const id = "MinimaxH3", model = jijiuVideoModel(id)!;
    expect(model.parameters?.find(parameter => parameter.key === "size")).toMatchObject({ control: "text", valueType: "string", allowCustomValue: true });
    const f = fixture(id, [Response.json({ id: "fixture-size", status: "queued" })], {
      accountKeyGroup: "视频-MnimaxH3", modelGroup: "视频-MnimaxH3", connector: { ...jijiuVideoTransport(), models: [model], restrictModels: true },
    });
    const adapter = direct ? new GenericRestAdapter(f.resolver, { fetch: f.fetcher }) : f.adapter;
    const input = request(id, { size: "1280x720", duration: 5 });
    expect((await adapter.validate(input)).valid).toBe(true);
    await adapter.submit(input);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: input.prompt, seconds: 5, size: "1280x720" });
    expect(input.parameters).toEqual({ size: "1280x720", duration: 5 });
    for (const size of ["0x720", "-1280x720", "1280.5x720", "720p", 1280]) {
      expect(jijiuVideoRequestIssues(request(id, { size }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.size" })]));
    }
  });

  it("maps reference aliases and explicit frame roles without borrowed Jiasu fields", async () => {
    const f = fixture("MinimaxH3", [Response.json({ id: "task_frames", status: "queued" })]);
    const input = request("MinimaxH3", { duration: 5, ratio: "9:16", resolution: "768p", reference_image_urls: ["https://media.example/other.png"], seed: 42, watermark: false, prompt_optimizer: true }, [{ ...image, role: "firstFrame" }, { ...image, role: "lastFrame", url: "https://media.example/end.png" }, video, audio]);
    await f.adapter.submit(input);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ seconds: 5, aspect_ratio: "9:16", resolution: "768p", reference_images: ["https://media.example/other.png"], first_frame_image: image.url, last_frame_image: "https://media.example/end.png", reference_videos: [video.url], reference_audios: [audio.url], seed: 42, watermark: false, prompt_optimizer: true });
    expect(normalizeJijiuVideoParameters(input)).not.toHaveProperty("duration");
  });

  it("offers official aspect-ratio examples without declaring a default or a closed selector", () => {
    const model = jijiuVideoModel("SD2.5特价30-10线路一"), ratio = model?.parameters?.find(p => p.key === "aspect_ratio");
    expect(ratio).toMatchObject({ control: "text", valueType: "string", placeholder: "供应商默认（留空）" });
    expect(ratio).not.toHaveProperty("default");
    expect(ratio).not.toHaveProperty("options");
    expect(model?.metadata?.videoAspectRatioPresets).toEqual([{ label: "16:9（横屏）", value: "16:9" }, { label: "9:16（竖屏）", value: "9:16" }, { label: "1:1（方形）", value: "1:1" }]);
  });

  it.each(["16:9", "9:16", "1:1", "21:9", "2.39:1", "", undefined])("preserves ratio %j through automatic and direct REST requests without real network", async ratio => {
    const id = "SD2.5特价30-10线路一", model = jijiuVideoModel(id)!;
    for (const direct of [false, true]) {
      const f = fixture(id, [Response.json({ id: "task_ratio_fixture", status: "queued" })], {
        accountKeyGroup: "视频SD.2.5", modelGroup: "视频SD.2.5", connector: { ...jijiuVideoTransport(), models: [model], restrictModels: true },
      });
      const adapter = direct ? new GenericRestAdapter(f.resolver, { fetch: f.fetcher }) : f.adapter;
      const input = request(id, { duration: 30, resolution: "720p", ...(ratio === undefined ? {} : { aspect_ratio: ratio }) });
      const original = structuredClone(input);
      expect(await adapter.validate(input)).toEqual({ valid: true, issues: [] });
      await adapter.submit(input);
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://newapi.jijiucanvas.com/v1/videos");
      expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: "Offline contract fixture", seconds: 30, resolution: "720p",
        ...(ratio ? { aspect_ratio: ratio } : {}) });
      expect(input).toEqual(original);
    }
  });

  it("keeps a saved custom ratio alias and rejects nonpositive ratios before HTTP", async () => {
    const id = "SD2.5特价30-10线路一";
    const f = fixture(id, [Response.json({ id: "task_custom_ratio", status: "queued" })]);
    const input = request(id, { duration: 30, ratio: "21:9" });
    await f.adapter.submit(input);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ aspect_ratio: "21:9" });
    expect(input.parameters).toEqual({ duration: 30, ratio: "21:9" });
    for (const ratio of ["0:9", "16:0", "-1:1", "widescreen"]) {
      const denied = fixture(id);
      await expect(denied.adapter.submit(request(id, { duration: 30, aspect_ratio: ratio }))).rejects.toThrow();
      expect(denied.fetcher).not.toHaveBeenCalled();
    }
  });

  it("blocks unsupported media, duplicate frames, private URLs and conflicting aliases before HTTP", async () => {
    const bad = [request("满血seedance-2.5全参A", {}, [video]), request("SD2.0mini稳定900B", {}, [audio]), request("MinimaxH3", { seconds: 5, duration: 6 }), request("MinimaxH3", { ratio: "1:1", aspect_ratio: "9:16" }), request("MinimaxH3", { images: ["http://127.0.0.1/secret"] }), request("MinimaxH3", {}, [{ ...image, role: "firstFrame" }, { ...image, role: "firstFrame" }]), request("MinimaxH3", { size: "0x720" })];
    for (const input of bad) { const f = fixture(input.model!); await expect(f.adapter.submit(input)).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled(); }
    const maxImages = Array.from({ length: 10 }, (_, i) => ({ ...image, id: `fixture-${i}`, url: `https://media.example/${i}.png` }));
    expect(jijiuVideoRequestIssues(request("MinimaxH3", {}, maxImages))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "assets" })]));
  });

  it("enforces the first SD2.0 line's 9 images / no videos / 3 audios without borrowing other lines", async () => {
    const id = "SD2.0满血稳定933-线路一", model = jijiuVideoModel(id, undefined, "视频SD2.0")!;
    expect(model.limits).toMatchObject({ maxInputImages: 9, maxInputVideos: 0, maxInputAudios: 3 });
    expect(model.inputKinds).not.toContain("video");
    for (const input of [request(id, {}, [video]), request(id, { video_refs: [video.url] }),
      request(id, {}, Array.from({ length: 10 }, (_, i) => ({ ...image, id: `image-${i}` }))),
      request(id, {}, Array.from({ length: 4 }, (_, i) => ({ ...audio, id: `audio-${i}` })))]) {
      const saved = structuredClone(input), f = fixture(id);
      await expect(f.adapter.submit(input)).rejects.toThrow();
      expect(input).toEqual(saved); expect(f.fetcher).not.toHaveBeenCalled();
    }
    expect(jijiuVideoRequestIssues(request("SD2.0满血稳定933-线路二", { duration: 5 }, [video]))).toEqual([]);
  });

  it("uses the fourth SD2.0 line's exact URL fields and refuses upstream clipping of saved values", async () => {
    const id = "SD2.0满血稳定933-线路四", group = "视频SD2.0";
    for (const resolution of ["480p", "720p"]) {
      const input = request(id, { duration_seconds: 4, resolution, imageUrls: [image.url], videoUrls: [video.url], audioUrls: [audio.url] });
      const saved = structuredClone(input), f = fixture(id, [Response.json({ id: "line_four", status: "queued" })], { modelGroup: group, accountKeyGroup: group });
      await f.adapter.submit(input);
      expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: input.prompt, seconds: 4, resolution,
        images: [image.url], videos: [video.url], audios: [audio.url] });
      expect(input).toEqual(saved);
    }
    for (const parameters of [{ duration: 3 }, { duration: 16 }, { resolution: "1080p" }]) {
      const input = request(id, parameters), saved = structuredClone(input), f = fixture(id);
      await expect(f.adapter.submit(input)).rejects.toThrow(); expect(input).toEqual(saved); expect(f.fetcher).not.toHaveBeenCalled();
    }
  });

  it("keeps A/B digital-watermark and billing notes distinct from C's fixed 720p contract after persistence", () => {
    const models = JSON.parse(JSON.stringify(["满血seedance-2.5全参A", "满血seedance-2.5全参B", "满血seedance-2.5全参C"].map(id => jijiuVideoModel(id)))) as ModelDescriptor[];
    expect(models[0]?.metadata?.videoContractNote).toMatch(/数字水印.*按次/);
    expect(models[1]?.metadata?.videoContractNote).toMatch(/数字水印.*按秒/);
    expect(models[2]?.metadata).toMatchObject({ videoMinDuration: 4, videoMaxDuration: 30, videoSupportedResolutions: ["720p"],
      videoReferenceImageLimit: 30, videoReferenceVideoLimit: 10, videoReferenceAudioLimit: 10 });
    expect(models[2]?.parameters?.find(p => p.key === "resolution")?.options).toEqual([{ label: "720p", value: "720p" }]);
  });

  it("checks WAN measured reference durations and output combined cap", async () => {
    const id = "wan3.0-video";
    expect(jijiuVideoRequestIssues(request(id, { duration: 24 }, [video]))).toEqual([]);
    const cases = [request(id, { duration: 25 }, [video]), request(id, { duration: 5 }, [{ ...video, durationSeconds: 16 }]), request(id, {}, [video]), request(id, { duration: 5, reference_videos: [video.url] }), request(id, { duration: 5 }, [{ ...video, durationSeconds: undefined }])];
    for (const input of cases) { const f = fixture(id); await expect(f.adapter.submit(input)).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled(); }
    for (const model of [id, "wan3.0-video-prime"]) expect(jijiuVideoModel(model)?.metadata?.billingIncludesInputDuration).toBe(true);
    expect(jijiuVideoModel("稳定seedance-2.5参图参音F")?.parameters?.find(p => p.key === "resolution")?.options).toEqual([{ label: "480p", value: "480p" }]);
  });

  it("uses the current D reference contract and preserves incompatible saved inputs", async () => {
    const id = "稳定seedance-2.5全参D", group = "稳定满血视频模型", model = jijiuVideoModel(id, undefined, group)!;
    expect(model.limits).toMatchObject({ maxInputImages: 30, maxInputVideos: 10, maxInputAudios: 10 });
    expect(model.metadata).toMatchObject({ supportsFirstLastFrames: false, videoMinDuration: 4, videoMaxDuration: 30, videoContractCheckedAt: "2026-10-21" });
    expect(model.metadata?.videoAspectRatioPresets).toEqual([{ label: "16:9", value: "16:9" }, { label: "9:16", value: "9:16" }]);
    const input = request(id, { duration: 4, resolution: "480p", aspect_ratio: "16:9" }, [image]), original = structuredClone(input);
    const f = fixture(id, [Response.json({ id: "fixture_d", status: "queued" })], { accountKeyGroup: group, modelGroup: group });
    expect((await f.adapter.validate(input)).issues).toEqual([]);
    await f.adapter.submit(input);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: input.prompt, seconds: 4, resolution: "480p", aspect_ratio: "16:9", images: [image.url] });
    expect(input).toEqual(original);
    for (const bad of [request(id, { duration: 30, aspect_ratio: "adaptive" }, [video]), request(id, {}, [{ ...video, durationSeconds: 31 }]), request(id, {}, [{ ...image, role: "firstFrame" }]), request(id, {}, [{ ...image, url: "http://media.example/ref.png" }])]) {
      const saved = structuredClone(bad), denied = fixture(id);
      await expect(denied.adapter.submit(bad)).rejects.toThrow();
      expect(denied.fetcher).not.toHaveBeenCalled(); expect(bad).toEqual(saved);
    }
    expect(jijiuVideoRequestIssues(request("满血seedance-2.5全参B", { aspect_ratio: "adaptive" }))).toContainEqual(expect.objectContaining({ path: "parameters.aspect_ratio" }));
  });

  it("uses the current F 480p and 30-second limit without rewriting its saved 720p", async () => {
    const id = "稳定seedance-2.5参图参音F", f = fixture(id, [Response.json({ id: "fixture_f", status: "queued" })]);
    const valid = request(id, { duration: 30, resolution: "480p" }, [image, audio]);
    await f.adapter.submit(valid);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ seconds: 30, resolution: "480p", images: [image.url], audios: [audio.url] });
    const stale = request(id, { duration: 29, resolution: "720p" }), before = structuredClone(stale), denied = fixture(id);
    await expect(denied.adapter.submit(stale)).rejects.toThrow("分辨率");
    expect(denied.fetcher).not.toHaveBeenCalled(); expect(stale).toEqual(before);
  });

  it("binds fast900 only to the common text contract, open resolution and explicitly attributed user duration fallback", async () => {
    const id = "SD2.0fast900", group = "视频SD2.0", model = jijiuVideoModel(id, undefined, group)!;
    expect(model.operations).toEqual(["video.generate"]); expect(model.inputKinds).toEqual(["text"]);
    expect(model.parameters?.map(parameter => parameter.key)).toEqual(["duration", "resolution", "aspect_ratio"]);
    expect(model.metadata).toMatchObject({ durationRangeSource: "user-fallback", durationRangeFallbackFamily: "seedance-2.0", userFallbackDurationRange: { min: 1, max: 15 },
      videoReferenceCapabilitiesUnpublished: true, videoSupportedResolutions: [], videoResolutionAllowsCustom: true });
    for (const duration of [1, 15]) {
      const input = request(id, { duration, resolution: "custom-provider-tier", aspect_ratio: "21:9" }), before = structuredClone(input);
      const f = fixture(id, [Response.json({ id: "fixture_fast900", status: "queued" })], { accountKeyGroup: group, modelGroup: group });
      await f.adapter.submit(input);
      expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://newapi.jijiucanvas.com/v1/videos");
      expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: input.prompt, seconds: duration, resolution: "custom-provider-tier", aspect_ratio: "21:9" });
      expect(input).toEqual(before);
    }
    for (const bad of [request(id, {}, [image]), request(id, { images: [image.url] }), request(id, { duration: 16 }), request(id, { duration: 5, seed: 2 }), request(id, { size: "1280x720" })]) {
      const saved = structuredClone(bad), f = fixture(id);
      await expect(f.adapter.submit(bad)).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled(); expect(bad).toEqual(saved);
    }
    expect(jijiuVideoModel("SD2.0fast稳定900D")?.metadata?.durationRangeSource).toBeUndefined();
    expect(jijiuVideoModel("SD2.0fast稳定900D")?.parameters?.find(parameter => parameter.key === "duration")?.options?.map(option => option.value)).toEqual([5, 10, 15]);
  });

  it.each(["wan3.0-video", "wan3.0-video-prime"])("restores automatic duration without changing it, and sends legal JSON for %s", async id => {
    const model = jijiuVideoModel(id)!;
    expect(model.parameters?.find(p => p.key === "duration")).toMatchObject({ control: "select", options: expect.arrayContaining([{ value: 2, label: "2 秒" }, { value: 30, label: "30 秒" }]) });
    expect(model.parameters?.find(p => p.key === "duration")?.options).toContainEqual({ label: "自动时长（-1）", value: -1 });
    expect(model.metadata).toMatchObject({ remoteMediaUrlsOnly: false, supportsFirstLastFrames: false, videoSupportsFirstLastFrames: false, videoMediaTransport: "multipart-files", billingIncludesInputDuration: true,
      videoSupportsAutomaticDuration: true, videoAutomaticDurationPrechargeSeconds: 30, videoAutomaticDurationSettlement: "actual-duration" });
    expect(model.parameters?.some(p => p.key === "negative_prompt")).toBe(false);
    const f = fixture(id, [Response.json({ id: "wan_auto_fixture", status: "queued" })]);
    const historical = request(id, { duration: -1, resolution: "720p" }), saved = structuredClone(historical);
    const automatic = fixture(id, [Response.json({ id: "wan_auto", status: "queued" })]);
    expect((await automatic.adapter.validate(historical)).valid).toBe(true);
    await automatic.adapter.submit(historical);
    expect(JSON.parse(String(automatic.fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ seconds: -1, resolution: "720p" });
    expect(historical).toEqual(saved); expect(automatic.fetcher).toHaveBeenCalledOnce();
    const input = request(id, { duration: 5, resolution: "720p" }), original = structuredClone(input);
    expect(await f.adapter.validate(input)).toEqual({ valid: true, issues: [] });
    await f.adapter.submit(input);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: input.prompt, seconds: 5, resolution: "720p" });
    expect(input).toEqual(original);
  });

  it.each([false, true])("uploads WAN byte references as repeated multipart file fields, direct=%s", async direct => {
    const id = "wan3.0-video-prime", model = jijiuVideoModel(id)!;
    const f = fixture(id, [Response.json({ id: "wan_files_fixture", status: "queued" })], {
      accountKeyGroup: "视频WAN3", modelGroup: "视频WAN3", connector: { ...jijiuVideoTransport(), models: [model], restrictModels: true },
    });
    const assets = [{ ...image, filename: "first.png", url: undefined, data: new Uint8Array([1, 2]) }, { ...image, id: "second", filename: "second.png", url: undefined, data: new Uint8Array([3]) },
      { ...video, filename: "motion.mp4", url: undefined, data: new Uint8Array([4, 5]) }, { ...audio, filename: "voice.mp3", url: undefined, data: new Uint8Array([6]) }];
    const input = request(id, { duration: 5, resolution: "1080p" }, assets), original = structuredClone(input);
    const adapter = direct ? new GenericRestAdapter(f.resolver, { fetch: f.fetcher }) : f.adapter;
    expect(await adapter.validate(input)).toEqual({ valid: true, issues: [] });
    await adapter.submit(input);
    const init = f.fetcher.mock.calls[0]?.[1], body = init?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
    expect(body.get("seconds")).toBe("5");
    expect(body.getAll("images").map(value => (value as File).name)).toEqual(["first.png", "second.png"]);
    expect(body.getAll("videos")).toHaveLength(1);
    expect(body.getAll("audios")).toHaveLength(1);
    expect(body.has("reference_videos")).toBe(false);
    expect(body.has("reference_audios")).toBe(false);
    expect(new Uint8Array(await (body.get("videos") as File).arrayBuffer())).toEqual(new Uint8Array([4, 5]));
    expect(input).toEqual(original);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["wan3.0-video", "wan3.0-video-prime"])("preserves automatic duration in restored controls and multipart requests for %s", async id => {
    const previous = { ...jijiuVideoModel(id)!, metadata: { videoSupportsAutomaticDuration: false, videoDurationValues: [5], videoAutomaticDurationPrechargeSeconds: 99 } };
    const restored = jijiuVideoModel(id, JSON.parse(JSON.stringify(previous)))!;
    expect(restored.metadata).toMatchObject({ videoSupportsAutomaticDuration: true, videoAutomaticDurationPrechargeSeconds: 30, videoDurationValues: expect.arrayContaining([-1, 2, 30]) });
    const descriptor = JSON.parse(JSON.stringify(restored)) as ModelDescriptor;
    expect(descriptor.parameters?.find(p => p.key === "duration")?.options).toContainEqual({ label: "自动时长（-1）", value: -1 });
    const input = request(id, { duration_seconds: -1, resolution: "720p" }, [{ ...video, filename: "original.mp4", url: undefined, data: new Uint8Array([11, 12]) }]);
    const before = structuredClone(input), f = fixture(id, [Response.json({ id: "wan_auto_files", status: "queued" })]);
    expect(await f.adapter.validate(input)).toEqual({ valid: true, issues: [] });
    await f.adapter.submit(input);
    const body = f.fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("seconds")).toBe("-1"); expect(body.getAll("videos")).toHaveLength(1);
    expect(new Uint8Array(await (body.get("videos") as File).arrayBuffer())).toEqual(new Uint8Array([11, 12]));
    expect(input).toEqual(before); expect(f.fetcher).toHaveBeenCalledOnce();
    for (const other of ["wan3.0-video-S", "wan3.0-video-prime-S"]) {
      expect(jijiuVideoModel(other, { ...previous, id: other })?.metadata?.videoAutomaticDurationPrechargeSeconds).toBeUndefined();
      expect(jijiuVideoRequestIssues(request(other, { duration_seconds: -1 }))).toContainEqual(expect.objectContaining({ path: "parameters.duration" }));
    }
  });

  it("downloads an existing WAN public image safely and submits its original bytes as a file", async () => {
    const id = "wan3.0-video", f = fixture(id, [new Response(new Uint8Array([11, 12]), { headers: { "content-type": "image/jpeg" } }), Response.json({ id: "wan_url_fixture", status: "queued" })]);
    const input = request(id, { duration: 5 }, [{ ...image, filename: "original.jpg" }]), original = structuredClone(input);
    await f.adapter.submit(input);
    expect(f.fetcher.mock.calls[0]?.[0]).toBe(image.url);
    expect(f.fetcher.mock.calls[1]?.[0]).toBe("https://newapi.jijiucanvas.com/v1/videos");
    const body = f.fetcher.mock.calls[1]?.[1]?.body as FormData, file = body.get("images") as File;
    expect(file.name).toBe("original.jpg"); expect(file.type).toBe("image/jpeg");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([11, 12]));
    expect(input).toEqual(original);
  });

  it.each([new Response("unavailable", { status: 503 }), new Response(new Uint8Array(), { headers: { "content-type": "image/png" } })])("stops failed WAN material preparation before creating a billable task", async response => {
    const id = "wan3.0-video", f = fixture(id, [response]);
    const input = request(id, { seconds: -1 }, [image]), saved = structuredClone(input);
    await expect(f.adapter.submit(input)).rejects.toMatchObject({ name: "MaterialPreparationError", code: "MATERIAL_PREPARATION_FAILED", message: expect.stringContaining("素材准备失败，尚未提交生成") });
    expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.fetcher.mock.calls[0]?.[0]).toBe(image.url);
    expect(f.fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(input).toEqual(saved); expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it("blocks WAN unsupported roles/fields, audio alone and combined input cap before HTTP", async () => {
    const id = "wan3.0-video";
    const cases = [request(id, { duration: -1 }, [audio]), request(id, { duration: -1 }, [{ ...image, role: "firstFrame" }]), request(id, { duration: -1, first_frame_image: image.url }),
      ...["negative_prompt", "mode", "quality", "fps", "n", "output_format", "file_id"].map(key => request(id, { duration: 5, [key]: key === "n" ? 1 : "fixture" })),
      request(id, { duration: -1 }, Array.from({ length: 2 }, (_, i) => ({ ...video, id: `long-${i}`, durationSeconds: 15 }))), request(id, { duration: 1 }), request(id, { duration: 0 })];
    for (const input of cases) { const f = fixture(id); await expect(f.adapter.submit(input)).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled(); }
    expect(jijiuVideoRequestIssues(request(id, { duration: 15 }, [{ ...video, durationSeconds: 8 }, { ...video, id: "other", durationSeconds: 7 }]))).toEqual([]);
  });

  it.each([false, true])("restores queued tasks and downloads authenticated content, artifact URL present=%s", async artifact => {
    const contentUrl = "https://newapi.jijiucanvas.com/v1/tasks/task_fixture/artifacts/video/content?access=fixture-ticket";
    const f = fixture("MinimaxH3", [Response.json({ id: "task_fixture", status: "queued" }), Response.json({ id: "task_fixture", status: "unknown" }), Response.json({ id: "task_fixture", status: "completed", ...(artifact ? { content_url: contentUrl } : {}) }), new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "video/mp4" } })]);
    const task = JSON.parse(JSON.stringify(await f.adapter.submit(request()))) as ProviderTask;
    expect(task.providerTaskId).toBe("task_fixture"); expect((await f.adapter.poll(task)).status).toBe("running");
    const state = await f.adapter.poll(task); expect(state.status).toBe("succeeded");
    expect(await f.adapter.extractOutputs(state.result)).toEqual([{ kind: "video", data: new Uint8Array([1, 2, 3, 4]), mimeType: "video/mp4" }]);
    expect(f.fetcher.mock.calls[1]?.[0]).toBe("https://newapi.jijiucanvas.com/v1/videos/task_fixture");
    expect(f.fetcher.mock.calls[3]?.[0]).toBe(artifact ? contentUrl : "https://newapi.jijiucanvas.com/v1/videos/task_fixture/content");
    expect(f.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    for (const [, init] of f.fetcher.mock.calls) expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-key-only");
  });

  it.each(["content_url", "video_url", "download_url", "video.url"])("resolves a same-task relative %s with its short-lived ticket and authenticates only the content GET", async field => {
    const taskId = "relative_task", relative = `/v1/videos/${taskId}/content?access=fixture%2Bticket%2Fone`;
    const transport = jijiuVideoTransport(), config: RestConnectorConfig = { ...transport, submit: transport.submit!, output: transport.output! };
    const remote = field === "video.url" ? { video: { url: relative } } : { [field]: relative };
    const f = fixture("wan3.0-video", [new Response(new Uint8Array([4, 3, 2, 1]), { headers: { "content-type": "video/mp4" } })]);
    await expect(f.adapter.extractOutputs({ connectionId: "jijiu-offline-fixture", baseUrl: "https://newapi.jijiucanvas.com/v1", config, taskId, status: "succeeded", remote, autoInterface: true }))
      .resolves.toEqual([{ kind: "video", data: new Uint8Array([4, 3, 2, 1]), mimeType: "video/mp4" }]);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.fetcher.mock.calls[0]?.[0]).toBe(`https://newapi.jijiucanvas.com${relative}`);
    expect(f.fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "GET", redirect: "manual" });
    expect(new Headers(f.fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer fixture-key-only");
  });

  it.each([false, true])("recovers the signed nested video URL through GET only, legacy saved contract=%s", async legacy => {
    const id = "SD2.5特价30-10-10-线路一", taskId = "task_saved_video";
    const contentUrl = `https://newapi.jijiucanvas.com/v1/tasks/${taskId}/artifacts/video/content?expires=1234567890&signature=fixture%2Bticket%2Fone`;
    const transport = jijiuVideoTransport();
    const config: RestConnectorConfig = { ...transport, submit: transport.submit!, output: {
      ...transport.output!, fallbackPaths: transport.output!.fallbackPaths!.filter(path => !legacy || path !== "$.video.url"),
    }, allowedHosts: ["newapi.jijiucanvas.com"] };
    const f = fixture(id, [Response.json({ id: taskId, status: "completed", video: { duration: 30, url: contentUrl } }),
      new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "video/mp4" } })]);
    const saved: ProviderTask = JSON.parse(JSON.stringify({ providerTaskId: taskId, status: "succeeded", result: {
      connectionId: "jijiu-offline-fixture", baseUrl: "https://newapi.jijiucanvas.com/v1", model: id, config,
      taskId, status: "succeeded", remote: { id: taskId, status: "completed", video: { duration: 30, url: contentUrl } }, autoInterface: true,
    } }));
    const state = await f.adapter.poll(saved);
    expect(state.status).toBe("succeeded");
    expect(await f.adapter.extractOutputs(state.result)).toEqual([{ kind: "video", data: new Uint8Array([1, 2, 3, 4]), mimeType: "video/mp4" }]);
    expect(f.fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://newapi.jijiucanvas.com/v1/videos/${taskId}`, contentUrl,
    ]);
    for (const [index, [, init]] of f.fetcher.mock.calls.entries()) {
      expect(init).toMatchObject({ method: "GET", redirect: index === 0 ? "error" : "manual" });
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-key-only");
    }
    expect(f.fallback.submit).not.toHaveBeenCalled();
    expect(f.fallback.poll).not.toHaveBeenCalled();
  });

  it("keeps content_url ahead of a nested video URL when both are present", async () => {
    const taskId = "task_receipt_priority";
    const primary = `https://newapi.jijiucanvas.com/v1/videos/${taskId}/content?access=primary`;
    const nested = `https://newapi.jijiucanvas.com/v1/tasks/${taskId}/artifacts/video/content?access=nested`;
    const transport = jijiuVideoTransport();
    const config: RestConnectorConfig = { ...transport, submit: transport.submit!, output: transport.output! };
    const f = fixture("MinimaxH3", [new Response(new Uint8Array([1]), { headers: { "content-type": "video/mp4" } })]);
    await f.adapter.extractOutputs({ connectionId: "jijiu-offline-fixture", baseUrl: "https://newapi.jijiucanvas.com/v1",
      config, taskId, status: "succeeded", remote: { content_url: primary, video: { url: nested } }, autoInterface: true });
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.fetcher.mock.calls[0]?.[0]).toBe(primary);
  });

  it.each([
    "https://cdn.example/v1/tasks/task_exact/artifacts/video/content?access=external",
    "https://newapi.jijiucanvas.com/v1/tasks/task_other/artifacts/video/content?access=other-task",
  ])("does not send content credentials to a nested URL outside the exact task: %s", async contentUrl => {
    const transport = jijiuVideoTransport();
    const config: RestConnectorConfig = { ...transport, submit: transport.submit!, output: transport.output! };
    const f = fixture();
    await expect(f.adapter.extractOutputs({ connectionId: "jijiu-offline-fixture", baseUrl: "https://newapi.jijiucanvas.com/v1",
      config, taskId: "task_exact", status: "succeeded", remote: { video: { url: contentUrl } }, autoInterface: true }))
      .resolves.toEqual([{ kind: "video", url: contentUrl, mimeType: "video/mp4" }]);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("hands off a signed nested task redirect without sending the API key to the CDN", async () => {
    const taskId = "task_content_redirect";
    const contentUrl = `https://newapi.jijiucanvas.com/v1/tasks/${taskId}/artifacts/video/content?access=original`;
    const fileUrl = "https://files.jijiu-fixture.test/original.mp4?signature=fixture%2Bticket%2Fone";
    const transport = jijiuVideoTransport();
    const config: RestConnectorConfig = { ...transport, submit: transport.submit!, output: transport.output! };
    const f = fixture("MinimaxH3", [new Response(null, { status: 302, headers: { location: fileUrl } })]);
    await expect(f.adapter.extractOutputs({ connectionId: "jijiu-offline-fixture", baseUrl: "https://newapi.jijiucanvas.com/v1",
      config, taskId, status: "succeeded", remote: { video: { url: contentUrl } }, autoInterface: true }))
      .resolves.toEqual([{ kind: "video", url: fileUrl, mimeType: "video/mp4" }]);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.fetcher.mock.calls[0]).toEqual([contentUrl, expect.objectContaining({ method: "GET", redirect: "manual" })]);
    expect(new Headers(f.fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer fixture-key-only");
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it.each([
    "file:///C:/private/video.mp4",
    "javascript:alert(1)",
    "https://username:password@files.jijiu-fixture.test/original.mp4",
    "https://127.0.0.1/private.mp4",
    "https://newapi.jijiucanvas.com/v1/tasks/task_other/artifacts/video/content?access=other-task",
    "https://newapi.jijiucanvas.com/api/user/self",
  ])("rejects unsafe or unrelated task content redirect without another request: %s", async location => {
    const taskId = "task_content_redirect";
    const contentUrl = `https://newapi.jijiucanvas.com/v1/tasks/${taskId}/artifacts/video/content?access=original`;
    const transport = jijiuVideoTransport();
    const config: RestConnectorConfig = { ...transport, submit: transport.submit!, output: transport.output! };
    const f = fixture("MinimaxH3", [new Response(null, { status: 302, headers: { location } })]);
    await expect(f.adapter.extractOutputs({ connectionId: "jijiu-offline-fixture", baseUrl: "https://newapi.jijiucanvas.com/v1",
      config, taskId, status: "succeeded", remote: { video: { url: contentUrl } }, autoInterface: true })).rejects.toThrow();
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.fetcher.mock.calls[0]).toEqual([contentUrl, expect.objectContaining({ method: "GET", redirect: "manual" })]);
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it("retains upstream failure without retrying creation", async () => {
    const f = fixture("MinimaxH3", [Response.json({ id: "task_failed", status: "queued" }), Response.json({ id: "task_failed", status: "failed", error: { message: "fixture upstream unavailable" } })]);
    const task = await f.adapter.submit(request()); expect(await f.adapter.poll(task)).toMatchObject({ status: "failed", error: "fixture upstream unavailable" }); expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([{ scannedModelIds: [] }, { modelScanStatus: "unauthorized" }, { supplierArchived: true }, { usage: "agent" }, { usage: "disabled" }, { accountKeyGroup: "视频SD2.0" }])("retains inventory and group restrictions %j", async extra => {
    const f = fixture("MinimaxH3", [], extra); await expect(f.adapter.submit(request())).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("uses the same validation in direct REST and leaves explicit manual contracts alone", async () => {
    const model = jijiuVideoModel("SD2.0mini稳定903C")!, transport = jijiuVideoTransport();
    const f = fixture(model.id, [], { connector: { ...transport, models: [model], restrictModels: true } });
    const direct = new GenericRestAdapter(f.resolver, { fetch: f.fetcher });
    await expect(direct.submit(request(model.id, { duration: 15, resolution: "720p" }))).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled();
    for (const metadata of [{ source: "manual" }, { source: "paid-test" }, { protocolEvidence: "paid-test" }]) {
      const manual: ModelDescriptor = { ...model, metadata }; expect(jijiuVideoModel(manual.id, manual)).toBeUndefined();
    }
  });

  it("does not overwrite the exact group's unavailable state while repairing an inferred protocol", async () => {
    const scan = scanProviderModelCatalog({ data: [{ id: "MinimaxH3" }] }, { baseUrl: "https://newapi.jijiucanvas.com/v1", modelGroup: "视频SD2.0" });
    expect(scan.models[0]?.metadata).toMatchObject({ canvasRunnable: false, jijiuGroupUnavailable: true });
    const current = jijiuVideoModel("MinimaxH3", scan.models[0], "视频-MnimaxH3");
    expect(current?.metadata?.jijiuGroupUnavailable).toBe(false);
    const transport = jijiuVideoTransport(), model = jijiuVideoModel("MinimaxH3")!;
    const f = fixture("MinimaxH3", [], { accountKeyGroup: "视频-MnimaxH3", modelGroup: "视频SD2.0", connector: { ...transport, models: [model], restrictModels: true } });
    await expect(f.adapter.submit(request())).rejects.toThrow("分组不一致");
    await expect(new GenericRestAdapter(f.resolver, { fetch: f.fetcher }).submit(request())).rejects.toThrow("分组不一致");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const offlineNetwork = vi.hoisted(() => ({
  lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]),
  fetch: vi.fn(),
}));
// Keep the real supplier origin checks, while isolating pre-transport DNS.
vi.mock("node:dns/promises", () => ({ lookup: offlineNetwork.lookup }));
import type { ModelDescriptor, NormalizedRequest, StructuredModelPricing } from "./contracts.js";
import { cangyuanVideoModel, cangyuanVideoTransport, isCangyuanVideoModel, isCangyuanVideoRequest, normalizeCangyuanVideoParameters, validateCangyuanVideoRequest } from "./cangyuan-video-contract.js";
import { StaticConnectionResolver } from "./credentials.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";
const request = (model: string, parameters: Record<string, unknown> = {}): NormalizedRequest => ({ connectionId: "test", model, operation: "video.generate", prompt: "海边公路", idempotencyKey: "test", parameters });
const model = (id: string) => cangyuanVideoModel({ id, name: id, operations: ["video.generate"], metadata: { canvasRunnable: false, canvasUnavailableReason: "403 权限不足" } });

const sd8s = "sd8-seedance-2.5-s";
function sd8Fixture(models: readonly ModelDescriptor[] = [{ id: sd8s, name: sd8s, operations: ["video.generate"], outputKinds: ["video"], metadata: { canvasRunnable: true } }]) {
  const connector: RestConnectorConfig = {
    auth: { type: "bearer" }, restrictModels: true, models,
    submit: { path: "/stale-images", method: "POST", bodyMode: "json" },
    poll: { path: "/stale-images/{taskId}", method: "GET", bodyMode: "none" },
    output: { path: "$.old_images", kind: "image" },
  };
  const connection = { id: "test", provider: "rest" as const, apiKey: "synthetic-sd8s-key", baseUrl: "https://ai.cangyuansuanli.cn/v1", settings: { connector } };
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("Unexpected mocked Cangyuan request"); });
  return { connection, fetcher, adapter: new GenericRestAdapter(new StaticConnectionResolver([connection]), { fetch: fetcher }) };
}

describe("fresh Cangyuan per-model video contracts", () => {
  beforeEach(() => {
    offlineNetwork.lookup.mockClear();
    offlineNetwork.fetch.mockReset().mockRejectedValue(new Error("Unexpected real HTTP in Cangyuan contract test"));
    vi.stubGlobal("fetch", offlineNetwork.fetch);
  });
  afterEach(() => {
    try { expect(offlineNetwork.fetch).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
  });
  it("keeps an explicit Key denial and scopes transport to the official supplier", () => {
    expect(model("sd10-seedance-2.0").metadata).toMatchObject({ canvasRunnable: false, canvasUnavailableReason: "403 权限不足" });
    expect(isCangyuanVideoRequest("sd10-seedance-2.0", "https://ai.cangyuansuanli.cn/v1")).toBe(true);
    expect(isCangyuanVideoRequest("sd10-seedance-2.0", "https://example.com")).toBe(false);
    expect(model("sd10-seedance-99").parameters).toBeUndefined();
  });
  it("corrects legacy audio fields and exposes SD10 camera controls without sending unsupported switches", () => {
    expect(normalizeCangyuanVideoParameters(request("sd11-seedance-2.0", { audio: false, seconds: 8 }))).toEqual({ generate_audio: false, duration: 8 });
    expect(validateCangyuanVideoRequest(request("sd10-seedance-2.0", { duration: 7 }))).not.toEqual([]);
    expect(validateCangyuanVideoRequest(request("sd10-seedance-2.0", { duration: 10, camera_movement: "fixed" }))).toEqual([]);
    expect(validateCangyuanVideoRequest(request("sd10-seedance-2.0", { duration: 10, generate_audio: true }))).not.toEqual([]);
    expect(model("sd10-seedance-2.0").parameters?.find(p => p.key === "camera_movement")?.options?.map(p => p.value)).toEqual(["auto", "fixed"]);
    expect(model("sd8-seedance-2.5").parameters?.some(p => p.key === "resolution")).toBe(false);
  });
  it("supports frame-only Kling while preserving reference/audio exclusions", () => {
    expect(model("kl1-kling-3.0").operations).toContain("video.image-to-video");
    expect(model("kl1-kling-3.0").inputKinds).toContain("image");
    expect(model("kl1-kling-3.0").metadata).toMatchObject({ videoReferenceImageLimit: 0, allowFrameMediaMix: false });
    expect(validateCangyuanVideoRequest(request("kl1-kling-3.0", { first_image_url: "https://assets.example/a.jpg", duration: 5 }))).toEqual([]);
    expect(validateCangyuanVideoRequest(request("kl1-kling-3.0", { reference_image_urls: ["https://assets.example/a.jpg"] }))).not.toEqual([]);
    expect(validateCangyuanVideoRequest(request("niulai-pro", { duration: 6, reference_audios: ["https://assets.example/a.mp3"] }))).not.toEqual([]);
    expect(validateCangyuanVideoRequest(request("sd15-seedance-2.5", { reference_videos: ["https://assets.example/a.mp4"] }))).not.toEqual([]);
  });
  it.each(["minimax-h3-2k", "minimax-h3-768p"])("checks %s measured reference duration, individual bounds and audio totals", id => {
    const video = { id: "v", kind: "video" as const, mimeType: "video/mp4", url: "https://assets.example/v.mp4", durationSeconds: 2 };
    const audio = { id: "a", kind: "audio" as const, mimeType: "audio/mpeg", url: "https://assets.example/a.mp3", durationSeconds: 15 };
    expect(validateCangyuanVideoRequest({ ...request(id, { duration: 5 }), assets: [video, audio] })).toEqual([]);
    for (const seconds of [undefined, 1.9, 15.1]) for (const kind of ["video", "audio"] as const) {
      expect(validateCangyuanVideoRequest({ ...request(id, { duration: 5 }), assets: kind === "video" ? [{ ...video, durationSeconds: seconds }] : [video, { ...audio, durationSeconds: seconds }] })).not.toEqual([]);
    }
    expect(validateCangyuanVideoRequest({ ...request(id, { duration: 5 }), assets: [video, { ...audio, durationSeconds: 8 }, { ...audio, id: "a2", url: "https://assets.example/a2.mp3", durationSeconds: 8 }] })).not.toEqual([]);
    expect(model(id).metadata).toMatchObject({ referenceNeedsDuration: true, maxTotalInputAudioDurationSeconds: 15 });
  });
  it("checks exact Wan, HappyHouse and SD4 480p reference limits without substituting output duration", () => {
    const video = (durationSeconds: number) => ({ id: "v", kind: "video" as const, mimeType: "video/mp4", url: "https://assets.example/v.mp4", durationSeconds });
    const audio = (durationSeconds: number) => ({ id: "a", kind: "audio" as const, mimeType: "audio/mpeg", url: "https://assets.example/a.mp3", durationSeconds });
    expect(validateCangyuanVideoRequest({ ...request("wan3.0-video", { duration: 30 }), assets: [video(15), audio(15)] })).toEqual([]);
    expect(validateCangyuanVideoRequest({ ...request("wan3.0-video", { duration: 5 }), assets: [audio(15.1)] })).not.toEqual([]);
    for (const seconds of [3, 10]) expect(validateCangyuanVideoRequest({ ...request("happyhouse-1.0"), assets: [video(seconds)] })).toEqual([]);
    for (const seconds of [2.9, 10.1]) expect(validateCangyuanVideoRequest({ ...request("happyhouse-1.0"), assets: [video(seconds)] })).not.toEqual([]);
    expect(validateCangyuanVideoRequest({ ...request("sd4-seedance-2.5-480p", { duration: 30 }), assets: [video(30.2), audio(30.2)] })).toEqual([]);
    for (const reference of [video(30.3), audio(30.3)]) expect(validateCangyuanVideoRequest({ ...request("sd4-seedance-2.5-480p", { duration: 4 }), assets: [reference] })).not.toEqual([]);
  });
  it.each(["omni-v2v", "omni-v2v-no-water"])("checks %s source video's documented eight MB maximum conservatively", id => {
    const video = { id: "v", kind: "video" as const, mimeType: "video/mp4", url: "https://assets.example/v.mp4", width: 1920, height: 1080, data: new Uint8Array(8_000_000) };
    expect(validateCangyuanVideoRequest({ ...request(id), assets: [video] })).toEqual([]);
    expect(validateCangyuanVideoRequest({ ...request(id), assets: [{ ...video, data: new Uint8Array(8_000_000 + 1) }] })).not.toEqual([]);
    const image = { id: "i", kind: "image" as const, mimeType: "image/png", url: "https://assets.example/i.png", data: new Uint8Array(8_000_000 + 1) };
    expect(validateCangyuanVideoRequest({ ...request(id), assets: [video, image] })).not.toEqual([]);
  });
  it.each(["omni-v2v", "omni-v2v-no-water"])("requires %s measured source dimensions and rejects oversized references before transport", async id => {
    const video = { id: "v", kind: "video" as const, mimeType: "video/mp4", url: "https://assets.example/v.mp4", width: 1920, height: 1080 };
    expect(validateCangyuanVideoRequest({ ...request(id), assets: [video] })).toEqual([]);
    const f = sd8Fixture([{ id, name: id, operations: ["video.generate"], outputKinds: ["video"], metadata: { canvasRunnable: true } }]);
    for (const dimensions of [{ width: 1921, height: 1080 }, { width: 1920, height: 1081 }, { width: undefined, height: undefined }, { width: 1920.5, height: 1080 }]) {
      const input = { ...request(id), assets: [{ ...video, ...dimensions }] };
      expect((await f.adapter.validate(input)).valid).toBe(false);
      await expect(f.adapter.submit(input)).rejects.toThrow();
    }
    expect(validateCangyuanVideoRequest(request(id, { reference_videos: [video.url] }))).not.toEqual([]);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(model(id).metadata).toMatchObject({ maxInputDimensions: { video: { width: 1920, height: 1080 } } });
  });
  it("uses measured MM3 video durations and rejects absent/overlong reference metadata before generation", () => {
    const asset = { id: "v", kind: "video" as const, mimeType: "video/mp4", url: "https://assets.example/a.mp4", durationSeconds: 9.2 };
    const r = { ...request("mm3-minimax-h3-2k", { duration: 15 }), assets: [asset] };
    expect(normalizeCangyuanVideoParameters(r).reference_videos).toEqual([{ url: asset.url, duration: 9.2 }]);
    expect(validateCangyuanVideoRequest(r)).toEqual([]);
    expect(validateCangyuanVideoRequest({ ...r, assets: [{ ...asset, durationSeconds: undefined }] })).not.toEqual([]);
    expect(validateCangyuanVideoRequest({ ...r, assets: [{ ...asset, durationSeconds: 15.1 }] })).not.toEqual([]);
    expect(validateCangyuanVideoRequest(request(r.model!, { duration: 15, reference_image_urls: Array.from({ length: 9 }, (_, i) => `https://assets.example/${i}.jpg`), reference_audios: ["https://assets.example/a.mp3", "https://assets.example/b.mp3"] }))).not.toEqual([]);
  });
  it("honors official face_mode and asset-library alternatives with mandatory frame pairs", () => {
    const id = "doubao-seedance-2-0-260128";
    expect(validateCangyuanVideoRequest(request(id, { duration: 8, face_mode: true, reference_image_urls: ["https://assets.example/a.jpg"] }))).toEqual([]);
    expect(validateCangyuanVideoRequest(request(id, { duration: 8, reference_image_urls: ["asset://asset-42"] }))).toEqual([]);
    expect(validateCangyuanVideoRequest(request(id, { duration: 8, face_mode: true, reference_image_urls: ["asset://asset-42"] }))).not.toEqual([]);
    expect(validateCangyuanVideoRequest(request(id, { duration: 8, first_image_url: "https://assets.example/a.jpg" }))).not.toEqual([]);
  });
  it("validates distinct reference/output duration rules using measured media", () => {
    const video = { id: "v", kind: "video" as const, mimeType: "video/mp4", url: "https://assets.example/v.mp4", durationSeconds: 11 };
    expect(validateCangyuanVideoRequest({ ...request("sd14-seedance-2.0", { duration: 15 }), assets: [video] })).not.toEqual([]);
    expect(validateCangyuanVideoRequest({ ...request("sd14-seedance-2.0", { duration: 14 }), assets: [video] })).toEqual([]);
    expect(validateCangyuanVideoRequest({ ...request("sd12-seedance-2.0", { duration: 15 }), assets: [video] })).not.toEqual([]);
    expect(validateCangyuanVideoRequest({ ...request("sd12-seedance-2.0-fast", { duration: 14 }), assets: [video] })).toEqual([]);
    expect(validateCangyuanVideoRequest({ ...request("sd12-seedance-2.0-mini", { duration: 15 }), assets: [video] })).toEqual([]);
    expect(validateCangyuanVideoRequest({ ...request("sd13-seedance-2.5"), assets: [{ ...video, durationSeconds: undefined }] })).not.toEqual([]);
    expect(validateCangyuanVideoRequest({ ...request("sd13-seedance-2.5"), assets: [{ ...video, durationSeconds: 30.1 }] })).not.toEqual([]);
    const audio = { id: "a", kind: "audio" as const, mimeType: "audio/mpeg", url: "https://assets.example/a.mp3", durationSeconds: 15.1 };
    expect(validateCangyuanVideoRequest({ ...request("niulai-pro", { duration: 6, reference_image_urls: ["https://assets.example/i.jpg"] }), assets: [audio] })).not.toEqual([]);
    expect(cangyuanVideoTransport("sd10-seedance-2.0")?.submit?.mappings?.some(m => m.target === "/camera_movement")).toBe(true);
    expect(cangyuanVideoTransport("sd10-seedance-2.0")?.submit?.mappings?.some(m => m.target === "/generate_audio")).toBe(false);
  });

  it("uses the freshly verified Gemini Omni Flash discrete durations without admitting intermediate seconds", () => {
    const id = "gemini-omni-flash", current = model(id);
    expect(current.parameters?.find(p => p.key === "duration")).toMatchObject({ control: "select", valueType: "integer", default: 4,
      options: [4, 6, 8, 10].map(value => ({ label: `${value} 秒`, value })) });
    for (const duration of [4, 6, 8, 10]) expect(validateCangyuanVideoRequest(request(id, { duration }))).toEqual([]);
    for (const duration of [-1, 0, 5, 7, 9, 11, 4.5, "6"]) expect(validateCangyuanVideoRequest(request(id, { duration }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
    expect(cangyuanVideoTransport(id)?.submit?.path).toBe("/v1/videos");
  });

  it("keeps SD4 720p output at 4–29 seconds for image/audio references and exposes its separate video condition", () => {
    const id = "sd4-seedance-2.5-720p", current = model(id);
    expect(current.parameters?.find(p => p.key === "duration")).toMatchObject({ min: 4, max: 29, step: 1, default: 4 });
    expect(current.metadata).toMatchObject({ durationMaxWithReferenceVideo: 18, referenceNeedsDuration: true });
    expect(current.metadata?.maxOutputAndInputVideoDurationSeconds).toBeUndefined();
    expect(current.limits).toMatchObject({ maxInputVideos: 10, maxInputAudios: 10, maxInputVideoDurationSeconds: 30.2, maxTotalInputVideoDurationSeconds: 30.2, maxInputAudioDurationSeconds: 30.2 });
    for (const duration of [4, 18, 19, 29]) expect(validateCangyuanVideoRequest(request(id, { duration }))).toEqual([]);
    for (const duration of [3, 30, 4.5, "29"]) expect(validateCangyuanVideoRequest(request(id, { duration }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
    const assets = [
      { id: "i", kind: "image" as const, mimeType: "image/png", url: "https://media.test/image.png" },
      { id: "a", kind: "audio" as const, mimeType: "audio/mpeg", url: "https://media.test/audio.mp3", durationSeconds: 30.2 },
    ];
    expect(validateCangyuanVideoRequest({ ...request(id, { duration: 29 }), assets })).toEqual([]);
    expect(model("sd4-seedance-2.5-480p").parameters?.find(p => p.key === "duration")?.max).toBe(30);
    expect(model("sd4-seedance-2.5-480p").metadata?.durationMaxWithReferenceVideo).toBeUndefined();
  });

  it("enforces the SD4 18-second output limit after merging explicit and asset references, before transport", async () => {
    const id = "sd4-seedance-2.5-720p";
    const video = { id: "v", kind: "video" as const, mimeType: "video/mp4", url: "https://media.test/video.mp4", durationSeconds: 30.2 };
    for (const parameters of [{ duration: 18 }, { seconds: 18, reference_videos: [video.url] }]) {
      const input = { ...request(id, parameters), assets: [video] };
      expect(normalizeCangyuanVideoParameters(input)).toMatchObject({ duration: 18, reference_videos: [video.url] });
      // Output and reference are separate limits: 18 + 30.2 is allowed.
      expect(validateCangyuanVideoRequest(input)).toEqual([]);
      expect(validateCangyuanVideoRequest({ ...input, parameters: { duration: 19, reference_videos: parameters.reference_videos } })).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
    }
    expect(validateCangyuanVideoRequest(request(id, { duration: 19, reference_videos: [video.url] }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
    const f = sd8Fixture([{ id, name: id, operations: ["video.generate"], outputKinds: ["video"], metadata: { canvasRunnable: true } }]);
    const invalid = { ...request(id, { duration: 19 }), assets: [video] };
    expect((await f.adapter.validate(invalid)).valid).toBe(false);
    await expect(f.adapter.submit(invalid)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("checks SD4 measured video and audio single/total durations at 30.2 seconds instead of estimating them", () => {
    const id = "sd4-seedance-2.5-720p";
    for (const kind of ["video", "audio"] as const) {
      const asset = { id: kind, kind, mimeType: kind === "video" ? "video/mp4" : "audio/mpeg", url: `https://media.test/${kind}`, durationSeconds: 30.2 };
      const field = kind === "video" ? "parameters.reference_videos" : "parameters.reference_audios";
      const input = { ...request(id, { duration: 18 }), assets: [asset] };
      expect(validateCangyuanVideoRequest(input)).toEqual([]);
      for (const durationSeconds of [30.21, undefined]) expect(validateCangyuanVideoRequest({ ...input, assets: [{ ...asset, durationSeconds }] })).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: field })]));
      expect(validateCangyuanVideoRequest({ ...input, assets: [{ ...asset, durationSeconds: 10.1 }, { ...asset, id: `${kind}-2`, url: `${asset.url}-2`, durationSeconds: 20.1 }] })).toEqual([]);
      expect(validateCangyuanVideoRequest({ ...input, assets: [{ ...asset, durationSeconds: 15.2 }, { ...asset, id: `${kind}-2`, url: `${asset.url}-2`, durationSeconds: 15.2 }] })).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: field })]));
    }
  });

  it("keeps the new SD8 S contract distinct, with its own checked date and no guessed price or resolution field", () => {
    const current = model(sd8s);
    expect(current.operations).toEqual(["video.generate", "video.image-to-video"]);
    expect(current.outputKinds).toEqual(["video"]);
    expect(current.inputKinds).toEqual(["text", "image", "image[]", "video", "video[]", "audio", "audio[]"]);
    expect(current.limits).toMatchObject({ maxInputImages: 30, maxInputVideos: 10, maxInputAudios: 10 });
    expect(current.parameters?.map(p => p.key)).toEqual(["duration", "aspect_ratio"]);
    expect(current.parameters?.find(p => p.key === "duration")).toMatchObject({ default: 30, options: [{ label: "30 秒", value: 30 }] });
    expect(current.metadata).toMatchObject({ canvasRunnable: false, canvasUnavailableReason: "403 权限不足", facePolicy: "open", videoFixedResolution: "720p",
      supportsFirstLastFrames: false, referenceNeedsDuration: false, cangyuanVideoContractCheckedAt: "2026-10-08",
      documentationUrl: "https://ai.cangyuansuanli.cn/docs-static/models/sd8-seedance-2.5-s.json", videoPollingTimeoutMs: 1_800_000 });
    expect(current.pricing).toBeUndefined();
    const price: StructuredModelPricing = { kind: "per-request", currency: "CNY", billingUnit: "request", unitAmount: 3, checkedAt: "fixture", confidence: "exact" };
    expect(cangyuanVideoModel({ ...current, pricing: price }).pricing).toBe(price);
    expect(model("sd8-seedance-2.5").limits).toMatchObject({ maxInputImages: 9, maxInputVideos: 0, maxInputAudios: 0 });
    expect(model("sd8-seedance-2.5").metadata?.cangyuanVideoContractCheckedAt).toBe("2026-10-07");
    expect(isCangyuanVideoModel("sd8-seedance-2.5-s-fast")).toBe(false);
    expect(isCangyuanVideoRequest(sd8s, "https://another-supplier.test/v1")).toBe(false);
  });

  it.each(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"])("accepts the SD8 S official %s ratio at its fixed duration", aspect_ratio => {
    expect(validateCangyuanVideoRequest(request(sd8s, { duration: 30, aspect_ratio }))).toEqual([]);
  });

  it("accepts exact reference-count limits without borrowing another model's input-duration rules", () => {
    const refs = { reference_image_urls: Array.from({ length: 30 }, (_, i) => `https://media.test/${i}.jpg`),
      reference_videos: Array.from({ length: 10 }, (_, i) => `https://media.test/${i}.mp4`),
      reference_audios: Array.from({ length: 10 }, (_, i) => `https://media.test/${i}.mp3`) };
    expect(validateCangyuanVideoRequest(request(sd8s, { duration: 30, ...refs }))).toEqual([]);
    const video = { id: "video", kind: "video" as const, mimeType: "video/mp4", url: "https://media.test/unknown-duration.mp4" };
    const audio = { id: "audio", kind: "audio" as const, mimeType: "audio/mpeg", url: "https://media.test/unknown-duration.mp3" };
    expect(validateCangyuanVideoRequest({ ...request(sd8s, { duration: 30 }), assets: [video, audio] })).toEqual([]);
  });

  it.each([
    { name: "29-second output", parameters: { duration: 29 } },
    { name: "string duration", parameters: { duration: "30" } },
    { name: "unsupported ratio", parameters: { aspect_ratio: "2:3" } },
    { name: "resolution despite fixed output", parameters: { resolution: "720p" } },
    { name: "first frame", parameters: { first_image_url: "https://media.test/first.jpg" } },
    { name: "last frame", parameters: { last_image_url: "https://media.test/last.jpg" } },
    { name: "borrowed face switch", parameters: { face_mode: true } },
    { name: "borrowed sound switch", parameters: { generate_audio: true } },
    { name: "multiple tasks", parameters: { n: 2 } },
    { name: "31 images", parameters: { reference_image_urls: Array.from({ length: 31 }, (_, i) => `https://media.test/${i}.jpg`) } },
    { name: "11 videos", parameters: { reference_videos: Array.from({ length: 11 }, (_, i) => `https://media.test/${i}.mp4`) } },
    { name: "11 audios", parameters: { reference_audios: Array.from({ length: 11 }, (_, i) => `https://media.test/${i}.mp3`) } },
    { name: "authenticated HTTPS URL", parameters: { reference_videos: ["https://user:password@media.test/a.mp4"] } },
    { name: "HTTP audio", parameters: { reference_audios: ["http://media.test/a.mp3"] } },
    { name: "borrowed asset library", parameters: { reference_image_urls: ["asset://image"] } },
  ])("rejects SD8 S $name before making a generation request", async ({ parameters }) => {
    const f = sd8Fixture(), input = request(sd8s, parameters);
    expect((await f.adapter.validate(input)).valid).toBe(false);
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each([{ models: [] }, { models: [model(sd8s)] }])("does not grant SD8 S access when the current Key catalog is absent or denied", async ({ models }) => {
    const f = sd8Fixture(models);
    await expect(f.adapter.submit(request(sd8s, { duration: 30 }))).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("submits the exact SD8 S JSON, polls its task and extracts video while repairing a stale saved image transport", async () => {
    const f = sd8Fixture(), original = structuredClone(f.connection);
    const assets = [
      { id: "image", kind: "image" as const, mimeType: "image/png", url: "https://media.test/image.png" },
      { id: "video", kind: "video" as const, mimeType: "video/mp4", url: "https://media.test/video.mp4" },
      { id: "audio", kind: "audio" as const, mimeType: "audio/mpeg", url: "https://media.test/audio.mp3" },
    ];
    f.fetcher.mockResolvedValueOnce(Response.json({ id: "video_42", status: "queued", progress: 0 }))
      .mockResolvedValueOnce(Response.json({ status: "completed", progress: 100, video_url: "https://media.test/result.mp4" }));
    const input = { ...request(sd8s, { duration: 30, aspect_ratio: "9:16" }), assets };
    expect((await f.adapter.validate(input)).valid).toBe(true);
    expect(f.fetcher).not.toHaveBeenCalled();
    const task = await f.adapter.submit(input);
    expect(task).toMatchObject({ providerTaskId: "video_42", status: "queued", pollAfterMs: 5000 });
    const [url, init] = f.fetcher.mock.calls[0]!;
    expect(url).toBe("https://ai.cangyuansuanli.cn/v1/videos");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-sd8s-key");
    expect(JSON.parse(String(init?.body))).toEqual({ model: sd8s, prompt: input.prompt, duration: 30, aspect_ratio: "9:16",
      reference_image_urls: [assets[0]!.url], reference_videos: [assets[1]!.url], reference_audios: [assets[2]!.url] });
    const restarted = JSON.parse(JSON.stringify(task));
    const state = await f.adapter.poll(restarted);
    expect(state.status).toBe("succeeded");
    expect(f.fetcher.mock.calls[1]?.[0]).toBe("https://ai.cangyuansuanli.cn/v1/videos/video_42");
    expect(f.fetcher.mock.calls[1]?.[1]?.method).toBe("GET");
    expect(await f.adapter.extractOutputs(state.result)).toEqual([{ kind: "video", url: "https://media.test/result.mp4", mimeType: "video/mp4" }]);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.connection).toEqual(original);
    expect(offlineNetwork.lookup).toHaveBeenCalled();
    for (const [hostname] of offlineNetwork.lookup.mock.calls as unknown as [string][]) expect(hostname).toBe("ai.cangyuansuanli.cn");
  });
});

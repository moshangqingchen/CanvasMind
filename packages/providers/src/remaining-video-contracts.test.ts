import { describe, expect, it } from "vitest";
import type { NormalizedRequest, ProviderAssetInput } from "./contracts.js";
import { isRemainingVideoModel, normalizeRemainingVideoParameters, remainingVideoModel, remainingVideoModelIds, remainingVideoRequestIssues, remainingVideoSupplier, remainingVideoTransport } from "./remaining-video-contracts.js";

const request = (model: string, parameters: Record<string, unknown> = {}, assets: ProviderAssetInput[] = []): NormalizedRequest => ({
  model, parameters, assets, connectionId: "test-connection", operation: assets.some(asset => asset.kind === "image") ? "video.image-to-video" : "video.generate", prompt: "A slow camera move.", idempotencyKey: "no-network-test",
});
const asset = (kind: "image" | "video" | "audio", n = 1, role?: ProviderAssetInput["role"], durationSeconds?: number): ProviderAssetInput => ({
  id: `asset-${kind}-${n}`, kind, mimeType: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg", url: `https://media.example/${kind}-${n}`, ...(role ? { role } : {}), ...(durationSeconds !== undefined ? { durationSeconds } : {}),
});
const targets = (supplier: Parameters<typeof remainingVideoTransport>[0], id: string, group?: string) => remainingVideoTransport(supplier, id, { group })?.submit?.mappings?.map(mapping => mapping.target);

describe("supplier video contracts", () => {
  it("scopes the contracts to exact supplier hosts and exact public IDs", () => {
    expect(remainingVideoSupplier("https://api.3365api.cn/v1")).toBe("cyberafei");
    expect(remainingVideoSupplier("https://token.secure-skill.com/v1")).toBe("secure");
    expect(remainingVideoSupplier("https://video.we-token.cc/v1")).toBe("weai");
    expect(remainingVideoSupplier("https://api.3365api.cn.evil.example/v1")).toBeUndefined();
    expect(isRemainingVideoModel("chentu", "seedance2.0 900")).toBe(true);
    expect(isRemainingVideoModel("chentu", "seedance2.0-900")).toBe(false);
    expect(isRemainingVideoModel("secure", "wan3.0")).toBe(false);
    expect(remainingVideoModelIds("chentu")).toHaveLength(34);
  });

  it("keeps Seedance 431 vendor wire fields distinct and validates measured durations", () => {
    const input = request("seedance-2.0-431-480p", { duration: 8 }, [asset("image"), asset("video", 1, undefined, 8), asset("audio", 1, undefined, 5)]);
    expect(normalizeRemainingVideoParameters("chentu", input)).toMatchObject({ image_urls: ["https://media.example/image-1"], video_reference: [{ url: "https://media.example/video-1" }], audio_reference: "https://media.example/audio-1" });
    expect(remainingVideoRequestIssues("chentu", input)).toEqual([]);
    expect(remainingVideoRequestIssues("chentu", request(input.model!, {}, [asset("video", 1, undefined, 12)]))).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("3–10 秒") })]));
  });

  it("retains fixed durations and prohibits invented model resolutions", () => {
    expect(remainingVideoRequestIssues("chentu", request("seedance-2.0-v4", { duration: 6 }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
    expect(remainingVideoRequestIssues("chentu", request("seedance-2.0-480p", { resolution: "1080p" }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.resolution" })]));
    expect(remainingVideoRequestIssues("chentu", request("seedance2.0 900", {}, [asset("audio")]))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "assets" })]));
  });

  it("maps native first/last frames and enforces Kling reference exclusivity", () => {
    const input = request("kling-v3", {}, [asset("image", 1, "firstFrame"), asset("image", 2, "lastFrame")]);
    expect(normalizeRemainingVideoParameters("chentu", input)).toMatchObject({ start_frame: ["https://media.example/image-1"], end_frame: ["https://media.example/image-2"] });
    expect(remainingVideoRequestIssues("chentu", input)).toEqual([]);
    expect(remainingVideoRequestIssues("chentu", request("kling-v3", { start_frame: ["https://a.example/1", "https://a.example/2"] }))).toEqual(expect.arrayContaining([expect.objectContaining({ message: "首帧和尾帧分别最多一张。" })]));
    expect(normalizeRemainingVideoParameters("chentu", request("kling-o3", { duration: 10 }, [asset("video")]))).not.toHaveProperty("seconds");
    expect(remainingVideoRequestIssues("chentu", request("kling-o3", { resolution: "2160p" }, [asset("video")]))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.resolution" })]));
  });

  it("keeps the SP Kling motion-reference character image and video fields", () => {
    const input = request("sp-kling-3.0-omni-720p", { duration: 10 }, [asset("image"), asset("video")]);
    expect(normalizeRemainingVideoParameters("chentu", input)).toMatchObject({ image_url: "https://media.example/image-1", reference_video: "https://media.example/video-1" });
    expect(normalizeRemainingVideoParameters("chentu", input)).not.toHaveProperty("image_urls");
    expect(remainingVideoRequestIssues("chentu", input)).toEqual([]);
  });

  it("does not fabricate Sora's Key-dependent duration and ratio lists", () => {
    const model = remainingVideoModel("chentu", "sora-v3-pro")!;
    expect(model.parameters?.find(parameter => parameter.key === "duration")?.max).toBeUndefined();
    expect(model.parameters?.find(parameter => parameter.key === "aspect_ratio")?.control).toBe("text");
    expect(normalizeRemainingVideoParameters("chentu", request(model.id))).toMatchObject({ resolution: "720p" });
    expect(model.metadata?.billingUnit).toBe("second");
  });

  it("uses distinct FriModel reference and Grok mode fields", () => {
    const input = request("videos-standard", { duration: 8, resolution: "1080p" }, [asset("image"), asset("video"), asset("audio")]);
    expect(normalizeRemainingVideoParameters("frimodel", input)).toMatchObject({ ratio: "16:9", referenceImages: ["https://media.example/image-1"], referenceVideos: ["https://media.example/video-1"], referenceAudios: ["https://media.example/audio-1"] });
    expect(normalizeRemainingVideoParameters("frimodel", request("grok-imagine-video", {}, [asset("image")]))).toMatchObject({ image: "https://media.example/image-1", mode: "image-to-video" });
    expect(remainingVideoRequestIssues("frimodel", request("grok-imagine-video", { duration: 12 }, [asset("image"), asset("image", 2)]))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
  });

  it("implements We-AI's exact Omni model, seconds and fixed-resolution protocol", () => {
    const input = request("omni-flash-components-4k", { duration: 8, resolution: "4K" }, [asset("image"), asset("image", 2)]);
    expect(normalizeRemainingVideoParameters("weai", input)).toEqual({ seconds: 8, aspect_ratio: "16:9", images: ["https://media.example/image-1", "https://media.example/image-2"] });
    expect(targets("weai", input.model!)).not.toContain("/resolution");
    expect(remainingVideoRequestIssues("weai", request(input.model!, { duration: 5 }, [asset("image")]))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
    expect(isRemainingVideoModel("weai", "seedance-2.0-1080p")).toBe(false);
  });

  it("requires the source video for We-AI editing", () => {
    expect(remainingVideoRequestIssues("weai", request("omni-flash-edit"))).toEqual(expect.arrayContaining([expect.objectContaining({ message: "此型号必须提供源视频。" })]));
    expect(normalizeRemainingVideoParameters("weai", request("omni-flash-edit", {}, [asset("video")]))).toMatchObject({ input_video: "https://media.example/video-1" });
  });

  it("does not enable Secure's ambiguous shared IDs without a group contract", () => {
    expect(remainingVideoModel("secure", "seedance-2.5")).toBeUndefined();
    expect(remainingVideoTransport("secure", "seedance-2.5")).toBeUndefined();
    expect(remainingVideoModel("secure", "seedance-2.5", undefined, { group: "sd特价分组1" })?.limits?.maxInputImages).toBe(30);
    const vivid = remainingVideoModel("secure", "seedance-2.5", undefined, { group: "vividai-video" })!;
    expect(vivid.parameters?.find(parameter => parameter.key === "duration")?.options?.map(option => option.value)).toEqual([15]);
    expect(vivid.parameters?.some(parameter => parameter.key === "aspect_ratio")).toBe(false);
    expect(normalizeRemainingVideoParameters("secure", request("seedance-2.5", { aspect_ratio: "1:1" }), { group: "vividai-video" })).not.toHaveProperty("aspect_ratio");
  });

  it("distinguishes Secure per-request SD2 and per-second SD2.5", () => {
    expect(remainingVideoModel("secure", "seedance2.0", undefined, { group: "sd特价分组1" })?.metadata?.billingUnit).toBe("request");
    expect(remainingVideoModel("secure", "seedance-2.5", undefined, { group: "sd特价分组1" })?.metadata?.billingUnit).toBe("second");
    expect(remainingVideoRequestIssues("secure", request("seedance-2.5", { duration: 31 }), { group: "sd特价分组1" })).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
  });

  it("builds Doubao role-aware content for frames and keeps audio references", () => {
    const input = request("doubao-seedance-2-5-260628", { seed: 7, generate_audio: true }, [asset("image", 1, "firstFrame"), asset("image", 2, "lastFrame"), asset("audio")]);
    const p = normalizeRemainingVideoParameters("secure", input);
    expect(p).toMatchObject({ seed: 7, generate_audio: true, content: [{ type: "text", text: input.prompt }, { type: "image_url", image_url: { url: "https://media.example/image-1" }, role: "first_frame" }, { type: "image_url", image_url: { url: "https://media.example/image-2" }, role: "last_frame" }, { type: "audio_url", audio_url: { url: "https://media.example/audio-1" }, role: "reference_audio" }] });
    expect(p).not.toHaveProperty("images");
    expect(remainingVideoRequestIssues("secure", input)).toEqual([]);
    expect(remainingVideoRequestIssues("secure", request(input.model!, {}, [...input.assets!, asset("video")]))).toEqual(expect.arrayContaining([expect.objectContaining({ message: "Doubao 首尾帧不能与参考视频混用。" })]));
  });

  it("does not silently discard duplicate native content or infer optional Doubao 4K permission", () => {
    const input = request("doubao-seedance-2-5-260628", { content: [{ type: "text", text: "other" }], resolution: "4K" }, [asset("image")]);
    expect(remainingVideoRequestIssues("secure", input).map(issue => issue.path)).toEqual(expect.arrayContaining(["parameters.content", "parameters.resolution"]));
    expect(remainingVideoModel("secure", input.model!, { id: input.model!, name: "test", operations: [], metadata: { videoSupportedResolutions: ["4K"] } })?.parameters?.find(parameter => parameter.key === "resolution")?.options).toEqual(expect.arrayContaining([expect.objectContaining({ value: "4K" })]));
  });

  it("preserves native Doubao frame and audio fields when converting to content", () => {
    const input = request("doubao-seedance-2-5-260628", { first_frame: "https://media.example/first", audios: ["https://media.example/voice"] });
    expect(normalizeRemainingVideoParameters("secure", input).content).toEqual([{ type: "text", text: input.prompt },
      { type: "image_url", image_url: { url: "https://media.example/first" }, role: "first_frame" },
      { type: "audio_url", audio_url: { url: "https://media.example/voice" }, role: "reference_audio" }]);
    expect(remainingVideoRequestIssues("secure", input)).toEqual([]);
  });

  it("uses Wan3's separate synthesis envelope and task polling", () => {
    const input = request("wan3.0-video", { duration: 6, aspect_ratio: "2.35:1", prompt_extend: true }, [asset("image"), asset("video"), asset("audio")]);
    expect(normalizeRemainingVideoParameters("secure", input)).toMatchObject({ resolution: "720P", ratio: "2.35:1", media: [{ type: "reference_image", url: "https://media.example/image-1" }, { type: "reference_video", url: "https://media.example/video-1" }, { type: "audio", url: "https://media.example/audio-1" }], prompt_extend: true });
    expect(remainingVideoTransport("secure", input.model!)?.submit?.path).toBe("/v1/videos/generations");
    expect(remainingVideoTransport("secure", input.model!)?.poll?.path).toBe("/v1/videos/tasks/{taskId}");
    expect(remainingVideoRequestIssues("secure", input)).toEqual([]);
    expect(remainingVideoRequestIssues("secure", request(input.model!, { media: [{ type: "last_frame", url: "https://media.example/last" }] }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.media" })]));
  });

  it("rejects non-HTTPS Wan3 native references and excessive measured source durations", () => {
    expect(remainingVideoRequestIssues("secure", request("wan3.0-video", { media: [{ type: "reference_video", url: "http://media.example/video" }] }))).toEqual(expect.arrayContaining([expect.objectContaining({ message: "此型号的参考素材必须使用公网 HTTPS 地址。" })]));
    expect(remainingVideoRequestIssues("secure", request("wan3.0-video", { duration: -1 }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
  });

  it("keeps MiniMax group resolution permissions and frame exclusivity explicit", () => {
    expect(remainingVideoModel("secure", "minimax-h3")?.parameters?.some(parameter => parameter.key === "resolution")).toBe(false);
    const input = request("minimax-h3", { duration: 15 }, [asset("image", 1, "firstFrame"), asset("audio")]);
    expect(normalizeRemainingVideoParameters("secure", input)).toMatchObject({ first_frame: "https://media.example/image-1", audio_urls: ["https://media.example/audio-1"] });
    expect(remainingVideoRequestIssues("secure", input)).toEqual(expect.arrayContaining([expect.objectContaining({ message: "MiniMax 首尾帧不能与参考视频或参考音频混用。" })]));
  });

  it("maps Secure Grok image and voice input without uploading audio as voice IDs", () => {
    const input = request("grok-imagine-video-1.5-preview", { reference_voice_ids: "voice-a, voice-b", duration: 8 }, [asset("image")]);
    expect(normalizeRemainingVideoParameters("secure", input)).toMatchObject({ image: { url: "https://media.example/image-1" }, reference_audios: [{ voice_id: "voice-a" }, { voice_id: "voice-b" }] });
    expect(normalizeRemainingVideoParameters("secure", input)).not.toHaveProperty("reference_voice_ids");
    expect(remainingVideoRequestIssues("secure", input)).toEqual([]);
    expect(remainingVideoRequestIssues("secure", request(input.model!, {}, [asset("audio")]))).toEqual(expect.arrayContaining([expect.objectContaining({ message: "Grok 参考声音只接受供应商 voice_id，不接受音频素材 URL。" })]));
    expect(remainingVideoRequestIssues("secure", request(input.model!, { reference_voice_ids: "a,b,c,d" }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.reference_voice_ids" })]));
  });

  it("enforces Secure Grok multi-reference limits and uses the authenticated download path", () => {
    const input = request("grok-imagine-video-1.5", { duration: 12, resolution: "1080p" }, [asset("image"), asset("image", 2)]);
    expect(remainingVideoRequestIssues("secure", input).map(issue => issue.path)).toEqual(expect.arrayContaining(["parameters.duration", "parameters.resolution"]));
    expect(remainingVideoTransport("secure", input.model!)?.output?.contentFallback?.path).toBe("/openai/v1/videos/{taskId}/content");
    expect(remainingVideoTransport("secure", input.model!)?.submit?.response?.taskIdFallbackPaths).toContain("$.request_id");
  });

  it("keeps Flow Job transport separate and omits unsupported duration fields", () => {
    expect(remainingVideoTransport("secure", "veo_fast")).toBeUndefined();
    const context = { group: "flow" };
    const input = request("veo_fast", { duration: 8, mode: "auto" }, [asset("image", 1, "firstFrame"), asset("image", 2, "lastFrame")]);
    const p = normalizeRemainingVideoParameters("secure", input, context);
    expect(p).toMatchObject({ mode: "image", messages: [{ role: "user", content: [{ type: "text", text: input.prompt }, { type: "image_url", image_url: { url: "https://media.example/image-1" } }, { type: "image_url", image_url: { url: "https://media.example/image-2" } }] }] });
    expect(p).not.toHaveProperty("duration");
    expect(targets("secure", input.model!, context.group)).not.toContain("/prompt");
    expect(remainingVideoTransport("secure", input.model!, context)?.poll?.path).toBe("/v1/jobs/{taskId}");
    expect(remainingVideoRequestIssues("secure", input, context)).toEqual([]);
  });

  it("validates Flow quality/mode combinations and source-dependent Omni duration", () => {
    const context = { group: "flow" };
    expect(remainingVideoRequestIssues("secure", request("veo_fast", { aspect_ratio: "9:16" }), context)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.aspect_ratio" })]));
    expect(remainingVideoRequestIssues("secure", request("veo3.1", { quality: "quality", resolution: "1080p", mode: "image" }, [asset("image")]), context)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.resolution" })]));
    const edited = request("omni", { duration: 8 }, [asset("video", 1, undefined, 29)]);
    expect(normalizeRemainingVideoParameters("secure", edited, context)).not.toHaveProperty("duration");
    expect(remainingVideoRequestIssues("secure", request("omni", {}, [asset("video", 1, undefined, 31)]), context)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "assets" })]));
  });

  it("supports Afei's fixed Grok aliases and SD2 alias durations with authenticated results", () => {
    const input = request("grok-imagine-video-1.5-1080p", { duration: 8 }, [asset("image")]);
    expect(normalizeRemainingVideoParameters("cyberafei", input)).toMatchObject({ image: { url: "https://media.example/image-1" }, duration: 8 });
    expect(normalizeRemainingVideoParameters("cyberafei", input)).not.toHaveProperty("resolution");
    const seedance = request("video-v1-10s", { duration: 10 }, [asset("image")]);
    expect(normalizeRemainingVideoParameters("cyberafei", seedance)).toEqual({ ratio: "16:9", images: ["https://media.example/image-1"] });
    expect(remainingVideoTransport("cyberafei", seedance.model!)?.output?.contentFallback?.path).toBe("/v1/videos/{taskId}/content");
    expect(remainingVideoTransport("cyberafei", seedance.model!)?.poll?.path).toBe("/v1/video/generations/{taskId}");
  });
});

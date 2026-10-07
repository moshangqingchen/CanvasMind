import { describe, expect, it } from "vitest";
import type { NormalizedRequest } from "./contracts.js";
import { CHUANGXIANG_VIDEO_TIMEOUT_MS, chuangxiangVideoModel, isChuangxiangVideoConnection, normalizeChuangxiangVideoParameters, validateChuangxiangVideoRequest } from "./chuangxiang-video-contract.js";

const request = (model: string, parameters: Record<string, unknown> = {}): NormalizedRequest => ({ connectionId: "test", idempotencyKey: "test", operation: "video.generate", prompt: "云朵", model, parameters });
const image = (role: "reference" | "firstFrame" | "lastFrame", id = role) => ({ id, kind: "image" as const, role, mimeType: "image/jpeg", url: `https://assets.example/${id}.jpg` });
describe("current Chuangxiang video contract", () => {
  it("scopes the contract to the official video group and exact public models", () => {
    const config = { baseUrl: "https://vapi.chuangxiangai.asia/v1", accountKeyGroup: "视频" };
    expect(isChuangxiangVideoConnection(config, "sd10-seedance-2.0")).toBe(true);
    for (const altered of [{ ...config, baseUrl: "https://other.example" }, { ...config, accountKeyGroup: "生图" }, { ...config, usage: "agent" }]) expect(isChuangxiangVideoConnection(altered, "sd10-seedance-2.0")).toBe(false);
    expect(isChuangxiangVideoConnection(config, "sd10-seedance-99")).toBe(false);
  });
  it.each([["sd10-seedance-2.0", [5, 10, 15]], ["sd10-seedance-2.0-fast", [5, 10, 15]], ["sd10-seedance-2.0-mini", [5, 10]], ["sd10-seedance-2.5", [30]], ["ve1-veo-3.1-fast", [4, 6, 8]]])("enforces discrete durations for %s", (id, seconds) => {
    const model = chuangxiangVideoModel(String(id));
    expect(model.parameters?.find(p => p.key === "duration")?.options?.map(o => o.value)).toEqual(seconds);
    expect(validateChuangxiangVideoRequest(request(String(id), { duration: -1 }))).not.toEqual([]);
    expect(validateChuangxiangVideoRequest(request(String(id), { duration: (seconds as number[])[0] }))).toEqual([]);
  });
  it("maps all reference types and frame roles without multiplying a per-request price", () => {
    const r = { ...request("sd11-seedance-2.5", { duration: 15 }), assets: [image("reference"), image("firstFrame"), image("lastFrame"), { id: "audio", kind: "audio" as const, mimeType: "audio/mpeg", url: "https://assets.example/a.mp3" }] };
    expect(normalizeChuangxiangVideoParameters(r)).toEqual({ seconds: 15, n: 1, reference_image_urls: ["https://assets.example/reference.jpg"], reference_audios: ["https://assets.example/a.mp3"], first_image_url: "https://assets.example/firstFrame.jpg", last_image_url: "https://assets.example/lastFrame.jpg" });
    const pricing = { kind: "per-request" as const, currency: "CNY", unitAmount: 5.2, checkedAt: "today", confidence: "snapshot" as const };
    expect(chuangxiangVideoModel("sd10-seedance-2.0", { id: "sd10-seedance-2.0", name: "sd10", operations: ["video.generate"], pricing }).pricing).toEqual(pricing);
    expect(CHUANGXIANG_VIDEO_TIMEOUT_MS).toBe(1_800_000);
  });
  it("rejects unsupported references, invalid HTTPS sources and incompatible frame combinations", () => {
    expect(validateChuangxiangVideoRequest({ ...request("sd10-seedance-2.0", { duration: 5, reference_audios: ["https://assets.example/a.mp3"] }) })).not.toEqual([]);
    expect(validateChuangxiangVideoRequest(request("wan5-wan3.0", { reference_image_urls: ["https://assets.example/a.jpg"] }))).not.toEqual([]);
    for (const url of ["data:image/png;base64,a", "C:/a.jpg", "https://localhost/a.jpg", "https://example.com/v1/files/a"]) expect(validateChuangxiangVideoRequest(request("sd11-seedance-2.0", { reference_image_urls: [url] }))).not.toEqual([]);
    expect(validateChuangxiangVideoRequest({ ...request("sd14-seedance-2.0"), assets: [image("reference"), image("firstFrame")] })).not.toEqual([]);
    expect(validateChuangxiangVideoRequest({ ...request("ve1-veo-3.1-fast", { duration: 8 }), assets: [image("lastFrame")] })).not.toEqual([]);
    expect(validateChuangxiangVideoRequest(request("sd12-seedance-2.0", { reference_audios: ["https://assets.example/a.mp3"] }))).not.toEqual([]);
    expect(validateChuangxiangVideoRequest(request("omni-v2v", { reference_videos: [] }))).not.toEqual([]);
  });
  it("uses SD11 2.5's separate limits while SD13 excludes audio and frames", () => {
    expect(chuangxiangVideoModel("sd11-seedance-2.5").metadata).toMatchObject({ videoReferenceImageLimit: 30, videoReferenceVideoLimit: 10, videoReferenceAudioLimit: 10 });
    expect(chuangxiangVideoModel("sd13-seedance-2.5").limits).toMatchObject({ maxInputImages: 30, maxInputVideos: 10, maxInputAudios: 0 });
  });
  it("replaces stale generic frame/audio flags with the exact documented combination rules", () => {
    const stale = { id: "sd11-seedance-2.0", name: "SD11", operations: ["video.generate" as const], metadata: { supportsFirstLastFrames: false, allowFrameMediaMix: false, requiresImageWithAudio: true } };
    expect(chuangxiangVideoModel(stale.id, stale).metadata).toMatchObject({ supportsFirstLastFrames: true, allowFrameMediaMix: true, requiresImageWithAudio: false });
    expect(chuangxiangVideoModel("sd14-seedance-2.0").metadata?.allowFrameMediaMix).toBe(false);
    expect(chuangxiangVideoModel("sd10-seedance-2.0").metadata?.supportsFirstLastFrames).toBe(false);
    expect(validateChuangxiangVideoRequest({ ...request(stale.id), assets: [image("firstFrame"), image("reference")] })).toEqual([]);
    expect(validateChuangxiangVideoRequest(request("sd12-seedance-2.0", { reference_videos: ["https://assets.example/v.mp4"], reference_audios: ["https://assets.example/a.mp3"] }))).toEqual([]);
  });
});

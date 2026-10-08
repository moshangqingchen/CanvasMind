import { describe, expect, it } from "vitest";
import type { NormalizedRequest } from "./contracts.js";
import { cangyuanVideoModel, cangyuanVideoTransport, isCangyuanVideoRequest, normalizeCangyuanVideoParameters, validateCangyuanVideoRequest } from "./cangyuan-video-contract.js";
const request = (model: string, parameters: Record<string, unknown> = {}): NormalizedRequest => ({ connectionId: "test", model, operation: "video.generate", prompt: "海边公路", idempotencyKey: "test", parameters });
const model = (id: string) => cangyuanVideoModel({ id, name: id, operations: ["video.generate"], metadata: { canvasRunnable: false, canvasUnavailableReason: "403 权限不足" } });
describe("fresh Cangyuan per-model video contracts", () => {
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
});

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import type { RemoteArtifact } from "@super-canvas/providers";
import type { ObjectStorage, StoredObject } from "@super-canvas/storage";
import { RunService } from "../src/service.js";
import * as remote from "../src/remote-download.js";
import * as videoValidation from "../src/video-output-validation.js";
import { validWebmBytes, validWebmWithAudioBytes } from "./fixtures/video-bytes.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

class StreamStorage implements ObjectStorage {
  readonly originals = new Map<string, StoredObject>();
  readonly put = vi.fn(async (key: string, bytes: Uint8Array, contentType: string) => {
    this.originals.set(key, { bytes: new Uint8Array(bytes), contentType });
  });
  readonly putStream = vi.fn(async (key: string, chunks: AsyncIterable<Uint8Array>, contentType: string) => {
    const parts: Uint8Array[] = [];
    for await (const chunk of chunks) parts.push(chunk);
    const bytes = Buffer.concat(parts);
    this.originals.set(key, { bytes, contentType });
    return { size: bytes.length, contentType, etag: createHash("sha256").update(bytes).digest("hex") };
  });
  async get(key: string) { return this.originals.get(key) ?? null; }
}

async function fixture(parameters: JsonObject = {}) {
  const repository = new MemoryRepository(), storage = new StreamStorage();
  const canvas = await repository.ensureDefaultCanvas();
  await repository.createRun({ id: "original-video-run", canvasId: canvas.id, clientRequestId: "original-video-request",
    scope: "all", status: "needs_attention", revisionGraph: { schemaVersion: 1, nodes: [], edges: [] } });
  await repository.createNodeRun({ id: "original-video-node", workflowRunId: "original-video-run", nodeId: "video",
    status: "needs_attention", attempt: 1, providerTaskId: "paid-existing-task",
    inputJson: { provider: "openai", connectionId: "original-video-connection", parameters }, outputAssetIds: [], errorJson: null });
  const service = new RunService({ repository, storage, executionMode: "queue", enqueueRun: async () => {} });
  // Exercise the same persistence boundary used by submit, polling and archive-only recovery.
  const archive = (artifact: RemoteArtifact) => (service as unknown as {
    archiveArtifact: (artifact: RemoteArtifact, run: string, node: string, index: number) => Promise<string>;
  }).archiveArtifact(artifact, "original-video-run", "video", 0);
  return { repository, storage, archive };
}

describe("original video archive verification", () => {
  it("streams genuine WebM with a reported MP4 MIME into its original encoding and filename", async () => {
    const { archive, repository, storage } = await fixture();
    const download = vi.spyOn(remote, "consumeRemoteArtifact").mockImplementation(async (_url, consume) =>
      consume((async function* () { yield validWebmBytes.slice(0, 9); yield validWebmBytes.slice(9); })(), "video/mp4"));
    const id = await archive({ kind: "video", url: "https://media.example.com/result.mp4", mimeType: "video/mp4" });
    const asset = await repository.getAsset(id);
    expect(asset).toMatchObject({ mimeType: "video/webm", size: validWebmBytes.length,
      metadata: { originalFormat: "webm", videoMediaVerified: true, videoDecodeStatus: "full-video-decoded",
        reportedOutputMimeType: "video/mp4", width: 32, height: 32, durationSeconds: 1, frameRate: 2,
        audioTrackPresent: false, audioSignalStatus: "not-present", archiveComplete: true } });
    expect(asset?.storageKey).toBe(`assets/${id}/original.webm`);
    expect(storage.originals.get(asset!.storageKey)?.bytes).toEqual(Buffer.from(validWebmBytes));
    expect(storage.putStream).toHaveBeenCalledOnce(); expect(storage.put).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledOnce();
  });

  it("refuses an HTML error body instead of archiving it as MP4", async () => {
    const { archive, repository, storage } = await fixture();
    await expect(archive({ kind: "video", data: Buffer.from("<html>upstream authentication failed</html>"), mimeType: "video/mp4" }))
      .rejects.toThrow("不是真实视频文件");
    expect(await repository.listAssets()).toEqual([]);
    expect(storage.put).not.toHaveBeenCalled(); expect(storage.putStream).not.toHaveBeenCalled();
  });

  it("retains the paid original when requested native sound is absent and reuses it on recovery", async () => {
    const { archive, repository, storage } = await fixture({ generate_audio: true });
    const artifact: RemoteArtifact = { kind: "video", data: validWebmBytes, mimeType: "video/webm" };
    await expect(archive(artifact)).rejects.toThrow("原文件已保留");
    const assets = await repository.listAssets();
    expect(assets).toHaveLength(1);
    expect(assets[0].metadata).toMatchObject({ archiveComplete: true, videoMediaVerified: true,
      videoRequestedParameters: { generate_audio: true }, videoOutputContractMismatches: ["请求原生声音，原视频没有音轨"] });
    expect(Buffer.from(storage.originals.get(assets[0].storageKey)!.bytes)).toEqual(Buffer.from(validWebmBytes));
    const download = vi.spyOn(remote, "consumeRemoteArtifact").mockRejectedValue(new Error("expired URL must not be read"));
    await expect(archive({ kind: "video", url: "https://media.example.com/expired.webm" })).rejects.toThrow("没有音轨");
    expect(download).not.toHaveBeenCalled(); expect(await repository.listAssets()).toHaveLength(1);
    expect(storage.put).toHaveBeenCalledOnce();
  });

  it("preserves an unverified original and completes its local verification after tools recover", async () => {
    const { archive, repository, storage } = await fixture();
    vi.stubEnv("SUPERCANVAS_FFPROBE_PATH", "supercanvas-nonexistent-test-ffprobe");
    await expect(archive({ kind: "video", data: validWebmBytes, mimeType: "video/mp4" })).rejects.toThrow("尚未完成画面解码验证");
    const [unverified] = await repository.listAssets();
    expect(unverified.metadata).toMatchObject({ archiveComplete: true, videoMediaVerified: false, videoProbeStatus: "unavailable" });
    expect(Buffer.from(storage.originals.get(unverified.storageKey)!.bytes)).toEqual(Buffer.from(validWebmBytes));
    vi.unstubAllEnvs();
    const download = vi.spyOn(remote, "consumeRemoteArtifact").mockRejectedValue(new Error("expired URL must not be read"));
    expect(await archive({ kind: "video", url: "https://media.example.com/expired.mp4" })).toBe(unverified.id);
    expect(await repository.getAsset(unverified.id)).toMatchObject({ metadata: { videoMediaVerified: true, videoOutputContractMismatches: [] } });
    expect(download).not.toHaveBeenCalled(); expect(await repository.listAssets()).toHaveLength(1);
    expect(storage.put).toHaveBeenCalledOnce();
  });

  it("retains and reuses the original when decoded output dimensions or duration do not match the paid request", async () => {
    const { archive, repository, storage } = await fixture({ size: "1280x720", aspect_ratio: "16:9", duration: 5, fps: 24 });
    await expect(archive({ kind: "video", data: validWebmBytes, mimeType: "video/webm" })).rejects.toThrow("请求尺寸 1280 × 720");
    const [asset] = await repository.listAssets();
    expect(asset.metadata).toMatchObject({ archiveComplete: true, videoMediaVerified: true, width: 32, height: 32,
      videoRequestedParameters: { size: "1280x720", aspect_ratio: "16:9", duration: 5, fps: 24 },
      videoOutputContractMismatches: ["请求尺寸 1280 × 720，原视频实际为 32 × 32", "请求比例 16:9，原视频实际为 32 × 32",
        "请求时长 5 秒，原视频实际为 1 秒", "请求帧率 24 FPS，原视频实际为 2 FPS"],
    });
    expect(Buffer.from(storage.originals.get(asset.storageKey)!.bytes)).toEqual(Buffer.from(validWebmBytes));
    const download = vi.spyOn(remote, "consumeRemoteArtifact").mockRejectedValue(new Error("expired URL must not be read"));
    await expect(archive({ kind: "video", url: "https://media.example.com/expired.webm" })).rejects.toThrow("请求时长 5 秒");
    expect(download).not.toHaveBeenCalled(); expect(await repository.listAssets()).toHaveLength(1);
    expect(storage.put).toHaveBeenCalledOnce();
  });

  it("applies new parameter checks to a previously decoded archive without fetching or repurchasing it", async () => {
    const { archive, repository, storage } = await fixture({ width: 1280, height: 720, duration: 5 });
    await expect(archive({ kind: "video", data: validWebmBytes, mimeType: "video/webm" })).rejects.toThrow("请求尺寸");
    const [asset] = await repository.listAssets();
    const legacyMetadata = { ...asset.metadata };
    delete legacyMetadata.videoOutputContractMismatches;
    await repository.saveAsset({ ...asset, metadata: legacyMetadata });
    const download = vi.spyOn(remote, "consumeRemoteArtifact").mockRejectedValue(new Error("expired URL must not be read"));
    await expect(archive({ kind: "video", url: "https://media.example.com/expired.webm" })).rejects.toThrow("请求时长 5 秒");
    expect(await repository.getAsset(asset.id)).toMatchObject({ metadata: {
      videoRequestedParameters: { width: 1280, height: 720, duration: 5 },
      videoOutputContractMismatches: ["请求尺寸 1280 × 720，原视频实际为 32 × 32", "请求时长 5 秒，原视频实际为 1 秒"],
    } });
    expect(download).not.toHaveBeenCalled(); expect(storage.put).toHaveBeenCalledOnce();
  });

  it("retains requested controls separately when the actual editing payload omits duration", async () => {
    const { archive, repository } = await fixture({ duration: 8 });
    const [node] = await repository.listNodeRuns("original-video-run");
    await repository.updateNodeRun(node.id, { inputJson: { ...node.inputJson, providerTask: { result: { videoOutputParameters: {} } } } });
    const id = await archive({ kind: "video", data: validWebmBytes, mimeType: "video/webm" });
    expect(await repository.getAsset(id)).toMatchObject({ metadata: { videoRequestedParameters: { duration: 8 },
      videoEffectiveOutputParameters: {}, videoMediaVerified: true, durationSeconds: 1 } });
  });

  it("recovers legacy Chat video using its saved messages-only contract without enforcing unsent UI controls", async () => {
    const { archive, repository } = await fixture({ duration: 8, aspect_ratio: "16:9" });
    const [node] = await repository.listNodeRuns("original-video-run");
    await repository.updateNodeRun(node.id, { inputJson: { ...node.inputJson, providerTask: { result: { config: {
      submit: { path: "/v1/chat/completions", template: { stream: false }, mappings: [{ target: "/model" }, { target: "/messages" }] },
      output: { format: "openai-chat-videos" },
    } } } } });
    const id = await archive({ kind: "video", data: validWebmBytes, mimeType: "video/webm" });
    expect(await repository.getAsset(id)).toMatchObject({ metadata: { videoRequestedParameters: { duration: 8, aspect_ratio: "16:9" },
      videoEffectiveOutputParameters: {}, videoMediaVerified: true, durationSeconds: 1 } });
  });

  it("rechecks only the stored original when video decoded but the audio measurement previously timed out", async () => {
    const { archive, repository, storage } = await fixture({ generate_audio: true });
    const inspectOriginal = videoValidation.inspectVideoOutput;
    const inspector = vi.spyOn(videoValidation, "inspectVideoOutput").mockImplementation((bytes, options) =>
      inspectOriginal(bytes, { ...options, audioLevel: async () => { throw Object.assign(new Error("audio measurement timeout"), { killed: true }); } }));
    await expect(archive({ kind: "video", data: validWebmWithAudioBytes, mimeType: "video/webm" })).rejects.toThrow("尚未确认");
    const [asset] = await repository.listAssets();
    expect(asset.metadata).toMatchObject({ videoMediaVerified: true, videoDecodeStatus: "full-video-decoded",
      audioTrackPresent: true, audioSignalStatus: "timeout", audioSignalVerified: false });
    expect(Buffer.from(storage.originals.get(asset.storageKey)!.bytes)).toEqual(Buffer.from(validWebmWithAudioBytes));
    inspector.mockRestore();
    const download = vi.spyOn(remote, "consumeRemoteArtifact").mockRejectedValue(new Error("expired URL must not be read"));
    expect(await archive({ kind: "video", url: "https://media.example.com/expired-sound.webm" })).toBe(asset.id);
    expect(await repository.getAsset(asset.id)).toMatchObject({ metadata: { videoMediaVerified: true,
      audioSignalStatus: "detected", audioSignalVerified: true, videoOutputContractMismatches: [] } });
    expect(download).not.toHaveBeenCalled(); expect(await repository.listAssets()).toHaveLength(1);
    expect(storage.put).toHaveBeenCalledOnce();
  });

  it("does not accept unmeasured sound as silence and verifies the same stored original on recovery", async () => {
    const { archive, repository, storage } = await fixture({ generateAudio: false });
    const inspectOriginal = videoValidation.inspectVideoOutput;
    const inspector = vi.spyOn(videoValidation, "inspectVideoOutput").mockImplementation((bytes, options) =>
      inspectOriginal(bytes, { ...options, audioLevel: async () => { throw Object.assign(new Error("audio timeout"), { killed: true }); } }));
    await expect(archive({ kind: "video", data: validWebmWithAudioBytes, mimeType: "video/webm" })).rejects.toThrow("是否静音尚未确认");
    const [asset] = await repository.listAssets();
    expect(asset.metadata).toMatchObject({ audioTrackPresent: true, audioSignalStatus: "timeout", audioSignalVerified: false, archiveComplete: true });
    inspector.mockRestore();
    const download = vi.spyOn(remote, "consumeRemoteArtifact").mockRejectedValue(new Error("expired URL must not be read"));
    await expect(archive({ kind: "video", url: "https://media.example.com/expired-sound.webm" })).rejects.toThrow("仍含非静音声音");
    expect(await repository.getAsset(asset.id)).toMatchObject({ metadata: { audioSignalStatus: "detected", audioSignalVerified: true } });
    expect(download).not.toHaveBeenCalled(); expect(storage.put).toHaveBeenCalledOnce();
  });

  it("does not skip real media verification because a URL contains an example.invalid substring", async () => {
    const { archive, repository, storage } = await fixture();
    vi.spyOn(remote, "consumeRemoteArtifact").mockImplementation(async (_url, consume) =>
      consume((async function* () { yield Buffer.from("<html>expired upstream result</html>"); })(), "video/mp4"));
    await expect(archive({ kind: "video", url: "https://media.example.com/result.mp4?description=example.invalid", mimeType: "video/mp4" }))
      .rejects.toThrow("不是真实视频文件");
    expect(await repository.listAssets()).toEqual([]);
    expect(storage.put).not.toHaveBeenCalled(); expect(storage.putStream).not.toHaveBeenCalled();
  });
});

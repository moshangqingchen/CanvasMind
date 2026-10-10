import { access, readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { consumeValidatedVideoOutput, detectVideoContainer, inspectVideoOutput, videoMetadataFromProbe, videoOutputContractMismatches, videoOutputParametersFromInput } from "./video-output-validation.js";

const mp4 = Uint8Array.from([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 0, 0, ...Buffer.from("isommp42"), 1, 2, 3]);
const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from("webm"), 1, 2, 3]);
const metadata = (audio = false) => JSON.stringify({ format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "5.125" }, streams: [
  { codec_type: "video", codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "30000/1001" },
  ...(audio ? [{ codec_type: "audio", codec_name: "aac", channels: 2 }] : []),
] });
const deps = { probe: async () => metadata(), decode: async () => {} };

describe("generated video original-file validation", () => {
  it("uses sent output fields and preserves legacy source-following duration instead of stale UI values", () => {
    expect(videoOutputParametersFromInput({ parameters: { duration: 8 }, providerTask: { result: { videoOutputParameters: { aspectRatio: "16:9" } } } }))
      .toEqual({ aspectRatio: "16:9" });
    expect(videoOutputParametersFromInput({ parameters: { duration: 8 }, providerTask: { result: { videoOutputParameters: {} } } })).toEqual({});
    const input = { parameters: { duration: 8, aspect_ratio: "16:9" }, inputAssets: [{ kind: "video" }],
      providerTask: { result: { baseUrl: "https://token.secure-skill.com/v1", model: "omni_video_edit" } } };
    expect(videoOutputParametersFromInput(input)).toEqual({ aspect_ratio: "16:9" });
    expect(videoOutputParametersFromInput({ ...input, inputAssets: [] })).toEqual(input.parameters);
    expect(videoOutputParametersFromInput({ ...input, providerTask: { result: { baseUrl: "https://tu.988236.xyz", model: "kling-o3" } } })).toEqual({ aspect_ratio: "16:9" });
    expect(videoOutputParametersFromInput({ ...input, providerTask: { result: { baseUrl: "https://token.secure-skill.com.evil.invalid", model: "omni_video_edit" } } })).toEqual(input.parameters);
  });
  it("does not apply unsent legacy Chat controls or erase explicit custom mappings", () => {
    const input = { parameters: { duration: 10, size: "1920x1080", aspect_ratio: "16:9", generate_audio: true },
      providerTask: { result: { config: { submit: { path: "/v1/chat/completions", template: { stream: false },
        mappings: [{ target: "/model" }, { target: "/messages" }] }, output: { format: "openai-chat-videos" } } } } };
    expect(videoOutputParametersFromInput(input)).toEqual({});
    input.providerTask.result.config.submit.mappings.push({ target: "/duration" });
    expect(videoOutputParametersFromInput(input)).toEqual(input.parameters);
  });
  it("identifies the original MP4, WebM, MOV and AVI bytes independently of claimed MIME", () => {
    expect(detectVideoContainer(mp4)).toBe("mp4");
    expect(detectVideoContainer(webm)).toBe("webm");
    expect(detectVideoContainer(Uint8Array.from([0, 0, 0, 24, ...Buffer.from("ftypqt  "), 0, 0, 0, 0]))).toBe("mov");
    expect(detectVideoContainer(Uint8Array.from([...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("AVI ")]))).toBe("avi");
    for (const brand of ["avif", "heic", "M4A "]) expect(detectVideoContainer(Uint8Array.from([0, 0, 0, 24, ...Buffer.from(`ftyp${brand}`), 0, 0, 0, 0]))).toBeUndefined();
  });
  it("rejects HTML, error JSON, image and empty data before storage or probing", async () => {
    const probe = vi.fn();
    for (const body of ['{"error":"quota exceeded"}', "<html>expired</html>", "\x89PNG\r\n\x1a\n"]) {
      await expect(inspectVideoOutput(Buffer.from(body), { probe })).rejects.toThrow("不是真实视频文件");
    }
    await expect(inspectVideoOutput(new Uint8Array(), { probe })).rejects.toThrow("空视频文件");
    expect(probe).not.toHaveBeenCalled();
  });
  it("measures actual pixels, duration, codec, frame rate and audio tracks", () => {
    expect(videoMetadataFromProbe(metadata(true))).toMatchObject({ width: 1280, height: 720, durationSeconds: 5.125,
      videoCodec: "h264", audioTrackCount: 1, audioTrackPresent: true, audioCodecs: ["aac"] });
    expect(videoMetadataFromProbe(metadata(true)).frameRate).toBeCloseTo(29.97003);
  });
  it("does not treat audio-only files or cover art as usable video", () => {
    for (const streams of [[], [{ codec_type: "audio", codec_name: "aac" }],
      [{ codec_type: "video", codec_name: "mjpeg", width: 400, height: 400, disposition: { attached_pic: 1 } }],
      [{ codec_type: "video", codec_name: "h264", width: -1, height: 720 }]]) {
      expect(() => videoMetadataFromProbe(JSON.stringify({ streams }))).toThrow("没有可用的视频画面");
    }
    expect(() => videoMetadataFromProbe("invalid")).toThrow("有效媒体信息");
  });
  it("preserves every streamed byte and cleans the temporary original after persistence", async () => {
    let localFile = "", calls = 0;
    const persisted = await consumeValidatedVideoOutput((async function* () { yield mp4.slice(0, 7); yield mp4.slice(7); })(),
      async (chunks, inspection) => {
        const parts = [];
        for await (const chunk of chunks) parts.push(chunk);
        return { bytes: Buffer.concat(parts), inspection };
      }, { ...deps, probe: async file => { localFile = file; calls++; expect(await readFile(file)).toEqual(Buffer.from(mp4)); return metadata(); } });
    expect(persisted.bytes).toEqual(Buffer.from(mp4));
    expect(persisted.inspection).toMatchObject({ mimeType: "video/mp4", extension: "mp4", metadata: { videoContainer: "mp4", videoMediaVerified: true, videoDecodeStatus: "full-video-decoded", audioSignalStatus: "not-present" } });
    expect(calls).toBe(1);
    await expect(access(localFile)).rejects.toThrow();
  });
  it("keeps the genuine WebM extension instead of renaming it to MP4", async () => {
    expect(await inspectVideoOutput(webm, deps)).toMatchObject({ mimeType: "video/webm", extension: "webm", metadata: { originalFormat: "webm" } });
  });
  it("cleans the temporary original when a storage consumer fails after reading only its first chunk", async () => {
    let localFile = "";
    await expect(consumeValidatedVideoOutput((async function* () { yield mp4; })(), async chunks => {
      for await (const chunk of chunks) {
        expect(chunk.byteLength).toBeGreaterThan(0);
        throw new Error("storage acknowledgement failed");
      }
    }, { ...deps, probe: async file => { localFile = file; return metadata(); } })).rejects.toThrow("storage acknowledgement failed");
    await expect(access(localFile)).rejects.toThrow();
  });
  it("does not call the storage consumer for damaged media and cleans the temporary file", async () => {
    let localFile = "";
    const consumer = vi.fn();
    await expect(consumeValidatedVideoOutput((async function* () { yield mp4; })(), consumer,
      { probe: async file => { localFile = file; throw new Error("invalid moov atom"); } })).rejects.toThrow("原文件无效");
    expect(consumer).not.toHaveBeenCalled();
    await expect(access(localFile)).rejects.toThrow();
  });
  it("rejects a stream whose codec cannot decode a video frame", async () => {
    await expect(inspectVideoOutput(mp4, { ...deps, decode: async () => { throw new Error("corrupt frame"); } })).rejects.toThrow("视频画面无法解码");
  });
  it("enforces the existing download limit before probing or storage", async () => {
    const consumer = vi.fn(), probe = vi.fn();
    await expect(consumeValidatedVideoOutput((async function* () { yield mp4; })(), consumer,
      { maxBytes: 4, probe })).rejects.toThrow("下载上限");
    expect(probe).not.toHaveBeenCalled(); expect(consumer).not.toHaveBeenCalled();
  });
  it("records unavailable tools honestly while preserving the valid original container", async () => {
    const missing = Object.assign(new Error("missing executable"), { code: "ENOENT" });
    expect(await inspectVideoOutput(mp4, { probe: async () => { throw missing; } })).toMatchObject({
      extension: "mp4", metadata: { videoMediaVerified: false, videoProbeStatus: "unavailable", videoDecodeStatus: "unverified", audioSignalVerified: false } });
    expect(await inspectVideoOutput(mp4, { probe: deps.probe, decode: async () => { throw missing; } })).toMatchObject({
      metadata: { videoMediaVerified: false, videoProbeStatus: "verified", videoDecodeStatus: "unavailable" } });
  });
  it("does not confuse an audio track with non-silent sound", async () => {
    const probe = async () => metadata(true);
    expect(await inspectVideoOutput(mp4, { ...deps, probe, audioLevel: async () => "max_volume: -91.0 dB" })).toMatchObject({
      metadata: { audioTrackPresent: true, audioSignalVerified: true, audioSignalStatus: "silent", audioMaxVolumeDb: -91 } });
    expect(await inspectVideoOutput(mp4, { ...deps, probe, audioLevel: async () => "max_volume: -12.4 dB" })).toMatchObject({
      metadata: { audioSignalVerified: true, audioSignalStatus: "detected", audioMaxVolumeDb: -12.4 } });
  });
  it("does not label a timed-out or unmeasured audio track as verified sound", async () => {
    const probe = async () => metadata(true);
    expect(await inspectVideoOutput(mp4, { ...deps, probe, audioLevel: async () => "unrecognized output" })).toMatchObject({ metadata: { audioSignalVerified: false, audioSignalStatus: "unverified" } });
    expect(await inspectVideoOutput(mp4, { ...deps, probe, audioLevel: async () => { throw Object.assign(new Error("timeout"), { killed: true }); } })).toMatchObject({ metadata: { audioSignalVerified: false, audioSignalStatus: "timeout" } });
  });
  it("reports missing, silent and unverified native sound without equating reference audio with an output request", () => {
    const inspection = { mimeType: "video/mp4", extension: "mp4", metadata: { videoMediaVerified: true, audioTrackPresent: false, audioSignalStatus: "not-present", audioSignalVerified: false } };
    expect(videoOutputContractMismatches(inspection, { generate_audio: true })).toEqual(["请求原生声音，原视频没有音轨"]);
    expect(videoOutputContractMismatches(inspection, { generateAudio: true })).toEqual(["请求原生声音，原视频没有音轨"]);
    expect(videoOutputContractMismatches({ ...inspection, metadata: { ...inspection.metadata, audioTrackPresent: true, audioSignalStatus: "silent", audioSignalVerified: true } }, { audio: true })).toEqual(["请求原生声音，原视频音轨为静音"]);
    expect(videoOutputContractMismatches({ ...inspection, metadata: { ...inspection.metadata, audioTrackPresent: true, audioSignalStatus: "timeout" } }, { generate_audio: true })[0]).toContain("尚未确认");
    expect(videoOutputContractMismatches(inspection, { audio: "https://reference.test/audio.mp3", reference_audios: ["voice"] })).toEqual([]);
  });
  it("requires honest video decoding evidence and checks explicit output silence", () => {
    const inspection = { mimeType: "video/mp4", extension: "mp4", metadata: { videoMediaVerified: true, audioSignalStatus: "detected", audioSignalVerified: true } };
    expect(videoOutputContractMismatches(inspection, { audio: false })).toEqual(["请求静音，原视频仍含非静音声音"]);
    expect(videoOutputContractMismatches(inspection, { generate_audio: true })).toEqual([]);
    expect(videoOutputContractMismatches({ ...inspection, metadata: { videoMediaVerified: false, videoDecodeStatus: "unavailable" } }, {})[0]).toContain("尚未完成画面解码验证");
    for (const audioSignalStatus of ["timeout", "decode-failed", "unverified"])
      expect(videoOutputContractMismatches({ metadata: { videoMediaVerified: true, audioTrackPresent: true, audioSignalStatus, audioSignalVerified: false } }, { audio: false })[0])
        .toContain("是否静音尚未确认");
    expect(videoOutputContractMismatches({ metadata: { videoMediaVerified: true, audioTrackPresent: false } }, { generateAudio: false })).toEqual([]);
    expect(videoOutputContractMismatches({ metadata: { videoMediaVerified: true, audioTrackPresent: true, audioSignalStatus: "silent", audioSignalVerified: true } }, { generate_audio: false })).toEqual([]);
  });
  it("reports a decoded but wrong size, aspect, duration or frame rate against the explicit request", () => {
    const inspection = { mimeType: "video/mp4", extension: "mp4", metadata: {
      videoMediaVerified: true, width: 1280, height: 720, durationSeconds: 5.05, videoDurationSeconds: 5.041667, frameRate: 24,
    } };
    expect(videoOutputContractMismatches(inspection, { size: "1920x1080", aspect_ratio: "9:16", duration: 10, fps: 30 })).toEqual([
      "请求尺寸 1920 × 1080，原视频实际为 1280 × 720", "请求比例 9:16，原视频实际为 1280 × 720",
      "请求时长 10 秒，原视频实际为 5.041667 秒", "请求帧率 30 FPS，原视频实际为 24 FPS",
    ]);
    expect(videoOutputContractMismatches(inspection, { width: 1280, height: 720, ratio: "16:9", seconds: "5", frame_rate: "24" })).toEqual([]);
  });
  it("preserves native tier and auto semantics instead of inventing pixel or duration mappings", () => {
    const inspection = { mimeType: "video/mp4", extension: "mp4", metadata: { videoMediaVerified: true } };
    for (const resolution of ["720p", "2K", "4K", "auto"])
      expect(videoOutputContractMismatches(inspection, { resolution, size: "adaptive", aspect_ratio: "auto", duration: -1, fps: "auto" })).toEqual([]);
    expect(videoOutputContractMismatches(inspection, { size: "1280x720", duration_seconds: 5, aspectRatio: "16:9", fps: 24 })).toEqual([
      "请求尺寸 1280 × 720，原视频像素尚未确认", "请求比例 16:9，原视频比例尚未确认",
      "请求时长 5 秒，原视频时长尚未确认", "请求帧率 24 FPS，原视频帧率尚未确认",
    ]);
  });
  it("allows bounded frame padding and fractional NTSC FPS but detects a different duration", () => {
    const inspection = { mimeType: "video/mp4", extension: "mp4", metadata: {
      videoMediaVerified: true, width: 1918, height: 1080, durationSeconds: 5.4, videoDurationSeconds: 5.04, frameRate: 30000 / 1001,
    } };
    expect(videoOutputContractMismatches(inspection, { ratio: "16:9", duration: 5, fps: 30 })).toEqual([]);
    expect(videoOutputContractMismatches({ ...inspection, metadata: { ...inspection.metadata, videoDurationSeconds: 4.5 } }, { duration: 5 }))
      .toEqual(["请求时长 5 秒，原视频实际为 4.5 秒"]);
    expect(videoMetadataFromProbe(JSON.stringify({ format: { duration: "5.4" }, streams: [
      { codec_type: "video", codec_name: "h264", width: 1280, height: 720, duration: "5.04", avg_frame_rate: "24/1" },
    ] }))).toMatchObject({ durationSeconds: 5.4, videoDurationSeconds: 5.04 });
  });
});

import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
type Container = "mp4" | "mov" | "webm" | "mkv" | "avi" | "ogg" | "mpeg" | "ts";
export interface VideoOutputInspection {
  mimeType: string;
  extension: string;
  metadata: Record<string, unknown>;
}
export interface VideoOutputValidationOptions {
  maxBytes?: number;
  probe?: (file: string) => Promise<string>;
  decode?: (file: string) => Promise<void>;
  audioLevel?: (file: string) => Promise<string>;
}

/** Prefer the actual transmitted output fields over saved UI controls. */
export function videoOutputParametersFromInput(input: Record<string, unknown>): Record<string, unknown> {
  const envelope = record(record(input.providerTask).result);
  if (envelope.videoOutputParameters && typeof envelope.videoOutputParameters === "object" && !Array.isArray(envelope.videoOutputParameters))
    return record(envelope.videoOutputParameters);
  const parameters = { ...record(input.parameters) };
  const config = record(envelope.config), submit = record(config.submit), template = record(submit.template);
  const mappings = Array.isArray(submit.mappings) ? submit.mappings.map(record) : [];
  if (record(config.output).format === "openai-chat-videos" && submit.path === "/v1/chat/completions" && mappings.length > 0 &&
      mappings.every(mapping => ["/model", "/messages"].includes(String(mapping.target))) &&
      Object.keys(template).every(key => ["model", "messages", "stream"].includes(key))) return {};
  // Old tasks predate the wire snapshot. Preserve the documented source-following
  // semantics instead of treating their retained UI duration as a sent field.
  let hostname = "";
  try { hostname = new URL(String(envelope.baseUrl)).hostname; } catch { /* Non-REST task. */ }
  const model = envelope.model ?? input.model;
  const assets = Array.isArray(input.inputAssets) ? input.inputAssets.map(record) : [];
  const sourceVideo = assets.some(asset => asset.kind === "video") || parameters.video_url || parameters.input_video;
  if (sourceVideo && (hostname === "token.secure-skill.com" && ["omni", "omni_video_edit"].includes(String(model)) ||
      hostname === "tu.988236.xyz" && model === "kling-o3")) {
    delete parameters.duration; delete parameters.seconds; delete parameters.duration_seconds;
  }
  return parameters;
}

/** Preserve the original first; unmet output requirements must not trigger a new submit. */
export function videoOutputContractMismatches(inspected: Pick<VideoOutputInspection, "metadata">, parameters: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (inspected.metadata.videoMediaVerified !== true)
    issues.push(`原视频尚未完成画面解码验证（${String(inspected.metadata.videoDecodeStatus ?? inspected.metadata.videoProbeStatus ?? "unverified")}）`);
  // Compare explicit output fields only. Labels such as 720p/2K, auto and
  // source-following durations are supplier contracts, not universal pixel rules.
  const actualWidth = positive(inspected.metadata.width), actualHeight = positive(inspected.metadata.height);
  const size = typeof parameters.size === "string" ? /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/iu.exec(parameters.size) : null;
  const requestedWidth = positive(parameters.width) ?? positive(size?.[1]);
  const requestedHeight = positive(parameters.height) ?? positive(size?.[2]);
  if (requestedWidth && requestedHeight) {
    if (!actualWidth || !actualHeight) issues.push(`请求尺寸 ${requestedWidth} × ${requestedHeight}，原视频像素尚未确认`);
    else if (actualWidth !== requestedWidth || actualHeight !== requestedHeight)
      issues.push(`请求尺寸 ${requestedWidth} × ${requestedHeight}，原视频实际为 ${actualWidth} × ${actualHeight}`);
  }
  const ratioValue = parameters.aspect_ratio ?? parameters.aspectRatio ?? parameters.ratio;
  const ratio = typeof ratioValue === "string" ? /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/u.exec(ratioValue) : null;
  const ratioWidth = positive(ratio?.[1]), ratioHeight = positive(ratio?.[2]);
  if (ratioWidth && ratioHeight) {
    if (!actualWidth || !actualHeight) issues.push(`请求比例 ${String(ratioValue)}，原视频比例尚未确认`);
    // Permit at most two pixels of encoder rounding, not a different aspect ratio.
    else if (Math.abs(actualWidth - actualHeight * ratioWidth / ratioHeight) > Math.max(2, 2 * ratioWidth / ratioHeight))
      issues.push(`请求比例 ${String(ratioValue)}，原视频实际为 ${actualWidth} × ${actualHeight}`);
  }
  const requestedDuration = positive(parameters.duration ?? parameters.seconds ?? parameters.duration_seconds);
  const actualDuration = positive(inspected.metadata.videoDurationSeconds) ?? positive(inspected.metadata.durationSeconds);
  const actualFrameRate = positive(inspected.metadata.frameRate);
  if (requestedDuration) {
    // Video frames and container/audio padding need a bounded tolerance. It is
    // recorded as actual duration; it never changes supplier billing or the file.
    const tolerance = actualFrameRate ? Math.max(0.1, Math.min(0.25, 2 / actualFrameRate)) : 0.1;
    if (!actualDuration) issues.push(`请求时长 ${requestedDuration} 秒，原视频时长尚未确认`);
    else if (Math.abs(actualDuration - requestedDuration) > tolerance + Number.EPSILON * 16)
      issues.push(`请求时长 ${requestedDuration} 秒，原视频实际为 ${actualDuration} 秒`);
  }
  const requestedFrameRate = positive(parameters.fps ?? parameters.frame_rate);
  if (requestedFrameRate) {
    if (!actualFrameRate) issues.push(`请求帧率 ${requestedFrameRate} FPS，原视频帧率尚未确认`);
    else if (Math.abs(actualFrameRate - requestedFrameRate) > Math.max(0.01, requestedFrameRate * 0.0011))
      issues.push(`请求帧率 ${requestedFrameRate} FPS，原视频实际为 ${actualFrameRate} FPS`);
  }
  // Only exact boolean native-output fields count, never a reference audio URL.
  const requested = typeof parameters.generate_audio === "boolean" ? parameters.generate_audio :
    typeof parameters.generateAudio === "boolean" ? parameters.generateAudio :
    typeof parameters.audio === "boolean" ? parameters.audio : undefined;
  if (requested === true) {
    if (inspected.metadata.audioTrackPresent === false) issues.push("请求原生声音，原视频没有音轨");
    else if (inspected.metadata.audioSignalStatus === "silent") issues.push("请求原生声音，原视频音轨为静音");
    else if (inspected.metadata.audioSignalStatus !== "detected" || inspected.metadata.audioSignalVerified !== true)
      issues.push(`请求原生声音，实际音轨声音尚未确认（${String(inspected.metadata.audioSignalStatus ?? "unverified")}）`);
  }
  if (requested === false && inspected.metadata.audioTrackPresent !== false) {
    if (inspected.metadata.audioSignalStatus === "detected") issues.push("请求静音，原视频仍含非静音声音");
    else if (inspected.metadata.audioSignalStatus !== "silent" || inspected.metadata.audioSignalVerified !== true)
      issues.push(`请求静音，原视频音轨是否静音尚未确认（${String(inspected.metadata.audioSignalStatus ?? "unverified")}）`);
  }
  return issues;
}
const formats: Record<Container, { mimeType: string; extension: string }> = {
  mp4: { mimeType: "video/mp4", extension: "mp4" },
  mov: { mimeType: "video/quicktime", extension: "mov" },
  webm: { mimeType: "video/webm", extension: "webm" },
  mkv: { mimeType: "video/x-matroska", extension: "mkv" },
  avi: { mimeType: "video/x-msvideo", extension: "avi" },
  ogg: { mimeType: "video/ogg", extension: "ogv" },
  mpeg: { mimeType: "video/mpeg", extension: "mpg" },
  ts: { mimeType: "video/mp2t", extension: "ts" },
};
const ascii = (bytes: Uint8Array, start: number, end: number) => Buffer.from(bytes.subarray(start, end)).toString("latin1");

/** Inspect original container bytes; filenames and HTTP MIME never establish format. */
export function detectVideoContainer(bytes: Uint8Array): Container | undefined {
  if (bytes.length >= 16 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    // These ISO-BMFF containers contain images/audio, not generated video.
    if (["avif", "avis", "heic", "heix", "hevc", "hevx", "mif1", "msf1", "M4A ", "M4B "].includes(brand)) return undefined;
    return brand === "qt  " ? "mov" : "mp4";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "AVI ") return "avi";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    const header = ascii(bytes, 0, Math.min(bytes.length, 4096));
    return header.includes("webm") ? "webm" : header.includes("matroska") ? "mkv" : undefined;
  }
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === "OggS") return "ogg";
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && [0xb3, 0xba].includes(bytes[3]!)) return "mpeg";
  if (bytes.length >= 377 && bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) return "ts";
  // Older QuickTime files have no ftyp atom. The stream probe still must find video.
  if (bytes.length >= 12 && ["moov", "mdat", "wide"].includes(ascii(bytes, 4, 8))) return "mov";
  return undefined;
}

const probeFile = async (file: string): Promise<string> => (await execute(process.env.SUPERCANVAS_FFPROBE_PATH || "ffprobe", [
  "-v", "error", "-protocol_whitelist", "file", "-show_entries",
  "format=format_name,duration:stream=codec_type,codec_name,width,height,duration,avg_frame_rate,r_frame_rate,channels:stream_disposition=attached_pic",
  "-of", "json", file,
], { timeout: 15_000, maxBuffer: 128 * 1024, windowsHide: true })).stdout;
const decodeFile = async (file: string): Promise<void> => {
  await execute(process.env.SUPERCANVAS_FFMPEG_PATH || "ffmpeg", [
    "-nostdin", "-v", "error", "-xerror", "-protocol_whitelist", "file", "-i", file,
    // V excludes attached album art, matching the usable video selected by probe.
    "-map", "0:V:0", "-an", "-f", "null", "-",
  ], { timeout: 15_000, maxBuffer: 128 * 1024, windowsHide: true });
};
const audioLevelFile = async (file: string): Promise<string> => (await execute(process.env.SUPERCANVAS_FFMPEG_PATH || "ffmpeg", [
  "-nostdin", "-v", "info", "-xerror", "-protocol_whitelist", "file", "-i", file,
  "-map", "0:a:0", "-vn", "-af", "volumedetect", "-f", "null", "-",
], { timeout: 15_000, maxBuffer: 128 * 1024, windowsHide: true })).stderr;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const positive = (value: unknown): number | undefined => {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
};
const frameRate = (value: unknown): number | undefined => {
  if (typeof value !== "string") return positive(value);
  const pieces = value.split("/");
  return pieces.length === 2 ? positive(Number(pieces[0]) / Number(pieces[1])) : positive(value);
};
const unavailable = (error: unknown): "unavailable" | "timeout" | undefined => {
  const value = record(error);
  if (["ENOENT", "EACCES"].includes(String(value.code))) return "unavailable";
  if (value.killed === true || value.code === "ETIMEDOUT") return "timeout";
  return undefined;
};

/** A video stream is required: audio tracks or attached album art are insufficient. */
export function videoMetadataFromProbe(text: string): Record<string, unknown> {
  let result: Record<string, unknown>;
  try { result = record(JSON.parse(text)); } catch { throw new Error("供应商视频原文件无法读取有效媒体信息"); }
  const streams = Array.isArray(result.streams) ? result.streams.map(record) : [];
  const video = streams.find(stream => stream.codec_type === "video" && Number(record(stream.disposition).attached_pic) !== 1);
  const width = positive(video?.width), height = positive(video?.height);
  if (!video || !width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || typeof video.codec_name !== "string")
    throw new Error("供应商原文件没有可用的视频画面，不能将错误正文或音频保存为视频");
  const duration = positive(record(result.format).duration) ?? positive(video.duration);
  const rate = frameRate(video.avg_frame_rate) ?? frameRate(video.r_frame_rate);
  const audio = streams.filter(stream => stream.codec_type === "audio");
  return { width, height, ...(duration === undefined ? {} : { durationSeconds: duration }),
    ...(positive(video.duration) === undefined ? {} : { videoDurationSeconds: positive(video.duration) }),
    ...(rate === undefined ? {} : { frameRate: rate }), videoCodec: video.codec_name,
    ...(typeof record(result.format).format_name === "string" ? { videoProbeContainer: record(result.format).format_name } : {}),
    audioTrackCount: audio.length, audioTrackPresent: audio.length > 0,
    audioCodecs: audio.map(stream => stream.codec_name).filter(value => typeof value === "string") };
}

async function inspectFile(file: string, prefix: Uint8Array, options: VideoOutputValidationOptions): Promise<VideoOutputInspection> {
  const container = detectVideoContainer(prefix);
  if (!container) throw new Error("供应商输出不是真实视频文件，已拒绝将 JSON、HTML、图片或未知数据伪装成 MP4");
  const metadata: Record<string, unknown> = { originalFormat: container, videoContainer: container,
    videoValidationSource: "downloaded-original", videoMediaVerified: false, audioSignalVerified: false };
  try {
    Object.assign(metadata, videoMetadataFromProbe(await (options.probe ?? probeFile)(file)), { videoProbeStatus: "verified" });
  } catch (error) {
    const status = unavailable(error);
    if (!status) throw new Error("供应商视频原文件无效或无法解码媒体信息", { cause: error });
    Object.assign(metadata, { videoProbeStatus: status, videoDecodeStatus: "unverified", audioSignalStatus: "unverified" });
    return { ...formats[container], metadata };
  }
  try {
    await (options.decode ?? decodeFile)(file);
    Object.assign(metadata, { videoDecodeStatus: "full-video-decoded", videoMediaVerified: true });
  } catch (error) {
    const status = unavailable(error);
    if (!status) throw new Error("供应商视频原文件的视频画面无法解码", { cause: error });
    metadata.videoDecodeStatus = status;
  }
  if (metadata.audioTrackPresent === true) {
    try {
      const text = await (options.audioLevel ?? audioLevelFile)(file);
      const match = /max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/iu.exec(text);
      if (!match) metadata.audioSignalStatus = "unverified";
      else {
        const level = Number(match[1]);
        const silent = !Number.isFinite(level) || level <= -90;
        Object.assign(metadata, { audioSignalStatus: silent ? "silent" : "detected", audioSignalVerified: true,
          ...(Number.isFinite(level) ? { audioMaxVolumeDb: level } : {}) });
      }
    } catch (error) {
      metadata.audioSignalStatus = unavailable(error) ?? "decode-failed";
    }
  } else metadata.audioSignalStatus = "not-present";
  return { ...formats[container], metadata };
}

/** Preserve large originals without collecting them in RAM or changing their encoding. */
export async function consumeValidatedVideoOutput<T>(source: AsyncIterable<Uint8Array>,
  consumer: (chunks: AsyncIterable<Uint8Array>, inspection: VideoOutputInspection) => Promise<T>,
  options: VideoOutputValidationOptions = {}): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "supercanvas-video-output-"));
  const file = join(directory, "original.bin");
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
  let size = 0;
  const prefix: Uint8Array[] = [];
  let prefixLength = 0;
  try {
    const handle = await open(file, "wx");
    try {
      for await (const chunk of source) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new Error(`供应商视频原文件超过 ${maxBytes} 字节下载上限`);
        if (prefixLength < 64 * 1024) {
          const part = chunk.slice(0, 64 * 1024 - prefixLength);
          prefix.push(part); prefixLength += part.byteLength;
        }
        let offset = 0;
        while (offset < chunk.byteLength) offset += (await handle.write(chunk, offset, chunk.byteLength - offset)).bytesWritten;
      }
    } finally { await handle.close(); }
    if (!size) throw new Error("供应商返回了空视频文件（0 字节）");
    const inspection = await inspectFile(file, Buffer.concat(prefix), options);
    // The byte-only inspector never consumes this source. Open lazily, and close
    // even when a storage consumer stops early, before removing the original.
    const original = (async function* () { yield* createReadStream(file); })();
    try { return await consumer(original, inspection); }
    finally { await original.return(undefined); }
  } finally { await rm(file, { force: true }).catch(() => {}); await rmdir(directory).catch(() => {}); }
}

/** Convenience wrapper for data URI and already buffered originals. */
export async function inspectVideoOutput(bytes: Uint8Array, options: VideoOutputValidationOptions = {}): Promise<VideoOutputInspection> {
  return consumeValidatedVideoOutput((async function* () { yield bytes; })(), async (_chunks, inspection) => inspection, options);
}

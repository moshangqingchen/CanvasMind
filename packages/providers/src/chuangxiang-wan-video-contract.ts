import type { ModelDescriptor, NormalizedRequest, ValidationIssue } from "./contracts.js";

export const CHUANGXIANG_WAN_VIDEO_IDS = ["image", "image-prime", "video", "video-prime"]
  .flatMap(mode => ["480p", "720p", "1080p"].map(resolution => `wan3.0-${mode}-${resolution}`));
const models = new Set(CHUANGXIANG_WAN_VIDEO_IDS);
export const isChuangxiangWanVideoModel = (id: string | undefined) => models.has(id ?? "");
const imageFields = ["image_url", "image_urls", "images"];
const videoFields = ["video_reference", "video_references", "video_url", "video_urls"];
const audioFields = ["audio_url", "audio_urls", "audio_reference", "audio_references"];
const list = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function publicUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      !/^(?:localhost$|127\.|0\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[(?:::1\]|f[cd][\da-f]*:|fe80:))/iu.test(url.hostname) && !url.hostname.endsWith(".local");
  } catch { return false; }
}
const videoMode = (id: string) => id.startsWith("wan3.0-video-");

/** Canonical aliases retain the same value; conflicts are rejected separately. */
export function normalizeChuangxiangWanVideoParameters(request: NormalizedRequest): Record<string, unknown> {
  const p = { ...request.parameters };
  p.duration ??= p.seconds ?? p.duration_seconds;
  p.n ??= p.count ?? 1;
  p.generate_audio ??= p.generateAudio;
  for (const key of ["seconds", "duration_seconds", "count", "generateAudio"]) delete p[key];
  if (p.duration === undefined) delete p.duration;
  if (p.generate_audio === undefined) delete p.generate_audio;
  for (const kind of ["image", "video", "audio"] as const) {
    const field = kind === "image" ? "image_urls" : kind === "video" ? "video_references" : "audio_urls";
    const aliases = kind === "image" ? imageFields : kind === "video" ? videoFields : audioFields;
    const explicit = aliases.flatMap(key => list(p[key]));
    const urls = new Set(explicit.map(value => typeof value === "string" ? value : record(value).url));
    const added = (request.assets ?? []).filter(asset => asset.kind === kind && (!asset.role || asset.role === "reference") && !urls.has(asset.url))
      .map(asset => kind === "video" ? { url: asset.url, duration: asset.durationSeconds } : asset.url);
    if (added.length) p[field] = [...list(p[field]), ...added];
  }
  return p;
}

export function chuangxiangWanVideoModel(id: string, current: ModelDescriptor): ModelDescriptor {
  const acceptsVideo = videoMode(id), resolution = id.split("-").at(-1)!;
  const metadata = { ...current.metadata };
  // Unknown reference limits must not inherit a generic zero or another channel's limit.
  for (const key of ["videoReferenceVideoLimit", "videoReferenceAudioLimit"]) delete metadata[key];
  const limits = { ...current.limits, maxInputImages: 10 };
  delete limits.maxInputVideos;
  delete limits.maxInputAudios;
  if (!acceptsVideo) limits.maxInputVideos = 0;
  return { ...current, operations: ["video.generate", "video.image-to-video"], outputKinds: ["video"],
    inputKinds: ["text", "image", "image[]", ...(acceptsVideo ? ["video" as const, "video[]" as const] : []), "audio", "audio[]"], limits,
    parameters: [
      { key: "duration", label: "视频时长", control: "select", valueType: "integer", default: 8,
        options: [{ value: -1, label: "自动（按8秒计费）" }, ...Array.from({ length: 27 }, (_, index) => ({ value: index + 4, label: `${index + 4} 秒` }))] },
      { key: "resolution", label: "输出分辨率", control: "select", valueType: "string", default: resolution, options: [{ value: resolution, label: resolution }] },
      { key: "aspect_ratio", label: "画面比例", control: "text", valueType: "string", placeholder: "16:9 / 9:16 / 1:1 / adaptive", description: "供应商推荐值，不是完整枚举；按用户输入发送。" },
      { key: "n", label: "生成数量", control: "number", valueType: "integer", default: 1, min: 1, max: 1000 },
      { key: "generate_audio", label: "生成声音", control: "select", valueType: "boolean", options: [{ value: true, label: "生成" }, { value: false, label: "不生成" }], description: "不选择时采用供应商默认行为。" },
    ],
    metadata: { ...metadata, documentationUrl: "https://vapi.chuangxiangai.asia/docs/video", remoteMediaUrlsOnly: true,
      chuangxiangWanVideoContract: true, chuangxiangVideoContractCheckedAt: "2026-10-22T04:13:15.022Z",
      videoCapabilitySource: { url: "https://vapi.chuangxiangai.asia/api/v1/model-plaza", groupId: "27", sampledAt: "2026-10-22T04:13:15.022Z" },
      videoSupportedResolutions: [resolution], videoMinDuration: 4, videoMaxDuration: 30, videoAutomaticDuration: -1,
      videoAutomaticBillingSeconds: 8, videoSupplierDefaultDuration: 8, videoReferenceImageLimit: 10,
      ...(!acceptsVideo ? { videoReferenceVideoLimit: 0 } : {}), videoSupportsFirstLastFrames: false, supportsFirstLastFrames: false,
      framePairRequired: false, allowFrameMediaMix: false, videoReferenceVideoBilling: acceptsVideo,
      videoReferenceVideoDurationUnit: "seconds", videoCountMaximum: 1000, operationsSource: "declared", outputKindsSource: "declared" },
  };
}

export function validateChuangxiangWanVideoRequest(request: NormalizedRequest): ValidationIssue[] {
  const p = normalizeChuangxiangWanVideoParameters(request), issues: ValidationIssue[] = [];
  const source = request.parameters ?? {};
  const add = (path: string, message: string) => issues.push({ path, code: "invalid_parameter", message });
  for (const keys of [["duration", "seconds", "duration_seconds"], ["n", "count"], ["generate_audio", "generateAudio"]]) {
    const supplied = keys.filter(key => source[key] !== undefined);
    if (supplied.some(key => source[key] !== source[supplied[0]!])) add(`parameters.${keys[0]}`, "同一参数的别名必须一致；请修改已保存的冲突值。");
  }
  if (!request.operation.startsWith("video.")) add("operation", "此创想型号仅用于视频生成。");
  if (p.duration !== undefined && (typeof p.duration !== "number" || !Number.isInteger(p.duration) || p.duration !== -1 && (p.duration < 4 || p.duration > 30))) add("parameters.duration", "WAN3 时长为4–30整数秒或-1自动，自动按8秒计费。");
  if (typeof p.n !== "number" || !Number.isInteger(p.n) || p.n < 1 || p.n > 1000) add("parameters.n", "WAN3 数量须为1–1000整数。");
  if (p.resolution !== undefined && p.resolution !== request.model?.split("-").at(-1)) add("parameters.resolution", "分辨率须与完整型号的固定档位一致。");
  if (p.generate_audio !== undefined && typeof p.generate_audio !== "boolean") add("parameters.generate_audio", "生成声音必须为布尔值。");
  const allowed = new Set(["duration", "resolution", "aspect_ratio", "n", "generate_audio", ...imageFields, ...videoFields, ...audioFields]);
  for (const key of Object.keys(p)) if (!allowed.has(key)) add(`parameters.${key}`, `此 WAN3 合同未声明参数 ${key}。`);
  const images = imageFields.flatMap(key => list(p[key]));
  if (images.length > 10) add("assets", "所有参考图片字段合计最多10张。");
  if (images.some(value => !publicUrl(value))) add("assets", "WAN3 图片须为公网 HTTP(S) 原文件链接。");
  if (audioFields.flatMap(key => list(p[key])).some(value => !publicUrl(typeof value === "string" ? value : record(value).url))) add("assets", "WAN3 音频须为公网 HTTP(S) 链接或{url}对象。");
  const videos = videoFields.flatMap(key => list(p[key])), durations = new Map<string, number>();
  if (!videoMode(request.model!) && videos.length) add("assets", "此 image 型号不接受参考视频。");
  for (const value of videos) {
    const video = record(value), duration = video.duration ?? video.seconds;
    if (!publicUrl(video.url) || typeof duration !== "number" || !Number.isSafeInteger(duration) || duration <= 0 ||
        video.duration !== undefined && video.seconds !== undefined && video.duration !== video.seconds) add("assets", "参考视频须为{url,duration}，duration/seconds为真实正整数秒。");
    else if (durations.has(String(video.url)) && durations.get(String(video.url)) !== duration) add("assets", "同一参考视频URL的真实时长必须一致。");
    else durations.set(String(video.url), duration);
  }
  for (const asset of request.assets ?? []) {
    if (asset.role && asset.role !== "reference") add("assets", "此WAN3型号不支持首尾帧或蒙版角色。");
    if (asset.kind === "image" && [asset.width, asset.height].some(value => value !== undefined && (!Number.isInteger(value) || value < 300 || value > 6000))) add("assets", "参考图真实宽高应在300–6000像素；不能静默缩图。");
  }
  return issues;
}

/** Per-second billing basis, before quantity. Unknown source-video facts yield no estimate. */
export function chuangxiangWanBillingSeconds(id: string, parameters: Readonly<Record<string, unknown>>): number | undefined {
  if (!isChuangxiangWanVideoModel(id)) return undefined;
  for (const keys of [["duration", "seconds", "duration_seconds"], ["n", "count"], ["generate_audio", "generateAudio"]]) {
    const supplied = keys.filter(key => parameters[key] !== undefined);
    if (supplied.some(key => parameters[key] !== parameters[supplied[0]!])) return undefined;
  }
  const requested = parameters.duration ?? parameters.seconds ?? parameters.duration_seconds ?? 8;
  const seconds = requested === -1 ? 8 : requested;
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 4 || seconds > 30) return undefined;
  if (!videoMode(id)) return videoFields.some(key => list(parameters[key]).length) || parameters.has_reference_video === true ? undefined : seconds;
  const videos = videoFields.flatMap(key => list(parameters[key])), durations = new Map<string, number>();
  if (!videos.length) return parameters.has_reference_video === false ? seconds : undefined;
  for (const value of videos) {
    const v = record(value), duration = v.duration ?? v.seconds;
    if (!publicUrl(v.url) || typeof duration !== "number" || !Number.isSafeInteger(duration) || duration <= 0 ||
        v.duration !== undefined && v.seconds !== undefined && v.duration !== v.seconds ||
        durations.has(String(v.url)) && durations.get(String(v.url)) !== duration) return undefined;
    durations.set(String(v.url), duration);
  }
  return seconds + [...durations.values()].reduce((sum, duration) => sum + duration, 0);
}

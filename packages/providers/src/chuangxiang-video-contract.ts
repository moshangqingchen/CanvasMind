import type { ModelDescriptor, ModelParameterDescriptor, NormalizedRequest, ValidationIssue } from "./contracts.js";
import type { RestModelConnectorOverride } from "./rest.js";

export const CHUANGXIANG_VIDEO_DOCS = "https://vapi.chuangxiangai.asia/docs/video";
export const CHUANGXIANG_VIDEO_POLL_INTERVAL_MS = 10_000;
export const CHUANGXIANG_VIDEO_TIMEOUT_MS = 30 * 60_000;

/** Current official endpoint. A task timeout must be resumed, never resubmitted. */
export function chuangxiangVideoTransport(): RestModelConnectorOverride {
  const response = { taskIdPath: "$.request_id", taskIdFallbackPaths: ["$.id", "$.task_id"], statusPath: "$.status", errorPath: "$.error.message", errorFallbackPaths: ["$.error"], progressPath: "$.progress" };
  return {
    submit: { path: "/v1/videos/generations", method: "POST", bodyMode: "json", idempotent: false,
      mappings: [
        { target: "/model", source: { kind: "request", path: "$.model" } },
        { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
        ...["seconds", "resolution", "aspect_ratio", "n", "reference_image_urls", "reference_videos", "reference_audios", "first_image_url", "last_image_url"].map(key => ({ target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` }, omitIfUndefined: true, omitIfEmpty: true })),
      ], response },
    poll: { path: "/v1/videos/generations/{taskId}", method: "GET", bodyMode: "none", response },
    pollIntervalMs: CHUANGXIANG_VIDEO_POLL_INTERVAL_MS,
    statusMap: { queued: "queued", pending: "queued", in_progress: "running", processing: "running", running: "running", completed: "succeeded", done: "succeeded", succeeded: "succeeded", success: "succeeded", failed: "failed", error: "failed", canceled: "cancelled", cancelled: "cancelled", expired: "failed" },
    output: { path: "$.data", fallbackPaths: ["$.video_url", "$.url"], kind: "video", urlPath: "url", urlFallbackPaths: ["video_url"], defaultMimeType: "video/mp4", contentFallback: { path: "/v1/videos/generations/{taskId}/content" } },
  };
}
const exactModels = new Set([
  "grok-imagine-video", "grok-imagine-video-1.5", "kling-3.0", "kling-3.0-pro", "kl1-kling-3.0", "kl2-kling-3.0",
  "wan4-wan3.0", "wan5-wan3.0", "ve1-veo-3.1-fast", "happyhorse-1.1", "mm2-minimax-h3", "mm2-minimax-h3-max",
  "omni-fast", "omni-fast-no-water", "omni-v2v", "omni-v2v-no-water",
  ...["sd10", "sd11", "sd12", "sd13", "sd14"].flatMap(prefix => prefix === "sd14" ? [`${prefix}-seedance-2.0`]
    : [`${prefix}-seedance-2.0`, `${prefix}-seedance-2.0-fast`, `${prefix}-seedance-2.0-mini`, ...(prefix === "sd12" ? [] : [`${prefix}-seedance-2.5`])]),
]);
export const isChuangxiangVideoModel = (id: string | undefined) => exactModels.has(id ?? "");

/** Public documentation describes capability, never the current Key's entitlement. */
export function isChuangxiangVideoConnection(config: Readonly<Record<string, unknown>> | undefined, model?: string): boolean {
  if (!isChuangxiangVideoModel(model ?? (typeof config?.defaultModel === "string" ? config.defaultModel : undefined)) ||
    String(config?.accountKeyGroup ?? config?.modelGroup ?? "") !== "视频" || config?.usage === "agent" || config?.usage === "disabled" || config?.supplierArchived === true) return false;
  try {
    const url = new URL(String(config?.baseUrl ?? ""));
    return url.origin === "https://vapi.chuangxiangai.asia" && !url.username && !url.password && !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname);
  } catch { return false; }
}

function secondsOptions(id: string): number[] | undefined {
  if (id === "sd10-seedance-2.5") return [30];
  if (id === "sd10-seedance-2.0-mini") return [5, 10];
  if (id === "sd10-seedance-2.0" || id === "sd10-seedance-2.0-fast") return [5, 10, 15];
  if (id === "ve1-veo-3.1-fast") return [4, 6, 8];
  return undefined;
}

function references(id: string): { images: number; videos: number; audios: number; frames: boolean } | undefined {
  if (id.startsWith("sd10-")) return { images: id.endsWith("2.5") ? 30 : 9, videos: 0, audios: 0, frames: false };
  if (/^sd(?:11|12|14)-/u.test(id)) return id === "sd11-seedance-2.5" ? { images: 30, videos: 10, audios: 10, frames: true } : { images: 9, videos: 3, audios: 3, frames: true };
  if (id.startsWith("sd13-")) return { images: id.endsWith("2.5") ? 30 : 9, videos: id.endsWith("2.5") ? 10 : 3, audios: 0, frames: false };
  if (/^(?:kl1-|kl2-|ve1-)/u.test(id)) return { images: 0, videos: 0, audios: 0, frames: true };
  if (id === "wan4-wan3.0") return { images: 10, videos: 5, audios: 5, frames: true };
  if (id === "wan5-wan3.0") return { images: 0, videos: 0, audios: 0, frames: false };
  return undefined;
}

export function chuangxiangVideoModel(id: string, current?: ModelDescriptor): ModelDescriptor {
  const model = current ?? { id, name: id, operations: ["video.generate", "video.image-to-video"] };
  if (!isChuangxiangVideoModel(id)) return model;
  const refs = references(id), durations = secondsOptions(id);
  const resolutions = Array.isArray(model.metadata?.videoSupportedResolutions) ? model.metadata.videoSupportedResolutions.filter((v): v is string => typeof v === "string")
    : model.pricing?.tiers?.filter(tier => tier.dimension === "resolution" && typeof tier.value === "string").map(tier => String(tier.value));
  const parameters: ModelParameterDescriptor[] = [...(model.parameters ?? []).filter(p => !["n", ...(durations ? ["duration", "seconds"] : []), ...(resolutions?.length ? ["resolution"] : [])].includes(p.key)),
    ...(durations ? [{ key: "duration", label: "视频时长", control: "select" as const, valueType: "integer" as const,
      default: durations[0]!, required: true, options: durations.map(value => ({ label: `${value} 秒`, value })),
      description: "创想当前文档列出的离散秒数；不支持自动时长 -1。" }] : []),
    ...(resolutions?.length ? [{ key: "resolution", label: "输出分辨率", control: "select" as const, valueType: "string" as const,
      default: resolutions[0]!, required: true, options: resolutions.map(value => ({ label: value, value })) }] : []),
    { key: "n", label: "生成数量", control: "number", valueType: "integer", min: 1, max: 1, default: 1 },
  ];
  return { ...model, parameters, outputKinds: ["video"],
    ...(refs ? { inputKinds: ["text", ...(refs.images > 0 || refs.frames ? ["image" as const, "image[]" as const] : []), ...(refs.videos ? ["video" as const, "video[]" as const] : []), ...(refs.audios ? ["audio" as const, "audio[]" as const] : [])],
      limits: { ...model.limits, maxInputImages: refs.images + (refs.frames ? 2 : 0), maxInputVideos: refs.videos, maxInputAudios: refs.audios } } : {}),
    metadata: { ...model.metadata, documentationUrl: CHUANGXIANG_VIDEO_DOCS, remoteMediaUrlsOnly: true,
      chuangxiangVideoContractCheckedAt: "2026-10-07", videoPollingTimeoutMs: CHUANGXIANG_VIDEO_TIMEOUT_MS,
      ...(refs ? { videoReferenceImageLimit: refs.images, videoReferenceVideoLimit: refs.videos, videoReferenceAudioLimit: refs.audios, videoSupportsFirstLastFrames: refs.frames,
        supportsFirstLastFrames: refs.frames, allowFrameMediaMix: refs.frames && !id.startsWith("sd14-"),
        // SD12 permits audio with a reference image OR video. Its exact
        // conditional rule lives in validateChuangxiangVideoRequest.
        requiresImageWithAudio: false } : {}) },
  };
}

export function applyChuangxiangCurrentVideoCapabilities(connection: { provider: string; config: Readonly<Record<string, unknown>> }, model: ModelDescriptor): ModelDescriptor {
  return connection.provider === "rest" && isChuangxiangVideoConnection(connection.config, model.id) && model.metadata?.canvasRunnable !== false ? chuangxiangVideoModel(model.id, model) : model;
}

const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const publicHttps = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password &&
    !/^(?:localhost$|127\.|0\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[(?:::1\]|f[cd][\da-f]*:|fe80:))/iu.test(url.hostname) && !url.hostname.endsWith(".local") && !/^\/v1\/files(?:\/|$)/u.test(url.pathname); } catch { return false; }
};

/** Normalize canvas assets into the documented wire fields; no network or generation. */
export function normalizeChuangxiangVideoParameters(request: NormalizedRequest): Record<string, unknown> {
  const p = { ...request.parameters };
  if (p.seconds === undefined && p.duration !== undefined) p.seconds = p.duration;
  delete p.duration;
  p.n ??= 1;
  const fields = { image: "reference_image_urls", video: "reference_videos", audio: "reference_audios" } as const;
  for (const kind of ["image", "video", "audio"] as const) {
    const urls = [...array(p[fields[kind]]), ...(request.assets ?? []).filter(a => a.kind === kind && (!a.role || a.role === "reference")).map(a => a.url)];
    if (urls.length) p[fields[kind]] = [...new Set(urls)];
  }
  for (const [role, field] of [["firstFrame", "first_image_url"], ["lastFrame", "last_image_url"]] as const) {
    const asset = request.assets?.find(a => a.role === role);
    if (asset && p[field] === undefined) p[field] = asset.url;
  }
  return p;
}

export function validateChuangxiangVideoRequest(request: NormalizedRequest): ValidationIssue[] {
  if (!isChuangxiangVideoModel(request.model)) return [];
  const p = normalizeChuangxiangVideoParameters(request), id = request.model!, refs = references(id), issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, code: "invalid_parameter", message });
  if (!request.operation.startsWith("video.")) add("operation", "此创想型号只支持视频生成。");
  if (p.n !== 1) add("parameters.n", "创想视频每次请求只能生成一个任务（n=1）。");
  if (request.parameters?.seconds !== undefined && request.parameters.duration !== undefined && request.parameters.seconds !== request.parameters.duration) add("parameters.duration", "duration 与 seconds 必须一致，避免发送歧义时长。");
  const durations = secondsOptions(id);
  if (p.seconds !== undefined && (typeof p.seconds !== "number" || !Number.isInteger(p.seconds) || p.seconds < 1 || (durations && !durations.includes(p.seconds)))) add("parameters.duration", durations ? `该型号只支持 ${durations.join(" / ")} 秒。` : "视频时长必须是正整数秒，不支持 -1。");
  if (durations && p.seconds === undefined) add("parameters.duration", `请选择 ${durations.join(" / ")} 秒。`);
  const counts: Record<string, number> = {};
  for (const [field, limit] of [["reference_image_urls", refs?.images], ["reference_videos", refs?.videos], ["reference_audios", refs?.audios]] as const) {
    const urls = array(p[field]); counts[field] = urls.length;
    if (p[field] !== undefined && !Array.isArray(p[field])) add(`parameters.${field}`, "参考素材必须是 HTTPS URL 数组。");
    if (limit !== undefined && urls.length > limit) add(`parameters.${field}`, limit === 0 ? "该型号不支持此类参考素材。" : `该型号最多接受 ${limit} 个此类参考素材。`);
    if (urls.some(url => !publicHttps(url))) add(`parameters.${field}`, "参考素材必须是公网 HTTPS 链接，不能使用本地路径、内嵌数据或 /v1/files。");
  }
  const first = p.first_image_url !== undefined, last = p.last_image_url !== undefined;
  for (const role of ["firstFrame", "lastFrame"] as const) if ((request.assets ?? []).filter(asset => asset.role === role).length > 1) add("assets", "首帧和尾帧分别只能提供一张图片。");
  for (const field of ["first_image_url", "last_image_url"] as const) if (p[field] !== undefined && !publicHttps(p[field])) add(`parameters.${field}`, "首尾帧必须使用公网 HTTPS 图片链接。");
  if (refs?.frames === false && (first || last)) add("assets", "该型号不支持首尾帧。");
  if (last && !first) add("assets", "尾帧必须搭配首帧。");
  const referenceCount = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if ((id.startsWith("sd14-") || id.startsWith("omni-fast")) && (first || last) && referenceCount) add("assets", "该型号首尾帧不能与参考素材数组混用。");
  if (id.startsWith("omni-fast") && first !== last) add("assets", "Omni fast 的首尾帧必须成对提供。");
  if (id.startsWith("omni-v2v") && (!counts.reference_videos || counts.reference_videos > 2)) add("assets", "Omni v2v 必须提供 1–2 段参考视频。");
  if (id.startsWith("sd12-") && counts.reference_audios && (!(counts.reference_image_urls || counts.reference_videos) || first)) add("assets", "SD12 音频须搭配参考图或视频，且不能与首帧混用。");
  for (const asset of request.assets ?? []) if (!publicHttps(asset.url) || asset.kind === "image" && asset.role === "mask" || asset.role && asset.role !== "reference" && asset.kind !== "image") add("assets", "创想视频素材需要兼容角色及公网 HTTPS 链接。");
  return issues;
}

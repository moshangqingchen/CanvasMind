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
        ...["duration", "resolution", "aspect_ratio", "n", "reference_image_urls", "reference_videos", "reference_audios", "first_image_url", "last_image_url"].map(key => ({ target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` }, omitIfUndefined: true, omitIfEmpty: true })),
      ], response },
    poll: { path: "/v1/videos/generations/{taskId}", method: "GET", bodyMode: "none", response },
    pollIntervalMs: CHUANGXIANG_VIDEO_POLL_INTERVAL_MS,
    statusMap: { queued: "queued", pending: "queued", in_progress: "running", processing: "running", running: "running", completed: "succeeded", done: "succeeded", succeeded: "succeeded", success: "succeeded", failed: "failed", error: "failed", canceled: "cancelled", cancelled: "cancelled", expired: "failed" },
    output: { path: "$.data", fallbackPaths: ["$.video_url", "$.url"], kind: "video", urlPath: "url", urlFallbackPaths: ["video_url"], defaultMimeType: "video/mp4", contentFallback: { path: "/v1/videos/{taskId}/content" } },
  };
}
const exactModels = new Set([
  "grok-imagine-video", "grok-imagine-video-1.5", "gv3-grok-video-1.5", "kling-3.0", "kling-3.0-pro", "kl1-kling-3.0", "kl2-kling-3.0",
  "wan4-wan3.0", "wan5-wan3.0", "ve1-veo-3.1-fast", "happyhorse-1.1", "mm2-minimax-h3", "mm2-minimax-h3-max", "mm3-minimax-h3-2k", "niulai-pro",
  "sd7-seedance-2.0-720p", "sd7-seedance-2.0-1080p", "sd8-seedance-2.5", "sd15-seedance-2.0", "sd15-seedance-2.5",
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
  if (id === "sd8-seedance-2.5") return [30];
  if (id === "sd10-seedance-2.5") return [30];
  if (id === "sd10-seedance-2.0-mini") return [5, 10];
  if (id === "sd10-seedance-2.0" || id === "sd10-seedance-2.0-fast") return [5, 10, 15];
  if (id === "ve1-veo-3.1-fast") return [4, 6, 8];
  return undefined;
}

function references(id: string): { images: number; videos: number; audios: number; frames: boolean } | undefined {
  if (id === "gv3-grok-video-1.5") return { images: 7, videos: 0, audios: 0, frames: false };
  if (id === "mm3-minimax-h3-2k") return { images: 9, videos: 3, audios: 3, frames: false };
  if (id === "niulai-pro") return { images: 9, videos: 3, audios: 3, frames: true };
  if (id.startsWith("sd7-")) return { images: 5, videos: 3, audios: 3, frames: false };
  if (id === "sd8-seedance-2.5") return { images: 9, videos: 0, audios: 0, frames: false };
  if (id.startsWith("sd15-")) return id.endsWith("2.5") ? { images: 30, videos: 0, audios: 10, frames: false } : { images: 9, videos: 3, audios: 3, frames: false };
  if (id.startsWith("omni-")) return { images: 5, videos: id.startsWith("omni-v2v") ? 2 : 0, audios: 0, frames: id.startsWith("omni-fast") };
  if (id.startsWith("mm2-")) return { images: 9, videos: 3, audios: 3, frames: true };
  if (id === "grok-imagine-video") return { images: 1, videos: 0, audios: 0, frames: false };
  if (id === "grok-imagine-video-1.5") return { images: 7, videos: 0, audios: 0, frames: false };
  if (id === "kling-3.0" || id === "kling-3.0-pro") return { images: id.endsWith("pro") ? 4 : 1, videos: 0, audios: 0, frames: false };
  if (id === "happyhorse-1.1") return { images: 9, videos: 0, audios: 0, frames: false };
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
  const resolutions = id === "sd8-seedance-2.5" ? undefined : Array.isArray(model.metadata?.videoSupportedResolutions) ? model.metadata.videoSupportedResolutions.filter((v): v is string => typeof v === "string")
    : model.pricing?.tiers?.filter(tier => tier.dimension === "resolution" && typeof tier.value === "string").map(tier => String(tier.value));
  const existing = (model.parameters ?? []).filter(p => ["duration", "seconds", "resolution", "aspect_ratio"].includes(p.key) && ![...(durations ? ["duration", "seconds"] : []), ...(resolutions?.length || id === "sd8-seedance-2.5" ? ["resolution"] : [])].includes(p.key));
  const parameters: ModelParameterDescriptor[] = [...existing,
    ...(durations ? [{ key: "duration", label: "视频时长", control: "select" as const, valueType: "integer" as const,
      default: durations[0]!, required: true, options: durations.map(value => ({ label: `${value} 秒`, value })),
      description: "创想当前文档列出的离散秒数；不支持自动时长 -1。" }] : []),
    ...(!durations && !existing.some(p => ["duration", "seconds"].includes(p.key)) ? [{ key: "duration", label: "视频时长", control: "number" as const, valueType: "integer" as const, min: 1, step: 1,
      description: "正整数秒。该型号范围须以视频分组 Key 查询的模型能力为准；当前公开文档未列具体上下限。" }] : []),
    ...(!existing.some(p => p.key === "aspect_ratio") ? [{ key: "aspect_ratio", label: "画面比例", control: "text" as const, valueType: "string" as const, placeholder: "如 16:9",
      description: "可留空。支持的比例范围以该型号实际能力为准，公开文档未提供逐型号完整枚举。" }] : []),
    ...(resolutions?.length ? [{ key: "resolution", label: "输出分辨率", control: "select" as const, valueType: "string" as const,
      default: resolutions[0]!, required: true, options: resolutions.map(value => ({ label: value, value })) }] : []),
    { key: "n", label: "生成数量", control: "number", valueType: "integer", min: 1, max: 1, default: 1 },
  ];
  return { ...model, parameters, operations: refs ? refs.images > 0 || refs.frames ? ["video.generate", "video.image-to-video"] : ["video.generate"] : model.operations, outputKinds: ["video"],
    ...(refs ? { inputKinds: ["text", ...(refs.images > 0 || refs.frames ? ["image" as const, "image[]" as const] : []), ...(refs.videos ? ["video" as const, "video[]" as const] : []), ...(refs.audios ? ["audio" as const, "audio[]" as const] : [])],
      limits: { ...model.limits, maxInputImages: refs.images + (refs.frames ? 2 : 0), maxInputVideos: refs.videos, maxInputAudios: refs.audios,
        ...(id === "mm3-minimax-h3-2k" ? { maxInputAssets: 10, maxTotalInputVideoDurationSeconds: 15 } : {}), ...(id.startsWith("omni-v2v") ? { requiresInputVideo: true } : {}) } } : {}),
    metadata: { ...model.metadata, documentationUrl: CHUANGXIANG_VIDEO_DOCS, remoteMediaUrlsOnly: true, operationsSource: "declared", outputKindsSource: "declared", catalogCapability: "video",
      chuangxiangVideoContractCheckedAt: "2026-10-07", videoPollingTimeoutMs: CHUANGXIANG_VIDEO_TIMEOUT_MS,
      ...(refs ? { videoReferenceImageLimit: refs.images, videoReferenceVideoLimit: refs.videos, videoReferenceAudioLimit: refs.audios, videoSupportsFirstLastFrames: refs.frames,
        supportsFirstLastFrames: refs.frames, allowFrameMediaMix: refs.frames && !id.startsWith("sd14-") && !id.startsWith("omni-fast") && id !== "niulai-pro",
        // SD12 permits audio with a reference image OR video. Its exact
        // conditional rule lives in validateChuangxiangVideoRequest.
        requiresImageWithAudio: id === "niulai-pro", framePairRequired: id.startsWith("omni-fast"),
        ...(id === "mm3-minimax-h3-2k" ? { referenceVideoObjects: true, maxTotalInputVideoDurationSeconds: 15, maxInputAssets: 10 } : {}),
        ...(id === "sd8-seedance-2.5" ? { videoResolutionParameterUnsupported: true } : {}) } : {}) },
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
  if (p.duration === undefined && p.seconds !== undefined) p.duration = p.seconds;
  delete p.seconds;
  p.n ??= 1;
  const fields = { image: "reference_image_urls", video: "reference_videos", audio: "reference_audios" } as const;
  for (const kind of ["image", "video", "audio"] as const) {
    const explicit = array(p[fields[kind]]);
    const supplied = new Set(explicit.map(value => typeof value === "object" && value !== null ? (value as Record<string, unknown>).url : value));
    const urls = [...explicit, ...(request.assets ?? []).filter(a => a.kind === kind && (!a.role || a.role === "reference") && !supplied.has(a.url)).map(a => kind === "video" && request.model === "mm3-minimax-h3-2k" ? { url: a.url, duration: (a as typeof a & { durationSeconds?: number }).durationSeconds } : a.url)];
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
  if (p.duration !== undefined && (typeof p.duration !== "number" || !Number.isInteger(p.duration) || p.duration < 1 || (durations && !durations.includes(p.duration)))) add("parameters.duration", durations ? `该型号只支持 ${durations.join(" / ")} 秒。` : "视频时长必须是正整数秒，不支持 -1。");
  if (durations && p.duration === undefined) add("parameters.duration", `请选择 ${durations.join(" / ")} 秒。`);
  for (const key of Object.keys(p)) if (!["duration", "resolution", "aspect_ratio", "n", "reference_image_urls", "reference_videos", "reference_audios", "first_image_url", "last_image_url"].includes(key)) add(`parameters.${key}`, `创想公开视频合同未声明参数 ${key}。`);
  if (id === "sd8-seedance-2.5" && p.resolution !== undefined) add("parameters.resolution", "SD8 2.5 不接受 resolution 字段。");
  const counts: Record<string, number> = {};
  for (const [field, limit] of [["reference_image_urls", refs?.images], ["reference_videos", refs?.videos], ["reference_audios", refs?.audios]] as const) {
    const urls = array(p[field]); counts[field] = urls.length;
    if (p[field] !== undefined && !Array.isArray(p[field])) add(`parameters.${field}`, "参考素材必须是 HTTPS URL 数组。");
    if (limit !== undefined && urls.length > limit) add(`parameters.${field}`, limit === 0 ? "该型号不支持此类参考素材。" : `该型号最多接受 ${limit} 个此类参考素材。`);
    if (field === "reference_videos" && id === "mm3-minimax-h3-2k") {
      let totalSeconds = 0;
      for (const item of urls) {
        const video = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
        if (!publicHttps(video.url) || typeof video.duration !== "number" || !Number.isFinite(video.duration) || video.duration <= 0) add(`parameters.${field}`, "MM3 每段参考视频必须是 {url, duration}，duration 为实际正数秒。");
        else totalSeconds += video.duration;
      }
      if (totalSeconds > 15) add(`parameters.${field}`, "MM3 参考视频总时长不能超过 15 秒。");
    } else if (urls.some(url => !publicHttps(url))) add(`parameters.${field}`, "参考素材必须是公网 HTTPS 链接，不能使用本地路径、内嵌数据或 /v1/files。");
  }
  const first = p.first_image_url !== undefined, last = p.last_image_url !== undefined;
  for (const role of ["firstFrame", "lastFrame"] as const) if ((request.assets ?? []).filter(asset => asset.role === role).length > 1) add("assets", "首帧和尾帧分别只能提供一张图片。");
  for (const field of ["first_image_url", "last_image_url"] as const) if (p[field] !== undefined && !publicHttps(p[field])) add(`parameters.${field}`, "首尾帧必须使用公网 HTTPS 图片链接。");
  if (refs?.frames === false && (first || last)) add("assets", "该型号不支持首尾帧。");
  if (last && !first) add("assets", "尾帧必须搭配首帧。");
  const referenceCount = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if ((id.startsWith("sd14-") || id.startsWith("omni-fast") || id === "niulai-pro") && (first || last) && referenceCount) add("assets", "该型号首尾帧不能与参考素材数组混用。");
  if (id === "mm3-minimax-h3-2k" && referenceCount > 10) add("assets", "MM3 所有参考素材合计不能超过 10 个。");
  if (id === "niulai-pro" && counts.reference_audios && !counts.reference_image_urls) add("assets", "牛来 Pro 参考音频必须搭配至少一张参考图。");
  if (id.startsWith("omni-fast") && first !== last) add("assets", "Omni fast 的首尾帧必须成对提供。");
  if (id.startsWith("omni-v2v") && (!counts.reference_videos || counts.reference_videos > 2)) add("assets", "Omni v2v 必须提供 1–2 段参考视频。");
  if (id.startsWith("sd12-") && counts.reference_audios && (!(counts.reference_image_urls || counts.reference_videos) || first)) add("assets", "SD12 音频须搭配参考图或视频，且不能与首帧混用。");
  for (const asset of request.assets ?? []) if (!publicHttps(asset.url) || asset.kind === "image" && asset.role === "mask" || asset.role && asset.role !== "reference" && asset.kind !== "image") add("assets", "创想视频素材需要兼容角色及公网 HTTPS 链接。");
  return issues;
}

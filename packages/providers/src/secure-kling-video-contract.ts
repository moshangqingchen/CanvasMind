import type { ModelDescriptor, NormalizedRequest, ValidationIssue } from "./contracts.js";
import type { RestModelConnectorOverride } from "./rest.js";

export const SECURE_KLING_MODEL_ID = "kling-video-v4";
export function isSecureKlingScope(id: string, context: { baseUrl?: unknown; manualProtocol?: unknown; group?: string | undefined; officialGroupId?: string | number | undefined }): boolean {
  if (id !== SECURE_KLING_MODEL_ID || String(context.officialGroupId) !== "61" || context.manualProtocol === true) return false;
  try { const url = new URL(String(context.baseUrl)); return url.origin === "https://token.secure-skill.com" && !url.username && !url.password && !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname); } catch { return false; }
}
export function secureKlingVideoModel(current?: ModelDescriptor): ModelDescriptor {
  const metadata = { ...current?.metadata };
  for (const key of ["durationRangeUnverified", "resolutionRangeUnverified", "parameterControlsUnavailable", "videoDurationValues", "videoParameterConfirmedDefaults", "videoMaxDuration", "videoReferenceImageLimit", "videoReferenceVideoLimit", "videoReferenceAudioLimit"]) delete metadata[key];
  return { ...current, id: SECURE_KLING_MODEL_ID, name: current?.name ?? SECURE_KLING_MODEL_ID,
    operations: ["video.generate", "video.image-to-video"], inputKinds: ["text", "image", "image[]", "video", "video[]", "audio", "audio[]"], outputKinds: ["video"],
    limits: {}, parameters: [
      { key: "duration", label: "视频时长", control: "number", valueType: "integer", required: true, min: 1, step: 1, allowCustomValue: true,
        description: "必填正整数秒；供应商没有公布最大时长或默认时长，按填写值提交。" },
      { key: "resolution", label: "输出分辨率", control: "select", valueType: "string", default: "720p", options: ["720p", "1080p"].map(value => ({ label: value, value })) },
      { key: "aspect_ratio", label: "画面比例", control: "text", valueType: "string", allowCustomValue: true,
        options: ["16:9", "9:16", "1:1"].map(value => ({ label: value, value })), description: "开放字符串，按原值转发；留空不指定比例。" },
      { key: "size", label: "输出像素尺寸", control: "text", valueType: "string", allowCustomValue: true,
        description: "仅未填写比例时用于识别画幅；未填写分辨率时也用于识别档位，例如1280x720。" },
    ], metadata: { ...metadata, supplier: "secure", modality: "video", catalogCapability: "video", protocol: "openai-videos",
      operationsSource: "declared", outputKindsSource: "declared", parameterSource: "supplier-documented-contract", protocolEvidence: "supplier-documentation",
      documentationUrl: "https://token.secure-skill.com/docs", videoContractCheckedAt: "2026-10-21", generationVerified: false,
      endpointPath: "/v1/videos", endpointMethod: "POST", parameterControlsUnavailable: false, remoteMediaUrlsOnly: true,
      videoMinDuration: 1, videoSupportedResolutions: ["720p", "1080p"], videoResolutionAllowsCustom: false,
      supportsFirstLastFrames: false, videoSupportsFirstLastFrames: false, allowFrameMediaMix: false,
      billingUnit: "second", videoContractNote: "按提交秒数乘清晰度单价计费；参考视频不另加价格档。查询与下载使用创建任务的同一把Key，完成后读取本站转存地址。" } };
}
const list = (v: unknown): unknown[] => v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v];
const duration = (v: unknown): unknown => typeof v === "string" && /^[1-9]\d*s?$/iu.test(v.trim()) ? Number(v.trim().replace(/s$/iu, "")) : v;
export function normalizeSecureKlingVideoParameters(request: NormalizedRequest): Record<string, unknown> {
  const source = request.parameters ?? {}, p: Record<string, unknown> = {};
  const seconds = source.duration ?? source.seconds ?? source.video_length;
  if (seconds !== undefined) p.duration = duration(seconds);
  const ratio = source.aspect_ratio ?? source.ratio ?? source.aspectRatio;
  if (ratio !== undefined && ratio !== "") p.ratio = ratio;
  if (source.size !== undefined && source.size !== "") p.size = source.size;
  if (typeof source.resolution === "string" && source.resolution.trim()) p.resolution = source.resolution.toLowerCase();
  const media = [...list(source.media)];
  for (const kind of ["image", "video", "audio"] as const) {
    for (const url of [...list(source[`${kind}_url`]), ...list(source[`${kind}_urls`]), ...list(source[`${kind}s`])]) media.push({ type: `reference_${kind}`, url });
  }
  for (const asset of request.assets ?? []) media.push({ type: `reference_${asset.kind}`, url: asset.url });
  if (media.length) p.media = media;
  if (source.stream !== undefined) p.stream = source.stream;
  return p;
}
function publicUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password &&
    !/^(?:localhost$|127\.|0\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[(?:::1\]|f[cd][\da-f]*:|fe80:))/iu.test(u.hostname) && !/\.(?:local|localhost)$/iu.test(u.hostname); } catch { return false; }
}
export function secureKlingVideoRequestIssues(request: NormalizedRequest): ValidationIssue[] {
  const p = normalizeSecureKlingVideoParameters(request), source = request.parameters ?? {}, issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, code: "invalid_parameter" as const, message });
  if (typeof p.duration !== "number" || !Number.isSafeInteger(p.duration) || p.duration < 1) add("parameters.duration", "Kling视频时长必须填写正整数秒，没有默认时长。");
  const durations = ["duration", "seconds", "video_length"].map(k => source[k]).filter(v => v !== undefined).map(duration);
  if (new Set(durations).size > 1) add("parameters.duration", "时长别名不能冲突。");
  const ratios = ["ratio", "aspect_ratio", "aspectRatio"].map(k => source[k]).filter(v => v !== undefined);
  if (new Set(ratios).size > 1 || p.ratio !== undefined && typeof p.ratio !== "string") add("parameters.aspect_ratio", "比例必须为字符串，别名不能冲突。");
  if (source.resolution !== undefined && (typeof source.resolution !== "string" || !["720p", "1080p"].includes(source.resolution.toLowerCase()))) add("parameters.resolution", "Kling分辨率仅支持720p或1080p。");
  if (p.size !== undefined && typeof p.size !== "string") add("parameters.size", "size必须为字符串。");
  if (source.stream !== undefined && source.stream !== false) add("parameters.stream", "Kling使用异步任务，不支持stream=true。");
  const allowed = new Set(["duration", "seconds", "video_length", "aspect_ratio", "ratio", "aspectRatio", "resolution", "size", "media", "stream", ...["image", "video", "audio"].flatMap(k => [`${k}_url`, `${k}_urls`, `${k}s`])]);
  for (const key of Object.keys(source)) if (!allowed.has(key) && source[key] !== undefined && source[key] !== "") add(`parameters.${key}`, "当前Kling合同没有声明此参数；保留原值，请移除后提交。");
  for (const item of list(p.media)) {
    const row = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    if (!publicUrl(row.url) || row.type !== undefined && row.type !== "" && !["reference_image", "reference_video", "reference_audio"].includes(String(row.type))) add("assets", "Kling参考素材须为公网HTTP(S)地址与参考素材角色。");
  }
  if (request.assets?.some(a => a.role && a.role !== "reference")) add("assets", "Kling当前专属合同只声明普通参考素材，不能将首尾帧角色静默改为参考图。");
  return issues;
}
export function secureKlingVideoTransport(): RestModelConnectorOverride {
  const response = { taskIdPath: "$.id", taskIdFallbackPaths: ["$.task_id"], statusPath: "$.status", progressPath: "$.progress", errorPath: "$.error.message" };
  return { submit: { path: "/v1/videos", method: "POST", bodyMode: "json", idempotent: false,
    mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }, { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      ...["duration", "ratio", "resolution", "size", "media", "stream"].map(key => ({ target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` }, omitIfEmpty: true, omitIfUndefined: true }))], response },
    poll: { path: "/v1/videos/{taskId}", method: "GET", bodyMode: "none", response }, pollIntervalMs: 4000,
    statusMap: { queued: "queued", in_progress: "running", processing: "running", completed: "succeeded", failed: "failed" },
    output: { path: "$.video_url", fallbackPaths: ["$.url", "$.output[0].url"], kind: "video", defaultMimeType: "video/mp4", contentFallback: { path: "/v1/videos/{taskId}/content" } } };
}

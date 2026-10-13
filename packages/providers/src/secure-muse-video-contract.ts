import type { ModelDescriptor, NormalizedRequest, ProviderAssetInput, ValidationIssue } from "./contracts.js";
import type { RestModelConnectorOverride } from "./rest.js";

export const SECURE_MUSE_MODEL_ID = "muse-video";
export const SECURE_MUSE_DOCS = "https://token.secure-skill.com/docs";

/** The official Muse channel and current group 57 document this complete ID. */
export function isSecureMuseVideoModel(id: string | undefined, group?: string): boolean {
  return id === SECURE_MUSE_MODEL_ID && /^muse(?:[-_ ]video)?$/iu.test(group ?? "");
}

function referenceImageLimit(officialGroupId?: string | number): 9 | 10 {
  // Current group57 announcement63 explicitly limits this account channel to
  // nine images. The general Muse document still says ten; do not transfer a
  // current channel restriction to another historical group's permission.
  return String(officialGroupId) === "57" ? 9 : 10;
}

export function secureMuseVideoModel(current?: ModelDescriptor, officialGroupId?: string | number): ModelDescriptor {
  const metadata = { ...current?.metadata };
  const imageLimit = referenceImageLimit(officialGroupId);
  // A descriptor can be restored under a different saved connection. Its
  // current group57 evidence must not label another group's ten-image rule.
  for (const key of ["videoReferenceImageLimitSource", "videoReferenceImageLimitSourceUrl", "videoReferenceImageLimitSourceUpdatedAt", "videoReferenceImageLimitConflict"])
    delete metadata[key];
  delete metadata.durationRangeUnverified;
  delete metadata.resolutionRangeUnverified;
  return { ...current, id: SECURE_MUSE_MODEL_ID, name: current?.name ?? SECURE_MUSE_MODEL_ID,
    operations: ["video.generate", "video.image-to-video"], inputKinds: ["text", "image", "image[]"], outputKinds: ["video"],
    parameters: [
      { key: "duration", label: "视频时长", control: "number", valueType: "integer", default: 6, min: 1, max: 30, step: 1,
        description: "正整数秒；供应商默认 6 秒，当前 Muse 分组说明上限 30 秒。" },
      { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: "",
        options: [{ label: "供应商默认", value: "" }, { label: "16:9", value: "16:9" }, { label: "9:16", value: "9:16" }] },
      { key: "resolution", label: "输出分辨率", control: "text", valueType: "string", default: "", allowCustomValue: true, placeholder: "供应商默认（留空）",
        description: "供应商 API 将 resolution 字符串原样转发；当前分组公布 720p 报价，其他输入由供应商按实际型号与分组处理。留空不发送。" },
      { key: "extra", label: "附加提示词", control: "text", valueType: "string" },
      { key: "timeout", label: "任务等待上限（秒）", control: "number", valueType: "integer", min: 1, step: 1,
        description: "留空使用供应商默认；此字段控制任务等待时间。" },
    ],
    // Generic image limits count raw canvas edges. Muse's limit applies after
    // deduplication, so its own validator owns the exact channel image check.
    limits: { maxInputVideos: 0, maxInputAudios: 0 },
    metadata: { ...metadata, supplier: "secure", modality: "video", catalogCapability: "video", operationsSource: "declared",
      outputKindsSource: "declared", protocol: "openai-videos", documentationUrl: SECURE_MUSE_DOCS,
      videoContractCheckedAt: imageLimit === 9 ? "2026-10-12" : "2026-10-10", parameterSource: "supplier-documented-contract", protocolEvidence: "supplier-documentation",
      generationVerified: false, parameterControlsUnavailable: false, remoteMediaUrlsOnly: false,
      endpointPath: "/v1/videos", endpointMethod: "POST", billingUnit: "second", billingLabel: "按秒计费",
      videoMinDuration: 1, videoMaxDuration: 30, videoSupportedResolutions: ["720p"],
      videoResolutionValueMode: "supplier-validated-string", videoResolutionPresetsSource: "group-pricing-declaration", videoResolutionAllowsCustom: true,
      videoReferenceImageLimit: imageLimit, videoReferenceImageCountMode: "deduplicated", videoReferenceVideoLimit: 0, videoReferenceAudioLimit: 0,
      ...(imageLimit === 9 ? { videoReferenceImageLimitSource: "official-group57-announcement63",
        videoReferenceImageLimitSourceUrl: "https://token.secure-skill.com/api/v1/announcements",
        videoReferenceImageLimitSourceUpdatedAt: "2026-10-10T17:58:46.87751+08:00",
        videoReferenceImageLimitConflict: "当前分组57公告63明确9图；通用Muse文档10图保留为其他分组的原声明。720p为该组公布报价，开放resolution字符串仍按用户填写值发送。" } : {}),
      supportsFirstLastFrames: false, videoSupportsFirstLastFrames: false, allowFrameMediaMix: false,
      videoContractNote: `参考图去重后最多 ${imageLimit} 张。使用 Muse 分组 Key；查询、下载使用创建任务的同一把 Key。成片为上游原地址，请及时下载。` } };
}

const array = (value: unknown): unknown[] => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
const imageFields = ["reference_images", "images", "image_urls", "image_url", "image"] as const;
const mediaFields = ["reference_videos", "videos", "video_urls", "video_url", "video", "reference_audios", "audios", "audio_urls", "audio_url", "audio"] as const;
function imageValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.b64_json === "string") return imageValue(record.b64_json);
  if (typeof record.url === "string") return imageValue(record.url);
  if (record.image_url !== undefined) return imageValue(record.image_url);
  return undefined;
}
function assetImage(asset: ProviderAssetInput): string | undefined {
  if (asset.data?.length) return `data:${asset.mimeType};base64,${Buffer.from(asset.data).toString("base64")}`;
  return imageValue(asset.url);
}
export function secureMuseReferenceImages(request: NormalizedRequest): string[] {
  const values = [...imageFields.flatMap(field => array(request.parameters?.[field]).map(imageValue)),
    ...(request.assets ?? []).filter(asset => asset.kind === "image" && (!asset.role || asset.role === "reference")).map(assetImage)];
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value) return false;
    const identity = value.replace(/^data:image\/[^;,]+;base64,/iu, "");
    if (seen.has(identity)) return false;
    seen.add(identity); return true;
  });
}
function duration(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = /^([1-9]\d*)s?$/iu.exec(value.trim());
  return match ? Number(match[1]) : value;
}
function ratio(value: unknown): "16:9" | "9:16" | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["16:9", "16/9", "landscape", "横屏", "1280x720", "1920x1080"].includes(normalized)) return "16:9";
  if (["9:16", "9/16", "portrait", "竖屏", "720x1280", "1080x1920"].includes(normalized)) return "9:16";
  return undefined;
}
/** Normalize only the documented Muse fields, preserving the first image. */
export function normalizeSecureMuseVideoParameters(request: NormalizedRequest): Record<string, unknown> {
  const original = request.parameters ?? {}, p: Record<string, unknown> = {
    duration: duration(original.duration ?? original.seconds ?? original.video_length ?? 6),
  };
  const aspectRatio = ratio(original.aspect_ratio ?? original.aspectRatio) ?? ratio(original.size);
  if (aspectRatio) p.aspect_ratio = aspectRatio;
  if (typeof original.resolution === "string" && original.resolution.trim()) p.resolution = original.resolution;
  const images = secureMuseReferenceImages(request);
  if (images.length) p.reference_images = images;
  if (original.extra !== undefined) p.extra = original.extra;
  if (original.timeout !== undefined) p.timeout = original.timeout;
  if (original.stream !== undefined) p.stream = original.stream;
  return p;
}

export function secureMuseVideoRequestIssues(request: NormalizedRequest, officialGroupId?: string | number): ValidationIssue[] {
  const issues: ValidationIssue[] = [], p = normalizeSecureMuseVideoParameters(request);
  const imageLimit = referenceImageLimit(officialGroupId);
  const add = (path: string, message: string) => issues.push({ path, code: "invalid_parameter", message });
  if (typeof p.duration !== "number" || !Number.isSafeInteger(p.duration) || p.duration < 1 || p.duration > 30)
    add("parameters.duration", "Muse 当前分组视频时长必须为 1–30 的整数秒。");
  const declared = ["duration", "seconds", "video_length"].map(key => request.parameters?.[key]).filter(value => value !== undefined).map(duration);
  if (declared.some(value => value !== declared[0])) add("parameters.duration", "Muse 时长字段不能冲突。");
  if (request.parameters?.resolution !== undefined && typeof request.parameters.resolution !== "string")
    add("parameters.resolution", "Muse resolution 必须为字符串。");
  if (p.extra !== undefined && typeof p.extra !== "string") add("parameters.extra", "Muse 附加提示词必须为字符串。");
  if (p.timeout !== undefined && (typeof p.timeout !== "number" || !Number.isSafeInteger(p.timeout) || p.timeout < 1))
    add("parameters.timeout", "Muse 任务等待上限必须为正整数秒。");
  if (p.stream !== undefined && p.stream !== false) add("parameters.stream", "Muse 使用异步任务，stream 只能为 false。");
  if (secureMuseReferenceImages(request).length > imageLimit) add("assets", `Muse 去重后的参考图最多 ${imageLimit} 张。`);
  for (const field of imageFields) if (array(request.parameters?.[field]).some(value => !imageValue(value)))
    add(`parameters.${field}`, "Muse 参考图必须为图片 URL、base64 或供应商声明的图片对象。");
  const assets = request.assets ?? [];
  if (assets.some(asset => asset.kind === "image" && (asset.role && asset.role !== "reference" || !assetImage(asset))))
    add("assets", "Muse 图片使用普通参考图角色，并提供图片 URL 或原文件。");
  if (assets.some(asset => asset.kind === "video" || asset.kind === "audio") || mediaFields.some(field => array(request.parameters?.[field]).length))
    add("assets", "Muse 素材限于普通参考图片。");
  if (["first_frame", "last_frame", "start_frame", "end_frame"].some(field => array(request.parameters?.[field]).length))
    add("assets", "Muse 图片使用普通参考图角色。");
  return issues;
}

export function secureMuseVideoTransport(): RestModelConnectorOverride {
  const response = { taskIdPath: "$.task_id", taskIdFallbackPaths: ["$.id"], statusPath: "$.status", progressPath: "$.progress", errorPath: "$.error.message" };
  return { submit: { path: "/v1/videos", method: "POST", bodyMode: "json", idempotent: false,
    mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }, { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      ...["duration", "aspect_ratio", "resolution", "reference_images", "extra", "timeout", "stream"].map(field => ({ target: `/${field}`, source: { kind: "request" as const, path: `$.parameters.${field}` }, omitIfUndefined: true, omitIfEmpty: true }))], response },
    poll: { path: "/v1/videos/{taskId}", method: "GET", bodyMode: "none", response }, pollIntervalMs: 4000,
    statusMap: { queued: "queued", in_progress: "running", processing: "running", completed: "succeeded", failed: "failed" },
    output: { path: "$.video_url", fallbackPaths: ["$.url", "$.output[0].url"], kind: "video", defaultMimeType: "video/mp4",
      contentFallback: { path: "/v1/videos/{taskId}/content" } } };
}

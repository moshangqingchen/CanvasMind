import type { ModelDescriptor, ModelParameterDescriptor, NormalizedRequest, ProviderAssetInput, ValidationIssue } from "./contracts.js";
import type { RestModelConnectorOverride } from "./rest.js";

export const JIJIU_VIDEO_DOCS = "https://newapi.jijiucanvas.com/docs/api-docs.md";
interface Contract {
  group: string; min: number; max: number; resolutions?: readonly string[];
  images?: number; videos?: number; audios?: number; inputDurationBilling?: boolean;
  wan?: boolean; minimax?: boolean; note?: string;
}
/** Exact IDs from the current pricing directory; bounds from the same site's guide §4.5. */
const contracts: Readonly<Record<string, Contract>> = {
  MinimaxH3: { group: "视频-MnimaxH3", min: 1, max: 3600, resolutions: ["480p", "768p", "1080p", "2k-upscale", "4k-upscale"], images: 9, videos: 3, audios: 3, minimax: true },
  "Minimax漫剧优化版": { group: "视频-MnimaxH3", min: 1, max: 3600, resolutions: ["480p", "768p", "2k-upscale", "4k-upscale"], images: 9, videos: 3, audios: 3, minimax: true,
    note: "1080p 未开放；官网说明该输入会按 768p 出片并计费，当前不提供伪 1080p 选项。" },
  "MinimaxH3特价版": { group: "视频-MnimaxH3", min: 4, max: 15, note: "固定 2K 出片；官方未给出此线路的 resolution 原始枚举，省略该字段使用供应商默认。" },
  "SD2.0满血稳定933-线路一": { group: "视频SD2.0", min: 4, max: 15, resolutions: ["720p"], images: 9, videos: 3, audios: 3 },
  "SD2.0满血稳定933-线路二": { group: "视频SD2.0", min: 5, max: 15, resolutions: ["720p"], images: 9, videos: 3, audios: 3 },
  "SD2.0fast稳定903A": { group: "视频SD2.0", min: 4, max: 15, resolutions: ["720p"], images: 9, videos: 0, audios: 3 },
  "SD2.0mini稳定900B": { group: "视频SD2.0", min: 4, max: 15, images: 9, videos: 0, audios: 0 },
  "SD2.0mini稳定903C": { group: "视频SD2.0", min: 4, max: 10, resolutions: ["480p"], images: 9, videos: 0, audios: 3 },
  "SD2.5特价30-10-10-线路一": { group: "视频SD.2.5", min: 30, max: 30, resolutions: ["720p"], images: 30, videos: 0, audios: 10 },
  "SD2.5特价30-10-10-线路二": { group: "视频SD.2.5", min: 4, max: 30, resolutions: ["480p"], images: 30, videos: 10, audios: 10 },
  "SD2.5特价30-10线路一": { group: "视频SD.2.5", min: 4, max: 30, resolutions: ["720p"], images: 30, videos: 0, audios: 10 },
  "满血seedance-2.5全参A": { group: "稳定满血视频模型", min: 4, max: 30, resolutions: ["480p", "720p", "1080p"], images: 30, videos: 10, audios: 10, note: "供应商说明此线路带数字水印，按次计费。" },
  "满血seedance-2.5全参B": { group: "稳定满血视频模型", min: 4, max: 30, resolutions: ["480p", "720p"], images: 30, videos: 10, audios: 10 },
  "稳定seedance-2.5全参D": { group: "稳定满血视频模型", min: 4, max: 30, resolutions: ["720p"], images: 30, videos: 10, audios: 10 },
  "稳定seedance-2.5全参E": { group: "稳定满血视频模型", min: 4, max: 30, resolutions: ["480p", "720p"], images: 30, videos: 10, audios: 10, inputDurationBilling: true,
    note: "带参考图时自动处理人脸；带参考视频时按输入参考视频总时长加输出时长计费。" },
  "稳定seedance-2.5参图参音F": { group: "稳定满血视频模型", min: 4, max: 29, resolutions: ["720p"], images: 30, videos: 0, audios: 10 },
  "wan3.0-video": { group: "视频WAN3", min: 2, max: 30, resolutions: ["480p", "720p", "1080p"], images: 10, videos: 5, audios: 5, wan: true },
  "wan3.0-video-prime": { group: "视频WAN3", min: 2, max: 30, resolutions: ["480p", "720p", "1080p"], images: 10, videos: 5, audios: 5, wan: true },
};
export function isJijiuApiUrl(value: unknown): boolean {
  try { const u = new URL(String(value)); return u.origin === "https://newapi.jijiucanvas.com" && !u.username && !u.password && !u.search && !u.hash && /^(?:\/v1)?\/?$/u.test(u.pathname); }
  catch { return false; }
}
function contract(id: string, current?: ModelDescriptor): Contract | undefined {
  if (["manual", "paid-test"].includes(String(current?.metadata?.source)) || current?.metadata?.protocolEvidence === "paid-test") return undefined;
  return Object.hasOwn(contracts, id) ? contracts[id] : undefined;
}
export const jijiuVideoModelIds = (): string[] => Object.keys(contracts);
export const isJijiuVideoModel = (id: string, current?: ModelDescriptor): boolean => Boolean(contract(id, current));
export const jijiuVideoGroupMismatch = (settings: Readonly<Record<string, unknown>> | undefined): boolean => settings?.accountKeyGroup !== undefined && settings.modelGroup !== undefined && settings.accountKeyGroup !== settings.modelGroup;
function groupAllowed(id: string, c: Contract, group: string | undefined): boolean {
  return !group || group === c.group || group === "auto" || id === "SD2.0fast稳定903A" && group === "vip";
}
export function jijiuVideoModel(id: string, current?: ModelDescriptor, group?: string): ModelDescriptor | undefined {
  const c = contract(id, current); if (!c) return undefined;
  const min = c.min, max = c.max;
  const metadata = { ...current?.metadata };
  for (const key of ["durationRangeUnverified", "durationRangeSource", "durationRangeFallbackFamily", "userFallbackDurationRange", "resolutionRangeUnverified", "videoParameterConfirmedDefaults"]) delete metadata[key];
  if (metadata.jijiuGroupUnavailable === true && groupAllowed(id, c, group)) { delete metadata.canvasUnavailableReason; delete metadata.canvasRunnable; }
  const parameters: ModelParameterDescriptor[] = [
    { key: "duration", label: "视频时长", control: min === max ? "select" : "number", valueType: "integer", step: 1, ...(min !== undefined && min === max ? { default: min, options: [{ label: `${min} 秒`, value: min }] } : {}), ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }),
      description: "留空采用供应商线路默认时长；超范围值会在提交前阻止，不接受上游静默裁剪。" },
    { key: "resolution", label: "输出分辨率", control: "select", valueType: "string", options: (c.resolutions ?? []).map(value => ({ label: value, value })),
      ...(!c.resolutions?.length ? { description: c.note ?? "此完整型号尚未公布生成分辨率枚举，省略该字段使用供应商默认；计费档位不代表生成支持。" } : {}) },
    { key: "aspect_ratio", label: "画面比例", control: "text", valueType: "string", description: "供应商接受宽高比，例如 16:9、9:16、1:1；留空使用线路默认。" },
    { key: "seed", label: "随机种子", control: "number", valueType: "integer" },
    { key: "negative_prompt", label: "负面提示词", control: "text", valueType: "string" },
    ...(c.minimax ? [
      { key: "watermark", label: "平台水印", control: "toggle" as const, valueType: "boolean" as const },
      { key: "prompt_optimizer", label: "提示词优化", control: "toggle" as const, valueType: "boolean" as const },
    ] : []),
  ];
  return { ...current, id, name: current?.name ?? id, operations: ["video.generate", "video.image-to-video"], inputKinds: ["text", "image", "image[]", ...(c.videos !== 0 ? ["video" as const, "video[]" as const] : []), ...(c.audios !== 0 ? ["audio" as const, "audio[]" as const] : [])], outputKinds: ["video"], parameters,
    limits: { ...(c.images === undefined ? {} : { maxInputImages: c.images }), ...(c.videos === undefined ? {} : { maxInputVideos: c.videos }), ...(c.audios === undefined ? {} : { maxInputAudios: c.audios }), ...(c.wan ? { maxInputVideoDurationSeconds: 15 } : {}) },
    metadata: { ...metadata, supplier: "jijiu", modality: "video", catalogCapability: "video", operationsSource: "declared", outputKindsSource: "declared", protocol: "openai-videos", documentationUrl: JIJIU_VIDEO_DOCS,
      endpointPath: "/v1/videos", endpointMethod: "POST", parameterSource: "supplier-documented-contract", protocolEvidence: "supplier-documentation", generationVerified: false, videoContractCheckedAt: "2026-10-10",
      videoMinDuration: min, videoMaxDuration: max, ...(min === max ? { videoDurationValues: [min], videoParameterConfirmedDefaults: { duration: min } } : {}), videoSupportedResolutions: [...(c.resolutions ?? [])], ...(!c.resolutions?.length ? { resolutionRangeUnverified: true } : {}),
      remoteMediaUrlsOnly: true, supportsFirstLastFrames: true, videoSupportsFirstLastFrames: true, allowFrameMediaMix: true, videoReferenceImageLimit: c.images, videoReferenceVideoLimit: c.videos, videoReferenceAudioLimit: c.audios,
      parameterControlsUnavailable: false, jijiuVideoContract: true, ...(group ? { jijiuContractGroup: group } : {}), ...(c.note ? { videoContractNote: c.note } : {}), ...(c.wan ? { videoContractNote: "参考视频每段最多 15 秒；参考视频总时长加输出时长合计最多 30 秒，并按合计时长计费。" } : {}),
      ...(c.wan || c.inputDurationBilling ? { billingIncludesInputDuration: true, priceContractWarning: "按参考视频总时长加输出时长计费；未计入输入视频时长时不显示输出秒数推算的总价。" } : {}),
      jijiuGroupUnavailable: !groupAllowed(id, c, group), ...(!groupAllowed(id, c, group) ? { canvasRunnable: false, canvasUnavailableReason: "当前极九分组未上架此完整型号。" } : {}) } };
}
const list = (v: unknown): unknown[] => v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v];
const aliases = { image: ["images", "input_reference", "reference_images", "reference_image_urls", "image_urls", "image_url", "image"], video: ["reference_videos", "videos", "video_urls", "video_url"], audio: ["reference_audios", "audios", "audio_urls", "audio_url"] } as const;
function references(request: NormalizedRequest, kind: keyof typeof aliases): unknown[] {
  return [...aliases[kind].flatMap(key => list(request.parameters?.[key])), ...(request.assets ?? []).filter(a => a.kind === kind && (!a.role || a.role === "reference")).map(a => a.url)];
}
const frameAssets = (request: NormalizedRequest, role: ProviderAssetInput["role"]) => (request.assets ?? []).filter(a => a.kind === "image" && a.role === role);
export function normalizeJijiuVideoParameters(request: NormalizedRequest): Record<string, unknown> {
  const s = request.parameters ?? {}, p: Record<string, unknown> = {};
  const fixed = contracts[request.model ?? ""];
  const seconds = s.duration ?? s.seconds ?? (fixed?.min !== undefined && fixed.min === fixed.max ? fixed.min : undefined), ratio = s.aspect_ratio ?? s.ratio;
  if (seconds !== undefined && seconds !== "") p.seconds = seconds;
  if (ratio !== undefined && ratio !== "") p.aspect_ratio = ratio;
  for (const key of ["resolution", "seed", "negative_prompt", "watermark", "prompt_optimizer", "callback_url", "metadata"])
    if (s[key] !== undefined && s[key] !== "") p[key] = s[key];
  for (const [kind, field] of [["image", "images"], ["video", "reference_videos"], ["audio", "reference_audios"]] as const) { const values = references(request, kind); if (values.length) p[field] = values; }
  for (const [role, field] of [["firstFrame", "first_frame_image"], ["lastFrame", "last_frame_image"]] as const) {
    const value = s[field] ?? frameAssets(request, role)[0]?.url; if (value !== undefined) p[field] = value;
  }
  return p;
}
function publicUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && !/^(?:localhost$|127\.|0\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[(?:::1\]|f[cd][\da-f]*:|fe80:))/iu.test(u.hostname) && !/\.(?:local|localhost)$/iu.test(u.hostname); }
  catch { return false; }
}
export function jijiuVideoRequestIssues(request: NormalizedRequest, current?: ModelDescriptor, group?: string): ValidationIssue[] {
  const c = contract(request.model ?? "", current); if (!c) return [];
  const descriptor = jijiuVideoModel(request.model!, current)!, p = normalizeJijiuVideoParameters(request), source = request.parameters ?? {};
  const issues: ValidationIssue[] = [], add = (path: string, message: string) => issues.push({ path, code: "invalid_parameter", message });
  if (!groupAllowed(request.model!, c, group)) add("model", "当前极九分组未上架此完整型号。");
  const duration = descriptor.parameters!.find(v => v.key === "duration")!;
  if (p.seconds !== undefined && (typeof p.seconds !== "number" || !Number.isInteger(p.seconds) || p.seconds < (duration.min ?? 1) || duration.max === undefined || p.seconds > duration.max)) add("parameters.duration", `此型号时长必须为 ${duration.min}–${duration.max} 的整数秒。`);
  if (source.duration !== undefined && source.seconds !== undefined && source.duration !== source.seconds) add("parameters.duration", "duration 与 seconds 不能冲突。");
  if (source.aspect_ratio !== undefined && source.ratio !== undefined && source.aspect_ratio !== source.ratio) add("parameters.aspect_ratio", "aspect_ratio 与 ratio 不能冲突。");
  if (p.resolution !== undefined && !c.resolutions?.includes(String(p.resolution))) add("parameters.resolution", c.resolutions?.length ? `此型号分辨率仅支持 ${c.resolutions.join(" / ")}。` : "此型号生成分辨率尚未确认，请选择供应商默认。");
  if (p.aspect_ratio !== undefined && (typeof p.aspect_ratio !== "string" || !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/u.test(p.aspect_ratio) || !p.aspect_ratio.split(":").every(v => Number(v) > 0))) add("parameters.aspect_ratio", "画面比例必须为正数宽高比。");
  if (source.size !== undefined) add("parameters.size", "此型号未公布完整像素尺寸规则，请使用已确认的分辨率与画幅，或清空旧 size 使用供应商默认。");
  if (p.seed !== undefined && (typeof p.seed !== "number" || !Number.isSafeInteger(p.seed))) add("parameters.seed", "随机种子必须为安全整数。");
  for (const field of ["watermark", "prompt_optimizer"]) if (p[field] !== undefined && (!c.minimax || typeof p[field] !== "boolean")) add(`parameters.${field}`, "此参数只支持 MiniMax H3 标准/漫剧线路，且必须为布尔值。");
  if (p.callback_url !== undefined && (!c.minimax || !publicUrl(p.callback_url))) add("parameters.callback_url", "此线路未支持该回调地址。");
  if (p.metadata !== undefined && (!c.minimax || !p.metadata || typeof p.metadata !== "object" || Array.isArray(p.metadata))) add("parameters.metadata", "透传 metadata 只支持 MiniMax H3 标准/漫剧线路的对象。");
  for (const [kind, limit] of [["image", c.images], ["video", c.videos], ["audio", c.audios]] as const) {
    const values = references(request, kind);
    if (kind === "image") for (const field of ["first_frame_image", "last_frame_image"]) values.push(...list(p[field]));
    if (limit !== undefined && values.length > limit) add("assets", `此型号最多支持 ${limit} 个${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}素材（含首尾帧）。`);
    if (values.some(v => !publicUrl(v))) add("assets", "极九参考素材只接受公网 HTTP(S) URL，不接受文件、对象或本地地址。");
  }
  for (const [role, field] of [["firstFrame", "first_frame_image"], ["lastFrame", "last_frame_image"]] as const)
    if (frameAssets(request, role).length + list(source[field]).length > 1) add("assets", "首帧和尾帧分别最多一张。");
  for (const asset of request.assets ?? []) if (asset.role === "mask" || asset.kind !== "image" && asset.role && asset.role !== "reference") add("assets", "极九视频只支持参考素材与图片首尾帧角色。");
  if (c.wan && references(request, "video").length) {
    const videos = (request.assets ?? []).filter(a => a.kind === "video"), refs = references(request, "video");
    if (refs.some(url => !videos.some(a => a.url === url && typeof a.durationSeconds === "number" && Number.isFinite(a.durationSeconds) && a.durationSeconds > 0))) add("assets", "WAN 参考视频必须具备已测量的实际时长，才能校验合计上限及报价。");
    if (videos.some(a => (a.durationSeconds ?? 0) > 15)) add("assets", "WAN 每段参考视频最多 15 秒。");
    if (p.seconds === undefined) add("parameters.duration", "WAN 带参考视频时请选择输出时长，以核对合计 30 秒上限。");
    else if (refs.reduce<number>((sum, url) => sum + (videos.find(a => a.url === url)?.durationSeconds ?? 0), 0) + Number(p.seconds) > 30) add("parameters.duration", "WAN 参考视频总时长与输出时长合计最多 30 秒。");
  }
  return issues;
}
export function jijiuVideoTransport(): RestModelConnectorOverride {
  const response = { taskIdPath: "$.id", statusPath: "$.status", progressPath: "$.progress", errorPath: "$.error.message" };
  return { auth: { type: "bearer" }, submit: { path: "/v1/videos", method: "POST", bodyMode: "json", idempotent: false,
    mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }, { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      ...["seconds", "resolution", "aspect_ratio", "images", "first_frame_image", "last_frame_image", "reference_videos", "reference_audios", "seed", "negative_prompt", "watermark", "prompt_optimizer", "callback_url", "metadata"].map(field => ({ target: `/${field}`, source: { kind: "request" as const, path: `$.parameters.${field}` }, omitIfUndefined: true, omitIfEmpty: true }))], response },
    poll: { path: "/v1/videos/{taskId}", method: "GET", bodyMode: "none", response }, pollIntervalMs: 5000,
    statusMap: { queued: "queued", in_progress: "running", unknown: "running", completed: "succeeded", failed: "failed" },
    output: { path: "$.content_url", fallbackPaths: ["$.video_url", "$.download_url", "$.result_url", "$.url"], kind: "video", defaultMimeType: "video/mp4",
      contentFallback: { path: "/v1/videos/{taskId}/content", alternatePaths: ["/v1/tasks/{taskId}/artifacts/video/content"] } } };
}

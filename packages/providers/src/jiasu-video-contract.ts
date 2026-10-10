import type { ModelDescriptor, ModelParameterDescriptor, NormalizedRequest, ProviderAssetInput, ValidationIssue } from "./contracts.js";
import type { RestModelConnectorOverride } from "./rest.js";
import { JIASU_VIDEO_CATALOG } from "./jiasu-video-catalog-data.js";

export const JIASU_VIDEO_DOCS = "https://aijiasu.apifox.cn/";
export const JIASU_VIDEO_QUERY_DOCS = "https://aijiasu.apifox.cn/api-511071739";
const specialMinimax = "minimax-h3-933-2k-支持真人";
type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const catalog = new Map(JIASU_VIDEO_CATALOG.map(row => [row.id, row]));
export const jiasuVideoModelIds = (): string[] => [...catalog.keys(), specialMinimax];

interface ResolutionEvidence {
  sourceUrl: string;
  group: string;
  modelId: string;
  endpoint: string;
  phase: "submit" | "poll";
  httpStatus: number;
  checkedAt: string;
  responseSha256: string;
  message: string;
  errorCode?: string;
  taskStatus?: string;
  allowedResolutions?: readonly string[];
  rejectedResolutions: readonly string[];
}
/** Actual supplier responses constrain generation, independently of price tiers. */
const vipResolutionEvidence: Readonly<Record<string, ResolutionEvidence>> = {
  "doubao-seedance-2-0-260128": {
    sourceUrl: "https://ai.jiasuapi.com", group: "vip", modelId: "doubao-seedance-2-0-260128", endpoint: "/v1/video/generations", phase: "submit", httpStatus: 400,
    checkedAt: "2026-10-09T23:21:37.325Z", responseSha256: "1a380f98d90ef10501d806698fa1fe26796f2e224b20f9d1d8084f73ce045159",
    message: "分辨率仅支持 720p", errorCode: "plugin_request_rejected", allowedResolutions: ["720p"], rejectedResolutions: ["480p", "1080p"],
  },
  "doubao-seedance-2-5-260628": {
    sourceUrl: "https://ai.jiasuapi.com", group: "vip", modelId: "doubao-seedance-2-5-260628", endpoint: "/v1/video/generations", phase: "submit", httpStatus: 400,
    checkedAt: "2026-10-09T23:21:37.664Z", responseSha256: "1a380f98d90ef10501d806698fa1fe26796f2e224b20f9d1d8084f73ce045159",
    message: "分辨率仅支持 720p", errorCode: "plugin_request_rejected", allowedResolutions: ["720p"], rejectedResolutions: ["480p", "1080p"],
  },
  "sd-2.5-J2": {
    sourceUrl: "https://ai.jiasuapi.com", group: "vip", modelId: "sd-2.5-J2", endpoint: "/v1/videos/tasks/{task_id}", phase: "poll", httpStatus: 200,
    checkedAt: "2026-10-09T23:21:51.965Z", responseSha256: "87e2b7fb88c50f49eb640e62addb2b8806164cb26724bbf5d291bd8e4530b13a",
    message: "resolution 480P is not supported for this video model", taskStatus: "failed", rejectedResolutions: ["480p"],
  },
};
function resolutionEvidence(id: string, model?: ModelDescriptor, group?: string): ResolutionEvidence | undefined {
  const currentGroup = group?.trim() || String(model?.metadata?.jiasuContractGroup ?? model?.metadata?.catalogGroup ?? "");
  const evidence = vipResolutionEvidence[id];
  return evidence?.group === currentGroup ? evidence : undefined;
}

/** Domain and root API version are part of this supplier's documented contract. */
export function isJiasuApiUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value));
    return url.origin === "https://ai.jiasuapi.com" && !url.username && !url.password && !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname);
  } catch { return false; }
}

/** A saved Key's group must agree with the model/price group on its connection. */
export function jiasuVideoGroupMismatch(config: Readonly<Record<string, unknown>> | undefined): boolean {
  return config?.accountKeyGroup !== undefined && config.modelGroup !== undefined && config.accountKeyGroup !== config.modelGroup;
}

function parseParameters(value: unknown): Row[] {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return []; } }
  return array(value).map(record).filter(row => typeof row.name === "string");
}
function declaration(id: string, model?: ModelDescriptor): { description: string; apiParameters: Row[] } | undefined {
  if (model?.metadata?.source === "manual" || model?.metadata?.protocolEvidence === "paid-test") return undefined;
  const live = record(model?.metadata?.jiasuCatalogRecord), snapshot = catalog.get(id);
  const endpoints = array(live.supportedEndpointTypes ?? model?.metadata?.endpointTypes ?? model?.metadata?.supported_endpoint_types);
  if (!snapshot && id !== specialMinimax && !endpoints.includes("openai-video")) return undefined;
  const description = model?.metadata?.jiasuCatalogDescription ?? live.description ?? snapshot?.description ?? "";
  return { description: typeof description === "string" ? description : "",
    apiParameters: parseParameters(model?.metadata?.jiasuApiParameters ?? live.apiParameters ?? snapshot?.apiParameters) };
}
export const isJiasuVideoModel = (id: string | undefined, model?: ModelDescriptor): boolean => Boolean(id && declaration(id, model));

const number = (value: unknown): number | undefined => {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const enumValues = (value: unknown): string[] => typeof value === "string" ? value.split(/[,，、]/u).map(value => value.trim()).filter(Boolean) : [];
function limitsFromDescription(description: string): Partial<NonNullable<ModelDescriptor["limits"]>> {
  const limits: Partial<NonNullable<ModelDescriptor["limits"]>> = {};
  for (const [kind, key] of [["(?:张)?(?:图片|参考图|图)", "maxInputImages"], ["(?:个|段)?(?:参考)?视频", "maxInputVideos"], ["(?:个|段)?(?:参考)?音频", "maxInputAudios"]] as const) {
    const match = new RegExp(`(\\d+)\\s*${kind}`, "u").exec(description);
    if (match) limits[key] = Number(match[1]);
  }
  return limits;
}
function declaredRange(parameters: Row[], key: string): Row | undefined { return parameters.find(parameter => parameter.name === key); }
function durationParameter(id: string, facts: { description: string; apiParameters: Row[] }): ModelParameterDescriptor {
  if (id === specialMinimax) return { key: "duration", label: "视频时长", control: "select", valueType: "integer", default: 15, options: [{ label: "15 秒", value: 15 }] };
  const declared = declaredRange(facts.apiParameters, "duration"), range = String(declared?.range ?? "");
  const proseRange = /(?:时长[：:]?\s*|支持|生成)?(\d+)\s*[-–]\s*(\d+)\s*秒/u.exec(facts.description);
  const match = /^(\d+)\s*[-–]\s*(\d+)(?:秒)?$/u.exec(range) ?? proseRange;
  const single = /^\d+(?:秒)?$/u.test(range) ? Number(range.replace("秒", "")) : undefined;
  const descriptor: ModelParameterDescriptor = { key: "duration", label: "视频时长", control: single !== undefined ? "select" : "number", valueType: "integer", min: match ? Number(match[1]) : 1, step: 1,
    ...(match ? { max: Number(match[2]) } : {}), ...(single !== undefined ? { options: [{ label: `${single} 秒`, value: single }] } : {}),
    ...(number(declared?.default) !== undefined ? { default: number(declared?.default)! } : {}), ...(declared?.required === true ? { required: true } : {}),
    description: declared ? String(declared.description ?? "供应商型号广场声明的时长。") : "可留空，由供应商使用该型号默认时长；未公布范围不套用其他渠道。" };
  if (id === "sd-2.0-mini-J1") {
    // The exact model description further restricts its otherwise 4–15 schema.
    descriptor.default = 12;
    descriptor.constraints = [{ when: [{ parameter: "resolution", values: ["720p"] }], max: 12 }, { when: [{ parameter: "resolution", values: ["480p"] }], max: 15 }];
  }
  return descriptor;
}
function resolutions(id: string, facts: { description: string; apiParameters: Row[] }): string[] {
  if (id === specialMinimax) return ["2k"];
  const declared = enumValues(declaredRange(facts.apiParameters, "resolution")?.range);
  if (declared.length) return declared;
  const explicit = [...facts.description.matchAll(/(?:480|720|1080|1440|2160)p\b/giu)].map(match => match[0].toLowerCase());
  return [...new Set(explicit)];
}

export function jiasuVideoModel(id: string, current?: ModelDescriptor, group?: string): ModelDescriptor | undefined {
  const facts = declaration(id, current); if (!facts) return undefined;
  const videoDescription = String(declaredRange(facts.apiParameters, "videos")?.description ?? "");
  const totalAssets = /(?:图片\+视频\+音频|图片、视频、音频)合计最多\s*(\d+)/u.exec(videoDescription);
  const totalVideo = /多条合计不超过\s*(\d+)\s*秒/u.exec(videoDescription);
  const refs = { ...limitsFromDescription(facts.description), ...(totalAssets ? { maxInputAssets: Number(totalAssets[1]) } : {}),
    ...(totalVideo ? { maxTotalInputVideoDurationSeconds: Number(totalVideo[1]) } : {}),
    ...(id === specialMinimax ? { maxInputImages: 9, maxInputVideos: 3, maxInputAudios: 3, maxInputAssets: 10, maxTotalInputVideoDurationSeconds: 15, maxPromptCharacters: 6000 } : {}) };
  const ratios = enumValues(declaredRange(facts.apiParameters, "ratio")?.range);
  const ratiosOrCommon = ratios.length ? ratios : ["16:9", "9:16", "1:1"];
  const declaredSizes = resolutions(id, facts), evidence = resolutionEvidence(id, current, group);
  const sizes = evidence?.allowedResolutions ? [...evidence.allowedResolutions] : declaredSizes.filter(size => !evidence?.rejectedResolutions.includes(size));
  const range = declaredRange(facts.apiParameters, "resolution"), duration = durationParameter(id, facts);
  const declaredDefault = String(range?.default ?? "");
  const defaultResolution = sizes.includes(declaredDefault) ? declaredDefault : sizes.includes("720p") ? "720p" : sizes[0];
  const parameters: ModelParameterDescriptor[] = [duration,
    { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: String(declaredRange(facts.apiParameters, "ratio")?.default ?? "16:9"), options: ratiosOrCommon.map(value => ({ label: value, value })) },
    { key: "resolution", label: "输出分辨率", control: sizes.length ? "select" : "text", valueType: "string",
      ...(sizes.length ? { default: defaultResolution!, options: sizes.map(value => ({ label: value, value })) } : { placeholder: "可留空，供应商默认 720p", description: "型号未公布枚举范围；按供应商通用合同提交，不套用其他渠道。" }),
      ...(evidence ? { description: evidence.allowedResolutions ? "当前佳速 vip 响应仅支持 720p；计费枚举不代表生成支持范围。" : "当前佳速 vip 的 480p 任务实际失败；保留官方报价，当前不可选择或提交 480p。720p/1080p 来自官方声明。" } : {}),
      ...(range?.required === true ? { required: true } : {}) },
  ];
  const supported = (kind: "image" | "video" | "audio") => refs[{ image: "maxInputImages", video: "maxInputVideos", audio: "maxInputAudios" }[kind] as keyof typeof refs] !== 0;
  const { jiasuResolutionEvidence: _previousEvidence, jiasuDeclaredResolutions: _previousDeclared, jiasuContractGroup: _previousGroup, ...currentMetadata } = current?.metadata ?? {};
  const currentGroup = group?.trim() || String(current?.metadata?.jiasuContractGroup ?? current?.metadata?.catalogGroup ?? "");
  return { ...current, id, name: current?.name ?? id, operations: supported("image") ? ["video.generate", "video.image-to-video"] : ["video.generate"], parameters,
    inputKinds: ["text", ...(supported("image") ? ["image" as const, "image[]" as const] : []), ...(supported("video") ? ["video" as const, "video[]" as const] : []), ...(supported("audio") ? ["audio" as const, "audio[]" as const] : [])], outputKinds: ["video"],
    limits: { ...current?.limits, ...refs }, metadata: { ...currentMetadata, supplier: "jiasu", modality: "video", catalogCapability: "video", operationsSource: "declared", outputKindsSource: "declared",
      protocol: "openai-videos", documentationUrl: id === specialMinimax ? "https://aijiasu.apifox.cn/api-520050937" : JIASU_VIDEO_DOCS,
      endpointPath: "/v1/video/generations", endpointMethod: "POST", parameterSource: "supplier-documented-contract", protocolEvidence: "supplier-documentation", generationVerified: false,
      videoContractCheckedAt: String(current?.metadata?.jiasuCatalogCheckedAt ?? "2026-10-09"), videoSupportedResolutions: sizes, videoMinDuration: duration.min, videoMaxDuration: duration.max,
      ...(currentGroup ? { jiasuContractGroup: currentGroup } : {}),
      ...(evidence ? { jiasuResolutionEvidence: evidence, jiasuDeclaredResolutions: declaredSizes } : {}),
      remoteMediaUrlsOnly: true, supportsFirstLastFrames: true, videoSupportsFirstLastFrames: true, allowFrameMediaMix: true,
      videoReferenceImageLimit: refs.maxInputImages, videoReferenceVideoLimit: refs.maxInputVideos, videoReferenceAudioLimit: refs.maxInputAudios,
      ...(id === specialMinimax || id === "minimax-h3" ? { referenceVideoObjects: true,
        ...(refs.maxTotalInputVideoDurationSeconds !== undefined ? { maxTotalInputVideoDurationSeconds: refs.maxTotalInputVideoDurationSeconds } : {}),
        ...(refs.maxInputAssets !== undefined ? { maxInputAssets: refs.maxInputAssets } : {}) } : {}),
      parameterControlsUnavailable: false, jiasuVideoContract: true } };
}

export function jiasuVideoTransport(): RestModelConnectorOverride {
  const response = { taskIdPath: "$.id", taskIdFallbackPaths: ["$.task_id", "$.data.id", "$.data.task_id"], statusPath: "$.status", statusFallbackPaths: ["$.data.status"], progressPath: "$.progress", errorPath: "$.error.message", errorFallbackPaths: ["$.data.error.message"] };
  return { auth: { type: "bearer" }, submit: { path: "/v1/video/generations", method: "POST", bodyMode: "json", idempotent: false,
    mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }, { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      ...["duration", "ratio", "resolution", "images", "videos", "audios", "materials", "face"].map(field => ({ target: `/${field}`, source: { kind: "request" as const, path: `$.parameters.${field}` }, omitIfUndefined: true, omitIfEmpty: true }))], response },
    poll: { path: "/v1/videos/tasks/{taskId}", method: "GET", bodyMode: "none", response }, pollIntervalMs: 3000,
    statusMap: { queued: "queued", in_progress: "running", unknown: "running", completed: "succeeded", failed: "failed" },
    output: { path: "$.result_urls", fallbackPaths: ["$.data.result_urls", "$.url", "$.data.url"], kind: "video", urlPath: "url", defaultMimeType: "video/mp4", requireOutput: true } };
}

const assetUrl = (asset: ProviderAssetInput) => asset.role === "firstFrame" || asset.role === "lastFrame" ? { url: asset.url, type: asset.role === "firstFrame" ? "first_frame" : "end_frame" } : asset.url;
/** Keep names and order: the supplier uses them to resolve @material references. */
export function normalizeJiasuVideoParameters(request: NormalizedRequest, model?: ModelDescriptor, group?: string): Record<string, unknown> {
  const source = request.parameters ?? {}, p: Row = {};
  const descriptor = jiasuVideoModel(request.model ?? "", model, group);
  const defaults = Object.fromEntries((descriptor?.parameters ?? []).filter(parameter => parameter.default !== undefined).map(parameter => [parameter.key, parameter.default]));
  const duration = source.duration ?? source.seconds ?? defaults.duration;
  if (duration !== undefined) p.duration = duration;
  const ratio = source.aspect_ratio ?? source.ratio ?? defaults.aspect_ratio;
  if (ratio !== undefined) p.ratio = ratio;
  const resolution = source.resolution ?? defaults.resolution;
  if (resolution !== undefined && resolution !== "") p.resolution = resolution;
  for (const [kind, field] of [["image", "images"], ["video", "videos"], ["audio", "audios"]] as const) {
    const native = array(source[field]);
    const known = new Set(native.map(item => typeof item === "string" ? item : record(item).url));
    const values = [...native, ...(request.assets ?? []).filter(asset => asset.kind === kind && !known.has(asset.url)).map(asset => {
      if (kind === "video" && (request.model === specialMinimax || request.model === "minimax-h3")) return { url: asset.url, duration_seconds: asset.durationSeconds };
      return assetUrl(asset);
    })];
    if (values.length) p[field] = values;
  }
  for (const field of ["materials", "face"] as const) if (source[field] !== undefined) p[field] = source[field];
  return p;
}

function publicHttps(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password &&
    !/^(?:localhost$|127\.|0\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[(?:::1\]|f[cd][\da-f]*:|fe80:))/iu.test(url.hostname) &&
    !url.hostname.endsWith(".local") && !url.hostname.endsWith(".localhost") && !/^\/v1\/files(?:\/|$)/u.test(url.pathname); } catch { return false; }
}
export function jiasuVideoRequestIssues(request: NormalizedRequest, model?: ModelDescriptor, group?: string): ValidationIssue[] {
  const descriptor = jiasuVideoModel(request.model ?? "", model, group); if (!descriptor) return [];
  const issues: ValidationIssue[] = [], add = (path: string, message: string) => issues.push({ path, code: "invalid_parameter", message });
  const source = request.parameters ?? {}, p = normalizeJiasuVideoParameters(request, model, group);
  const evidence = resolutionEvidence(request.model ?? "", model, group);
  if (!request.operation.startsWith("video.")) add("operation", "此佳速型号只支持视频生成。");
  if (source.duration !== undefined && source.seconds !== undefined && source.duration !== source.seconds) add("parameters.duration", "duration 与 seconds 不能冲突。");
  if (source.aspect_ratio !== undefined && source.ratio !== undefined && source.aspect_ratio !== source.ratio) add("parameters.aspect_ratio", "aspect_ratio 与 ratio 不能冲突。");
  for (const key of Object.keys(source)) if (!["duration", "seconds", "aspect_ratio", "ratio", "resolution", "images", "videos", "audios", "materials", "face"].includes(key)) add(`parameters.${key}`, `佳速合同未声明参数 ${key}；首尾帧请连接图片素材并选择对应角色。`);
  const duration = descriptor.parameters?.find(parameter => parameter.key === "duration"), seconds = p.duration;
  if (seconds !== undefined && (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < (duration?.min ?? 1) || duration?.max !== undefined && seconds > duration.max || duration?.options?.length && !duration.options.some(option => option.value === seconds))) add("parameters.duration", "请选择该型号声明范围内的整数秒数。");
  if (request.model === "sd-2.0-mini-J1" && p.resolution === "720p" && typeof seconds === "number" && seconds > 12) add("parameters.duration", "此型号 720p 最长 12 秒；480p 最长 15 秒。");
  for (const [key, value] of [["aspect_ratio", p.ratio], ["resolution", p.resolution]] as const) {
    const options = descriptor.parameters?.find(parameter => parameter.key === key)?.options;
    if (value !== undefined && (typeof value !== "string" || options?.length && !options.some(option => option.value === value) || key === "resolution" && evidence?.rejectedResolutions.includes(String(value))))
      add(`parameters.${key}`, key === "resolution" && evidence && (evidence.allowedResolutions || evidence.rejectedResolutions.includes(String(value))) ? evidence.allowedResolutions ? "当前佳速 vip 此型号实际响应仅支持 720p，计费枚举中的其他分辨率不能用于生成。" : "当前佳速 vip 此型号 480p 任务实际失败，已禁止再次提交此分辨率；官方 480p 报价保留用于核对。" : "参数不在当前佳速型号公布的枚举内。");
  }
  const counts = { image: 0, video: 0, audio: 0 }, frames = { first_frame: 0, end_frame: 0 };
  let videoSeconds = 0;
  const check = (item: unknown, kind: "image" | "video" | "audio", path: string) => {
    const row = record(item), url = typeof item === "string" ? item : row.url;
    counts[kind]++;
    if (!publicHttps(url)) add(path, "佳速参考素材必须使用公网 HTTPS 地址。");
    if (row.name !== undefined && (typeof row.name !== "string" || !row.name.trim())) add(path, "素材 name 必须是非空文字。");
    if (row.type !== undefined && path !== "parameters.materials") {
      if (kind !== "image" || !["first_frame", "end_frame"].includes(String(row.type))) add(path, "只有 images 可用 type=first_frame/end_frame 指定首尾帧。");
      else frames[row.type as keyof typeof frames]++;
    }
    if (kind === "video" && (request.model === specialMinimax || request.model === "minimax-h3")) {
      if (row.duration_seconds === undefined && request.model === "minimax-h3") videoSeconds += 5;
      else if (typeof row.duration_seconds !== "number" || !Number.isFinite(row.duration_seconds) || row.duration_seconds <= 0) add(path, "MiniMax 参考视频必须提供与实际时长一致的正数 duration_seconds。");
      else videoSeconds += row.duration_seconds;
    }
  };
  for (const [kind, field] of [["image", "images"], ["video", "videos"], ["audio", "audios"]] as const) {
    if (source[field] !== undefined && !Array.isArray(source[field])) add(`parameters.${field}`, "参考素材必须为数组。");
    for (const item of array(p[field])) check(item, kind, `parameters.${field}`);
  }
  if (source.materials !== undefined && !Array.isArray(source.materials)) add("parameters.materials", "materials 必须为素材对象数组。");
  for (const item of array(p.materials)) {
    const row = record(item);
    if (!["image", "video", "audio"].includes(String(row.type))) add("parameters.materials", "materials 类型仅支持 image/video/audio。");
    else check(item, row.type as keyof typeof counts, "parameters.materials");
  }
  for (const [kind, limit] of [["image", descriptor.limits?.maxInputImages], ["video", descriptor.limits?.maxInputVideos], ["audio", descriptor.limits?.maxInputAudios]] as const)
    if (limit !== undefined && counts[kind] > limit) add("assets", `当前佳速型号最多接受 ${limit} 个${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}素材。`);
  if (frames.first_frame > 1 || frames.end_frame > 1) add("assets", "首帧和尾帧分别最多一张。");
  if ((frames.first_frame > 0 || frames.end_frame > 0) && counts.audio > 0)
    add("assets", "佳速首尾帧生成不能同时使用参考音频，包括 audios 或 materials 中的 audio。");
  if (descriptor.limits?.maxInputAssets !== undefined && Object.values(counts).reduce((sum, count) => sum + count, 0) > descriptor.limits.maxInputAssets) add("assets", `此型号所有参考素材合计最多 ${descriptor.limits.maxInputAssets} 个。`);
  if (descriptor.limits?.maxTotalInputVideoDurationSeconds !== undefined && videoSeconds > descriptor.limits.maxTotalInputVideoDurationSeconds) add("assets", `此型号参考视频累计最多 ${descriptor.limits.maxTotalInputVideoDurationSeconds} 秒。`);
  if (p.face !== undefined) {
    const face = record(p.face);
    if (!Object.keys(face).length || face.enabled !== undefined && typeof face.enabled !== "boolean" || face.mode !== undefined && typeof face.mode !== "string" || Object.keys(face).some(key => !["enabled", "mode"].includes(key))) add("parameters.face", "face 必须使用 {enabled:boolean, mode?:string} 对象。");
    if (face.mode !== undefined && !["light", "heavy"].includes(String(face.mode)))
      add("parameters.face.mode", "佳速人脸处理 mode 只支持 light 或 heavy。");
    if (face.enabled === true && face.mode === undefined)
      add("parameters.face.mode", "启用佳速人脸处理时必须选择 light 或 heavy 模式。");
  }
  for (const asset of request.assets ?? []) if (asset.role === "mask" || asset.kind !== "image" && asset.role && asset.role !== "reference") add("assets", "佳速视频素材角色只支持参考素材以及图片首尾帧。");
  return issues;
}

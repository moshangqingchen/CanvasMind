import type { ModelDescriptor, ModelParameterDescriptor, NormalizedRequest, ProviderAssetInput, ValidationIssue } from "./contracts.js";
import type { RestModelConnectorOverride } from "./rest.js";
import { JIASU_VIDEO_CATALOG } from "./jiasu-video-catalog-data.js";
import { jiasuVideoApiExampleContract, latestJiasuVideoApiExampleContract, type JiasuVideoApiExampleContract } from "./jiasu-api-example-contract.js";
export { latestJiasuVideoApiExampleContract } from "./jiasu-api-example-contract.js";
import { seedanceDurationFallback, seedanceDurationFallbackDescription, seedanceDurationFallbackMetadata } from "./seedance-duration-fallback.js";

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
function declaration(id: string, model?: ModelDescriptor): { description: string; apiParameters: Row[]; apiExampleContract?: JiasuVideoApiExampleContract } | undefined {
  if (["manual", "paid-test"].includes(String(model?.metadata?.source)) || model?.metadata?.protocolEvidence === "paid-test") return undefined;
  const live = record(model?.metadata?.jiasuCatalogRecord), snapshot = catalog.get(id);
  const endpoints = array(live.supportedEndpointTypes ?? model?.metadata?.endpointTypes ?? model?.metadata?.supported_endpoint_types);
  if (!snapshot && id !== specialMinimax && !endpoints.includes("openai-video")) return undefined;
  const description = model?.metadata?.jiasuCatalogDescription ?? live.description ?? snapshot?.description ?? "";
  const example = latestJiasuVideoApiExampleContract(id, model?.metadata?.jiasuApiExampleContract, live.apiExampleContract)
    ?? (id === specialMinimax ? undefined : jiasuVideoApiExampleContract(id));
  return { description: typeof description === "string" ? description : "",
    apiParameters: parseParameters(model?.metadata?.jiasuApiParameters ?? live.apiParameters ?? snapshot?.apiParameters),
    ...(example ? { apiExampleContract: example } : {}) };
}
export const isJiasuVideoModel = (id: string | undefined, model?: ModelDescriptor): boolean => Boolean(id && declaration(id, model));

const number = (value: unknown): number | undefined => {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const enumValues = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()).map(item => item.trim())
  : typeof value === "string" ? value.split(/[,，、]/u).map(value => value.trim()).filter(Boolean) : [];
function limitsFromDescription(description: string): Partial<NonNullable<ModelDescriptor["limits"]>> {
  const limits: Partial<NonNullable<ModelDescriptor["limits"]>> = {};
  for (const [kind, key] of [["(?:张)?(?:图片|参考图|图)", "maxInputImages"], ["(?:个|段)?(?:参考)?视频", "maxInputVideos"], ["(?:个|段)?(?:参考)?音频", "maxInputAudios"]] as const) {
    const match = new RegExp(`(\\d+)\\s*${kind}`, "u").exec(description);
    if (match) limits[key] = Number(match[1]);
  }
  return limits;
}
function declaredRange(parameters: Row[], key: string): Row | undefined { return parameters.find(parameter => parameter.name === key); }
const baseWireFields = ["duration", "ratio", "resolution", "images", "videos", "audios", "materials", "face"] as const;
function additionalDeclarations(parameters: Row[]): Row[] {
  return parameters.filter(parameter => typeof parameter.name === "string" && /^[a-zA-Z][a-zA-Z\d_]{0,63}$/u.test(parameter.name) &&
    !["model", "prompt", "aspect_ratio", "seconds", ...baseWireFields].includes(parameter.name));
}
function declaredScalarParameter(row: Row): ModelParameterDescriptor | undefined {
  const type = String(row.type ?? "string").toLowerCase(), numeric = ["number", "integer", "int", "float"].includes(type), boolean = ["boolean", "bool"].includes(type);
  if (["object", "array"].includes(type)) return undefined;
  const key = String(row.name), valueType = numeric ? type === "integer" || type === "int" ? "integer" : "number" : boolean ? "boolean" : "string";
  const explicitOptions = row.enum ?? (typeof row.range === "string" && !/^\d+\s*[-–]\s*\d+(?:秒)?$/u.test(row.range) ? row.range : undefined);
  const rawValues = Array.isArray(explicitOptions) ? explicitOptions.filter(value => ["string", "number", "boolean"].includes(typeof value)) : enumValues(explicitOptions);
  const values = rawValues.map(value => numeric ? number(value) : boolean ? value === true || value === "true" ? true : value === false || value === "false" ? false : undefined : typeof value === "string" ? value : undefined)
    .filter((value): value is string | number | boolean => value !== undefined);
  const interval = typeof row.range === "string" ? /^(\d+)\s*[-–]\s*(\d+)$/u.exec(row.range) : undefined;
  const min = numeric ? number(row.min ?? row.minimum ?? interval?.[1]) : undefined, max = numeric ? number(row.max ?? row.maximum ?? interval?.[2]) : undefined;
  const rawDefault = row.default, defaultValue = numeric ? number(rawDefault) : boolean ? rawDefault === true || rawDefault === "true" ? true : rawDefault === false || rawDefault === "false" ? false : undefined : typeof rawDefault === "string" ? rawDefault : undefined;
  const validDefault = defaultValue !== undefined && (!values.length || values.includes(defaultValue)) &&
    (typeof defaultValue !== "number" || (valueType !== "integer" || Number.isInteger(defaultValue)) && (min === undefined || defaultValue >= min) && (max === undefined || defaultValue <= max));
  return { key, label: key, control: values.length ? "select" : numeric ? "number" : boolean ? "toggle" : "text", valueType,
    ...(values.length ? { options: values.map(value => ({ label: String(value), value })) } : { allowCustomValue: true }),
    ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(number(row.step) !== undefined ? { step: number(row.step)! } : {}),
    ...(validDefault ? { default: defaultValue } : {}), ...(row.required === true ? { required: true } : {}),
    ...(typeof row.description === "string" ? { description: row.description } : {}) };
}
function durationParameter(id: string, facts: { description: string; apiParameters: Row[] }): ModelParameterDescriptor {
  if (id === specialMinimax) return { key: "duration", label: "视频时长", control: "select", valueType: "integer", default: 15, options: [{ label: "15 秒", value: 15 }] };
  const declared = declaredRange(facts.apiParameters, "duration"), range = String(declared?.enum ?? declared?.range ?? "");
  const proseRange = /(?:时长[：:]?\s*|支持|生成)?(\d+)\s*[-–]\s*(\d+)\s*秒/u.exec(facts.description);
  const match = /^(\d+)\s*[-–~～]\s*(\d+)(?:秒)?$/u.exec(range) ?? proseRange;
  const values = enumValues(range);
  const options = values.length && values.every(value => /^\d+(?:秒)?$/u.test(value))
    ? [...new Set(values.map(value => Number(value.replace("秒", ""))))].filter(value => value > 0) : [];
  const lower = /^(?:>=|≥)\s*(\d+)(?:秒)?$/u.exec(range), upper = /^(?:<=|≤)\s*(\d+)(?:秒)?$/u.exec(range);
  const min = match ? Number(match[1]) : number(declared?.min ?? declared?.minimum ?? lower?.[1]);
  const max = match ? Number(match[2]) : number(declared?.max ?? declared?.maximum ?? upper?.[1]);
  const bounded = min !== undefined && max !== undefined && min > 0 && max >= min;
  const defaultValue = number(declared?.default);
  const validDefault = defaultValue !== undefined && Number.isInteger(defaultValue) && defaultValue > 0 &&
    (!options.length || options.includes(defaultValue)) && (min === undefined || defaultValue >= min) && (max === undefined || defaultValue <= max);
  const descriptor: ModelParameterDescriptor = { key: "duration", label: "视频时长", control: options.length ? "select" : "number", valueType: "integer", step: 1,
    ...(!options.length && !bounded ? { allowCustomValue: true } : {}),
    ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(options.length ? { options: options.map(value => ({ label: `${value} 秒`, value })) } : {}),
    ...(validDefault ? { default: defaultValue } : {}), ...(declared?.required === true ? { required: true } : {}),
    description: bounded || options.length ? String(declared?.description ?? "供应商型号广场声明的时长。")
      : "按供应商 API 字段发送输入的整数秒数；完整范围未列出时由供应商校验。留空使用供应商默认。" };
  if (id === "sd-2.0-mini-J1") {
    // The exact model description further restricts its otherwise 4–15 schema.
    descriptor.default = 12;
    descriptor.constraints = [{ when: [{ parameter: "resolution", values: ["720p"] }], max: 12 }, { when: [{ parameter: "resolution", values: ["480p"] }], max: 15 }];
  }
  return descriptor;
}
function resolutions(id: string, facts: { description: string; apiParameters: Row[] }): string[] {
  if (id === specialMinimax) return ["2k"];
  const parameter = declaredRange(facts.apiParameters, "resolution"), declared = enumValues(parameter?.enum ?? parameter?.range);
  if (declared.length) return declared;
  const explicit = [...facts.description.matchAll(/(?:480|720|1080|1440|2160)p\b/giu)].map(match => match[0].toLowerCase());
  return [...new Set(explicit)];
}

export function jiasuVideoModel(id: string, current?: ModelDescriptor, group?: string): ModelDescriptor | undefined {
  const facts = declaration(id, current); if (!facts) return undefined;
  const currentGroup = group?.trim() || String(current?.metadata?.jiasuContractGroup ?? current?.metadata?.catalogGroup ?? "");
  const videoDescription = String(declaredRange(facts.apiParameters, "videos")?.description ?? "");
  const totalAssets = /(?:图片\+视频\+音频|图片、视频、音频)合计最多\s*(\d+)/u.exec(videoDescription);
  const totalVideo = /多条合计不超过\s*(\d+)\s*秒/u.exec(videoDescription);
  const refs = { ...limitsFromDescription(facts.description), ...(totalAssets ? { maxInputAssets: Number(totalAssets[1]) } : {}),
    ...(totalVideo ? { maxTotalInputVideoDurationSeconds: Number(totalVideo[1]) } : {}),
    ...(id === specialMinimax ? { maxInputImages: 9, maxInputVideos: 3, maxInputAudios: 3, maxInputAssets: 10, maxTotalInputVideoDurationSeconds: 15, maxPromptCharacters: 6000 } : {}) };
  const ratioDeclaration = declaredRange(facts.apiParameters, "ratio"), ratios = enumValues(ratioDeclaration?.enum ?? ratioDeclaration?.range);
  const ratiosOrCommon = ratios.length ? ratios : ["16:9", "9:16", "1:1"];
  const declaredSizes = resolutions(id, facts), evidence = resolutionEvidence(id, current, group);
  const sizes = evidence?.allowedResolutions ? [...evidence.allowedResolutions] : declaredSizes.filter(size => !evidence?.rejectedResolutions.includes(size));
  const range = declaredRange(facts.apiParameters, "resolution"), declaredDuration = durationParameter(id, facts);
  const durationFallback = seedanceDurationFallback(id, { min: declaredDuration.min, max: declaredDuration.max,
    values: declaredDuration.options?.map(option => option.value), default: declaredDuration.default });
  const duration = durationFallback ? { ...declaredDuration, min: durationFallback.min, max: durationFallback.max, allowCustomValue: false,
    description: seedanceDurationFallbackDescription(durationFallback) } : declaredDuration;
  if (currentGroup === "vip" && ["wan-3.0-特惠", "wan-3.0-特惠-1"].includes(id)) {
    const ranges = [...facts.description.matchAll(/\|\s*`?(480p|720p)`?\s*\|\s*(\d+)\s*[-–]\s*(\d+)\s*秒/giu)]
      .filter(match => Number(match[2]) > 0 && Number(match[3]) >= Number(match[2]));
    if (ranges.length) {
      duration.constraints = ranges.map(match => ({ when: [{ parameter: "resolution", values: [match[1]!.toLowerCase()] }], min: Number(match[2]), max: Number(match[3]) }));
      const declaredResolution = String(declaredRange(facts.apiParameters, "resolution")?.default ?? "").toLowerCase();
      const selected = duration.constraints.find(constraint => constraint.when[0]?.values.includes(declaredResolution));
      if (typeof duration.default === "number" && selected && (duration.default < selected.min! || duration.default > selected.max!)) delete duration.default;
      // The current published default5 conflicts with 720p10–20; require a
      // deliberate legal value instead of silently injecting/changing it.
      if (duration.default === undefined) duration.required = true;
      duration.description = "当前 vip 分组说明：480p 为 15–30 秒，720p 为 10–20 秒；分辨率条件优先于通用 duration 范围。旧值保留，请选择合法组合。";
    }
  }
  const declaredDefault = typeof range?.default === "string" ? range.default.trim() : "";
  const defaultResolution = sizes.includes(declaredDefault) ? declaredDefault : sizes.includes("720p") ? "720p" : sizes[0];
  const exampleResolution = typeof facts.apiExampleContract?.values.resolution === "string" ? facts.apiExampleContract.values.resolution : undefined;
  const resolutionExamples = exampleResolution ? [exampleResolution] : [];
  const confirmedDefaults: { duration?: number; resolution?: string } = {};
  if (duration.default !== undefined && duration.default === number(declaredRange(facts.apiParameters, "duration")?.default))
    confirmedDefaults.duration = duration.default as number;
  if (declaredDefault && !/[\u0000-\u001f\u007f]/u.test(declaredDefault) &&
      (sizes.length ? sizes.includes(declaredDefault) : !evidence?.rejectedResolutions.includes(declaredDefault)))
    confirmedDefaults.resolution = declaredDefault;
  const parameters: ModelParameterDescriptor[] = [duration,
    { key: "aspect_ratio", label: "画面比例", control: ratios.length ? "select" : "text", valueType: "string",
      ...(!ratios.length ? { allowCustomValue: true } : {}),
      default: String(ratioDeclaration?.default ?? "16:9"), options: ratiosOrCommon.map(value => ({ label: value, value })) },
    { key: "resolution", label: "输出分辨率", control: "select", valueType: "string",
      ...(sizes.length ? { default: defaultResolution!, options: sizes.map(value => ({ label: value, value })) } : {
        control: "text" as const, allowCustomValue: true,
        options: [...new Set([...resolutionExamples, ...(confirmedDefaults.resolution ? [confirmedDefaults.resolution] : [])])]
          .map(value => ({ label: value === confirmedDefaults.resolution ? `${value}（供应商默认）` : `${value}（API 示例）`, value })),
        ...(confirmedDefaults.resolution ? { default: confirmedDefaults.resolution } : {}),
        ...(exampleResolution ? { placeholder: exampleResolution } : {}),
        description: "按供应商 API 字段发送输入的分辨率；API 示例仅列出示例值，其他输入由供应商校验。留空使用供应商默认。" }),
      ...(evidence ? { description: evidence.allowedResolutions ? "当前佳速 vip 响应仅支持 720p；计费枚举不代表生成支持范围。" : "当前佳速 vip 的 480p 任务实际失败；保留官方报价，当前不可选择或提交 480p。720p/1080p 来自官方声明。" } : {}),
      ...(range?.required === true ? { required: true } : {}) },
  ];
  parameters.push(...additionalDeclarations(facts.apiParameters).flatMap(row => { const parameter = declaredScalarParameter(row); return parameter ? [parameter] : []; }));
  const supported = (kind: "image" | "video" | "audio") => refs[{ image: "maxInputImages", video: "maxInputVideos", audio: "maxInputAudios" }[kind] as keyof typeof refs] !== 0;
  const { jiasuResolutionEvidence: _previousEvidence, jiasuDeclaredResolutions: _previousDeclared, jiasuContractGroup: _previousGroup,
    durationRangeUnverified: _previousDurationRange, resolutionRangeUnverified: _previousResolutionRange,
    videoResolutionAllowsCustom: _previousCustomResolution, videoResolutionExampleValues: _previousResolutionExamples,
    jiasuApiExampleContract: _previousExampleContract,
    durationRangeSource: _previousDurationSource, durationRangeFallbackFamily: _previousDurationFamily,
    userFallbackDurationRange: _previousDurationFallback,
    videoParameterConfirmedDefaults: _previousConfirmedDefaults, ...currentMetadata } = current?.metadata ?? {};
  return { ...current, id, name: current?.name ?? id, operations: supported("image") ? ["video.generate", "video.image-to-video"] : ["video.generate"], parameters,
    inputKinds: ["text", ...(supported("image") ? ["image" as const, "image[]" as const] : []), ...(supported("video") ? ["video" as const, "video[]" as const] : []), ...(supported("audio") ? ["audio" as const, "audio[]" as const] : [])], outputKinds: ["video"],
    limits: { ...current?.limits, ...refs }, metadata: { ...currentMetadata, supplier: "jiasu", modality: "video", catalogCapability: "video", operationsSource: "declared", outputKindsSource: "declared",
      protocol: "openai-videos", documentationUrl: id === specialMinimax ? "https://aijiasu.apifox.cn/api-520050937" : JIASU_VIDEO_DOCS,
      endpointPath: facts.apiExampleContract?.submitPath ?? "/v1/video/generations", endpointMethod: "POST", parameterSource: "supplier-documented-contract", protocolEvidence: "supplier-documentation", generationVerified: false,
      videoContractCheckedAt: String(current?.metadata?.jiasuCatalogCheckedAt ?? "2026-10-09"), videoSupportedResolutions: sizes, videoMinDuration: duration.min, videoMaxDuration: duration.max,
      ...(!duration.options?.length && (duration.min === undefined || duration.max === undefined) ? { durationRangeUnverified: true } : {}),
      ...seedanceDurationFallbackMetadata(durationFallback),
      ...(!sizes.length ? { resolutionRangeUnverified: true } : {}),
      ...(!sizes.length ? { videoResolutionAllowsCustom: true } : {}),
      ...(resolutionExamples.length ? { videoResolutionExampleValues: resolutionExamples } : {}),
      ...(facts.apiExampleContract ? { jiasuApiExampleContract: facts.apiExampleContract } : {}),
      ...(Object.keys(confirmedDefaults).length ? { videoParameterConfirmedDefaults: confirmedDefaults } : {}),
      ...(currentGroup ? { jiasuContractGroup: currentGroup } : {}),
      ...(evidence ? { jiasuResolutionEvidence: evidence, jiasuDeclaredResolutions: declaredSizes } : {}),
      remoteMediaUrlsOnly: true, supportsFirstLastFrames: true, videoSupportsFirstLastFrames: true, allowFrameMediaMix: true,
      videoReferenceImageLimit: refs.maxInputImages, videoReferenceVideoLimit: refs.maxInputVideos, videoReferenceAudioLimit: refs.maxInputAudios,
      ...(id === specialMinimax || id === "minimax-h3" ? { referenceVideoObjects: true,
        ...(refs.maxTotalInputVideoDurationSeconds !== undefined ? { maxTotalInputVideoDurationSeconds: refs.maxTotalInputVideoDurationSeconds } : {}),
        ...(refs.maxInputAssets !== undefined ? { maxInputAssets: refs.maxInputAssets } : {}) } : {}),
      parameterControlsUnavailable: false, jiasuVideoContract: true } };
}

export function jiasuVideoTransport(model?: ModelDescriptor): RestModelConnectorOverride {
  const facts = model ? declaration(model.id, model) : undefined;
  const fields = [...baseWireFields, ...additionalDeclarations(facts?.apiParameters ?? []).map(row => String(row.name))];
  const response = { taskIdPath: "$.id", taskIdFallbackPaths: ["$.task_id", "$.data.id", "$.data.task_id"], statusPath: "$.status", statusFallbackPaths: ["$.data.status"], progressPath: "$.progress", errorPath: "$.error.message", errorFallbackPaths: ["$.data.error.message"] };
  return { auth: { type: "bearer" }, submit: { path: facts?.apiExampleContract?.submitPath ?? "/v1/video/generations", method: "POST", bodyMode: "json", idempotent: false,
    mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }, { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      ...fields.map(field => ({ target: `/${field}`, source: { kind: "request" as const, path: `$.parameters.${field}` }, omitIfUndefined: true,
        omitIfEmpty: (baseWireFields as readonly string[]).includes(field) }))], response },
    poll: { path: facts?.apiExampleContract?.pollPath.replace("{task_id}", "{taskId}") ?? "/v1/videos/tasks/{taskId}", method: "GET", bodyMode: "none", response }, pollIntervalMs: 3000,
    statusMap: { queued: "queued", in_progress: "running", unknown: "running", completed: "succeeded", failed: "failed" },
    output: { path: "$.result_urls", fallbackPaths: ["$.data.result_urls", "$.url", "$.data.url"], kind: "video", urlPath: "url", defaultMimeType: "video/mp4", requireOutput: true } };
}

const assetUrl = (asset: ProviderAssetInput) => asset.role === "firstFrame" || asset.role === "lastFrame" ? { url: asset.url, type: asset.role === "firstFrame" ? "first_frame" : "end_frame" } : asset.url;
/** Keep names and order: the supplier uses them to resolve @material references. */
export function normalizeJiasuVideoParameters(request: NormalizedRequest, model?: ModelDescriptor, group?: string): Record<string, unknown> {
  const source = request.parameters ?? {}, p: Row = {};
  const descriptor = jiasuVideoModel(request.model ?? "", model, group);
  const defaults = Object.fromEntries((descriptor?.parameters ?? []).filter(parameter => parameter.default !== undefined).map(parameter => [parameter.key, parameter.default]));
  const duration = source.duration !== undefined ? source.duration : source.seconds !== undefined ? source.seconds : defaults.duration;
  if (duration !== undefined) p.duration = duration;
  const ratio = source.aspect_ratio !== undefined ? source.aspect_ratio : source.ratio !== undefined ? source.ratio : defaults.aspect_ratio;
  if (ratio !== undefined) p.ratio = ratio;
  const resolution = source.resolution !== undefined ? source.resolution : defaults.resolution;
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
  for (const row of additionalDeclarations(declaration(request.model ?? "", model)?.apiParameters ?? [])) {
    const field = String(row.name), value = source[field] !== undefined ? source[field] : defaults[field];
    if (value !== undefined) p[field] = value;
  }
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
  const extraFields = additionalDeclarations(declaration(request.model ?? "", model)?.apiParameters ?? []);
  for (const key of Object.keys(source)) if (!["seconds", "aspect_ratio", ...baseWireFields, ...extraFields.map(row => String(row.name))].includes(key)) add(`parameters.${key}`, `佳速合同未声明参数 ${key}；首尾帧请连接图片素材并选择对应角色。`);
  for (const row of extraFields) {
    const key = String(row.name), value = p[key], type = String(row.type ?? "string").toLowerCase(), parameter = declaredScalarParameter(row);
    if (value === undefined) { if (row.required === true) add(`parameters.${key}`, `供应商要求填写 ${key}。`); continue; }
    const typeValid = ["integer", "int"].includes(type) ? typeof value === "number" && Number.isInteger(value)
      : ["number", "float"].includes(type) ? typeof value === "number" && Number.isFinite(value)
      : ["boolean", "bool"].includes(type) ? typeof value === "boolean"
      : type === "array" ? Array.isArray(value) : type === "object" ? !!value && typeof value === "object" && !Array.isArray(value) : typeof value === "string";
    if (!typeValid || parameter?.options?.length && !parameter.options.some(option => option.value === value) ||
        typeof value === "number" && (parameter?.min !== undefined && value < parameter.min || parameter?.max !== undefined && value > parameter.max) ||
        Array.isArray(value) && (number(row.minItems) !== undefined && value.length < number(row.minItems)! || number(row.maxItems) !== undefined && value.length > number(row.maxItems)!))
      add(`parameters.${key}`, `${key} 不符合当前完整型号声明的类型或范围。`);
  }
  const duration = descriptor.parameters?.find(parameter => parameter.key === "duration"), seconds = p.duration;
  if (duration?.required && seconds === undefined) add("parameters.duration", "请填写当前分辨率对应的合法整数秒数。");
  if (seconds !== undefined && (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < (duration?.min ?? 1) || duration?.max !== undefined && seconds > duration.max || duration?.options?.length && !duration.options.some(option => option.value === seconds))) add("parameters.duration", "请选择该型号声明范围内的整数秒数。");
  for (const constraint of duration?.constraints ?? []) {
    if (constraint.when.every(condition => condition.values.includes(p[condition.parameter] as string | number | boolean)) && typeof seconds === "number" &&
      (constraint.min !== undefined && seconds < constraint.min || constraint.max !== undefined && seconds > constraint.max))
      add("parameters.duration", `当前 ${String(p.resolution)} 对应时长为 ${constraint.min}–${constraint.max} 秒；原值已保留，请改选合法组合。`);
  }
  if (request.model === "sd-2.0-mini-J1" && p.resolution === "720p" && typeof seconds === "number" && seconds > 12) add("parameters.duration", "此型号 720p 最长 12 秒；480p 最长 15 秒。");
  for (const [key, value] of [["aspect_ratio", p.ratio], ["resolution", p.resolution]] as const) {
    const parameter = descriptor.parameters?.find(parameter => parameter.key === key), options = parameter?.options;
    if (value !== undefined && (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value) ||
      parameter?.allowCustomValue !== true && options?.length && !options.some(option => option.value === value) ||
      key === "resolution" && evidence?.rejectedResolutions.includes(String(value))))
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

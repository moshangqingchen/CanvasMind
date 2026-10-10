import type { ModelDescriptor, ModelParameterDescriptor, NormalizedRequest, ValidationIssue } from "./contracts.js";
import type { ImageEditingConnection } from "./image-editing-capabilities.js";

export const JIASU_IMAGE_MODELS = ["gpt-image-2-1k", "gpt-image-2-2k", "gpt-image-2-4k", "gpt-image-2-high",
  "gpt-image-2.5-1k", "gpt-image-2.5-flare-1k", "gpt-image-2.5-flare-4k", "gpt-image-2.5-sunburst-1k", "gpt-image-2.5-sunburst-4k"] as const;
export const JIASU_RESOLUTION_IMAGE_MODELS: readonly string[] = ["gpt-image-2.5-1k", "gpt-image-2.5-sunburst-1k"];
export const JIASU_ASYNC_IMAGE_MODELS: readonly string[] = JIASU_IMAGE_MODELS;
export const JIASU_IMAGE_RATIOS = ["1:1", "16:9", "9:16", "3:4", "4:3"] as const;
export const JIASU_IMAGE_DOCUMENTATION = "https://aijiasu.apifox.cn/api-511071737";
const models = new Set<string>(JIASU_IMAGE_MODELS);
const unavailable = /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthorized|forbidden|not.?returned|unavailable|disabled/iu;
const pendingProtocol = /接口|协议|合同|尚未.*(?:适配|内置)|参数.*待/iu;

type CardParameter = { name?: unknown; range?: unknown; default?: unknown };
/** Only this full model's retained official card can update its parameter contract. */
export function jiasuImageFacts(model: string, descriptor?: ModelDescriptor): { sizes: readonly string[]; qualities: readonly string[]; qualityDefault: string; countMin: number; countMax: number } {
  const record = descriptor?.metadata?.jiasuCatalogRecord as { apiParameters?: CardParameter[] } | undefined;
  const rows = Array.isArray(record?.apiParameters) ? record.apiParameters : [];
  const size = rows.find(row => row?.name === "size");
  const quality = rows.find(row => row?.name === "quality");
  const count = rows.find(row => row?.name === "n");
  const pixels = typeof size?.range === "string" ? [...size.range.matchAll(/\b(\d{2,5})[x×](\d{2,5})\b/giu)].map(match => `${match[1]}x${match[2]}`) : [];
  const values = typeof quality?.range === "string" ? quality.range.split(/[,，、\s]+/u).filter(value => /^[a-z][a-z0-9_-]{0,24}$/iu.test(value)) : [];
  const ranks = ["auto", "low", "standard", "medium", "high", "hd", "xhigh", "ultra", "max"];
  const qualities = values.length ? [...new Set(values)] : jiasuImageQualities(model);
  const highest = [...qualities].sort((a, b) => ranks.indexOf(b) - ranks.indexOf(a))[0]!;
  const nRange = typeof count?.range === "string" ? /^(\d+)(?:\s*[-–~]\s*(\d+))?$/u.exec(count.range.trim()) : null;
  return { sizes: pixels.length ? [...new Set(pixels)] : jiasuImageSizes(model), qualities,
    qualityDefault: ranks.includes(highest) ? highest : typeof quality?.default === "string" && qualities.includes(quality.default) ? quality.default : highest,
    countMin: nRange ? Number(nRange[1]) : 1, countMax: nRange ? Number(nRange[2] ?? nRange[1]) : 1 };
}
function declaredNonImage(model: ModelDescriptor): boolean {
  return model.metadata?.operationsSource === "declared" && !model.operations.some(operation => operation.startsWith("image.")) ||
    model.metadata?.outputKindsSource === "declared" && !model.outputKinds?.some(kind => kind.startsWith("image"));
}

/** Match only the actual supplier origin; custom gateways retain their own contract. */
export function jiasuImageOrigin(baseUrl: unknown): string | undefined {
  if (typeof baseUrl !== "string") return;
  try {
    const url = new URL(baseUrl);
    if (url.protocol === "https:" && url.hostname === "ai.jiasuapi.com" && !url.port && !url.username && !url.password &&
        !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname)) return url.origin;
  } catch { /* Ordinary URL validation reports malformed connections. */ }
}

export function isJiasuImageConnection(config: Readonly<Record<string, unknown>> | undefined, model?: string): boolean {
  const selected = model ?? config?.defaultModel;
  return !!jiasuImageOrigin(config?.baseUrl) && typeof selected === "string" && models.has(selected);
}

export function jiasuImageTier(model: string): "1K" | "2K" | "4K" {
  return model === "gpt-image-2-high" || model.endsWith("-4k") ? "4K" : model.endsWith("-2k") ? "2K" : "1K";
}
export function jiasuImageSizes(model: string): readonly string[] {
  const edge = { "1K": 1024, "2K": 2048, "4K": 4096 }[jiasuImageTier(model)];
  return [`${edge}x${edge}`, `${edge}x${edge * 9 / 16}`, `${edge * 9 / 16}x${edge}`];
}
export function jiasuImageQualities(model: string): readonly string[] {
  if (JIASU_RESOLUTION_IMAGE_MODELS.includes(model)) return ["auto"];
  return model === "gpt-image-2-high" ? ["auto", "low", "medium", "high"] : ["auto", "low", "medium"];
}
function blocked(config: Readonly<Record<string, unknown>>, model: ModelDescriptor): boolean {
  return config.supplierArchived === true || ["agent", "disabled"].includes(String(config.usage)) ||
    ["empty", "unauthorized"].includes(String(config.modelScanStatus)) ||
    config.accountKeyGroup !== undefined && config.modelGroup !== undefined && config.accountKeyGroup !== config.modelGroup ||
    Array.isArray(config.scannedModelIds) && !config.scannedModelIds.includes(model.id) ||
    unavailable.test(String(model.metadata?.canvasUnavailableReason ?? "")) ||
    model.metadata?.canvasRunnable === false && !pendingProtocol.test(String(model.metadata.canvasUnavailableReason ?? ""));
}

/** Official full-ID cards override inferred family presets, including retained canvas catalogs. */
export function applyJiasuImageCapabilities(connection: ImageEditingConnection, model: ModelDescriptor): ModelDescriptor {
  if (!["openai", "rest"].includes(connection.provider) || !isJiasuImageConnection(connection.config, model.id) || blocked(connection.config, model)) return model;
  if (declaredNonImage(model)) return model;
  const async = JIASU_RESOLUTION_IMAGE_MODELS.includes(model.id);
  const tier = jiasuImageTier(model.id);
  const facts = jiasuImageFacts(model.id, model);
  const quality = facts.qualityDefault;
  const parameters: ModelParameterDescriptor[] = async ? [
    { key: "resolution", label: "分辨率", control: "select", valueType: "string", default: "1K", options: [{ value: "1K", label: "1K" }],
      description: "佳速异步模型要求 resolution:1K；size:1K 不是合法请求。" },
    { key: "ratio", label: "画面比例", control: "select", valueType: "string", default: "1:1", options: JIASU_IMAGE_RATIOS.map(value => ({ value, label: value })) },
  ] : [
    { key: "size", label: "输出尺寸", control: "select", valueType: "string", default: facts.sizes[0]!,
      options: facts.sizes.map(value => { const [width, height] = value.split("x").map(Number); const divisor = (a: number, b: number): number => b ? divisor(b, a % b) : a;
        const common = divisor(width!, height!); return { value, label: `${tier} · ${width! / common}:${height! / common} · ${value}` }; }),
      description: "按当前完整型号模型卡的像素枚举发送，不扩展其他型号的尺寸。" },
  ];
  parameters.push({ key: "quality", label: "质量", control: "select", valueType: "string", default: quality,
    options: facts.qualities.map(value => ({ value, label: value === "auto" ? "自动（上游默认）" : value })),
    description: async ? "仅上游已配置价格的质量组合可用；自动不发送 quality。" : "当前完整型号模型卡声明的质量枚举。" },
    { key: "n", label: "生成张数", control: "number", valueType: "integer", default: 1, min: 1, max: 1,
      description: "当前画布一次请求生成一张；通用异步文档的最大 128 不代表已核对全部数量计价组合。" });
  const metadata: Record<string, unknown> = { ...model.metadata, canvasRunnable: true, autoInterfaceStatus: "connected", jiasuImageProtocol: 1,
    protocol: "jiasu-images-async", supportsImageEdit: true, supportsReferenceImages: true,
    imageNativeResolutionOptions: true, imageNativeResolutionParameter: async ? "resolution" : "size", imageNativeQualityOptions: true,
    imageSupportedResolutions: [tier], imageUnsupportedResolutions: ["1K", "2K", "4K"].filter(value => value !== tier),
    parameterSource: "jiasu-official-full-model-card", documentationUrl: JIASU_IMAGE_DOCUMENTATION, jiasuPixelParametersSource: "https://ai.jiasuapi.com/api/pricing", jiasuSyncEndpointVerified: false,
    parameterControlsUnavailable: false, jiasuDeclaredOutputCount: { min: facts.countMin, max: facts.countMax },
    ...(async ? { referenceLimitSource: "model-card", maxInputImageBytes: 512 * 1024 * 1024 } : {}) };
  delete metadata.canvasUnavailableReason;
  const limits = { ...model.limits, maxOutputImages: 1, ...(async ? { maxInputImages: 5 } : {}) };
  // A limit inferred for a different family must not become this supplier's public limit.
  if (!async) delete limits.maxInputImages;
  return { ...model, operations: ["image.generate", "image.edit"], capabilities: ["image.generate", "image.edit"], inputKinds: ["text", "image", "image[]"],
    outputKinds: ["image"], parameters, limits, metadata };
}

export function normalizeJiasuImageParameters(model: string, input: Readonly<Record<string, unknown>> = {}, descriptor?: ModelDescriptor): Record<string, unknown> {
  const async = JIASU_RESOLUTION_IMAGE_MODELS.includes(model);
  const facts = jiasuImageFacts(model, descriptor);
  const result: Record<string, unknown> = { n: input.n ?? 1 };
  if (async) {
    result.resolution = String(input.resolution ?? input.image_size ?? input.size_tier ?? "1K").toUpperCase();
    result.ratio = input.ratio ?? input.aspect_ratio ?? input.aspectRatio ?? "1:1";
  } else {
    if (input.size !== "auto") result.size = input.size ?? facts.sizes[0];

  }
  const quality = input.quality ?? facts.qualityDefault;
  if (quality !== "auto") result.quality = quality;
  return result;
}

export function jiasuImageRequestIssues(connection: ImageEditingConnection, request: NormalizedRequest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });
  const model = request.model ?? "";
  if (!isJiasuImageConnection(connection.config, model)) add("model", "unsupported_model", "佳速图片合同仅适用于当前官方来源的九个完整型号");
  const catalog = connection.config.modelCatalogModels;
  const saved = Array.isArray(catalog) ? (catalog as ModelDescriptor[]).find(item => item?.id === model) : undefined;
  if (blocked(connection.config, saved ?? { id: model, name: model, operations: [] })) add("model", "model_group_mismatch", "当前佳速 Key 或分组没有此图片型号的可用权限");
  if (saved && declaredNonImage(saved)) add("model", "unsupported_media", "当前佳速 Key 对此型号明确声明非图片输出，不能用于图片节点");
  const input = request.parameters ?? {};
  const facts = jiasuImageFacts(model, saved);
  const selected = normalizeJiasuImageParameters(model, input, saved);
  if (input.output_format !== undefined && input.output_format !== "auto") add("parameters.output_format", "unsupported_output_format", "当前佳速异步图片合同未公布 output_format，请使用原始 CDN 图片格式");
  for (const key of ["width", "height"]) if (input[key] !== undefined)
    add(`parameters.${key}`, "unsupported_custom_dimensions", "当前佳速型号只支持已公布的尺寸枚举，不能发送自定义宽高");
  if (input.background !== undefined && !["auto", "opaque"].includes(String(input.background)) && input.background !== "transparent")
    add("parameters.background", "unsupported_background", "当前佳速型号未公布此背景选项");
  if (selected.n !== 1) add("parameters.n", "invalid_count", "当前佳速图片请求一次生成一张（n=1）");
  if (Number(selected.n) < facts.countMin || Number(selected.n) > facts.countMax) add("parameters.n", "invalid_model_count", "当前完整型号模型卡的张数范围不支持此请求");
  if (selected.quality !== undefined && !facts.qualities.includes(String(selected.quality))) add("parameters.quality", "invalid_quality", `此完整型号仅支持 ${facts.qualities.join("、")}`);
  const async = JIASU_RESOLUTION_IMAGE_MODELS.includes(model);
  if (async) {
    const resolutions = ["resolution", "image_size", "size_tier"].filter(key => input[key] !== undefined);
    for (const key of resolutions) if (String(input[key]).toUpperCase() !== "1K")
      add(`parameters.${key}`, "invalid_resolution", "此佳速异步图片型号只支持 resolution:1K，已保存的档位不会自动降档");
    const ratios = ["ratio", "aspect_ratio", "aspectRatio"].filter(key => input[key] !== undefined);
    for (const key of ratios) if (!JIASU_IMAGE_RATIOS.includes(input[key] as typeof JIASU_IMAGE_RATIOS[number]))
      add(`parameters.${key}`, "invalid_aspect_ratio", "请选择此完整型号支持的五个画面比例");
    if (new Set(ratios.map(key => input[key])).size > 1)
      add("parameters.ratio", "conflicting_aspect_ratio", "已保存的画面比例字段互相冲突，请明确选择比例后再提交");
    if (input.response_format !== undefined && input.response_format !== "url" && input.response_format !== "auto") add("parameters.response_format", "invalid_response_format", "佳速异步图片以 CDN URL 返回结果");
    if (selected.resolution !== "1K") add("parameters.resolution", "invalid_resolution", "此佳速异步图片型号只支持 resolution:1K");
    if (!JIASU_IMAGE_RATIOS.includes(selected.ratio as typeof JIASU_IMAGE_RATIOS[number])) add("parameters.ratio", "invalid_aspect_ratio", "请选择此完整型号支持的五个画面比例");
    if (input.size !== undefined && input.size !== "auto") add("parameters.size", "invalid_size", "佳速异步 1K 型号需选择 resolution 与 ratio，不能发送 size 预设");
  } else {
    if (selected.size !== undefined && !facts.sizes.includes(String(selected.size))) add("parameters.size", "invalid_size", "请选择当前完整型号模型卡列出的像素尺寸");
    if (input.response_format !== undefined && input.response_format !== "url" && input.response_format !== "auto") add("parameters.response_format", "invalid_response_format", "佳速异步图片以 CDN URL 返回结果");
    for (const key of ["ratio", "aspect_ratio", "aspectRatio", "resolution", "image_size", "size_tier"]) if (input[key] !== undefined && input[key] !== "auto")
      add(`parameters.${key}`, "invalid_size_field", "此佳速像素型号使用模型卡的 size 像素尺寸，请重新选择");
  }
  if (request.operation !== "image.generate" && request.operation !== "image.edit") add("operation", "unsupported_operation", "佳速图片接口只支持图片生成和参考图编辑");
  const references = request.assets?.filter(asset => asset.role !== "mask") ?? [];
  if (request.assets?.some(asset => asset.kind !== "image")) add("assets", "invalid_image", "佳速图片接口仅接受图片素材");
  if (request.operation === "image.edit" && !references.length) add("assets", "reference_required", "佳速图片编辑需要参考图片");
  if (request.operation === "image.generate" && references.length) add("assets", "reference_operation", "带参考图的佳速任务请使用图片编辑操作");
  if (async && references.length > 5) add("assets", "too_many_images", "此佳速完整型号最多使用五张参考图片");
  return issues;
}

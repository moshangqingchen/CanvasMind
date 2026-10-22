import type { ModelDescriptor, ModelParameterDescriptor, NormalizedRequest, ValidationIssue } from "./contracts.js";
import type { RestModelConnectorOverride, RestRequestMapping } from "./rest.js";
import { userImageQualityOptions } from "./user-image-quality-presets.js";
import { CANGYUAN_IMAGE_DOCUMENTS } from "./cangyuan-image-documents.js";
import { cangyuanQualityParameterUnsupported, CANGYUAN_QUALITY_RESTRICTION_SOURCE } from "./cangyuan-current-restrictions.js";
import { cangyuanResultRetention } from "./cangyuan-result-retention.js";

const kTiers = ["1k", "2k", "4k"];
const options = (values: readonly string[]) => values.map(value => ({ label: value, value }));
const fixedTier = (id: string) => /-([124]k)$/u.exec(id)?.[1];
export const hasCangyuanImageDocument = (id: string): boolean => Object.hasOwn(CANGYUAN_IMAGE_DOCUMENTS, id);
export interface CangyuanCatalogDimensionEvidence {
  modelId: string;
  sourceUrl: string;
  checkedAt: string;
  customDimensions: unknown;
}

/** The price row's UI bounds are evidence for that exact fullID, not wire fields.
 * A newer contradictory UI value must not silently override the model schema. */
function catalogDimensionEvidence(id: string, expected: Record<string, unknown>, source?: CangyuanCatalogDimensionEvidence): Record<string, unknown> | undefined {
  const value = source?.customDimensions;
  if (!source || source.modelId !== id || source.sourceUrl !== "https://ai.cangyuansuanli.cn/api/pricing" ||
      !value || typeof value !== "object" || Array.isArray(value) || !("enabled" in value) || value.enabled !== true) return;
  const raw = value as Record<string, unknown>;
  const names = { step: "alignment", maxEdge: "maximumEdge", minLongestEdge: "minimumLongestEdge",
    maxAspectRatio: "maximumAspectRatio", minPixels: "minimumPixels", maxPixels: "maximumPixels" };
  const normalizedBounds = Object.fromEntries(Object.entries(names).flatMap(([key, target]) => {
    const number = raw[key];
    return typeof number === "number" && Number.isFinite(number) && number > 0 && (key === "maxAspectRatio" || Number.isSafeInteger(number)) ? [[target, number]] : [];
  }));
  if (!Object.keys(normalizedBounds).length) return;
  const conflictKeys = Object.keys(normalizedBounds).filter(key => normalizedBounds[key] !== expected[key]);
  return { modelId: id, sourceUrl: source.sourceUrl, checkedAt: source.checkedAt, normalizedBounds, conflictKeys,
    status: conflictKeys.length ? "conflicts-with-exact-schema" : "matches-exact-schema" };
}

/** Public size is a ratio, an explicit pixel value, or omission, as this SKU declares. */
export function cangyuanDocumentedImageModel(model: ModelDescriptor): ModelDescriptor {
  return cangyuanDocumentedImageModelWithCatalogDimensions(model);
}

export function cangyuanDocumentedImageModelWithCatalogDimensions(model: ModelDescriptor, catalogDimensions?: CangyuanCatalogDimensionEvidence): ModelDescriptor {
  const doc = CANGYUAN_IMAGE_DOCUMENTS[model.id];
  if (!doc) return model;
  const operations = doc.editing ? ["image.generate", "image.edit"] as const : ["image.generate"] as const;
  const x = model.id === "gpt-image-2-x" || model.id === "gpt-image-2.5-x";
  const nano = model.id === "gemini-nano-banana-2.1";
  const mj = /^midjourney-[12]k$/u.test(model.id);
  // A suffix identifies the billed public SKU. Only an explicit current
  // restriction can turn that name into a fixed resolution selector.
  const declaredFixedTier = /固定\s+([124]K)\s+档位，不能请求其他分辨率档位/u.exec(doc.fields.size ?? "")?.[1];
  const rules = doc.parameterRules ?? {};
  const parameters: ModelParameterDescriptor[] = [];
  if (doc.ratios.length) parameters.push({ key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string",
    default: rules.size?.default ?? (nano ? "1:1" : model.id === "midjourney-v7" || model.id === "seedream-5.0-pro-x" ? "16:9" : "auto"),
    options: [...(!nano ? [{ label: "自动（供应商默认）", value: "auto" }] : []), ...options(doc.ratios)], operations,
    ...(doc.sizeSuggestionsOnly ? { allowCustomValue: true } : {}),
    description: doc.fields.size ?? "" });
  if (doc.customPixels || doc.pixelOptions.length) parameters.push({ key: "size", label: "自定义宽高", control: doc.customPixels ? "dimensions" : "select",
    valueType: "string", ...(doc.customPixels ? { min: doc.dimensionRules?.step ?? 1, step: doc.dimensionRules?.step ?? 1, allowCustomValue: true,
      ...(doc.dimensionRules ? { max: doc.dimensionRules.maxSide } : {}) } : {}),
    ...(model.id.startsWith("grok-imagine-image") ? { default: model.id.endsWith("-lite") ? "1280x720" : "1024x1024" } : {}),
    options: doc.pixelOptions.map(value => ({ label: (fixedTier(model.id)?.toUpperCase() ?? "原生") + " · " + value.replace("x", " × "), value })), operations,
    description: doc.fields.size ?? "" });
  const labels: Record<string, string> = { series: "产品线", tier: "清晰度 / 计费档位", resolution: "分辨率档位", quality: "质量", speed: "生成速度", reference: "参考图模式",
    output_format: "输出文件编码", background: "背景", output_compression: "输出压缩", moderation: "内容审核", response_format: "结果返回方式", async: "异步任务", n: "生成张数" };
  const legacyOptions: Record<string, string[]> = { series: ["flare", "sunburst"], tier: ["web", ...kTiers], quality: doc.qualityOptions,
    speed: ["relax", "fast"], reference: ["image", "style", "edit", "moodboard", "editor"], output_format: ["png", "jpeg"] };
  for (const key of Object.keys(doc.fields).filter(key => !["model", "prompt", "size", "images", "mask"].includes(key))) {
    const rule = rules[key], values = rule?.enum ?? rule?.suggestions ?? legacyOptions[key];
    const numeric = rule?.type === "integer" || rule?.type === "number" || key === "n", toggle = rule?.type === "boolean";
    const defaultValue = rule?.default ?? (key === "n" ? 1 : key === "async" ? true : key === "response_format" ? "url" : key === "tier" ? "4k" : key === "series" ? "sunburst" :
      key === "quality" ? doc.qualityOptions.includes("4k") ? "4k" : model.id.startsWith("gpt-image-2.5") ? "max" : model.id.startsWith("gpt-image-2") ? "high" : doc.qualityOptions.at(-1) :
      key === "speed" ? "relax" : key === "reference" ? "image" : key === "output_format" ? "png" : undefined);
    parameters.push({ key, label: key === "quality" && doc.qualityOptions.includes("4k") ? "输出分辨率" : labels[key] ?? key,
      control: toggle ? "toggle" : numeric && !rule?.enum ? "number" : values?.length ? "select" : "text",
      valueType: toggle ? "boolean" : numeric ? rule?.type === "number" ? "number" : "integer" : "string", operations,
      ...(defaultValue !== undefined ? { default: defaultValue } : {}), ...(rule?.required ? { required: true } : {}),
      ...(values?.length ? { options: values.map(value => ({ label: String(value), value })) } : {}),
      ...(rule?.suggestions && !rule.enum ? { allowCustomValue: true } : {}),
      ...(numeric ? { ...(rule?.type !== "number" ? { step: 1 } : {}), ...(rule?.min !== undefined ? { min: rule.min } : {}), ...(rule?.max !== undefined ? { max: rule.max } : {}) } : {}),
      description: doc.fields[key] ?? "" });
  }
  // This is the user's quality preference over the existing Images quality field,
  // separate from a supplier declaration in a document that omitted it.
  if (!doc.fields.quality && !cangyuanQualityParameterUnsupported(model.id) && userImageQualityOptions(model.id).length) parameters.push({ key: "quality", label: "质量", control: "select", valueType: "string", operations,
    default: model.id.startsWith("gpt-image-2.5") ? "max" : "high", options: userImageQualityOptions(model.id),
    description: "用户指定的应用质量预设；按 Images 协议 quality 字段发送。" });
  if (doc.fields.mask) parameters.push({ key: "mask", label: "蒙版 HTTPS 地址", control: "text", valueType: "string", operations: ["image.edit"],
    ...(!doc.parameterRules && mj ? { visibleWhen: [{ parameter: "reference", values: ["editor"] }] } : {}), description: doc.fields.mask });
  const metadata = { ...model.metadata };
  if (cangyuanQualityParameterUnsupported(model.id)) for (const key of ["imageUserQualityPresets", "imageUserQualityPresetSource", "imageUserQualitySourceParameter", "imageApplicationQualityDefault"]) delete metadata[key];
  // Discard inherited family pixel presets before installing this exact SKU.
  for (const key of ["imageNativeResolutionParameter", "imageNativeResolutionOptions", "imageOutputDimensions", "imageApproximateResolutions", "imageUnsupportedResolutions", "imageNativeQualityOptions", "imageFixedResolution", "imageCustomDimensionRules"])
    delete metadata[key];
  const denied = /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthorized|forbidden|not.?returned|unavailable|disabled/iu.test(String(metadata.canvasUnavailableReason ?? ""));
  if (!denied) { delete metadata.canvasUnavailableReason; delete metadata.pendingLiveScan; delete metadata.protocolSourceModel; if (metadata.autoInterfaceStatus === "incomplete") delete metadata.autoInterfaceStatus; }
  const nativeQuality = parameters.find(p => p.key === "quality")?.options?.some(o => String(o.value) === "4k");
  const nativeResolution = rules.resolution?.enum ?? rules.resolution?.suggestions;
  const supported = nativeResolution?.map(String) ?? (x || nativeQuality ? ["1K", "2K", "4K"] : declaredFixedTier ? [declaredFixedTier] : model.id === "seedream-5.0-pro-x" ? ["1K", "2K"] : []);
  const { maxInputImages: _oldMax, supportedMimeTypes: _oldMime, ...oldLimits } = model.limits ?? {};
  const dimensionRules = {
    ...(doc.dimensionRules?.step !== undefined ? { alignment: doc.dimensionRules.step } : {}),
    ...(doc.dimensionRules?.maxSide !== undefined ? { maximumEdge: doc.dimensionRules.maxSide } : {}),
    ...(doc.dimensionRules?.minLongestEdge !== undefined ? { minimumLongestEdge: doc.dimensionRules.minLongestEdge } : {}),
    ...(doc.dimensionRules?.maxAspectRatio !== undefined ? { maximumAspectRatio: doc.dimensionRules.maxAspectRatio } : {}),
    ...(doc.dimensionRules?.minPixels !== undefined ? { minimumPixels: doc.dimensionRules.minPixels } : {}),
    ...(doc.dimensionRules?.maxPixels !== undefined ? { maximumPixels: doc.dimensionRules.maxPixels } : {}),
  };
  const catalogBounds = catalogDimensionEvidence(model.id, dimensionRules, catalogDimensions);
  return { ...model, operations, parameters, description: doc.intro, inputKinds: doc.editing ? ["text", "image", "image[]"] : ["text"], outputKinds: ["image", "image[]"],
    limits: { ...oldLimits, ...(doc.maxReferences !== undefined ? { maxInputImages: doc.maxReferences } : {}), ...(rules.n?.max !== undefined ? { maxOutputImages: rules.n.max } : {}), ...(nano ? { supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"] } : {}) },
    metadata: { ...metadata, canvasRunnable: !denied, protocol: "rest", cangyuanCurrentContract: model.id, imageNativeParameterContract: true,
      operationsSource: "declared", outputKindsSource: "declared", catalogCapability: "image", documentationUrl: doc.sourceUrl, contractCheckedAt: doc.checkedAt, imageContractDocumentSha256: doc.sha256, imageContractSourceLastReviewed: doc.sourceLastReviewed,
      imageSupportedResolutions: supported, imageRequestResolutions: nativeResolution || x || nativeQuality || declaredFixedTier ? supported : [],
      ...(nativeResolution ? { imageNativeResolutionParameter: "resolution", imageNativeResolutionOptions: true, imageResolutionTierSource: "supplier-schema-suggestions" }
        : x || nativeQuality ? { imageNativeResolutionParameter: x ? "tier" : "quality", imageNativeResolutionOptions: true, imageNativeQualityOptions: true } : { imageResolutionMode: declaredFixedTier ? "fixed-model-tier" : doc.dimensionRules ? "model-dimension-bounds" : "provider-decided" }),
      ...(declaredFixedTier ? { imageFixedResolution: declaredFixedTier } : {}),
      ...(fixedTier(model.id) ? { imageNominalResolution: fixedTier(model.id)!.toUpperCase() } : {}),
      imagePixelBudgetPublished: doc.dimensionRules?.minPixels !== undefined || doc.dimensionRules?.maxPixels !== undefined, imageQualityOptionsCompleteEnum: Boolean(rules.quality?.enum),
      ...(!doc.fields.quality && !cangyuanQualityParameterUnsupported(model.id) && userImageQualityOptions(model.id).length ? { imageUserQualityPresetSource: "user-request", imageApplicationQualityDefault: model.id.startsWith("gpt-image-2.5") ? "max" : "high" } : {}),
      ...(cangyuanQualityParameterUnsupported(model.id) ? { imageQualityParameterUnsupported: true, imageQualityRestrictionSource: CANGYUAN_QUALITY_RESTRICTION_SOURCE } : {}),
      resultRetention: cangyuanResultRetention("https://ai.cangyuansuanli.cn", "image"),
      ...(doc.dimensionRules ? { imageCustomDimensionRules: dimensionRules } : {}),
      ...(catalogBounds ? { cangyuanCatalogDimensionEvidence: catalogBounds } : {}),
      imageCustomPixels: doc.customPixels, imageOutputEncodingFields: doc.fields.output_format ? ["output_format"] : [],
      imageSizeOptionsCompleteEnum: doc.pixelOptions.length > 0 && !doc.customPixels,
      ...(doc.referenceDimensions ? { imageOutputReferenceDimensions: doc.referenceDimensions } : {}),
      imageOutputEncodingDeclared: Boolean(doc.fields.output_format), imageOutputTransport: "url", supportsMask: Boolean(doc.fields.mask),
      remoteMediaUrlsOnly: !/^grok-imagine-image(?:-2\.0)?$/u.test(model.id), ...(nano ? { maxInputImageBytes: 35 * 1024 * 1024 } : {}),
      ...(mj || model.id === "midjourney-v7" ? { multipleOutputsPerRequest: true } : {}),
    } };
}

export function cangyuanDocumentedImageTransport(id: string, parameters?: Readonly<Record<string, unknown>>): RestModelConnectorOverride | undefined {
  const doc = CANGYUAN_IMAGE_DOCUMENTS[id]; if (!doc) return undefined;
  const mj = /^midjourney-[12]k$/u.test(id);
  const mappings: RestRequestMapping[] = [
    { target: "/model", source: { kind: "request", path: "$.model" } },
    { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
    { target: "/size", source: { kind: "request", path: "$.parameters.aspect_ratio" }, omitIfUndefined: true,
      ...(doc.parameterRules?.resolution ? {} : { omitValues: ["auto"] }) },
    ...(doc.customPixels || doc.pixelOptions.length ? [{ target: "/size", source: { kind: "request" as const, path: "$.parameters.size" }, omitIfUndefined: true, omitValues: ["auto"] }] : []),
    ...[...new Set([...Object.keys(doc.fields).filter(key => !["model", "prompt", "size", "images", "mask"].includes(key)), ...(!cangyuanQualityParameterUnsupported(id) && userImageQualityOptions(id).length ? ["quality"] : [])])].map((key): RestRequestMapping => ({ target: `/${key}`,
      source: { kind: "request", path: `$.parameters.${key}` }, omitIfUndefined: true })),
  ];
  const response = { taskIdPath: "$.id", taskIdFallbackPaths: ["$.task_id"], statusPath: "$.status", errorPath: "$.error.message", progressPath: "$.progress" };
  const editPath = !doc.parameterRules && mj && parameters?.reference !== "editor" ? "/v1/images/generations" : "/v1/images/edits";
  const submit = (edit: boolean) => ({ path: edit ? editPath : "/v1/images/generations", method: "POST" as const, bodyMode: "json" as const,
    template: { async: true, n: 1, response_format: "url" }, mappings: [...mappings,
      ...(edit ? [{ target: "/images", source: { kind: "assets" as const, assetKind: "image" as const }, omitIfEmpty: true }] : []),
      ...(edit && doc.fields.mask ? [{ target: "/mask", source: { kind: "request" as const, path: "$.parameters.mask" }, omitIfUndefined: true, omitIfEmpty: true,
        ...(!doc.parameterRules && id === "gpt-image-2-x" ? { when: [{ path: "$.parameters.tier", values: kTiers }] } : {}) },
      { target: "/mask", source: { kind: "assets" as const, assetKind: "image" as const, role: "mask" as const, select: "first" as const }, omitIfUndefined: true }] : [])], response });
  const poll = (edit: boolean) => ({ path: `${edit ? editPath : "/v1/images/generations"}/{taskId}`, method: "GET" as const, bodyMode: "none" as const, response });
  return { submit: submit(false), poll: poll(false), pollIntervalMs: 5_000, output: { path: "$.data", kind: "image", urlPath: "url", base64Path: "b64_json" },
    ...(doc.editing ? { operationOverrides: { "image.edit": { submit: submit(true), poll: poll(true) } } } : {}) };
}

/** Validate exactly this supplier SKU; undocumented numeric budgets stay explicit gaps. */
export function cangyuanDocumentedImageIssues(request: NormalizedRequest): ValidationIssue[] {
  const doc = CANGYUAN_IMAGE_DOCUMENTS[request.model ?? ""]; if (!doc) return [];
  const model = cangyuanDocumentedImageModel({ id: request.model!, name: request.model!, operations: [] });
  const p = request.parameters ?? {}, issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, code: "invalid_parameter", message });
  const allowed = new Set((model.parameters ?? []).map(row => row.key));
  for (const key of Object.keys(p)) if (!allowed.has(key) && key !== "size_tier") add(`parameters.${key}`, `${request.model} 官网 Images 合同未声明 ${key}，请重新选择当前参数。`);
  for (const parameter of model.parameters ?? []) {
    const value = p[parameter.key];
    if (parameter.required && value === undefined) add(`parameters.${parameter.key}`, `必须选择${parameter.label}。`);
    if (value !== undefined && parameter.control === "select" && parameter.allowCustomValue !== true && !parameter.options?.some(option => String(option.value) === String(value)))
      add(`parameters.${parameter.key}`, `${request.model} 不支持 ${parameter.key}=${String(value)}。`);
  }
  if (p.size !== undefined && doc.customPixels && typeof p.size !== "string") add("parameters.size", "size 必须为字符串。");
  if (/^\d+x\d+$/u.test(String(p.size)) && String(p.size).split("x").some(v => !Number.isSafeInteger(Number(v)) || Number(v) <= 0)) add("parameters.size", "图片宽高必须为正整数。");
  for (const [key, rule] of Object.entries(doc.parameterRules ?? {})) {
    const value = key === "size" ? p.size ?? p.aspect_ratio : p[key]; if (value === undefined) continue;
    if (rule.type === "string" && typeof value !== "string" || rule.type === "boolean" && typeof value !== "boolean") add("parameters." + key, "参数类型与官方字段不一致。");
    if (rule.type === "integer" && (typeof value !== "number" || !Number.isInteger(value)) || rule.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) add("parameters." + key, "请输入合法数值。");
    if (typeof value === "number" && (rule.min !== undefined && value < rule.min || rule.max !== undefined && value > rule.max)) add("parameters." + key, "数值超出该型号公布范围。");
  }
  if (!doc.parameterRules && p.n !== undefined && p.n !== 1) add("parameters.n", "一次请求只能 n=1。");
  if (doc.dimensionRules && /^\d+x\d+$/u.test(String(p.size))) {
    const [width, height] = String(p.size).split("x").map(Number) as [number, number], d = doc.dimensionRules;
    if (d.step !== undefined && (width % d.step || height % d.step) ||
        d.maxSide !== undefined && Math.max(width, height) > d.maxSide ||
        d.minLongestEdge !== undefined && Math.max(width, height) < d.minLongestEdge ||
        d.maxAspectRatio !== undefined && Math.max(width / height, height / width) > d.maxAspectRatio ||
        d.minPixels !== undefined && width * height < d.minPixels || d.maxPixels !== undefined && width * height > d.maxPixels)
      add("parameters.size", "尺寸须满足该型号的对齐、边长、比例及总像素限制。");
  }
  if (!doc.editing && request.operation === "image.edit") add("operation", "该完整型号只支持文生图。");
  const masks = request.assets?.filter(a => a.role === "mask") ?? [];
  const maskAllowed = Boolean(doc.fields.mask) && request.operation === "image.edit" && (Boolean(doc.parameterRules) || (request.model !== "gpt-image-2-x" || kTiers.includes(String(p.tier))) && (!/^midjourney-[12]k$/u.test(request.model!) || p.reference === "editor"));
  if ((p.mask || masks.length) && !maskAllowed) add("parameters.mask", "当前完整型号、档位或模式不支持蒙版。");
  if (masks.length > 1) add("assets", "最多支持 1 张蒙版。");
  if (p.mask && !/^https:\/\//u.test(String(p.mask))) add("parameters.mask", "蒙版必须为公网 HTTPS 地址。");
  const refs = request.assets?.filter(a => a.kind === "image" && a.role !== "mask") ?? [];
  const limit = !doc.parameterRules && request.model === "gpt-image-2.5-x" && p.tier === "web" ? 9 : doc.maxReferences;
  if (limit !== undefined && refs.length > limit) add("assets", `当前档位最多 ${limit} 张参考图。`);
  if (!doc.editing && refs.length) add("assets", "该型号不支持参考图。");
  if (model.metadata?.remoteMediaUrlsOnly) for (const asset of request.assets ?? []) if (asset.url && !asset.url.startsWith("https://")) add("assets", "素材须是公网 HTTPS URL。");
  if (request.model === "gemini-nano-banana-2.1") for (const asset of refs) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType)) add("assets", "Nano 2.1 输入仅支持 PNG、JPEG、WebP。");
    if (asset.data && asset.data.byteLength > 35 * 1024 * 1024) add("assets", "Nano 2.1 每张输入图片不得超过 35MB。");
  }
  if (request.model === "midjourney-v7" && request.prompt.length > 4000 || request.model === "seedream-5.0-pro-x" && request.prompt.length > 8000) add("prompt", "提示词超出该型号限制。");
  if (/^midjourney-[12]k$/u.test(request.model!)) {
    if (p.reference === "editor" && refs.length !== 1) add("assets", "Midjourney editor 必须且只能使用 1 张源图。");
    if (p.reference === "edit" && refs.length > 4) add("assets", "Midjourney edit 最多使用 4 张参考图。");
    const ar = /--ar\s+(\d+:\d+)/u.exec(request.prompt)?.[1];
    if (ar && p.aspect_ratio !== undefined && p.aspect_ratio !== "auto" && ar !== p.aspect_ratio) add("parameters.aspect_ratio", "size 与 prompt --ar 必须一致。");
    if (/--fast\b/u.test(request.prompt) && p.speed === "relax" || /--relax\b/u.test(request.prompt) && p.speed === "fast") add("parameters.speed", "speed 与 prompt --fast/--relax 必须一致。");
    if (/--(?:hd|turbo)\b/u.test(request.prompt)) add("prompt", "该 Midjourney 固定档不能发送 --hd/--turbo。");
  }
  return issues;
}

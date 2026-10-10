import type { ModelDescriptor, ModelParameterDescriptor, NormalizedRequest, ValidationIssue } from "./contracts.js";
import type { RestModelConnectorOverride, RestRequestMapping } from "./rest.js";
import { CANGYUAN_IMAGE_DOCUMENTS } from "./cangyuan-image-documents.js";

const kTiers = ["1k", "2k", "4k"];
const options = (values: readonly string[]) => values.map(value => ({ label: value, value }));
const fixedTier = (id: string) => /-([124]k)$/u.exec(id)?.[1];
export const hasCangyuanImageDocument = (id: string): boolean => Object.hasOwn(CANGYUAN_IMAGE_DOCUMENTS, id);

/** Public size is a ratio, an explicit pixel value, or omission, as this SKU declares. */
export function cangyuanDocumentedImageModel(model: ModelDescriptor): ModelDescriptor {
  const doc = CANGYUAN_IMAGE_DOCUMENTS[model.id];
  if (!doc) return model;
  const operations = doc.editing ? ["image.generate", "image.edit"] as const : ["image.generate"] as const;
  const x = model.id === "gpt-image-2-x" || model.id === "gpt-image-2.5-x";
  const nano = model.id === "gemini-nano-banana-2.1";
  const mj = /^midjourney-[12]k$/u.test(model.id);
  const parameters: ModelParameterDescriptor[] = [];
  if (doc.ratios.length) parameters.push({ key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string",
    default: nano ? "1:1" : model.id === "midjourney-v7" || model.id === "seedream-5.0-pro-x" ? "16:9" : "auto",
    options: [...(!nano ? [{ label: "自动（供应商默认）", value: "auto" }] : []), ...options(doc.ratios)], operations,
    description: `${doc.fields.size} 画布比例映射到请求 size；档位像素未公布时，以原图为准。` });
  if (doc.customPixels || doc.pixelOptions.length) parameters.push({ key: "size", label: "自定义宽高", control: doc.customPixels ? "dimensions" : "select",
    valueType: "string", ...(doc.customPixels ? { min: 1, step: 1 } : {}),
    ...(model.id.startsWith("grok-imagine-image") ? { default: model.id.endsWith("-lite") ? "1280x720" : "1024x1024" } : {}),
    options: doc.pixelOptions.map(value => ({ label: `${fixedTier(model.id)?.toUpperCase() ?? "原生"} · ${value.replace("x", " × ")}`, value })), operations,
    description: `${doc.fields.size}${doc.customPixels ? " 官网未公布逐比例像素表、宽高步长或数值预算，不套用通用 K 尺寸。" : " 仅可选择公布的像素尺寸，W/H 只读。"}` });
  if (model.id === "gpt-image-2.5-x") parameters.push({ key: "series", label: "产品线", control: "select", valueType: "string", required: true,
    default: "sunburst", options: options(["flare", "sunburst"]), operations, description: doc.fields.series ?? "flare / sunburst" });
  if (x) parameters.push({ key: "tier", label: "清晰度 / 计费档位", control: "select", valueType: "string", default: "4k",
    options: options(["web", ...kTiers]), operations, description: `${doc.fields.tier} 各比例精确像素预算未公布；web 是供应商自动档。` });
  if (doc.qualityOptions.length) {
    const qualityOptions = /\blow\b/u.test(doc.fields.quality ?? "") ? ["low", "medium", "high", "xhigh", "max", ...(/\bauto\b/u.test(doc.fields.quality ?? "") ? ["auto"] : [])] : doc.qualityOptions;
    if (model.id === "gpt-image-2.5-x") qualityOptions.splice(0, qualityOptions.length, "auto", "low", "medium", "high", "xhigh", "max");
    parameters.push({ key: "quality", label: qualityOptions.includes("4k") ? "输出分辨率" : "质量", control: "select", valueType: "string",
      default: qualityOptions.includes("4k") ? "4k" : "max", options: options(qualityOptions), operations,
      ...(x ? { visibleWhen: [{ parameter: "tier", values: kTiers }] } : {}), description: doc.fields.quality ?? "" });
  }
  if (doc.fields.speed) parameters.push({ key: "speed", label: "生成速度", control: "select", valueType: "string", default: "relax",
    options: options(["relax", "fast"]), operations, description: doc.fields.speed });
  if (doc.fields.reference) parameters.push({ key: "reference", label: "参考图模式", control: "select", valueType: "string", default: "image",
    options: options(["image", "style", "edit", "moodboard", "editor"]), operations, description: doc.fields.reference });
  if (doc.fields.output_format) parameters.push({ key: "output_format", label: "输出文件编码", control: "select", valueType: "string", default: "jpeg",
    options: options(["png", "jpeg"]), operations, description: doc.fields.output_format });
  if (doc.fields.mask) parameters.push({ key: "mask", label: "蒙版 HTTPS 地址", control: "text", valueType: "string", operations: ["image.edit"],
    ...(model.id === "gpt-image-2-x" ? { visibleWhen: [{ parameter: "tier", values: kTiers }] } : mj ? { visibleWhen: [{ parameter: "reference", values: ["editor"] }] } : {}),
    description: doc.fields.mask });
  parameters.push({ key: "n", label: "生成张数", control: "select", valueType: "integer", default: 1, options: [{ label: "1 次请求", value: 1 }], operations, description: doc.fields.n ?? "" });
  const metadata = { ...model.metadata };
  // Discard inherited family pixel presets before installing this exact SKU.
  for (const key of ["imageNativeResolutionParameter", "imageNativeResolutionOptions", "imageOutputDimensions", "imageApproximateResolutions", "imageUnsupportedResolutions", "imageNativeQualityOptions"])
    delete metadata[key];
  const denied = /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthorized|forbidden|not.?returned|unavailable|disabled/iu.test(String(metadata.canvasUnavailableReason ?? ""));
  if (!denied) { delete metadata.canvasUnavailableReason; delete metadata.pendingLiveScan; delete metadata.protocolSourceModel; if (metadata.autoInterfaceStatus === "incomplete") delete metadata.autoInterfaceStatus; }
  const nativeQuality = parameters.find(p => p.key === "quality")?.options?.some(o => String(o.value) === "4k");
  const supported = x || nativeQuality ? ["1K", "2K", "4K"] : fixedTier(model.id) ? [fixedTier(model.id)!.toUpperCase()] : model.id === "seedream-5.0-pro-x" ? ["1K", "2K"] : [];
  const { maxInputImages: _oldMax, supportedMimeTypes: _oldMime, ...oldLimits } = model.limits ?? {};
  return { ...model, operations, parameters, description: doc.intro, inputKinds: doc.editing ? ["text", "image", "image[]"] : ["text"], outputKinds: ["image", "image[]"],
    limits: { ...oldLimits, ...(doc.maxReferences !== undefined ? { maxInputImages: doc.maxReferences } : {}), ...(nano ? { supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"] } : {}) },
    metadata: { ...metadata, canvasRunnable: !denied, protocol: "rest", cangyuanCurrentContract: model.id, imageNativeParameterContract: true,
      operationsSource: "declared", outputKindsSource: "declared", catalogCapability: "image", documentationUrl: doc.sourceUrl, contractCheckedAt: doc.checkedAt, imageContractDocumentSha256: doc.sha256,
      imageSupportedResolutions: supported, imageRequestResolutions: x || nativeQuality || fixedTier(model.id) ? supported : [],
      ...(x || nativeQuality ? { imageNativeResolutionParameter: x ? "tier" : "quality", imageNativeResolutionOptions: true, imageNativeQualityOptions: true } : { imageResolutionMode: fixedTier(model.id) ? "fixed-model-tier" : "provider-decided" }),
      ...(fixedTier(model.id) ? { imageFixedResolution: fixedTier(model.id)!.toUpperCase() } : {}),
      imagePixelBudgetPublished: false, imageCustomPixels: doc.customPixels, imageOutputEncodingFields: doc.fields.output_format ? ["output_format"] : [],
      ...(doc.referenceDimensions ? { imageOutputReferenceDimensions: doc.referenceDimensions } : {}),
      imageOutputEncodingDeclared: Boolean(doc.fields.output_format), imageOutputTransport: "url", supportsMask: Boolean(doc.fields.mask),
      remoteMediaUrlsOnly: !/^grok-imagine-image(?:-2\.0)?$/u.test(model.id), ...(nano ? { maxInputImageBytes: 35 * 1024 * 1024 } : {}),
      ...(mj || model.id === "midjourney-v7" ? { multipleOutputsPerRequest: true } : {}),
    } };
}

export function cangyuanDocumentedImageTransport(id: string, parameters?: Readonly<Record<string, unknown>>): RestModelConnectorOverride | undefined {
  const doc = CANGYUAN_IMAGE_DOCUMENTS[id]; if (!doc) return undefined;
  const x = id === "gpt-image-2-x" || id === "gpt-image-2.5-x";
  const mj = /^midjourney-[12]k$/u.test(id);
  const mappings: RestRequestMapping[] = [
    { target: "/model", source: { kind: "request", path: "$.model" } },
    { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
    { target: "/size", source: { kind: "request", path: "$.parameters.aspect_ratio" }, omitIfUndefined: true, omitValues: ["auto"] },
    ...(doc.customPixels || doc.pixelOptions.length ? [{ target: "/size", source: { kind: "request" as const, path: "$.parameters.size" }, omitIfUndefined: true, omitValues: ["auto"] }] : []),
    ...["tier", "series", "quality", "speed", "reference", "output_format"].flatMap((key): RestRequestMapping[] => doc.fields[key] ? [{ target: `/${key}`,
      source: { kind: "request", path: `$.parameters.${key}` }, omitIfUndefined: true,
      ...(x && key === "quality" ? { when: [{ path: "$.parameters.tier", values: kTiers }] } : {}) }] : []),
  ];
  const response = { taskIdPath: "$.id", taskIdFallbackPaths: ["$.task_id"], statusPath: "$.status", errorPath: "$.error.message", progressPath: "$.progress" };
  const editPath = mj && parameters?.reference !== "editor" ? "/v1/images/generations" : "/v1/images/edits";
  const submit = (edit: boolean) => ({ path: edit ? editPath : "/v1/images/generations", method: "POST" as const, bodyMode: "json" as const,
    template: { async: true, n: 1, response_format: "url" }, mappings: [...mappings,
      ...(edit ? [{ target: "/images", source: { kind: "assets" as const, assetKind: "image" as const }, omitIfEmpty: true }] : []),
      ...(edit && doc.fields.mask ? [{ target: "/mask", source: { kind: "request" as const, path: "$.parameters.mask" }, omitIfUndefined: true, omitIfEmpty: true,
        ...(id === "gpt-image-2-x" ? { when: [{ path: "$.parameters.tier", values: kTiers }] } : {}) },
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
  const x = request.model === "gpt-image-2-x" || request.model === "gpt-image-2.5-x";
  const allowed = new Set((model.parameters ?? []).map(row => row.key));
  for (const key of Object.keys(p)) if (!allowed.has(key) && key !== "size_tier") add(`parameters.${key}`, `${request.model} 官网 Images 合同未声明 ${key}，请重新选择当前参数。`);
  for (const parameter of model.parameters ?? []) {
    const value = p[parameter.key];
    if (parameter.required && value === undefined) add(`parameters.${parameter.key}`, `必须选择${parameter.label}。`);
    if (value !== undefined && parameter.control === "select" && !parameter.options?.some(option => String(option.value) === String(value)))
      add(`parameters.${parameter.key}`, `${request.model} 不支持 ${parameter.key}=${String(value)}。`);
  }
  if (p.size !== undefined && doc.customPixels && p.size !== "auto" && !/^\d+x\d+$/u.test(String(p.size))) add("parameters.size", "自定义宽高必须为 WIDTHxHEIGHT。");
  if (/^\d+x\d+$/u.test(String(p.size)) && String(p.size).split("x").some(v => !Number.isSafeInteger(Number(v)) || Number(v) <= 0)) add("parameters.size", "图片宽高必须为正整数。");
  if (p.n !== undefined && p.n !== 1) add("parameters.n", "一次请求只能 n=1；返回多张的型号仍按一次请求。 ");
  if (!doc.editing && request.operation === "image.edit") add("operation", "该完整型号只支持文生图。");
  if (x && p.tier === undefined && p.quality !== undefined) add("parameters.tier", "带质量参数的旧请求必须先选择明确的 1k / 2k / 4k 清晰度档。");
  const masks = request.assets?.filter(a => a.role === "mask") ?? [];
  const maskAllowed = Boolean(doc.fields.mask) && request.operation === "image.edit" && (request.model !== "gpt-image-2-x" || kTiers.includes(String(p.tier))) && (!/^midjourney-[12]k$/u.test(request.model!) || p.reference === "editor");
  if ((p.mask || masks.length) && !maskAllowed) add("parameters.mask", "当前完整型号、档位或模式不支持蒙版。");
  if (masks.length > 1) add("assets", "最多支持 1 张蒙版。");
  if (p.mask && !/^https:\/\//u.test(String(p.mask))) add("parameters.mask", "蒙版必须为公网 HTTPS 地址。");
  const refs = request.assets?.filter(a => a.kind === "image" && a.role !== "mask") ?? [];
  const limit = request.model === "gpt-image-2.5-x" && p.tier === "web" ? 9 : doc.maxReferences;
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

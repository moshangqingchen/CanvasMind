import type { ModelDescriptor, NormalizedRequest, ValidationIssue } from "./contracts.js";
import type { ImageEditingConnection } from "./image-editing-capabilities.js";

export const JIJIU_IMAGE_DOCS = "https://newapi.jijiucanvas.com/docs/api-docs.md";
export const JIJIU_GPT_IMAGE_IDS = ["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-sunburst", "gpt-image-2-2K/4K"] as const;
export const JIJIU_GEMINI_IMAGE_IDS = ["gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-nano-banana-2.1"] as const;
export const JIJIU_IMAGE_IDS: readonly string[] = [...JIJIU_GPT_IMAGE_IDS, ...JIJIU_GEMINI_IMAGE_IDS];
function explicitlyUnavailable(model: ModelDescriptor): boolean {
  const reason = String(model.metadata?.canvasUnavailableReason ?? "");
  return /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthorized|forbidden|not.?returned|unavailable|disabled/iu.test(reason) ||
    model.metadata?.canvasRunnable === false && !/接口|协议|合同|尚未.*(?:适配|内置)|参数.*待/iu.test(reason);
}
export function jijiuImageOrigin(value: unknown): string | undefined {
  try { const u = new URL(String(value));
    if (u.origin === "https://newapi.jijiucanvas.com" && !u.username && !u.password && !u.search && !u.hash && /^(?:\/v1)?\/?$/u.test(u.pathname)) return u.origin;
  } catch { /* Ordinary connection validation reports malformed addresses. */ }
}
export function isJijiuGptImage(config: Readonly<Record<string, unknown>>, id: string): boolean {
  return !!jijiuImageOrigin(config.baseUrl) && (JIJIU_GPT_IMAGE_IDS as readonly string[]).includes(id);
}
export function jijiuImageGroupAllowed(config: Readonly<Record<string, unknown>>, id: string): boolean {
  const group = String(config.accountKeyGroup ?? config.modelGroup ?? "");
  if (config.accountKeyGroup && config.modelGroup && config.accountKeyGroup !== config.modelGroup) return false;
  const groups = (JIJIU_GEMINI_IMAGE_IDS as readonly string[]).includes(id)
    ? id === "gemini-nano-banana-2.1" ? ["图片-香蕉Pro1K/2K/4K"] : ["default", "图片-香蕉Pro1K/2K/4K"]
    : id === "gpt-image-2-2K/4K" ? ["default", "图片-GPT-image-2-2K/4K"] : ["default", "图片-GPT-image-2/2.5-1K"];
  return groups.includes(group) && config.supplierArchived !== true && !["agent", "disabled"].includes(String(config.usage)) &&
    !["unauthorized", "empty"].includes(String(config.modelScanStatus)) &&
    (!Array.isArray(config.scannedModelIds) || config.scannedModelIds.includes(id));
}

/** Exact supplier cards declare tiers, but do not publish a GPT pixel matrix. */
export function applyJijiuImageCapabilities(connection: ImageEditingConnection, model: ModelDescriptor): ModelDescriptor {
  if (!["openai", "rest"].includes(connection.provider) || !jijiuImageOrigin(connection.config.baseUrl) || !JIJIU_IMAGE_IDS.includes(model.id)) return model;
  if (model.metadata?.source === "manual" || model.metadata?.protocolEvidence === "paid-test" || explicitlyUnavailable(model)) return model;
  if (model.metadata?.operationsSource === "declared" && !model.operations.some(operation => operation.startsWith("image."))) return model;
  if (model.metadata?.outputKindsSource === "declared" && !model.outputKinds?.some(k => k === "image" || k === "image[]")) return model;
  if (!jijiuImageGroupAllowed(connection.config, model.id)) return { ...model, metadata: { ...model.metadata, canvasRunnable: false, canvasUnavailableReason: "当前极九 Key 或分组没有此完整图片型号权限" } };
  const gemini = (JIJIU_GEMINI_IMAGE_IDS as readonly string[]).includes(model.id);
  const tiers = gemini || model.id === "gpt-image-2-2K/4K" ? ["1K", "2K", "4K"] : ["1K"];
  const metadata: Record<string, unknown> = { ...model.metadata, canvasRunnable: true, autoInterfaceStatus: "connected", jijiuImageContract: true,
    protocol: gemini ? "gemini-generate-content" : "openai-images", operationsSource: "declared", outputKindsSource: "declared",
    imageNativeParameterContract: true, imageNativeResolutionOptions: true, imageNativeResolutionParameter: gemini ? "image_size" : "size",
    imageSupportedResolutions: tiers, imageRequestResolutions: gemini ? tiers : [], imageResolutionMode: "native-variable-pixels",
    imagePixelBudgetPublished: false, imageOutputEncodingDeclared: false, imageNativeQualityOptions: true,
    imageParameterContractNote: gemini ? "官网声明 1K / 2K / 4K；未公布逐比例像素、自定义宽高、质量与编码规则，实际像素以原图为准。"
      : "官网未公布逐比例像素、自定义宽高、质量与编码规则。保留上游默认尺寸；1024 × 1024 仅为官方请求示例，不能推导其他档位像素。",
    supportsImageEdit: true, supportsReferenceImages: true, parameterControlsUnavailable: false,
    documentationUrl: JIJIU_IMAGE_DOCS, protocolEvidence: "supplier-documentation", parameterSource: "supplier-documentation-and-exact-model-card",
    generationVerified: false, contractCheckedAt: "2026-10-10" };
  delete metadata.canvasUnavailableReason;
  for (const key of ["imageOutputDimensions", "imageOutputReferenceDimensions", "imageFixedResolution", "imageResolutionProfiles", "imageNativeQualityParameter", "maxInputImageBytes"])
    delete metadata[key];
  const limits = { ...model.limits, maxOutputImages: 1 };
  delete limits.maxInputImages;
  return { ...model, operations: ["image.generate", "image.edit"], capabilities: ["image.generate", "image.edit"], inputKinds: ["text", "image", "image[]"], outputKinds: ["image"], limits,
    parameters: gemini ? [
      { key: "image_size", label: "分辨率档位", control: "select", valueType: "string", default: "auto", options: [
        { value: "auto", label: "自动（供应商默认）" }, ...tiers.map(value => ({ value, label: value }))] },
      { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: "auto", options: [{ value: "auto", label: "自动（以原图为准）" }] },
      { key: "n", label: "生成张数", control: "number", valueType: "integer", default: 1, min: 1, max: 1 },
    ] : [
      { key: "size", label: "输出尺寸", control: "select", valueType: "string", default: "auto", options: [
        { value: "auto", label: "自动 · 比例与像素由供应商决定" },
        ...(model.id === "gpt-image-2-2K/4K" ? [] : [{ value: "1024x1024", label: "1K · 1:1 · 1024 × 1024（官方示例）" }])], description: String(metadata.imageParameterContractNote) },
      { key: "n", label: "生成张数", control: "number", valueType: "integer", default: 1, min: 1, max: 1 },
    ], metadata };
}

export function jijiuGptImageParameters(input: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { n: input.n ?? 1, ...(input.size !== undefined && input.size !== "auto" ? { size: input.size } : {}) };
}
export function jijiuGptImageRequestIssues(connection: ImageEditingConnection, request: NormalizedRequest): ValidationIssue[] {
  const issues: ValidationIssue[] = [], input = request.parameters ?? {}, id = request.model ?? "";
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });
  if (!isJijiuGptImage(connection.config, id) || !jijiuImageGroupAllowed(connection.config, id)) add("model", "model_group_mismatch", "当前极九 Key 或分组不支持此完整图片型号");
  const saved = Array.isArray(connection.config.modelCatalogModels) ? (connection.config.modelCatalogModels as ModelDescriptor[]).find(m => m.id === id) : undefined;
  if (saved && (explicitlyUnavailable(saved) || saved.metadata?.outputKindsSource === "declared" && !saved.outputKinds?.some(k => k === "image" || k === "image[]")))
    add("model", "model_unavailable", "当前型号已记录不可用或非图片输出，请重新核对当前 Key");
  if (!["image.generate", "image.edit"].includes(request.operation)) add("operation", "unsupported_operation", "极九图片接口仅用于图片生成和编辑");
  if (!request.prompt.trim()) add("prompt", "required", "请输入图片描述");
  if (input.n !== undefined && input.n !== 1) add("parameters.n", "invalid_count", "当前画布一次请求生成一张图片");
  if (input.size !== undefined && input.size !== "auto" && !(input.size === "1024x1024" && id !== "gpt-image-2-2K/4K")) add("parameters.size", "undocumented_size", "此型号未公布该像素组合，请选择供应商默认尺寸或已列出的官方示例");
  for (const key of ["quality", "output_format", "output_compression", "width", "height", "resolution", "image_size", "size_tier", "aspect_ratio", "aspectRatio", "ratio", "response_format", "background"])
    if (input[key] !== undefined && input[key] !== "auto") add(`parameters.${key}`, "undocumented_parameter", "极九当前完整型号未公布此参数组合；已保存的值不会静默替换");
  const assets = request.assets ?? [];
  if (request.operation === "image.edit" && !assets.length) add("assets", "reference_required", "图片编辑需要参考图");
  if (request.operation === "image.generate" && assets.length) add("operation", "reference_operation", "带参考图时请选择图片编辑");
  for (const asset of assets) {
    if (asset.kind !== "image" || asset.role === "mask") add("assets", "unsupported_asset", "该供应商只声明参考图片，未声明蒙版编辑");
    try { const u = new URL(asset.url ?? ""); if (!["https:", "http:"].includes(u.protocol) || u.username || u.password || /^(localhost|127\.|0\.|\[?::1)/iu.test(u.hostname)) throw Error(); }
    catch { if (!(asset.data?.length && connection.config.referenceImageHosting === "litterbox-24h")) add("assets", "public_reference_required", "极九图片编辑要求公网图片 URL，请先配置素材托管"); }
  }
  return issues;
}

export function jijiuGeminiParameterIssues(input: Readonly<Record<string, unknown>> = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const key of ["quality", "output_format", "output_compression", "width", "height", "response_format", "background"])
    if (input[key] !== undefined && input[key] !== "auto") issues.push({ path: `parameters.${key}`, code: "undocumented_parameter", message: "极九此图片型号未公布该参数，不能静默忽略已保存值" });
  const tiers = ["image_size", "imageSize", "resolution", "size_tier", "size"].filter(key => input[key] !== undefined).map(key => input[key]);
  if (new Set(tiers).size > 1) issues.push({ path: "parameters.image_size", code: "conflicting_resolution", message: "已保存的分辨率字段冲突，请明确选择档位" });
  const ratios = ["aspect_ratio", "aspectRatio", "ratio"].filter(key => input[key] !== undefined).map(key => input[key]);
  if (new Set(ratios).size > 1) issues.push({ path: "parameters.aspect_ratio", code: "conflicting_aspect_ratio", message: "已保存的画面比例字段冲突，请明确选择比例" });
  if (ratios.some(value => value !== "auto")) issues.push({ path: "parameters.aspect_ratio", code: "undocumented_aspect_ratio", message: "极九此图片型号未公布比例枚举，已有比例保留并阻止提交，不静默换成默认构图" });
  return issues;
}

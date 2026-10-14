import type { ModelDescriptor, NormalizedRequest, ProviderAssetInput, ResolvedProviderConnection, ValidationIssue } from "./contracts.js";
import { failedTransparentImageEvidence, latestFailedTransparentImageEvidence, verifiedTransparentImageEvidence,
  type TransparentImageEvidence, type TransparentImageOperation } from "./transparent-image-evidence.js";
import { CANGYUAN_IMAGE_DOCUMENTS } from "./cangyuan-image-documents.js";

export interface ImageEditingConnection {
  provider: string;
  config: Readonly<Record<string, unknown>>;
}
export interface ImageEditingCapabilities {
  transparent: boolean;
  mask: "multipart" | "url" | null;
  transparency?: {
    status: "verified" | "inferred" | "declared" | "rejected" | "unverified";
    operation: TransparentImageOperation;
    checkedAt?: string;
    source?: string;
    note: string;
    request?: TransparentImageEvidence["request"];
    output?: TransparentImageEvidence["output"];
  };
}

function cangyuanEditingDocument(connection: ImageEditingConnection, modelId: string) {
  if (connection.provider !== "rest" || connection.config.manualProtocol === true || connection.config.autoProtocol === false) return undefined;
  try {
    const url = new URL(String(connection.config.baseUrl ?? ""));
    return url.protocol === "https:" && ["ai.cangyuansuanli.cn", "vip-api.cangyuansuanli.cn", "direct-api.cangyuansuanli.cn"].includes(url.hostname)
      ? CANGYUAN_IMAGE_DOCUMENTS[modelId] : undefined;
  } catch { return undefined; }
}

const image25 = new Set(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
const monsterModels = new Set(["gpt-image-2", "gpt-image-2.5", ...image25,
  "gpt-image-2.5-flare-high", "gpt-image-2.5-flare-max", "gpt-image-2.5-sunburst-high", "gpt-image-2.5-sunburst-max"]);

/** Browser-safe, exact supplier contracts. Model-family resemblance is not evidence. */
function declaredImageEditingCapabilities(connection: ImageEditingConnection, modelId: string,
  parameters: Readonly<Record<string, unknown>> = {}): ImageEditingCapabilities {
  const config = connection.config;
  const none: ImageEditingCapabilities = { transparent: false, mask: null };
  if (config.supplierArchived === true || ["agent", "disabled"].includes(String(config.usage))) return none;
  let url: URL;
  try { url = new URL(String(config.baseUrl ?? "")); } catch { return none; }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash ||
      !/^(?:\/v1)?\/?$/u.test(url.pathname)) return none;
  const group = String(config.accountKeyGroup ?? config.modelGroup ?? "");
  if (["openai", "rest"].includes(connection.provider) && url.hostname === "vapi.chuangxiangai.asia" && group === "生图" &&
      /^midjourney-(?:1k|2k)$/u.test(modelId) && parameters.reference === "editor") return { transparent: false, mask: "url" };
  if (connection.provider === "openai") {
    if (url.hostname === "token.secure-skill.com") return { transparent: modelId === "gpt-image-2", mask: null };
    if (url.hostname === "tu.988236.xyz") return { transparent: group === "image2.5全参" && image25.has(modelId), mask: null };
    if (url.hostname === "api.eaheng.com") return { transparent: group === "B4-GPT生图原生渠道V3（高质量）" && monsterModels.has(modelId), mask: null };
    if (url.hostname === "genimage.pro") return { transparent: ["default", "gptResponseBase64", "geminiResponseUrl"].includes(group) && image25.has(modelId), mask: null };
    if (["platform.frimodel.com", "api.frimodel.com"].includes(url.hostname)) return { transparent: false, mask: modelId === "gpt-image-2" ? "multipart" : null };
    if (url.hostname === "vapi.chuangxiangai.asia") return { transparent: false,
      mask: group === "生图" && /^gpt-image-2-(?:1k|2k|4k)$/u.test(modelId) ? "url" : null };
    if (["tk1688.com", "api.tk1688.com"].includes(url.hostname)) return { transparent: false,
      mask: group === "default" && modelId === "gpt-image-1" ? "multipart" : null };
  }
  if (connection.provider === "rest" && ["ai.cangyuansuanli.cn", "vip-api.cangyuansuanli.cn", "direct-api.cangyuansuanli.cn"].includes(url.hostname)) {
    if (config.manualProtocol === true || config.autoProtocol === false ||
        Array.isArray(config.manualModels) && config.manualModels.some(row => !!row && typeof row === "object" && (row as Record<string, unknown>).id === modelId)) return none;
    const doc = CANGYUAN_IMAGE_DOCUMENTS[modelId];
    if (!doc) return none;
    return { transparent: doc.parameterRules?.background?.enum?.includes("transparent") === true,
      mask: doc.editing && Boolean(doc.fields.mask) && (Boolean(doc.parameterRules) ||
        (!/^midjourney-[12]k$/u.test(modelId) || parameters.reference === "editor")) ? "url" : null };
  }
  return none;
}

export function getImageEditingCapabilities(connection: ImageEditingConnection, modelId: string,
  parameters: Readonly<Record<string, unknown>> = {}, operation: TransparentImageOperation = "image.generate"): ImageEditingCapabilities {
  const declared = declaredImageEditingCapabilities(connection, modelId, parameters);
  const verified = verifiedTransparentImageEvidence(connection, modelId, parameters, operation);
  const failed = failedTransparentImageEvidence(connection, modelId, parameters, operation);
  const sample = failed ?? latestFailedTransparentImageEvidence(connection, modelId, parameters, operation);
  if (failed) return { ...declared, transparent: false, transparency: {
    status: failed.reason === "background-rejected" ? "rejected" : "unverified", operation,
    checkedAt: failed.checkedAt, ...(failed.source ? { source: failed.source } : {}),
    note: failed.reason === "background-rejected"
      ? `此分组、完整型号的${operation === "image.edit" ? "参考编辑" : "生成"}接口已拒绝 background=transparent；普通模式保留。`
      : `此组合 ${failed.checkedAt} 请求的原 PNG 没有透明像素；这是该次尺寸/质量的结果，不代表永久不支持透明。`,
    request: failed.request,
  } };
  if (verified) {
    const changed = parameters.size === "auto" || parameters.quality === "auto" ||
      ["size", "quality"].some(key => parameters[key] !== undefined && parameters[key] !== verified.request[key]) ||
      ["size_tier", "resolution", "image_size"].some(key => parameters[key] !== undefined && parameters[key] !== "auto" &&
        (parameters.size === undefined || parameters.size === "auto"));
    const requested = String(verified.request.size ?? "auto");
    const pixels = `${verified.output.width}×${verified.output.height}`;
    return { ...declared, transparent: true, transparency: { status: changed ? "inferred" : "verified", operation,
      checkedAt: verified.checkedAt, source: verified.source ?? "supplier-original-alpha",
      request: verified.request, output: verified.output,
      note: `${verified.checkedAt} 同分组、完整型号${operation === "image.edit" ? "参考编辑" : "生成"}原 PNG 已有真实 alpha；请求 ${requested} / ${String(verified.request.quality ?? "渠道质量")}，原图 ${pixels}。${changed ? "当前其他档位由此证据推定，未逐档收费实测。" : ""}${verified.output.requestedDimensionsMatched === false ? "原图像素与请求不同，不能当作精确尺寸通过。" : ""}`,
    } };
  }
  if (connection.provider === "openai" && /^gpt-image-2\.5(?:-(?:flare|sunburst))?$/u.test(modelId) &&
      /^https:\/\/token\.secure-skill\.com(?:\/v1)?\/?$/u.test(String(connection.config.baseUrl ?? "")))
    return { ...declared, transparent: false, transparency: { status: "rejected", operation,
      source: "https://token.secure-skill.com/docs#gpt-image", checkedAt: "2026-10-14",
      note: "供应商当前 GPT Image 2.5 文档明确：background 字段被忽略，不会出透明底；该声明与参数请求拒绝分别记录。" } };
  return { ...declared, transparency: { status: declared.transparent ? "declared" : "unverified", operation,
    ...(sample ? { checkedAt: sample.checkedAt, ...(sample.source ? { source: sample.source } : {}), request: sample.request } : {}),
    note: sample ? "同身份已有一次不透明原图；当前尺寸/质量尚无透明成功证据，未判为永久不支持。"
      : declared.transparent ? "当前供应商协议声明透明；此操作的当前参数未分别实测。" : "此供应商分组、完整型号及操作尚无透明成功或明确协议证据。",
  } };
}

/** Preserve existing normal/mask routing when a declared contract gains live proof. */
export function usesDeclaredImagesEditingRoute(connection: ImageEditingConnection, modelId: string,
  parameters: Readonly<Record<string, unknown>> = {}): boolean {
  const declared = declaredImageEditingCapabilities(connection, modelId, parameters);
  return connection.provider === "openai" && (declared.transparent || declared.mask === "multipart");
}

export function imageEditingConnection(connection: ResolvedProviderConnection): ImageEditingConnection {
  const nested = connection.settings?.config;
  return { provider: connection.provider, config: {
    ...(nested && typeof nested === "object" && !Array.isArray(nested) ? nested : {}),
    ...connection.settings, baseUrl: connection.baseUrl,
  } };
}

/** Rebuild reference controls only where original files prove this exact operation. */
export function applyVerifiedImageEditingCapabilities(connection: ImageEditingConnection, model: ModelDescriptor): ModelDescriptor {
  if (model.metadata?.source === "manual" || model.metadata?.source === "paid-test" || model.metadata?.protocolEvidence === "paid-test") return model;
  const evidence = verifiedTransparentImageEvidence(connection, model.id, {}, "image.edit");
  if (!evidence) return model;
  const parameters = (model.parameters ?? []).map(p => ["background", "output_format"].includes(p.key)
    ? { ...p, operations: [...new Set([...(p.operations ?? model.operations), "image.edit" as const])] } : p);
  if (!parameters.some(p => p.key === "background")) parameters.push({ key: "background", label: "背景", control: "select", valueType: "string",
    default: "opaque", options: [{ label: "普通", value: "opaque" }, { label: "透明", value: "transparent" }], operations: ["image.edit"],
    description: getImageEditingCapabilities(connection, model.id, {}, "image.edit").transparency!.note });
  if (!parameters.some(p => p.key === "output_format")) parameters.push({ key: "output_format", label: "图片编码", control: "select", valueType: "string",
    default: "png", options: [{ label: "PNG", value: "png" }], operations: ["image.edit"], description: "同身份参考编辑原 PNG 的 alpha 已验证；透明模式使用 PNG。" });
  return { ...model, operations: [...new Set([...model.operations, "image.edit" as const])],
    inputKinds: [...new Set([...(model.inputKinds ?? ["text"]), "image" as const])], parameters,
    metadata: { ...model.metadata, supportsImageEdit: true, referenceEditEndpoint: evidence.transport.path,
      imageTransparentEditEvidence: { checkedAt: evidence.checkedAt, supplierGroupId: evidence.supplierGroupId ?? evidence.group,
        fullModelId: evidence.model, operation: "image.edit", source: evidence.source ?? "supplier-original-alpha",
        request: evidence.request, output: evidence.output }, imageLowerResolutionDefaultSource:
        evidence.request.size === "3840x2160" && evidence.output.requestedDimensionsMatched === true
          ? "same-identity-highest-sample-inference;not-separate-paid-tests"
          : "same-identity-alpha-sample;input-presets-and-actual-output-dimensions-separate" } };
}

export function imageReferenceAssets(assets: readonly ProviderAssetInput[] = []): ProviderAssetInput[] {
  return assets.filter(asset => asset.role !== "mask");
}

export function imageEditingRequestIssues(connection: ImageEditingConnection, request: NormalizedRequest): ValidationIssue[] {
  const operation = request.operation === "image.edit" ? "image.edit" : "image.generate";
  const capabilities = getImageEditingCapabilities(connection, request.model ?? "", request.parameters, operation);
  const issues: ValidationIssue[] = [];
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });
  if (request.parameters?.background === "transparent") {
    if (!capabilities.transparent) {
      const failed = failedTransparentImageEvidence(connection, request.model ?? "", request.parameters, operation);
      const onlyGeneration = operation === "image.edit" && !failed &&
        verifiedTransparentImageEvidence(connection, request.model ?? "", request.parameters, "image.generate");
      add("parameters.background", onlyGeneration ? "unverified_transparent_edit" : failed ? "transparent_test_failed" : "unsupported_background", onlyGeneration
        ? "此线路仅验证透明文生图；参考图/编辑透明尚未验证。" : failed
        ? capabilities.transparency!.note
        : "当前供应商分组和型号未确认支持透明背景，请选择普通模式。");
    }
    else if (request.operation === "image.edit" &&
      !declaredImageEditingCapabilities(connection, request.model ?? "", request.parameters).transparent &&
      !verifiedTransparentImageEvidence(connection, request.model ?? "", request.parameters, "image.edit"))
      add("parameters.background", "unverified_transparent_edit", "此线路仅验证透明文生图；参考图/编辑透明尚未验证。");
    const format = request.parameters.output_format;
    const declaredWebp = format === "webp" && cangyuanEditingDocument(connection, request.model ?? "")?.parameterRules?.output_format?.enum?.includes("webp");
    if (format !== undefined && format !== "png" && format !== "auto" && !declaredWebp)
      add("parameters.output_format", "transparent_requires_png", "透明模式必须使用 PNG 输出。");
  }
  const masks = request.assets?.filter(asset => asset.role === "mask") ?? [];
  const legacyMask = request.parameters?.mask;
  if (!masks.length && !legacyMask) return issues;
  if (!capabilities.mask) add("assets", "unsupported_mask", "当前供应商分组、型号或档位不支持蒙版局部编辑。");
  if (request.operation !== "image.edit") add("operation", "mask_requires_edit", "蒙版只能与原图一起用于图片编辑。");
  const originals = imageReferenceAssets(request.assets).filter(asset => asset.kind === "image");
  if (!originals.length) add("assets", "mask_requires_image", "蒙版编辑需要原始图片。");
  if (masks.length > 1 || (masks.length && legacyMask)) add("assets", "multiple_masks", "每次局部编辑只能提交一张蒙版。");
  for (const mask of masks) {
    if (mask.kind !== "image" || mask.mimeType.split(";", 1)[0]?.trim().toLowerCase() !== "image/png")
      add("assets", "invalid_mask", "蒙版必须是包含透明通道的 PNG 图片。");
    if (!mask.data && !mask.url) add("assets", "invalid_mask", "蒙版缺少图片数据。");
    if (capabilities.mask === "url" && mask.url) {
      try {
        const url = new URL(mask.url);
        if (url.protocol !== "https:" || url.username || url.password) throw new Error();
      } catch { add("assets", "invalid_mask_url", "蒙版地址必须是 HTTPS 图片链接。"); }
    }
  }
  if (legacyMask) {
    if (capabilities.mask !== "url") add("parameters.mask", "mask_requires_asset", "此接口需要上传 PNG 蒙版文件。");
    try {
      const url = new URL(String(legacyMask));
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    } catch { add("parameters.mask", "invalid_mask_url", "蒙版地址必须是 HTTPS 图片链接。"); }
  }
  return issues;
}

/** Normal mode is explicit on declared routes; unsupported routes receive no extra field. */
export function normalizeImageEditingParameters(connection: ImageEditingConnection, model: string,
  parameters: Readonly<Record<string, unknown>> = {}, operation: TransparentImageOperation = "image.generate"): Record<string, unknown> {
  const result = { ...parameters };
  // Native fields are optional. Preserve the user's explicit auto/opaque value
  // and encoding; validation checks transparent combinations before submission.
  if (cangyuanEditingDocument(connection, model)?.parameterRules?.background?.enum?.includes("transparent")) return result;
  // A failed transparency test does not change declared normal-mode fields or routing.
  if (getImageEditingCapabilities(connection, model, parameters, operation).transparent ||
    declaredImageEditingCapabilities(connection, model, parameters).transparent) {
    result.background ??= "opaque";
    if (result.background === "transparent") result.output_format = "png";
  } else if (result.background === "opaque" || result.background === "auto") delete result.background;
  return result;
}

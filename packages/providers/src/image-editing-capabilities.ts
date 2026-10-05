import type { NormalizedRequest, ProviderAssetInput, ResolvedProviderConnection, ValidationIssue } from "./contracts.js";
import { verifiedTransparentImageEvidence } from "./transparent-image-evidence.js";

export interface ImageEditingConnection {
  provider: string;
  config: Readonly<Record<string, unknown>>;
}
export interface ImageEditingCapabilities {
  transparent: boolean;
  mask: "multipart" | "url" | null;
}

const image25 = new Set(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
const monsterModels = new Set(["gpt-image-2", "gpt-image-2.5", ...image25,
  "gpt-image-2.5-flare-high", "gpt-image-2.5-flare-max", "gpt-image-2.5-sunburst-high", "gpt-image-2.5-sunburst-max"]);
const cangyuanMaskModels = new Set(["gpt-image-2-1k", "gpt-image-2-2k", "gpt-image-2-4k",
  "gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);

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
  if (connection.provider === "openai") {
    if (url.hostname === "token.secure-skill.com") return { transparent: modelId === "gpt-image-2", mask: null };
    if (url.hostname === "tu.988236.xyz") return { transparent: group === "image2.5全参" && image25.has(modelId), mask: null };
    if (url.hostname === "api.eaheng.com") return { transparent: group === "B4-GPT生图原生渠道V3（高质量）" && monsterModels.has(modelId), mask: null };
    if (url.hostname === "genimage.pro") return { transparent: ["default", "gptResponseBase64", "geminiResponseUrl"].includes(group) && image25.has(modelId), mask: null };
    if (["platform.frimodel.com", "api.frimodel.com"].includes(url.hostname)) return { transparent: false, mask: modelId === "gpt-image-2" ? "multipart" : null };
    if (url.hostname === "vapi.chuangxiangai.asia") return { transparent: false,
      mask: group === "生图" && /^gpt-image-2(?:\.5-(?:flare|sunburst))?-(?:1k|2k|4k)$/u.test(modelId) ? "url" : null };
    if (["tk1688.com", "api.tk1688.com"].includes(url.hostname)) return { transparent: false,
      mask: group === "default" && modelId === "gpt-image-1" ? "multipart" : null };
  }
  if (connection.provider === "rest" && ["ai.cangyuansuanli.cn", "vip-api.cangyuansuanli.cn", "direct-api.cangyuansuanli.cn"].includes(url.hostname)) {
    return { transparent: false, mask: cangyuanMaskModels.has(modelId) ||
      (modelId === "gpt-image-2-x" && ["1k", "2k", "4k"].includes(String(parameters.tier))) ? "url" : null };
  }
  return none;
}

export function getImageEditingCapabilities(connection: ImageEditingConnection, modelId: string,
  parameters: Readonly<Record<string, unknown>> = {}): ImageEditingCapabilities {
  const declared = declaredImageEditingCapabilities(connection, modelId, parameters);
  return { ...declared, transparent: declared.transparent || Boolean(verifiedTransparentImageEvidence(connection, modelId, parameters)) };
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

export function imageReferenceAssets(assets: readonly ProviderAssetInput[] = []): ProviderAssetInput[] {
  return assets.filter(asset => asset.role !== "mask");
}

export function imageEditingRequestIssues(connection: ImageEditingConnection, request: NormalizedRequest): ValidationIssue[] {
  const capabilities = getImageEditingCapabilities(connection, request.model ?? "", request.parameters);
  const issues: ValidationIssue[] = [];
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });
  if (request.parameters?.background === "transparent") {
    if (!capabilities.transparent) add("parameters.background", "unsupported_background", "当前供应商分组和型号未确认支持透明背景，请选择普通模式。");
    const format = request.parameters.output_format;
    if (format !== undefined && format !== "png" && format !== "auto")
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
  parameters: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const result = { ...parameters };
  if (getImageEditingCapabilities(connection, model, parameters).transparent) {
    result.background = result.background === "transparent" ? "transparent" : "opaque";
    if (result.background === "transparent") result.output_format = "png";
  } else if (result.background === "opaque" || result.background === "auto") delete result.background;
  return result;
}

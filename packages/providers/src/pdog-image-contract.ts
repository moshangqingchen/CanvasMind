import type { ModelDescriptor, ValidationIssue } from "./contracts.js";
import type { ImageSizeTier } from "./image-size-presets.js";
import { parseSupplierGroupDetails } from "./supplier-group-details.js";
import { verifiedTransparentImageEvidence } from "./transparent-image-evidence.js";
import { pdogAcceptedImageQualityEvidence } from "./pdog-image-quality-evidence.js";

export const PDOG_IMAGE_DOCUMENTATION = "https://ai.whyshy.cn/docs/async-image-api.html";
export const PDOG_GEMINI_DOCUMENTATION = "https://ai.whyshy.cn/docs/gemini-image-api.html";
export const PDOG_GEMINI_LEGACY_UNAVAILABLE = "PDog 香蕉文档仅声明 gemini-3-pro-image 和 gemini-3.1-flash-image-preview；请使用当前分组确认的型号";
const GPT_MODELS = new Set(["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
export const PDOG_IMAGE_QUALITIES = ["low", "medium", "high"] as const;
export const PDOG_IMAGE_25_QUALITIES = PDOG_IMAGE_QUALITIES;
type Connection = { provider: string; config: Readonly<Record<string, unknown>> };

/** Reuse the accepted quality only for the exact historical supplier/group/full ID. */
export function pdogImageMeasuredQuality(config: Readonly<Record<string, unknown>>, model: string | undefined) {
  if (!model || !isPdogImageConnection(config, model)) return;
  const evidence = verifiedTransparentImageEvidence({ provider: "openai", config }, model);
  return evidence?.transport.kind === "pdog-async" && evidence.request.quality === "max" ? evidence : undefined;
}

/** Official common values and a separately sourced, exact-scope accepted request value. */
export function pdogImageQualityOptions(model: string | undefined, config: Readonly<Record<string, unknown>> = {}): readonly string[] {
  return pdogImageMeasuredQuality(config, model) ? [...PDOG_IMAGE_QUALITIES, "max"] : PDOG_IMAGE_QUALITIES;
}

/** Match only the documented site origin and ordinary API roots, preserving custom paths. */
export function pdogImageOrigin(baseUrl: unknown): string | undefined {
  if (typeof baseUrl !== "string") return;
  try {
    const url = new URL(baseUrl);
    if (url.protocol === "https:" && url.hostname === "ai.whyshy.cn" && !url.port &&
        !url.username && !url.password && !url.search && !url.hash && ["/", "/v1", "/v1/"].includes(url.pathname)) return url.origin;
  } catch { /* A malformed URL remains the ordinary adapter's validation error. */ }
}

export function isPdogImageConnection(config: Readonly<Record<string, unknown>> | undefined, model?: string): boolean {
  const selected = model ?? config?.defaultModel;
  return !!pdogImageOrigin(config?.baseUrl) && typeof selected === "string" && GPT_MODELS.has(selected) &&
    config?.manualProtocol !== true && config?.usage !== "agent" && config?.usage !== "disabled" && config?.supplierArchived !== true;
}

// The guide publishes these pixels, without declaring them an exclusive enum.
export const PDOG_GPT_IMAGE_SIZES = [
  { tier: "1K", ratio: "1:1", value: "1024x1024" },
  ...Object.entries({ "1:1": "2048x2048", "3:2": "2048x1360", "2:3": "1360x2048", "16:9": "2048x1152", "9:16": "1152x2048",
    "4:3": "2048x1536", "3:4": "1536x2048", "21:9": "2048x896", "9:21": "896x2048" }).map(([ratio, value]) => ({ tier: "2K", ratio, value })),
  ...Object.entries({ "1:1": "2880x2880", "3:2": "3520x2336", "2:3": "2336x3520", "16:9": "3840x2160", "9:16": "2160x3840",
    "4:3": "3312x2480", "3:4": "2480x3312", "21:9": "3840x1648", "9:21": "1648x3840" }).map(([ratio, value]) => ({ tier: "4K", ratio, value })),
] as const;

export function pdogImageSizeForTier(tier: ImageSizeTier, ratio: string): string | undefined {
  return PDOG_GPT_IMAGE_SIZES.find(size => size.tier === tier && size.ratio === ratio)?.value;
}

/** An undeclared tier/ratio pair never invents pixels. The guide's size table is not an exclusive enum. */
export function pdogImageSizeSelection(input: Readonly<Record<string, unknown>> = {}): { size?: unknown; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const explicit = input.size !== undefined && input.size !== "auto" ? input.size : undefined;
  const widthHeight = input.width !== undefined || input.height !== undefined;
  const positiveInteger = (value: unknown) => /^\d+$/u.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const dimensions = widthHeight && positiveInteger(input.width) && positiveInteger(input.height) ? `${input.width}x${input.height}` : undefined;
  if (widthHeight && !dimensions) issues.push({ path: "parameters.size", code: "invalid_size", message: "PDog 自定义 W/H 需同时填写正整数" });
  if (explicit !== undefined && dimensions !== undefined && explicit !== dimensions)
    issues.push({ path: "parameters.size", code: "conflicting_size", message: "PDog 已保存的 size 与独立 W/H 不同，请明确选择尺寸" });
  const size = explicit ?? dimensions;
  const aliases = [input.aspect_ratio, input.aspectRatio, input.ratio].filter(value => value !== undefined && value !== "auto" && value !== "");
  if (new Set(aliases.map(String)).size > 1) issues.push({ path: "parameters.aspect_ratio", code: "conflicting_aspect_ratio", message: "PDog 已保存的画面比例字段不同，请明确选择比例" });
  const ratio = aliases[0];
  const match = typeof ratio === "string" ? /^(\d+):(\d+)$/u.exec(ratio) : null;
  if (ratio !== undefined && (!match || !positiveInteger(match[1]) || !positiveInteger(match[2])))
    issues.push({ path: "parameters.aspect_ratio", code: "invalid_aspect_ratio", message: "PDog 画面比例需为正整数 WIDTH:HEIGHT" });
  if (size !== undefined) {
    const parts = typeof size === "string" ? /^(\d+)x(\d+)$/u.exec(size) : null;
    if (!parts || !positiveInteger(parts[1]) || !positiveInteger(parts[2]))
      issues.push({ path: "parameters.size", code: "invalid_size", message: "PDog 输出尺寸需为正整数 WIDTHxHEIGHT" });
    // Exact documented pairs retain their published rounding, including
    // 2048x896 for 21:9. Custom W/H still uses the existing mismatch guard.
    else if (match && !PDOG_GPT_IMAGE_SIZES.some(documented => documented.value === size && documented.ratio === ratio) &&
      Math.abs(Math.log((Number(parts[1]) / Number(parts[2])) / (Number(match[1]) / Number(match[2])))) > 0.012)
      issues.push({ path: "parameters.aspect_ratio", code: "size_ratio_mismatch", message: "PDog W/H 与已保存的比例偏好不同，请调整尺寸或比例；本次未提交" });
    return { size, issues };
  }
  const tiers = [input.size_tier, input.resolution].filter(value => value !== undefined && value !== "auto" && value !== "").map(value => String(value).toUpperCase());
  if (new Set(tiers).size > 1) issues.push({ path: "parameters.size_tier", code: "conflicting_resolution", message: "PDog 已保存的档位字段不同，请明确选择档位" });
  if (tiers.some(tier => !["1K", "2K", "4K"].includes(tier)))
    issues.push({ path: "parameters.size_tier", code: "invalid_resolution", message: "PDog 文档档位为 1K、2K、4K" });
  if (!tiers.length && ratio === undefined) return { issues };
  const mapped = pdogImageSizeForTier((tiers[0] ?? "1K") as ImageSizeTier, String(ratio ?? "1:1"));
  if (!mapped && !issues.length) issues.push({ path: "parameters.size", code: "missing_documented_size", message: "PDog 未列出此档位与比例的像素映射，请填写独立 W/H；不会自动换比例或补造尺寸" });
  return { ...(mapped ? { size: mapped } : {}), issues };
}

function pdogImageTiers(config: Readonly<Record<string, unknown>>, model: ModelDescriptor): ImageSizeTier[] {
  const group = String(config.modelGroup ?? config.supplierPriceGroup ?? model.metadata?.supplierPriceGroup ?? "");
  const description = String(model.metadata?.supplierGroupDescription ?? config.supplierGroupDescription ?? "");
  const details = parseSupplierGroupDetails({ name: group, description }, "key-groups");
  const named = (["1K", "2K", "4K"] as const).filter(tier => new RegExp(`${tier[0]}\\s*k`, "iu").test(group));
  const exclusive = details?.exclusiveResolutions || named.length === 1 && named[0] === "1K";
  return (["1K", "2K", "4K"] as const).filter(tier => !details?.unsupportedResolutions?.includes(tier) &&
    (!exclusive || (details?.supportedResolutions?.length ? details.supportedResolutions : named).includes(tier)));
}

export function applyPdogImageCapabilities(connection: Connection, model: ModelDescriptor): ModelDescriptor {
  if (connection.provider !== "openai" || !isPdogImageConnection(connection.config, model.id) ||
      model.metadata?.source === "manual" || model.metadata?.source === "paid-test" || model.metadata?.protocolEvidence === "paid-test" ||
      !model.operations.some(operation => operation.startsWith("image.")) || model.metadata?.canvasRunnable === false) return model;
  const tiers = pdogImageTiers(connection.config, model);
  const measuredQuality = pdogImageMeasuredQuality(connection.config, model.id);
  const acceptedQuality = pdogAcceptedImageQualityEvidence(connection.config, model.id);
  const qualities = pdogImageQualityOptions(model.id, connection.config);
  const metadata = { ...model.metadata };
  for (const key of ["imageOutputDimensions", "imageFixedResolution", "imageResolutionProfiles", "imageSizeCapabilitiesSource", "imagePixelBudget", "imageSizeStep", "imageSizeMax", "pdogMeasuredQuality", "imageMeasuredQuality",
    "imageUserSizePresets", "imageUserSizeSourceOptions", "imageUserSizeSourceDescription", "imageUserQualityPresets", "imageUserQualitySourceParameter"])
    delete metadata[key];
  return { ...model, operations: ["image.generate", "image.edit"], capabilities: ["image.generate", "image.edit"],
    inputKinds: ["text", "image", "image[]"], outputKinds: ["image"],
    parameters: [
      { key: "size_tier", label: "分辨率档位", control: "select", valueType: "string", default: tiers.at(-1) ?? "auto", options: [
        { value: "auto", label: "自动" }, ...tiers.map(value => ({ value, label: value })),
      ], description: "档位是应用选择；请求发送官方表映射或用户 W/H 的 size，不发送 size_tier" },
      { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: "auto", allowCustomValue: true, options: [
        { value: "auto", label: "自动" }, ...[...new Set(PDOG_GPT_IMAGE_SIZES.map(size => size.ratio))].map(value => ({ value, label: value })),
      ], description: "官方表已列的比例映射为 size；其他比例请填写独立 W/H。保留已有比例，不向上游补造 aspect_ratio 字段" },
      { key: "size", label: "输出尺寸", control: "dimensions", valueType: "string", default: "auto", options: [
        { value: "auto", label: "自动（使用上游默认尺寸）" },
        ...PDOG_GPT_IMAGE_SIZES.filter(size => tiers.includes(size.tier as ImageSizeTier)).map(size => ({ value: size.value, label: `${size.tier} · ${size.ratio} · ${size.value}` })),
      ], description: "仅列 PDog 官方像素表；size 是开放 WIDTHxHEIGHT，W/H 可独立输入。文档没有公布步长、最长边或总像素范围；原生或放大以当前分组说明为准" },
      { key: "quality", label: "质量", control: "select", valueType: "string", default: qualities.at(-1) ?? "high", options: qualities.map(value => ({ value, label: value })),
        description: measuredQuality
          ? `官网公共字段列 low、medium、high；当前完整型号与原生分组的 ${measuredQuality.checkedAt} 已接受请求另包含 max（${measuredQuality.request.size}、n=${measuredQuality.request.n}），保留原值并作为应用最高质量选择，不改称官网默认或其他分组能力`
          : "PDog GPT Images 文档质量为 low、medium、high，最高为 high；具体质量能力由当前上游决定。旧参数保留，提交前校验，不借其他渠道的扩展质量枚举" },
      { key: "n", label: "生成张数", control: "number", valueType: "integer", default: 1, min: 1, max: 1 },
      { key: "response_format", label: "返回格式", control: "select", valueType: "string", default: "url", options: [
        { value: "url", label: "图片链接" }, { value: "b64_json", label: "Base64" },
      ], description: "异步结果最终保存为图片链接" },
    ], limits: { ...model.limits, maxOutputImages: 1 }, metadata: { ...metadata, protocol: "openai-images",
      pdogImageProtocol: 1, imageNativeParameterContract: true, imageNativeQualityOptions: true,
      imageSupportedResolutions: tiers, imageResolutionTierParameter: "size_tier", imageNativeResolutionParameter: "size_tier",
      imageOutputReferenceDimensions: PDOG_GPT_IMAGE_SIZES.filter(size => tiers.includes(size.tier as ImageSizeTier)).map(size => {
        const [width, height] = size.value.split("x").map(Number);
        return { resolution: size.tier, aspectRatio: size.ratio, width, height };
      }), pdogDocumentedSizes: PDOG_GPT_IMAGE_SIZES,
      qualitySupport: "declared", pdogQualityDocumented: true, pdogQualityVerified: !!measuredQuality,
      ...(acceptedQuality ? { imageMeasuredQuality: acceptedQuality } : {}),
      pdogQualitySource: measuredQuality ? "official-gpt-images-common-field+historical-accepted-request" : "official-gpt-images-common-field",
      ...(measuredQuality ? { pdogMeasuredQuality: { value: measuredQuality.request.quality, checkedAt: measuredQuality.checkedAt,
        hostname: measuredQuality.hostname, group: measuredQuality.group, fullModelId: measuredQuality.model,
        transport: measuredQuality.transport, request: measuredQuality.request } } : {}),
      documentationUrl: PDOG_IMAGE_DOCUMENTATION, parameterControlsUnavailable: false } };
}

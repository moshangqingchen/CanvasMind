import type { ModelDescriptor } from "./contracts.js";
import { IMAGE_SIZE_RATIOS, imageSizeForTier, type ImageSizeTier } from "./image-size-presets.js";

export const PDOG_IMAGE_DOCUMENTATION = "https://ai.whyshy.cn/docs/async-image-api.html";
export const PDOG_GEMINI_DOCUMENTATION = "https://ai.whyshy.cn/docs/gemini-image-api.html";
const GPT_MODELS = new Set(["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
export const PDOG_IMAGE_QUALITIES = ["low", "medium", "high"] as const;
export const PDOG_IMAGE_25_QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
type Connection = { provider: string; config: Readonly<Record<string, unknown>> };

/** The common guide only illustrates image2.0; image2.5 keeps existing, unverified controls. */
export function pdogImageQualityOptions(model: string | undefined): readonly string[] {
  return typeof model === "string" && model.startsWith("gpt-image-2.5") ? PDOG_IMAGE_25_QUALITIES : PDOG_IMAGE_QUALITIES;
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
    config?.usage !== "agent" && config?.usage !== "disabled" && config?.supplierArchived !== true;
}

// The guide publishes these pixels, without declaring them an exclusive enum.
export const PDOG_GPT_IMAGE_SIZES = [
  { tier: "1K", ratio: "1:1", value: "1024x1024" },
  ...Object.entries({ "1:1": "2048x2048", "3:2": "2048x1360", "2:3": "1360x2048", "16:9": "2048x1152", "9:16": "1152x2048",
    "4:3": "2048x1536", "3:4": "1536x2048", "21:9": "2048x896", "9:21": "896x2048" }).map(([ratio, value]) => ({ tier: "2K", ratio, value })),
  ...Object.entries({ "1:1": "2880x2880", "3:2": "3520x2336", "2:3": "2336x3520", "16:9": "3840x2160", "9:16": "2160x3840",
    "4:3": "3312x2480", "3:4": "2480x3312", "21:9": "3840x1648", "9:21": "1648x3840" }).map(([ratio, value]) => ({ tier: "4K", ratio, value })),
] as const;

export function pdogImageSizeForTier(tier: ImageSizeTier, ratio: string): string {
  return PDOG_GPT_IMAGE_SIZES.find(size => size.tier === tier && size.ratio === ratio)?.value ?? imageSizeForTier(tier, ratio);
}

export function applyPdogImageCapabilities(connection: Connection, model: ModelDescriptor): ModelDescriptor {
  if (connection.provider !== "openai" || !isPdogImageConnection(connection.config, model.id) ||
      !model.operations.some(operation => operation.startsWith("image.")) || model.metadata?.canvasRunnable === false) return model;
  const image25 = model.id.startsWith("gpt-image-2.5");
  return { ...model, operations: ["image.generate", "image.edit"], capabilities: ["image.generate", "image.edit"],
    inputKinds: ["text", "image", "image[]"], outputKinds: ["image"],
    parameters: [
      { key: "size", label: "输出尺寸", control: "dimensions", valueType: "string", default: "auto", options: [
        { value: "auto", label: "自动（使用上游默认尺寸）" },
        ...(["1K", "2K", "4K"] as const).flatMap(tier => IMAGE_SIZE_RATIOS.map(ratio => {
          const value = pdogImageSizeForTier(tier, ratio);
          const documented = PDOG_GPT_IMAGE_SIZES.some(size => size.tier === tier && size.ratio === ratio);
          return { value, label: `${tier} · ${ratio} · ${value}${documented ? "" : "（按已有适配补充）"}` };
        })),
      ], description: "优先使用 PDog 文档像素值，补齐全部比例及自动；原生或超分以当前分组说明为准" },
      { key: "quality", label: "质量", control: "select", valueType: "string", default: image25 ? "max" : "high", options: pdogImageQualityOptions(model.id).map(value => ({ value, label: value })),
        description: image25 ? "Image2.5 按既有规则和用户选择保留最高 max；PDog 公共文档未单独确认 2.5 的扩展质量，尚未实测，以当前上游返回为准"
          : "Image2.0 使用 PDog 公共文档的 low、medium、high，默认最高 high；具体质量能力由当前上游决定" },
      { key: "n", label: "生成张数", control: "number", valueType: "integer", default: 1, min: 1, max: 1 },
      { key: "response_format", label: "返回格式", control: "select", valueType: "string", default: "url", options: [
        { value: "url", label: "图片链接" }, { value: "b64_json", label: "Base64" },
      ], description: "异步结果最终保存为图片链接" },
    ], limits: { ...model.limits, maxOutputImages: 1 }, metadata: { ...model.metadata, protocol: "openai-images",
      pdogImageProtocol: 1, imageNativeQualityOptions: true, pdogDocumentedSizes: PDOG_GPT_IMAGE_SIZES,
      qualitySupport: image25 ? "assumed" : "declared", pdogQualityDocumented: !image25, pdogQualityVerified: false,
      pdogQualitySource: image25 ? "existing-image25-rules-user-preference" : "official-common-example",
      documentationUrl: PDOG_IMAGE_DOCUMENTATION, parameterControlsUnavailable: false } };
}

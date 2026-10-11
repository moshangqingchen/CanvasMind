import type { ModelDescriptor, ProviderOperation } from "./contracts.js";

const DOCS = "https://vapi.chuangxiangai.asia/docs/image";
const GPT_MODEL = /^gpt-image-2(?:\.5-(?:flare|sunburst))?-(1k|2k|4k)$/u;
export const CHUANGXIANG_IMAGE_QUALITIES = ["low", "medium", "high", "xhigh", "max"];
export const CHUANGXIANG_IMAGE25_QUALITIES = ["medium", "max"];
export function isChuangxiangImage25(model: string | undefined): boolean {
  return /^gpt-image-2\.5-(?:flare|sunburst)-(?:1k|2k|4k)$/u.test(model ?? "");
}
export function chuangxiangImageQualities(model: string | undefined): readonly string[] {
  return isChuangxiangImage25(model) ? CHUANGXIANG_IMAGE25_QUALITIES : CHUANGXIANG_IMAGE_QUALITIES;
}
type Connection = { provider: string; config: Readonly<Record<string, unknown>> };

/** Scope the current documented SKU contract to its supplier, group and exact model. */
export function isChuangxiangImageConnection(config: Readonly<Record<string, unknown>> | undefined, model?: string): boolean {
  const selected = model ?? config?.defaultModel;
  if (typeof selected !== "string" || !GPT_MODEL.test(selected) ||
      String(config?.accountKeyGroup ?? config?.modelGroup ?? "") !== "生图" ||
      config?.manualProtocol === true || config?.usage === "agent" || config?.usage === "disabled" || config?.supplierArchived === true) return false;
  try {
    const url = new URL(String(config?.baseUrl ?? ""));
    return url.origin === "https://vapi.chuangxiangai.asia" && !url.username && !url.password &&
      !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname);
  } catch { return false; }
}

export function chuangxiangRequiresPublicAssets(provider: string, config: Readonly<Record<string, unknown>> | undefined,
  model?: string, operation?: ProviderOperation): boolean {
  return provider === "openai" && operation === "image.edit" && isChuangxiangImageConnection(config, model);
}

export function applyChuangxiangCurrentImageCapabilities(connection: Connection, model: ModelDescriptor): ModelDescriptor {
  if (connection.provider !== "openai" || !isChuangxiangImageConnection(connection.config, model.id) || model.metadata?.canvasRunnable === false ||
      model.metadata?.source === "manual" || model.metadata?.source === "paid-test" || model.metadata?.protocolEvidence === "paid-test") return model;
  const tier = GPT_MODEL.exec(model.id)![1]!.toUpperCase();
  const image25 = isChuangxiangImage25(model.id);
  const metadata = { ...model.metadata };
  for (const key of ["imageOutputDimensions", "imageOutputReferenceDimensions", "imageResolutionProfiles", "imageCustomDimensionRules", "imageFixedResolution", "imageNativeResolutionParameter"])
    delete metadata[key];
  const targets = tier === "1K" ? [[1024, 1024], [1280, 720], [720, 1280]]
    : tier === "2K" ? [[2048, 2048], [2560, 1440], [1440, 2560]] : [[2880, 2880], [3840, 2160], [2160, 3840]];
  const ratios = ["1:1", "16:9", "9:16"];
  const requestRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
  return {
    ...model, operations: ["image.generate", "image.edit"], capabilities: ["image.generate", "image.edit"],
    inputKinds: ["text", "image", "image[]"], outputKinds: ["image"],
    parameters: [
      ...(image25 ? [{ key: "size", label: "请求尺寸", control: "dimensions" as const, valueType: "string" as const,
        default: "auto", min: 16, max: 3840, step: 16, allowCustomValue: true,
        options: [{ value: "auto", label: "自动（省略，供应商请求方图）" }, ...targets.map(([width, height], index) => ({
          value: `${width}x${height}`, label: `${tier} · ${ratios[index]} · ${width} × ${height}` }))],
        description: "宽高须为16的倍数、均不超过3840，长短边比例≤3:1，总像素655360–8294400；像素预算须符合完整型号档位。供应商目标尺寸可能被上游调整，实际输出以原图为准。" },
      ] : [{ key: "size", label: "请求尺寸 / 比例", control: "dimensions" as const, valueType: "string" as const,
        default: "auto", allowCustomValue: true,
        options: [{ value: "auto", label: "自动（省略）" }, ...requestRatios.map(value => ({ value, label: value }))],
        description: "供应商 size 字段接受比例或 WIDTHxHEIGHT；完整型号固定档位。未公布该 GPT Image 2 型号的像素范围、对齐或逐比例固定像素，不套用 2.5 的限制。" }]),
      { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: "auto",
        options: [{ value: "auto", label: "自动" }, ...requestRatios.map(value => ({ value, label: value }))] },
      { key: "quality", label: "请求质量", control: "select", valueType: "string", default: "max",
        options: [{ value: "auto", label: "自动（省略）" }, ...chuangxiangImageQualities(model.id).map(value => ({ value, label: value }))],
        description: image25 ? "供应商仅接受 medium/max，省略时默认 medium，两档同价。应用初选 max；已保存的用户选值保留，提交前校验。"
          : "创想 GPT Image 2 声明 low/medium/high/xhigh/max，同分辨率同价，以该完整型号广场为准。" },
      { key: "n", label: "生成张数", control: "number", valueType: "integer", default: 1, min: 1, max: 1 },
    ],
    limits: { ...model.limits, maxInputImages: 9, maxOutputImages: 1 },
    metadata: { ...metadata, protocol: "chuangxiang-gpt-images", documentationUrl: DOCS,
      imageNativeParameterContract: true, imageNativeResolutionOptions: true,
      imagePixelBudgetPublished: image25,
      imageSupportedResolutions: [tier], imageUnsupportedResolutions: ["1K", "2K", "4K"].filter(value => value !== tier),
      imageNativeQualityOptions: true, chuangxiangCurrentContractCheckedAt: "2026-10-10",
      imageQualityOptionsCompleteEnum: image25,
      ...(image25 ? { imageResolutionMode: "fixed-model-tier", imagePixelBudgetPublished: true,
        imageSupplierQualityDefault: "medium", imageApplicationQualityDefault: "max",
        imageRequestTargetDimensions: targets.map(([width, height], index) => ({ resolution: tier, aspectRatio: ratios[index], width, height })),
        imageCustomDimensionRules: { alignment: 16, maximumEdge: 3840, maximumAspectRatio: 3, minimumPixels: 655360,
          maximumPixels: 8294400, tierBoundaryPixels: [2097152, 4194304], sourceUrl: DOCS } } : {}) },
  };
}

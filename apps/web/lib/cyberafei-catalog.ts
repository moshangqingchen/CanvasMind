import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  RestConnectorConfig,
  RestModelConnectorOverride,
  RestRequestMapping,
} from "@super-canvas/providers";
import { providerPriceUnit } from "./provider-pricing-unit";

export const CYBERAFEI_SUPPLIER_KEY = "cyberafei";
export const CYBERAFEI_PRESET_ID = "cyberafei-api";
export const CYBERAFEI_BASE_URL = "https://api.3365api.cn";
export const CYBERAFEI_API_BASE_URL = `${CYBERAFEI_BASE_URL}/v1`;
export const CYBERAFEI_CATALOG_SOURCE = "https://api.3365api.cn/api/pricing";
export const CYBERAFEI_DOCS_URL = "https://api.3365api.cn/docs/";

const CATALOG_TTL_MS = 60_000;
const CATALOG_RETRY_MS = 15_000;
const CATALOG_TIMEOUT_MS = 12_000;
const IMAGE_OPERATIONS = ["image.generate"] as const;
const IMAGE_EDIT_OPERATIONS = ["image.generate", "image.edit"] as const;
const GEMINI_IMAGE_OPERATIONS = ["image.generate", "image.edit"] as const;
const VIDEO_OPERATIONS = ["video.generate", "video.image-to-video"] as const;
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const IMAGE2_MAX_INPUT_IMAGES = 16;

interface PricingRecord {
  model_name?: unknown;
  description?: unknown;
  tags?: unknown;
  model_price?: unknown;
  model_ratio?: unknown;
  completion_ratio?: unknown;
  cache_ratio?: unknown;
  quota_type?: unknown;
  enable_groups?: unknown;
  supported_endpoint_types?: unknown;
  billing_mode?: unknown;
  request_unit?: unknown;
  video_api?: unknown;
}

export interface PricingPayload {
  data?: unknown;
  group_ratio?: unknown;
  usable_group?: unknown;
}

export interface CyberAfeiMarketplaceModel {
  id: string;
  name: string;
  description?: string;
  capability: "chat" | "image" | "video" | "other";
  priceLabel: string;
  billingLabel: string;
  tags: string[];
  endpointTypes: string[];
  canvasRunnable?: boolean;
  canvasUnavailableReason?: string;
}

export type CyberAfeiCanvasCapability = "image" | "video";

export interface CyberAfeiCapabilityBlock {
  capability: CyberAfeiCanvasCapability;
  reason: "group_permission_denied";
  detectedAt: string;
  providerMessage?: string;
  model?: string;
}

export interface CyberAfeiMarketplaceGroup {
  id: string;
  description: string;
  ratio: number;
  canvasSupported: boolean;
  canvasModelCount: number;
  models: CyberAfeiMarketplaceModel[];
}

export interface CyberAfeiCatalogSnapshot {
  checkedAt: string;
  source: "live" | "unavailable" | "stale" | "fallback";
  groups: Record<string, ModelDescriptor[]>;
  marketplaceGroups: CyberAfeiMarketplaceGroup[];
}

export interface CyberAfeiResolvedScannedGroup {
  marketplaceGroup: CyberAfeiMarketplaceGroup;
  canvasModels: ModelDescriptor[];
  /**
   * Key-scanned image/video inventory for the canvas selector. Models without
   * a verified protocol stay visible here as disabled descriptors, while
   * `canvasModels` remains the strictly runnable connector allow-list.
   */
  canvasDisplayModels: ModelDescriptor[];
}

interface CatalogCache {
  snapshot?: CyberAfeiCatalogSnapshot;
  expiresAt: number;
  pending?: Promise<CyberAfeiCatalogSnapshot>;
}

const globalCacheKey = "__superCanvasCyberAfeiCatalog";

function catalogCache(): CatalogCache {
  const scope = globalThis as typeof globalThis & {
    [globalCacheKey]?: CatalogCache;
  };
  return (scope[globalCacheKey] ??= { expiresAt: 0 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCyberAfeiCapabilityBlocks(
  value: unknown,
): CyberAfeiCapabilityBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): CyberAfeiCapabilityBlock[] => {
    if (!isRecord(item)) return [];
    const capability = item.capability;
    const detectedAt = item.detectedAt;
    if (
      (capability !== "image" && capability !== "video") ||
      item.reason !== "group_permission_denied" ||
      typeof detectedAt !== "string" ||
      !detectedAt.trim()
    )
      return [];
    return [
      {
        capability,
        reason: "group_permission_denied",
        detectedAt,
        ...(typeof item.providerMessage === "string"
          ? { providerMessage: item.providerMessage }
          : {}),
        ...(typeof item.model === "string" ? { model: item.model } : {}),
      },
    ];
  });
}

function descriptorCanvasCapability(
  descriptor: ModelDescriptor,
): CyberAfeiCanvasCapability | null {
  if (descriptor.operations.some((operation) => operation.startsWith("image.")))
    return "image";
  if (descriptor.operations.some((operation) => operation.startsWith("video.")))
    return "video";
  return null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function tags(value: unknown): string[] {
  if (Array.isArray(value)) return strings(value);
  return typeof value === "string"
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function numbers(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      typeof item === "number" && Number.isFinite(item) ? [[key, item]] : [],
    ),
  );
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      typeof item === "string" ? [[key, item]] : [],
    ),
  );
}

function formatPrice(value: number): string {
  const formatted = value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
  return formatted.includes(".") && formatted.split(".")[1]!.length === 1
    ? `${formatted}0`
    : formatted;
}

const IMAGE2_DEFAULT_OUTPUT_SIZES = {
  "gpt-image-2-2K": "2048x1152",
  "gpt-image-2-4K": "3840x2160",
} as const;

function image2DefaultOutputSize(id: string): string | null {
  return (
    IMAGE2_DEFAULT_OUTPUT_SIZES[
      id as keyof typeof IMAGE2_DEFAULT_OUTPUT_SIZES
    ] ?? null
  );
}

function isImage2Model(id: string): boolean {
  return (
    id === "gpt-image-2" ||
    id === "gpt-image-4K" ||
    image2DefaultOutputSize(id) !== null
  );
}

function supportsImage2Reference(id: string): boolean {
  return id === "gpt-image-2-4K" || id === "gpt-image-4K";
}

const GEMINI_FIXED_IMAGE_SIZES = {
  "gemini-3.1-flash-image-1k": "1K",
  "gemini-3.1-flash-image-2k": "2K",
  "gemini-3.1-flash-image-4k": "4K",
} as const;

function geminiFixedImageSize(id: string): "1K" | "2K" | "4K" | null {
  return (
    GEMINI_FIXED_IMAGE_SIZES[id as keyof typeof GEMINI_FIXED_IMAGE_SIZES] ??
    null
  );
}

function geminiCanonicalModel(id: string): string | null {
  if (
    id === "gemini-3.1-flash-image-preview" ||
    id === "gemini-3-pro-image-preview" ||
    geminiFixedImageSize(id) !== null
  )
    return id;
  return null;
}

function isGeminiImageModel(id: string): boolean {
  return geminiCanonicalModel(id) !== null;
}

function isImageModel(id: string): boolean {
  return isImage2Model(id) || isGeminiImageModel(id) || isGrokImageModel(id);
}

function isGrokImageModel(id: string): boolean {
  return (
    id === "grok-imagine-无限" ||
    id === "grok-imagine-image" ||
    id === "grok-imagine-image-quality"
  );
}

function isSeedanceModel(id: string): boolean {
  return /^video-v1-(?:5s|10s|15s)$/u.test(id);
}

function isGrokModel(id: string): boolean {
  return (
    id === "grok-imagine-video" ||
    id === "grok-imagine-video-1.5" ||
    /^grok-imagine-video-1\.5-(?:720p|1080p)$/u.test(id)
  );
}

function looksLikeImageModel(id: string): boolean {
  return /(?:image|banana|omni-flash)/iu.test(id);
}

function looksLikeVideoModel(id: string): boolean {
  return /(?:video|veo|kling|sd2|wx_videos|firefly-video)/iu.test(id);
}

function isSupportedCanvasModel(id: string): boolean {
  return (
    isImage2Model(id) ||
    isGeminiImageModel(id) ||
    isGrokImageModel(id) ||
    isSeedanceModel(id) ||
    isGrokModel(id)
  );
}

function capabilityFor(
  record: PricingRecord,
  id: string,
): CyberAfeiMarketplaceModel["capability"] {
  const recordTags = tags(record.tags);
  const endpoints = strings(record.supported_endpoint_types);
  if (
    isSeedanceModel(id) ||
    isGrokModel(id) ||
    looksLikeVideoModel(id) ||
    recordTags.some((tag) => /视频|video/iu.test(tag))
  )
    return "video";
  if (
    isImageModel(id) ||
    looksLikeImageModel(id) ||
    recordTags.some((tag) => /图片|image/iu.test(tag))
  )
    return "image";
  if (endpoints.length > 0) return "chat";
  return "other";
}

function priceFor(
  record: PricingRecord,
  groupRatio: number,
): { label: string; billing: string } {
  const quotaType = record.quota_type;
  const modelRatio =
    typeof record.model_ratio === "number" ? record.model_ratio : undefined;
  const modelPrice =
    typeof record.model_price === "number" ? record.model_price : undefined;
  const completionRatio =
    typeof record.completion_ratio === "number" ? record.completion_ratio : 1;
  if (quotaType === 0 && modelRatio !== undefined) {
    const input = modelRatio * groupRatio * 2;
    const output = input * completionRatio;
    return {
      label: `输入 $${formatPrice(input)} / 1M · 输出 $${formatPrice(output)} / 1M`,
      billing: "按量计费",
    };
  }
  if (modelPrice !== undefined) {
    const price = modelPrice * groupRatio;
    const perSecond = providerPriceUnit(record) === "second";
    return {
      label: `$${formatPrice(price)} / ${perSecond ? "秒" : "请求"}`,
      billing: perSecond ? "按秒计费" : "按次计费",
    };
  }
  return { label: "价格以平台为准", billing: "以平台为准" };
}

function descriptorWithPricing(
  descriptor: ModelDescriptor,
  record: PricingRecord,
  group: string,
  groupRatio: number,
  checkedAt: string,
): ModelDescriptor {
  const price = priceFor(record, groupRatio);
  const numericPrice =
    typeof record.model_price === "number" &&
    Number.isFinite(record.model_price) &&
    record.model_price >= 0
      ? record.model_price * groupRatio
      : undefined;
  const perSecond = providerPriceUnit(record) === "second";
  return {
    ...descriptor,
    ...(numericPrice === undefined
      ? {}
      : {
          pricing: {
            kind: perSecond ? "per-second" : "per-request",
            currency: "USD",
            unitAmount: numericPrice,
            sourceUrl: CYBERAFEI_CATALOG_SOURCE,
            checkedAt,
            confidence: "exact",
          } as const,
        }),
    name: `${descriptor.name} · ${price.label}`,
    metadata: {
      ...(descriptor.metadata ?? {}),
      supplier: CYBERAFEI_SUPPLIER_KEY,
      modelGroup: group,
      groupRatio,
      priceLabel: price.label,
      billingLabel: price.billing,
    },
  };
}

const GEMINI_RATIO_PIXELS = [
  { ratio: "1:1", pixels: "1024×1024 / 2048×2048 / 4096×4096" },
  { ratio: "5:4", pixels: "1152×928 / 2304×1856 / 4608×3712" },
  { ratio: "4:5", pixels: "928×1152 / 1856×2304 / 3712×4608" },
  { ratio: "4:3", pixels: "1200×896 / 2400×1792 / 4800×3584" },
  { ratio: "3:4", pixels: "896×1200 / 1792×2400 / 3584×4800" },
  { ratio: "3:2", pixels: "1264×848 / 2528×1696 / 5056×3392" },
  { ratio: "2:3", pixels: "848×1264 / 1696×2528 / 3392×5056" },
  { ratio: "16:9", pixels: "1376×768 / 2752×1536 / 5504×3072" },
  { ratio: "9:16", pixels: "768×1376 / 1536×2752 / 3072×5504" },
  { ratio: "21:9", pixels: "1584×672 / 3168×1344 / 6336×2688" },
] as const;

const GEMINI_FLASH_EXTREME_RATIO_PIXELS = [
  { ratio: "8:1", pixels: "2928×352 / 5856×704 / 11712×1408" },
  { ratio: "4:1", pixels: "2064×512 / 4128×1024 / 8256×2048" },
  { ratio: "1:4", pixels: "512×2064 / 1024×4128 / 2048×8256" },
  { ratio: "1:8", pixels: "352×2928 / 704×5856 / 1408×11712" },
] as const;

const IMAGE2_2K_TEST_SIZES = [
  { ratio: "1:1", value: "2048x2048" },
  { ratio: "16:9", value: "2048x1152" },
  { ratio: "9:16", value: "1152x2048" },
  { ratio: "4:3", value: "2048x1536" },
  { ratio: "3:4", value: "1536x2048" },
  { ratio: "3:2", value: "2048x1360" },
  { ratio: "2:3", value: "1360x2048" },
  { ratio: "21:9", value: "2688x1152" },
] as const;

const IMAGE2_4K_TEST_SIZES = [
  { ratio: "1:1", value: "2160x2160" },
  { ratio: "16:9", value: "3840x2160" },
  { ratio: "9:16", value: "2160x3840" },
  { ratio: "4:3", value: "2880x2160" },
  { ratio: "3:4", value: "2160x2880" },
  { ratio: "3:2", value: "3248x2160", note: "按实测返回值校正" },
  { ratio: "2:3", value: "2160x3248", note: "按实测返回值校正" },
  { ratio: "21:9", value: "3840x1648", note: "按实测返回值校正" },
] as const;

const IMAGE2_4K_PAPER_TEST_SIZES = [
  { ratio: "3:4 自定义", value: "2096x2800", note: "16 像素对齐" },
  { ratio: "A 系列自定义", value: "2096x2976", note: "16 像素对齐" },
  { ratio: "A5·300 DPI", value: "1744x2480", note: "16 像素对齐" },
  {
    ratio: "A4/A3 竖版·接口上限",
    value: "2416x3424",
    note: "按最大像素约束校正",
  },
  {
    ratio: "A 系列横版·接口上限",
    value: "3424x2416",
    note: "按最大像素约束校正",
  },
] as const;

const IMAGE2_OBSERVED_OUTPUT_SIZES: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "gpt-image-2": {
    "2048x2048": "1254x1254",
    "2048x1152": "1672x941",
    "1152x2048": "941x1672",
    "2048x1536": "1448x1086",
    "1536x2048": "1086x1448",
    "2048x1360": "1539x1022",
    "1360x2048": "1022x1539",
    "2688x1152": "1915x821",
    "3840x2160": "1672x941",
    "2160x3840": "941x1672",
    "2880x2160": "1448x1086",
    "2160x2880": "1086x1448",
    "3240x2160": "1536x1024",
    "2160x3240": "1024x1536",
    "3840x1646": "1915x821",
  },
  "gpt-image-2-2K": {
    "2048x1152": "2048x1152",
    "1152x2048": "1152x2048",
    "2048x1536": "2048x1536",
    "1536x2048": "1536x2048",
    "2048x1360": "2048x1360",
    "1360x2048": "1360x2048",
    "2688x1152": "2688x1152",
  },
  "gpt-image-2-4K": {
    "2160x2160": "2160x2160",
    "3840x2160": "3840x2160",
    "2160x3840": "2160x3840",
    "2880x2160": "2880x2160",
    "2160x2880": "2160x2880",
    "3240x2160": "3248x2160",
    "2160x3240": "2160x3248",
    "3840x1646": "3840x1648",
    "2100x2800": "2096x2800",
    "2100x2970": "2096x2976",
    "1748x2480": "1744x2480",
    "2480x3508": "2416x3424",
    "3508x4961": "2416x3424",
    "2715x3840": "1054x1492",
    "3840x2715": "3424x2416",
  },
  "gpt-image-4K": {
    "2160x2160": "2160x2160",
    "3840x2160": "3840x2160",
    "2160x3840": "2160x3840",
    "2880x2160": "2880x2160",
    "2160x2880": "1086x1448",
    "3240x2160": "1536x1024",
    "2160x3240": "2160x3248",
    "3840x1646": "3840x1648",
    "2100x2800": "2096x2800",
    "2100x2970": "2096x2976",
    "1748x2480": "1744x2480",
    "2480x3508": "2416x3424",
    "3508x4961": "2416x3424",
    "3840x2715": "3424x2416",
  },
};

const IMAGE2_UNCONFIRMED_SIZES: Readonly<Record<string, readonly string[]>> = {
  "gpt-image-2": ["2160x2160"],
  "gpt-image-2-2K": ["2048x2048"],
  "gpt-image-4K": ["2715x3840"],
};

function image2VerifiedSizeOptions(
  id: string,
  tier: "2K" | "4K" | "纸张",
  sizes: readonly { ratio: string; value: string; note?: string }[],
): Array<{ label: string; value: string }> {
  const observed = IMAGE2_OBSERVED_OUTPUT_SIZES[id] ?? {};
  const unconfirmed = new Set(IMAGE2_UNCONFIRMED_SIZES[id] ?? []);
  return sizes.map(({ ratio, value, note }) => {
    const actual = observed[value];
    const result = note
      ? note
      : unconfirmed.has(value)
        ? "本次网络异常，未确认"
        : actual === value
          ? "实测精确"
          : actual
            ? `实测返回 ${actual.replace("x", "×")}`
            : "尚未实测";
    return {
      label: `${tier} ${ratio} · ${value.replace("x", "×")}（${result}）`,
      value,
    };
  });
}

function image2Parameters(id: string): ModelParameterDescriptor[] {
  const defaultOutputSize = image2DefaultOutputSize(id);
  const tested2KSizes = image2VerifiedSizeOptions(
    id,
    "2K",
    IMAGE2_2K_TEST_SIZES,
  );
  const tested4KSizes = image2VerifiedSizeOptions(
    id,
    "4K",
    IMAGE2_4K_TEST_SIZES,
  );
  const testedPaper4KSizes = image2VerifiedSizeOptions(
    id,
    "纸张",
    IMAGE2_4K_PAPER_TEST_SIZES,
  );
  const flexible4K = id === "gpt-image-2-4K" || id === "gpt-image-4K";
  const operations = supportsImage2Reference(id)
    ? IMAGE_EDIT_OPERATIONS
    : IMAGE_OPERATIONS;
  const sizeOptions =
    id === "gpt-image-2-2K"
      ? tested2KSizes
      : flexible4K
        ? [
            {
              label: "自动（提示词优先，其次参考图）",
              value: "auto",
            },
            ...tested4KSizes,
            ...testedPaper4KSizes,
          ]
        : [
            { label: "普通示例 · 1024×1024", value: "1024x1024" },
            ...tested2KSizes,
            ...tested4KSizes,
          ];
  return [
    {
      key: "size",
      label: "目标尺寸",
      control: id === "gpt-image-2" || flexible4K ? "dimensions" : "select",
      valueType: "string",
      default:
        defaultOutputSize ??
        (id === "gpt-image-4K" ? "3840x2160" : "1024x1024"),
      options: sizeOptions,
      ...(flexible4K
        ? {
            min: 16,
            max: 3840,
            step: 16,
            placeholder: "宽 x 高",
          }
        : {}),
      description:
        id === "gpt-image-4K"
          ? "支持自动、预设和自定义宽高；自动优先识别提示词中的明确尺寸/A 系列/比例，其次跟随参考图。GPT Image 编辑接口最多支持 16 张参考图并通过 /v1/images/edits 的 image[] 上传；上游会对齐或降采样，以下载原图宽高为准。"
          : id === "gpt-image-2-4K"
            ? "支持自动、预设和自定义宽高；自动优先识别提示词中的明确尺寸/A 系列/比例，其次跟随参考图。GPT Image 编辑接口最多支持 16 张参考图并通过 /v1/images/edits 的 image[] 上传；纸张尺寸均已实测成功，部分会被上游明显降采样。"
            : id === "gpt-image-2-2K"
              ? "7 个 2K 比例已精确返回；1:1 本次因网络中断未确认，不代表尺寸不支持。"
              : "支持自定义宽高，但本轮 2K / 4K 测试均被上游降采样；选项会显示下载原图的实测宽高。",
      operations,
    },
    {
      key: "quality",
      label: "质量",
      control: "select",
      valueType: "string",
      default: "high",
      options: [
        { label: "自动", value: "auto" },
        { label: "低", value: "low" },
        { label: "中", value: "medium" },
        { label: "高", value: "high" },
      ],
      operations,
    },
    {
      key: "n",
      label: "生成张数",
      control: "number",
      valueType: "integer",
      default: 1,
      min: 1,
      max: 1,
      step: 1,
      description: "官方文档建议固定为 1。",
      operations,
    },
  ];
}

function geminiParameters(id: string): ModelParameterDescriptor[] {
  const fixedImageSize = geminiFixedImageSize(id);
  const operations = fixedImageSize
    ? IMAGE_OPERATIONS
    : GEMINI_IMAGE_OPERATIONS;
  const ratioPixels =
    id === "gemini-3.1-flash-image-preview"
      ? [...GEMINI_RATIO_PIXELS, ...GEMINI_FLASH_EXTREME_RATIO_PIXELS]
      : GEMINI_RATIO_PIXELS;
  const tierIndex = fixedImageSize
    ? ({ "1K": 0, "2K": 1, "4K": 2 } as const)[fixedImageSize]
    : null;
  return [
    {
      key: "aspectRatio",
      label: "画面比例",
      control: "select",
      valueType: "string",
      default: "auto",
      options: [
        { label: "自动（图生图时跟随参考图）", value: "auto" },
        ...ratioPixels.map(({ ratio, pixels }) => ({
          label:
            tierIndex === null
              ? `${ratio} · 1K / 2K / 4K：${pixels}`
              : `${ratio} · ${fixedImageSize}：${pixels.split(" / ")[tierIndex]}`,
          value: ratio,
        })),
      ],
      description: fixedImageSize
        ? `该型号固定提交 imageSize=${fixedImageSize}；比例可选，最终仍以供应商返回图片的真实宽高为准。`
        : id === "gemini-3.1-flash-image-preview"
          ? "官方 10 个通用比例并含 Flash 专属 8:1、4:1、1:4、1:8；像素依次对应 1K / 2K / 4K。"
          : "官方 10 个通用比例；像素依次对应 1K / 2K / 4K。",
      operations,
    },
    {
      key: "imageSize",
      label: "分辨率",
      control: "select",
      valueType: "string",
      default: fixedImageSize ?? "4K",
      options: fixedImageSize
        ? [{ label: `${fixedImageSize}（型号固定）`, value: fixedImageSize }]
        : [
            { label: "自动（默认 4K）", value: "auto" },
            { label: "1K", value: "1K" },
            { label: "2K", value: "2K" },
            { label: "4K", value: "4K" },
          ],
      description: fixedImageSize
        ? `模型名已锁定 ${fixedImageSize}，请求会强制提交大写的 imageSize=${fixedImageSize}。`
        : "Gemini 原生 imageSize，K 必须大写。",
      operations,
    },
  ];
}

function grokImageParameters(id: string): ModelParameterDescriptor[] {
  if (id === "grok-imagine-image" || id === "grok-imagine-image-quality")
    return [];
  return [
    {
      key: "size",
      label: "目标尺寸",
      control: "dimensions",
      valueType: "string",
      default: "1024x1024",
      options: [
        { label: "方图 · 1024×1024（实测）", value: "1024x1024" },
        { label: "横图 · 2048×1152（实测会等比例归一）", value: "2048x1152" },
      ],
      description:
        "该模型实测接受 OpenAI Images 的 size 字段；上游可能按比例归一为其他像素，应用以下载后的真实宽高为准。",
      operations: IMAGE_OPERATIONS,
    },
  ];
}

function ratioParameter(): ModelParameterDescriptor {
  return {
    key: "ratio",
    label: "视频比例",
    control: "select",
    valueType: "string",
    default: "16:9",
    options: [
      { label: "16:9（常见 1920×1080）", value: "16:9" },
      { label: "9:16（常见 1080×1920）", value: "9:16" },
      { label: "1:1（常见 1080×1080）", value: "1:1" },
    ],
    description:
      "文档给出的是常用分辨率示例，接口参数只提交比例，最终像素由上游任务决定。",
    operations: VIDEO_OPERATIONS,
  };
}

function grokParameters(): ModelParameterDescriptor[] {
  return [
    {
      key: "duration",
      label: "时长（秒）",
      control: "number",
      valueType: "integer",
      default: 6,
      min: 1,
      max: 15,
      step: 1,
      operations: ["video.image-to-video"],
    },
    {
      key: "aspect_ratio",
      label: "视频比例",
      control: "select",
      valueType: "string",
      default: "16:9",
      options: [
        { label: "16:9", value: "16:9" },
        { label: "9:16", value: "9:16" },
        { label: "1:1", value: "1:1" },
        { label: "4:3", value: "4:3" },
        { label: "3:4", value: "3:4" },
        { label: "3:2", value: "3:2" },
        { label: "2:3", value: "2:3" },
      ],
      operations: ["video.image-to-video"],
    },
  ];
}

function descriptorFor(record: PricingRecord): ModelDescriptor | null {
  if (typeof record.model_name !== "string" || !record.model_name.trim())
    return null;
  const id = record.model_name.trim();
  if (!isSupportedCanvasModel(id)) return null;
  if (isImage2Model(id)) {
    const defaultOutputSize = image2DefaultOutputSize(id);
    const testedInputSizes =
      id === "gpt-image-2"
        ? [
            ...IMAGE2_2K_TEST_SIZES.map(({ value }) => value),
            ...IMAGE2_4K_TEST_SIZES.map(({ value }) => value),
          ]
        : id === "gpt-image-2-2K"
          ? IMAGE2_2K_TEST_SIZES.map(({ value }) => value)
          : [
              ...IMAGE2_4K_TEST_SIZES.map(({ value }) => value),
              ...IMAGE2_4K_PAPER_TEST_SIZES.map(({ value }) => value),
            ];
    const documentedOutputSizes =
      id === "gpt-image-4K" || id === "gpt-image-2-4K"
        ? IMAGE2_4K_TEST_SIZES.map(({ value }) => value)
        : undefined;
    const observedOutputSizes = IMAGE2_OBSERVED_OUTPUT_SIZES[id];
    const unconfirmedSizes = IMAGE2_UNCONFIRMED_SIZES[id];
    return {
      id,
      name: id,
      description:
        typeof record.description === "string"
          ? record.description
          : id === "gpt-image-4K"
            ? "官方 Image-2 4K 型号；文档列出的 8 个比例均可提交，但部分尺寸会由上游对齐或降级。"
            : id === "gpt-image-2-4K"
              ? "Image-2 4K 别名型号；8 个比例全部实测成功，部分尺寸会按像素边界对齐。"
              : id === "gpt-image-2-2K"
                ? "Image-2 2K 别名型号；7 个比例实测精确，1:1 因网络中断未确认。"
                : "Image-2 日常生图型号；支持自定义尺寸，但本轮 2K / 4K 请求均被上游降采样。",
      operations: supportsImage2Reference(id)
        ? IMAGE_EDIT_OPERATIONS
        : IMAGE_OPERATIONS,
      isDefault: id === "gpt-image-4K",
      metadata: {
        fixedOutputCount: 1,
        protocol: "openai-images",
        ...(defaultOutputSize ? { defaultOutputSize } : {}),
        ...(documentedOutputSizes ? { documentedOutputSizes } : {}),
        testedInputSizes,
        ...(observedOutputSizes ? { observedOutputSizes } : {}),
        ...(unconfirmedSizes ? { unconfirmedSizes } : {}),
        sizeVerifiedAt: "2026-08-03",
        sizeBehavior: "provider-may-normalize",
        ...(supportsImage2Reference(id)
          ? {
              referenceEditEndpoint: "/v1/images/edits",
              referenceEditVerifiedAt: "2026-08-04",
              referenceImageLimit: IMAGE2_MAX_INPUT_IMAGES,
              referenceImageLimitSource: "openai-image-edit-api",
            }
          : {}),
        docsPath: "/docs/#/README",
      },
      parameters: image2Parameters(id),
      limits: {
        maxInputImages: supportsImage2Reference(id)
          ? IMAGE2_MAX_INPUT_IMAGES
          : 0,
        supportedMimeTypes: IMAGE_MIME_TYPES,
      },
    };
  }
  if (isGeminiImageModel(id)) {
    const fixedImageSize = geminiFixedImageSize(id);
    return {
      id,
      name: id,
      description:
        typeof record.description === "string"
          ? record.description
          : "赛博阿飞 Nano Banana / Gemini 原生 generateContent 图片接口。",
      operations: fixedImageSize ? IMAGE_OPERATIONS : GEMINI_IMAGE_OPERATIONS,
      isDefault: id === "gemini-3.1-flash-image-preview",
      metadata: {
        fixedOutputCount: 1,
        protocol: "gemini-native",
        requestModel: geminiCanonicalModel(id),
        ...(fixedImageSize ? { fixedImageSize } : {}),
        sizeBehavior: fixedImageSize ? "fixed-tier" : "ratio-and-tier",
        docsPath: fixedImageSize ? "/pricing" : "/docs/#/banana",
        protocolEvidence: fixedImageSize
          ? "marketplace-detail-and-paid-test"
          : "specialist-docs-and-paid-test",
      },
      parameters: geminiParameters(id),
      limits: {
        maxInputImages: fixedImageSize ? 0 : 1,
        supportedMimeTypes: IMAGE_MIME_TYPES,
      },
    };
  }
  if (isGrokImageModel(id)) {
    return {
      id,
      name: id,
      description:
        typeof record.description === "string" && record.description.trim()
          ? record.description
          : id === "grok-imagine-image-quality"
            ? "Grok Imagine 高质量图片模型；实测仅提交 model 与 prompt，避免通用模板的无效参数。"
            : id === "grok-imagine-image"
              ? "Grok Imagine 图片模型；按模型广场协议仅提交 model 与 prompt。"
              : "Grok Imagine 图片模型；实测使用 OpenAI Images 兼容接口，尺寸可能由上游等比例归一。",
      operations: IMAGE_OPERATIONS,
      metadata: {
        fixedOutputCount: 1,
        protocol: "openai-images",
        sizeBehavior:
          id === "grok-imagine-image" || id === "grok-imagine-image-quality"
            ? "provider-decided"
            : "provider-may-normalize",
        docsPath: "/pricing",
        protocolEvidence: "paid-test",
      },
      parameters: grokImageParameters(id),
      limits: { maxInputImages: 0, supportedMimeTypes: IMAGE_MIME_TYPES },
    };
  }
  if (isSeedanceModel(id)) {
    return {
      id,
      name: id,
      description:
        typeof record.description === "string"
          ? record.description
          : "SD2.0 异步视频生成，支持文生视频和图生视频。",
      operations: VIDEO_OPERATIONS,
      parameters: [ratioParameter()],
      metadata: { docsPath: "/docs/#/sd20" },
      limits: { supportedMimeTypes: IMAGE_MIME_TYPES },
    };
  }
  return {
    id,
    name: id,
    description:
      typeof record.description === "string"
        ? record.description
        : "Grok Imagine 异步图生视频接口；平台协议可能按模型版本不同。",
    operations: ["video.image-to-video"],
    parameters: grokParameters(),
    metadata: { docsPath: "/docs/#/grok-video" },
    limits: {
      requiresInputImage: true,
      maxInputImages: 1,
      supportedMimeTypes: IMAGE_MIME_TYPES,
    },
  };
}

function marketplaceModel(
  record: PricingRecord,
  ratio: number,
): CyberAfeiMarketplaceModel | null {
  if (typeof record.model_name !== "string" || !record.model_name.trim())
    return null;
  const id = record.model_name.trim();
  const prices = priceFor(record, ratio);
  return {
    id,
    name: id,
    ...(typeof record.description === "string" && record.description.trim()
      ? { description: record.description.trim() }
      : {}),
    capability: capabilityFor(record, id),
    priceLabel: prices.label,
    billingLabel: prices.billing,
    tags: tags(record.tags),
    endpointTypes: strings(record.supported_endpoint_types),
  };
}

const imageMappings: readonly RestRequestMapping[] = [
  { target: "/model", source: { kind: "request", path: "$.model" } },
  { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
  {
    target: "/size",
    source: { kind: "request", path: "$.parameters.size" },
    omitIfUndefined: true,
  },
  {
    target: "/quality",
    source: { kind: "request", path: "$.parameters.quality" },
    omitIfUndefined: true,
  },
  {
    target: "/n",
    source: { kind: "request", path: "$.parameters.n" },
    omitIfUndefined: true,
  },
  {
    target: "/response_format",
    source: { kind: "literal", value: "url" },
  },
];

function image2ReferenceOverride(): RestModelConnectorOverride {
  return {
    operationOverrides: {
      "image.edit": {
        submit: {
          path: "/v1/images/edits",
          method: "POST",
          bodyMode: "multipart",
          mappings: [
            ...imageMappings,
            {
              target: "/image[]",
              source: {
                kind: "assets",
                assetKind: "image",
                select: "all",
              },
            },
          ],
          response: { statusPath: "$.status" },
        },
      },
    },
  };
}

function geminiOverride(id: string): RestModelConnectorOverride {
  const canonical = geminiCanonicalModel(id);
  const fixedImageSize = geminiFixedImageSize(id);
  if (!canonical) throw new Error(`Unsupported Gemini image model: ${id}`);
  const mappings: RestRequestMapping[] = [
    {
      target: "/contents/0/parts/0/text",
      source: { kind: "request", path: "$.prompt" },
    },
    {
      target: "/contents/0/parts/1",
      source: {
        kind: "assets",
        assetKind: "image",
        select: "first",
        encoding: "gemini-part",
      },
      omitIfUndefined: true,
    },
    {
      target: "/generationConfig/imageConfig/aspectRatio",
      source: { kind: "request", path: "$.parameters.aspectRatio" },
      omitIfUndefined: true,
      omitValues: ["auto"],
    },
  ];
  if (!fixedImageSize) {
    mappings.push({
      target: "/generationConfig/imageConfig/imageSize",
      source: { kind: "request", path: "$.parameters.imageSize" },
      omitIfUndefined: true,
      omitValues: ["auto"],
    });
  }
  return {
    submit: {
      path: `/v1beta/models/${encodeURIComponent(canonical)}:generateContent`,
      method: "POST",
      bodyMode: "json",
      template: {
        contents: [{ role: "user", parts: [{ text: "" }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: fixedImageSize ? { imageSize: fixedImageSize } : {},
        },
      },
      mappings,
    },
    output: {
      path: "$.candidates[0].content.parts",
      kind: "image",
      urlPath: "file_data.file_uri",
      urlFallbackPaths: ["fileData.fileUri"],
      base64Path: "inline_data.data",
      base64FallbackPaths: ["inlineData.data", "text"],
      mimeTypePath: "inline_data.mime_type",
      defaultMimeType: "image/png",
    },
  };
}

function grokImageOverride(id: string): RestModelConnectorOverride {
  const mappings: RestRequestMapping[] = [
    { target: "/model", source: { kind: "request", path: "$.model" } },
    { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
  ];
  if (id === "grok-imagine-无限") {
    mappings.push({
      target: "/size",
      source: { kind: "request", path: "$.parameters.size" },
      omitIfUndefined: true,
    });
  }
  return {
    submit: {
      path: "/v1/images/generations",
      method: "POST",
      bodyMode: "json",
      mappings,
      response: { statusPath: "$.status" },
    },
  };
}

function seedanceOverride(): RestModelConnectorOverride {
  const mappings: RestRequestMapping[] = [
    { target: "/model", source: { kind: "request", path: "$.model" } },
    { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
    {
      target: "/ratio",
      source: { kind: "request", path: "$.parameters.ratio" },
      omitIfUndefined: true,
    },
    {
      target: "/images",
      source: { kind: "assets", assetKind: "image", select: "all" },
      omitIfEmpty: true,
    },
  ];
  return {
    pollIntervalMs: 15_000,
    submit: {
      path: "/v1/video/generations",
      method: "POST",
      bodyMode: "json",
      mappings,
      response: { taskIdPath: "$.task_id", statusPath: "$.status" },
    },
    poll: {
      path: "/v1/video/generations/{taskId}",
      method: "GET",
      bodyMode: "none",
      response: {
        statusPath: "$.status",
        statusFallbackPaths: ["$.data.status"],
        errorPath: "$.error.message",
      },
    },
    output: {
      path: "$.result_url",
      fallbackPaths: ["$.data.result_url", "$.video.url"],
      kind: "video",
      defaultMimeType: "video/mp4",
    },
    statusMap: { FAILURE: "failed", SUCCESS: "succeeded" },
  };
}

function grokOverride(): RestModelConnectorOverride {
  return {
    pollIntervalMs: 5_000,
    submit: {
      path: "/v1/videos/generations",
      method: "POST",
      bodyMode: "json",
      mappings: [
        { target: "/model", source: { kind: "request", path: "$.model" } },
        { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
        {
          target: "/image/url",
          source: { kind: "assets", assetKind: "image", select: "first" },
          omitIfUndefined: true,
        },
        {
          target: "/duration",
          source: { kind: "request", path: "$.parameters.duration" },
          omitIfUndefined: true,
        },
        {
          target: "/aspect_ratio",
          source: { kind: "request", path: "$.parameters.aspect_ratio" },
          omitIfUndefined: true,
        },
      ],
      response: { taskIdPath: "$.request_id", statusPath: "$.status" },
    },
    poll: {
      path: "/v1/videos/{taskId}",
      method: "GET",
      bodyMode: "none",
      response: { statusPath: "$.status", errorPath: "$.error.message" },
    },
    output: {
      path: "$.video.url",
      fallbackPaths: ["$.result_url", "$.data.result_url"],
      kind: "video",
      defaultMimeType: "video/mp4",
    },
    statusMap: {
      pending: "queued",
      running: "running",
      in_progress: "running",
      done: "succeeded",
      SUCCESS: "succeeded",
      failed: "failed",
      FAILURE: "failed",
      expired: "failed",
    },
  };
}

export function cyberAfeiConnectorForModels(
  models: readonly ModelDescriptor[],
): RestConnectorConfig {
  const modelOverrides: Record<string, RestModelConnectorOverride> = {};
  for (const model of models) {
    if (supportsImage2Reference(model.id))
      modelOverrides[model.id] = image2ReferenceOverride();
    else if (isGeminiImageModel(model.id))
      modelOverrides[model.id] = geminiOverride(model.id);
    else if (isGrokImageModel(model.id))
      modelOverrides[model.id] = grokImageOverride(model.id);
    else if (isSeedanceModel(model.id))
      modelOverrides[model.id] = seedanceOverride();
    else if (isGrokModel(model.id)) modelOverrides[model.id] = grokOverride();
  }
  return {
    auth: { type: "bearer" },
    allowedHosts: ["api.3365api.cn"],
    restrictModels: true,
    test: { path: "/v1/models", method: "GET", bodyMode: "none" },
    submit: {
      path: "/v1/images/generations",
      method: "POST",
      bodyMode: "json",
      mappings: imageMappings,
      response: { statusPath: "$.status" },
    },
    output: {
      path: "$.data",
      kind: "image",
      urlPath: "url",
      base64Path: "b64_json",
      defaultMimeType: "image/png",
    },
    statusMap: {
      queued: "queued",
      pending: "queued",
      running: "running",
      processing: "running",
      in_progress: "running",
      completed: "succeeded",
      succeeded: "succeeded",
      failed: "failed",
      error: "failed",
      cancelled: "cancelled",
      canceled: "cancelled",
    },
    models: structuredClone(models),
    modelOverrides,
  };
}

export function cyberAfeiCatalogFromPricing(
  payload: PricingPayload,
): CyberAfeiCatalogSnapshot {
  const checkedAt = new Date().toISOString();
  const records = Array.isArray(payload.data)
    ? payload.data.filter(isRecord).map((record) => record as PricingRecord)
    : [];
  const ratios = numbers(payload.group_ratio);
  const descriptions = stringMap(payload.usable_group);
  const groups: Record<string, ModelDescriptor[]> = {};
  const groupIds = new Set<string>();
  const marketplaceByGroup = new Map<string, CyberAfeiMarketplaceModel[]>();

  for (const record of records) {
    const enabledGroups = strings(record.enable_groups);
    const descriptor = descriptorFor(record);
    for (const group of enabledGroups) {
      groupIds.add(group);
      const ratio = ratios[group] ?? 1;
      const marketplace = marketplaceModel(record, ratio);
      if (marketplace) {
        const models = marketplaceByGroup.get(group) ?? [];
        models.push(marketplace);
        marketplaceByGroup.set(group, models);
      }
      if (descriptor) {
        const models = groups[group] ?? [];
        if (!models.some((model) => model.id === descriptor.id))
          models.push(
            descriptorWithPricing(descriptor, record, group, ratio, checkedAt),
          );
        groups[group] = models;
      }
    }
  }

  const marketplaceGroups = [...groupIds]
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((id) => ({
      id,
      description: descriptions[id] ?? "",
      ratio: ratios[id] ?? 1,
      canvasSupported: (groups[id]?.length ?? 0) > 0,
      canvasModelCount: groups[id]?.length ?? 0,
      models: (marketplaceByGroup.get(id) ?? []).sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    }));

  return {
    checkedAt,
    source: "live",
    groups,
    marketplaceGroups,
  };
}

/**
 * Resolves one saved key's live `/v1/models` scan against public pricing.
 *
 * The scan is authoritative for visibility: pricing-only IDs are omitted,
 * while scan-only IDs remain visible with an unknown price. Canvas models are
 * the scanned subset for which this module has a verified protocol descriptor.
 */
export function resolveCyberAfeiScannedGroup(
  catalog: CyberAfeiCatalogSnapshot,
  group: string,
  scannedIds: readonly string[],
  options?: { capabilityBlocks?: unknown },
): CyberAfeiResolvedScannedGroup {
  const publicGroup = catalog.marketplaceGroups.find(
    (candidate) => candidate.id === group,
  );
  const publicModels = new Map(
    (publicGroup?.models ?? []).map((model) => [model.id, model] as const),
  );
  const ids = [
    ...new Set(
      scannedIds.flatMap((id) => {
        const normalized = id.trim();
        return normalized ? [normalized] : [];
      }),
    ),
  ];
  const capabilityBlocks = parseCyberAfeiCapabilityBlocks(
    options?.capabilityBlocks,
  );
  const blockedCapabilities = new Map(
    capabilityBlocks.map((block) => [block.capability, block] as const),
  );
  const descriptors = new Map<string, ModelDescriptor>();
  const models = ids.map((id): CyberAfeiMarketplaceModel => {
    const priced = publicModels.get(id);
    const model: CyberAfeiMarketplaceModel = priced
      ? {
          ...priced,
          tags: [...priced.tags],
          endpointTypes: [...priced.endpointTypes],
        }
      : marketplaceModel({ model_name: id }, publicGroup?.ratio ?? 1)!;
    const descriptor = descriptorFor({
      model_name: model.id,
      description: model.description,
      tags: model.tags,
      supported_endpoint_types: model.endpointTypes,
    });
    if (!descriptor)
      return {
        ...model,
        canvasRunnable: false,
        canvasUnavailableReason:
          model.capability === "chat"
            ? "对话模型不用于画布"
            : "尚无已验证的画布生成协议",
      };
    const capability = descriptorCanvasCapability(descriptor);
    const block = capability ? blockedCapabilities.get(capability) : undefined;
    if (block)
      return {
        ...model,
        canvasRunnable: false,
        canvasUnavailableReason:
          capability === "image"
            ? "当前分组未开通图片生成（已确认上游 403）"
            : "当前分组未开通视频生成（已确认上游 403）",
      };
    descriptors.set(model.id, descriptor);
    return { ...model, canvasRunnable: true };
  });
  const canvasModels: ModelDescriptor[] = [];
  const canvasDisplayModels: ModelDescriptor[] = [];
  for (const model of models) {
    if (model.capability !== "image" && model.capability !== "video") continue;
    const sharedMetadata = {
      supplier: CYBERAFEI_SUPPLIER_KEY,
      modelGroup: group,
      groupRatio: publicGroup?.ratio ?? 1,
      priceLabel: model.priceLabel,
      billingLabel: model.billingLabel,
      catalogCapability: model.capability,
    } as const;
    const descriptor = model.canvasRunnable
      ? descriptors.get(model.id)
      : undefined;
    if (descriptor) {
      const runnableDescriptor: ModelDescriptor = {
        ...descriptor,
        name: `${descriptor.name} · ${model.priceLabel}`,
        metadata: {
          ...(descriptor.metadata ?? {}),
          ...sharedMetadata,
          canvasRunnable: true,
        },
      };
      canvasModels.push(runnableDescriptor);
      canvasDisplayModels.push(runnableDescriptor);
      continue;
    }
    canvasDisplayModels.push({
      id: model.id,
      name: `${model.name} · ${model.priceLabel}`,
      description: model.description,
      operations:
        model.capability === "image" ? IMAGE_OPERATIONS : VIDEO_OPERATIONS,
      metadata: {
        ...sharedMetadata,
        canvasRunnable: false,
        canvasUnavailableReason:
          model.canvasUnavailableReason ?? "尚无已验证的画布生成协议",
        docsPath: "/pricing",
      },
    });
  }
  return {
    marketplaceGroup: {
      id: group,
      description: publicGroup?.description ?? "",
      ratio: publicGroup?.ratio ?? 1,
      canvasSupported: canvasModels.length > 0,
      canvasModelCount: canvasModels.length,
      models,
    },
    canvasModels,
    canvasDisplayModels,
  };
}

async function checkedFetch(
  fetchImpl: typeof fetch,
  path: string,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetchImpl(`${CYBERAFEI_BASE_URL}${path}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok)
    throw new Error(`赛博阿飞目录检查失败 (${response.status})`);
  return response;
}

export async function loadCyberAfeiCatalog(options?: {
  force?: boolean;
  fetch?: typeof fetch;
}): Promise<CyberAfeiCatalogSnapshot> {
  const cache = catalogCache();
  if (!options?.force && cache.snapshot && cache.expiresAt > Date.now())
    return cache.snapshot;
  if (cache.pending) return cache.pending;
  const fetchImpl = options?.fetch ?? fetch;
  cache.pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
    try {
      const pricingResponse = await checkedFetch(
        fetchImpl,
        "/api/pricing",
        controller.signal,
      );
      const snapshot = cyberAfeiCatalogFromPricing(
        (await pricingResponse.json()) as PricingPayload,
      );
      cache.snapshot = snapshot;
      cache.expiresAt = Date.now() + CATALOG_TTL_MS;
      return snapshot;
    } catch {
      cache.snapshot = {
        checkedAt: new Date().toISOString(),
        source: "unavailable",
        groups: {},
        marketplaceGroups: [],
      };
      cache.expiresAt = Date.now() + CATALOG_RETRY_MS;
      return cache.snapshot;
    } finally {
      clearTimeout(timeout);
      cache.pending = undefined;
    }
  })();
  return cache.pending;
}

export function cyberAfeiDefaultModelForGroup(
  group: string,
  models: readonly ModelDescriptor[],
): string {
  const preferred =
    group === "image-2稳定生图"
      ? ["gpt-image-4K", "gpt-image-2"]
      : group === "特价seedance2.0"
        ? ["video-v1-5s", "video-v1-10s"]
        : ["gemini-3.1-flash-image-preview"];
  return (
    preferred.find((id) => models.some((model) => model.id === id)) ??
    models[0]?.id ??
    ""
  );
}

export function cyberAfeiConnectorForGroup(
  _group: string,
  models: readonly ModelDescriptor[],
): RestConnectorConfig {
  return cyberAfeiConnectorForModels(models);
}

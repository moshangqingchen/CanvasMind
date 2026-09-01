import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterOption,
  RestConnectorConfig,
  RestRequestMapping,
} from "@super-canvas/providers";
import {
  CHENTU_BASE_URL,
  CHENTU_DEFAULT_MODEL,
  CHENTU_PLATFORM_GROUPS,
  CHENTU_SUPPLIER_KEY,
  chentuDefaultModelForGroup,
} from "./chentu-presets";
import { providerPriceUnit } from "./provider-pricing-unit";

/** Site origin without the /v1 suffix carried by CHENTU_BASE_URL. */
export const CHENTU_SITE_URL = CHENTU_BASE_URL.replace(/\/v1\/?$/u, "");
export const CHENTU_CATALOG_SOURCE = `${CHENTU_SITE_URL}/api/pricing`;

const CATALOG_TTL_MS = 60_000;
const CATALOG_RETRY_MS = 15_000;
const CATALOG_TIMEOUT_MS = 12_000;
const IMAGE_OPERATIONS = ["image.generate", "image.edit"] as const;
const VIDEO_OPERATIONS = ["video.generate", "video.image-to-video"] as const;
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const VIDEO_INPUT_KINDS = [
  "text",
  "image",
  "image[]",
  "video",
  "video[]",
  "audio",
  "audio[]",
] as const;

const CHAT_ONLY_VIDEO_REASON = "仅支持对话式接口调用，画布协议未验证";
const NO_PROTOCOL_REASON = "尚无已验证的画布生成协议";
const CHAT_MODEL_REASON = "对话模型不用于画布";

interface PricingRecord {
  model_name?: unknown;
  description?: unknown;
  tags?: unknown;
  model_price?: unknown;
  model_ratio?: unknown;
  completion_ratio?: unknown;
  quota_type?: unknown;
  enable_groups?: unknown;
  supported_endpoint_types?: unknown;
  billing_mode?: unknown;
  request_unit?: unknown;
  video_api?: unknown;
}

export interface ChentuPricingPayload {
  data?: unknown;
  group_ratio?: unknown;
  usable_group?: unknown;
}

export interface ChentuMarketplaceModelLive {
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

export interface ChentuMarketplaceGroupLive {
  id: string;
  description: string;
  ratio: number;
  canvasSupported: boolean;
  canvasModelCount: number;
  models: ChentuMarketplaceModelLive[];
}

export interface ChentuCatalogSnapshot {
  checkedAt: string;
  source: "live" | "stale" | "fallback";
  groups: Record<string, ModelDescriptor[]>;
  marketplaceGroups: ChentuMarketplaceGroupLive[];
}

export interface ChentuResolvedScannedGroup {
  marketplaceGroup: ChentuMarketplaceGroupLive;
  canvasModels: ModelDescriptor[];
  /**
   * Key-scanned image/video inventory for the canvas selector. Models without
   * a verified protocol stay visible here as disabled descriptors, while
   * `canvasModels` remains the strictly runnable allow-list.
   */
  canvasDisplayModels: ModelDescriptor[];
}

interface CatalogCache {
  snapshot?: ChentuCatalogSnapshot;
  expiresAt: number;
  pending?: Promise<ChentuCatalogSnapshot>;
}

const globalCacheKey = "__superCanvasChentuCatalog";

function catalogCache(): CatalogCache {
  const scope = globalThis as typeof globalThis & {
    [globalCacheKey]?: CatalogCache;
  };
  return (scope[globalCacheKey] ??= { expiresAt: 0 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function looksLikeVideoModel(id: string): boolean {
  return /(?:video|seedance|kling|veo|omni|happyhorse|minimax|h3|lg-|xinqi|sd[-_]|sd2|wan)/iu.test(
    id,
  );
}

function looksLikeImageModel(id: string): boolean {
  return /(?:image|banana|flux|seedream|imagen|dall-e|绘图|生图)/iu.test(id);
}

function looksLikeChatModel(id: string): boolean {
  return (
    /^(?:gpt-5|claude-|grok-4)/iu.test(id) ||
    /^gemini-3.*(?:flash|pro-preview)$/iu.test(id)
  );
}

function capabilityFor(
  record: PricingRecord,
  id: string,
): ChentuMarketplaceModelLive["capability"] {
  const endpoints = strings(record.supported_endpoint_types);
  if (endpoints.includes("image-generation")) return "image";
  if (endpoints.includes("openai-video")) return "video";
  const groups = strings(record.enable_groups);
  if (looksLikeVideoModel(id) || groups.some((group) => /视频/u.test(group)))
    return "video";
  if (looksLikeImageModel(id)) return "image";
  if (looksLikeChatModel(id)) return "chat";
  return "other";
}

/**
 * Chentu quota units map 1:1 to ￥ (verified against the live marketplace:
 * gpt-image-2 0.02735 × 0.55 = ￥0.015/请求). The numeric formula matches the
 * Cyber Afei template; only the currency symbol differs.
 */
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
      label: `输入 ￥${formatPrice(input)} / 1M · 输出 ￥${formatPrice(output)} / 1M`,
      billing: "按量计费",
    };
  }
  if (modelPrice !== undefined) {
    const price = modelPrice * groupRatio;
    const perSecond = providerPriceUnit(record) === "second";
    return {
      label: `￥ ${formatPrice(price)} / ${perSecond ? "秒" : "请求"}`,
      billing: perSecond ? "按秒计费" : "按次计费",
    };
  }
  return { label: "价格以平台为准", billing: "以平台为准" };
}

const RATIO_OPTIONS: readonly ModelParameterOption[] = [
  { label: "16:9 横屏", value: "16:9" },
  { label: "9:16 竖屏", value: "9:16" },
  { label: "1:1 方形", value: "1:1" },
  { label: "4:3 横屏", value: "4:3" },
  { label: "3:4 竖屏", value: "3:4" },
  { label: "21:9 超宽屏", value: "21:9" },
];

/**
 * 辰途 GPT Image 2 的文档尺寸表。
 *
 * Keep these values in the live catalog as well as in the OpenAI adapter. The
 * settings modal renders the descriptor returned by the live /v1/models scan;
 * without the same metadata it falls back to the generic aspect-ratio fields
 * and loses the 1K/2K/4K shortcuts.
 */
const CHENTU_GPT_1K_SIZES = [
  "auto",
  "720x1280",
  "1280x720",
  "1024x1024",
  "1024x768",
  "768x1024",
  "1680x720",
  "1824x1024",
  "1024x1824",
  "1344x1024",
  "1024x1344",
  "1536x1024",
  "1024x1536",
  "1792x768",
  "768x1792",
  "1792x1024",
  "1024x1792",
] as const;
const CHENTU_GPT_2K_SIZES = [
  "2048x2048",
  "2048x1360",
  "1360x2048",
  "2048x1152",
  "1152x2048",
  "2048x1536",
  "1536x2048",
  "2048x896",
  "896x2048",
] as const;
const CHENTU_GPT_4K_SIZES = [
  "2880x2880",
  "3520x2336",
  "2336x3520",
  "3840x2160",
  "2160x3840",
  "3312x2480",
  "2480x3312",
  "3840x1648",
  "1648x3840",
] as const;
const CHENTU_GPT_1K_RATIOS = [
  "自动",
  "9:16",
  "16:9",
  "1:1",
  "4:3",
  "3:4",
  "21:9",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "21:9",
  "9:21",
  "7:4",
  "4:7",
] as const;
const CHENTU_GPT_HIGH_RES_RATIOS = [
  "1:1",
  "3:2",
  "2:3",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "21:9",
  "9:21",
] as const;
const CHENTU_GPT_FREE_SIZES = [
  "auto",
  ...CHENTU_GPT_1K_SIZES.slice(1),
  ...CHENTU_GPT_2K_SIZES,
  ...CHENTU_GPT_4K_SIZES,
] as const;
const CHENTU_GPT_FREE_RATIOS = [
  "自动",
  ...CHENTU_GPT_1K_RATIOS.slice(1),
  ...CHENTU_GPT_HIGH_RES_RATIOS,
  ...CHENTU_GPT_HIGH_RES_RATIOS,
] as const;

type ChentuResolutionTier = "1K" | "2K" | "4K";

function isChentuFlexibleImageModel(id: string): boolean {
  return id === "gpt-image-2自由传参";
}

function chentuGptResolutionTier(id: string): ChentuResolutionTier | undefined {
  if (/^gpt-image-2(?:-1k)?$/iu.test(id)) return "1K";
  if (id === "gpt-image-2-2k") return "2K";
  if (id === "gpt-image-2-4k") return "4K";
  return undefined;
}

function isKnownChentuImageModel(id: string): boolean {
  return (
    isChentuFlexibleImageModel(id) ||
    chentuGptResolutionTier(id) !== undefined ||
    /^gemini-3\.(?:1-flash|pro)-image-(?:1k|2k|4k)$/iu.test(id)
  );
}

function chentuGptSizeOptions(id: string): readonly ModelParameterOption[] {
  const flexible = isChentuFlexibleImageModel(id);
  const tier = chentuGptResolutionTier(id);
  const sizes = flexible
    ? CHENTU_GPT_FREE_SIZES
    : tier === "1K"
      ? CHENTU_GPT_1K_SIZES
      : tier === "2K"
        ? CHENTU_GPT_2K_SIZES
        : tier === "4K"
          ? CHENTU_GPT_4K_SIZES
          : [];
  const ratios = flexible
    ? CHENTU_GPT_FREE_RATIOS
    : tier === "1K"
      ? CHENTU_GPT_1K_RATIOS
      : tier === "2K" || tier === "4K"
        ? CHENTU_GPT_HIGH_RES_RATIOS
        : [];
  return sizes.map((value, index) => {
    const ratio = ratios[index];
    const optionTier = flexible
      ? index === 0
        ? undefined
        : index < CHENTU_GPT_1K_SIZES.length
          ? "1K"
          : index < CHENTU_GPT_1K_SIZES.length + CHENTU_GPT_2K_SIZES.length
            ? "2K"
            : "4K"
      : tier;
    return {
      label:
        value === "auto"
          ? "自动（提示词优先，其次参考图）"
          : `${optionTier ? `${optionTier} · ` : ""}${ratio ? `${ratio} · ` : ""}${value.replace("x", " × ")}`,
      value,
    };
  });
}

function chentuImageParameters(
  id: string,
  group?: string,
): readonly ModelParameterDescriptor[] {
  const gptImage = isKnownChentuImageModel(id) && /^gpt-image-2/iu.test(id);
  if (!gptImage) return [];

  const flexible = isChentuFlexibleImageModel(id);
  const official = group === "image2官key";
  const sizeOptions = chentuGptSizeOptions(id);
  const size: ModelParameterDescriptor = flexible
    ? {
        key: "size",
        label: "输出分辨率（size）",
        control: "dimensions",
        valueType: "string",
        default: "auto",
        min: 16,
        max: 8192,
        step: 16,
        options: sizeOptions,
        description:
          "自动模式优先读取提示词中的比例，其次参考图；选择 1K、2K 或 4K 后只显示该档位的常用比例和像素尺寸，也可填写自定义尺寸。",
        operations: IMAGE_OPERATIONS,
      }
    : {
        key: "size",
        label: "精确尺寸（辰途文档）",
        control: "select",
        valueType: "string",
        default: sizeOptions[0]?.value,
        options: sizeOptions,
        description:
          "尺寸必须来自该模型对应的辰途 API 文档；不要按倍率自行换算。",
        operations: IMAGE_OPERATIONS,
      };

  const quality: ModelParameterDescriptor = {
    key: "quality",
    label: "质量（quality）",
    control: "select",
    valueType: "string",
    default: official ? "standard" : "high",
    options: official
      ? [{ label: "标准（standard）", value: "standard" }]
      : [
          { label: "自动（auto）", value: "auto" },
          { label: "低（low）", value: "low" },
          { label: "中（medium）", value: "medium" },
          { label: "高（high）", value: "high" },
        ],
    description: official
      ? "image2 官 key 按辰途官方文档使用默认 standard 质量；提交时省略该字段。"
      : "辰途会把 quality 原样转发给 GPT Image 2；实际是否生效以目标模型为准。",
    operations: official ? ["image.generate"] : IMAGE_OPERATIONS,
  };

  return [
    size,
    {
      key: "n",
      label: "生成张数",
      control: "number",
      valueType: "integer",
      default: 1,
      min: 1,
      max: official ? 10 : 1,
      step: 1,
      description: official
        ? "image2 官 key 官方文档支持每次生成 1–10 张。"
        : "同步画布任务一次生成 1 张。",
      operations: IMAGE_OPERATIONS,
    },
    {
      key: "response_format",
      label: "返回方式",
      control: "select",
      valueType: "string",
      default: "url",
      options: [{ label: "URL（推荐，辰途链接有效 2 小时）", value: "url" }],
      operations: IMAGE_OPERATIONS,
    },
    quality,
    ...(official
      ? [
          {
            key: "style",
            label: "画风（style）",
            control: "select",
            valueType: "string",
            default: "vivid",
            options: [{ label: "鲜明（vivid）", value: "vivid" }],
            description: "image2 官 key 官方文档支持 vivid 画风。",
            operations: ["image.generate"] as const,
          } satisfies ModelParameterDescriptor,
        ]
      : []),
    ...(!official
      ? [
          {
            key: "output_format",
            label: "格式",
            control: "select",
            valueType: "string",
            default: "png",
            options: [
              { label: "PNG", value: "png" },
              { label: "JPEG", value: "jpeg" },
              { label: "WebP", value: "webp" },
            ],
            operations: IMAGE_OPERATIONS,
          } satisfies ModelParameterDescriptor,
        ]
      : []),
  ];
}

function videoParameters(): readonly ModelParameterDescriptor[] {
  return [
    {
      key: "duration",
      label: "时长（秒）",
      control: "number",
      valueType: "integer",
      default: 5,
      min: 1,
      max: 30,
      step: 1,
      description: "辰途 OpenAI Videos API 的 seconds 字段；必须为正整数。",
      operations: VIDEO_OPERATIONS,
    },
    {
      key: "aspect_ratio",
      label: "画面比例",
      control: "select",
      valueType: "string",
      default: "16:9",
      options: RATIO_OPTIONS,
      description: "按 API 的 ratio 字段发送。",
      operations: VIDEO_OPERATIONS,
    },
    {
      key: "resolution",
      label: "输出分辨率",
      control: "select",
      valueType: "string",
      default: "720p",
      options: ["480p", "720p", "1080p", "2k"].map((value) => ({
        label: value,
        value,
      })),
      description:
        "按 API 的 resolution 字段发送；具体可用档位以模型权限为准。",
      operations: VIDEO_OPERATIONS,
    },
  ];
}

function recordDescription(record: PricingRecord): string | undefined {
  return typeof record.description === "string" && record.description.trim()
    ? record.description.trim()
    : undefined;
}

function imageDescriptor(record: PricingRecord, id: string): ModelDescriptor {
  return {
    id,
    name: id,
    description:
      recordDescription(record) ??
      "辰途 API 图片模型；模型权限通过当前 API Key 的 /v1/models 实时扫描。",
    operations: IMAGE_OPERATIONS,
    parameters: chentuImageParameters(id),
    metadata: {
      supplier: CHENTU_SUPPLIER_KEY,
      protocol: "openai-images",
      liveInventory: true,
    },
    limits: {
      maxInputImages: 10,
      supportedMimeTypes: IMAGE_MIME_TYPES,
    },
  };
}

/**
 * Gives the canvas a documented parameter schema while the saved key's
 * authoritative `/v1/models` scan is still in flight. This is deliberately
 * limited to known image model IDs: it improves the editing experience, but
 * never expands what can be submitted after the live scan has finished.
 */
export function chentuFallbackImageDescriptor(
  id: string,
  group?: string,
): ModelDescriptor | undefined {
  if (!isKnownChentuImageModel(id)) return undefined;
  return {
    id,
    name: id,
    description: "正在以当前 API Key 实时扫描模型权限。",
    operations: IMAGE_OPERATIONS,
    parameters: chentuImageParameters(id, group),
    metadata: {
      supplier: CHENTU_SUPPLIER_KEY,
      protocol: "openai-images",
      liveInventory: true,
      pendingLiveScan: true,
    },
    limits: {
      maxInputImages: 10,
      supportedMimeTypes: IMAGE_MIME_TYPES,
    },
  };
}

function videoDescriptor(record: PricingRecord, id: string): ModelDescriptor {
  return {
    id,
    name: id,
    description:
      recordDescription(record) ??
      "辰途 OpenAI Videos 视频模型；通过 /v1/videos 提交并轮询任务。",
    operations: VIDEO_OPERATIONS,
    inputKinds: VIDEO_INPUT_KINDS,
    outputKinds: ["video"],
    parameters: videoParameters(),
    metadata: {
      supplier: CHENTU_SUPPLIER_KEY,
      modality: "video",
      protocol: "openai-videos",
      remoteMediaUrlsOnly: true,
    },
  };
}

/**
 * Returns a canvas-runnable descriptor only for protocols verified for chentu:
 * `image-generation` (existing OpenAI Images path) and `openai-video`
 * (`/v1/videos` submit + poll). Everything else stays marketplace-only.
 */
function descriptorFor(record: PricingRecord): ModelDescriptor | null {
  if (typeof record.model_name !== "string" || !record.model_name.trim())
    return null;
  const id = record.model_name.trim();
  const endpoints = strings(record.supported_endpoint_types);
  // Key scans can contain a documented GPT Image model that is absent from
  // the public pricing snapshot (for example gpt-image-2-2k). Treat those
  // known IDs as verified image protocols instead of downgrading them to a
  // disabled scan-only entry.
  if (endpoints.includes("image-generation") || isKnownChentuImageModel(id))
    return imageDescriptor(record, id);
  if (endpoints.includes("openai-video")) return videoDescriptor(record, id);
  return null;
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
            currency: "CNY",
            unitAmount: numericPrice,
            sourceUrl: CHENTU_CATALOG_SOURCE,
            checkedAt,
            confidence: "exact",
          } as const,
        }),
    name: `${descriptor.name} · ${price.label}`,
    ...(descriptor.operations.some((operation) =>
      operation.startsWith("image."),
    )
      ? { parameters: chentuImageParameters(descriptor.id, group) }
      : {}),
    metadata: {
      ...(descriptor.metadata ?? {}),
      supplier: CHENTU_SUPPLIER_KEY,
      modelGroup: group,
      groupRatio,
      priceLabel: price.label,
      billingLabel: price.billing,
      canvasRunnable: true,
    },
  };
}

function marketplaceModel(
  record: PricingRecord,
  ratio: number,
): ChentuMarketplaceModelLive | null {
  if (typeof record.model_name !== "string" || !record.model_name.trim())
    return null;
  const id = record.model_name.trim();
  const prices = priceFor(record, ratio);
  const capability = capabilityFor(record, id);
  const endpoints = strings(record.supported_endpoint_types);
  const runnable =
    endpoints.includes("image-generation") ||
    endpoints.includes("openai-video") ||
    isKnownChentuImageModel(id);
  return {
    id,
    name: id,
    ...(recordDescription(record)
      ? { description: recordDescription(record) }
      : {}),
    capability,
    priceLabel: prices.label,
    billingLabel: prices.billing,
    tags: tags(record.tags),
    endpointTypes: endpoints,
    ...(runnable
      ? { canvasRunnable: true }
      : capability === "image" || capability === "video"
        ? {
            canvasRunnable: false,
            canvasUnavailableReason:
              capability === "video" && endpoints.includes("openai")
                ? CHAT_ONLY_VIDEO_REASON
                : NO_PROTOCOL_REASON,
          }
        : {}),
  };
}

export function chentuCatalogFromPricing(
  payload: ChentuPricingPayload,
): ChentuCatalogSnapshot {
  const checkedAt = new Date().toISOString();
  const records = Array.isArray(payload.data)
    ? payload.data.filter(isRecord).map((record) => record as PricingRecord)
    : [];
  const ratios = numbers(payload.group_ratio);
  const descriptions = stringMap(payload.usable_group);
  const groups: Record<string, ModelDescriptor[]> = {};
  const groupIds = new Set<string>();
  const marketplaceByGroup = new Map<string, ChentuMarketplaceModelLive[]>();

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
 * Built-in snapshot derived from the static 2026-08-27 marketplace capture in
 * chentu-presets.ts. Used only when live pricing fails and no stale live
 * snapshot exists yet.
 */
function fallbackSnapshot(): ChentuCatalogSnapshot {
  const groups: Record<string, ModelDescriptor[]> = {};
  const marketplaceGroups: ChentuMarketplaceGroupLive[] = [];
  for (const group of CHENTU_PLATFORM_GROUPS) {
    marketplaceGroups.push({
      id: group.id,
      description: group.description,
      ratio: group.ratio,
      canvasSupported: group.models.length > 0,
      canvasModelCount: group.models.length,
      models: group.models.map((model) => ({
        id: model.id,
        name: model.name,
        description: model.description,
        capability: model.capability,
        priceLabel: model.priceLabel,
        billingLabel: model.billingLabel,
        tags: [...model.tags],
        endpointTypes: [...model.endpointTypes],
        canvasRunnable: true,
      })),
    });
    if (group.models.length === 0) continue;
    groups[group.id] = group.models.map((model) => ({
      id: model.id,
      name: `${model.name} · ${model.priceLabel}`,
      description: model.description,
      operations: IMAGE_OPERATIONS,
      metadata: {
        supplier: CHENTU_SUPPLIER_KEY,
        modelGroup: group.id,
        groupRatio: group.ratio,
        priceLabel: model.priceLabel,
        billingLabel: model.billingLabel,
        protocol: "openai-images",
        liveInventory: true,
        canvasRunnable: true,
      },
      parameters: chentuImageParameters(model.id, group.id),
      limits: {
        maxInputImages: 10,
        supportedMimeTypes: IMAGE_MIME_TYPES,
      },
    }));
  }
  return {
    checkedAt: new Date().toISOString(),
    source: "fallback",
    groups,
    marketplaceGroups,
  };
}

async function checkedFetch(
  fetchImpl: typeof fetch,
  path: string,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetchImpl(`${CHENTU_SITE_URL}${path}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`辰途目录检查失败 (${response.status})`);
  return response;
}

/**
 * Loads the live 辰途 pricing catalog with a degradation ladder:
 * live → stale (last good live snapshot) → built-in fallback preset.
 */
export async function loadChentuCatalog(options?: {
  force?: boolean;
  fetch?: typeof fetch;
}): Promise<ChentuCatalogSnapshot> {
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
      const snapshot = chentuCatalogFromPricing(
        (await pricingResponse.json()) as ChentuPricingPayload,
      );
      if (snapshot.marketplaceGroups.length === 0)
        throw new Error("辰途模型广场未返回任何分组");
      cache.snapshot = snapshot;
      cache.expiresAt = Date.now() + CATALOG_TTL_MS;
      return snapshot;
    } catch {
      if (cache.snapshot && cache.snapshot.source !== "fallback") {
        cache.snapshot = { ...cache.snapshot, source: "stale" };
        cache.expiresAt = Date.now() + CATALOG_RETRY_MS;
        return cache.snapshot;
      }
      cache.snapshot = fallbackSnapshot();
      cache.expiresAt = Date.now() + CATALOG_RETRY_MS;
      return cache.snapshot;
    } finally {
      clearTimeout(timeout);
      cache.pending = undefined;
    }
  })();
  return cache.pending;
}

/**
 * Resolves one saved key's live `/v1/models` scan against public pricing.
 *
 * The scan is authoritative for visibility: pricing-only IDs are omitted,
 * while scan-only IDs remain visible with an unknown price. Canvas models are
 * the scanned subset for which this module has a verified protocol descriptor.
 */
export function resolveChentuScannedGroup(
  catalog: ChentuCatalogSnapshot,
  group: string,
  scannedIds: readonly string[],
): ChentuResolvedScannedGroup {
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
  const descriptors = new Map<string, ModelDescriptor>();
  const models = ids.map((id): ChentuMarketplaceModelLive => {
    const priced = publicModels.get(id);
    const model: ChentuMarketplaceModelLive = priced
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
            ? CHAT_MODEL_REASON
            : (model.canvasUnavailableReason ?? NO_PROTOCOL_REASON),
      };
    descriptors.set(model.id, descriptor);
    return { ...model, canvasRunnable: true };
  });
  const canvasModels: ModelDescriptor[] = [];
  const canvasDisplayModels: ModelDescriptor[] = [];
  for (const model of models) {
    if (model.capability !== "image" && model.capability !== "video") continue;
    const sharedMetadata = {
      supplier: CHENTU_SUPPLIER_KEY,
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
        ...(descriptor.operations.some((operation) =>
          operation.startsWith("image."),
        )
          ? { parameters: chentuImageParameters(model.id, group) }
          : {}),
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
          model.canvasUnavailableReason ?? NO_PROTOCOL_REASON,
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

const videoSubmitMappings: readonly RestRequestMapping[] = [
  { target: "/model", source: { kind: "request", path: "$.model" } },
  { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
  {
    target: "/seconds",
    source: { kind: "request", path: "$.parameters.duration" },
  },
  {
    target: "/ratio",
    source: { kind: "request", path: "$.parameters.aspect_ratio" },
    omitIfUndefined: true,
  },
  {
    target: "/resolution",
    source: { kind: "request", path: "$.parameters.resolution" },
    omitIfUndefined: true,
  },
  {
    target: "/image_urls",
    source: { kind: "assets", assetKind: "image" },
    omitIfEmpty: true,
  },
  {
    target: "/video_urls",
    source: { kind: "assets", assetKind: "video" },
    omitIfEmpty: true,
  },
  {
    target: "/audio_urls",
    source: { kind: "assets", assetKind: "audio" },
    omitIfEmpty: true,
  },
];

/**
 * OpenAI Videos rest connector for 辰途 video groups, modeled on the 喵呜
 * MIAOWU_CONNECTOR: submit /v1/videos, poll /v1/videos/{taskId}.
 */
export function chentuVideoConnectorForModels(
  models: readonly ModelDescriptor[],
): RestConnectorConfig {
  return {
    auth: { type: "bearer" },
    allowedHosts: ["tu.988236.xyz"],
    assetsRequirePublicUrls: true,
    restrictModels: true,
    models: structuredClone(models),
    pollIntervalMs: 4_000,
    submit: {
      path: "/v1/videos",
      method: "POST",
      bodyMode: "json",
      mappings: videoSubmitMappings,
      response: {
        taskIdPath: "$.id",
        statusPath: "$.status",
        progressPath: "$.progress",
        errorPath: "$.error.message",
      },
    },
    poll: {
      path: "/v1/videos/{taskId}",
      method: "GET",
      bodyMode: "none",
      response: {
        taskIdPath: "$.id",
        statusPath: "$.status",
        progressPath: "$.progress",
        errorPath: "$.error.message",
      },
    },
    statusMap: {
      queued: "queued",
      pending: "queued",
      in_progress: "running",
      running: "running",
      processing: "running",
      completed: "succeeded",
      succeeded: "succeeded",
      failed: "failed",
      cancelled: "cancelled",
      canceled: "cancelled",
    },
    output: {
      path: "$.url",
      fallbackPaths: ["$.data.url", "$.video_url", "$.result_url"],
      kind: "video",
      defaultMimeType: "video/mp4",
    },
  };
}

export function chentuDefaultModelForLiveGroup(
  group: string,
  models: readonly ModelDescriptor[],
): string {
  const preferred = [chentuDefaultModelForGroup(group), CHENTU_DEFAULT_MODEL];
  return (
    preferred.find((id) => models.some((model) => model.id === id)) ??
    models.find((model) =>
      model.operations.some((operation) => operation.startsWith("image.")),
    )?.id ??
    models[0]?.id ??
    ""
  );
}

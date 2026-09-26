import {
  providerFetch,
  type ModelDescriptor,
  type ModelParameterDescriptor,
  type ModelParameterOption,
  type RestConnectorConfig,
} from "@super-canvas/providers";
import {
  MIAOWU_CONNECTOR,
  MIAOWU_CHAT_VIDEO_OVERRIDE,
  MIAOWU_DEFAULT_MODEL,
  MIAOWU_MODELS,
} from "./miaowu-presets";
import { providerPriceUnit } from "./provider-pricing-unit";

export const MIAOWU_CATALOG_SOURCE = "https://api.miaowuai.store/api/pricing";

const CATALOG_TTL_MS = 60_000;
const CATALOG_RETRY_MS = 15_000;
const CATALOG_TIMEOUT_MS = 12_000;

const VIDEO_OPERATIONS = ["video.generate", "video.image-to-video"] as const;
/**
 * 喵呜（new-api）计价单位换算：`model_price` 是平台配额单位，人民币价格为
 * `model_price × 7`（平台美元→人民币汇率 7）。证据（2026-08-28 实测对照
 * 2026-08-17 快照）：seedance-2.0-mini 0.1142857×7=¥0.80（快照 ¥1，官方降价后
 * 一致）；seedance-2.0-pro 0.2857×7=¥2.0。
 */
const QUOTA_TO_CNY = 7;

interface PricingRecord {
  model_name?: unknown;
  description?: unknown;
  quota_type?: unknown;
  model_ratio?: unknown;
  model_price?: unknown;
  completion_ratio?: unknown;
  enable_groups?: unknown;
  supported_endpoint_types?: unknown;
  video_api?: unknown;
}

interface PricingPayload {
  data?: unknown;
  group_ratio?: unknown;
  usable_group?: unknown;
  auto_groups?: unknown;
}

interface VideoApiRecord {
  modes?: unknown;
  images_max?: unknown;
  videos_max?: unknown;
  audios_max?: unknown;
  seconds_min?: unknown;
  seconds_max?: unknown;
  sizes?: unknown;
  ratios?: unknown;
  resolutions?: unknown;
  pricing?: unknown;
}

export interface MiaowuMarketplaceModel {
  id: string;
  name: string;
  description: string;
  capability: "chat" | "video";
  priceLabel: string;
  billingLabel: string;
  tags: string[];
  endpointTypes: string[];
}

export interface MiaowuMarketplaceGroup {
  id: string;
  description: string;
  ratio: number;
  canvasSupported: boolean;
  canvasModelCount: number;
  models: MiaowuMarketplaceModel[];
}

export interface MiaowuCatalogSnapshot {
  checkedAt: string;
  source: "live" | "stale" | "fallback";
  models: ModelDescriptor[];
  marketplaceModels: MiaowuMarketplaceModel[];
  marketplaceGroups: MiaowuMarketplaceGroup[];
}

interface CatalogCache {
  snapshot?: MiaowuCatalogSnapshot;
  expiresAt: number;
  pending?: Promise<MiaowuCatalogSnapshot>;
}

const globalCacheKey = "__superCanvasMiaowuCatalog";

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

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      typeof item === "number" && Number.isFinite(item) ? [[key, item]] : [],
    ),
  );
}

/** 人民币价格格式化：最多两位小数并去掉末尾多余的 0。 */
function formatYuan(value: number): string {
  return `${Number(value.toFixed(2))}`;
}

const RATIO_OPTIONS: readonly ModelParameterOption[] = [
  { label: "16:9 横屏", value: "16:9" },
  { label: "9:16 竖屏", value: "9:16" },
  { label: "1:1 方形", value: "1:1" },
  { label: "4:3 横屏", value: "4:3" },
  { label: "3:4 竖屏", value: "3:4" },
  { label: "21:9 超宽屏", value: "21:9" },
];

interface ParameterOverrides {
  minSeconds?: number;
  maxSeconds?: number;
  defaultSeconds?: number;
  resolutions?: readonly string[];
  defaultResolution?: string;
  ratios?: readonly string[];
}

/**
 * 与 miaowu-presets.ts 的 parameters() 保持一致（该构建器未导出，这里保留
 * 一份最小等价实现：duration / aspect_ratio / resolution）。
 */
function parameters(
  input: ParameterOverrides = {},
): readonly ModelParameterDescriptor[] {
  const resolutions = input.resolutions ?? ["720p"];
  const ratios =
    input.ratios ?? RATIO_OPTIONS.map((option) => String(option.value));
  return [
    {
      key: "duration",
      label: "时长（秒）",
      control: "number",
      valueType: "integer",
      default: input.defaultSeconds ?? 5,
      min: input.minSeconds ?? 1,
      max: input.maxSeconds ?? 30,
      step: 1,
      description:
        input.maxSeconds === undefined
          ? "喵呜文档仅规定 seconds 为正整数，未公开该模型上限；画布为防误输入暂限制 30 秒。"
          : "喵呜 OpenAI Videos API 的 seconds 字段；范围按模型广场已知限制设置。",
      operations: VIDEO_OPERATIONS,
    },
    {
      key: "aspect_ratio",
      label: "画面比例",
      control: "select",
      valueType: "string",
      default: ratios.includes("16:9") ? "16:9" : ratios[0],
      options: ratios.map(
        (value) =>
          RATIO_OPTIONS.find((option) => option.value === value) ?? {
            label: value,
            value,
          },
      ),
      description: "按 API 的 ratio 字段发送。",
      operations: VIDEO_OPERATIONS,
    },
    {
      key: "resolution",
      label: "输出分辨率",
      control: "select",
      valueType: "string",
      default: input.defaultResolution ?? "720p",
      options: resolutions.map((value) => ({ label: value, value })),
      description:
        input.resolutions === undefined
          ? "平台未公开该模型的分辨率档位；画布仅保留文档示例 720p，避免发送未经确认的 2k。"
          : "按 API 的 resolution 字段发送；档位来自模型广场已知说明。",
      operations: VIDEO_OPERATIONS,
    },
  ];
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}

function videoApiRecord(record: PricingRecord): VideoApiRecord | undefined {
  return isRecord(record.video_api)
    ? (record.video_api as VideoApiRecord)
    : undefined;
}

function videoParameterOverrides(videoApi: VideoApiRecord): ParameterOverrides {
  const minSeconds = nonNegativeInteger(videoApi.seconds_min) || undefined;
  const maxSeconds = nonNegativeInteger(videoApi.seconds_max) || undefined;
  const resolutions = [...new Set(strings(videoApi.sizes))];
  const ratios = [...new Set(strings(videoApi.ratios))];
  return {
    ...(minSeconds ? { minSeconds, defaultSeconds: minSeconds } : {}),
    ...(maxSeconds ? { maxSeconds } : {}),
    ...(resolutions.length > 0
      ? { resolutions, defaultResolution: resolutions[0] }
      : {}),
    ...(ratios.length > 0 ? { ratios } : {}),
  };
}

const GENERIC_DESCRIPTION = "喵呜模型广场的按次计费视频模型。";
const PER_SECOND_LABEL = "按秒计费·价格以平台为准";

interface ParsedPricing {
  group: string;
  ratio: number;
  priceLabel: string;
  billingLabel: string;
  unit: "second" | "request";
  maximum?: number;
}

function videoRulePrices(record: PricingRecord): number[] {
  if (!isRecord(record.video_api) || !isRecord(record.video_api.pricing))
    return [];
  const rules = record.video_api.pricing.rules;
  if (!Array.isArray(rules)) return [];
  return rules.flatMap((rule) => {
    if (!isRecord(rule)) return [];
    const price = rule.price;
    return typeof price === "number" && Number.isFinite(price) && price >= 0
      ? [price]
      : [];
  });
}

function formattedPriceRange(values: readonly number[]): string | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  const minimum = formatYuan(sorted[0]!);
  const maximum = formatYuan(sorted.at(-1)!);
  return minimum === maximum ? minimum : `${minimum}–${maximum}`;
}

function pricingFor(
  record: PricingRecord,
  groupRatios: Record<string, number>,
  requestedGroup?: string,
): ParsedPricing {
  const groups = strings(record.enable_groups);
  const group =
    requestedGroup ??
    (groups.includes("default") ? "default" : (groups[0] ?? "default"));
  const ratio = groupRatios[group] ?? 1;
  const unit =
    providerPriceUnit(record) ??
    (record.quota_type === 0 ? "second" : "request");
  const rulePrices = videoRulePrices(record);
  const modelPrice =
    typeof record.model_price === "number" &&
    Number.isFinite(record.model_price) &&
    record.model_price > 0
      ? record.model_price
      : undefined;
  const rawPrices =
    rulePrices.length > 0 ? rulePrices : modelPrice ? [modelPrice] : [];
  const yuanPrices = rawPrices.map((price) => price * QUOTA_TO_CNY * ratio);
  const yuanRange = formattedPriceRange(yuanPrices);
  const maximum = yuanPrices.length > 0 ? Math.max(...yuanPrices) : undefined;
  if (!yuanRange) {
    return {
      group,
      ratio,
      unit,
      priceLabel: unit === "second" ? PER_SECOND_LABEL : "价格以平台为准",
      billingLabel: unit === "second" ? "按秒计费" : "按次计费",
    };
  }
  return {
    group,
    ratio,
    unit,
    maximum,
    priceLabel: `¥${yuanRange}/${unit === "second" ? "秒" : "次"}`,
    billingLabel: unit === "second" ? "按秒计费" : "按次计费",
  };
}

function descriptorFor(
  id: string,
  record: PricingRecord,
  pricing: ParsedPricing,
  checkedAt: string,
): ModelDescriptor {
  const description =
    typeof record.description === "string" && record.description.trim()
      ? record.description.trim()
      : GENERIC_DESCRIPTION;
  const videoApi = videoApiRecord(record)!;
  const imagesMax = nonNegativeInteger(videoApi.images_max);
  const videosMax = nonNegativeInteger(videoApi.videos_max);
  const audiosMax = nonNegativeInteger(videoApi.audios_max);
  const inputKinds = [
    "text",
    ...(imagesMax > 0 ? ["image", ...(imagesMax > 1 ? ["image[]"] : [])] : []),
    ...(videosMax > 0 ? ["video", ...(videosMax > 1 ? ["video[]"] : [])] : []),
    ...(audiosMax > 0 ? ["audio", ...(audiosMax > 1 ? ["audio[]"] : [])] : []),
  ] as ModelDescriptor["inputKinds"];
  return {
    id,
    name: `${id}（${pricing.priceLabel}）`,
    description,
    operations: VIDEO_OPERATIONS,
    inputKinds,
    outputKinds: ["video"],
    isDefault: id === MIAOWU_DEFAULT_MODEL,
    parameters: parameters(videoParameterOverrides(videoApi)),
    ...(pricing.maximum === undefined
      ? {}
      : {
          pricing: {
            kind: pricing.unit === "second" ? "per-second" : "per-request",
            currency: "CNY",
            unitAmount: pricing.maximum,
            sourceUrl: MIAOWU_CATALOG_SOURCE,
            checkedAt,
            confidence: "exact",
          } as const,
        }),
    metadata: {
      modality: "video",
      marketplaceGroup: pricing.group,
      pricingGroupRatio: pricing.ratio,
      priceLabel: pricing.priceLabel,
      billingLabel: pricing.billingLabel,
      pricingCheckedAt: checkedAt,
      remoteMediaUrlsOnly: true,
      supportsFirstLastFrames: imagesMax >= 2,
      parameterSource: "pricing.video_api",
      clampNumericParameters: true,
      ...(id === "seedance-2.0-mini"
        ? {
            durationMaxByResolution: { "720p": 12 },
          }
        : {}),
    },
    limits: {
      maxInputImages: imagesMax,
      maxInputVideos: videosMax,
      maxInputAudios: audiosMax,
    },
  };
}

export function miaowuUnparameterizedVideoDescriptor(
  id: string,
  options?: {
    name?: string;
    description?: string;
    group?: string;
    checkedAt?: string;
    parameterSource?: "pricing.model-detail" | "key-model-scan";
  },
): ModelDescriptor {
  return {
    id,
    name: options?.name ?? `${id}（价格以平台为准）`,
    description:
      options?.description ?? "喵呜视频模型；模型广场暂未公开专用视频参数。",
    operations: VIDEO_OPERATIONS,
    inputKinds: ["text"],
    outputKinds: ["video"],
    parameters: [],
    metadata: {
      modality: "video",
      marketplaceGroup: options?.group ?? "default",
      remoteMediaUrlsOnly: true,
      parameterSource: options?.parameterSource ?? "key-model-scan",
      parameterControlsUnavailable: true,
      ...(options?.checkedAt ? { pricingCheckedAt: options.checkedAt } : {}),
    },
    limits: {
      maxInputImages: 0,
      maxInputVideos: 0,
      maxInputAudios: 0,
    },
  };
}

/** 从喵呜 /api/pricing 响应构建目录快照（纯函数，便于测试）。 */
export function miaowuCatalogFromPricing(
  payload: PricingPayload,
): MiaowuCatalogSnapshot {
  const checkedAt = new Date().toISOString();
  const groupRatios = numberRecord(payload.group_ratio);
  const records = Array.isArray(payload.data) ? payload.data : [];
  const models: ModelDescriptor[] = [];
  const marketplaceModels: MiaowuMarketplaceModel[] = [];
  const groupedModels = new Map<string, MiaowuMarketplaceModel[]>();
  for (const item of records) {
    if (!isRecord(item)) continue;
    const record = item as PricingRecord;
    const id =
      typeof record.model_name === "string" ? record.model_name.trim() : "";
    if (!id) continue;
    const pricing = pricingFor(record, groupRatios);
    const videoApi = videoApiRecord(record);
    const description =
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : videoApi
          ? GENERIC_DESCRIPTION
          : "喵呜视频模型；模型广场暂未公开专用视频参数。";
    const descriptor = videoApi
      ? descriptorFor(id, record, pricing, checkedAt)
      : miaowuUnparameterizedVideoDescriptor(id, {
          name: `${id}（${pricing.priceLabel}）`,
          description,
          group: pricing.group,
          checkedAt,
          parameterSource: "pricing.model-detail",
        });
    models.push(descriptor);
    const marketplaceModel: MiaowuMarketplaceModel = {
      id,
      name: `${id}（${pricing.priceLabel}）`,
      description,
      capability: "video",
      priceLabel: pricing.priceLabel,
      billingLabel: pricing.billingLabel,
      tags: pricing.group === "default" ? [] : [pricing.group],
      endpointTypes: strings(record.supported_endpoint_types),
    };
    marketplaceModels.push(marketplaceModel);
    const enabledGroups = strings(record.enable_groups);
    for (const group of enabledGroups.length > 0
      ? enabledGroups
      : ["default"]) {
      const groupPricing = pricingFor(record, groupRatios, group);
      const groupModel: MiaowuMarketplaceModel = {
        ...marketplaceModel,
        name: `${id}（${groupPricing.priceLabel}）`,
        priceLabel: groupPricing.priceLabel,
        billingLabel: groupPricing.billingLabel,
        tags: group === "default" ? [] : [group],
      };
      groupedModels.set(group, [
        ...(groupedModels.get(group) ?? []),
        groupModel,
      ]);
    }
  }
  const marketplaceGroups = [...groupedModels.entries()]
    .sort(([left], [right]) =>
      left === "default"
        ? -1
        : right === "default"
          ? 1
          : left.localeCompare(right),
    )
    .map(([id, groupModels]): MiaowuMarketplaceGroup => ({
      id,
      description:
        id === "default"
          ? "喵呜 API 默认模型分组；模型与价格来自平台实时价目。"
          : `喵呜 API ${id} 模型分组；价格已应用该分组倍率。`,
      ratio: groupRatios[id] ?? 1,
      canvasSupported: groupModels.length > 0,
      canvasModelCount: groupModels.length,
      models: groupModels,
    }));
  return {
    checkedAt,
    source: "live",
    models,
    marketplaceModels,
    marketplaceGroups,
  };
}

interface FallbackMarketplaceRecord {
  id: string;
  price: number;
  unit: "次" | "秒";
  capability: "chat" | "video";
  description: string;
}

const FALLBACK_MARKETPLACE_RECORDS: readonly FallbackMarketplaceRecord[] = [
  {
    id: "hailuo-3",
    price: 2.5,
    unit: "次",
    capability: "video",
    description: "喵呜视频模型；模型广场暂未公开专用视频参数。",
  },
  {
    id: "happyhorse:r2v-1.5-deal",
    price: 0.9,
    unit: "次",
    capability: "video",
    description: "暂时正在维护。",
  },
  {
    id: "kling-3.0-omni",
    price: 0.1,
    unit: "秒",
    capability: "video",
    description: "喵呜模型广场的视频模型。",
  },
  {
    id: "minimax-h3",
    price: 0.12,
    unit: "秒",
    capability: "video",
    description: "官方 720p；使用垫视频时选择 720p，最高 13 秒。",
  },
  {
    id: "seedance-2.0-deal",
    price: 5,
    unit: "次",
    capability: "video",
    description: "喵呜视频模型；模型广场暂未公开专用视频参数。",
  },
  {
    id: "seedance-2.0-特惠",
    price: 0.17,
    unit: "次",
    capability: "video",
    description: "喵呜视频模型；模型广场暂未公开专用视频参数。",
  },
  {
    id: "seedance-2.0-min",
    price: 1.2,
    unit: "次",
    capability: "video",
    description: "喵呜视频模型；模型广场暂未公开专用视频参数。",
  },
  {
    id: "seedance-2.0-mini",
    price: 0.8,
    unit: "次",
    capability: "video",
    description: "933 不卡人脸；480p，可出 720p，但 720p 最高 12 秒。",
  },
  {
    id: "seedance-2.0-pro",
    price: 2,
    unit: "次",
    capability: "video",
    description: "Adobe 线路，933 卡人脸。",
  },
  {
    id: "seedance-2.0m",
    price: 5,
    unit: "次",
    capability: "video",
    description: "933 不卡人脸，但是限制字数 2000 字。",
  },
  {
    id: "wan3.0-video-480p",
    price: 0.2625,
    unit: "秒",
    capability: "video",
    description: "通义万相 3.0 480P，2–30 秒，支持首帧图。",
  },
];

function fallbackGroupModel(
  record: FallbackMarketplaceRecord,
  group: "default" | "vip",
): MiaowuMarketplaceModel {
  const priceLabel = `¥${formatYuan(record.price * (group === "vip" ? 0.8 : 1))}/${record.unit}`;
  return {
    id: record.id,
    name: `${record.id}（${priceLabel}）`,
    description: record.description,
    capability: record.capability,
    priceLabel,
    billingLabel: record.unit === "秒" ? "按秒计费" : "按次计费",
    tags: group === "default" ? [] : [group],
    endpointTypes: ["openai"],
  };
}

function fallbackSnapshot(): MiaowuCatalogSnapshot {
  const marketplaceModels = FALLBACK_MARKETPLACE_RECORDS.map((record) =>
    fallbackGroupModel(record, "default"),
  );
  const marketplaceGroups = (["default", "vip"] as const).map(
    (id): MiaowuMarketplaceGroup => {
      const models = FALLBACK_MARKETPLACE_RECORDS.map((record) =>
        fallbackGroupModel(record, id),
      );
      return {
        id,
        description: `喵呜 API ${id} 分组；当前显示内置备用目录。`,
        ratio: id === "vip" ? 0.8 : 1,
        canvasSupported: true,
        canvasModelCount: models.length,
        models,
      };
    },
  );
  return {
    checkedAt: new Date().toISOString(),
    source: "fallback",
    models: MIAOWU_MODELS.map((model) => structuredClone(model)),
    marketplaceModels,
    marketplaceGroups,
  };
}

/** Returns descriptors scoped to one live marketplace group with group pricing. */
export function miaowuModelsForGroup(
  catalog: MiaowuCatalogSnapshot,
  groupId: string | undefined,
): ModelDescriptor[] {
  const group = catalog.marketplaceGroups.find((item) => item.id === groupId);
  if (!group) return catalog.models.map((model) => structuredClone(model));
  const byId = new Map(catalog.models.map((model) => [model.id, model]));
  return group.models.flatMap((marketplaceModel) => {
    const model = byId.get(marketplaceModel.id);
    if (!model) return [];
    return [
      {
        ...structuredClone(model),
        name: marketplaceModel.name,
        ...(model.pricing?.unitAmount === undefined
          ? {}
          : {
              pricing: {
                ...model.pricing,
                unitAmount:
                  model.pricing.unitAmount *
                  (group.ratio /
                    (typeof model.metadata?.pricingGroupRatio === "number"
                      ? model.metadata.pricingGroupRatio
                      : 1)),
              },
            }),
        metadata: {
          ...model.metadata,
          marketplaceGroup: group.id,
          priceLabel: marketplaceModel.priceLabel,
          billingLabel: marketplaceModel.billingLabel,
          groupRatio: group.ratio,
        },
      },
    ];
  });
}

export async function loadMiaowuCatalog(options?: {
  force?: boolean;
  fetch?: typeof fetch;
}): Promise<MiaowuCatalogSnapshot> {
  const cache = catalogCache();
  const now = Date.now();
  if (!options?.force && cache.snapshot && cache.expiresAt > now)
    return cache.snapshot;
  if (cache.pending) return cache.pending;

  // Use the proxy-aware transport for server-side marketplace requests while
  // preserving injected fetch implementations in tests and browser callers.
  const fetchImpl = options?.fetch ?? providerFetch;
  cache.pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
    try {
      const response = await fetchImpl(MIAOWU_CATALOG_SOURCE, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(`喵呜目录检查失败 (${response.status})`);
      const snapshot = miaowuCatalogFromPricing(
        (await response.json()) as PricingPayload,
      );
      if (snapshot.models.length === 0)
        throw new Error("喵呜模型广场未返回视频模型");
      cache.snapshot = snapshot;
      cache.expiresAt = Date.now() + CATALOG_TTL_MS;
      return snapshot;
    } catch {
      if (cache.snapshot) {
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

/** 使用实时模型列表替换预置连接器里的模型清单。 */
export function miaowuConnectorForModels(
  models: readonly ModelDescriptor[],
): RestConnectorConfig {
  const connector = structuredClone(MIAOWU_CONNECTOR);
  const modelOverrides = Object.fromEntries(
    models.flatMap((model) =>
      model.metadata?.parameterControlsUnavailable === true
        ? [[model.id, structuredClone(MIAOWU_CHAT_VIDEO_OVERRIDE)]]
        : [],
    ),
  );
  return {
    ...connector,
    models: models.map((model) => structuredClone(model)),
    modelOverrides,
  };
}

/** 已保存的默认模型仍然在线则保留，否则回退到预置默认或第一个在线模型。 */
export function miaowuDefaultModel(
  models: readonly ModelDescriptor[],
  configured?: string,
): string {
  if (configured && models.some((model) => model.id === configured))
    return configured;
  if (models.some((model) => model.id === MIAOWU_DEFAULT_MODEL))
    return MIAOWU_DEFAULT_MODEL;
  return (
    models.find((model) => model.isDefault)?.id ??
    models[0]?.id ??
    MIAOWU_DEFAULT_MODEL
  );
}

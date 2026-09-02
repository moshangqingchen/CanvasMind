import {
  fetchProviderJson,
  joinUrl,
  providerFetch,
  type ModelDescriptor,
  type ModelParameterDescriptor,
  type ModelParameterOption,
  type RestConnectorConfig,
  type RestModelConnectorOverride,
  type RestRequestMapping,
} from "@super-canvas/providers";
import {
  getRepository,
  type JsonObject,
  type ProviderConnectionRecord,
} from "@super-canvas/db";
import {
  CANGYUAN_BACKUP_IMAGE_GROUP,
  CANGYUAN_IMAGE_BASE_URL,
  CANGYUAN_IMAGE_PRESET_ID,
  CANGYUAN_IMAGE_GROUP,
  CANGYUAN_LEGACY_BACKUP_IMAGE_GROUP,
  CANGYUAN_VIDEO_GROUP,
  cangyuanDefaultModelForGroup,
  cangyuanImageConnectorForGroup,
  isCangyuanImageGroup,
  normalizeCangyuanImageGroup,
  type CangyuanImageGroup,
} from "./provider-presets";
import { providerPriceUnit } from "./provider-pricing-unit";

const CATALOG_TTL_MS = 60_000;
const CATALOG_RETRY_MS = 15_000;
const CATALOG_TIMEOUT_MS = 12_000;
const IMAGE_OPERATIONS = ["image.generate", "image.edit"] as const;
const GENERATE_ONLY = ["image.generate"] as const;
const VIDEO_OPERATIONS = ["video.generate", "video.image-to-video"] as const;
const VIDEO_GENERATE_ONLY = ["video.generate"] as const;
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

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
  billing_mode?: unknown;
  request_unit?: unknown;
  supported_endpoint_types?: unknown;
  image_ui_params?: unknown;
  video_ui_params?: unknown;
  api_doc?: unknown;
}

interface PricingPayload {
  data?: unknown;
  group_ratio?: unknown;
  usable_group?: unknown;
}

export interface CangyuanMarketplaceModel {
  id: string;
  name: string;
  description?: string;
  capability: "chat" | "image" | "video" | "other";
  priceLabel: string;
  billingLabel: string;
  tags: string[];
  endpointTypes: string[];
}

export interface CangyuanMarketplaceGroup {
  id: string;
  description: string;
  ratio: number;
  canvasSupported: boolean;
  models: CangyuanMarketplaceModel[];
}

export interface CangyuanCatalogSnapshot {
  checkedAt: string;
  source: "live" | "stale" | "fallback";
  groups: Record<CangyuanImageGroup, ModelDescriptor[]>;
  marketplaceGroups: CangyuanMarketplaceGroup[];
}

export type CangyuanAvailabilityStatus =
  | "operational"
  | "degraded"
  | "unavailable"
  | "unknown";

export interface CangyuanAvailabilityItem {
  name: string;
  category: string;
  latestStatus: CangyuanAvailabilityStatus;
  availability: number | null;
  averageLatencyMs: number | null;
  timeline: unknown[];
}

export interface CangyuanAvailabilitySnapshot {
  checkedAt: string;
  windowDays: 7 | 15 | 30;
  items: CangyuanAvailabilityItem[];
}

interface CatalogCache {
  snapshot?: CangyuanCatalogSnapshot;
  expiresAt: number;
  pending?: Promise<CangyuanCatalogSnapshot>;
}

interface ConnectionCatalogSyncCache {
  checkedAt?: string;
  pending?: Promise<void>;
}

const globalCacheKey = "__superCanvasCangyuanCatalog";
const globalConnectionSyncKey = "__superCanvasCangyuanConnectionCatalogSync";

function catalogCache(): CatalogCache {
  const scope = globalThis as typeof globalThis & {
    [globalCacheKey]?: CatalogCache;
  };
  return (scope[globalCacheKey] ??= { expiresAt: 0 });
}

function connectionCatalogSyncCache(): ConnectionCatalogSyncCache {
  const scope = globalThis as typeof globalThis & {
    [globalConnectionSyncKey]?: ConnectionCatalogSyncCache;
  };
  return (scope[globalConnectionSyncKey] ??= {});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CANGYUAN_AVAILABILITY_STATUSES = new Set<CangyuanAvailabilityStatus>([
  "operational",
  "degraded",
  "unavailable",
  "unknown",
]);

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function availabilityStatus(value: unknown): CangyuanAvailabilityStatus {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase() as CangyuanAvailabilityStatus;
  return CANGYUAN_AVAILABILITY_STATUSES.has(normalized)
    ? normalized
    : "unknown";
}

function availabilityRecords(payload: unknown): Array<{
  key?: string;
  value: Record<string, unknown>;
}> {
  if (Array.isArray(payload))
    return payload.filter(isRecord).map((value) => ({ value }));
  if (!isRecord(payload)) return [];

  for (const key of ["data", "items", "models", "results", "availability"]) {
    const nested = payload[key];
    if (Array.isArray(nested))
      return nested.filter(isRecord).map((value) => ({ value }));
    if (isRecord(nested))
      return Object.entries(nested)
        .filter(([, value]) => isRecord(value))
        .map(([entryKey, value]) => ({
          key: entryKey,
          value: value as Record<string, unknown>,
        }));
  }

  return Object.entries(payload)
    .filter(([, value]) => isRecord(value))
    .map(([key, value]) => ({ key, value: value as Record<string, unknown> }));
}

/**
 * Normalizes the availability endpoint's response without exposing the API
 * key to the browser. The endpoint has used both arrays and keyed objects in
 * different deployments, so accept both shapes and both snake/camel fields.
 */
export function parseCangyuanAvailabilityPayload(
  payload: unknown,
  windowDays: 7 | 15 | 30 = 7,
): CangyuanAvailabilitySnapshot {
  const items: CangyuanAvailabilityItem[] = [];
  for (const { key, value } of availabilityRecords(payload)) {
    const name =
      (typeof value.name === "string" && value.name.trim()) ||
      (typeof value.model_name === "string" && value.model_name.trim()) ||
      (typeof value.model === "string" && value.model.trim()) ||
      (typeof value.id === "string" && value.id.trim()) ||
      key?.trim() ||
      "";
    if (!name) continue;
    const categoryValue =
      (typeof value.category === "string" && value.category.trim()) ||
      (typeof value.type === "string" && value.type.trim()) ||
      "unknown";
    const timeline = Array.isArray(value.timeline)
      ? value.timeline
      : Array.isArray(value.history)
        ? value.history
        : [];
    items.push({
      name,
      category: categoryValue,
      latestStatus: availabilityStatus(
        value.latest_status ?? value.latestStatus ?? value.status,
      ),
      availability: finiteNumber(value.availability ?? value.uptime),
      averageLatencyMs: finiteNumber(
        value.average_latency_ms ??
          value.averageLatencyMs ??
          value.avg_latency_ms,
      ),
      timeline,
    });
  }
  const checkedAtValue =
    isRecord(payload) &&
    (payload.checked_at ?? payload.checkedAt ?? payload.generated_at);
  return {
    checkedAt:
      typeof checkedAtValue === "string" && checkedAtValue.trim()
        ? checkedAtValue
        : new Date().toISOString(),
    windowDays,
    items,
  };
}

export async function fetchCangyuanAvailability(
  apiKey: string,
  options: {
    windowDays?: 7 | 15 | 30;
    name?: string;
    category?: "text" | "image" | "video" | "audio";
    latestStatus?: CangyuanAvailabilityStatus;
  } = {},
): Promise<CangyuanAvailabilitySnapshot> {
  const windowDays = options.windowDays ?? 7;
  const query = new URLSearchParams({ window_days: String(windowDays) });
  if (options.name?.trim()) query.set("name", options.name.trim());
  if (options.category) query.set("category", options.category);
  if (options.latestStatus) query.set("latest_status", options.latestStatus);
  const payload = await fetchProviderJson<unknown>(
    providerFetch,
    `${joinUrl(CANGYUAN_IMAGE_BASE_URL, "/v1/availability")}?${query.toString()}`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    },
    { phase: "connect", timeoutMs: CATALOG_TIMEOUT_MS, maxResponseBytes: 4 * 1024 * 1024 },
  );
  return parseCangyuanAvailabilityPayload(payload, windowDays);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      typeof item === "string" ? [[key, item]] : [],
    ),
  );
}

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      typeof item === "number" && Number.isFinite(item) ? [[key, item]] : [],
    ),
  );
}

function pricingTags(value: unknown): string[] {
  if (Array.isArray(value)) return stringArray(value);
  return typeof value === "string"
    ? value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
}

function formatPrice(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return null;
  let formatted = value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
  const fractionLength = formatted.split(".")[1]?.length ?? 0;
  if (fractionLength === 1) formatted += "0";
  return formatted;
}

function marketplaceCapability(
  record: PricingRecord,
): CangyuanMarketplaceModel["capability"] {
  const tags = pricingTags(record.tags);
  if (isRecord(record.video_ui_params) || tags.includes("video"))
    return "video";
  if (
    isRecord(record.image_ui_params) ||
    record.request_unit === "image" ||
    tags.includes("image")
  )
    return "image";
  if (stringArray(record.supported_endpoint_types).length > 0) return "chat";
  return "other";
}

function marketplacePriceLabel(
  record: PricingRecord,
  groupRatio: number,
): { priceLabel: string; billingLabel: string } {
  const modelRatio =
    typeof record.model_ratio === "number" &&
    Number.isFinite(record.model_ratio)
      ? record.model_ratio
      : null;
  const completionRatio =
    typeof record.completion_ratio === "number" &&
    Number.isFinite(record.completion_ratio)
      ? record.completion_ratio
      : 1;
  const cacheRatio =
    typeof record.cache_ratio === "number" &&
    Number.isFinite(record.cache_ratio)
      ? record.cache_ratio
      : null;
  if (record.quota_type === 0 && modelRatio !== null) {
    const input = modelRatio * groupRatio * 2;
    const output = input * completionRatio;
    const inputText = formatPrice(input) ?? String(input);
    const outputText = formatPrice(output) ?? String(output);
    const cacheText =
      cacheRatio !== null ? formatPrice(input * cacheRatio) : null;
    return {
      priceLabel: `输入 ¥${inputText}/1M · 输出 ¥${outputText}/1M${cacheText ? ` · 缓存 ¥${cacheText}/1M` : ""}`,
      billingLabel: "按 Token 计费",
    };
  }
  const price = formatPrice(record.model_price);
  const unit =
    typeof record.model_name === "string" &&
    /^midjourney-8\.2-/iu.test(record.model_name.trim())
      ? "请求"
      : priceUnit(record, marketplaceCapability(record) === "video");
  return {
    priceLabel: price ? `¥${price}/${unit}` : "价格以模型广场为准",
    billingLabel:
      providerPriceUnit(record) === "second" ? "按秒计费" : "按请求计费",
  };
}

function marketplaceModelForRecord(
  record: PricingRecord,
  groupRatio: number,
): CangyuanMarketplaceModel | null {
  if (typeof record.model_name !== "string" || !record.model_name.trim())
    return null;
  const id = record.model_name.trim();
  const pricing = marketplacePriceLabel(record, groupRatio);
  return {
    id,
    name: id,
    ...(typeof record.description === "string" && record.description.trim()
      ? { description: record.description.trim() }
      : {}),
    capability: marketplaceCapability(record),
    ...pricing,
    tags: pricingTags(record.tags),
    endpointTypes: stringArray(record.supported_endpoint_types),
  };
}

function priceUnit(record: PricingRecord, video = false): string {
  if (providerPriceUnit(record) === "second") return "秒";
  return video ? "次" : "张";
}

function nameWithLivePrice(
  model: ModelDescriptor,
  record: PricingRecord,
  video = false,
) {
  const baseName = model.name.replace(/（¥[^）]+\/(?:张|次|秒|请求|条)）$/u, "");
  const price = formatPrice(record.model_price);
  const unit = /^midjourney-8\.2-/iu.test(model.id)
    ? "请求"
    : priceUnit(record, video);
  return price
    ? `${baseName}（¥${price}/${unit}）`
    : baseName;
}

function parameterOptions(value: unknown): ModelParameterOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) => {
    if (!isRecord(option)) return [];
    const rawValue = option.value;
    if (typeof rawValue !== "string" && typeof rawValue !== "number") return [];
    return [
      {
        label:
          typeof option.label === "string" ? option.label : String(rawValue),
        value: rawValue,
      },
    ];
  });
}

/**
 * Cangyuan's GPT Image 4K ratio controls are sent upstream as ratio strings
 * (for example `1:1`). Keep that value intact, but show the corresponding
 * practical 4K pixel canvas beside it so users can choose by both ratio and
 * expected output size. These dimensions stay within the 3840px edge and
 * ~8.29MP limits documented by the upstream Images API.
 */
const GPT_IMAGE_4K_RATIO_PIXELS: Readonly<Record<string, string>> = {
  "1:1": "2160×2160",
  "5:4": "3200×2560",
  "7:6": "3104×2656",
  "9:16": "2160×3840",
  "21:9": "3840×1648",
  "16:9": "3840×2160",
  "3:2": "3264×2176",
  "4:3": "2880×2160",
  "4:5": "2560×3200",
  "3:4": "2160×2880",
  "2:3": "2176×3264",
};

function isGptImage4KModel(modelName: unknown): boolean {
  return typeof modelName === "string" && /gpt-image.*4k/iu.test(modelName);
}

function imageRatioOptions(
  value: unknown,
  modelName?: unknown,
): ModelParameterOption[] {
  const options = parameterOptions(value).filter(
    (option) => option.value !== "auto",
  );
  const withPixels = isGptImage4KModel(modelName)
    ? options.map((option) => {
        const ratio = String(option.value);
        const pixels = GPT_IMAGE_4K_RATIO_PIXELS[ratio];
        if (!pixels || /\d\s*[×x]\s*\d/iu.test(option.label)) return option;
        return { ...option, label: `${option.label}（4K：${pixels}）` };
      })
    : options;
  return [{ label: "自动（提示词优先）", value: "auto" }, ...withPixels];
}

function inferredParameters(record: PricingRecord): ModelParameterDescriptor[] {
  const ui = isRecord(record.image_ui_params) ? record.image_ui_params : {};
  const params = isRecord(ui.params) ? ui.params : {};
  const descriptors: ModelParameterDescriptor[] = [];
  const aspectRatio = isRecord(params.aspectRatio) ? params.aspectRatio : null;
  if (aspectRatio?.enabled === true) {
    const options = imageRatioOptions(aspectRatio.options, record.model_name);
    descriptors.push({
      key: "aspect_ratio",
      label: "画面比例",
      control: options.length > 0 ? "select" : "text",
      valueType: "string",
      description: "自动模式优先依据提示词判断；提示词没有明确比例时跟随参考图",
      ...(options.length > 0 ? { default: "auto", options } : {}),
      operations: IMAGE_OPERATIONS,
    });
  }
  const customDimensions = isRecord(params.customDimensions)
    ? params.customDimensions
    : null;
  if (customDimensions?.enabled === true) {
    descriptors.push({
      key: "size",
      label: "精确尺寸",
      control: "dimensions",
      valueType: "string",
      min: 16,
      max: 3840,
      step: 16,
      placeholder: "宽 x 高",
      description: "接口要求宽高为 16 的倍数；选择精确尺寸后不再发送画面比例",
      operations: IMAGE_OPERATIONS,
    });
  }
  const quality = isRecord(params.quality) ? params.quality : null;
  if (quality?.enabled === true) {
    const options = parameterOptions(quality.options);
    const highDefault = options.some(
      (option) => String(option.value).trim().toLowerCase() === "high",
    );
    descriptors.push({
      key: "quality",
      label: "分辨率",
      control: options.length > 0 ? "select" : "text",
      valueType: "string",
      ...(options.length > 0
        ? { default: highDefault ? "high" : options[0]?.value, options }
        : {}),
      operations: IMAGE_OPERATIONS,
    });
  }
  const background = isRecord(params.background) ? params.background : null;
  if (background?.enabled === true) {
    const options = parameterOptions(background.options);
    const automatic = options.find((option) => option.value === "auto")?.value;
    descriptors.push({
      key: "background",
      label: "背景模式",
      control: options.length > 0 ? "select" : "text",
      valueType: "string",
      description:
        "透明模式会请求带透明通道的图片；建议提示词同时说明主体独立、无背景",
      ...(options.length > 0
        ? { default: automatic ?? options[0]?.value, options }
        : {}),
      operations: IMAGE_OPERATIONS,
    });
  }
  const count = isRecord(params.count) ? params.count : null;
  if (count?.enabled === true) {
    const min = typeof count.min === "number" ? count.min : 1;
    const max = typeof count.max === "number" ? count.max : 1;
    descriptors.push({
      key: "n",
      label: "生成张数",
      control: "number",
      valueType: "integer",
      default: min,
      min,
      max,
      step: 1,
      operations: IMAGE_OPERATIONS,
    });
  }
  return descriptors;
}

function docParameterNames(record: PricingRecord): Set<string> {
  const doc = isRecord(record.api_doc) ? record.api_doc : {};
  const params = Array.isArray(doc.params) ? doc.params : [];
  return new Set(
    params.flatMap((param) =>
      isRecord(param) && typeof param.name === "string" ? [param.name] : [],
    ),
  );
}

function videoParameterOptions(value: unknown): ModelParameterOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) => {
    if (typeof option === "number" || typeof option === "string")
      return [{ label: String(option), value: option }];
    if (!isRecord(option)) return [];
    const raw = option.value;
    return typeof raw === "string" || typeof raw === "number"
      ? [
          {
            label:
              typeof option.label === "string" ? option.label : String(raw),
            value: raw,
          },
        ]
      : [];
  });
}

function inferredVideoParameters(
  record: PricingRecord,
): ModelParameterDescriptor[] {
  const ui = isRecord(record.video_ui_params) ? record.video_ui_params : {};
  const params = isRecord(ui.params) ? ui.params : {};
  const documented = docParameterNames(record);
  const descriptors: ModelParameterDescriptor[] = [];
  const duration = isRecord(params.duration) ? params.duration : null;
  if (duration?.enabled === true) {
    const options = videoParameterOptions(duration.numericOptions);
    descriptors.push({
      key: "duration",
      label: "时长（秒）",
      control: options.length > 0 ? "select" : "number",
      valueType: "integer",
      default:
        options[0]?.value ??
        (typeof duration.min === "number" ? duration.min : undefined),
      ...(typeof duration.min === "number" ? { min: duration.min } : {}),
      ...(typeof duration.max === "number" ? { max: duration.max } : {}),
      step: 1,
      ...(options.length > 0 ? { options } : {}),
      operations: VIDEO_OPERATIONS,
    });
  }
  const ratio = isRecord(params.ratio) ? params.ratio : null;
  if (ratio?.enabled === true) {
    const options = videoParameterOptions(ratio.options);
    descriptors.push({
      key: "aspect_ratio",
      label: "画面比例",
      control: options.length > 0 ? "select" : "text",
      valueType: "string",
      ...(options.length > 0 ? { default: options[0]?.value, options } : {}),
      operations: VIDEO_OPERATIONS,
    });
  }
  const resolution = isRecord(params.resolution) ? params.resolution : null;
  if (resolution?.enabled === true) {
    const options = videoParameterOptions(resolution.options);
    if (options.length > 1 || !resolution.fixedLabel) {
      descriptors.push({
        key: "resolution",
        label: "分辨率",
        control: options.length > 0 ? "select" : "text",
        valueType: "string",
        ...(options.length > 0 ? { default: options[0]?.value, options } : {}),
        operations: VIDEO_OPERATIONS,
      });
    }
  }
  const generateAudio = isRecord(params.generateAudio)
    ? params.generateAudio
    : null;
  if (generateAudio?.enabled === true) {
    const key = documented.has("generate_audio") ? "generate_audio" : "audio";
    descriptors.push({
      key,
      label: "生成声音",
      control: "toggle",
      valueType: "boolean",
      default: true,
      operations: VIDEO_OPERATIONS,
    });
  }
  const seed = isRecord(params.seed) ? params.seed : null;
  if (seed?.enabled === true || documented.has("seed")) {
    descriptors.push({
      key: "seed",
      label: "随机种子",
      control: "number",
      valueType: "integer",
      min: 0,
      max: 2_147_483_647,
      step: 1,
      operations: VIDEO_OPERATIONS,
    });
  }
  if (documented.has("negative_prompt")) {
    descriptors.push({
      key: "negative_prompt",
      label: "负面提示词",
      control: "text",
      valueType: "string",
      operations: VIDEO_OPERATIONS,
    });
  }
  return descriptors;
}

function documentedImageReferenceParameters(
  record: PricingRecord,
): readonly Record<string, unknown>[] {
  if (!isRecord(record.api_doc)) return [];
  const collections: unknown[] = [record.api_doc.params];
  if (isRecord(record.api_doc.modes)) {
    for (const mode of Object.values(record.api_doc.modes)) {
      if (isRecord(mode)) collections.push(mode.params);
    }
  }
  return collections.flatMap((params) =>
    Array.isArray(params) ? params.filter(isRecord) : [],
  );
}

function isImageReferenceParameter(name: string): boolean {
  const normalized = name.trim().toLowerCase().replaceAll("[]", "");
  return (
    normalized === "image" ||
    normalized === "images" ||
    normalized === "multipart image" ||
    /(?:image_urls|imageurls|reference_images|referenceimages|image_refs)/u.test(
      normalized,
    )
  );
}

function supportsImageReferences(record: PricingRecord): boolean {
  const hasReferenceParameter = documentedImageReferenceParameters(record).some(
    (param) =>
      typeof param.name === "string" && isImageReferenceParameter(param.name),
  );
  if (hasReferenceParameter) return true;
  if (!isRecord(record.api_doc)) return false;
  return /\/images\/edits(?:\b|\/)/iu.test(JSON.stringify(record.api_doc));
}

function imageReferenceLimit(record: PricingRecord): number | undefined {
  const ui = isRecord(record.image_ui_params) ? record.image_ui_params : {};
  const limits = isRecord(ui.referenceLimits) ? ui.referenceLimits : {};
  if (typeof limits.images === "number" && limits.images > 0)
    return limits.images;
  for (const param of documentedImageReferenceParameters(record)) {
    if (
      typeof param.name !== "string" ||
      !isImageReferenceParameter(param.name) ||
      typeof param.description !== "string"
    )
      continue;
    const match = /(?:最多|上限|不超过|≤)\s*(\d+)\s*张/u.exec(
      param.description,
    );
    if (match?.[1]) return Number(match[1]);
  }
  return supportsImageReferences(record) ? 9 : undefined;
}

function isImagePricingRecord(record: PricingRecord): boolean {
  if (record.request_unit === "image") return true;
  if (
    typeof record.tags === "string" &&
    /(?:^|,)image(?:,|$)/iu.test(record.tags)
  )
    return true;
  return isRecord(record.image_ui_params);
}

function isVideoPricingRecord(record: PricingRecord): boolean {
  if (isRecord(record.video_ui_params)) return true;
  return (
    typeof record.tags === "string" && /(?:^|,)video(?:,|$)/iu.test(record.tags)
  );
}

function videoReferenceMetadata(record: PricingRecord) {
  const ui = isRecord(record.video_ui_params) ? record.video_ui_params : {};
  const uiParams = isRecord(ui.params) ? ui.params : {};
  const frameInputs = isRecord(uiParams.frameInputs)
    ? uiParams.frameInputs
    : {};
  const limits = isRecord(ui.referenceLimits) ? ui.referenceLimits : {};
  const doc = isRecord(record.api_doc) ? record.api_doc : {};
  const request = isRecord(doc.request_json) ? doc.request_json : {};
  const documented = docParameterNames(record);
  const params = Array.isArray(doc.params) ? doc.params : [];
  const audioDescription = params.find(
    (param) => isRecord(param) && param.name === "reference_audios",
  );
  const videoDescription = params.find(
    (param) =>
      isRecord(param) &&
      typeof param.name === "string" &&
      /^(?:reference_videos|video_url)$/u.test(param.name),
  );
  const videoLimits = isRecord(limits.video) ? limits.video : {};
  const audioLimits = isRecord(limits.audio) ? limits.audio : {};
  const description =
    isRecord(videoDescription) &&
    typeof videoDescription.description === "string"
      ? videoDescription.description
      : "";
  const durationRange = description.match(
    /单(?:条|个)[^。；，,]*?(\d+(?:\.\d+)?)\s*(?:[-–—~至]|到)\s*(\d+(?:\.\d+)?)\s*(?:秒|s)/iu,
  );
  const singleDuration = description.match(
    /单(?:条|个)[^。；，,]*?(?:≤|最多|不超过|最长)?\s*(\d+(?:\.\d+)?)\s*(?:秒|s)/iu,
  );
  const totalDuration = description.match(
    /(?:总时长|多条总)[^。；，,]*?(\d+(?:\.\d+)?)\s*(?:秒|s)/iu,
  );
  const structuredVideoMax =
    typeof videoLimits.maxDurationMs === "number"
      ? videoLimits.maxDurationMs / 1000
      : typeof limits.maxVideoDurationSeconds === "number"
        ? limits.maxVideoDurationSeconds
        : undefined;
  const structuredVideoTotalMax =
    typeof videoLimits.totalMaxDurationMs === "number"
      ? videoLimits.totalMaxDurationMs / 1000
      : typeof limits.maxTotalVideoDurationSeconds === "number"
        ? limits.maxTotalVideoDurationSeconds
        : undefined;
  const referenceMode =
    typeof request.reference_mode === "string"
      ? request.reference_mode
      : documented.has("reference_mode")
        ? "frame"
        : undefined;
  return {
    referenceMode,
    maxInputImages:
      typeof limits.images === "number" ? limits.images : undefined,
    maxInputVideos:
      typeof limits.videos === "number" ? limits.videos : undefined,
    maxInputAudios:
      typeof limits.audios === "number" ? limits.audios : undefined,
    maxInputAssets: typeof limits.total === "number" ? limits.total : undefined,
    maxInputVideoDurationSeconds:
      structuredVideoMax ??
      (durationRange
        ? Number(durationRange[2])
        : singleDuration
          ? Number(singleDuration[1])
          : undefined),
    maxTotalInputVideoDurationSeconds:
      structuredVideoTotalMax ??
      (totalDuration ? Number(totalDuration[1]) : undefined),
    maxInputAudioDurationSeconds:
      typeof audioLimits.maxDurationMs === "number"
        ? audioLimits.maxDurationMs / 1000
        : undefined,
    supportsFirstLastFrames:
      frameInputs.enabled === true ||
      (documented.has("first_image_url") && documented.has("last_image_url")) ||
      [...documented].some(
        (name) =>
          name.includes("first_image_url") && name.includes("last_image_url"),
      ),
    requiresInputVideo:
      (typeof ui.validationKey === "string" &&
        ui.validationKey.includes("v2v")) ||
      false,
    requiresImageWithAudio:
      isRecord(audioDescription) &&
      typeof audioDescription.description === "string" &&
      /(?:搭配|同时提供).*(?:图|image)/iu.test(audioDescription.description),
    payloadBuilder:
      typeof ui.payloadBuilder === "string" ? ui.payloadBuilder : undefined,
  };
}

function videoDescriptorForRecord(
  record: PricingRecord,
): ModelDescriptor | null {
  if (typeof record.model_name !== "string" || !record.model_name.trim())
    return null;
  const id = record.model_name.trim();
  const refs = videoReferenceMetadata(record);
  const fixedResolutionSku =
    /^(?:minimax-h3-(?:768p|2k|4k)|(?:sd\d+-)?seedance-2\.0(?:-(?:480p|720p|1080p))?)$/iu.test(
      id,
    ) || /seedance-2\.5-(?:480p|720p|1080p)$/iu.test(id);
  const parameters = inferredVideoParameters(record).filter(
    (parameter) => !(fixedResolutionSku && parameter.key === "resolution"),
  );
  const payloadBuilder =
    /^omni-v2v(?:-no-water)?$/iu.test(id)
      ? "omni-v2v"
      : /^omni-fast(?:-no-water)?$/iu.test(id)
        ? "omni-frame"
        : /^minimax-h3-/iu.test(id)
          ? "minimax-video"
          : refs.payloadBuilder;
  const price = formatPrice(record.model_price);
  const hasImages = (refs.maxInputImages ?? 0) > 0;
  const descriptionParts = [
    typeof record.description === "string" && record.description.trim()
      ? record.description.trim()
      : null,
    refs.maxInputImages ? `最多 ${refs.maxInputImages} 张参考图` : null,
    refs.maxInputVideos ? `最多 ${refs.maxInputVideos} 个参考视频` : null,
    refs.maxInputVideoDurationSeconds
      ? `单个视频最长 ${refs.maxInputVideoDurationSeconds} 秒`
      : null,
    refs.maxInputAudios ? `文档支持 ${refs.maxInputAudios} 个参考音频` : null,
  ].filter((part): part is string => Boolean(part));
  return {
    id,
    name: `${id}${price ? `（¥${price}/${priceUnit(record, true)}）` : ""}`,
    ...(descriptionParts.length > 0
      ? { description: descriptionParts.join("；") }
      : {}),
    operations: hasImages ? VIDEO_OPERATIONS : VIDEO_GENERATE_ONLY,
    inputKinds: [
      "text",
      ...(hasImages ? (["image", "image[]"] as const) : []),
      ...((refs.maxInputVideos ?? 0) > 0
        ? (["video", "video[]"] as const)
        : []),
      ...((refs.maxInputAudios ?? 0) > 0
        ? (["audio", "audio[]"] as const)
        : []),
    ],
    outputKinds: ["video"],
    parameters,
    metadata: {
      modality: "video",
      ...refs,
      ...(payloadBuilder ? { payloadBuilder } : {}),
    },
    limits: {
      ...(refs.maxInputImages !== undefined
        ? { maxInputImages: refs.maxInputImages }
        : {}),
      ...(refs.maxInputVideos !== undefined
        ? { maxInputVideos: refs.maxInputVideos }
        : {}),
      ...(refs.maxInputAudios !== undefined
        ? { maxInputAudios: refs.maxInputAudios }
        : {}),
      ...(refs.maxInputAssets !== undefined
        ? { maxInputAssets: refs.maxInputAssets }
        : {}),
      ...(refs.maxInputVideoDurationSeconds !== undefined
        ? {
            maxInputVideoDurationSeconds: refs.maxInputVideoDurationSeconds,
          }
        : {}),
      ...(refs.maxTotalInputVideoDurationSeconds !== undefined
        ? {
            maxTotalInputVideoDurationSeconds:
              refs.maxTotalInputVideoDurationSeconds,
          }
        : {}),
      ...(refs.maxInputAudioDurationSeconds !== undefined
        ? {
            maxInputAudioDurationSeconds: refs.maxInputAudioDurationSeconds,
          }
        : {}),
      ...(refs.requiresInputVideo ? { requiresInputVideo: true } : {}),
    },
  };
}

function imageDescriptorForRecord(
  record: PricingRecord,
  knownModels: ReadonlyMap<string, ModelDescriptor>,
): ModelDescriptor | null {
  if (typeof record.model_name !== "string" || !record.model_name.trim())
    return null;
  const id = record.model_name.trim();
  const known = knownModels.get(id);
  const supportsReferences = supportsImageReferences(record);
  const maxInputImages = imageReferenceLimit(record);
  const fixedMidjourneyOutput = /^midjourney-8\.2-/iu.test(id);
  if (known) {
    const parameters = inferredParameters(record).filter(
      (parameter) => !(fixedMidjourneyOutput && parameter.key === "n"),
    );
    return {
      ...structuredClone(known),
      name: nameWithLivePrice(known, record),
      ...(supportsReferences
        ? {
            operations: IMAGE_OPERATIONS,
            inputKinds: ["text", "image", "image[]"] as const,
            limits: {
              ...known.limits,
              ...(maxInputImages !== undefined ? { maxInputImages } : {}),
            },
          }
        : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(typeof record.description === "string" && record.description.trim()
        ? { description: record.description.trim() }
        : {}),
    };
  }
  const price = formatPrice(record.model_price);
  const parameters = inferredParameters(record).filter(
    (parameter) => !(fixedMidjourneyOutput && parameter.key === "n"),
  );
  return {
    id,
    name: `${id}${price ? `（¥${price}/张）` : ""}`,
    ...(typeof record.description === "string" && record.description.trim()
      ? { description: record.description.trim() }
      : {}),
    operations: supportsReferences ? IMAGE_OPERATIONS : GENERATE_ONLY,
    ...(supportsReferences
      ? { inputKinds: ["text", "image", "image[]"] as const }
      : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    limits: {
      ...(maxInputImages !== undefined ? { maxInputImages } : {}),
      supportedMimeTypes: IMAGE_MIME_TYPES,
    },
  };
}

export function cangyuanCatalogFromPricing(
  payload: PricingPayload,
): CangyuanCatalogSnapshot {
  const checkedAt = new Date().toISOString();
  if (!Array.isArray(payload.data)) throw new Error("沧元模型广场数据格式无效");
  const pricingRecords = payload.data.filter(isRecord) as PricingRecord[];
  const knownModels = new Map<string, ModelDescriptor>();
  for (const group of [
    CANGYUAN_IMAGE_GROUP,
    CANGYUAN_VIDEO_GROUP,
    "全模型-无claude/gpt",
    CANGYUAN_BACKUP_IMAGE_GROUP,
  ] as const) {
    for (const model of cangyuanImageConnectorForGroup(group).models ?? []) {
      knownModels.set(model.id, model);
    }
  }
  const groups: Record<CangyuanImageGroup, ModelDescriptor[]> = {
    IMAGE: [],
    VIDEO: [],
    "全模型-无claude/gpt": [],
    [CANGYUAN_BACKUP_IMAGE_GROUP]: [],
  };

  for (const record of pricingRecords) {
    const descriptor = isVideoPricingRecord(record)
      ? videoDescriptorForRecord(record)
      : isImagePricingRecord(record)
        ? imageDescriptorForRecord(record, knownModels)
        : null;
    if (!descriptor) continue;
    for (const rawGroup of stringArray(record.enable_groups)) {
      const group = normalizeCangyuanImageGroup(rawGroup);
      if (group) {
        const rawPrice =
          typeof record.model_price === "number" &&
          Number.isFinite(record.model_price) &&
          record.model_price >= 0
            ? record.model_price
            : undefined;
        const ratios = numberRecord(payload.group_ratio);
        const ratio = ratios[group] ?? ratios[rawGroup] ?? 1;
        const perSecond = providerPriceUnit(record) === "second";
        groups[group].push({
          ...descriptor,
          ...(rawPrice === undefined
            ? {}
            : {
                pricing: {
                  kind: perSecond
                    ? "per-second"
                    : isImagePricingRecord(record)
                      ? "per-image"
                      : "per-request",
                  currency: "CNY",
                  unitAmount: rawPrice * ratio,
                  sourceUrl: `${CANGYUAN_IMAGE_BASE_URL}/api/pricing`,
                  checkedAt,
                  confidence: "exact",
                } as const,
              }),
        });
      }
    }
  }
  for (const group of Object.keys(groups) as CangyuanImageGroup[]) {
    groups[group].sort((left, right) => left.id.localeCompare(right.id));
  }
  const ratios = numberRecord(payload.group_ratio);
  const descriptions = stringRecord(payload.usable_group);
  const groupIds = new Set(
    [
      ...Object.keys(ratios),
      ...Object.keys(descriptions),
      ...pricingRecords.flatMap((record) => stringArray(record.enable_groups)),
    ].map((group) => normalizeCangyuanImageGroup(group) ?? group),
  );
  const marketplaceGroups = [...groupIds]
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((group): CangyuanMarketplaceGroup => {
      const legacyGroup =
        group === CANGYUAN_BACKUP_IMAGE_GROUP
          ? CANGYUAN_LEGACY_BACKUP_IMAGE_GROUP
          : group;
      const ratio = ratios[group] ?? ratios[legacyGroup] ?? 1;
      const models = pricingRecords
        .filter((record) =>
          stringArray(record.enable_groups).some(
            (candidate) =>
              (normalizeCangyuanImageGroup(candidate) ?? candidate) === group,
          ),
        )
        .flatMap((record) => {
          const model = marketplaceModelForRecord(record, ratio);
          return model ? [model] : [];
        })
        .sort((left, right) => left.id.localeCompare(right.id));
      return {
        id: group,
        description: descriptions[group] ?? descriptions[legacyGroup] ?? "",
        ratio,
        canvasSupported: isCangyuanImageGroup(group),
        models,
      };
    });
  return {
    checkedAt,
    source: "live",
    groups,
    marketplaceGroups,
  };
}

function fallbackSnapshot(): CangyuanCatalogSnapshot {
  const fallbackVideos: ModelDescriptor[] = [
    ...[
      ["sora-2", "0.70"],
      ["sora-2-pro", "0.90"],
    ].map(([id, price]): ModelDescriptor => ({
      id: id!,
      name: `${id}（¥${price}/次）`,
      operations: VIDEO_OPERATIONS,
      inputKinds: ["text", "image", "image[]"],
      outputKinds: ["video"],
      parameters: fallbackVideoParameters(
        [4, 8, 12],
        ["16:9", "9:16"],
        [],
        true,
        false,
        true,
      ),
      metadata: {
        modality: "video",
        payloadBuilder: "chat-video",
        referenceMode: "frame",
      },
      limits: { maxInputImages: 1, maxInputVideos: 0 },
    })),
    ...[
      ["veo-3-1", "0.90", 2, "frame"],
      ["veo-3-1-fast", "0.70", 2, "frame"],
      ["veo-3-1-ref", "0.90", 3, "image"],
    ].map(([id, price, images, referenceMode]): ModelDescriptor => ({
      id: String(id),
      name: `${id}（¥${price}/次）`,
      operations: VIDEO_OPERATIONS,
      inputKinds: ["text", "image", "image[]"],
      outputKinds: ["video"],
      parameters: fallbackVideoParameters(
        [4, 6, 8],
        ["16:9", "9:16"],
        ["720p", "1080p"],
        true,
      ),
      metadata: {
        modality: "video",
        payloadBuilder: "chat-video",
        referenceMode,
      },
      limits: { maxInputImages: Number(images), maxInputVideos: 0 },
    })),
    ...[
      ["sd5-seedance-2.0", "3.85"],
      ["sd5-seedance-2.0-fast", "2.60"],
    ].map(([id, price]): ModelDescriptor => ({
      id: id!,
      name: `${id}（¥${price}/次）`,
      operations: VIDEO_OPERATIONS,
      inputKinds: [
        "text",
        "image",
        "image[]",
        "video",
        "video[]",
        "audio",
        "audio[]",
      ],
      outputKinds: ["video"],
      parameters: fallbackVideoParameters(
        Array.from({ length: 12 }, (_, index) => index + 4),
        ["16:9", "9:16"],
        ["480p", "720p"],
        true,
        true,
        true,
      ),
      metadata: {
        modality: "video",
        payloadBuilder: "seedance-flat",
        referenceMode: "frame",
        supportsFirstLastFrames: true,
      },
      limits: {
        maxInputImages: 9,
        maxInputVideos: 3,
        maxInputAudios: 3,
        maxInputAssets: 12,
        maxInputVideoDurationSeconds: 15,
        maxTotalInputVideoDurationSeconds: 45,
        maxInputAudioDurationSeconds: 15,
      },
    })),
    {
      id: "wan3.0-15s",
      name: "wan3.0-15s（¥1.99/次）",
      description:
        "Wan 3.0 4–15 秒视频；支持最多 10 张图片、5 个视频和 5 个音频参考",
      operations: VIDEO_OPERATIONS,
      inputKinds: [
        "text",
        "image",
        "image[]",
        "video",
        "video[]",
        "audio",
        "audio[]",
      ],
      outputKinds: ["video"],
      parameters: fallbackVideoParameters(
        Array.from({ length: 12 }, (_, index) => index + 4),
        ["16:9", "1:1", "9:16", "4:3", "3:4"],
        ["480p", "720p", "1080p"],
      ),
      metadata: { modality: "video", payloadBuilder: "wan3-flat" },
      limits: {
        maxInputImages: 10,
        maxInputVideos: 5,
        maxInputAudios: 5,
      },
    },
    {
      id: "seedance-2.0-1080p",
      name: "seedance-2.0-1080p（¥4.9/次）",
      description:
        "Seedance 2.0 固定 1080p；支持文生、图生和多参考图/视频/音频",
      operations: VIDEO_OPERATIONS,
      inputKinds: [
        "text",
        "image",
        "image[]",
        "video",
        "video[]",
        "audio",
        "audio[]",
      ],
      outputKinds: ["video"],
      parameters: fallbackVideoParameters(
        Array.from({ length: 12 }, (_, index) => index + 4),
        ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        [],
        true,
      ),
      metadata: {
        modality: "video",
        payloadBuilder: "seedance-reference-urls",
      },
      limits: {
        maxInputImages: 5,
        maxInputVideos: 3,
        maxInputAudios: 3,
      },
    },
    ...[
      ["minimax-h3-768p", "3.5", "768p"],
      ["minimax-h3-2k", "4.5", "2K"],
      ["minimax-h3-4k", "5.6", "4K"],
    ].map(([id, price, tier]): ModelDescriptor => ({
      id,
      name: `${id}（¥${price}/次）`,
      description: `MiniMax H3 ${tier}；支持文生、图生、多模态参考和首尾帧，5–15 秒`,
      operations: VIDEO_OPERATIONS,
      inputKinds: [
        "text",
        "image",
        "image[]",
        "video",
        "video[]",
        "audio",
        "audio[]",
      ],
      outputKinds: ["video"],
      parameters: fallbackVideoParameters(
        Array.from({ length: 11 }, (_, index) => index + 5),
        ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        [],
      ),
      metadata: { modality: "video", payloadBuilder: "minimax-video" },
      limits: {
        maxInputImages: 5,
        maxInputVideos: 3,
        maxInputAudios: 3,
        maxInputVideoDurationSeconds: 15,
        maxTotalInputVideoDurationSeconds: 15,
        maxInputAudioDurationSeconds: 15,
      },
    })),
    ...[
      ["omni-fast", "0.6624", "omni-frame"],
      ["omni-fast-no-water", "0.6624", "omni-frame"],
      ["omni-v2v", "0.6624", "omni-v2v"],
      ["omni-v2v-no-water", "0.6624", "omni-v2v"],
    ].map(([id, price, payloadBuilder]): ModelDescriptor => ({
      id,
      name: `${id}（¥${price}/次）`,
      description:
        payloadBuilder === "omni-v2v"
          ? "Omni 视频风格/内容转换；支持最多 2 条参考视频与 2 张参考图"
          : "Omni 文生/图生视频；支持参考图和首尾帧",
      operations: VIDEO_OPERATIONS,
      inputKinds:
        payloadBuilder === "omni-v2v"
          ? ["text", "image", "image[]", "video", "video[]"]
          : ["text", "image", "image[]"],
      outputKinds: ["video"],
      parameters: fallbackVideoParameters(
        [],
        ["16:9", "9:16"],
        [],
      ),
      metadata: { modality: "video", payloadBuilder },
      limits:
        payloadBuilder === "omni-v2v"
          ? { maxInputImages: 2, maxInputVideos: 2, maxInputAssets: 2 }
          : { maxInputImages: 5 },
    })),
  ];
  const imageModels = [
    ...(cangyuanImageConnectorForGroup("IMAGE").models ?? []),
  ];
  const allModels = [
    ...(cangyuanImageConnectorForGroup("全模型-无claude/gpt").models ?? []),
  ];
  const videoModels = [...fallbackVideos];
  const fallbackMarketplaceGroup = (
    id: CangyuanImageGroup,
    models: readonly ModelDescriptor[],
  ): CangyuanMarketplaceGroup => ({
    id,
    description: "",
    ratio: 1,
    canvasSupported: true,
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      ...(model.description ? { description: model.description } : {}),
      capability: model.operations.some((operation) =>
        operation.startsWith("video."),
      )
        ? "video"
        : "image",
      priceLabel:
        model.name.match(/（(¥[^）]+)）$/u)?.[1] ?? "价格以模型广场为准",
      billingLabel: "按请求计费",
      tags: [],
      endpointTypes: [],
    })),
  });
  return {
    checkedAt: new Date().toISOString(),
    source: "fallback",
    groups: {
      IMAGE: [...imageModels, ...fallbackVideos],
      VIDEO: videoModels,
      "全模型-无claude/gpt": [...allModels, ...fallbackVideos],
      [CANGYUAN_BACKUP_IMAGE_GROUP]: [
        ...(cangyuanImageConnectorForGroup(CANGYUAN_BACKUP_IMAGE_GROUP)
          .models ?? []),
      ],
    },
    marketplaceGroups: [
      fallbackMarketplaceGroup("IMAGE", [...imageModels, ...fallbackVideos]),
      fallbackMarketplaceGroup("VIDEO", videoModels),
      fallbackMarketplaceGroup("全模型-无claude/gpt", [
        ...allModels,
        ...fallbackVideos,
      ]),
      fallbackMarketplaceGroup(
        CANGYUAN_BACKUP_IMAGE_GROUP,
        cangyuanImageConnectorForGroup(CANGYUAN_BACKUP_IMAGE_GROUP).models ??
          [],
      ),
    ],
  };
}

function fallbackVideoParameters(
  durations: readonly number[],
  ratios: readonly string[],
  resolutions: readonly string[],
  audio = false,
  seed = false,
  negativePrompt = false,
): ModelParameterDescriptor[] {
  return [
    ...(durations.length > 0
      ? [
          {
            key: "duration",
            label: "时长（秒）",
            control: "select" as const,
            valueType: "integer" as const,
            default: durations[0],
            options: durations.map((value) => ({
              label: String(value),
              value,
            })),
            operations: VIDEO_OPERATIONS,
          },
        ]
      : []),
    {
      key: "aspect_ratio",
      label: "画面比例",
      control: "select",
      valueType: "string",
      default: ratios[0],
      options: ratios.map((value) => ({ label: value, value })),
      operations: VIDEO_OPERATIONS,
    },
    ...(resolutions.length > 0
      ? [
          {
            key: "resolution",
            label: "分辨率",
            control: "select" as const,
            valueType: "string" as const,
            default: resolutions[0],
            options: resolutions.map((value) => ({ label: value, value })),
            operations: VIDEO_OPERATIONS,
          },
        ]
      : []),
    ...(audio
      ? [
          {
            key: "generate_audio",
            label: "生成声音",
            control: "toggle" as const,
            valueType: "boolean" as const,
            default: true,
            operations: VIDEO_OPERATIONS,
          },
        ]
      : []),
    ...(seed
      ? [
          {
            key: "seed",
            label: "随机种子",
            control: "number" as const,
            valueType: "integer" as const,
            min: 0,
            max: 2_147_483_647,
            step: 1,
            operations: VIDEO_OPERATIONS,
          },
        ]
      : []),
    ...(negativePrompt
      ? [
          {
            key: "negative_prompt",
            label: "负面提示词",
            control: "text" as const,
            valueType: "string" as const,
            operations: VIDEO_OPERATIONS,
          },
        ]
      : []),
  ];
}

async function checkedFetch(
  fetchImpl: typeof fetch,
  path: string,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetchImpl(`${CANGYUAN_IMAGE_BASE_URL}${path}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`沧元目录检查失败 (${response.status})`);
  return response;
}

export async function loadCangyuanCatalog(options?: {
  force?: boolean;
  fetch?: typeof fetch;
}): Promise<CangyuanCatalogSnapshot> {
  const cache = catalogCache();
  const now = Date.now();
  if (!options?.force && cache.snapshot && cache.expiresAt > now)
    return cache.snapshot;
  if (cache.pending) return cache.pending;

  // Server-side catalog requests must use the same proxy-aware transport as
  // provider calls; the native fetch path can resolve supplier domains to the
  // sandbox/test address range and silently force a stale fallback snapshot.
  const fetchImpl = options?.fetch ?? providerFetch;
  cache.pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
    try {
      const [, , pricingResponse] = await Promise.all([
        checkedFetch(fetchImpl, "/", controller.signal),
        checkedFetch(fetchImpl, "/docs/api", controller.signal),
        checkedFetch(fetchImpl, "/api/pricing", controller.signal),
      ]);
      const snapshot = cangyuanCatalogFromPricing(
        (await pricingResponse.json()) as PricingPayload,
      );
      if (Object.values(snapshot.groups).every((models) => models.length === 0))
        throw new Error("沧元模型广场未返回图片模型");
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

export function cangyuanConnectorForModels(
  group: CangyuanImageGroup,
  models: readonly ModelDescriptor[],
): RestConnectorConfig {
  const connector = cangyuanImageConnectorForGroup(group);
  const includesVideoModels = models.some((model) =>
    model.operations.some((operation) => operation.startsWith("video.")),
  );
  const modelOverrides: Record<string, RestModelConnectorOverride> = {};
  for (const model of models) {
    if (model.operations.some((operation) => operation.startsWith("video.")))
      modelOverrides[model.id] = videoTransportForModel(model);
    else if (
      /^(?:gpt-image-2(?:-(?:1k|2k|4k))?|nano-banana(?:-pro)?-(?:1k|2k|4k)|nano-banana2-(?:1k|2k|4k)|midjourney-8\.2-(?:1k|2k))$/iu.test(
        model.id,
      ) &&
      (model.operations.includes("image.edit") ||
        /^midjourney-8\.2-/iu.test(model.id))
    )
      modelOverrides[model.id] = standardImageTransportForModel(model);
  }
  return {
    ...connector,
    ...(includesVideoModels ? { assetsRequirePublicUrls: true } : {}),
    models: structuredClone(models),
    ...(Object.keys(modelOverrides).length > 0 ? { modelOverrides } : {}),
  };
}

function standardImageMappingsForModel(
  model: ModelDescriptor,
): RestRequestMapping[] {
  const supported = new Set((model.parameters ?? []).map((item) => item.key));
  const isMidjourney = /^midjourney-8\.2-/iu.test(model.id);
  return [
    { target: "/model", source: { kind: "request", path: "$.model" } },
    { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
    // GPT Image 2's current API accepts ratios through `size` (for example
    // `size: "1:1"`), and the same contract is used by the current Banana
    // SKUs. The canvas intentionally keeps the provider-neutral
    // `aspect_ratio` parameter, so translate it here instead of forwarding the
    // now-unsupported field upstream. An explicit WxH `size` wins when present.
    {
      target: "/size",
      source: { kind: "request", path: "$.parameters.aspect_ratio" },
      omitIfUndefined: true,
      omitValues: ["auto"],
    },
    // Midjourney documents `size` as a ratio-only field. Some marketplace
    // records also expose a generic exact-size control; never forward that
    // pixel value to a Midjourney SKU because it is rejected as invalid_size.
    ...(!isMidjourney && supported.has("size")
      ? [
          {
            target: "/size",
            source: { kind: "request" as const, path: "$.parameters.size" },
            omitIfUndefined: true,
            omitValues: ["auto"],
          },
        ]
      : []),
    ...["quality", "background", "n"].flatMap((key): RestRequestMapping[] =>
      supported.has(key)
        ? [
            {
              target: `/${key}`,
              source: { kind: "request", path: `$.parameters.${key}` },
              omitIfUndefined: true,
            },
          ]
        : [],
    ),
    {
      target: "/response_format",
      source: { kind: "literal", value: "url" },
    },
  ];
}

function standardImageTransportForModel(
  model: ModelDescriptor,
): RestModelConnectorOverride {
  const mappings = standardImageMappingsForModel(model);
  return {
    pollIntervalMs: 5_000,
    submit: {
      path: "/v1/images/generations",
      method: "POST",
      bodyMode: "json",
      headers: { Connection: "close" },
      template: { async: true, n: 1 },
      mappings,
      response: {
        taskIdPath: "$.id",
        statusPath: "$.status",
        errorPath: "$.error.message",
        progressPath: "$.progress",
      },
    },
    poll: {
      path: "/v1/images/generations/{taskId}",
      method: "GET",
      bodyMode: "none",
      headers: { Connection: "close" },
      response: {
        taskIdPath: "$.id",
        statusPath: "$.status",
        errorPath: "$.error.message",
        progressPath: "$.progress",
      },
    },
    output: {
      path: "$.data",
      kind: "image",
      urlPath: "url",
      base64Path: "b64_json",
      defaultMimeType: "image/png",
    },
    operationOverrides: {
      "image.edit": {
        pollIntervalMs: 5_000,
        submit: {
          // Cangyuan's verified reference-image contract uses the async
          // generations endpoint with a JSON `images` array. The gateway's
          // multipart /edits route currently drops the model field and
          // responds with "model is required", even when the form contains it.
          path: "/v1/images/generations",
          method: "POST",
          bodyMode: "json",
          headers: { Connection: "close" },
          template: { async: true, n: 1 },
          mappings: [
            ...mappings,
            assetMapping("/images", "image"),
          ],
          response: {
            taskIdPath: "$.id",
            statusPath: "$.status",
            errorPath: "$.error.message",
            progressPath: "$.progress",
          },
        },
        poll: {
          path: "/v1/images/generations/{taskId}",
          method: "GET",
          bodyMode: "none",
          headers: { Connection: "close" },
          response: {
            taskIdPath: "$.id",
            statusPath: "$.status",
            errorPath: "$.error.message",
            progressPath: "$.progress",
          },
        },
      },
    },
  };
}

const videoParameterMappings: readonly RestRequestMapping[] = [
  { target: "/model", source: { kind: "request", path: "$.model" } },
  { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
  ...[
    "duration",
    "aspect_ratio",
    "resolution",
    "generate_audio",
    "audio",
    "seed",
    "negative_prompt",
  ].map((key): RestRequestMapping => ({
    target: `/${key}`,
    source: { kind: "request", path: `$.parameters.${key}` },
    omitIfUndefined: true,
  })),
];

function videoParameterMappingsForModel(
  model: ModelDescriptor,
): RestRequestMapping[] {
  const supported = new Set((model.parameters ?? []).map((item) => item.key));
  return videoParameterMappings.filter((mapping) => {
    if (mapping.source.kind !== "request") return true;
    const match = /^\$\.parameters\.([^.[\]]+)$/u.exec(mapping.source.path);
    return !match?.[1] || supported.has(match[1]);
  });
}

function assetMapping(
  target: string,
  assetKind: "image" | "video" | "audio",
  options?: {
    role?: "reference" | "firstFrame" | "lastFrame";
    excludeRoles?: readonly ("reference" | "firstFrame" | "lastFrame")[];
    select?: "all" | "first" | "firstIfOnly" | "allIfMultiple";
  },
): RestRequestMapping {
  return {
    target,
    source: { kind: "assets", assetKind, ...options },
    omitIfUndefined: true,
    omitIfEmpty: true,
  };
}

function videoTransportForModel(
  model: ModelDescriptor,
): RestModelConnectorOverride {
  const metadata = isRecord(model.metadata) ? model.metadata : {};
  const payloadBuilder =
    typeof metadata.payloadBuilder === "string"
      ? metadata.payloadBuilder
      : "chat-video";
  const mappings = videoParameterMappingsForModel(model);

  if (model.id.startsWith("grok-video")) {
    mappings.push(
      assetMapping("/reference_image_urls", "image"),
      assetMapping("/video_url", "video", { select: "first" }),
    );
  } else if (
    payloadBuilder === "omni-v2v" ||
    /^omni-v2v(?:-no-water)?$/iu.test(model.id)
  ) {
    mappings.push(
      assetMapping("/reference_videos", "video"),
      assetMapping("/reference_image_urls", "image"),
    );
  } else if (payloadBuilder === "omni-frame") {
    mappings.push(
      assetMapping("/reference_image_urls", "image", {
        excludeRoles: ["firstFrame", "lastFrame"],
      }),
      assetMapping("/first_image_url", "image", {
        role: "firstFrame",
        select: "first",
      }),
      assetMapping("/last_image_url", "image", {
        role: "lastFrame",
        select: "first",
      }),
    );
  } else if (model.id.startsWith("sd5-seedance-")) {
    mappings.push({
      target: "/reference_mode",
      source: {
        kind: "assetMode",
        frameValue: "frame",
        referenceValue: "media",
      },
    });
    mappings.push(
      assetMapping("/images", "image", {
        excludeRoles: ["firstFrame", "lastFrame"],
      }),
      assetMapping("/reference_videos", "video"),
      assetMapping("/reference_audios", "audio"),
      assetMapping("/first_image_url", "image", {
        role: "firstFrame",
        select: "first",
      }),
      assetMapping("/last_image_url", "image", {
        role: "lastFrame",
        select: "first",
      }),
    );
  } else if (model.id === "wan3.0-15s" || payloadBuilder === "wan3-flat") {
    mappings.push(
      assetMapping("/reference_image_urls", "image"),
      assetMapping("/reference_videos", "video"),
      assetMapping("/reference_audios", "audio"),
    );
  } else if (
    model.id === "seedance-2.0-1080p" ||
    payloadBuilder === "seedance-reference-urls"
  ) {
    mappings.push(
      assetMapping("/image_url", "image", { select: "firstIfOnly" }),
      assetMapping("/reference_image_urls", "image", {
        select: "allIfMultiple",
      }),
      assetMapping("/reference_videos", "video"),
      assetMapping("/reference_audios", "audio"),
    );
  } else if (
    payloadBuilder === "minimax-video" ||
    /^minimax-h3-/iu.test(model.id)
  ) {
    // MiniMax H3 uses the multimodal URL fields from its model document;
    // do not fall back to the legacy /images field used by older video SKUs.
    mappings.push(
      assetMapping("/reference_image_urls", "image", {
        excludeRoles: ["firstFrame", "lastFrame"],
      }),
      assetMapping("/reference_videos", "video", {
        excludeRoles: ["firstFrame", "lastFrame"],
      }),
      assetMapping("/reference_audios", "audio", {
        excludeRoles: ["firstFrame", "lastFrame"],
      }),
      assetMapping("/first_image_url", "image", {
        role: "firstFrame",
        select: "first",
      }),
      assetMapping("/last_image_url", "image", {
        role: "lastFrame",
        select: "first",
      }),
    );
  } else if (payloadBuilder === "seedance-flat") {
    if ((model.limits?.maxInputImages ?? 0) > 0) {
      mappings.push(
        assetMapping("/reference_image_urls", "image", {
          excludeRoles: ["firstFrame", "lastFrame"],
        }),
      );
    }
    if ((model.limits?.maxInputVideos ?? 0) > 0)
      mappings.push(assetMapping("/reference_videos", "video"));
    if ((model.limits?.maxInputAudios ?? 0) > 0)
      mappings.push(assetMapping("/reference_audios", "audio"));
    if (metadata.supportsFirstLastFrames === true) {
      mappings.push(
        assetMapping("/first_image_url", "image", {
          role: "firstFrame",
          select: "first",
        }),
        assetMapping("/last_image_url", "image", {
          role: "lastFrame",
          select: "first",
        }),
      );
    }
  } else {
    if (typeof metadata.referenceMode === "string") {
      mappings.push({
        target: "/reference_mode",
        source: { kind: "literal", value: metadata.referenceMode },
      });
    }
    mappings.push(assetMapping("/images", "image"));
  }

  const grok = model.id.startsWith("grok-video");
  const omni = payloadBuilder === "omni-v2v" || payloadBuilder === "omni-frame";
  const seedance = payloadBuilder === "seedance-flat";
  return {
    pollIntervalMs: 5_000,
    submit: {
      path: "/v1/videos",
      method: "POST",
      bodyMode: "json",
      headers: { Connection: "close" },
      mappings,
      response: {
        taskIdPath: "$.id",
        statusPath: "$.status",
        errorPath: "$.error.message",
        progressPath: "$.progress",
      },
    },
    poll: {
      path: "/v1/videos/{taskId}",
      method: "GET",
      bodyMode: "none",
      headers: { Connection: "close" },
      response: {
        statusPath: grok ? "$.data.status" : "$.status",
        errorPath: grok ? "$.data.fail_reason" : "$.error.message",
        progressPath: grok ? "$.data.progress" : "$.progress",
      },
    },
    output: grok
      ? {
          path: "$.data.result_url",
          kind: "video",
          defaultMimeType: "video/mp4",
        }
      : omni
        ? {
            path: "$.data[*]",
            kind: "video",
            urlPath: "url",
            defaultMimeType: "video/mp4",
          }
        : seedance
          ? {
              path: "$.video_url",
              fallbackPaths: ["$.metadata.video_url", "$.metadata.url"],
              kind: "video",
              defaultMimeType: "video/mp4",
            }
          : {
              path: "$.video_url",
              fallbackPaths: ["$.metadata.video_url", "$.metadata.url"],
              kind: "video",
              defaultMimeType: "video/mp4",
            },
  };
}

async function syncCangyuanConnectionFromCatalog(
  connection: ProviderConnectionRecord | null,
  catalog: CangyuanCatalogSnapshot,
) {
  if (!connection || connection.config.preset !== CANGYUAN_IMAGE_PRESET_ID)
    return connection;
  if (connection.config.usage === "agent") return connection;
  const group = normalizeCangyuanImageGroup(connection.config.modelGroup);
  if (!group) return connection;
  const models = catalog.groups[group];
  if (models.length === 0) return connection;
  // A live marketplace is an availability/price source, not an instruction to
  // delete models a user already configured. Keep saved descriptors and
  // transport overrides that are temporarily absent from the live response so
  // existing canvas nodes remain executable and the selected default remains
  // stable across a refresh.
  const savedConnector = isRecord(connection.config.connector)
    ? connection.config.connector
    : {};
  const savedModels = Array.isArray(savedConnector.models)
    ? savedConnector.models.filter(isRecord)
    : [];
  const liveById = new Map(models.map((model) => [model.id, model]));
  const mergedModels: ModelDescriptor[] = [];
  const seen = new Set<string>();
  for (const saved of savedModels) {
    const id = typeof saved.id === "string" ? saved.id.trim() : "";
    if (!id || seen.has(id)) continue;
    const live = liveById.get(id);
    mergedModels.push(
      (live ? { ...saved, ...live } : saved) as unknown as ModelDescriptor,
    );
    seen.add(id);
  }
  for (const model of models) {
    if (seen.has(model.id)) continue;
    mergedModels.push(model);
    seen.add(model.id);
  }
  const configuredDefault =
    typeof connection.config.defaultModel === "string"
      ? connection.config.defaultModel.trim()
      : "";
  const defaultModel =
    configuredDefault ||
    mergedModels.find((model) => model.isDefault)?.id ||
    mergedModels[0]!.id ||
    cangyuanDefaultModelForGroup(group);
  const generatedConnector = cangyuanConnectorForModels(
    group,
    mergedModels,
  ) as unknown as Record<string, unknown>;
  const savedOverrides = isRecord(savedConnector.modelOverrides)
    ? savedConnector.modelOverrides
    : {};
  const generatedOverrides = isRecord(generatedConnector.modelOverrides)
    ? generatedConnector.modelOverrides
    : {};
  const config: JsonObject = {
    ...connection.config,
    modelGroup: group,
    defaultModel,
    connector: {
      ...savedConnector,
      ...generatedConnector,
      models: mergedModels as unknown as JsonObject[],
      modelOverrides: {
        ...savedOverrides,
        ...generatedOverrides,
      },
    } as unknown as JsonObject,
    catalogCheckedAt: catalog.checkedAt,
    catalogSource: catalog.source,
  };
  if (JSON.stringify(connection.config) === JSON.stringify(config))
    return connection;
  return getRepository().saveConnection({
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    encryptedSecret: connection.encryptedSecret,
    config,
  });
}

export async function syncCangyuanConnection(id: string) {
  const repository = getRepository();
  const [connection, catalog] = await Promise.all([
    repository.getConnection(id),
    loadCangyuanCatalog(),
  ]);
  return syncCangyuanConnectionFromCatalog(connection, catalog);
}

async function syncAllCangyuanConnectionsFromCatalog(
  catalog: CangyuanCatalogSnapshot,
) {
  const repository = getRepository();
  const connections = await repository.listConnections();
  return Promise.all(
    connections
      .filter(
        (connection) => connection.config.preset === CANGYUAN_IMAGE_PRESET_ID,
      )
      .map((connection) =>
        syncCangyuanConnectionFromCatalog(connection, catalog),
      ),
  );
}

export async function syncAllCangyuanConnections() {
  return syncAllCangyuanConnectionsFromCatalog(await loadCangyuanCatalog());
}

/**
 * Keeps every saved Cangyuan group on the same snapshot returned to the
 * canvas. Without this, an older local model list can repeatedly fight the
 * live marketplace list and make a controlled model selector jump.
 */
export async function loadSyncedCangyuanCatalog(options?: { force?: boolean }) {
  const catalog = await loadCangyuanCatalog({ force: options?.force });
  const cache = connectionCatalogSyncCache();
  if (cache.pending) await cache.pending;
  if (cache.checkedAt === catalog.checkedAt) return catalog;

  const pending = syncAllCangyuanConnectionsFromCatalog(catalog).then(() => {
    cache.checkedAt = catalog.checkedAt;
  });
  cache.pending = pending;
  try {
    await pending;
  } finally {
    if (cache.pending === pending) cache.pending = undefined;
  }
  return catalog;
}

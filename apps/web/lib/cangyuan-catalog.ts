import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterOption,
  RestConnectorConfig,
  RestModelConnectorOverride,
  RestRequestMapping,
} from "@super-canvas/providers";
import { getRepository, type JsonObject } from "@super-canvas/db";
import {
  CANGYUAN_IMAGE_BASE_URL,
  CANGYUAN_IMAGE_PRESET_ID,
  CANGYUAN_IMAGE_GROUP,
  CANGYUAN_VIDEO_GROUP,
  cangyuanDefaultModelForGroup,
  cangyuanImageConnectorForGroup,
  isCangyuanImageGroup,
  type CangyuanImageGroup,
} from "./provider-presets";

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

interface CatalogCache {
  snapshot?: CangyuanCatalogSnapshot;
  expiresAt: number;
  pending?: Promise<CangyuanCatalogSnapshot>;
}

const globalCacheKey = "__superCanvasCangyuanCatalog";

function catalogCache(): CatalogCache {
  const scope = globalThis as typeof globalThis & {
    [globalCacheKey]?: CatalogCache;
  };
  return (scope[globalCacheKey] ??= { expiresAt: 0 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (isRecord(record.video_ui_params) || tags.includes("video")) return "video";
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
    typeof record.model_ratio === "number" && Number.isFinite(record.model_ratio)
      ? record.model_ratio
      : null;
  const completionRatio =
    typeof record.completion_ratio === "number" &&
    Number.isFinite(record.completion_ratio)
      ? record.completion_ratio
      : 1;
  const cacheRatio =
    typeof record.cache_ratio === "number" && Number.isFinite(record.cache_ratio)
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
  const unit = priceUnit(
    record,
    marketplaceCapability(record) === "video",
  );
  return {
    priceLabel: price ? `¥${price}/${unit}` : "价格以模型广场为准",
    billingLabel:
      record.billing_mode === "per_second" ? "按秒计费" : "按请求计费",
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
  if (record.billing_mode === "per_second") return "秒";
  return video ? "次" : "张";
}

function nameWithLivePrice(
  model: ModelDescriptor,
  record: PricingRecord,
  video = false,
) {
  const baseName = model.name.replace(/（¥[^）]+\/(?:张|次|秒)）$/u, "");
  const price = formatPrice(record.model_price);
  return price
    ? `${baseName}（¥${price}/${priceUnit(record, video)}）`
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

function imageRatioOptions(value: unknown): ModelParameterOption[] {
  const options = parameterOptions(value).filter(
    (option) => option.value !== "auto",
  );
  return [
    { label: "自动（跟随参考图）", value: "auto" },
    ...options,
  ];
}

function inferredParameters(record: PricingRecord): ModelParameterDescriptor[] {
  const ui = isRecord(record.image_ui_params) ? record.image_ui_params : {};
  const params = isRecord(ui.params) ? ui.params : {};
  const descriptors: ModelParameterDescriptor[] = [];
  const aspectRatio = isRecord(params.aspectRatio) ? params.aspectRatio : null;
  if (aspectRatio?.enabled === true) {
    const originalOptions = parameterOptions(aspectRatio.options);
    const options = imageRatioOptions(aspectRatio.options);
    descriptors.push({
      key: "aspect_ratio",
      label: "画面比例",
      control: options.length > 0 ? "select" : "text",
      valueType: "string",
      ...(options.length > 0
        ? { default: originalOptions[0]?.value ?? "auto", options }
        : {}),
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
    const highDefault =
      typeof record.model_name === "string" &&
      /4k/iu.test(record.model_name) &&
      options.some((option) => option.value === "high");
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

function supportsJsonReferences(record: PricingRecord): boolean {
  if (!isRecord(record.api_doc) || !isRecord(record.api_doc.modes))
    return false;
  return Object.values(record.api_doc.modes).some((mode) => {
    if (!isRecord(mode) || !Array.isArray(mode.params)) return false;
    return mode.params.some(
      (param) =>
        isRecord(param) &&
        typeof param.name === "string" &&
        /(?:images|reference_images|image_urls)/u.test(param.name),
    );
  });
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
      documented.has("first_image_url") && documented.has("last_image_url"),
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
    parameters: inferredVideoParameters(record),
    metadata: {
      modality: "video",
      ...refs,
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
  if (known) {
    const parameters = inferredParameters(record);
    return {
      ...structuredClone(known),
      name: nameWithLivePrice(known, record),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(typeof record.description === "string" && record.description.trim()
        ? { description: record.description.trim() }
        : {}),
    };
  }
  const price = formatPrice(record.model_price);
  const parameters = inferredParameters(record);
  return {
    id,
    name: `${id}${price ? `（¥${price}/张）` : ""}`,
    ...(typeof record.description === "string" && record.description.trim()
      ? { description: record.description.trim() }
      : {}),
    operations: supportsJsonReferences(record)
      ? IMAGE_OPERATIONS
      : GENERATE_ONLY,
    ...(parameters.length > 0 ? { parameters } : {}),
    limits: {
      ...(supportsJsonReferences(record) ? { maxInputImages: 9 } : {}),
      supportedMimeTypes: IMAGE_MIME_TYPES,
    },
  };
}

export function cangyuanCatalogFromPricing(
  payload: PricingPayload,
): CangyuanCatalogSnapshot {
  if (!Array.isArray(payload.data)) throw new Error("沧元模型广场数据格式无效");
  const pricingRecords = payload.data.filter(isRecord) as PricingRecord[];
  const knownModels = new Map<string, ModelDescriptor>();
  for (const group of [
    CANGYUAN_IMAGE_GROUP,
    CANGYUAN_VIDEO_GROUP,
    "全模型-无claude/gpt",
    "备用image线路",
  ] as const) {
    for (const model of cangyuanImageConnectorForGroup(group).models ?? []) {
      knownModels.set(model.id, model);
    }
  }
  const groups: Record<CangyuanImageGroup, ModelDescriptor[]> = {
    IMAGE: [],
    VIDEO: [],
    "全模型-无claude/gpt": [],
    备用image线路: [],
  };

  for (const record of pricingRecords) {
    const descriptor = isVideoPricingRecord(record)
      ? videoDescriptorForRecord(record)
      : isImagePricingRecord(record)
        ? imageDescriptorForRecord(record, knownModels)
        : null;
    if (!descriptor) continue;
    for (const group of stringArray(record.enable_groups)) {
      if (isCangyuanImageGroup(group)) groups[group].push(descriptor);
    }
  }
  for (const group of Object.keys(groups) as CangyuanImageGroup[]) {
    groups[group].sort((left, right) => left.id.localeCompare(right.id));
  }
  const ratios = numberRecord(payload.group_ratio);
  const descriptions = stringRecord(payload.usable_group);
  const groupIds = new Set([
    ...Object.keys(ratios),
    ...Object.keys(descriptions),
    ...pricingRecords.flatMap((record) => stringArray(record.enable_groups)),
  ]);
  const marketplaceGroups = [...groupIds]
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((group): CangyuanMarketplaceGroup => {
      const ratio = ratios[group] ?? 1;
      const models = pricingRecords
        .filter((record) => stringArray(record.enable_groups).includes(group))
        .flatMap((record) => {
          const model = marketplaceModelForRecord(record, ratio);
          return model ? [model] : [];
        })
        .sort((left, right) => left.id.localeCompare(right.id));
      return {
        id: group,
        description: descriptions[group] ?? "",
        ratio,
        canvasSupported: isCangyuanImageGroup(group),
        models,
      };
    });
  return {
    checkedAt: new Date().toISOString(),
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
      priceLabel: model.name.match(/（(¥[^）]+)）$/u)?.[1] ?? "价格以模型广场为准",
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
      备用image线路: [
        ...(cangyuanImageConnectorForGroup("备用image线路").models ?? []),
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
        "备用image线路",
        cangyuanImageConnectorForGroup("备用image线路").models ?? [],
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
    {
      key: "duration",
      label: "时长（秒）",
      control: "select",
      valueType: "integer",
      default: durations[0],
      options: durations.map((value) => ({ label: String(value), value })),
      operations: VIDEO_OPERATIONS,
    },
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

  const fetchImpl = options?.fetch ?? fetch;
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

function connectorWithModels(
  group: CangyuanImageGroup,
  models: readonly ModelDescriptor[],
): RestConnectorConfig {
  const connector = cangyuanImageConnectorForGroup(group);
  const modelOverrides = Object.fromEntries(
    models.flatMap((model) => {
      if (!model.operations.some((operation) => operation.startsWith("video.")))
        return [];
      return [[model.id, videoTransportForModel(model)]];
    }),
  );
  return {
    ...connector,
    models: structuredClone(models),
    ...(Object.keys(modelOverrides).length > 0 ? { modelOverrides } : {}),
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

function assetMapping(
  target: string,
  assetKind: "image" | "video" | "audio",
  options?: {
    role?: "reference" | "firstFrame" | "lastFrame";
    excludeRoles?: readonly ("reference" | "firstFrame" | "lastFrame")[];
    select?: "all" | "first";
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
  const mappings: RestRequestMapping[] = [...videoParameterMappings];

  if (model.id.startsWith("grok-video")) {
    mappings.push(
      assetMapping("/image_urls", "image"),
      assetMapping("/video_url", "video", { select: "first" }),
    );
  } else if (payloadBuilder === "omni-v2v") {
    mappings.push(
      assetMapping("/reference_videos", "video"),
      assetMapping("/reference_image_urls", "image"),
    );
  } else if (payloadBuilder === "omni-frame") {
    mappings.push(
      assetMapping("/image_url", "image", {
        role: "reference",
        select: "first",
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
  } else if (model.id.startsWith("seedance-")) {
    mappings.push(
      assetMapping("/reference_image_urls", "image", {
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
  const seedance = model.id.startsWith("seedance-");
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

export async function syncCangyuanConnection(id: string) {
  const repository = getRepository();
  const connection = await repository.getConnection(id);
  if (!connection || connection.config.preset !== CANGYUAN_IMAGE_PRESET_ID)
    return connection;
  if (
    connection.config.usage === "agent" ||
    !isCangyuanImageGroup(connection.config.modelGroup)
  )
    return connection;
  const group = connection.config.modelGroup;
  const catalog = await loadCangyuanCatalog();
  const models = catalog.groups[group];
  if (models.length === 0) return connection;
  const configuredDefault =
    typeof connection.config.defaultModel === "string"
      ? connection.config.defaultModel
      : cangyuanDefaultModelForGroup(group);
  const defaultModel = models.some((model) => model.id === configuredDefault)
    ? configuredDefault
    : (models.find((model) => model.isDefault)?.id ?? models[0]!.id);
  const config: JsonObject = {
    ...connection.config,
    modelGroup: group,
    defaultModel,
    connector: connectorWithModels(group, models) as unknown as JsonObject,
    catalogCheckedAt: catalog.checkedAt,
    catalogSource: catalog.source,
  };
  if (JSON.stringify(connection.config) === JSON.stringify(config))
    return connection;
  return repository.saveConnection({
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    encryptedSecret: connection.encryptedSecret,
    config,
  });
}

export async function syncAllCangyuanConnections() {
  const repository = getRepository();
  const connections = await repository.listConnections();
  return Promise.all(
    connections
      .filter(
        (connection) => connection.config.preset === CANGYUAN_IMAGE_PRESET_ID,
      )
      .map((connection) => syncCangyuanConnection(connection.id)),
  );
}

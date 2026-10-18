import type { ModelDescriptor, ModelParameterDescriptor, ModelParameterOption, ProviderAssetInput, ProviderOperation, StructuredModelPricing, StructuredPriceTier } from "./contracts.js";
import type { DiscoveredSupplierGroup, DiscoveredSupplierModel } from "./supplier-catalog.js";
import { supplierDirectoryPayloadComplete } from "./supplier-directory-completeness.js";
import { imageSizeForTier, userImageSizeOptions, type ImageSizeTier } from "./image-size-presets.js";

export const LANGFRAME_ORIGIN = "https://vipprompt.cn";
export const LANGFRAME_CATALOG_URL = `${LANGFRAME_ORIGIN}/api/relay/groups?stats=1`;
export const LANGFRAME_DOCS_URL = `${LANGFRAME_ORIGIN}/api-docs`;
export const LANGFRAME_PRICING_URL = `${LANGFRAME_ORIGIN}/pricing`;
type Row = Record<string, unknown>;
const object = (value: unknown): Row | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;
const text = (value: unknown, max = 8000): string => typeof value === "string" ? value.trim().slice(0, max) : "";
const amount = (value: unknown): number | undefined => value !== "" && value !== null && value !== undefined &&
  (typeof value === "number" || typeof value === "string") && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined;
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(item => text(item, 512)).filter(Boolean))] : [];
const positiveInteger = (value: unknown): number | undefined => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
const money = (value: number) => String(Number(value.toPrecision(12)));

export function isLangframeCatalogSource(...sources: (string | undefined)[]): boolean {
  return sources.some(source => {
    try {
      const url = new URL(source ?? "");
      return [LANGFRAME_ORIGIN, "https://www.vipprompt.cn"].includes(url.origin) && !url.username && !url.password && !url.search && !url.hash &&
        /^(?:\/v1|\/pricing|\/api-docs)?\/?$/u.test(url.pathname);
    } catch { return false; }
  });
}

/** These are public response fields, never login tokens or arbitrary server properties. */
const publicFields = ["id", "name", "groups", "showPrice", "price", "billingMode", "tokenPrices", "tierPrices", "desc", "canvasPriority",
  "secPrices", "trafficPrices", "referenceVideoSecPrices", "mtokenPricing", "imagePrices", "resolutions", "durations", "ratios",
  "referenceMediaPolicy", "maxImages", "maxVideos", "maxAudios", "maxImageOnly", "maxReferences", "requestFormat", "faceProcessing", "runtimeStats", "details"] as const;
const rawParams = (row: Row): Row => Object.fromEntries(publicFields.filter(key => row[key] !== undefined).map(key => [key, structuredClone(row[key])]));
const rateBook = (value: unknown): [string, number][] => Object.entries(object(value) ?? {}).flatMap(([tier, value]) => {
  const rate = amount(value);
  return rate === undefined || !/^(?:[124]K|\d+[pP]?)$/u.test(tier) ? [] : [[tier.replace(/p$/iu, "P"), rate] as [string, number]];
});
const resolutionValue = (value: string) => /^\d+$/u.test(value) ? `${value}P` : value.toUpperCase();

export interface LangframeCatalogOptions { checkedAt: string; sourceUrl?: string; sourceSha256?: string }
export interface LangframeGroupModelEvidence {
  groupName: string;
  type: string;
  innerId: string;
  callName: string;
  sourceUrl: string;
  checkedAt: string;
  rawParams: Row;
  pricing?: StructuredModelPricing;
  priceLabel?: string;
}
export interface LangframeCatalogResult {
  recognized: boolean;
  complete: boolean;
  groups: DiscoveredSupplierGroup[];
  /** Models sharing a public name retain all exact group tariffs in metadata. */
  models: ModelDescriptor[];
}

function publishedPricing(row: Row, type: string, options: LangframeCatalogOptions): { pricing?: StructuredModelPricing; priceLabel?: string } {
  if (row.showPrice === false) return {};
  const base = { currency: "CNY", sourceUrl: options.sourceUrl ?? LANGFRAME_CATALOG_URL, checkedAt: options.checkedAt, confidence: "exact" as const };
  if (type === "image") {
    const entries = rateBook(row.imagePrices);
    if (entries.length) return { pricing: { ...base, kind: "tiered", billingUnit: "image", tiers: entries.map(([resolution, price]) => ({
      id: resolution, label: resolution, dimension: "resolution", value: resolution, price })) },
      priceLabel: entries.map(([tier, price]) => `${tier} ¥${money(price)}/张`).join(" · ") };
    const value = amount(row.price);
    return value === undefined ? {} : { pricing: { ...base, kind: "per-image", billingUnit: "image", unitAmount: value }, priceLabel: `¥${money(value)}/张` };
  }
  if (type === "video") {
    if (["request", "per_request"].includes(text(row.billingMode))) {
      const value = amount(row.price);
      return value === undefined ? {} : { pricing: { ...base, kind: "per-request", billingUnit: "request", unitAmount: value }, priceLabel: `¥${money(value)}/次` };
    }
    if (["traffic", "token"].includes(text(row.billingMode))) {
      const mtoken = object(row.mtokenPricing), traffic = object(row.trafficPrices) ?? object(row.tokenPrices);
      const ordinary = amount(mtoken?.withoutReferenceVideo ?? traffic?.output);
      const reference = amount(mtoken?.withReferenceVideo ?? traffic?.referenceVideo);
      if (ordinary === undefined && reference === undefined) return {};
      const tiers: StructuredPriceTier[] = [];
      for (const [withReference, price] of [[false, ordinary], [true, reference]] as const) {
        if (price !== undefined) tiers.push({ id: withReference ? "reference-video" : "no-reference-video", label: withReference ? "含参考视频" : "无参考视频", price,
          conditionMode: "all", conditions: [{ parameter: "token_kind", operator: "equals", value: "output" },
            { parameter: "hasReferenceVideo", operator: "equals", value: String(withReference) }] });
      }
      return { pricing: { ...base, kind: "token", tiers }, priceLabel: tiers.map(tier => `${tier.label} ¥${money(tier.price)}/1M Token`).join(" · ") };
    }
    if (row.billingMode !== "second") return {};
    const ordinary = rateBook(row.secPrices), reference = rateBook(row.referenceVideoSecPrices);
    if (!ordinary.length && !reference.length) return {};
    const tiers: StructuredPriceTier[] = [];
    for (const [isReference, entries] of [[false, ordinary], [true, reference]] as const) {
      for (const [tier, price] of entries) {
        const resolution = resolutionValue(tier);
        tiers.push({ id: reference.length ? `${resolution}:${isReference ? "reference-video" : "no-reference-video"}` : resolution,
          label: reference.length ? `${resolution} ${isReference ? "含参考视频" : "无参考视频"}` : resolution,
          dimension: "resolution", value: resolution, price, ...(reference.length ? { conditionMode: "all" as const,
            conditions: [{ parameter: "resolution", operator: "equals" as const, value: resolution },
              { parameter: "hasReferenceVideo", operator: "equals" as const, value: String(isReference) }] } : {}) });
      }
    }
    return { pricing: { ...base, kind: "tiered", billingUnit: "second", tiers }, priceLabel: tiers.map(tier => `${tier.label} ¥${money(tier.price)}/秒`).join(" · ") };
  }
  if (type === "chat") {
    const tariff = object(row.tierPrices), entries: [string, unknown][] = tariff ? Object.entries(tariff) : [["", row.tokenPrices]];
    const labels: Record<string, string> = { input: "输入", output: "输出", cacheRead: "缓存读取", cacheWrite: "缓存写入" };
    const kinds: Record<string, string> = { input: "input", output: "output", cacheRead: "cache_read", cacheWrite: "cache_write" };
    const tiers: StructuredPriceTier[] = entries.flatMap(([name, value]) => Object.entries(object(value) ?? {}).flatMap(([component, rate]) => {
      const price = amount(rate);
      return price === undefined || !kinds[component] ? [] : [{ id: `${name}:${component}`, label: `${name ? `${name} ` : ""}${labels[component]}`, price,
        conditionMode: "all" as const, conditions: [{ parameter: "token_kind", operator: "equals" as const, value: kinds[component]! },
          ...(name ? [{ parameter: "context_tier", operator: "equals" as const, value: name }] : [])] }];
    }));
    return tiers.length ? { pricing: { ...base, kind: "token", tiers }, priceLabel: tiers.map(tier => `${tier.label} ¥${money(tier.price)}/1M`).join(" · ") } : {};
  }
  return {};
}

function declaredLimits(row: Row, type: string): ModelDescriptor["limits"] {
  const description = text(row.desc), limits: NonNullable<ModelDescriptor["limits"]> = {};
  const count = (raw: unknown, patterns: readonly RegExp[]) => positiveInteger(raw) ?? patterns.map(pattern => {
    const matched = pattern.exec(description)?.[1];
    return matched === undefined ? undefined : Number(matched);
  }).find(value => value !== undefined);
  const images = count(row.maxImages, [/图片最多\s*(\d+)/u, /最多\s*(\d+)\s*张参考图/u, /最多\s*(\d+)\s*张首尾帧/u, /最多\s*(\d+)\s*张图/u,
    /(\d+)\s*图/u, /图\s*(\d+)(?![\d.])/u]);
  const videos = count(row.maxVideos, [/(\d+)\s*视频/u, /视频最多\s*(\d+)/u, /图\s*\d+\s*\/\s*(0)\s*\/\s*\d+\s*音频/u]);
  const audios = count(row.maxAudios, [/(\d+)\s*音频/u, /音频最多\s*(\d+)/u]);
  if (images !== undefined) limits.maxInputImages = images;
  if (videos !== undefined) limits.maxInputVideos = videos;
  if (audios !== undefined) limits.maxInputAudios = audios;
  const all = positiveInteger(row.maxReferences);
  if (all !== undefined) limits.maxInputAssets = all;
  if (/至少\s*1\s*张参考/u.test(description)) limits.requiresInputImage = true;
  if (/不支持参考视频/u.test(description)) limits.maxInputVideos = 0;
  if (type === "video" && /单段视频、音频不超过15秒/u.test(description)) {
    limits.maxInputVideoDurationSeconds = 15;
    limits.maxInputAudioDurationSeconds = 15;
  }
  return Object.keys(limits).length ? limits : undefined;
}

function catalogConflicts(row: Row, groupName: string): string[] {
  const name = text(row.name), notes: string[] = [];
  if (name === "SD2.5-X-满参支持人脸") notes.push("描述时长4–30秒，目录枚举8–30秒；保留原文并按显式枚举校验。");
  if (name === "SD2.5-C-满参支持人脸") notes.push("描述时长4–30秒，目录枚举5–30秒；保留原文并按显式枚举校验。");
  if (name === "veo-omni-flash") notes.push("描述3/4/5/6/8/10秒，目录枚举仅10秒；保留原文并按显式枚举校验。");
  if (["veo-3.1-fast", "veo-3.1-lite"].includes(name)) notes.push("描述4/6/8秒，目录枚举仅8秒；保留原文并按显式枚举校验。");
  if (name === "SD-2.5-M9支持真人满血") notes.push("目录完整调用名为M9，描述写M4，目录分类拼接两个名称；不将两者视作别名。");
  if (/按\/秒/u.test(groupName) && row.billingMode === "request") notes.push("目录分类名写按秒，结构billingMode为request；采用目录计费字段的按次报价。");
  if (name === "image-2-4K-0.07积分") notes.push("名称含0.07积分；公开逐档人民币报价为1K/2K 0.08元、4K 0.10元。");
  if (name === "image-2-4K官网/0.15积分") notes.push("名称含0.15积分；公开逐档人民币报价为1K 0.15元、2K 0.18元、4K 0.20元。");
  if (object(row.mtokenPricing) && /草稿未启用、未公开/u.test(text(row.desc))) notes.push("描述仍称草稿未启用且售价单位待确认，公开目录已经返回MTOKEN报价；未将报价当作真实生成验证。");
  return notes;
}

function parameters(row: Row, type: string): ModelParameterDescriptor[] {
  if (type !== "image" && type !== "video") return [];
  const operations: ProviderOperation[] = type === "image" ? ["image.generate", "image.edit"] : ["video.generate", "video.image-to-video"];
  const values: ModelParameterDescriptor[] = [];
  const resolutions = strings(row.resolutions), ratios = strings(row.ratios);
  if (resolutions.length) values.push({ key: "resolution", label: "分辨率档位", control: "select", valueType: "string", operations,
    options: resolutions.map(value => ({ value, label: value })), description: "当前完整型号的供应商目录枚举；未指定供应商默认值。" });
  if (ratios.length) values.push({ key: type === "image" ? "aspect_ratio" : "ratio", label: "画面比例", control: "select", valueType: "string", operations,
    options: ratios.map(value => ({ value, label: value })), description: "当前完整型号的供应商目录枚举。" });
  if (type === "image") {
    values.push({ key: "size", label: "尺寸", control: "dimensions", valueType: "string", allowCustomValue: true, operations,
      description: "文档接受宽x高字符串；目录没有逐比例像素表、宽高范围或步长。应用尺寸预设不代表供应商已实测输出。" });
    const name = text(row.name), quality = /^image-2\.5-/iu.test(name) ? ["auto", "low", "medium", "high", "xhigh", "max"]
      : /^image-2-/iu.test(name) ? ["auto", "low", "medium", "high"] : [];
    values.push({ key: "quality", label: "质量", control: quality.length ? "select" : "text", valueType: "string", allowCustomValue: true, operations,
      ...(quality.length ? { options: quality.map(value => ({ value, label: value })), default: quality.at(-1)! } : {}),
      description: quality.length ? "质量字段为开放字符串；这些选项及最高质量来自用户指定应用预设，未作为供应商完整枚举或实测。" : "供应商文档质量字段为开放字符串，示例high不是完整枚举或默认值。" });
    values.push({ key: "n", label: "输出数量", control: "number", valueType: "integer", min: 1, step: 1, operations,
      description: "文档公开n字段；未公布当前型号最大输出数量。" });
  } else {
    const durations = Array.isArray(row.durations) ? row.durations.filter(value => typeof value === "number" && Number.isSafeInteger(value) && value > 0) as number[] : [];
    if (durations.length) values.unshift({ key: "duration", label: "时长（秒）", control: "select", valueType: "integer", operations,
      options: [...new Set(durations)].map(value => ({ value, label: `${value} 秒` })), description: "供应商目录的逐秒整数枚举；没有将描述或示例扩大为合法枚举。" });
  }
  return values;
}

function descriptor(row: Row, type: string, groupName: string, options: LangframeCatalogOptions): ModelDescriptor {
  const name = text(row.name, 512), description = text(row.desc), limits = declaredLimits(row, type), quote = publishedPricing(row, type, options);
  const operations: ProviderOperation[] = type === "image" ? ["image.generate", "image.edit"] : type === "video" ? ["video.generate", "video.image-to-video"] : [];
  const inputKinds: NonNullable<ModelDescriptor["inputKinds"]> = type === "image" ? ["text", "image"] : type === "video"
    ? ["text", "image", ...(limits?.maxInputVideos === 0 ? [] : ["video" as const]), ...(limits?.maxInputAudios === 0 ? [] : ["audio" as const])] : ["text"];
  const outputKinds: NonNullable<ModelDescriptor["outputKinds"]> = type === "image" ? ["image"] : type === "video" ? ["video"] : ["text"];
  const sourceUrl = options.sourceUrl ?? LANGFRAME_CATALOG_URL, documentationUrl = `${new URL(sourceUrl).origin}/api-docs`,
    raw = rawParams(row), notes = catalogConflicts(row, groupName), params = parameters(row, type);
  const groupEvidence: LangframeGroupModelEvidence = { groupName, type, innerId: text(row.id, 512), callName: name, sourceUrl,
    checkedAt: options.checkedAt, rawParams: raw, ...quote };
  return { id: name, name, provider: "langframe", operations, inputKinds, outputKinds, ...(limits ? { limits } : {}),
    ...(params.length ? { parameters: params } : {}), ...(quote.pricing ? { pricing: quote.pricing } : {}), ...(description ? { description } : {}),
    metadata: { langframeCatalog: true, langframeCatalogVersion: 1, supplier: "langframe", source: "supplier-catalog", modelGroup: groupName,
      catalogCapability: type, protocol: type === "image" ? "openai-images" : type === "video" ? "openai-videos" : "chat-completions",
      protocolSourceUrl: documentationUrl, documentationUrl, langframeCatalogUrl: sourceUrl, langframeCatalogCheckedAt: options.checkedAt,
      ...(options.sourceSha256 ? { langframeCatalogSourceSha256: options.sourceSha256 } : {}),
      langframeCallName: name, langframeInnerModelId: text(row.id, 512), langframeGroupIdentitySource: "public-category-name", rawParams: raw,
      langframeGroupCatalog: [groupEvidence], langframeParameters: params, langframeOperations: operations, langframeInputKinds: inputKinds,
      langframeOutputKinds: outputKinds, langframeDescription: description, ...(limits ? { langframeLimits: limits } : {}),
      ...(quote.pricing ? { langframePricing: quote.pricing } : {}), ...(quote.priceLabel ? { priceLabel: quote.priceLabel } : {}),
      ...(notes.length ? { langframeCatalogConflicts: notes } : {}), langframeRuntimeStats: row.runtimeStats ?? null,
      langframeRuntimeStatsSource: "unmodified-api", langframePublicSuccessRateDisplayAdjusted: type === "video" &&
        Number(object(row.runtimeStats)?.completed) > 0 && typeof object(row.runtimeStats)?.successRate === "number" && Number(object(row.runtimeStats)?.successRate) < 70,
      langframeRequestFormat: text(row.requestFormat), langframeDeclaredModes: type === "video" ? description : "image.generate,image.edit",
      ...(type === "image" ? { imageSupportedResolutions: strings(row.resolutions), imageResolutionTiers: strings(row.resolutions),
        imageResolutionTierSource: "supplier-catalog-enum", imageResolutionTierParameter: "resolution", exclusiveResolutions: true, imageSupportedRatios: strings(row.ratios),
        imageOpenSizePreferences: true, imageCustomDimensions: true, imageQualitySource: "open-api-string",
        ...(/^image-2(?:\.5)?-/iu.test(name) ? { imageUserQualityPresetSource: "user-request", imageUserQualityPresets: "2026-10-11" } : {}) } : {}),
      langframeSubmitPath: type === "image" ? "/v1/images/generations" : type === "video" ? "/v1/videos" : "/v1/chat/completions",
      ...(type === "image" || type === "video" ? { langframePollPath: type === "image" ? "/v1/images/tasks/{id}" : "/v1/videos/tasks/{id}" } : {}),
      protocolEvidence: "official-docs", outputKindsSource: "declared", operationsSource: "declared" } };
}

/** Restore the complete descriptor after catalog persistence without guessing from its name. */
export function langframeModelDescriptor(model: Pick<DiscoveredSupplierModel, "id" | "name" | "metadata" | "inputKinds" | "outputKinds" | "limits">): ModelDescriptor | undefined {
  if (model.metadata?.langframeCatalog !== true) return undefined;
  const metadata = model.metadata;
  return { id: model.id, name: model.name ?? model.id, provider: "langframe", operations: (metadata.langframeOperations ?? []) as ModelDescriptor["operations"],
    ...(model.inputKinds ? { inputKinds: model.inputKinds } : {}), ...(model.outputKinds ? { outputKinds: model.outputKinds } : {}),
    ...(model.limits ? { limits: model.limits } : {}), parameters: (metadata.langframeParameters ?? []) as NonNullable<ModelDescriptor["parameters"]>,
    ...(object(metadata.langframePricing) ? { pricing: metadata.langframePricing as unknown as StructuredModelPricing } : {}),
    ...(text(metadata.langframeDescription) ? { description: text(metadata.langframeDescription) } : {}), metadata };
}

function aggregateModels(models: readonly ModelDescriptor[]): ModelDescriptor[] {
  const all = new Map<string, ModelDescriptor>();
  for (const model of models) {
    const key = `${String(model.metadata?.catalogCapability)}|${model.id}`, previous = all.get(key);
    if (!previous) { all.set(key, model); continue; }
    const priorMeta = { ...previous.metadata }, groupCatalog = [...(priorMeta.langframeGroupCatalog as LangframeGroupModelEvidence[]),
      ...(model.metadata?.langframeGroupCatalog as LangframeGroupModelEvidence[])];
    const samePricing = groupCatalog.every(entry => JSON.stringify(entry.pricing) === JSON.stringify(groupCatalog[0]?.pricing));
    const nextMetadata: Row = { ...priorMeta, langframeGroupCatalog: groupCatalog, langframeGroupIdentitySource: "public-category-names" };
    delete nextMetadata.modelGroup;
    const next = { ...previous, metadata: nextMetadata };
    if (!samePricing) {
      delete next.pricing;
      delete next.metadata.langframePricing;
      next.metadata.priceLabel = `${groupCatalog.length} 个分组独立计价`;
      next.metadata.langframePricingRequiresGroup = true;
    }
    all.set(key, next);
  }
  return [...all.values()];
}

/** Empty account restrictions mean all, as documented by this site's SK API.
 * Public categories describe catalog membership, not a newly rebound Key.
 * Failover order is retained as evidence; it never chooses a cheaper tariff. */
export function langframeModelsForKey(groups: readonly { id: string; models: readonly Pick<DiscoveredSupplierModel, "id" | "name" | "metadata" | "inputKinds" | "outputKinds" | "limits">[] }[],
  accountGroups: readonly string[] = [], modelIds: readonly string[] = []): ModelDescriptor[] {
  const allowedModels = new Set(modelIds), ordered = accountGroups.length
    ? accountGroups.flatMap(name => groups.filter(group => group.id === name)) : groups;
  return aggregateModels(ordered.flatMap(group => group.models.flatMap(model => {
    if (allowedModels.size && !allowedModels.has(model.id)) return [];
    const restored = langframeModelDescriptor(model);
    return restored ? [restored] : [];
  })));
}

export function parseLangframeCatalog(payload: unknown, options: LangframeCatalogOptions): LangframeCatalogResult {
  const root = object(payload), entries = root?.groups;
  if (root?.ok !== true || !Array.isArray(entries)) return { recognized: false, complete: false, groups: [], models: [] };
  let complete = supplierDirectoryPayloadComplete(payload) && entries.length <= 500;
  const groups: DiscoveredSupplierGroup[] = [];
  for (const value of entries.slice(0, 500)) {
    const group = object(value), groupName = text(group?.name, 512), type = text(group?.type), rows = group?.models;
    if (!group || !groupName || !["image", "video", "chat"].includes(type) || !Array.isArray(rows)) { complete = false; continue; }
    if (rows.length > 3000) complete = false;
    const discovered: DiscoveredSupplierModel[] = [], seen = new Set<string>();
    for (const raw of rows.slice(0, 3000)) {
      const row = object(raw), name = text(row?.name, 512);
      // Inner IDs are deliberately reused across distinct, separately billed SKUs.
      if (!row || !name || seen.has(name)) { complete = false; continue; }
      seen.add(name);
      const model = descriptor(row, type, groupName, options), metadata = model.metadata!;
      discovered.push({ id: model.id, name: model.name, capability: type as "image" | "video" | "chat",
        protocol: type === "image" ? "openai-images" : type === "video" ? "openai-videos" : "chat-completions",
        ...(model.inputKinds ? { inputKinds: model.inputKinds } : {}), ...(model.outputKinds ? { outputKinds: model.outputKinds } : {}),
        ...(model.limits ? { limits: model.limits } : {}), ...(typeof metadata.priceLabel === "string" ? { priceLabel: metadata.priceLabel } : {}), metadata });
    }
    groups.push({ id: groupName, label: groupName, source: "catalog", models: discovered });
  }
  return { recognized: true, complete, groups, models: langframeModelsForKey(groups) };
}

/** Derived quote inputs are application data, never fields sent to the supplier. */
export function langframePricingParameters(parameters: Readonly<Record<string, unknown>>, assets?: readonly Pick<ProviderAssetInput, "kind">[]): Record<string, unknown> {
  const next: Record<string, unknown> = { ...parameters, ...(typeof parameters.resolution === "string" ? { resolution: resolutionValue(parameters.resolution) } : {}) };
  delete next.hasReferenceVideo;
  const explicit = typeof parameters.has_reference_video === "boolean" ? parameters.has_reference_video
    : typeof parameters.hasReferenceVideo === "boolean" ? parameters.hasReferenceVideo : undefined;
  const reference = explicit ?? (assets === undefined ? undefined : assets.some(asset => asset.kind === "video"));
  return { ...next, ...(reference === undefined ? {} : { hasReferenceVideo: reference }) };
}

/** Apply after the shared user-size projection: its pixel shortcuts are user
 * preferences, while this supplier's tier/ratio enums remain authoritative. */
export function langframeImagePresentation(model: ModelDescriptor): ModelDescriptor {
  if (model.metadata?.langframeCatalog !== true || !model.operations.some(operation => operation.startsWith("image."))) return model;
  const raw = object(model.metadata.rawParams), officialTiers = strings(raw?.resolutions), officialRatios = strings(raw?.ratios);
  const tiers = officialTiers.filter((tier): tier is ImageSizeTier => ["1K", "2K", "4K"].includes(tier));
  if (!tiers.length || !officialRatios.length) return model;
  const allowedRatios = new Set(officialRatios), knownRatios = new Set<string>();
  const presets: ModelParameterOption[] = userImageSizeOptions(tiers).filter(option => {
    if (option.value === "auto") return true;
    const ratio = /^(?:1K|2K|4K) · ([\d:]+) ·/u.exec(option.label)?.[1];
    if (ratio) knownRatios.add(ratio);
    return !!ratio && allowedRatios.has(ratio);
  });
  for (const tier of tiers) for (const ratio of officialRatios) {
    if (knownRatios.has(ratio) || !/^\d+:\d+$/u.test(ratio)) continue;
    const size = imageSizeForTier(tier, ratio);
    presets.push({ value: size, label: `${tier} · ${ratio} · ${size.replace("x", " × ")}` });
  }
  const name = model.id, qualities = /^image-2\.5-/iu.test(name) ? ["auto", "low", "medium", "high", "xhigh", "max"]
    : /^image-2-/iu.test(name) ? ["auto", "low", "medium", "high"] : undefined;
  const projected = (model.parameters ?? []).map(parameter => {
    if (parameter.key === "resolution") return { ...parameter, options: officialTiers.map(value => ({ value, label: value })) };
    if (parameter.key === "aspect_ratio") return { ...parameter, options: officialRatios.map(value => ({ value, label: value })) };
    if (parameter.key === "size") return { ...parameter, control: "dimensions" as const, allowCustomValue: true, options: presets,
      description: "宽高和尺寸快捷选项为用户指定的应用预设；档位、比例按当前型号目录选择。供应商未公布像素换算、范围或步长，实际输出以原文件为准。" };
    if (parameter.key === "quality" && qualities) return { ...parameter, control: "select" as const, allowCustomValue: true,
      options: qualities.map(value => ({ value, label: value })), default: qualities.at(-1)!,
      description: "质量字段为开放字符串；Image 2.5最高max、Image 2最高high来自用户指定应用预设，并非供应商完整枚举或实测。" };
    return parameter;
  });
  return { ...model, parameters: projected, metadata: { ...model.metadata, imageResolutionTierParameter: "resolution",
    imageNativeResolutionParameter: "resolution", imageResolutionTiers: officialTiers, imageSupportedResolutions: officialTiers,
    imageResolutionTierSource: "supplier-catalog-enum", exclusiveResolutions: true, imageSupportedRatios: officialRatios,
    imageOpenSizePreferences: true, imageUserSizePresets: "2026-10-11", imageUserSizePresetSource: "user-request", imageUserSizePresetTiers: tiers,
    imageUserSizePresetParameter: "size", langframeImagePresentation: 1,
    ...(qualities ? { imageUserQualityPresets: "2026-10-11", imageUserQualityPresetSource: "user-request", imageApplicationQualityDefault: qualities.at(-1)! } : {}) } };
}

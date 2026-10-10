import { fetchProviderJson, providerFetch, ProviderHttpError } from "./http.js";
import type { FetchImplementation, ModelDescriptor } from "./contracts.js";
import { catalogPriceLabel, scopedCatalogMediaPricing } from "./catalog-pricing.js";
import { chuangxiangCatalogPricing, isChuangxiangCatalogSource } from "./chuangxiang-catalog-pricing.js";
import { parseProviderModelFacts, scanProviderModelCatalog } from "./model-catalog.js";
import { endpointGenerationMediaKinds, modelGenerationMediaKinds } from "./model-media.js";
import { parseSupplierGroupDetails, type SupplierGroupDetails } from "./supplier-group-details.js";
import { isTk1688CatalogSource, parseTk1688AccountModelIds, parseTk1688Marketplace, TK1688_MARKETPLACE_URL } from "./tk1688-catalog.js";
import { secureSkillCatalogPricing, secureSkillCatalogVideoDeclaration } from "./secure-skill-catalog-pricing.js";
import { isWeAiLegacyCatalogSource, readWeAiLegacyCatalog, WEAI_LEGACY_PRICE_UNIT_NOTE } from "./weai-legacy-catalog.js";
import { isSub2apiPlazaPricingSource, sub2apiPlazaPricing } from "./sub2api-plaza-pricing.js";
import { isMiaowuCatalogSource, miaowuCatalogMediaKind, miaowuCatalogMediaPricing } from "./miaowu-catalog-pricing.js";
import { isCyberAfeiUnpricedCatalogVideo } from "./cyberafei-catalog-evidence.js";
import { HANG_PRICE_URL, isHangCatalogSource, parseHangChatPrices } from "./hang-catalog-pricing.js";
import { isSynoraLedgerSource, readSynoraLedgerPrices, type SupplierLedgerPrice } from "./supplier-ledger-pricing.js";
import { isJiasuCatalogSource, jiasuCatalogMediaKind, jiasuCatalogMediaPricing, jiasuCatalogRecord } from "./jiasu-catalog-pricing.js";
import { isJijiuCatalogSource, jijiuCatalogMediaPricing } from "./jijiu-catalog-pricing.js";
import { isJijiuApiUrl, jijiuVideoModel } from "./jijiu-video-contract.js";
import { applyJijiuImageCapabilities } from "./jijiu-image-contract.js";
export { isCyberAfeiUnpricedCatalogVideo } from "./cyberafei-catalog-evidence.js";

export type SupplierSiteKind =
  "auto" | "newapi" | "sub2api" | "openai-compatible";
export interface DiscoveredSupplierModel {
  id: string;
  name?: string;
  capability: "image" | "video" | "music" | "chat" | "other";
  protocol?:
    | "openai-images"
    | "openai-videos"
    | "chat-completions"
    | "responses"
    | "gemini"
    | "unknown";
  priceLabel?: string;
  /** Descriptive evidence only; a public listing does not grant a Key access. */
  inputKinds?: ModelDescriptor["inputKinds"];
  outputKinds?: ModelDescriptor["outputKinds"];
  limits?: ModelDescriptor["limits"];
  metadata?: ModelDescriptor["metadata"];
}
export interface DiscoveredSupplierGroup {
  id: string;
  label: string;
  source: "catalog";
  models: DiscoveredSupplierModel[];
  /** Official site identity, separate from the name saved by connections. */
  supplierGroupId?: string;
  details?: SupplierGroupDetails;
}
export interface SupplierCatalogDiscovery {
  groups: DiscoveredSupplierGroup[];
  kind: SupplierSiteKind;
  status: "live" | "empty" | "failed" | "unauthorized";
  checkedAt: string;
  /** A partial directory must not hide groups found by previous scans. */
  complete?: boolean;
  error?: string;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, 256) : "";

const values = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(text).filter(Boolean)
    : text(value)
      ? [text(value)]
      : [];

const supplierGroupId = (value: unknown): string | undefined => {
  const number = typeof value === "number" ? value : /^\d+$/u.test(text(value)) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? String(number) : undefined;
};
const groupIdentity = (group: Pick<DiscoveredSupplierGroup, "id" | "supplierGroupId">): string =>
  group.supplierGroupId ? `site-id:${group.supplierGroupId}` : `name:${group.id}`;

/** A repeated public name never identifies two different official groups. */
function distinctGroupNames(groups: DiscoveredSupplierGroup[]): DiscoveredSupplierGroup[] {
  const counts = new Map<string, number>();
  for (const group of groups) counts.set(group.id, (counts.get(group.id) ?? 0) + 1);
  return groups.map(group => {
    if ((counts.get(group.id) ?? 0) < 2 || !group.supplierGroupId) return group;
    const suffix = ` [分组ID ${group.supplierGroupId}]`;
    return { ...group, id: `${group.id.slice(0, 256 - suffix.length)}${suffix}`,
      label: `${group.label.slice(0, 256 - suffix.length)}${suffix}` };
  });
}

function mergeCatalogModel(previous: DiscoveredSupplierModel, incoming: DiscoveredSupplierModel): DiscoveredSupplierModel {
  const merged = { ...incoming, ...previous, metadata: { ...incoming.metadata, ...previous.metadata },
    ...((previous.priceLabel || incoming.priceLabel) ? { priceLabel: previous.priceLabel || incoming.priceLabel } : {}) };
  const conflict = previous.metadata?.supplierPriceConflict === true || incoming.metadata?.supplierPriceConflict === true ||
    Boolean(previous.priceLabel && incoming.priceLabel && (previous.priceLabel !== incoming.priceLabel ||
      (previous.metadata?.secureSkillCatalogPricing && incoming.metadata?.secureSkillCatalogPricing &&
        JSON.stringify(previous.metadata.secureSkillCatalogPricing) !== JSON.stringify(incoming.metadata.secureSkillCatalogPricing))));
  if (!conflict) return merged;
  const alternatives = [previous, incoming].flatMap(model =>
    Array.isArray(model.metadata?.supplierPriceAlternatives) ? model.metadata.supplierPriceAlternatives :
      model.priceLabel ? [{ label: model.priceLabel, channel: text(model.metadata?.supplierPriceChannel) }] : []);
  const safe = alternatives.flatMap(value => {
    const alternative = record(value), label = text(alternative?.label), channel = text(alternative?.channel);
    return label ? [{ label, channel }] : [];
  });
  const unique = [...new Map(safe.map(value => [JSON.stringify(value), value])).values()].slice(0, 10);
  delete merged.metadata.secureSkillCatalogPricing;
  delete merged.metadata.chuangxiangCatalogPricing;
  delete merged.metadata.tk1688Pricing;
  delete merged.metadata.weaiLegacyPricing;
  delete merged.metadata.sub2apiPlazaPricing;
  delete merged.metadata.officialCatalogPricing;
  return { ...merged, priceLabel: "价格存在冲突，待确认", metadata: { ...merged.metadata,
    supplierPriceConflict: true, supplierPriceAlternatives: unique } };
}

function mergeCatalogGroups(previous: DiscoveredSupplierGroup, incoming: DiscoveredSupplierGroup): DiscoveredSupplierGroup {
  const models = new Map(previous.models.map(model => [model.id, model]));
  for (const model of incoming.models) {
    const old = models.get(model.id);
    models.set(model.id, old ? mergeCatalogModel(old, model) : model);
  }
  return { ...incoming, ...previous,
    ...((previous.details || incoming.details) ? { details: previous.details ?? incoming.details } : {}), models: [...models.values()] };
}

/** Only the same site's numeric account ID can rename a numeric public group. */
function accountGroupNames(groups: DiscoveredSupplierGroup[], available: DiscoveredSupplierGroup[]): DiscoveredSupplierGroup[] {
  const accountIds = new Set(available.map(group => group.supplierGroupId).filter(Boolean));
  const merged = new Map(groups.map(group => [groupIdentity(group), group.supplierGroupId && !accountIds.has(group.supplierGroupId)
    ? { ...group, id: `public-group:${group.supplierGroupId}`,
      label: `${group.label.replace(/ \[分组ID \d+\]$/u, "")} [公开分组ID ${group.supplierGroupId}]`.slice(0, 256) } : group]));
  for (const account of available) {
    const key = groupIdentity(account);
    const named = [...merged.values()].find(group => !group.supplierGroupId && group.id === account.id);
    const identified = merged.get(key);
    const previous = identified && named && identified !== named ? mergeCatalogGroups(identified, named) : identified ?? named;
    if (!previous) { if (merged.size < 500) merged.set(key, account); continue; }
    if (named && groupIdentity(named) !== key) merged.delete(groupIdentity(named));
    if (groupIdentity(previous) !== key) merged.delete(groupIdentity(previous));
    merged.set(key, { ...previous, ...account, models: previous.models,
      ...((previous.details || account.details) ? { details: { ...previous.details, ...account.details,
        ...(account.details?.description ? { referencePrice: account.details.referencePrice,
          supportedResolutions: account.details.supportedResolutions, unsupportedResolutions: account.details.unsupportedResolutions,
          exclusiveResolutions: account.details.exclusiveResolutions } : {}),
      } as SupplierGroupDetails } : {}) });
  }
  return distinctGroupNames([...merged.values()]);
}

/** Credentials and query strings are never retained in supplier URLs. */
export function normalizeSupplierUrl(value: string): string {
  if (!value.trim()) return "";
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("地址必须使用 HTTP 或 HTTPS");
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "地址中不能包含账号、密码、查询参数或片段，请在站点登录栏填写账号密码",
    );
  return url.toString().replace(/\/+$/u, "");
}

/** Matches the CDR store: preserve gateway prefixes, remove only API version suffixes. */
export function normalizeSupplierSiteBase(value: string): string {
  return normalizeSupplierUrl(value).replace(/\/(?:v1|v1beta)$/iu, "");
}

export function supplierDirectoryBase(value: string): string {
  return normalizeSupplierSiteBase(
    value.replace(
      /\/(?:api\/pricing|api\/v1\/model-plaza|api\/v1\/groups\/available|api\/user\/self\/groups|api\/status|setup\/status|v1\/models|console\/token|dashboard|channel-plaza|model-plaza|model-market|marketplace|models|pricing|keys)\/?$/iu,
      "",
    ),
  );
}

/** Read only the group options used by the API-key page, never its key list. */
export function parseSupplierKeyGroups(
  payload: unknown,
  kind: "newapi" | "sub2api",
): DiscoveredSupplierGroup[] | null {
  const root = record(payload);
  if (
    root?.success === false ||
    (typeof root?.code === "number" && root.code !== 0 && root.code !== 200)
  )
    return null;
  const data: unknown = root?.data ?? payload;
  const groups = new Map<string, DiscoveredSupplierGroup>();
  const add = (id: string, label: string, raw: Record<string, unknown>) => {
    const details = parseSupplierGroupDetails(raw, "key-groups");
    const officialId = kind === "sub2api" ? supplierGroupId(raw.id) : undefined;
    const key = officialId ? `site-id:${officialId}` : `name:${id}`;
    if (id && groups.size < 500 && !groups.has(key))
      groups.set(key, { id, label: label || id, source: "catalog", models: [],
        ...(officialId ? { supplierGroupId: officialId } : {}), ...(details ? { details } : {}) });
  };
  if (kind === "sub2api") {
    const entries = Array.isArray(data) ? data : record(data)?.groups;
    if (!Array.isArray(entries)) return null;
    for (const entry of entries) {
      const group = record(entry);
      if (!group) continue;
      // Keep the same name-based identity as model-plaza and saved connections.
      const name = text(group.name);
      add(name, text(group.label) || name, group);
    }
    if (entries.length && !groups.size) return null;
  } else {
    if (!root || !("data" in root)) return null;
    const entries = record(data);
    if (!entries) return null;
    for (const [id, value] of Object.entries(entries)) {
      const group = record(value);
      if (group && ("desc" in group || "ratio" in group))
        add(text(id), text(group.desc) || text(id), { ...group, name: id });
    }
    if (Object.keys(entries).length && !groups.size) return null;
  }
  return distinctGroupNames([...groups.values()]);
}

function modelFrom(value: unknown): DiscoveredSupplierModel | undefined {
  const item = typeof value === "string" ? { id: value } : record(value);
  if (!item) return undefined;
  const id = text(item.id ?? item.model_name ?? item.model ?? item.name);
  if (!id) return undefined;
  const endpointTypes = [
    ...values(item.supported_endpoint_types),
    ...values(item.endpoints),
    ...values(item.endpointTypes),
    ...values(record(item.metadata)?.endpointTypes),
    text(item.protocol),
  ].filter(Boolean);
  const endpoints = endpointTypes.join(" ");
  const hint = `${id} ${text(item.type)} ${text(item.capability)} ${endpoints}`;
  const facts = parseProviderModelFacts(item, "supplier-catalog");
  // These are explicit output categories from the public directory. A tag such as
  // “视频理解” or a generic multimodal/chat endpoint is not a generation declaration.
  const taggedKinds = new Set(values(item.tags).flatMap(tag => tag === "图片模型" ? ["image"] : tag === "视频模型" ? ["video"] : tag === "语言模型" ? ["chat"] : []));
  const explicitCapability = text(item.capability ?? facts.metadata?.catalogCapability) || (taggedKinds.size === 1 ? [...taggedKinds][0]! : "");
  const scanned = scanProviderModelCatalog([{ ...item, id, metadata: { ...record(item.metadata),
    ...(endpointTypes.length ? { endpointTypes } : {}),
    ...(["image", "video", "music", "chat", "text", "audio", "other"].includes(explicitCapability) ? { catalogCapability: explicitCapability } : {}) } }]).models[0]!;
  const media = modelGenerationMediaKinds(scanned);
  const capability: DiscoveredSupplierModel["capability"] =
    media.includes("video") ? "video" : media.includes("image") ? "image" : media.includes("music") ? "music"
      : facts.outputKinds?.includes("text") || explicitCapability === "chat" ? "chat"
      : facts.outputKinds?.length || ["other", "audio"].includes(explicitCapability) ? "other"
        : /chat|responses|gpt|claude|gemini|grok|qwen|deepseek|llama|对话/iu.test(
              hint,
            )
          ? "chat"
          : "other";
  const endpointMedia = endpointGenerationMediaKinds(endpointTypes);
  const protocol: DiscoveredSupplierModel["protocol"] =
    capability === "image" && endpointMedia.includes("image") ? "openai-images"
      : capability === "video" && endpointMedia.includes("video") ? "openai-videos"
      : /gemini|generatecontent/iu.test(endpoints)
      ? "gemini"
      : /responses/iu.test(endpoints)
        ? "responses"
        : /chat/iu.test(endpoints)
          ? "chat-completions"
          : "unknown";
  const pricing = record(item.pricing);
  const priceLabel =
    catalogPriceLabel(item) ??
    text(
      item.price_label ??
        item.priceLabel ??
        pricing?.label ??
        (typeof item.price === "string" ? item.price : undefined),
    );
  return {
    id,
    name: text(item.display_name ?? item.name) || id,
    capability,
    protocol,
    ...facts,
    ...(media.length && !facts.outputKinds ? { outputKinds: scanned.outputKinds } : {}),
    metadata: { ...facts.metadata,
      ...(endpointTypes.length ? { endpointTypes: [...new Set(endpointTypes)] } : {}),
      ...(media.length && scanned.metadata?.operationsSource === "declared" ? { outputKindsSource: "declared" } : {}),
      ...(["image", "video", "music", "chat", "text", "audio", "other"].includes(explicitCapability) ? { catalogCapability: explicitCapability } : {}),
      ...(taggedKinds.size === 1 && !text(item.capability ?? facts.metadata?.catalogCapability) ? { catalogGenerationDeclarationSource: "official-category-tag" } : {}),
    },
    ...(priceLabel ? { priceLabel } : {}),
  };
}

/** Parse public New API pricing, Sub2API model plaza, and OpenAI model lists. */
export function parseSupplierCatalog(
  payload: unknown,
  priceDisplay: { currency?: string; multiplier?: number; supplierSiteUrl?: string; checkedAt?: string } = {},
): {
  groups: DiscoveredSupplierGroup[];
  kind: SupplierSiteKind;
  recognized: boolean;
} {
  const root = record(payload);
  const data = record(root?.data);
  const nestedGroups = root?.groups ?? data?.groups;
  const byGroup = new Map<string, DiscoveredSupplierGroup>();
  const add = (id: string, label: string, model?: DiscoveredSupplierModel, officialId?: string) => {
    const key = officialId ? `site-id:${officialId}` : `name:${id}`;
    if (!id || (byGroup.size >= 500 && !byGroup.has(key))) return;
    const group = byGroup.get(key) ?? {
      id,
      label: label || id,
      source: "catalog",
      models: [],
      ...(officialId ? { supplierGroupId: officialId } : {}),
    };
    if (
      model &&
      group.models.length < 3000 &&
      !group.models.some((item) => item.id === model.id)
    )
      group.models.push(model);
    byGroup.set(key, group);
  };
  if (Array.isArray(nestedGroups)) {
    for (const raw of nestedGroups) {
      const group = record(raw);
      if (!group) continue;
      const id = text(group.name ?? group.id);
      const label = text(group.label ?? group.description ?? group.name) || id;
      const officialId = supplierGroupId(group.id);
      add(id, label, undefined, officialId);
      const saved = byGroup.get(officialId ? `site-id:${officialId}` : `name:${id}`);
      const details = parseSupplierGroupDetails(group, "model-plaza");
      if (saved && details) saved.details = details;
      for (const rawModel of Array.isArray(group.models) ? group.models : []) {
        const model = modelFrom(rawModel);
        if (!model) continue;
        const current = isChuangxiangCatalogSource(priceDisplay.supplierSiteUrl) ? chuangxiangCatalogPricing(rawModel, priceDisplay.checkedAt) : undefined;
        if (isSub2apiPlazaPricingSource(priceDisplay.supplierSiteUrl)) {
          const plaza = sub2apiPlazaPricing(rawModel, group, { supplierSiteUrl: priceDisplay.supplierSiteUrl ?? "",
            ...(priceDisplay.checkedAt ? { checkedAt: priceDisplay.checkedAt } : {}) });
          add(id, label, { ...model, priceLabel: plaza?.priceLabel ?? "价格条件待确认", metadata: { ...model.metadata,
            ...(plaza ? { sub2apiPlazaPricing: plaza.pricing } : { sub2apiPlazaPricingIncomplete: true, priceUnavailableReason: "官方价格条件待确认" }) } }, officialId);
          continue;
        }
        const unresolvedChuangxiangToken = isChuangxiangCatalogSource(priceDisplay.supplierSiteUrl) && record(record(rawModel)?.pricing)?.billing_mode === "token" && !current;
        add(id, label, current ? { ...model, priceLabel: current.priceLabel,
          metadata: { ...model.metadata, chuangxiangCatalogPricing: current.pricing,
            chuangxiangEffectiveRateMultiplier: record(rawModel)?.effective_rate_multiplier,
            ...(current.resolutions ? { videoSupportedResolutions: current.resolutions } : {}) } } : unresolvedChuangxiangToken ? { ...model,
              priceLabel: "价格条件待确认", metadata: { ...model.metadata, chuangxiangCatalogPricingIncomplete: true, priceUnavailableReason: "官方价格条件待确认" } } : model, officialId);
      }
    }
    return { groups: distinctGroupNames([...byGroup.values()]), kind: "sub2api", recognized: true };
  }
  const ratios = record(root?.group_ratio ?? data?.group_ratio);
  const usable = record(root?.usable_group ?? data?.usable_group);
  const rawItems = Array.isArray(payload)
    ? payload
    : ([
        root?.data,
        root?.models,
        root?.items,
        data?.data,
        data?.models,
        data?.items,
      ].find((item) => Array.isArray(item) && item.length > 0) ??
      [
        root?.data,
        root?.models,
        root?.items,
        data?.data,
        data?.models,
        data?.items,
      ].find(Array.isArray));
  const entries = Array.isArray(rawItems) ? rawItems : [];
  const isNewApi = Boolean(
    ratios ||
    usable ||
    entries.some((item) => record(item)?.model_name !== undefined),
  );
  for (const id of Object.keys(usable ?? {}))
    add(text(id), text(usable?.[id]) || text(id));
  const allGroupModels: Array<{
    model: DiscoveredSupplierModel;
    raw: unknown;
  }> = [];
  const withGroupPrice = (
    model: DiscoveredSupplierModel,
    raw: unknown,
    id: string,
  ) => {
    if (isJijiuCatalogSource(priceDisplay.supplierSiteUrl) && (model.capability === "image" || model.capability === "video")) {
      const descriptor: ModelDescriptor = { id: model.id, name: model.name ?? model.id, operations: [], metadata: model.metadata ?? {},
        ...(model.outputKinds ? { outputKinds: model.outputKinds } : {}) };
      const documented = model.capability === "video" && isJijiuApiUrl(priceDisplay.supplierSiteUrl)
        ? jijiuVideoModel(model.id, descriptor, id)
        : model.capability === "image" ? applyJijiuImageCapabilities({ provider: "openai", config: { baseUrl: priceDisplay.supplierSiteUrl, modelGroup: id } }, descriptor) : undefined;
      const protocol = documented?.metadata?.protocol === "gemini-generate-content" ? "gemini" as const
        : documented?.metadata?.protocol === "openai-images" ? "openai-images" as const
          : documented?.metadata?.protocol === "openai-videos" ? "openai-videos" as const : model.protocol;
      const native = jijiuCatalogMediaPricing(raw, { supplierSiteUrl: priceDisplay.supplierSiteUrl, group: id,
        groupMultiplier: Number(ratios?.[id]), checkedAt: priceDisplay.checkedAt, kind: model.capability });
      return { ...model, ...(documented ? { ...(protocol ? { protocol } : {}), inputKinds: documented.inputKinds, outputKinds: documented.outputKinds, limits: documented.limits } : {}),
        priceLabel: native?.priceLabel ?? "价格条件待确认", metadata: { ...model.metadata, ...documented?.metadata,
          ...(native ? { officialCatalogPricing: native.pricing, jijiuCatalogPricingEvidence: native.evidence,
            officialCatalogPriceGroupVerified: typeof ratios?.[id] === "number" && Number.isFinite(ratios[id]) && Number(ratios[id]) >= 0 }
            : { jijiuCatalogPricingIncomplete: true, priceUnavailableReason: "官方价格条件或当前分组倍率待确认" }) } };
    }
    if (isCyberAfeiUnpricedCatalogVideo(priceDisplay.supplierSiteUrl, model.id)) {
      return { ...model, capability: "video" as const, protocol: "unknown" as const, outputKinds: ["video" as const],
        priceLabel: "价格条件待确认", metadata: { ...model.metadata, catalogCapability: "video", outputKindsSource: "declared",
          canvasRunnable: false, autoInterfaceStatus: "incomplete", canvasUnavailableReason: "视频调用协议待供应商文档确认",
          cyberAfeiCatalogPricingIncomplete: true, priceStatus: "unconfirmed", priceUnavailableReason: "官方价格条件待确认" } };
    }
    const miaowuKind = miaowuCatalogMediaKind(raw, priceDisplay.supplierSiteUrl);
    const nativeCurrency = miaowuKind ? text(record(record(record(raw)?.[miaowuKind === "image" ? "image_api" : "video_api"])?.pricing)?.currency) : undefined;
    const explicitCurrency = text(
      nativeCurrency || (record(record(raw)?.pricing)?.currency ??
        record(raw)?.currency ??
        root?.currency ??
        data?.currency),
    );
    const multiplier =
      Number(ratios?.[id] ?? 1) *
      (explicitCurrency ? 1 : (priceDisplay.multiplier ?? 1));
    const currency = text(
      root?.currency ?? data?.currency ?? priceDisplay.currency,
    );
    const nativeDisplayCurrency = explicitCurrency || currency;
    const jiasuKind = jiasuCatalogMediaKind(raw, priceDisplay.supplierSiteUrl);
    if (isJiasuCatalogSource(priceDisplay.supplierSiteUrl) && jiasuKind) {
      const supplierRecord = jiasuCatalogRecord(raw);
      const native = jiasuCatalogMediaPricing(raw, { supplierSiteUrl: priceDisplay.supplierSiteUrl, group: id,
        groupMultiplier: Number(ratios?.[id] ?? 1), currency: nativeDisplayCurrency,
        currencyMultiplier: explicitCurrency ? 1 : priceDisplay.multiplier ?? 1, checkedAt: priceDisplay.checkedAt });
      return { ...model, capability: jiasuKind, protocol: jiasuKind === "image" ? "openai-images" as const : "openai-videos" as const,
        outputKinds: [jiasuKind], priceLabel: native?.priceLabel ?? "价格条件待确认",
        metadata: { ...model.metadata, catalogCapability: jiasuKind, outputKindsSource: "declared", catalogGenerationDeclarationSource: "official-endpoint-map",
          jiasuCatalogRecord: { ...supplierRecord, ...(native?.pricing.billingUnit ? { billingUnit: native.pricing.billingUnit } : {}) },
          jiasuApiParameters: supplierRecord.apiParameters, jiasuCatalogDescription: supplierRecord.description, jiasuCatalogCheckedAt: priceDisplay.checkedAt ?? "",
          ...(native ? { officialCatalogPricing: native.pricing, jiasuCatalogPricingEvidence: native.evidence,
            officialCatalogPriceGroupVerified: typeof ratios?.[id] === "number" && Number.isFinite(ratios[id]) && Number(ratios[id]) >= 0 }
            : { jiasuCatalogPricingIncomplete: true, priceUnavailableReason: "官方视频用量/条件费率未完整公布" }) } };
    }
    const miaowuNative = isMiaowuCatalogSource(priceDisplay.supplierSiteUrl) && (record(record(raw)?.image_api) || record(record(raw)?.video_api));
    if (miaowuNative) {
      const native = miaowuCatalogMediaPricing(raw, { ...(priceDisplay.supplierSiteUrl ? { supplierSiteUrl: priceDisplay.supplierSiteUrl } : {}),
        multiplier, ...(nativeDisplayCurrency ? { currency: nativeDisplayCurrency } : {}), ...(priceDisplay.checkedAt ? { checkedAt: priceDisplay.checkedAt } : {}) });
      return { ...model, ...(miaowuKind ? { capability: miaowuKind, protocol: miaowuKind === "image" ? "openai-images" as const : "openai-videos" as const,
        outputKinds: [miaowuKind] } : {}), priceLabel: native?.priceLabel ?? "价格条件待确认",
        metadata: { ...model.metadata, ...(miaowuKind ? { catalogCapability: miaowuKind, outputKindsSource: "declared" } : {}),
          ...(native ? { miaowuCatalogPricing: native.pricing } : { miaowuCatalogPricingIncomplete: true, priceUnavailableReason: "官方价格条件待确认" }) } };
    }
    const scoped = scopedCatalogMediaPricing(raw, { supplierSiteUrl: priceDisplay.supplierSiteUrl, group: id, multiplier,
      currency: explicitCurrency || currency, checkedAt: priceDisplay.checkedAt });
    if (scoped) return { ...model, priceLabel: scoped.priceLabel, metadata: { ...model.metadata, officialCatalogPricing: scoped.pricing,
      officialCatalogPriceGroupVerified: typeof ratios?.[id] === "number" && Number.isFinite(ratios[id]) && Number(ratios[id]) >= 0 } };
    const priceLabel = catalogPriceLabel(raw, {
      newApi: isNewApi,
      multiplier,
      ...(currency ? { currency } : {}),
    });
    return priceLabel ? { ...model, priceLabel } : model;
  };
  for (const raw of entries) {
    const item = record(raw);
    const model = modelFrom(raw);
    if (!model) continue;
    const enabled = values(item?.enable_groups);
    const memberships = enabled.length
      ? enabled
      : values(
          item?.enable_group ??
            item?.groups ??
            item?.group ??
            item?.model_group ??
            item?.modelGroup ??
            item?.category ??
            item?.channel,
        );
    if (memberships.includes("all")) allGroupModels.push({ model, raw });
    for (const id of memberships.length
      ? memberships.filter((group) => group !== "all")
      : isNewApi
        ? []
        : ["默认群组"])
      add(id, text(usable?.[id]) || id, withGroupPrice(model, raw, id));
  }
  for (const { model, raw } of allGroupModels)
    for (const group of byGroup.values())
      add(group.id, group.label, withGroupPrice(model, raw, group.id));
  return {
    groups: [...byGroup.values()],
    kind: isNewApi ? "newapi" : "openai-compatible",
    recognized: Array.isArray(rawItems) || isNewApi,
  };
}

export function supplierModelUrls(apiUrl: string): string[] {
  const base = normalizeSupplierUrl(apiUrl).replace(/\/(?:v1\/)?models$/u, "");
  if (!base) return [];
  const url = new URL(base);
  const pathname = url.pathname.replace(/\/+$/u, "");
  return [
    ...new Set(
      /\/v1$/u.test(pathname)
        ? [`${base}/models`]
        : [`${base}/v1/models`, `${base}/models`],
    ),
  ];
}

/** The separate model-price page groups models under channels and platforms. */
export function parseSupplierPricingChannels(payload: unknown, currency?: string,
  source: { supplierSiteUrl?: string; checkedAt?: string } = {}): DiscoveredSupplierGroup[] {
  const root = record(payload);
  if (root?.success === false || (typeof root?.code === "number" && ![0, 200].includes(root.code))) return [];
  const channels = Array.isArray(root?.data) ? root.data : record(root?.data)?.channels;
  if (!Array.isArray(channels)) return [];
  const groups = new Map<string, DiscoveredSupplierGroup>();
  for (const value of channels.slice(0, 500)) {
    const channel = record(value);
    if (!channel || !Array.isArray(channel.platforms)) continue;
    for (const value of channel.platforms) {
      const platform = record(value);
      if (!platform || !Array.isArray(platform.groups) || !Array.isArray(platform.supported_models)) continue;
      for (const value of platform.groups) {
        const rawGroup = record(value);
        const id = text(rawGroup?.name);
        if (!rawGroup || !id) continue;
        const officialId = supplierGroupId(rawGroup.id);
        const key = officialId ? `site-id:${officialId}` : `name:${id}`;
        const group = groups.get(key) ?? { id, label: id, source: "catalog" as const, models: [],
          ...(officialId ? { supplierGroupId: officialId } : {}) };
        const details = parseSupplierGroupDetails(rawGroup, "model-plaza");
        if (details) group.details = details;
        const multiplier = typeof rawGroup.rate_multiplier === "number" ? rawGroup.rate_multiplier : 1;
        for (const raw of platform.supported_models.slice(0, 3000)) {
          const row = record(raw);
          let model = modelFrom(row);
          if (!row || !model) continue;
          if (secureSkillCatalogVideoDeclaration(model.id, platform.platform, source.supplierSiteUrl) &&
            (!model.metadata?.catalogCapability || model.metadata.catalogCapability === "video") &&
            (!model.outputKinds?.length || model.metadata?.outputKindsSource === "inferred")) {
            model = { ...model, capability: "video", outputKinds: ["video"], metadata: { ...model.metadata,
              catalogCapability: "video", outputKindsSource: "declared", catalogGenerationDeclarationSource: "official-price-page",
              canvasRunnable: false, canvasUnavailableReason: "官网已列出视频型号 · 调用协议待确认" } };
          }
          const pricing = record(row.pricing);
          const intervals = Array.isArray(pricing?.intervals) ? pricing.intervals.map(record).filter(item => item && typeof item.per_request_price === "number") : [];
          const secure = secureSkillCatalogPricing(row, { supplierSiteUrl: source.supplierSiteUrl ?? "", multiplier, group: rawGroup,
            ...(source.checkedAt ? { checkedAt: source.checkedAt } : {}) });
          const priceLabel = secure?.priceLabel ?? (intervals.length
            ? intervals.map(tier => `${text(tier!.tier_label)} ${catalogPriceLabel({ pricing: { ...pricing, per_request_price: tier!.per_request_price } }, { ...(currency ? { currency } : {}), multiplier }) ?? ""}`).join(" · ")
            : catalogPriceLabel(row, { ...(currency ? { currency } : {}), multiplier }));
          const incoming = { ...model, ...(priceLabel ? { priceLabel } : {}), metadata: { ...model.metadata,
            supplierChannelDescription: typeof channel.description === "string" ? channel.description.slice(0, 8000) : "",
            priceSource: "supplier-price-page",
            supplierPriceChannel: text(channel.name),
            ...(secure ? { secureSkillCatalogPricing: secure.pricing } : {}),
          } };
          const index = group.models.findIndex(item => item.id === model.id);
          if (index < 0) group.models.push(incoming);
          else group.models[index] = mergeCatalogModel(group.models[index]!, incoming);
        }
        groups.set(key, group);
      }
    }
  }
  return distinctGroupNames([...groups.values()]);
}

export async function discoverSupplierCatalog(
  input: {
    siteUrl: string;
    apiUrl: string;
    kind?: SupplierSiteKind;
    token?: string;
    signal?: AbortSignal;
  },
  fetchImpl: FetchImplementation = providerFetch,
): Promise<SupplierCatalogDiscovery> {
  const checkedAt = new Date().toISOString();
  let kind = input.kind ?? "auto";
  const siteUrl = supplierDirectoryBase(input.siteUrl || input.apiUrl);
  if (!siteUrl)
    return {
      groups: [],
      kind,
      status: "failed",
      checkedAt,
      error: "请先填写官网、目录地址或 API 地址",
    };
  const probe = async (
    url: string,
    headers?: Record<string, string>,
  ): Promise<{ status: number; payload?: unknown }> => {
    try {
      const payload = await fetchProviderJson(
        fetchImpl,
        url,
        { method: "GET", cache: "no-store", ...(headers ? { headers } : {}) },
        {
          phase: "connect",
          timeoutMs: 8000,
          maxResponseBytes: 4 * 1024 * 1024,
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
      return { status: 200, payload };
    } catch (error) {
      return {
        status:
          error instanceof ProviderHttpError ? (error.details.status ?? 0) : 0,
      };
    }
  };
  const success = (
    parsed: ReturnType<typeof parseSupplierCatalog>,
    detected: SupplierSiteKind,
  ): SupplierCatalogDiscovery => ({
    groups: parsed.groups,
    kind: detected,
    status: parsed.groups.length ? "live" : "empty",
    checkedAt,
  });
  const unavailable = (
    message: string,
    unauthorized = false,
  ): SupplierCatalogDiscovery => ({
    groups: [],
    kind,
    status: unauthorized ? "unauthorized" : "failed",
    checkedAt,
    error: message,
  });
  const siteHeaders = (
    platform: "newapi" | "sub2api",
  ): Record<string, string> | undefined => {
    if (!input.token?.trim() || !input.siteUrl) return undefined;
    const token = input.token.trim();
    const split = token.lastIndexOf(":");
    const userId =
      platform === "newapi" &&
      split > 0 &&
      /^\d+$/u.test(token.slice(split + 1))
        ? token.slice(split + 1)
        : undefined;
    return {
      authorization: `Bearer ${userId ? token.slice(0, split) : token}`,
      ...(userId ? { "New-Api-User": userId } : {}),
    };
  };
  const keyGroups = async (
    platform: "newapi" | "sub2api",
  ): Promise<SupplierCatalogDiscovery | undefined> => {
    const path =
      platform === "sub2api"
        ? "/api/v1/groups/available"
        : "/api/user/self/groups";
    const result = await probe(`${siteUrl}${path}`, siteHeaders(platform));
    const groups =
      result.status === 200
        ? parseSupplierKeyGroups(result.payload, platform)
        : null;
    if (groups)
      return {
        groups,
        kind: platform,
        status: groups.length ? "live" : "empty",
        checkedAt,
      };
    if ([401, 403].includes(result.status))
      return {
        groups: [],
        kind: platform,
        status: "unauthorized",
        checkedAt,
        error:
          "模型广场未提供分组，API 密钥页面的分组列表需要登录；请填写站点账号密码后重新扫描",
      };
    return undefined;
  };
  let synoraLedger: Promise<SupplierLedgerPrice[]> | undefined;
  const ledgerGroups = async (groups: DiscoveredSupplierGroup[]): Promise<DiscoveredSupplierGroup[]> => {
    if (!isSynoraLedgerSource(siteUrl)) return groups;
    const headers = siteHeaders("sub2api");
    synoraLedger ??= readSynoraLedgerPrices(siteUrl, fetchImpl, { checkedAt, ...(headers ? { headers } : {}),
      ...(input.signal ? { signal: input.signal } : {}) });
    const samples = await synoraLedger;
    return groups.map(group => {
      const ledgerPrices = samples.filter(sample => sample.supplierGroupId === group.supplierGroupId);
      if (!ledgerPrices.length) return group;
      return { ...group, details: { ...(group.details ?? { source: "key-groups" as const }), ledgerPrices },
        models: group.models.map(model => {
          const sample = ledgerPrices.filter(value => value.modelId === model.id)
            .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
          return sample ? { ...model, metadata: { ...model.metadata, supplierLedgerPrice: sample } } : model;
        }) };
    });
  };
  const pricePage = async (groups: DiscoveredSupplierGroup[]) => {
    if (isHangCatalogSource(siteUrl)) {
      // This host is linked by the supplier's own pricing page. Never pass
      // account headers/cookies to the independent public price service.
      const response = await probe(HANG_PRICE_URL);
      const parsed = parseHangChatPrices(response.payload, siteUrl, checkedAt);
      const merged = new Map(groups.map(group => [group.id, { ...group, models: [...group.models] }]));
      for (const row of parsed.rows) {
        const model = modelFrom({ name: row.modelId, capability: "chat", output_modalities: ["text"] });
        if (!model || model.capability !== "chat") continue;
        const group = merged.get(row.group) ?? { id: row.group, label: row.group, source: "catalog" as const, models: [] };
        const priced = { ...model, priceLabel: row.priceLabel, metadata: { ...model.metadata,
          hangCatalogPricing: row.pricing, supplierPriceGroup: row.group, priceSource: "supplier-hang-price-page" } };
        const index = group.models.findIndex(model => model.id === row.modelId);
        if (index < 0) group.models.push(priced); else group.models[index] = { ...group.models[index]!, ...priced };
        merged.set(row.group, group);
      }
      return { groups: distinctGroupNames([...merged.values()]), complete: response.status === 200 && parsed.complete };
    }
    const response = await probe(`${siteUrl}/api/v1/pricing/channels`, siteHeaders("sub2api"));
    const payload = record(response.payload);
    const channels = Array.isArray(payload?.data) ? payload.data : record(payload?.data)?.channels;
    // A missing/blocked page cannot establish an empty price catalogue. Only
    // the real channel envelope (including a genuinely empty array) can do so.
    const complete = response.status === 200 && !!payload && payload.success !== false && !payload.error &&
      !(typeof payload.code === "number" && ![0, 200].includes(payload.code)) && Array.isArray(channels) &&
      channels.every(value => {
        const channel = record(value);
        return !!channel && Array.isArray(channel.platforms) && channel.platforms.every(value => {
          const platform = record(value);
          return !!platform && Array.isArray(platform.groups) && Array.isArray(platform.supported_models);
        });
      });
    // Secure Skill's current price page explicitly displays CNY (see the
    // 2026-09-23 price/usage audit); this is a currency convention, not a price.
    const currency = new URL(siteUrl).hostname === "token.secure-skill.com" ? "CNY" : undefined;
    const prices = complete ? parseSupplierPricingChannels(response.payload, currency, { supplierSiteUrl: siteUrl, checkedAt }) : [];
    const merged = new Map(groups.map(group => [groupIdentity(group), group]));
    for (const price of prices) {
      const key = groupIdentity(price);
      const previous = merged.get(key);
      if (!previous) { merged.set(key, price); continue; }
      merged.set(key, mergeCatalogGroups(previous, price));
    }
    return { groups: distinctGroupNames([...merged.values()]), complete };
  };
  const fallbackGroups = async (
    platform: "newapi" | "sub2api",
    fallback: SupplierCatalogDiscovery,
  ) => {
    const available = await keyGroups(platform);
    const result = available ?? fallback;
    if (platform === "newapi") {
      // Account-selectable groups do not prove that the price/model feed was
      // read. Keep them usable while preventing a failed feed from erasing
      // previously known prices as if it were a confirmed empty directory.
      const priceComplete = (fallback.status === "live" || fallback.status === "empty") && fallback.complete !== false;
      const accountComplete = available?.status === "live" || available?.status === "empty";
      return { ...result, complete: priceComplete && accountComplete,
        ...(!priceComplete && accountComplete ? {
          error: "账号分组已读取，但模型价格目录暂不可完整读取；保留历史报价，请稍后重试",
        } : {}) };
    }
    const priced = await pricePage(result.groups);
    const accountComplete = available?.status === "live" || available?.status === "empty";
    if (!priced.complete && isWeAiLegacyCatalogSource(siteUrl)) {
      const legacy = await readWeAiLegacyCatalog(siteUrl, fetchImpl, siteHeaders("sub2api"), input.signal);
      const merged = new Map(priced.groups.map(group => [groupIdentity(group), group]));
      for (const evidence of legacy.groups) {
        const group: DiscoveredSupplierGroup = { id: evidence.group.name, label: evidence.group.name,
          supplierGroupId: String(evidence.group.id), source: "catalog", models: evidence.models.flatMap(row => {
            const model = modelFrom({ name: row.id });
            return model ? [{ ...model, priceLabel: row.priceLabel ?? "价格条件待确认", metadata: {
              ...model.metadata, priceSource: "supplier-weai-legacy-price-page",
              ...(row.pricing ? { weaiLegacyPricing: row.pricing } : { weaiLegacyPricingIncomplete: true, priceUnavailableReason: "官方价格条件待确认" }),
              weaiLegacyPriceUnitNote: WEAI_LEGACY_PRICE_UNIT_NOTE,
              weaiLegacyPriceEvidence: { groupId: evidence.group.id, platform: row.platform,
                tokenMultiplier: evidence.tokenMultiplier, imageMultiplier: evidence.imageMultiplier,
                imageQualityBilling: evidence.imageQualityBilling, pricesAlreadyAdjusted: true,
                configuredPriceFields: row.configuredPriceFields, unconfiguredPriceFields: row.unconfiguredPriceFields,
                ...(row.imageTierPricesComplete !== undefined ? { imageTierPricesComplete: row.imageTierPricesComplete } : {}) },
            } }] : [];
          }) };
        const old = merged.get(groupIdentity(group));
        // The legacy sample is current pricing evidence for this exact group.
        // Keep unrelated prior model facts, but do not conflict with an empty
        // placeholder or turn its option list into shared model membership.
        merged.set(groupIdentity(group), old ? { ...old, ...group } : group);
      }
      const legacyIds = new Set(legacy.availableGroups.map(group => String(group.id)));
      const accountCovered = accountComplete && available.groups.every(group =>
        group.supplierGroupId !== undefined && legacyIds.has(group.supplierGroupId));
      const groups = accountComplete ? accountGroupNames([...merged.values()], available.groups) : distinctGroupNames([...merged.values()]);
      const complete = legacy.complete && accountCovered;
      return { kind: "sub2api" as const, groups, checkedAt: legacy.checkedAt,
        status: groups.length ? "live" as const : legacy.status, complete,
        ...(!complete ? {
          error: legacy.status === "unauthorized" ? "We-AI 历史模型价格页需要网站登录；保留历史报价" :
            legacy.failedGroups.length ? `We-AI 部分分组价格读取失败（ID ${legacy.failedGroups.map(group => group.groupId).join("、")}）；保留未完成分组的历史报价` :
              "We-AI 模型价格目录暂不可完整读取；保留历史报价，请稍后重试",
        } : {}) };
    }
    const priceComplete = priced.complete ||
      ((fallback.status === "live" || fallback.status === "empty") && fallback.complete !== false);
    const groups = await ledgerGroups(accountComplete ? accountGroupNames(priced.groups, available.groups) : priced.groups);
    return { ...result, groups, ...(groups.length ? { status: "live" as const } : {}),
      complete: priceComplete && accountComplete,
      ...(!priceComplete && accountComplete ? {
        error: "账号分组已读取，但模型价格目录暂不可完整读取；保留历史报价，请稍后重试",
      } : {}) };
  };
  const supplementGroups = async (parsed: ReturnType<typeof parseSupplierCatalog>, platform: "newapi" | "sub2api",
    currentPrice?: { payload: unknown; options: Parameters<typeof parseSupplierCatalog>[1] }) => {
    if (platform === "sub2api") parsed = { ...parsed, groups: (await pricePage(parsed.groups)).groups };
    const available = await keyGroups(platform);
    if (available?.status === "live" || available?.status === "empty") {
      if (platform === "newapi" && siteUrl === "https://platform.frimodel.com" && currentPrice) {
        const payload = record(currentPrice.payload);
        const ratios = { ...record(payload?.group_ratio) };
        for (const group of available.groups) {
          const rate = group.details?.rateMultiplier;
          if (typeof rate === "number" && Number.isFinite(rate) && rate >= 0) ratios[group.id] = rate;
        }
        // Fri's authenticated key-group rates are the current account price
        // factors when /api/pricing omits group_ratio. Join only exact groups.
        parsed = parseSupplierCatalog({ ...payload, group_ratio: ratios }, currentPrice.options);
      }
      return success({ ...parsed, groups: await ledgerGroups(accountGroupNames(parsed.groups, available.groups)) }, platform);
    }
    return { ...success({ ...parsed, groups: await ledgerGroups(parsed.groups) }, platform), complete: false,
      error: "模型目录已读取；账号分组说明暂不可用，保留历史分组，请稍后重试或检查站点登录" };
  };

  // This NewAPI fork publishes its merchant contracts in /market, rather than
  // /api/pricing. Read the same retail-price/description feed as its own UI.
  if (isTk1688CatalogSource(siteUrl, input.apiUrl)) {
    const [market, status, available, account] = await Promise.all([
      probe(TK1688_MARKETPLACE_URL), probe(`${siteUrl}/api/status`), keyGroups("newapi"),
      probe(`${siteUrl}/api/user/models`, siteHeaders("newapi")),
    ]);
    const accountIds = parseTk1688AccountModelIds(account.payload);
    const parsed = parseTk1688Marketplace(market.payload, status.payload, { checkedAt,
      ...(accountIds ? { accountModelIds: accountIds } : {}) });
    if (market.status !== 200 || !parsed.complete)
      return { groups: [], kind: "newapi", status: "failed", checkedAt, complete: false,
        error: "词元模型广场暂不可完整读取，保留历史目录，请稍后刷新" };
    const models: DiscoveredSupplierModel[] = parsed.models.map(model => ({
      id: model.id, name: model.name, capability: modelGenerationMediaKinds(model)[0] ?? (model.outputKinds?.includes("text") ? "chat" : "other"),
      protocol: modelGenerationMediaKinds(model).includes("image") ? "openai-images" : modelGenerationMediaKinds(model).includes("video") ? "openai-videos" : modelGenerationMediaKinds(model).includes("music") ? "unknown" : "chat-completions",
      ...(model.inputKinds ? { inputKinds: model.inputKinds } : {}), ...(model.outputKinds ? { outputKinds: model.outputKinds } : {}),
      ...(model.limits ? { limits: model.limits } : {}),
      ...(typeof model.metadata?.priceLabel === "string" ? { priceLabel: model.metadata.priceLabel } : {}),
      metadata: { ...model.metadata, tk1688Parameters: model.parameters, tk1688Pricing: model.pricing },
    }));
    const groups = (available?.groups.length ? available.groups : [{ id: "default", label: "默认分组", source: "catalog" as const, models: [] }])
      .map(group => ({ ...group, models }));
    return { groups, kind: "newapi", status: models.length ? "live" : "empty", checkedAt,
      complete: parsed.complete && accountIds !== undefined && available?.complete !== false && available?.status === "live",
      ...(accountIds === undefined ? { error: "公开模型广场已读取；账号渠道权限暂不可读，公开商品不代表当前 Key 可用" } : {}) };
  }

  // CDR probe order is significant: a recognized (including login-gated) platform stops inference.
  if (kind === "auto" || kind === "newapi") {
    const pricingUrl = `${siteUrl}/api/pricing`;
    let pricing = await probe(pricingUrl);
    if ([401, 403].includes(pricing.status) && siteHeaders("newapi"))
      pricing = await probe(pricingUrl, siteHeaders("newapi"));
    const payload = record(pricing.payload);
    const parsed = parseSupplierCatalog(pricing.payload, { supplierSiteUrl: siteUrl, checkedAt });
    if (
      pricing.status === 200 &&
      payload &&
      "data" in payload &&
      payload.success !== false &&
      !payload.error &&
      !(typeof payload.code === "number" && ![0, 200].includes(payload.code)) &&
      parsed.recognized
    ) {
      if (parsed.groups.length) {
        // New API can display its USD accounting prices in a configured local currency.
        const rows = Array.isArray(payload.data) ? payload.data : [];
        if (
          rows.some((row) => {
            const r = record(row);
            return (
              r &&
              (typeof r.model_price === "number" ||
                typeof r.model_ratio === "number")
            );
          })
        ) {
          const status = await probe(`${siteUrl}/api/status`);
          const settings = record(record(status.payload)?.data);
          const display = text(settings?.quota_display_type);
          const customSymbol = text(settings?.custom_currency_symbol);
          const currency = display === "CUSTOM" && ["￥", "¥", "CNY", "RMB"].includes(customSymbol ?? "") ? "CNY" : display;
          const exchange = Number(display === "CUSTOM" ? settings?.custom_currency_exchange_rate : settings?.usd_exchange_rate);
          if (currency === "CNY" && Number.isFinite(exchange) && exchange > 0)
            return supplementGroups(
              parseSupplierCatalog(pricing.payload, {
                currency,
                multiplier: exchange,
                supplierSiteUrl: siteUrl,
                checkedAt,
              }),
              "newapi",
              { payload: pricing.payload, options: { currency, multiplier: exchange, supplierSiteUrl: siteUrl, checkedAt } },
            );
        }
        return supplementGroups(parsed, "newapi", { payload: pricing.payload, options: { supplierSiteUrl: siteUrl, checkedAt } });
      }
      return fallbackGroups("newapi", success(parsed, "newapi"));
    }
    if (pricing.status === 401 || pricing.status === 403) {
      kind = "newapi";
      return fallbackGroups(
        "newapi",
        unavailable(
          "模型广场与 API 密钥分组列表暂不可用；可填写站点账号密码重试，或手动添加分组",
          true,
        ),
      );
    }
  }
  if (kind === "auto" || kind === "sub2api") {
    let plaza = await probe(`${siteUrl}/api/v1/model-plaza`);
    if ([401, 403].includes(plaza.status) && input.token && input.siteUrl)
      plaza = await probe(`${siteUrl}/api/v1/model-plaza`, {
        authorization: `Bearer ${input.token.trim()}`,
      });
    const data = record(record(plaza.payload)?.data);
    if (plaza.status === 200 && data && Array.isArray(data.groups)) {
      const parsed = parseSupplierCatalog(plaza.payload, { supplierSiteUrl: siteUrl, checkedAt });
      if (parsed.groups.length) {
        // Model plaza can publish prices for only a subset of an account's
        // groups. Always include the API-key page's selectable groups too.
        return supplementGroups(parsed, "sub2api");
      }
      return fallbackGroups("sub2api", success(parsed, "sub2api"));
    }
    if (plaza.status === 401 || plaza.status === 403) {
      kind = "sub2api";
      return fallbackGroups(
        "sub2api",
        unavailable(
          "模型广场与 API 密钥分组列表需要登录，请填写站点账号密码后重新扫描",
          true,
        ),
      );
    }
  }
  if (kind === "auto") {
    const status = await probe(`${siteUrl}/api/status`);
    const data = record(record(status.payload)?.data);
    if (
      status.status === 200 &&
      data &&
      ["system_name", "HeaderNavModules", "version", "quota_per_unit"].some(
        (key) => key in data,
      )
    ) {
      kind = "newapi";
      return fallbackGroups(
        "newapi",
        unavailable(
          "已识别 NewAPI，但模型广场与 API 密钥分组列表均不可用；请填写站点账号密码重试或手动添加分组",
        ),
      );
    }
    const setup = await probe(`${siteUrl}/setup/status`);
    const payload = record(setup.payload);
    const setupData = record(payload?.data);
    if (
      setup.status === 200 &&
      payload &&
      "code" in payload &&
      setupData &&
      "needs_setup" in setupData
    ) {
      kind = "sub2api";
      return fallbackGroups(
        "sub2api",
        unavailable(
          "已识别 Sub2API，但模型广场与 API 密钥分组列表均不可用；请填写站点账号密码重试或手动添加分组",
        ),
      );
    }
  }
  if (kind === "newapi" || kind === "sub2api") {
    return fallbackGroups(
      kind,
      unavailable(
        "模型广场与 API 密钥分组列表均未返回可用分组，可手动添加分组并配置 Key",
      ),
    );
  }
  if (kind === "auto") {
    let gated: SupplierCatalogDiscovery | undefined;
    for (const platform of ["newapi", "sub2api"] as const) {
      const result = await keyGroups(platform);
      if (result?.status === "live" || result?.status === "empty")
        return result;
      gated ??= result;
    }
    if (gated) return gated;
  }
  if (kind === "auto" || kind === "openai-compatible") {
    kind = "openai-compatible";
    // Public model lists may aid generic discovery. The site login token is NEVER an API key.
    for (const url of supplierModelUrls(input.apiUrl || siteUrl)) {
      const models = await probe(url);
      const parsed = parseSupplierCatalog(models.payload);
      if (models.status === 200 && parsed.recognized)
        return success(parsed, kind);
      if (models.status === 401 || models.status === 403) break;
    }
  }
  return unavailable(
    "未读取到分组或模型目录，可以手动添加分组并配置 Key 后扫描模型",
  );
}

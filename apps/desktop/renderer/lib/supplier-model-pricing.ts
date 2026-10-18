import { pricingFromSupplierEvidence } from "./supplier-price-evidence";
import { catalogScopedMap } from "./catalog-scope-cache";
import {
  discoverSupplierCatalog,
  applySupplierModelAvailability,
  normalizeSupplierSiteBase,
  supplierDirectoryBase,
  providerFetch,
  SupplierLoginError,
  type ModelDescriptor,
  type SupplierCatalogDiscovery,
  parseProviderModelFacts,
  isJiasuApiUrl,
  latestJiasuVideoApiExampleContract,
  chuangxiangRejectedRequestFeeNotice,
} from "@super-canvas/providers";
import { isCyberAfeiUnpricedCatalogVideo } from "@super-canvas/providers/cyberafei-catalog-evidence";
import { modelGenerationMediaKinds } from "@super-canvas/providers/model-media";
import { remainingVideoModel } from "@super-canvas/providers/remaining-video-contracts";
import { parseSupplierGroupDetails, supplierGroupModelPriceDetails, supplierGroupMediaPriceDetails, supplierGroupPriceLabel, supplierGroupResolutionLabel, supplierTextMentionsModel } from "@super-canvas/providers/supplier-group-details";
import { getSupplierRecord } from "./supplier-service";
import { openSupplierSiteSession, supplierSiteLoginCacheIdentity } from "./supplier-site-session";
import { repository } from "./server";
import type { SupplierRecord } from "@super-canvas/db";
import { readSupplierDocument } from "./supplier-document";
import { applyTk1688CatalogModel } from "./tk1688-catalog";

type Connection = { config: Readonly<Record<string, unknown>> };
const unknownPrice =
  /价格以(?:平台|模型广场)为准|价格未公布|价格查询失败|价格需登录查询|价格未查询|价格目录未完整读取|暂未取得报价|价格未知|价格未确定|价格条件待确认/u;
type CatalogCacheEntry = { until: number; result: Promise<SupplierCatalogDiscovery> };
// These lookups enrich an existing inventory without adding/removing model IDs.
// Automatic publication separately requires complete supplier and Key lists.
const cache = catalogScopedMap<
  string,
  CatalogCacheEntry
>("supplier-pricing", "auxiliary");
const refreshCache = catalogScopedMap<string, CatalogCacheEntry>("supplier-pricing-refresh", "auxiliary");
export interface JiasuSupplierExampleContext {
  supplierId: string;
  sourceId: string;
  refreshId: string;
  catalog: SupplierCatalogDiscovery;
}
export interface SupplierPriceReadOptions {
  refreshId?: string;
  jiasuApiExampleContext?: JiasuSupplierExampleContext;
  /** Assistant cache reads must not invoke the legacy supplier migration. */
  savedSupplier?: SupplierRecord | null;
}
const hasOwnPrice = (model: ModelDescriptor) =>
  !["supplier-catalog", "supplier-group", "generated-result", "supplier-document"].includes(String(model.metadata?.priceSource)) &&
  (Boolean(model.pricing) ||
    (typeof model.metadata?.priceLabel === "string" &&
      !unknownPrice.test(model.metadata.priceLabel)));

/** These catalog parsers already resolved currency, units, conditions and group multipliers. */
function structuredCatalogPrice(metadata: ModelDescriptor["metadata"]): ModelDescriptor["pricing"] {
  return (metadata?.secureSkillCatalogPricing ?? metadata?.chuangxiangCatalogPricing ?? metadata?.tk1688Pricing ??
    metadata?.weaiLegacyPricing ?? metadata?.sub2apiPlazaPricing ?? metadata?.miaowuCatalogPricing ?? metadata?.hangCatalogPricing ?? metadata?.officialCatalogPricing) as ModelDescriptor["pricing"];
}

type KeyGroupRenameEvidence = {
  sourceId: string; accountKeyId: string; from: string; to: string;
  checkedAt: string; apiOrigin: string; proof: string;
};
type CatalogPriceOptions = {
  savedCatalog?: boolean; supplierGroupId?: string; sourceId?: string; accountKeyId?: string;
  keyGroupRenameEvidence?: KeyGroupRenameEvidence;
};
function provenJijiuPriceGroup(group: string, catalog: SupplierCatalogDiscovery, sourceUrl: string | undefined, options: CatalogPriceOptions): string | undefined {
  const e = options.keyGroupRenameEvidence;
  if (group !== "视频SD.2.5" || !e || e.from !== group || e.to !== "视频SD2.5" ||
    !e.sourceId || e.sourceId !== options.sourceId || !e.accountKeyId || e.accountKeyId !== options.accountKeyId ||
    e.apiOrigin !== "https://newapi.jijiucanvas.com" || e.proof !== "same-key-account-inventory" ||
    !Number.isFinite(Date.parse(e.checkedAt)) || catalog.status !== "live" || catalog.complete !== true || options.supplierGroupId) return undefined;
  try {
    const url = new URL(sourceUrl ?? "");
    if (url.origin !== e.apiOrigin || url.username || url.password || url.search || url.hash || !/^(?:\/v1)?\/?$/u.test(url.pathname)) return undefined;
  } catch { return undefined; }
  const candidates = catalog.groups.filter(g => g.id === e.to && !g.supplierGroupId && g.source === "catalog" && g.details?.stale !== true);
  return candidates.length === 1 ? e.to : undefined;
}

function friSnapshotPriceLabel(model: ModelDescriptor, group: string, catalog: SupplierCatalogDiscovery, sourceUrl: string | undefined): string | undefined {
  if (["manual", "generated-result"].includes(String(model.metadata?.priceSource)) || catalog.status !== "live" || catalog.complete === false) return undefined;
  try {
    const url = new URL(sourceUrl ?? "");
    if (url.origin !== "https://platform.frimodel.com" || url.username || url.password || url.search || url.hash || !/^(?:\/v1)?\/?$/u.test(url.pathname)) return undefined;
  } catch { return undefined; }
  const selected = catalog.groups.find(item => item.id === group), current = selected?.models.find(item => item.id === model.id);
  const next = current?.metadata?.officialCatalogPricing as ModelDescriptor["pricing"];
  if (!selected || selected.source !== "catalog" || selected.details?.stale === true || current?.metadata?.supplierCatalogModelStale === true ||
    current?.metadata?.supplierPriceConflict === true || current?.metadata?.officialCatalogPriceGroupVerified !== true || next?.sourceUrl !== "https://platform.frimodel.com/api/pricing" || next.confidence !== "exact" ||
    !["USD", "CNY", "RMB"].includes(next.currency) || !Number.isFinite(next.unitAmount)) return undefined;
  const expected = model.id === "gpt-image-2-adobe" && group === "gpt_image_adobe" ? "$0.05/张" :
    ["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"].includes(model.id) && ["gemini_image", "gemini_pro"].includes(group) ? "$0.1/次" :
    model.id === "gpt-image-2-w" && ["codex_image", "gpt_image_web"].includes(group) || model.id === "gpt-image-2-wc" && group === "gpt_image_wc" ? "$0.025/次" : undefined;
  if (!expected || model.metadata?.liveInventory !== true || !["frimodel-images", "gemini-generate-content"].includes(String(model.metadata?.protocol))) return undefined;
  const label = String(model.metadata?.priceLabel ?? "");
  const equivalent = label.replace("/图片", "/张").replace("/请求", "/次");
  if (model.pricing) {
    if (model.pricing.confidence !== "snapshot" || model.metadata?.billingLabel !== "价格快照" || model.metadata?.priceSource !== undefined) return undefined;
    try { const old = new URL(model.pricing.sourceUrl ?? "");
      if (old.origin !== "https://platform.frimodel.com" || !/^(?:\/v1)?\/?$/u.test(old.pathname) || old.username || old.password || old.search || old.hash) return undefined;
    } catch { return undefined; }
  } else if (model.metadata?.priceSource !== undefined) return undefined;
  return equivalent === expected ? label : undefined;
}

/** Replace the known automatic preset quote, never a user or billed quote. */
function canReplaceMikotoAutomaticSnapshot(model: ModelDescriptor,
  catalogModel: SupplierCatalogDiscovery["groups"][number]["models"][number] | undefined,
  selected: SupplierCatalogDiscovery["groups"][number] | undefined, catalog: SupplierCatalogDiscovery,
  sourceUrl: string | undefined, officialGroupId: string | undefined): boolean {
  if (model.id !== "gpt-image-2" || officialGroupId !== "16" || selected?.supplierGroupId !== "16" ||
    selected.source !== "catalog" || catalog.status !== "live" || selected.details?.stale === true ||
    catalogModel?.id !== model.id || catalogModel.metadata?.supplierCatalogModelStale === true ||
    catalogModel.metadata?.supplierPriceConflict === true || catalogModel.metadata?.officialCatalogPriceGroupVerified !== true ||
    model.metadata?.priceSource !== undefined || model.metadata?.source === "manual" || model.metadata?.protocolEvidence === "paid-test" ||
    model.metadata?.measuredPrice || model.metadata?.pricingCapturedAt !== "2026-08-13" || model.metadata?.tested4KHighAt !== "2026-08-13" ||
    model.pricing?.confidence !== "snapshot" || model.pricing.kind !== "per-image" || model.pricing.currency !== "USD" ||
    model.pricing.unitAmount !== .08 || model.pricing.checkedAt !== "2026-08-13T00:00:00.000Z" || model.pricing.tiers?.length) return false;
  const next = catalogModel.metadata.officialCatalogPricing as ModelDescriptor["pricing"];
  if (next?.kind !== "per-image" || next.currency !== "USD" || next.billingUnit !== "image" || next.confidence !== "exact" ||
    !Number.isFinite(next.unitAmount) || next.unitAmount! < 0 || next.sourceUrl !== "https://api.mikoto.vip/api/v1/channels/available") return false;
  try {
    return [sourceUrl, model.pricing.sourceUrl].every(value => {
      const url = new URL(value ?? "");
      return url.origin === "https://api.mikoto.vip" && !url.username && !url.password && !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname);
    });
  } catch { return false; }
}

function isWeAiCatalogSite(sourceUrl: string | undefined): boolean {
  try {
    const url = new URL(sourceUrl ?? "");
    return url.origin === "https://asian-acc.we-token.cc" && !url.username && !url.password && !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname);
  } catch { return false; }
}

function isHangCatalogSite(sourceUrl: string | undefined): boolean {
  try { const url = new URL(sourceUrl ?? ""); return url.origin === "https://api.hangzhale.com" && !url.username && !url.password &&
    !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname); } catch { return false; }
}

function isSecureCatalogSite(sourceUrl: string | undefined): boolean {
  try { const url = new URL(sourceUrl ?? ""); return url.origin === "https://token.secure-skill.com" && !url.username && !url.password &&
    !url.search && !url.hash && /^(?:\/v1|\/api\/v1\/pricing\/channels)?\/?$/u.test(url.pathname); } catch { return false; }
}

/** The dedicated reader's incomplete docs fallback is automatic, not a user quote. */
function isWeAiDocumentSnapshot(model: ModelDescriptor, sourceUrl: string | undefined): boolean {
  if (!isWeAiCatalogSite(sourceUrl) || model.metadata?.pricingSource !== "official-docs" || model.metadata?.pricingComplete !== false || model.pricing?.confidence !== "snapshot") return false;
  try {
    const url = new URL(model.pricing.sourceUrl ?? "");
    return url.origin === "https://docs.we-ai.cc" && url.pathname === "/guides/image-generation-service.html" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

function canReplaceWeAiDocumentSnapshot(model: ModelDescriptor, catalogModel: SupplierCatalogDiscovery["groups"][number]["models"][number] | undefined,
  selected: SupplierCatalogDiscovery["groups"][number] | undefined, catalog: SupplierCatalogDiscovery, sourceUrl: string | undefined): boolean {
  return isWeAiDocumentSnapshot(model, sourceUrl) && !["manual", "generated-result"].includes(String(model.metadata?.priceSource)) &&
    isCurrentWeAiAccountQuote(catalogModel, selected, catalog, sourceUrl);
}

function isCurrentWeAiAccountQuote(catalogModel: SupplierCatalogDiscovery["groups"][number]["models"][number] | undefined,
  selected: SupplierCatalogDiscovery["groups"][number] | undefined, catalog: SupplierCatalogDiscovery, sourceUrl: string | undefined): boolean {
  if (!isWeAiCatalogSite(sourceUrl) || catalog.status !== "live" || catalog.complete !== true || selected?.source !== "catalog" || selected.details?.stale === true ||
    catalogModel?.metadata?.supplierCatalogModelStale === true || catalogModel?.metadata?.weaiLegacyPricingIncomplete === true || catalogModel?.metadata?.supplierPriceConflict === true) return false;
  const pricing = catalogModel?.metadata?.weaiLegacyPricing as ModelDescriptor["pricing"];
  const evidence = catalogModel?.metadata?.weaiLegacyPriceEvidence as Record<string, unknown> | undefined;
  if (!pricing || pricing.currency !== "USD" || pricing.confidence !== "exact" || evidence?.imageTierPricesComplete === false) return false;
  try {
    const url = new URL(pricing.sourceUrl ?? ""), groupId = String(selected.supplierGroupId ?? "");
    return url.origin === "https://asian-acc.we-token.cc" && url.pathname === "/api/v1/model-plaza-legacy/models" &&
      !url.username && !url.password && !url.hash && /^\d+$/u.test(groupId) && url.searchParams.get("group_id") === groupId &&
      [...url.searchParams.keys()].length === 1;
  } catch { return false; }
}

/** Older catalog imports retained the docs-generated title after updating the quote. */
function importedWeAiDocsNameLabel(model: ModelDescriptor, catalogModel: SupplierCatalogDiscovery["groups"][number]["models"][number] | undefined,
  selected: SupplierCatalogDiscovery["groups"][number] | undefined, catalog: SupplierCatalogDiscovery, sourceUrl: string | undefined): string | undefined {
  if (model.metadata?.priceSource !== "supplier-catalog" || model.metadata.pricingSource !== "official-docs" || model.metadata.pricingComplete !== false ||
    model.metadata.supplierPriceGroup !== selected?.id || model.pricing?.confidence !== "exact" || model.pricing.currency !== "USD" ||
    typeof model.metadata.pricingLabel !== "string" || !isCurrentWeAiAccountQuote(catalogModel, selected, catalog, sourceUrl)) return undefined;
  try {
    const docsUrl = new URL(String(model.metadata.pricingSourceUrl ?? ""));
    const quoteUrl = new URL(model.pricing.sourceUrl ?? "");
    if (docsUrl.origin !== "https://docs.we-ai.cc" || docsUrl.pathname !== "/guides/image-generation-service.html" || docsUrl.username || docsUrl.password || docsUrl.search || docsUrl.hash ||
      quoteUrl.origin !== "https://asian-acc.we-token.cc" || quoteUrl.pathname !== "/api/v1/model-plaza-legacy/models" || quoteUrl.username || quoteUrl.password || quoteUrl.hash ||
      quoteUrl.searchParams.get("group_id") !== String(selected?.supplierGroupId) || [...quoteUrl.searchParams.keys()].length !== 1) return undefined;
    return model.metadata.pricingLabel;
  } catch { return undefined; }
}

function isImportedConditionalCatalogPrice(model: ModelDescriptor): boolean {
  if (model.metadata?.priceSource !== "supplier-catalog" || !model.pricing?.sourceUrl) return false;
  try {
    const source = new URL(model.pricing.sourceUrl);
    if (source.protocol !== "https:" || source.username || source.password) return false;
    return source.origin === "https://token.secure-skill.com" && source.pathname === "/api/v1/pricing/channels" ||
      source.origin === "https://asian-acc.we-token.cc" && source.pathname === "/api/v1/model-plaza-legacy/models" ||
      ["https://api.eaheng.com", "https://ai.whyshy.cn"].includes(source.origin) && source.pathname === "/api/v1/model-plaza" ||
      ["https://api.miaowuai.store", "https://newapi.jijiucanvas.com"].includes(source.origin) && source.pathname === "/api/pricing" ||
      source.origin === "https://price.hangzhale.com" && source.pathname === "/api/provider/pricing" ||
      source.origin === "https://vapi.chuangxiangai.asia" && source.pathname === "/model-plaza";
  } catch { return false; }
}

type MeasuredPrice = {
  label: string;
  checkedAt: string;
  amount: number;
  currency: string;
  unit: "image" | "request";
  resolution?: string;
  quality?: string;
  parameters: Record<string, string | number | boolean>;
  sourceUrl?: string;
};

/** Saved ledger observations are independent of media acceptance. They neither
 * create verification successes nor enable unavailable models. Reapply from the
 * connection on every catalog refresh so a cache replacement cannot lose them.
 */
export function applySavedMeasuredPrices(models: readonly ModelDescriptor[], config: Readonly<Record<string, unknown>>,
  scope: { sourceId: string; supplierGroupId: string; apiUrl: string }): ModelDescriptor[] {
  const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
  const observations = Array.isArray(config.measuredPriceEvidence) ? config.measuredPriceEvidence : [];
  const valid = observations.flatMap(value => {
    const sample = object(value), charge = object(sample?.actualCharge), parameters = object(sample?.parameters);
    if (!sample || !charge || !parameters || sample.parameterScope !== "exact" || sample.sourceId !== scope.sourceId ||
      sample.supplierGroupId !== scope.supplierGroupId || sample.accountKeyId !== String(config.accountKeyId ?? "") ||
      typeof sample.modelId !== "string" || !sample.modelId || typeof sample.checkedAt !== "string" || !Number.isFinite(Date.parse(sample.checkedAt)) ||
      typeof charge.amount !== "number" || !Number.isFinite(charge.amount) || charge.amount < 0 || !["request", "image"].includes(String(charge.unit))) return [];
    const taskMatch = typeof sample.providerTaskId === "string" && Boolean(sample.providerTaskId) && charge.taskId === sample.providerTaskId;
    const requestMatch = typeof sample.requestId === "string" && Boolean(sample.requestId) && charge.requestId === sample.requestId;
    if (!taskMatch && !requestMatch) return [];
    try {
      const source = new URL(String(charge.sourceUrl ?? "")), api = new URL(scope.apiUrl);
      if (source.origin !== api.origin || source.username || source.password || source.hash || !["https:", "http:"].includes(source.protocol)) return [];
    } catch { return []; }
    const currency = typeof charge.currency === "string" && charge.currency.trim() ? charge.currency.trim() : undefined;
    const amount = Number(charge.amount.toPrecision(10));
    const label = `${currency ? measuredPriceLabel(amount, currency, charge.unit as "image" | "request").replace("（生成实测）", "")
      : `${amount} 账户计价单位/${charge.unit === "image" ? "张" : "次"}`}（账单实测，仅${Object.keys(parameters).length ? "对应参数" : "默认请求"}${sample.originalStatus === "awaiting-download" ? "；原件待取回" : ""}）`;
    return [{ sample, parameters, charge, label, checkedAt: sample.checkedAt, modelId: sample.modelId }];
  }).sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
  return models.map(model => {
    if (model.metadata?.priceSource !== "generated-result" && (model.pricing || typeof model.metadata?.priceLabel === "string" &&
      Boolean(model.metadata.priceLabel.trim()) && !unknownPrice.test(model.metadata.priceLabel))) return model;
    if (!modelGenerationMediaKinds(model).some(kind => kind === "image" || kind === "video")) return model;
    const evidence = valid.find(item => item.modelId === model.id);
    if (!evidence) return model;
    const previous = object(model.metadata?.measuredPrice);
    if (previous && Date.parse(String(previous.checkedAt ?? "")) > Date.parse(evidence.checkedAt)) return model;
    return { ...model, pricing: undefined, metadata: { ...model.metadata, priceSource: "generated-result", priceStatus: "measured",
      priceLabel: evidence.label, priceCheckedAt: evidence.checkedAt, supplierPriceGroupId: scope.supplierGroupId,
      measuredPrice: { ...evidence.sample, amount: evidence.charge.amount, currency: evidence.charge.currency,
        unit: evidence.charge.unit, sourceUrl: evidence.charge.sourceUrl, parameters: evidence.parameters,
        equivalentDefaults: object(evidence.sample.equivalentDefaults) ?? {} } } };
  });
}

function measuredPriceLabel(
  amount: number,
  currency: string,
  unit: "image" | "request",
): string {
  const normalized = currency.trim().toUpperCase();
  const symbol =
    normalized === "CNY" || normalized === "RMB" || normalized === "YUAN"
      ? "¥"
      : normalized === "USD" || normalized === "US$"
        ? "$"
        : normalized === "QUOTA" || normalized === "CREDIT" || normalized === "CREDITS"
          ? "额度 "
          : `${currency.trim()} `;
  const rendered = Number(amount.toPrecision(10));
  return `${symbol}${rendered}/${unit === "image" ? "张" : "次"}（生成实测）`;
}

/**
 * Read the latest exact charge recorded by a supplier verification request.
 * This is deliberately a pure conversion step: an actual charge can fill an
 * unknown price, but it never overwrites a documented/catalog/group price.
 */
export function measuredPricesFromVerification(
  record: {
    sourceId?: unknown;
    cases?: ReadonlyArray<{
      sourceId?: unknown;
      supplierGroupId?: unknown;
      requestId?: unknown;
      task?: Record<string, unknown>;
      group?: unknown;
      modelId?: unknown;
      resolution?: unknown;
      quality?: unknown;
      parameters?: Record<string, unknown>;
      updatedAt?: unknown;
      submittedAt?: unknown;
      status?: unknown;
      actualCharge?: {
        amount?: unknown;
        currency?: unknown;
        unit?: unknown;
        checkedAt?: unknown;
        sourceUrl?: unknown;
        requestId?: unknown;
        taskId?: unknown;
      };
    }>;
  } | null | undefined,
  scope: { supplierGroupId?: string; group?: string } = {},
): ReadonlyMap<string, MeasuredPrice> {
  const latest = new Map<string, { at: number; value: MeasuredPrice }>();
  for (const test of record?.cases ?? []) {
    if (test.status !== "succeeded" || (record?.sourceId && test.sourceId !== record.sourceId)) continue;
    if (scope.supplierGroupId && test.supplierGroupId !== scope.supplierGroupId) continue;
    const modelId = typeof test.modelId === "string" ? test.modelId.trim() : "";
    const group = scope.supplierGroupId && scope.group ? scope.group : typeof test.group === "string" ? test.group.trim() : "";
    const charge = test.actualCharge;
    const requestMatches = typeof test.requestId === "string" && Boolean(test.requestId) && charge?.requestId === test.requestId;
    const taskMatches = typeof test.task?.providerTaskId === "string" && Boolean(test.task.providerTaskId) && charge?.taskId === test.task.providerTaskId;
    if (!requestMatches && !taskMatches) continue;
    const amount =
      typeof charge?.amount === "number"
        ? charge.amount
        : typeof charge?.amount === "string" && charge.amount.trim()
          ? Number(charge.amount)
          : Number.NaN;
    const currency =
      typeof charge?.currency === "string" ? charge.currency.trim() : "";
    const unit = charge?.unit === "request" || charge?.unit === "image"
      ? charge.unit
      : undefined;
    if (!modelId || !group || !Number.isFinite(amount) || amount < 0 || !currency || !unit)
      continue;
    const checkedAt =
      typeof charge?.checkedAt === "string" && charge.checkedAt.trim()
        ? charge.checkedAt
        : typeof test.updatedAt === "string" && test.updatedAt.trim()
          ? test.updatedAt
          : typeof test.submittedAt === "string" && test.submittedAt.trim()
            ? test.submittedAt
            : new Date(0).toISOString();
    const timestamp = Date.parse(checkedAt);
    const at = Number.isFinite(timestamp) ? timestamp : 0;
    const value: MeasuredPrice = {
      label: `${measuredPriceLabel(amount, currency, unit)}${[test.resolution, test.quality].filter(value => typeof value === "string" && value).length
        ? ` · ${[test.resolution, test.quality].filter(value => typeof value === "string" && value).join(" / ")}`
        : ""}`,
      checkedAt,
      amount,
      currency,
      unit,
      ...(typeof test.resolution === "string" ? { resolution: test.resolution } : {}),
      ...(typeof test.quality === "string" ? { quality: test.quality } : {}),
      parameters: Object.fromEntries(Object.entries(test.parameters ?? {}).filter(
        (entry): entry is [string, string | number | boolean] => ["string", "number", "boolean"].includes(typeof entry[1]),
      )),
      ...(typeof charge?.sourceUrl === "string" && charge.sourceUrl.trim()
        ? { sourceUrl: charge.sourceUrl }
        : {}),
    };
    const key = `${group}\u0000${modelId}`;
    const previous = latest.get(key);
    if (!previous || at >= previous.at) latest.set(key, { at, value });
  }
  return new Map([...latest].map(([key, item]) => [key, item.value]));
}

async function applyMeasuredSupplierPrices(
  supplierId: string | undefined,
  models: readonly ModelDescriptor[],
  group: string,
  sourceId: string,
  supplierGroupId?: string,
): Promise<ModelDescriptor[]> {
  if (!supplierId || !models.length) return [...models];
  // Missing evidence is valid; unreadable or corrupt evidence is not. In
  // particular, an external evidence read must not silently become an empty
  // price lookup that could hide an existing measured charge.
  const record = await repository.getSupplierVerification?.(supplierId);
  if (!record || record.sourceId !== sourceId) return [...models];
  const measured = measuredPricesFromVerification(record, { supplierGroupId, group });
  if (!measured.size) return [...models];
  return models.map((model) => {
    if (model.metadata?.priceSource !== "generated-result" &&
      (model.pricing || (typeof model.metadata?.priceLabel === "string" && model.metadata.priceLabel.trim() && !unknownPrice.test(model.metadata.priceLabel)))) return model;
    const media = modelGenerationMediaKinds(model);
    if (!media.includes("image") && !media.includes("video")) return model;
    const evidence = measured.get(`${group}\u0000${model.id}`);
    if (!evidence) return model;
    const existing = model.metadata?.measuredPrice as Record<string, unknown> | undefined;
    const existingAt = Date.parse(String(existing?.observedAt ?? existing?.checkedAt ?? ""));
    if (Number.isFinite(existingAt) && existingAt > Date.parse(evidence.checkedAt)) return model;
    const previous =
      typeof model.metadata?.priceLabel === "string"
        ? model.metadata.priceLabel
        : "";
    let name = model.name;
    if (previous && name.includes(`（${previous}）`))
      name = name.replace(`（${previous}）`, "");
    name = name.replace(
      /[（(](?:价格以(?:平台|模型广场)为准|价格未公布|价格查询失败|价格需登录查询|价格未查询)(?:·快照)?[）)]/gu,
      "",
    );
    return {
      ...model,
      name,
      pricing: undefined,
      metadata: {
        ...model.metadata,
        priceLabel: evidence.label,
        priceSource: "generated-result",
        priceStatus: "measured",
        priceCheckedAt: evidence.checkedAt,
        measuredPrice: evidence,
        ...(supplierGroupId ? { supplierPriceGroupId: supplierGroupId } : {}),
      },
    };
  });
}

function jiasuExampleMetadata(model: ModelDescriptor, catalogModel: SupplierCatalogDiscovery["groups"][number]["models"][number] | undefined,
  catalog: SupplierCatalogDiscovery, groupStale: boolean, sourceUrl?: string): NonNullable<ModelDescriptor["metadata"]> {
  const metadata = { ...model.metadata };
  if (!isJiasuApiUrl(sourceUrl) || !catalogModel || catalogModel.id !== model.id || groupStale ||
    ["failed", "unauthorized"].includes(catalog.status) || ["manual", "paid-test"].includes(String(metadata.source)) || metadata.protocolEvidence === "paid-test") return metadata;
  const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const previous = row(metadata.jiasuCatalogRecord), incoming = row(catalogModel.metadata?.jiasuCatalogRecord);
  const oldExample = latestJiasuVideoApiExampleContract(model.id, metadata.jiasuApiExampleContract, previous.apiExampleContract);
  const newExample = latestJiasuVideoApiExampleContract(model.id, catalogModel.metadata?.jiasuApiExampleContract, incoming.apiExampleContract);
  const selected = latestJiasuVideoApiExampleContract(model.id, oldExample, newExample);
  const oldRecordAt = Date.parse(String(metadata.jiasuCatalogCheckedAt ?? ""));
  const newRecordAt = Date.parse(String(catalogModel.metadata?.jiasuCatalogCheckedAt ?? catalog.checkedAt));
  if (catalogModel.metadata?.jiasuCatalogRecord && (!Number.isFinite(oldRecordAt) || Number.isFinite(newRecordAt) && newRecordAt >= oldRecordAt)) {
    for (const field of ["jiasuApiParameters", "jiasuCatalogDescription", "jiasuCatalogCheckedAt"])
      if (catalogModel.metadata?.[field] !== undefined) metadata[field] = catalogModel.metadata[field];
    const safeRecord = { ...previous, ...incoming };
    if (selected) safeRecord.apiExampleContract = selected;
    else delete safeRecord.apiExampleContract;
    metadata.jiasuCatalogRecord = safeRecord;
  }
  if (selected) {
    metadata.jiasuApiExampleContract = selected;
    metadata.jiasuCatalogRecord = { ...row(metadata.jiasuCatalogRecord), apiExampleContract: selected };
  }
  // The latest failed attempt retains the actual previous live body/date.
  const previousAt = Date.parse(String(metadata.jiasuApiExampleCheckedAt ?? oldExample?.checkedAt ?? ""));
  const incomingAt = Date.parse(String(catalogModel.metadata?.jiasuApiExampleCheckedAt ?? ""));
  if (Number.isFinite(incomingAt) && (!Number.isFinite(previousAt) || incomingAt >= previousAt)) {
    const status = catalogModel.metadata?.jiasuApiExampleScanStatus;
    if (status === "live" || status === "partial") {
      metadata.jiasuApiExampleCheckedAt = catalogModel.metadata!.jiasuApiExampleCheckedAt;
      metadata.jiasuApiExampleScanStatus = status === "live" && newExample?.sourceStatus === "live" ? "live" : "partial";
      if (catalogModel.metadata?.jiasuApiExampleRefreshId !== undefined) metadata.jiasuApiExampleRefreshId = catalogModel.metadata.jiasuApiExampleRefreshId;
      else delete metadata.jiasuApiExampleRefreshId;
    }
  }
  return metadata;
}

/** Refresh only fields that this catalog originally supplied, never a model API/manual override. */
function catalogInterfaceMetadata(model: ModelDescriptor, catalogModel: { metadata?: ModelDescriptor["metadata"] } | undefined,
  catalog: SupplierCatalogDiscovery, groupStale: boolean) {
  const metadata = { ...model.metadata };
  const incomplete = catalog.complete === false || ["failed", "unauthorized"].includes(catalog.status) || groupStale;
  let supplied = false;
  if (catalogModel && !["failed", "unauthorized"].includes(catalog.status)) {
    const fields = [
      ["endpointTypes", "supplierCatalogEndpointTypes"],
      ["documentationUrl", "supplierCatalogDocumentationUrl"],
    ] as const;
    for (const [field, ownership] of fields) {
      const raw = catalogModel.metadata?.[field];
      const next = field === "endpointTypes"
        ? Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string" && value.length <= 256).slice(0, 32) : undefined
        : typeof raw === "string" && raw.trim() && raw.length <= 2048 ? raw : undefined;
      const present = field === "endpointTypes" ? Array.isArray(next) && next.length > 0 : next !== undefined;
      const current = metadata[field], previous = metadata[ownership];
      const owned = previous !== undefined && JSON.stringify(current) === JSON.stringify(previous);
      if (current === undefined || owned) {
        if (present) {
          metadata[field] = next;
          metadata[ownership] = Array.isArray(next) ? [...next] : next;
          supplied = true;
        } else if (owned && !incomplete) {
          delete metadata[field]; delete metadata[ownership];
          supplied = true;
        }
      } else if (previous !== undefined) {
        // A user/model API replaced our value. Do not adopt that replacement.
        delete metadata[ownership];
      }
    }
  }
  if (supplied) metadata.supplierCatalogMetadataVersion = 1;
  if (!supplied && metadata.supplierCatalogEndpointTypes === undefined && metadata.supplierCatalogDocumentationUrl === undefined) {
    delete metadata.supplierCatalogCheckedAt; delete metadata.supplierCatalogInterfaceStale; delete metadata.supplierCatalogMetadataVersion;
  }
  if (supplied && !groupStale) metadata.supplierCatalogCheckedAt = catalog.checkedAt;
  if (supplied || metadata.supplierCatalogCheckedAt) metadata.supplierCatalogInterfaceStale = incomplete || !catalogModel;
  return metadata;
}

function currentLedgerSample(model: ModelDescriptor, evidence: unknown, supplierGroupId: string | undefined,
  group: string, sourceUrl: string | undefined, historical = false): ModelDescriptor | undefined {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || !supplierGroupId) return undefined;
  const sample = evidence as Record<string, unknown>;
  try {
    const site = new URL(sourceUrl ?? ""), source = new URL(String(sample.sourceUrl ?? ""));
    if (site.origin !== "https://synoralink.com" || !["", "/"].includes(site.pathname) || site.username || site.password || site.search || site.hash ||
      source.origin !== site.origin || source.pathname !== "/api/v1/usage" || source.username || source.password || source.hash ||
      [...source.searchParams.keys()].some(key => !["page", "page_size"].includes(key))) return undefined;
  } catch { return undefined; }
  const parameters = sample.parameters && typeof sample.parameters === "object" && !Array.isArray(sample.parameters)
    ? sample.parameters as Record<string, unknown> : {};
  const observedAt = Date.parse(String(sample.observedAt ?? "")), checkedAt = Date.parse(String(sample.checkedAt ?? ""));
  if (sample.supplierGroupId !== supplierGroupId || sample.modelId !== model.id || sample.currency !== "USD" ||
    sample.unit !== "image" || sample.sample !== true || sample.billingMode !== "image" ||
    typeof sample.amount !== "number" || !Number.isFinite(sample.amount) || sample.amount < 0 ||
    !Number.isFinite(observedAt) || !Number.isFinite(checkedAt) || observedAt > checkedAt + 300000 ||
    !/^(?:[124]K|[1-9]\d{1,4}X[1-9]\d{1,4})$/u.test(String(sample.resolution)) || parameters.n !== 1 || parameters.resolution !== sample.resolution) return undefined;
  if (model.metadata?.priceSource === "generated-result") {
    const previous = model.metadata.measuredPrice as Record<string, unknown> | undefined;
    const previousAt = Date.parse(String(previous?.observedAt ?? previous?.checkedAt ?? model.metadata.priceCheckedAt ?? ""));
    if (Number.isFinite(previousAt) && previousAt > observedAt) return undefined;
  }
  const noticeAfterCharge = Date.parse(String(sample.notificationAt ?? "")) > observedAt;
  historical ||= noticeAfterCharge;
  const label = `${noticeAfterCharge ? "价格已调整；" : ""}${measuredPriceLabel(sample.amount, "USD", "image").replace("（生成实测）", historical ? "（上次账单实测）" : "（账单实测）")} · ${sample.resolution}`;
  const previousLabel = typeof model.metadata?.priceLabel === "string" ? model.metadata.priceLabel : "";
  return { ...model, name: previousLabel ? model.name.replace(`（${previousLabel}）`, "") : model.name, pricing: undefined,
    metadata: { ...model.metadata, priceLabel: label, priceSource: "generated-result", priceStatus: historical ? "partial" : "measured",
      priceCheckedAt: sample.checkedAt, supplierPriceGroup: group, supplierPriceGroupId: supplierGroupId,
      priceSourceUrl: sample.sourceUrl, measuredPrice: { ...sample, label } } };
}

/** Join by exact group and exact model ID; a public plaza never grants availability. */
export function applySupplierCatalogPrices(
  models: readonly ModelDescriptor[],
  group: string,
  catalog: SupplierCatalogDiscovery,
  sourceUrl?: string,
  options: CatalogPriceOptions = {},
): ModelDescriptor[] {
  // Preserve every success quote and actual charge independently of this
  // source-scoped announcement, including pipeline/manual early returns.
  models = models.map(model => {
    const notice = chuangxiangRejectedRequestFeeNotice(sourceUrl, model.id);
    if (notice) return { ...model, metadata: { ...model.metadata, chuangxiangRejectedRequestFeeNotice: notice } };
    if (model.metadata?.chuangxiangRejectedRequestFeeNotice === undefined) return model;
    const metadata = { ...model.metadata }; delete metadata.chuangxiangRejectedRequestFeeNotice;
    return { ...model, metadata };
  });
  const renamedGroup = provenJijiuPriceGroup(group, catalog, sourceUrl, options);
  const observedIds = new Set(["SD2.5特价30-10-10-线路三", "SD2.5特价30-10线路二", "SD2.5特价900线路一"]);
  if (renamedGroup) return models.map(model => {
    if (!observedIds.has(model.id) || model.metadata?.liveInventory !== true) return applySupplierCatalogPrices([model], group, catalog, sourceUrl,
      { ...options, keyGroupRenameEvidence: undefined })[0]!;
    const result = applySupplierCatalogPrices([model], renamedGroup, catalog, sourceUrl,
      { ...options, keyGroupRenameEvidence: undefined })[0]!;
    // A failed/partial quote cannot erase valid historical evidence.
    if (!result.pricing || result.pricing.confidence !== "exact" || result.pricing.sourceUrl !== "https://newapi.jijiucanvas.com/api/pricing") return model;
    return { ...result, metadata: { ...result.metadata, supplierPriceGroup: group, supplierPricingSourceGroup: renamedGroup,
      supplierPriceGroupRenameEvidence: options.keyGroupRenameEvidence } };
  });
  const officialId = /^\d+$/u.test(options.supplierGroupId ?? "") ? options.supplierGroupId : undefined;
  const matches = officialId ? catalog.groups.filter(g => g.supplierGroupId === officialId) : catalog.groups.filter(g => g.id === group);
  const freshMatches = matches.filter(g => g.details?.stale !== true && (g as { status?: string }).status !== "missing");
  // A name may be reused for another group. A known official ID is authoritative;
  // ambiguous duplicate identities cannot borrow another group's quote.
  const selected = freshMatches.length === 1 ? freshMatches[0] : matches.length === 1 ? matches[0] : undefined;
  const resolvedGroupId = selected?.supplierGroupId ?? officialId;
  const groupIdentityMetadata = resolvedGroupId ? { supplierPriceGroupId: resolvedGroupId } : {};
  const generic =
    !selected && !officialId &&
    catalog.kind === "openai-compatible" &&
    catalog.groups.length === 1 &&
    catalog.groups[0]?.id === "默认群组"
      ? catalog.groups[0]
      : undefined;
  const prices = new Map(
    (selected ?? generic)?.models.map((model) => [
      model.id,
      model.priceLabel,
    ]) ?? [],
  );
  const reason =
    catalog.status === "unauthorized"
      ? "价格需登录查询"
      : catalog.status === "failed"
        ? "价格查询失败"
        : "价格未公布";
  const incomplete = catalog.complete === false || ["failed", "unauthorized"].includes(catalog.status);
  const groupModelIds = [...models.map(model => model.id), ...((selected ?? generic)?.models.map(model => model.id) ?? [])];
  const priced = models.map((model) => {
    // Pipeline prices already carry per-condition provenance and withdrawal
    // counters. A legacy enrichment pass must not replace that accepted view.
    if (model.metadata?.catalogPriceEvidence && typeof model.metadata.catalogPriceEvidence === "object" &&
      (model.metadata.catalogPriceEvidence as { schemaVersion?: unknown }).schemaVersion === 1) return model;
    const catalogModel = (selected ?? generic)?.models.find(item => item.id === model.id);
    // Public API evidence refreshes independently of every price early-return.
    if (selected && catalogModel && isJiasuApiUrl(sourceUrl)) model = { ...model,
      metadata: jiasuExampleMetadata(model, catalogModel, catalog, selected.details?.stale === true, sourceUrl) };
    if (["manual", "generated-result"].includes(String(model.metadata?.priceSource)) && model.pricing) return model;
    // Exact Chentu rows currently disagree about dollars versus site CNY.
    // Retain the original supplier quote, but remove an automatic numeric
    // estimate even if an older scanner considered that estimate its own.
    if (/^https:\/\/tu\.988236\.xyz(?:\/v1)?\/?$/u.test(sourceUrl ?? "") &&
      catalog.status === "live" && selected?.details?.stale !== true &&
      catalogModel?.metadata?.supplierCatalogModelStale !== true &&
      (catalogModel?.metadata?.chentuCurrencyConflict === true || catalogModel?.metadata?.chentuVideoPricingIncomplete === true)) {
      if (model.metadata?.priceSource === "manual" || model.metadata?.source === "manual" ||
        model.metadata?.priceSource === "generated-result" && model.metadata?.measuredPrice) return model;
      const previousAt = Date.parse(String(model.metadata?.priceCheckedAt ?? model.pricing?.checkedAt ?? ""));
      if (Number.isFinite(previousAt) && previousAt > Date.parse(catalog.checkedAt)) return model;
      const metadata = { ...model.metadata, ...catalogModel.metadata };
      delete metadata.officialCatalogPricing;
      const oldLabel = String(model.metadata?.priceLabel ?? "");
      const name = oldLabel ? model.name.replace(` · ${oldLabel}`, "").replace(`（${oldLabel}）`, "").replace(`(${oldLabel})`, "") : model.name;
      return { ...model, name, pricing: undefined, metadata: { ...metadata,
        priceLabel: catalogModel.priceLabel ?? "", priceSource: "supplier-catalog",
        priceStatus: catalogModel.metadata.chentuCurrencyConflict === true ? "conflict" : "unconfirmed",
        priceCheckedAt: catalog.checkedAt, priceLastAttemptAt: catalog.checkedAt, supplierPriceGroup: group } };
    }
    // Hang's separate board has ambiguous image/token currency declarations.
    // Its new chat feed must not overwrite an existing media quote.
    if (isHangCatalogSite(sourceUrl) && model.pricing && modelGenerationMediaKinds(model).length) return model;
    if (isWeAiCatalogSite(sourceUrl) && model.metadata?.priceSource === "generated-result" && model.pricing) return model;
    if (resolvedGroupId && (["supplier-catalog", "supplier-group"].includes(String(model.metadata?.priceSource)) ||
      model.metadata?.priceSource === "generated-result" && !model.pricing) &&
      model.metadata?.supplierPriceGroupId !== resolvedGroupId) {
      // A retained quote belongs to its official group, even when names are reused.
      // Legacy name-only prices must be established again by the current evidence.
      const metadata: Record<string, unknown> = { ...model.metadata, priceLabel: "价格未公布" };
      for (const field of ["secureSkillCatalogPricing", "chuangxiangCatalogPricing", "tk1688Pricing", "weaiLegacyPricing", "sub2apiPlazaPricing", "miaowuCatalogPricing", "hangCatalogPricing", "officialCatalogPricing"]) delete metadata[field];
      model = { ...model, pricing: undefined, metadata };
    }
    const cyberPending = isCyberAfeiUnpricedCatalogVideo(sourceUrl, model.id) &&
      (catalogModel?.metadata?.cyberAfeiCatalogPricingIncomplete === true || model.metadata?.cyberAfeiCatalogPricingIncomplete === true ||
        model.metadata?.supplier === "cyberafei" && model.metadata?.canvasRunnable === false);
    // Repair the old automatic token placeholder even when that dedicated
    // descriptor had no priceSource. Preserve separately authored non-token rates.
    const cyberToken = cyberPending && (model.pricing?.kind === "token" || /(?:\/\s*1M|token)/iu.test(String(model.metadata?.priceLabel ?? "")));
    if (cyberPending && (!hasOwnPrice(model) || cyberToken || model.metadata?.priceLabel === "价格条件待确认")) {
      const oldLabel = String(model.metadata?.priceLabel ?? "");
      const name = cyberToken && oldLabel ? model.name.replace(` · ${oldLabel}`, "").replace(`（${oldLabel}）`, "").replace(`(${oldLabel})`, "") : model.name;
      return { ...model, name, pricing: undefined, metadata: { ...model.metadata,
        priceLabel: "价格条件待确认", priceSource: "supplier-catalog", priceStatus: "unconfirmed", cyberAfeiCatalogPricingIncomplete: true,
        priceUnavailableReason: "官方价格条件待确认", priceCheckedAt: catalog.checkedAt, priceLastAttemptAt: catalog.checkedAt, supplierPriceGroup: group } };
    }
    // Opening a picker must not roll a successful connection price back to an
    // older supplier snapshot. Scope this to the same group; a copied model or
    // a group change must still be priced from that group's own evidence.
    const priceGroup = model.metadata?.supplierPriceGroup ?? model.metadata?.catalogGroup;
    const priceAt = Date.parse(String(model.metadata?.priceCheckedAt ?? model.pricing?.checkedAt ?? ""));
    const catalogAt = Date.parse(catalog.checkedAt);
    if (options.savedCatalog && priceGroup === group &&
      ["supplier-catalog", "supplier-group"].includes(String(model.metadata?.priceSource)) &&
      (model.pricing || typeof model.metadata?.priceLabel === "string" && !unknownPrice.test(model.metadata.priceLabel)) &&
      Number.isFinite(priceAt) && Number.isFinite(catalogAt) && priceAt > catalogAt) return model;
    const jijiuIncomplete = catalogModel?.metadata?.jijiuCatalogPricingIncomplete === true;
    // An unsupported new billing expression is a partial price read. Retain an
    // earlier exact quote only for this supplier, full model and same group.
    if (jijiuIncomplete && /^https:\/\/newapi\.jijiucanvas\.com(?:\/v1)?\/?$/u.test(sourceUrl ?? "") &&
      model.metadata?.priceSource === "supplier-catalog" && priceGroup === group && model.pricing?.confidence === "exact" &&
      model.pricing.sourceUrl === "https://newapi.jijiucanvas.com/api/pricing" && typeof model.metadata.priceLabel === "string" && !unknownPrice.test(model.metadata.priceLabel)) {
      return { ...model, metadata: { ...catalogInterfaceMetadata(model, catalogModel, catalog, selected?.details?.stale === true),
        priceLabel: `${model.metadata.priceLabel.replace(/（上次价格）$/u, "")}（上次价格）`, priceStatus: "partial", jijiuCatalogPricingIncomplete: true,
        priceUnavailableReason: catalogModel?.metadata?.priceUnavailableReason ?? "官方价格条件待确认", priceLastAttemptAt: catalog.checkedAt } };
    }
    const incompletePricingFields = ["weaiLegacyPricingIncomplete", "sub2apiPlazaPricingIncomplete", "miaowuCatalogPricingIncomplete", "chuangxiangCatalogPricingIncomplete", "jiasuCatalogPricingIncomplete", "jijiuCatalogPricingIncomplete"].filter(field => catalogModel?.metadata?.[field] === true);
    const jiasuTokenPlaceholder = (catalogModel?.metadata?.jiasuCatalogPricingIncomplete === true || jijiuIncomplete) &&
      (model.pricing?.kind === "token" || /(?:\/\s*1M|token)/iu.test(String(model.metadata?.priceLabel ?? "")));
    if (incompletePricingFields.length && (!hasOwnPrice(model) || jiasuTokenPlaceholder)) {
      const metadata = { ...catalogInterfaceMetadata(model, catalogModel, catalog, selected?.details?.stale === true) };
      delete metadata.weaiLegacyPricing; delete metadata.sub2apiPlazaPricing; delete metadata.miaowuCatalogPricing;
      if (catalogModel?.metadata?.jiasuCatalogPricingIncomplete === true || jijiuIncomplete) delete metadata.officialCatalogPricing;
      const oldLabel = String(model.metadata?.priceLabel ?? "");
      const name = jiasuTokenPlaceholder && oldLabel ? model.name.replace(` · ${oldLabel}`, "").replace(`（${oldLabel}）`, "").replace(`(${oldLabel})`, "") : model.name;
      return { ...model, name, pricing: undefined, metadata: { ...metadata, priceLabel: "价格条件待确认", priceSource: "supplier-catalog",
        priceStatus: "unconfirmed", ...Object.fromEntries(incompletePricingFields.map(field => [field, true])),
        priceUnavailableReason: catalogModel?.metadata?.jiasuCatalogPricingIncomplete === true || jijiuIncomplete ? String(catalogModel?.metadata?.priceUnavailableReason ?? "官方价格条件待确认") : "官方价格条件待确认",
        priceCheckedAt: catalog.checkedAt, priceLastAttemptAt: catalog.checkedAt, supplierPriceGroup: group } };
    }
    const historicalCatalogPrice = catalogModel?.metadata?.priceStatus === "partial" || /（上次价格）$/u.test(catalogModel?.priceLabel ?? "");
    if (catalogModel && (catalogModel.metadata?.supplierCatalogModelStale === true || historicalCatalogPrice) && !hasOwnPrice(model)) {
      const retainedPricing = structuredCatalogPrice(catalogModel.metadata);
      const retainedCheckedAt = catalogModel.metadata?.priceCheckedAt ?? retainedPricing?.checkedAt ?? catalogModel.metadata?.supplierCatalogPriceCheckedAt;
      const retainedAt = Date.parse(String(retainedCheckedAt ?? ""));
      const sameGroupPrice = priceGroup === group && typeof model.metadata?.priceLabel === "string" && !unknownPrice.test(model.metadata.priceLabel) &&
        (!Number.isFinite(retainedAt) || Number.isFinite(priceAt) && priceAt >= retainedAt);
      const label = sameGroupPrice ? String(model.metadata!.priceLabel) : catalogModel.priceLabel;
      const previousPricing = sameGroupPrice ? model.pricing : retainedPricing;
      const checkedAt = sameGroupPrice ? model.metadata?.priceCheckedAt ?? previousPricing?.checkedAt :
        retainedCheckedAt;
      const priced = typeof label === "string" && !unknownPrice.test(label);
      return { ...model, pricing: priced ? previousPricing ?? pricingFromSupplierEvidence(label, undefined, String(checkedAt ?? ""), sourceUrl) : undefined,
        metadata: { ...catalogInterfaceMetadata(model, catalogModel, catalog, catalogModel?.metadata?.supplierCatalogModelStale === true),
          priceLabel: priced ? `${label.replace(/（上次价格）$/u, "")}（上次价格）` : reason,
          priceSource: "supplier-catalog", supplierPriceGroup: group, ...groupIdentityMetadata, priceStatus: "partial",
          priceCheckedAt: checkedAt ?? "", priceLastAttemptAt: catalog.checkedAt } };
    }
    if (catalogModel?.metadata?.supplierPriceConflict === true && !hasOwnPrice(model)) {
      const metadata = { ...model.metadata };
      for (const field of ["secureSkillCatalogPricing", "chuangxiangCatalogPricing", "tk1688Pricing", "weaiLegacyPricing", "sub2apiPlazaPricing", "miaowuCatalogPricing", "hangCatalogPricing", "officialCatalogPricing"]) delete metadata[field];
      return {
        ...model,
        pricing: undefined,
        metadata: { ...metadata, priceLabel: "价格存在冲突，待确认", priceSource: "supplier-catalog", priceStatus: "conflict",
          supplierPriceConflict: true, supplierPriceAlternatives: catalogModel.metadata.supplierPriceAlternatives,
          priceCheckedAt: catalog.checkedAt, priceLastAttemptAt: catalog.checkedAt },
      };
    }
    if (catalogModel?.metadata?.sub2apiPlazaPricing && model.metadata?.sub2apiPlazaPricingIncomplete === true ||
      catalogModel?.metadata?.weaiLegacyPricing && model.metadata?.weaiLegacyPricingIncomplete === true ||
      catalogModel?.metadata?.miaowuCatalogPricing && model.metadata?.miaowuCatalogPricingIncomplete === true ||
      catalogModel?.metadata?.chuangxiangCatalogPricing && model.metadata?.chuangxiangCatalogPricingIncomplete === true ||
      catalogModel?.metadata?.officialCatalogPricing && (model.metadata?.jiasuCatalogPricingIncomplete === true || model.metadata?.jijiuCatalogPricingIncomplete === true)) {
      const metadata = { ...model.metadata };
      if (catalogModel?.metadata?.sub2apiPlazaPricing) delete metadata.sub2apiPlazaPricingIncomplete;
      if (catalogModel?.metadata?.weaiLegacyPricing) delete metadata.weaiLegacyPricingIncomplete;
      if (catalogModel?.metadata?.miaowuCatalogPricing) delete metadata.miaowuCatalogPricingIncomplete;
      if (catalogModel?.metadata?.chuangxiangCatalogPricing) delete metadata.chuangxiangCatalogPricingIncomplete;
      if (catalogModel?.metadata?.jiasuCatalogPricingEvidence) delete metadata.jiasuCatalogPricingIncomplete;
      if (catalogModel?.metadata?.jijiuCatalogPricingEvidence) {
        delete metadata.jijiuCatalogPricingIncomplete; delete metadata.priceUnavailableReason;
      }
      if (metadata.priceUnavailableReason === "官方价格条件待确认") delete metadata.priceUnavailableReason;
      model = { ...model, metadata };
    }
    if (model.metadata?.supplierPriceConflict && catalogModel && !incomplete && catalogModel.metadata?.supplierPriceConflict !== true) {
      const metadata = { ...model.metadata };
      delete metadata.supplierPriceConflict; delete metadata.supplierPriceAlternatives;
      model = { ...model, metadata };
    }
    if (catalogModel?.metadata?.tk1688Catalog === true) {
      model = applyTk1688CatalogModel(model, catalogModel, catalog.checkedAt);
      // Retail marketplace prices already contain the platform markup. Keep
      // structured SKU prices and smart-route ranges from the same live feed.
      return { ...model, metadata: { ...model.metadata, tk1688CatalogStale: incomplete,
        priceStatus: incomplete ? "partial" : "available", priceLastAttemptAt: catalog.checkedAt } };
    }
    if (catalogModel?.capability === "chat" && !model.operations.length) model = { ...model, metadata: { ...model.metadata,
      supplierAgentFacts: parseProviderModelFacts(catalogModel as unknown as Record<string, unknown>),
      supplierAgentDescription: catalogModel.metadata?.supplierChannelDescription,
    } };
    if (catalogModel?.metadata || model.metadata?.supplierCatalogCheckedAt) {
      const supplierChannelDescription = catalogModel?.metadata?.supplierChannelDescription;
      model = { ...model, metadata: { ...catalogInterfaceMetadata(model, catalogModel, catalog, selected?.details?.stale === true),
        ...(supplierChannelDescription ? { supplierChannelDescription } : {}),
      } };
    }
    // Re-read saved wording as well as fresh scans so parser fixes also repair
    // existing catalogs without requiring another login or supplier refresh.
    const details = selected?.details ? {
      ...selected.details,
      ...parseSupplierGroupDetails({ name: selected.id, description: selected.details.description }, selected.details.source),
    } : undefined;
    const image = modelGenerationMediaKinds(model).includes("image");
    const video = modelGenerationMediaKinds(model).includes("video");
    if (details && image) model = { ...model, metadata: { ...model.metadata,
      supplierGroupDescription: details.description ?? "",
      supplierGroupResolutionLabel: supplierGroupResolutionLabel(details),
      imageResolutionOrigins: { ...Object.fromEntries((details.nativeResolutions ?? []).map(tier => [tier, "native"])),
        ...Object.fromEntries((details.upscaledResolutions ?? []).map(tier => [tier, "upscaled"])) },
      supplierGroupInfoSource: details.source,
      supplierGroupInfoStale: details.stale === true,
      supplierGroupCheckedAt: catalog.checkedAt,
    } };
    else if (model.metadata?.supplierGroupInfoSource && incomplete) {
      model = { ...model, metadata: { ...model.metadata, supplierGroupInfoStale: true } };
    }
    else if (model.metadata?.supplierGroupInfoSource) {
      const metadata = { ...model.metadata };
      for (const key of ["supplierGroupDescription", "supplierGroupResolutionLabel", "supplierGroupInfoSource", "supplierGroupInfoStale", "supplierGroupCheckedAt", "imageResolutionOrigins"]) delete metadata[key];
      model = { ...model, metadata };
    }
    // A text-only catalog cannot replace parameter-dependent billing rules.
    const catalogPricing = structuredCatalogPrice(catalogModel?.metadata);
    const ledgerPrices = selected?.details?.ledgerPrices ?? [];
    const freshLedger = catalogModel?.metadata?.supplierLedgerPrice ?? ledgerPrices.filter(item => item.modelId === model.id)
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
    const ledgerEvidence = freshLedger ?? (model.metadata?.priceSource === "generated-result" && model.metadata.measuredPrice);
    // A newer exact-model charge takes precedence over a generic group reference.
    // Keep it as a parameter-scoped observation rather than an advertised flat rate.
    if (image && !catalogPricing && (!catalogModel?.priceLabel || unknownPrice.test(catalogModel.priceLabel)) && !hasOwnPrice(model)) {
      const checked = freshLedger && typeof freshLedger === "object" && !Array.isArray(freshLedger)
        ? Date.parse(String((freshLedger as Record<string, unknown>).checkedAt ?? "")) : NaN;
      const retained = !freshLedger || selected?.details?.stale === true || ["failed", "unauthorized"].includes(catalog.status) ||
        Number.isFinite(checked) && checked < Date.parse(catalog.checkedAt) - 1000;
      const sampled = currentLedgerSample(model, ledgerEvidence, resolvedGroupId, group, sourceUrl, retained);
      if (sampled) return sampled;
    }
    if (model.pricing?.tiers?.some(tier => tier.conditions || tier.otherwise) && !catalogPricing && !isImportedConditionalCatalogPrice(model)) return model;
    const replacingWeAiSnapshot = canReplaceWeAiDocumentSnapshot(model, catalogModel, selected, catalog, sourceUrl);
    const friSnapshotLabel = friSnapshotPriceLabel(model, group, catalog, sourceUrl);
    const replacingMikotoSnapshot = canReplaceMikotoAutomaticSnapshot(model, catalogModel, selected, catalog, sourceUrl, resolvedGroupId);
    if (hasOwnPrice(model) && !replacingWeAiSnapshot && !friSnapshotLabel && !replacingMikotoSnapshot) return model;
    const modelPrice = prices.get(model.id);
    const priceDetails = image || video ? supplierGroupMediaPriceDetails(supplierGroupModelPriceDetails(details, model.id, groupModelIds), image ? "image" : "video", model.id) : undefined;
    const groupPrice = !priceDetails?.stale ? supplierGroupPriceLabel(priceDetails) : "";
    const groupFixedLabel = groupPrice.replace(/（分组说明参考）$/u, "").trim().replace(/\s*(?:分组|通道|专线)$/u, "").trim();
    // Group wording may contain several resolution or quality rates. Only an
    // entire explicit currency/unit quote can become a flat estimate.
    const groupFixedPrice = /^(?:[¥￥$]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|USD|CNY|RMB|美元))\s*[/／]\s*(?:张|次|请求|秒)$/iu.test(groupFixedLabel)
      ? groupFixedLabel : undefined;
    const fresh = modelPrice || groupPrice;
    const scopedGroupPrice = model.metadata?.priceSource === "supplier-group" && priceDetails !== details;
    const pricing = catalogPricing ?? pricingFromSupplierEvidence(modelPrice || groupFixedPrice, priceDetails, catalog.checkedAt, sourceUrl) ??
      (incomplete && !fresh && !scopedGroupPrice ? model.pricing : undefined);
    const missingCurrentVideoQuote = !incomplete && video &&
      (isSecureCatalogSite(sourceUrl) && !pricing || !fresh &&
        (isHangCatalogSite(sourceUrl) || /^https:\/\/api\.miaowuai\.store(?:\/|$)/u.test(sourceUrl ?? "") &&
          ["dreamina-seedance-2.0-fast", "dreamina-seedance-2.0-mini", "seedance-2.0-fast-deal", "seedance-2.5-deal", "video-editing"].includes(model.id)));
    const priceEvidenceSource = isSecureCatalogSite(sourceUrl) ? "https://token.secure-skill.com/api/v1/pricing/channels" :
      isHangCatalogSite(sourceUrl) ? "https://price.hangzhale.com/api/provider/pricing" : "https://api.miaowuai.store/api/pricing";
    const old =
      !scopedGroupPrice &&
      ["supplier-catalog", "supplier-group"].includes(String(model.metadata?.priceSource)) &&
      typeof model.metadata?.priceLabel === "string" &&
      !unknownPrice.test(model.metadata.priceLabel)
        ? model.metadata.priceLabel.replace(/（上次价格）$/u, "")
        : undefined;
    const priceLabel =
      fresh ||
      (old && incomplete
        ? `${old}（上次价格）`
        : reason);
    const previous =
      typeof model.metadata?.priceLabel === "string"
        ? model.metadata.priceLabel
        : "";
    let name = model.name;
    if (replacingMikotoSnapshot && /^GPT Image 2（原生4K(?:组 | · )\$0\.08\/张）$/u.test(name)) name = "GPT Image 2（原生4K）";
    if (friSnapshotLabel && name.endsWith(`（${friSnapshotLabel}·快照）`)) name = name.slice(0, -(`（${friSnapshotLabel}·快照）`).length);
    // The dedicated We-AI reader appended both the old quote and this exact
    // size suffix. Remove only that generated suffix after its quote is replaced.
    const oldWeAiLabel = replacingWeAiSnapshot ? previous : importedWeAiDocsNameLabel(model, catalogModel, selected, catalog, sourceUrl);
    const oldWeAiSuffix = `（${oldWeAiLabel}${/^gpt-image-2(?:-|$)/u.test(model.id) ? " · 1K/2K/4K" : ""}）`;
    if (oldWeAiLabel && name.endsWith(oldWeAiSuffix))
      name = name.slice(0, -oldWeAiSuffix.length);
    else if (previous && name.includes(`（${previous}）`))
      name = name.replace(`（${previous}）`, "");
    name = name.replace(
      /[（(](?:价格以(?:平台|模型广场)为准|价格未公布|价格查询失败|价格需登录查询|价格未查询)(?:·快照)?[）)]/gu,
      "",
    );
    const pricedModel: ModelDescriptor = {
      ...model,
      name,
      pricing,
      metadata: {
        ...model.metadata,
        priceLabel,
        priceSource: old && !fresh && incomplete ? model.metadata?.priceSource : !modelPrice && groupPrice ? "supplier-group" : "supplier-catalog",
        priceStatus: fresh
          ? "available"
          : catalog.complete === false
            ? "partial"
          : reason === "价格未公布"
            ? "unpublished"
            : catalog.status,
        priceCheckedAt: old && !fresh && incomplete ? model.metadata?.priceCheckedAt : catalogPricing?.checkedAt || catalog.checkedAt,
        priceLastAttemptAt: catalog.checkedAt,
        supplierPriceGroup: group,
        ...groupIdentityMetadata,
        ...(catalogModel?.metadata?.jijiuCatalogPricingEvidence ? { jijiuCatalogPricingEvidence: catalogModel.metadata.jijiuCatalogPricingEvidence } : {}),
        ...(missingCurrentVideoQuote ? { priceSourceUrl: priceEvidenceSource,
          priceUnavailableReason: `${catalog.checkedAt} 已查询 ${priceEvidenceSource}：当前分组 ${group} ${fresh
            ? `未提供完整型号 ${model.id} 可解析的计价规则` : `未列出完整型号 ${model.id} 的报价`}` } : {}),
      },
    };
    // These optional Doubao resolutions are opened per official group. Only
    // this freshly selected, exact-model quote can add its conditional tiers;
    // older metadata and another group's prices cannot grant the extra modes.
    if (isSecureCatalogSite(sourceUrl) && catalog.status === "live" && selected?.source === "catalog" &&
      selected.details?.stale !== true && catalogModel?.metadata?.supplierCatalogModelStale !== true &&
      catalogModel?.metadata?.supplierPriceConflict !== true && catalogPricing?.confidence === "exact" &&
      catalogPricing.sourceUrl === "https://token.secure-skill.com/api/v1/pricing/channels" &&
      (!catalogPricing.validUntil || Date.parse(catalogPricing.validUntil) >= Date.parse(catalog.checkedAt)) &&
      model.metadata?.supplier === "secure" && model.metadata?.protocol === "openai-videos" &&
      model.metadata?.source !== "manual" && model.metadata?.protocolEvidence !== "paid-test" &&
      video && ["doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628"].includes(model.id)) {
      const resolutions = [...new Set((catalogPricing.tiers ?? []).filter(tier =>
        Number.isFinite(tier.price) && tier.price >= 0 && tier.otherwise !== true &&
        tier.conditionMode !== "any" && tier.conditionMode !== "none" &&
        tier.conditions?.some(condition => condition.parameter === "token_kind" && condition.operator === "equals" && condition.value === "output"))
        .flatMap(tier => (tier.conditions ?? []).filter(condition => condition.parameter === "resolution" && condition.operator === "equals" &&
          ["480p", "4K"].includes(condition.value)).map(condition => condition.value)))];
      return remainingVideoModel("secure", model.id, { ...pricedModel,
        metadata: { ...pricedModel.metadata, videoSupportedResolutions: resolutions } }, { group }) ?? pricedModel;
    }
    return pricedModel;
  });
  return applySupplierModelAvailability(priced, group, catalog, sourceUrl, options.supplierGroupId);
}

/** Only model-scoped lines can supply a documented price. */
export function applyDocumentedModelPrice(model: ModelDescriptor, document: string | undefined, sourceUrl: string): ModelDescriptor {
  if (model.metadata?.catalogPriceEvidence && typeof model.metadata.catalogPriceEvidence === "object" &&
    (model.metadata.catalogPriceEvidence as { schemaVersion?: unknown }).schemaVersion === 1) return model;
  // A live expression we cannot interpret is not permission to flatten an
  // older prose/example price from the same site into a fixed request rate.
  if (model.metadata?.jijiuCatalogPricingIncomplete === true) return model;
  if (model.pricing || (typeof model.metadata?.priceLabel === "string" && !unknownPrice.test(model.metadata.priceLabel) && model.metadata.priceSource !== "generated-result")) return model;
  const scoped = [model.description, model.metadata?.supplierChannelDescription,
    ...((document ?? "").split(/\n/u).filter(line => supplierTextMentionsModel(line, model.id)))].filter(value => typeof value === "string").join("\n");
  const labels = [...scoped.matchAll(/(?:[¥￥$]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|USD|CNY|RMB|美元))\s*[/／]\s*(?:张|次|请求)/giu)].map(match => match[0]);
  if (!labels.length) return model;
  const label = [...new Set(labels)].join(" · ");
  const checkedAt = new Date().toISOString();
  const simple = labels.length === 1 && !/1K|2K|4K|quality|low|medium|high|max|起|优惠|充值|量大/iu.test(scoped);
  return { ...model, pricing: simple ? pricingFromSupplierEvidence(label, undefined, checkedAt, sourceUrl) : undefined,
    metadata: { ...model.metadata, priceLabel: simple ? label : scoped.slice(0, 1000), priceSource: "supplier-document", priceCheckedAt: checkedAt, priceSourceUrl: sourceUrl } };
}

async function documentedPrices(models: readonly ModelDescriptor[], siteUrl: string, allowNetwork: boolean) {
  return Promise.all(models.map(async model => {
    const source = String(model.metadata?.documentationUrl ?? model.metadata?.docsUrl ?? siteUrl);
    const local = applyDocumentedModelPrice(model, undefined, source);
    const needsDocument = !local.pricing && (typeof local.metadata?.priceLabel !== "string" || unknownPrice.test(local.metadata.priceLabel) || local.metadata.priceSource === "generated-result");
    return needsDocument && allowNetwork ? applyDocumentedModelPrice(local, await readSupplierDocument(siteUrl, local), source) : local;
  }));
}

function retainedPriceOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["https://genimage.pro", "https://vapi.chuangxiangai.asia"].includes(url.origin) &&
      !url.username && !url.password && !url.search && !url.hash ? url.origin : undefined;
  } catch { return undefined; }
}

/** This fallback has already passed the supplier source and stable-group join.
 * A failed independent price read must not discard that exact saved quote.
 */
function reusableSavedQuote(model: ModelDescriptor, group: string, officialGroupId: string | undefined, origin: string): boolean {
  const pricing = model.pricing;
  return !!pricing && retainedPriceOrigin(pricing.sourceUrl ?? "") === origin &&
    Number.isFinite(Date.parse(pricing.checkedAt)) &&
    (typeof pricing.unitAmount === "number" && Number.isFinite(pricing.unitAmount) && pricing.unitAmount >= 0 ||
      !!pricing.tiers?.length && pricing.tiers.every(tier => Number.isFinite(tier.price) && tier.price >= 0) ||
      pricing.kind === "token" && [pricing.inputPerMillion, pricing.outputPerMillion, pricing.imageOutputPerMillion]
        .some(value => typeof value === "number" && Number.isFinite(value) && value >= 0)) &&
    ["supplier-catalog", "supplier-group"].includes(String(model.metadata?.priceSource)) &&
    (officialGroupId ? model.metadata?.supplierPriceGroupId === officialGroupId : model.metadata?.supplierPriceGroup === group);
}

function retainFailedPriceAttempt(previous: ModelDescriptor, priced: ModelDescriptor, group: string,
  officialGroupId: string | undefined, origin: string): ModelDescriptor {
  const attemptedAt = Date.parse(String(previous.metadata?.priceLastAttemptAt ?? ""));
  const quoteAt = Date.parse(String(priced.metadata?.priceCheckedAt ?? priced.pricing?.checkedAt ?? ""));
  if (!reusableSavedQuote(priced, group, officialGroupId, origin) ||
    !["failed", "unauthorized", "partial"].includes(String(previous.metadata?.priceStatus)) ||
    !Number.isFinite(attemptedAt) || !Number.isFinite(quoteAt) || attemptedAt <= quoteAt) return priced;
  const label = typeof priced.metadata?.priceLabel === "string" ? priced.metadata.priceLabel : undefined;
  return { ...priced, metadata: { ...priced.metadata,
    ...(label && !unknownPrice.test(label) ? { priceLabel: `${label.replace(/（上次价格）$/u, "")}（上次价格）` } : {}),
    priceStatus: "partial", priceLastAttemptAt: previous.metadata!.priceLastAttemptAt,
    priceLastAttemptStatus: previous.metadata!.priceLastAttemptStatus ?? previous.metadata!.priceStatus } };
}

/** Every model scan (including newly added suppliers) passes through this lookup. */
export async function enrichSupplierModelPrices(
  connection: Connection,
  models: readonly ModelDescriptor[],
  force = false,
  allowNetwork = true,
  readOptions: SupplierPriceReadOptions = {},
): Promise<ModelDescriptor[]> {
  if (!models.length) return [...models];
  if (models.every(model => model.provider === "langframe" && model.metadata?.langframeCatalog === true)) return [...models];
  const supplier = "savedSupplier" in readOptions ? readOptions.savedSupplier ?? null :
    typeof connection.config.supplierId === "string"
      ? await getSupplierRecord(connection.config.supplierId)
      : null;
  const apiUrl = String(connection.config.baseUrl ?? "");
  if (!apiUrl) return [...models];
  // Never join the saved catalog/login after the API source has changed.
  const sameSource =
    supplier &&
    normalizeSupplierSiteBase(supplier.apiUrl) ===
      normalizeSupplierSiteBase(apiUrl) &&
    (!connection.config.supplierSourceId ||
      connection.config.supplierSourceId === supplier.state?.sourceId);
  const group = String(
    connection.config.accountKeyGroup ?? connection.config.modelGroup ?? "默认群组",
  );
  const supplierGroupId = sameSource ? String(connection.config.accountKeyGroupId ??
    supplier.catalog.groups.find(item => item.id === group)?.supplierGroupId ?? "") : undefined;
  const renameRecord = connection.config.supplierGroupRenameEvidence;
  const keyPriceContext: CatalogPriceOptions = sameSource && renameRecord && typeof renameRecord === "object" && !Array.isArray(renameRecord)
    ? { sourceId: supplier.state?.sourceId, accountKeyId: String(connection.config.accountKeyId ?? ""),
      keyGroupRenameEvidence: renameRecord as KeyGroupRenameEvidence } : {};
  const officialPriceGroupId = /^\d+$/u.test(supplierGroupId ?? "") ? supplierGroupId : undefined;
  const savedPriceGroups = sameSource ? supplier.catalog.groups.filter(row => officialPriceGroupId
    ? row.supplierGroupId === officialPriceGroupId : row.id === group) : [];
  // NewAPI's unnumbered group keys are official identities. Numbered Sub2API
  // groups use their stable ID even after a display-name change.
  const retainedOrigin = retainedPriceOrigin(apiUrl);
  const savedPriceScope = !!(sameSource && retainedOrigin && retainedPriceOrigin(supplier.siteUrl || supplier.apiUrl) === retainedOrigin &&
    typeof connection.config.supplierSourceId === "string" && connection.config.supplierSourceId &&
    connection.config.supplierSourceId === supplier.state?.sourceId && savedPriceGroups.length === 1);
  const savedPriceCatalog = (): SupplierCatalogDiscovery => ({
    groups: supplier!.catalog.groups.map(row => ({ ...row, source: "catalog", models: row.models.map(model => ({ ...model,
      protocol: model.protocol === "rest" ? "unknown" : model.protocol })) })), kind: supplier!.kind,
    status: supplier!.scanStatus === "unscanned" ? "failed" : supplier!.scanStatus,
    complete: supplier!.scanComplete === true, checkedAt: supplier!.scannedAt ?? supplier!.updatedAt,
  });
  const savedMeasured = (result: ModelDescriptor[]) => sameSource && supplierGroupId
    ? applySavedMeasuredPrices(result, connection.config, { sourceId: supplier.state?.sourceId ?? "legacy", supplierGroupId, apiUrl }) : result;
  const exampleContext = readOptions.jiasuApiExampleContext;
  // This server-only context carries the just-read public directory across a
  // Key scan even when there was no account synchronization/pre-commit.
  const currentExampleCatalog = sameSource && isJiasuApiUrl(apiUrl) && exampleContext && readOptions.refreshId &&
    exampleContext.supplierId === supplier.id && exampleContext.sourceId === supplier.state?.sourceId &&
    connection.config.supplierSourceId === exampleContext.sourceId && exampleContext.refreshId === readOptions.refreshId &&
    supplier.state?.scanId === exampleContext.refreshId ? { ...exampleContext.catalog,
      groups: exampleContext.catalog.groups.map(group => ({ ...group, models: group.models.filter(model =>
        model.metadata?.jiasuApiExampleRefreshId === exampleContext.refreshId &&
        model.metadata?.jiasuApiExampleCheckedAt === exampleContext.catalog.checkedAt) })) } : undefined;
  // The supplier scan saves current public JS evidence before its Key reads.
  // Carry it across first; an independent price read cannot erase that body.
  if (sameSource && isJiasuApiUrl(apiUrl)) {
    const savedCatalog: SupplierCatalogDiscovery = currentExampleCatalog ?? { kind: supplier.kind,
      status: supplier.scanStatus === "unscanned" ? "failed" : supplier.scanStatus,
      complete: supplier.scanComplete === true, checkedAt: supplier.scannedAt ?? supplier.updatedAt,
      groups: supplier.catalog.groups.map(group => ({ ...group, source: "catalog", models: group.models.map(model => ({ ...model,
        protocol: model.protocol === "rest" ? "unknown" : model.protocol })) })) };
    const candidates = /^\d+$/u.test(supplierGroupId ?? "") ? savedCatalog.groups.filter(row => row.supplierGroupId === supplierGroupId)
      : savedCatalog.groups.filter(row => row.id === group);
    const currentGroups = candidates.filter(row => row.details?.stale !== true);
    const selected = currentGroups.length === 1 ? currentGroups[0] : undefined;
    if (selected) models = models.map(model => ({ ...model,
      metadata: jiasuExampleMetadata(model, selected.models.find(row => row.id === model.id), savedCatalog, false, supplier.siteUrl || apiUrl) }));
  }
  if (!allowNetwork || (!force && models.every(hasOwnPrice))) {
    let catalogModels = sameSource ? applySupplierCatalogPrices(models,
      group,
      { groups: supplier.catalog.groups.map(group => ({ ...group, source: "catalog", models: group.models.map(model => ({ ...model, protocol: model.protocol === "rest" ? "unknown" : model.protocol })) })),
        kind: supplier.kind, status: supplier.scanStatus === "unscanned" ? "failed" : supplier.scanStatus,
        complete: supplier.scanComplete === true,
        checkedAt: supplier.scannedAt ?? supplier.updatedAt }, supplier.siteUrl || supplier.apiUrl, { savedCatalog: true, supplierGroupId, ...keyPriceContext }) : [...models];
    if (savedPriceScope) catalogModels = catalogModels.map((model, index) =>
      retainFailedPriceAttempt(models[index]!, model, group, officialPriceGroupId, retainedOrigin!));
    return savedMeasured(await applyMeasuredSupplierPrices(sameSource ? supplier.id : undefined, await documentedPrices(catalogModels, supplier?.siteUrl || apiUrl, false), group, supplier?.state?.sourceId ?? "legacy", supplierGroupId || undefined));
  }
  const siteUrl = sameSource
    ? supplier.siteUrl
    : (!supplier ? String(connection.config.supplierWebsiteUrl ?? "") : "") ||
      normalizeSupplierSiteBase(apiUrl);
  const kind = sameSource ? supplier.kind : "auto";
  const login =
    sameSource &&
    supplier.state?.siteLogin?.siteUrl === supplierDirectoryBase(siteUrl)
      ? supplier.state.siteLogin
      : undefined;
  const key = JSON.stringify([
    siteUrl,
    apiUrl,
    kind,
    sameSource ? supplier.state?.sourceId : "",
    supplierSiteLoginCacheIdentity(login),
  ]);
  const refreshKey = force && readOptions.refreshId ? JSON.stringify([key, readOptions.refreshId]) : undefined;
  let cached = force ? refreshKey ? refreshCache.get(refreshKey) : undefined : cache.get(key);
  // Only this explicit operation may share its read across groups; another operation is always fresh.
  if (
    !cached ||
    cached.until <= Date.now()
  ) {
    const result = (async (): Promise<SupplierCatalogDiscovery> => {
      try {
        const session = login
          ? await openSupplierSiteSession({ siteUrl, kind, state: supplier?.state })
          : undefined;
        const deadline = AbortSignal.timeout(12000);
        const fetcher = session?.fetch ?? providerFetch;
        // Only receipts from this exact supplier scan can avoid a second JS
        // download. Old saved evidence retains its time and needs a fresh read.
        const reusedJiasuApiExamples = sameSource && isJiasuApiUrl(apiUrl) && readOptions.refreshId && readOptions.refreshId === supplier.state?.scanId
          ? (currentExampleCatalog?.groups ?? supplier.catalog.groups).filter(group => group.details?.stale !== true).flatMap(group => group.models.flatMap(model => {
            const source = model.metadata, nested = source?.jiasuCatalogRecord as { apiExampleContract?: unknown } | undefined;
            const contract = latestJiasuVideoApiExampleContract(model.id, source?.jiasuApiExampleContract, nested?.apiExampleContract);
            return source && source.jiasuApiExampleRefreshId === readOptions.refreshId && source.jiasuApiExampleScanStatus === "live" &&
              contract?.sourceStatus === "live" && source.jiasuApiExampleCheckedAt === contract.checkedAt
              ? [{ groupId: group.id, ...(group.supplierGroupId ? { supplierGroupId: group.supplierGroupId } : {}), contract }] : [];
          })) : undefined;
        return await discoverSupplierCatalog(
          { siteUrl, apiUrl, kind: session?.kind ?? kind, signal: deadline,
            ...(reusedJiasuApiExamples?.length ? { refreshId: readOptions.refreshId, reusedJiasuApiExamples } : {}) },
          (url, init) =>
            fetcher(url, {
              ...init,
              signal: AbortSignal.any([
                deadline,
                ...(init?.signal ? [init.signal] : []),
              ]),
            }),
        );
      } catch (error) {
        return {
          groups: [],
          kind,
          status: error instanceof SupplierLoginError &&
            ["invalid_credentials", "invalid_token", "permission_denied", "user_id_required", "verification_required"].includes(error.code)
            ? "unauthorized" : "failed",
          checkedAt: new Date().toISOString(),
        };
      }
    })();
    cached = { until: Date.now() + 300000, result };
    if (cache.size >= 100 && !cache.has(key)) cache.delete(cache.keys().next().value!);
    cache.set(key, cached);
    if (refreshKey) {
      if (refreshCache.size >= 100 && !refreshCache.has(refreshKey)) refreshCache.delete(refreshCache.keys().next().value!);
      refreshCache.set(refreshKey, cached);
    }
  }
  const discovered = await cached.result;
  // Retry on the next user operation, while all groups in this explicit
  // operation share its partial result instead of repeatedly reading the site.
  if (["failed", "unauthorized"].includes(discovered.status) || discovered.complete === false) {
    if (cache.get(key) === cached) cache.delete(key);
  }
  let priceCandidates = models;
  if (savedPriceScope && (["failed", "unauthorized"].includes(discovered.status) || discovered.complete === false)) {
    const retained = applySupplierCatalogPrices(models, group, savedPriceCatalog(), supplier!.siteUrl || supplier!.apiUrl,
      { savedCatalog: true, supplierGroupId, ...keyPriceContext });
    priceCandidates = retained.map((model, index) => savedPriceGroups[0]!.models.some(row => row.id === model.id) &&
      reusableSavedQuote(model, group, officialPriceGroupId, retainedOrigin!) ? model : models[index]!);
  }
  let catalogModels = applySupplierCatalogPrices(
    priceCandidates,
    group,
    discovered,
    siteUrl,
    { supplierGroupId, ...keyPriceContext },
  );
  if (savedPriceScope && (["failed", "unauthorized"].includes(discovered.status) || discovered.complete === false)) {
    catalogModels = catalogModels.map(model => reusableSavedQuote(model, group, officialPriceGroupId, retainedOrigin!) &&
      Date.parse(model.pricing!.checkedAt) < Date.parse(discovered.checkedAt)
      ? { ...model, metadata: { ...model.metadata, priceStatus: "partial",
        priceLastAttemptStatus: ["failed", "unauthorized"].includes(discovered.status) ? discovered.status : "partial" } }
      : model);
  } else if (savedPriceScope) {
    catalogModels = catalogModels.map(model => {
      if (model.metadata?.priceStatus !== "available" || model.metadata.priceLastAttemptStatus === undefined) return model;
      const metadata = { ...model.metadata }; delete metadata.priceLastAttemptStatus;
      return { ...model, metadata };
    });
  }
  return savedMeasured(await applyMeasuredSupplierPrices(sameSource ? supplier.id : undefined, await documentedPrices(catalogModels, siteUrl, allowNetwork), group, supplier?.state?.sourceId ?? "legacy", supplierGroupId || undefined));
}

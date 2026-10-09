import { pricingFromSupplierEvidence } from "./supplier-price-evidence";
import {
  discoverSupplierCatalog,
  normalizeSupplierSiteBase,
  supplierDirectoryBase,
  providerFetch,
  SupplierLoginError,
  type ModelDescriptor,
  type SupplierCatalogDiscovery,
  parseProviderModelFacts,
} from "@super-canvas/providers";
import { isCyberAfeiUnpricedCatalogVideo } from "@super-canvas/providers/cyberafei-catalog-evidence";
import { modelGenerationMediaKinds } from "@super-canvas/providers/model-media";
import { parseSupplierGroupDetails, supplierGroupModelPriceDetails, supplierGroupPriceLabel, supplierGroupResolutionLabel, supplierTextMentionsModel } from "@super-canvas/providers/supplier-group-details";
import { getSupplierRecord } from "./supplier-service";
import { openSupplierSiteSession, supplierSiteLoginCacheIdentity } from "./supplier-site-session";
import { repository } from "./server";
import { readSupplierDocument } from "./supplier-document";
import { applyTk1688CatalogModel } from "./tk1688-catalog";

type Connection = { config: Readonly<Record<string, unknown>> };
const unknownPrice =
  /价格以(?:平台|模型广场)为准|价格未公布|价格查询失败|价格需登录查询|价格未查询/u;
type CatalogCacheEntry = { until: number; result: Promise<SupplierCatalogDiscovery> };
const cache = new Map<
  string,
  CatalogCacheEntry
>();
const refreshCache = new Map<string, CatalogCacheEntry>();
export interface SupplierPriceReadOptions { refreshId?: string }
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
      source.origin === "https://api.miaowuai.store" && source.pathname === "/api/pricing" ||
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
): ReadonlyMap<string, MeasuredPrice> {
  const latest = new Map<string, { at: number; value: MeasuredPrice }>();
  for (const test of record?.cases ?? []) {
    if (test.status !== "succeeded" || (record?.sourceId && test.sourceId !== record.sourceId)) continue;
    const modelId = typeof test.modelId === "string" ? test.modelId.trim() : "";
    const group = typeof test.group === "string" ? test.group.trim() : "";
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
): Promise<ModelDescriptor[]> {
  if (!supplierId || !models.length) return [...models];
  let record: Awaited<ReturnType<typeof repository.getSupplierVerification>>;
  try {
    record = await repository.getSupplierVerification?.(supplierId);
  } catch {
    // A price lookup must never make an otherwise valid model scan fail.
    return [...models];
  }
  if (!record || record.sourceId !== sourceId) return [...models];
  const measured = measuredPricesFromVerification(record);
  if (!measured.size) return [...models];
  return models.map((model) => {
    if (model.metadata?.priceSource !== "generated-result" &&
      (model.pricing || (typeof model.metadata?.priceLabel === "string" && model.metadata.priceLabel.trim() && !unknownPrice.test(model.metadata.priceLabel)))) return model;
    const image =
      model.operations.some((operation) => operation.startsWith("image.")) ||
      /image|dall[-_]?e|flux|seedream|imagen/iu.test(model.id);
    if (!image) return model;
    const evidence = measured.get(`${group}\u0000${model.id}`);
    if (!evidence) return model;
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
      },
    };
  });
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

/** Join by exact group and exact model ID; a public plaza never grants availability. */
export function applySupplierCatalogPrices(
  models: readonly ModelDescriptor[],
  group: string,
  catalog: SupplierCatalogDiscovery,
  sourceUrl?: string,
  options: { savedCatalog?: boolean } = {},
): ModelDescriptor[] {
  const selected = catalog.groups.find((g) => g.id === group);
  const generic =
    !selected &&
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
  return models.map((model) => {
    const catalogModel = (selected ?? generic)?.models.find(item => item.id === model.id);
    if (["manual", "generated-result"].includes(String(model.metadata?.priceSource)) && model.pricing) return model;
    // Hang's separate board has ambiguous image/token currency declarations.
    // Its new chat feed must not overwrite an existing media quote.
    if (isHangCatalogSite(sourceUrl) && model.pricing && modelGenerationMediaKinds(model).length) return model;
    if (isWeAiCatalogSite(sourceUrl) && model.metadata?.priceSource === "generated-result" && model.pricing) return model;
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
    const incompletePricingFields = ["weaiLegacyPricingIncomplete", "sub2apiPlazaPricingIncomplete", "miaowuCatalogPricingIncomplete", "chuangxiangCatalogPricingIncomplete"].filter(field => catalogModel?.metadata?.[field] === true);
    if (incompletePricingFields.length && !hasOwnPrice(model)) {
      const metadata = { ...model.metadata };
      delete metadata.weaiLegacyPricing; delete metadata.sub2apiPlazaPricing; delete metadata.miaowuCatalogPricing;
      return { ...model, pricing: undefined, metadata: { ...metadata, priceLabel: "价格条件待确认", priceSource: "supplier-catalog",
        priceStatus: "unconfirmed", ...Object.fromEntries(incompletePricingFields.map(field => [field, true])), priceUnavailableReason: "官方价格条件待确认",
        priceCheckedAt: catalog.checkedAt, priceLastAttemptAt: catalog.checkedAt, supplierPriceGroup: group } };
    }
    if (catalogModel?.metadata?.supplierCatalogModelStale === true && !hasOwnPrice(model)) {
      const retainedPricing = structuredCatalogPrice(catalogModel.metadata);
      const retainedCheckedAt = retainedPricing?.checkedAt ?? catalogModel.metadata.supplierCatalogPriceCheckedAt;
      const retainedAt = Date.parse(String(retainedCheckedAt ?? ""));
      const sameGroupPrice = priceGroup === group && typeof model.metadata?.priceLabel === "string" && !unknownPrice.test(model.metadata.priceLabel) &&
        (!Number.isFinite(retainedAt) || Number.isFinite(priceAt) && priceAt >= retainedAt);
      const label = sameGroupPrice ? String(model.metadata!.priceLabel) : catalogModel.priceLabel;
      const previousPricing = sameGroupPrice ? model.pricing : retainedPricing;
      const checkedAt = sameGroupPrice ? model.metadata?.priceCheckedAt ?? previousPricing?.checkedAt :
        retainedCheckedAt;
      const priced = typeof label === "string" && !unknownPrice.test(label);
      return { ...model, pricing: priced ? previousPricing ?? pricingFromSupplierEvidence(label, undefined, String(checkedAt ?? ""), sourceUrl) : undefined,
        metadata: { ...catalogInterfaceMetadata(model, catalogModel, catalog, true),
          priceLabel: priced ? `${label.replace(/（上次价格）$/u, "")}（上次价格）` : reason,
          priceSource: "supplier-catalog", supplierPriceGroup: group, priceStatus: "partial",
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
      catalogModel?.metadata?.chuangxiangCatalogPricing && model.metadata?.chuangxiangCatalogPricingIncomplete === true) {
      const metadata = { ...model.metadata };
      if (catalogModel?.metadata?.sub2apiPlazaPricing) delete metadata.sub2apiPlazaPricingIncomplete;
      if (catalogModel?.metadata?.weaiLegacyPricing) delete metadata.weaiLegacyPricingIncomplete;
      if (catalogModel?.metadata?.miaowuCatalogPricing) delete metadata.miaowuCatalogPricingIncomplete;
      if (catalogModel?.metadata?.chuangxiangCatalogPricing) delete metadata.chuangxiangCatalogPricingIncomplete;
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
    const image = model.operations.some(operation => operation.startsWith("image.")) || /image|dall[-_]?e|flux|seedream|imagen/iu.test(model.id);
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
    if (model.pricing?.tiers?.some(tier => tier.conditions || tier.otherwise) && !catalogPricing && !isImportedConditionalCatalogPrice(model)) return model;
    const replacingWeAiSnapshot = canReplaceWeAiDocumentSnapshot(model, catalogModel, selected, catalog, sourceUrl);
    const friSnapshotLabel = friSnapshotPriceLabel(model, group, catalog, sourceUrl);
    if (hasOwnPrice(model) && !replacingWeAiSnapshot && !friSnapshotLabel) return model;
    const modelPrice = prices.get(model.id);
    const priceDetails = image ? supplierGroupModelPriceDetails(details, model.id, groupModelIds) : undefined;
    const groupPrice = !priceDetails?.stale ? supplierGroupPriceLabel(priceDetails) : "";
    const fresh = modelPrice || groupPrice;
    const scopedGroupPrice = model.metadata?.priceSource === "supplier-group" && priceDetails !== details;
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
    return {
      ...model,
      name,
      pricing: catalogPricing ?? pricingFromSupplierEvidence(modelPrice, priceDetails, catalog.checkedAt, sourceUrl) ?? (incomplete && !fresh && !scopedGroupPrice ? model.pricing : undefined),
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
      },
    };
  });
}

/** Only model-scoped lines can supply a documented price. */
export function applyDocumentedModelPrice(model: ModelDescriptor, document: string | undefined, sourceUrl: string): ModelDescriptor {
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

/** Every model scan (including newly added suppliers) passes through this lookup. */
export async function enrichSupplierModelPrices(
  connection: Connection,
  models: readonly ModelDescriptor[],
  force = false,
  allowNetwork = true,
  readOptions: SupplierPriceReadOptions = {},
): Promise<ModelDescriptor[]> {
  if (!models.length) return [...models];
  const supplier =
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
  if (!allowNetwork || (!force && models.every(hasOwnPrice))) {
    const catalogModels = sameSource ? applySupplierCatalogPrices(models,
      group,
      { groups: supplier.catalog.groups.map(group => ({ ...group, source: "catalog", models: group.models.map(model => ({ ...model, protocol: model.protocol === "rest" ? "unknown" : model.protocol })) })),
        kind: supplier.kind, status: supplier.scanStatus === "unscanned" ? "failed" : supplier.scanStatus,
        complete: supplier.scanComplete === true,
        checkedAt: supplier.scannedAt ?? supplier.updatedAt }, supplier.siteUrl || supplier.apiUrl, { savedCatalog: true }) : [...models];
    return applyMeasuredSupplierPrices(sameSource ? supplier.id : undefined, await documentedPrices(catalogModels, supplier?.siteUrl || apiUrl, false), group, supplier?.state?.sourceId ?? "legacy");
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
        return await discoverSupplierCatalog(
          { siteUrl, apiUrl, kind: session?.kind ?? kind, signal: deadline },
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
  const catalogModels = applySupplierCatalogPrices(
    models,
    group,
    discovered,
    siteUrl,
  );
  return applyMeasuredSupplierPrices(sameSource ? supplier.id : undefined, await documentedPrices(catalogModels, siteUrl, allowNetwork), group, supplier?.state?.sourceId ?? "legacy");
}

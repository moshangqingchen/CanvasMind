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
import { parseSupplierGroupDetails, supplierGroupPriceLabel, supplierGroupResolutionLabel } from "@super-canvas/providers/supplier-group-details";
import { getSupplierRecord } from "./supplier-service";
import { openSupplierSiteSession, supplierSiteLoginCacheIdentity } from "./supplier-site-session";
import { repository } from "./server";
import { readSupplierDocument } from "./supplier-document";

type Connection = { config: Readonly<Record<string, unknown>> };
const unknownPrice =
  /价格以(?:平台|模型广场)为准|价格未公布|价格查询失败|价格需登录查询|价格未查询/u;
const cache = new Map<
  string,
  { until: number; result: Promise<SupplierCatalogDiscovery> }
>();
const hasOwnPrice = (model: ModelDescriptor) =>
  !["supplier-catalog", "supplier-group", "generated-result", "supplier-document"].includes(String(model.metadata?.priceSource)) &&
  (Boolean(model.pricing) ||
    (typeof model.metadata?.priceLabel === "string" &&
      !unknownPrice.test(model.metadata.priceLabel)));

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

/** Join by exact group and exact model ID; a public plaza never grants availability. */
export function applySupplierCatalogPrices(
  models: readonly ModelDescriptor[],
  group: string,
  catalog: SupplierCatalogDiscovery,
  sourceUrl?: string,
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
  return models.map((model) => {
    const catalogModel = (selected ?? generic)?.models.find(item => item.id === model.id);
    if (catalogModel?.capability === "chat" && !model.operations.length) model = { ...model, metadata: { ...model.metadata,
      supplierAgentFacts: parseProviderModelFacts(catalogModel as unknown as Record<string, unknown>),
      supplierAgentDescription: catalogModel.metadata?.supplierChannelDescription,
    } };
    if (catalogModel?.metadata) {
      const { endpointTypes, documentationUrl, supplierChannelDescription } = catalogModel.metadata;
      model = { ...model, metadata: { ...model.metadata,
        ...(endpointTypes && !model.metadata?.endpointTypes ? { endpointTypes } : {}),
        ...(documentationUrl && !model.metadata?.documentationUrl ? { documentationUrl } : {}),
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
      supplierGroupInfoSource: details.source,
      supplierGroupInfoStale: details.stale === true,
      supplierGroupCheckedAt: catalog.checkedAt,
    } };
    else if (model.metadata?.supplierGroupInfoSource && incomplete) {
      model = { ...model, metadata: { ...model.metadata, supplierGroupInfoStale: true } };
    }
    else if (model.metadata?.supplierGroupInfoSource) {
      const metadata = { ...model.metadata };
      for (const key of ["supplierGroupDescription", "supplierGroupResolutionLabel", "supplierGroupInfoSource", "supplierGroupInfoStale", "supplierGroupCheckedAt"]) delete metadata[key];
      model = { ...model, metadata };
    }
    // A text-only catalog cannot replace parameter-dependent billing rules.
    if (model.pricing?.tiers?.some(tier => tier.conditions || tier.otherwise)) return model;
    if (hasOwnPrice(model) && !(model.pricing?.checkedAt && Date.parse(catalog.checkedAt) > Date.parse(model.pricing.checkedAt) && prices.has(model.id))) return model;
    const modelPrice = prices.get(model.id);
    const groupPrice = image && !details?.stale ? supplierGroupPriceLabel(details) : "";
    const fresh = modelPrice || groupPrice;
    const old =
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
    if (previous && name.includes(`（${previous}）`))
      name = name.replace(`（${previous}）`, "");
    name = name.replace(
      /[（(](?:价格以(?:平台|模型广场)为准|价格未公布|价格查询失败|价格需登录查询|价格未查询)(?:·快照)?[）)]/gu,
      "",
    );
    return {
      ...model,
      name,
      pricing: pricingFromSupplierEvidence(modelPrice, image ? details : undefined, catalog.checkedAt, sourceUrl) ?? (incomplete ? model.pricing : undefined),
      metadata: {
        ...model.metadata,
        priceLabel,
        priceSource: !modelPrice && groupPrice ? "supplier-group" : "supplier-catalog",
        priceStatus: fresh
          ? "available"
          : catalog.complete === false
            ? "partial"
          : reason === "价格未公布"
            ? "unpublished"
            : catalog.status,
        priceCheckedAt: catalog.checkedAt,
      },
    };
  });
}

/** Only model-scoped lines can supply a documented price. */
export function applyDocumentedModelPrice(model: ModelDescriptor, document: string | undefined, sourceUrl: string): ModelDescriptor {
  if (model.pricing || (typeof model.metadata?.priceLabel === "string" && !unknownPrice.test(model.metadata.priceLabel) && model.metadata.priceSource !== "generated-result")) return model;
  const scoped = [model.description, model.metadata?.supplierChannelDescription,
    ...((document ?? "").split(/\n/u).filter(line => line.includes(model.id)))].filter(value => typeof value === "string").join("\n");
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
        checkedAt: supplier.scannedAt ?? supplier.updatedAt }, supplier.siteUrl || supplier.apiUrl) : [...models];
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
  let cached = cache.get(key);
  // Share a short burst across groups while an explicit refresh bypasses older results.
  if (
    !cached ||
    cached.until <= Date.now() ||
    (force && cached.until - Date.now() < 290000)
  ) {
    const result = (async (): Promise<SupplierCatalogDiscovery> => {
      try {
        const session = login
          ? await openSupplierSiteSession({ siteUrl, kind, state: supplier?.state })
          : undefined;
        const deadline = AbortSignal.timeout(12000);
        const fetcher = session?.fetch ?? providerFetch;
        return await discoverSupplierCatalog(
          { siteUrl, apiUrl, kind: session?.kind ?? kind },
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
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, cached);
  }
  const catalogModels = applySupplierCatalogPrices(
    models,
    group,
    await cached.result,
    siteUrl,
  );
  return applyMeasuredSupplierPrices(sameSource ? supplier.id : undefined, await documentedPrices(catalogModels, siteUrl, allowNetwork), group, supplier?.state?.sourceId ?? "legacy");
}

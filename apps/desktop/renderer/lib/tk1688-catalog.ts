import { fetchProviderJson, providerFetch, isTk1688ApiUrl, isTk1688CatalogSource, parseTk1688AccountModelIds,
  parseTk1688Marketplace, normalizeTk1688CnyModel, supplierDirectoryPayloadComplete, TK1688_MARKETPLACE_URL, TK1688_STATUS_URL, type ModelDescriptor } from "@super-canvas/providers";
import { getSupplierRecord } from "./supplier-service";
import { openSupplierSiteSession, supplierSiteLoginCacheIdentity } from "./supplier-site-session";
import { isAgentTextModel } from "./agent-model-capabilities";
import { catalogScopedMap } from "./catalog-scope-cache";
import { readCatalogLoaderJson, type CatalogLoaderReadOptions } from "./catalog-loader-http";
import { restrictTk1688MarketplaceInventory } from "@super-canvas/providers/tk1688-catalog";

type Connection = { provider: string; config: Readonly<Record<string, unknown>> };
type CatalogRead = { marketplace?: unknown; status?: unknown; accountModelIds?: string[]; checkedAt: string; complete: boolean };
const cache = catalogScopedMap<string, { until: number; result: Promise<CatalogRead> }>("tk1688-marketplace");

export type Tk1688CatalogReadSource = "marketplace" | "status" | "account-models";
export const TK1688_CATALOG_READ_URLS = { marketplace: TK1688_MARKETPLACE_URL,
  status: TK1688_STATUS_URL, "account-models": "https://tk1688.com/api/user/models" } as const;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Site-session transport is supplied only for account-models. Opening that
 * session is not a prerequisite for the two public reads or the Key read.
 * These are offers/account visibility, never exact-Key permissions. */
export async function collectTk1688CatalogRead(source: Tk1688CatalogReadSource, options: CatalogLoaderReadOptions) {
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const sourceUrl = TK1688_CATALOG_READ_URLS[source];
  const payload = await readCatalogLoaderJson(sourceUrl, options);
  if (source === "account-models") {
    const accountVisibleModelIds = parseTk1688AccountModelIds(payload);
    return { source, sourceUrl, checkedAt, complete: accountVisibleModelIds !== undefined && supplierDirectoryPayloadComplete(payload),
      accountVisibleModelIds: accountVisibleModelIds ?? [] };
  }
  if (source === "status") {
    const root = object(payload), status = object(root?.data);
    const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
    const fx = positive(status?.payment_fx_rate_cny_per_usd);
    const markup = typeof status?.platform_markup_percent === "number" && Number.isFinite(status.platform_markup_percent) && status.platform_markup_percent >= 0
      ? status.platform_markup_percent : undefined;
    return { source, sourceUrl, checkedAt, complete: !!status && root?.success !== false && !root?.error,
      ...(fx !== undefined ? { paymentFxRateCnyPerUsd: fx } : {}), ...(markup !== undefined ? { platformMarkupPercent: markup } : {}) };
  }
  const parsed = parseTk1688Marketplace(payload, undefined, { checkedAt });
  const data = object(object(payload)?.data), items = Array.isArray(data?.items) ? data.items : [];
  const offers = items.flatMap(value => {
    const row = object(value);
    return row && typeof row.alias === "string" && row.alias.trim() && typeof row.base_model === "string" && row.base_model.trim()
      ? [{ modelId: row.alias, baseModelId: row.base_model, active: row.status === "active" && row.channel_alive !== false }] : [];
  });
  return { source, sourceUrl, checkedAt, complete: parsed.complete && offers.length === items.length && supplierDirectoryPayloadComplete(payload),
    catalogOffers: offers, models: parsed.models, excludedModelIds: parsed.excludedModelIds };
}

/** Text models deliberately have canvasRunnable=false. Refreshing a mixed
 * directory must validate the selection against this connection's consumer. */
export function tk1688InventoryDefaultModel(connection: Connection, models: readonly ModelDescriptor[], selected: unknown): ModelDescriptor | undefined {
  const eligible = connection.config.usage === "agent" ? isAgentTextModel
    : (model: ModelDescriptor) => model.metadata?.canvasRunnable !== false && model.operations.length > 0;
  return models.find(model => model.id === selected && eligible(model)) ?? models.find(eligible);
}

/** Pure three-way permission join: bare Key permission permits only account-
 * visible active marketplace aliases in that same family. */
export function mergeTk1688ModelInventory(models: readonly ModelDescriptor[], marketplace: unknown, status: unknown,
  options: { accountModelIds?: readonly string[]; checkedAt?: string; savedModels?: readonly ModelDescriptor[] } = {}): ModelDescriptor[] {
  return mergeTk1688NormalizedModelInventory(models, parseTk1688Marketplace(marketplace, status, { checkedAt: options.checkedAt }), options);
}

/** Same permission join for the pipeline's already normalized GET evidence. */
export function mergeTk1688NormalizedModelInventory(models: readonly ModelDescriptor[], catalog: ReturnType<typeof parseTk1688Marketplace>,
  options: { accountModelIds?: readonly string[]; savedModels?: readonly ModelDescriptor[] } = {}): ModelDescriptor[] {
  const parsed = restrictTk1688MarketplaceInventory(catalog, options.accountModelIds === undefined ? {}
    : { keyModelIds: models.map(model => model.id), accountModelIds: options.accountModelIds });
  if (!parsed.complete) {
    const keys = new Set(models.map(model => model.id));
    const saved = (options.savedModels ?? []).filter(model => model.metadata?.tk1688Catalog === true &&
      (keys.has(model.id) || keys.has(String(model.metadata?.tk1688BaseModel))));
    const preserved = new Map<string, ModelDescriptor>(saved.map(model => [model.id, { ...model,
      metadata: { ...model.metadata, tk1688CatalogStale: true, tk1688CatalogLastAttemptAt: parsed.checkedAt } }]));
    for (const model of models) if (!preserved.has(model.id)) preserved.set(model.id, model);
    return [...preserved.values()].map(normalizeTk1688CnyModel);
  }
  const byId = new Map(parsed.models.map(model => [model.id, model]));
  const result = models.map(model => {
    const catalog = byId.get(model.id);
    if (!catalog) return model;
    return { ...model, ...catalog, provider: model.provider, isDefault: model.isDefault,
      metadata: { ...model.metadata, ...catalog.metadata,
        tk1688PermissionSource: options.accountModelIds ? "key-inventory+account-inventory+marketplace" : "key-inventory+marketplace",
        tk1688CatalogStale: options.accountModelIds === undefined } };
  });
  const keys = new Set(models.map(model => model.id));
  for (const model of parsed.models) if (options.accountModelIds !== undefined && !keys.has(model.id)) result.push({ ...model, provider: models[0]?.provider,
    metadata: { ...model.metadata, tk1688CatalogStale: false, tk1688PermissionSource: "key-inventory+account-inventory+marketplace" } });
  if (options.accountModelIds === undefined) for (const model of options.savedModels ?? []) {
    if (!/@s\d+c\d+$/u.test(model.id) || model.metadata?.tk1688Catalog !== true || !keys.has(String(model.metadata.tk1688BaseModel)) ||
      parsed.excludedModelIds.includes(model.id) || result.some(existing => existing.id === model.id)) continue;
    result.push({ ...model, metadata: { ...model.metadata, tk1688CatalogStale: true } });
  }
  // A channel explicitly offline in a complete fresh market must not remain
  // selectable merely because a broad /models list also returned its alias.
  return result.filter(model => !parsed.excludedModelIds.includes(model.id)).map(normalizeTk1688CnyModel);
}

function savedModels(connection: Connection): ModelDescriptor[] {
  return Array.isArray(connection.config.modelCatalogModels) ? connection.config.modelCatalogModels as unknown as ModelDescriptor[] : [];
}

/** GET-only; credential forwarding stays inside the existing site session. */
export async function enrichTk1688ModelInventory(connection: Connection, models: readonly ModelDescriptor[],
  options: { force?: boolean; allowNetwork?: boolean; refreshId?: string } = {}): Promise<ModelDescriptor[]> {
  const apiUrl = String(connection.config.baseUrl ?? "");
  if (!models.length || !isTk1688ApiUrl(apiUrl)) return [...models];
  const supplier = typeof connection.config.supplierId === "string" ? await getSupplierRecord(connection.config.supplierId) : null;
  if (!supplier || !isTk1688CatalogSource(supplier.siteUrl, supplier.apiUrl) || supplier.apiUrl.replace(/\/$/u, "") !== apiUrl.replace(/\/$/u, "") ||
    (connection.config.supplierSourceId && supplier.state?.sourceId !== connection.config.supplierSourceId)) return [...models];
  if (options.allowNetwork === false) return [...models];
  const scope = JSON.stringify([supplier.id, supplier.state?.sourceId, supplier.apiUrl, supplierSiteLoginCacheIdentity(supplier.state?.siteLogin),
    options.force ? options.refreshId ?? Date.now() : "cached"]);
  let cached = cache.get(scope);
  if (!cached || cached.until <= Date.now()) {
    const result = (async (): Promise<CatalogRead> => {
      const checkedAt = new Date().toISOString();
      try {
        const session = await openSupplierSiteSession(supplier);
        const read = (url: string, fetcher = providerFetch) => fetchProviderJson(fetcher, url,
          { method: "GET", cache: "no-store" }, { phase: "connect", timeoutMs: 12000, maxResponseBytes: 4 * 1024 * 1024 });
        const reads = await Promise.allSettled([read(TK1688_MARKETPLACE_URL), read(TK1688_STATUS_URL),
          session ? read("https://tk1688.com/api/user/models", session.fetch) : Promise.resolve(undefined)]);
        const marketplace = reads[0].status === "fulfilled" ? reads[0].value : undefined;
        const status = reads[1].status === "fulfilled" ? reads[1].value : undefined;
        const accountModelIds = reads[2].status === "fulfilled" ? parseTk1688AccountModelIds(reads[2].value) : undefined;
        return { marketplace, status, accountModelIds, checkedAt, complete: parseTk1688Marketplace(marketplace, status).complete };
      } catch { return { checkedAt, complete: false }; }
    })();
    cached = { until: Date.now() + 60_000, result };
    if (cache.size >= 50) cache.delete(cache.keys().next().value!);
    cache.set(scope, cached);
  }
  const read = await cached.result;
  if (!read.complete || !read.accountModelIds) cache.delete(scope);
  return mergeTk1688ModelInventory(models, read.marketplace, read.status, { accountModelIds: read.accountModelIds,
    checkedAt: read.checkedAt, savedModels: savedModels(connection) });
}

/** Directory facts only replace fields already attributed to the same catalog;
 * every join is an exact model ID and never changes model availability. */
export function applyTk1688CatalogModel(model: ModelDescriptor, catalog: {
  id: string; limits?: ModelDescriptor["limits"]; inputKinds?: ModelDescriptor["inputKinds"];
  outputKinds?: ModelDescriptor["outputKinds"]; metadata?: ModelDescriptor["metadata"];
}, checkedAt: string): ModelDescriptor {
  if (catalog.id !== model.id || catalog.metadata?.tk1688Catalog !== true) return model;
  const parameters = Array.isArray(catalog.metadata.tk1688Parameters)
    ? catalog.metadata.tk1688Parameters as NonNullable<ModelDescriptor["parameters"]> : undefined;
  const pricing = catalog.metadata.tk1688Pricing && typeof catalog.metadata.tk1688Pricing === "object"
    ? catalog.metadata.tk1688Pricing as NonNullable<ModelDescriptor["pricing"]> : undefined;
  const metadata = { ...model.metadata };
  if (metadata.tk1688Catalog === true) {
    for (const key of Object.keys(metadata)) if (key.startsWith("tk1688")) delete metadata[key];
    if (model.metadata?.tk1688OmitN === true) delete metadata.fixedOutputCount;
  }
  const limits = { ...model.limits, ...catalog.limits };
  if (model.metadata?.tk1688OmitN === true && catalog.limits?.maxOutputImages === undefined) delete limits.maxOutputImages;
  return normalizeTk1688CnyModel({ ...model, ...(parameters ? { parameters } : {}), limits,
    ...(catalog.inputKinds ? { inputKinds: catalog.inputKinds } : {}), ...(catalog.outputKinds ? { outputKinds: catalog.outputKinds } : {}),
    pricing, metadata: { ...metadata, ...catalog.metadata, tk1688CatalogCheckedAt: checkedAt,
      canvasRunnable: model.metadata?.canvasRunnable, ...(model.metadata?.canvasUnavailableReason ? { canvasUnavailableReason: model.metadata.canvasUnavailableReason } : {}) } });
}

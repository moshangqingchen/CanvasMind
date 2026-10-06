import { fetchProviderJson, providerFetch, isTk1688ApiUrl, isTk1688CatalogSource, parseTk1688AccountModelIds,
  parseTk1688Marketplace, normalizeTk1688CnyModel, TK1688_MARKETPLACE_URL, TK1688_STATUS_URL, type ModelDescriptor } from "@super-canvas/providers";
import { getSupplierRecord } from "./supplier-service";
import { openSupplierSiteSession, supplierSiteLoginCacheIdentity } from "./supplier-site-session";
import { isAgentTextModel } from "./agent-model-capabilities";

type Connection = { provider: string; config: Readonly<Record<string, unknown>> };
type CatalogRead = { marketplace?: unknown; status?: unknown; accountModelIds?: string[]; checkedAt: string; complete: boolean };
const cache = new Map<string, { until: number; result: Promise<CatalogRead> }>();

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
  const parsed = parseTk1688Marketplace(marketplace, status, options.accountModelIds === undefined ? { checkedAt: options.checkedAt }
    : { keyModelIds: models.map(model => model.id), accountModelIds: options.accountModelIds, checkedAt: options.checkedAt });
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

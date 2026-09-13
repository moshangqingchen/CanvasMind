import {
  discoverSupplierCatalog,
  normalizeSupplierSiteBase,
  supplierDirectoryBase,
  loginSupplierSite,
  decryptSecret,
  providerFetch,
  type ModelDescriptor,
  type SupplierCatalogDiscovery,
} from "@super-canvas/providers";
import { getSupplierRecord } from "./supplier-service";
import { requireServerMasterKey } from "./master-key";

type Connection = { config: Readonly<Record<string, unknown>> };
const unknownPrice =
  /价格以(?:平台|模型广场)为准|价格未公布|价格查询失败|价格需登录查询|价格未查询/u;
const cache = new Map<
  string,
  { until: number; result: Promise<SupplierCatalogDiscovery> }
>();
const hasOwnPrice = (model: ModelDescriptor) =>
  model.metadata?.priceSource !== "supplier-catalog" &&
  (Boolean(model.pricing) ||
    (typeof model.metadata?.priceLabel === "string" &&
      !unknownPrice.test(model.metadata.priceLabel)) ||
    /[¥￥$]\s*\d/u.test(model.name));

/** Join by exact group and exact model ID; a public plaza never grants availability. */
export function applySupplierCatalogPrices(
  models: readonly ModelDescriptor[],
  group: string,
  catalog: SupplierCatalogDiscovery,
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
  return models.map((model) => {
    if (hasOwnPrice(model)) return model;
    const fresh = prices.get(model.id);
    const old =
      model.metadata?.priceSource === "supplier-catalog" &&
      typeof model.metadata.priceLabel === "string" &&
      !unknownPrice.test(model.metadata.priceLabel)
        ? model.metadata.priceLabel.replace(/（上次价格）$/u, "")
        : undefined;
    const priceLabel =
      fresh ||
      (old && ["failed", "unauthorized"].includes(catalog.status)
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
      metadata: {
        ...model.metadata,
        priceLabel,
        priceSource: "supplier-catalog",
        priceStatus: fresh
          ? "available"
          : reason === "价格未公布"
            ? "unpublished"
            : catalog.status,
        priceCheckedAt: catalog.checkedAt,
      },
    };
  });
}

/** Every model scan (including newly added suppliers) passes through this lookup. */
export async function enrichSupplierModelPrices(
  connection: Connection,
  models: readonly ModelDescriptor[],
  force = false,
): Promise<ModelDescriptor[]> {
  if (!models.length || models.every(hasOwnPrice)) return [...models];
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
    login?.username,
    login?.encryptedPassword,
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
          ? await loginSupplierSite({
              siteUrl,
              kind,
              credentials: {
                username: login.username,
                password: decryptSecret(
                  login.encryptedPassword,
                  requireServerMasterKey(),
                ),
              },
            })
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
      } catch {
        return {
          groups: [],
          kind,
          status: login ? "unauthorized" : "failed",
          checkedAt: new Date().toISOString(),
        };
      }
    })();
    cached = { until: Date.now() + 300000, result };
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, cached);
  }
  return applySupplierCatalogPrices(
    models,
    String(connection.config.modelGroup ?? "默认群组"),
    await cached.result,
  );
}

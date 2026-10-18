import type { ProviderConnectionRecord } from "@super-canvas/db";
import { decryptSecret, fetchProviderJson, isLangframeCatalogSource, langframeModelsForKey,
  parseLangframeCatalog, providerFetch, readSupplierAccountKeys, type ModelDescriptor } from "@super-canvas/providers";
import { requireServerMasterKey } from "./master-key";
import { repository } from "./server";
import { openSupplierSiteSession } from "./supplier-site-session";
import { assertCompleteModelInventoryPayload, ModelInventoryReadError } from "./model-inventory-failure";

/** Key membership, account restrictions and public capabilities are independent reads. */
export async function readLangframeKeyInventory(connection: ProviderConnectionRecord): Promise<{
  models: ModelDescriptor[]; permissionConfig: Record<string, unknown>; checkedAt: string;
}> {
  const baseUrl = String(connection.config.baseUrl ?? "");
  if (!isLangframeCatalogSource(baseUrl) || !connection.encryptedSecret) throw new ModelInventoryReadError("invalid_credentials", 401);
  const supplier = typeof connection.config.supplierId === "string" ? await repository.getSupplier(connection.config.supplierId) : null;
  if (!supplier?.state || supplier.state.visibility === "deleted" || connection.config.supplierSourceId !== supplier.state.sourceId ||
      !isLangframeCatalogSource(supplier.siteUrl) || new URL(baseUrl).origin !== new URL(supplier.apiUrl || supplier.siteUrl).origin)
    throw new ModelInventoryReadError("invalid_response", 409);
  const session = await openSupplierSiteSession(supplier);
  if (session?.kind !== "langframe") throw new ModelInventoryReadError("invalid_credentials", 401);
  const keys = await readSupplierAccountKeys({ siteUrl: supplier.siteUrl, kind: session.kind }, session.fetch);
  if (!keys.complete) throw new ModelInventoryReadError("invalid_response", 502);
  const apiKey = decryptSecret(connection.encryptedSecret, requireServerMasterKey());
  const key = keys.keys.find(key => key.routing === "ordered-fallback" && key.apiKey === apiKey &&
    (!connection.config.accountKeyId || connection.config.accountKeyId === key.id));
  if (!key || !Array.isArray(key.accountGroups) || !Array.isArray(key.modelIds)) throw new ModelInventoryReadError("invalid_credentials", 401);
  const origin = new URL(baseUrl).origin;
  const [directory, publicCatalog] = await Promise.all([
    fetchProviderJson<unknown>(providerFetch, `${origin}/v1/models`, { method: "GET", headers: { authorization: `Bearer ${apiKey}` }, cache: "no-store" },
      { phase: "connect", timeoutMs: 20000, maxResponseBytes: 2 * 1024 * 1024 }),
    fetchProviderJson<unknown>(session.fetch, `${new URL(supplier.siteUrl).origin}/api/relay/groups?stats=1`, { method: "GET", cache: "no-store" },
      { phase: "connect", timeoutMs: 20000, maxResponseBytes: 4 * 1024 * 1024 }),
  ]);
  assertCompleteModelInventoryPayload(directory);
  if (!directory || typeof directory !== "object" || (directory as { ok?: unknown }).ok === false || !Array.isArray((directory as { data?: unknown }).data) ||
      (directory as { data: unknown[] }).data.some(model => !model || typeof model !== "object" ||
        typeof (model as { id?: unknown }).id !== "string" || !(model as { id: string }).id.trim()))
    throw new ModelInventoryReadError("invalid_response", 200);
  const ids = new Set(((directory as { data: Array<{ id: string }> }).data).map(model => model.id));
  const checkedAt = new Date().toISOString();
  const catalog = parseLangframeCatalog(publicCatalog, { checkedAt, sourceUrl: `${new URL(supplier.siteUrl).origin}/api/relay/groups?stats=1` });
  if (!catalog.recognized || !catalog.complete) throw new ModelInventoryReadError("invalid_response", 200);
  const selectedIds = connection.config.langframeKeyScope === true ? undefined
    : new Set(catalog.groups.filter(group => group.id === connection.config.modelGroup).flatMap(group => group.models.map(model => model.id)));
  const models = langframeModelsForKey(catalog.groups, key.accountGroups, key.modelIds).filter(model => ids.has(model.id) && (!selectedIds || selectedIds.has(model.id)))
    .filter(model => connection.config.usage === "agent" ? !model.operations.length && model.outputKinds?.includes("text") : model.operations.length > 0);
  const latestSupplier = await repository.getSupplier(supplier.id);
  if (!latestSupplier?.state || latestSupplier.state.visibility === "deleted" || latestSupplier.state.sourceId !== supplier.state.sourceId ||
      latestSupplier.siteUrl !== supplier.siteUrl || latestSupplier.apiUrl !== supplier.apiUrl || latestSupplier.kind !== supplier.kind ||
      JSON.stringify(latestSupplier.state.siteLogin) !== JSON.stringify(supplier.state.siteLogin))
    throw new ModelInventoryReadError("invalid_response", 409);
  return { models, checkedAt, permissionConfig: { accountKeyId: key.id, langframeAccountGroups: key.accountGroups,
    langframeModelIds: key.modelIds, langframeRouting: "ordered-fallback" } };
}

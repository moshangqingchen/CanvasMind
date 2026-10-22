import { isDeepStrictEqual } from "node:util";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { isTk1688ApiUrl, isTk1688CatalogSource, type ModelDescriptor } from "@super-canvas/providers";
import { catalogConnectionScopes } from "./catalog-source-plan";
import { catalogInventoryModelsValid } from "./catalog-inventory-policy";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import { applyTk1688CatalogModel, mergeTk1688NormalizedModelInventory, TK1688_CATALOG_READ_URLS } from "./tk1688-catalog";

const denied = (model: ModelDescriptor) => /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthor|forbidden|not.?returned/iu
  .test(String(model.metadata?.canvasUnavailableReason ?? ""));
const witness = (row: CatalogReadObservation) => ({ sourceKey: row.receipt.spec.sourceKey, sourceUrl: row.receipt.spec.sourceUrl,
  checkedAt: row.receipt.checkedAt, dispatchSeq: row.receipt.context.dispatchSeq });
const saved = (connection: ProviderConnectionRecord): ModelDescriptor[] => Array.isArray(connection.config.modelCatalogModels)
  ? structuredClone(connection.config.modelCatalogModels) as ModelDescriptor[] : [];

export interface CatalogTk1688MembershipProjection {
  observations: CatalogReadObservation[];
  descriptors: ModelDescriptor[];
}

/** Reuses the manual inventory's three-way join without changing any stored
 * receipt. Account/public observations can only constrain an exact Key read. */
export function projectCatalogTk1688Membership(connection: ProviderConnectionRecord, supplier: SupplierRecord | undefined,
  observations: readonly CatalogReadObservation[], options: { identityEpoch: string; observationCycleId: string;
    localProjectionDispatchSeq?: number; keyFence?: { dispatchedThrough: number; checkedAt: string } }): CatalogTk1688MembershipProjection {
  const unchanged = { observations: [...observations], descriptors: [] as ModelDescriptor[] };
  const baseUrl = String(connection.config.baseUrl ?? "");
  if (!supplier || !isTk1688ApiUrl(baseUrl) || !isTk1688CatalogSource(supplier.siteUrl, supplier.apiUrl) ||
    supplier.apiUrl.replace(/\/$/u, "") !== baseUrl.replace(/\/$/u, "") || connection.config.manualProtocol === true) return unchanged;
  const scopes = catalogConnectionScopes(connection, supplier), previous = saved(connection);
  const applicable = (row: CatalogReadObservation) => {
    const { spec, context } = row.receipt;
    const auth = spec.authScope.kind === "connection-key" ? scopes.key : spec.authScope.kind === "site-account" ? scopes.account : scopes.anonymous;
    return context.identityEpoch === options.identityEpoch && context.observationCycleId === options.observationCycleId &&
      spec.applyScope.supplierId === scopes.apply.supplierId && spec.applyScope.supplierSourceId === scopes.apply.supplierSourceId &&
      spec.applyScope.groupIdentity === scopes.apply.groupIdentity && isDeepStrictEqual(spec.authScope, auth) &&
      (spec.authScope.kind !== "connection-key" || spec.applyScope.connectionIds.includes(connection.id));
  };
  const fresh = (row: CatalogReadObservation) => row.receipt.status === "succeeded" && row.receipt.complete &&
    row.receipt.freshness === "live" && !row.receipt.reason && Number.isFinite(Date.parse(row.receipt.checkedAt)) &&
    Number.isSafeInteger(row.receipt.context.dispatchSeq) && row.receipt.context.dispatchSeq > 0;
  const key = observations.filter(row => applicable(row) && row.receipt.spec.role === "key-membership" &&
    row.receipt.spec.authScope.kind === "connection-key" && row.receipt.spec.entryId === "key-models" &&
    row.receipt.spec.sourceUrl === `${baseUrl.replace(/\/$/u, "")}/models`).sort((a, b) => b.receipt.context.dispatchSeq - a.receipt.context.dispatchSeq)[0];
  const stale = previous.filter(model => model.metadata?.tk1688Catalog === true).map(model => ({ ...model,
    metadata: { ...model.metadata, tk1688CatalogStale: true } }));
  if (!key || !fresh(key) || !catalogInventoryModelsValid(key.facts.models) || key.receipt.coverage?.domain !== "key-list" ||
    !key.receipt.coverage.exhaustive || !isDeepStrictEqual([...key.receipt.coverage.modelIds].sort(), key.facts.models.map(model => model.id).sort()))
    return { ...unchanged, descriptors: stale };
  // A new local projection is not an independently collected post-scan Key
  // read. It must never cross the manual refresh fence using public read order.
  if (options.keyFence && (key.receipt.context.dispatchSeq <= options.keyFence.dispatchedThrough ||
    Date.parse(key.receipt.checkedAt) < Date.parse(options.keyFence.checkedAt))) return { ...unchanged, descriptors: stale };
  const source = (name: "account-models" | "marketplace") => {
    const latest = observations.filter(row => applicable(row) &&
    row.receipt.spec.entryId === `tk1688-${name}` && row.receipt.spec.sourceUrl === TK1688_CATALOG_READ_URLS[name] &&
    row.receipt.spec.authScope.kind === (name === "account-models" ? "site-account" : "anonymous"))
      .sort((a, b) => b.receipt.context.dispatchSeq - a.receipt.context.dispatchSeq)[0];
    return latest && fresh(latest) &&
    latest.facts.sourceFacts?.kind === "tk1688" && latest.facts.sourceFacts.value.source === name &&
    latest.facts.sourceFacts.value.sourceUrl === TK1688_CATALOG_READ_URLS[name] && latest.facts.sourceFacts.value.complete ? latest : undefined;
  };
  const account = source("account-models"), marketplace = source("marketplace");
  const accountValue = account?.facts.sourceFacts?.kind === "tk1688" ? account.facts.sourceFacts.value : undefined;
  const marketValue = marketplace?.facts.sourceFacts?.kind === "tk1688" ? marketplace.facts.sourceFacts.value : undefined;
  const accountIds = accountValue?.accountVisibleModelIds;
  const offers = marketValue?.catalogOffers, marketModels = marketValue?.models;
  const complete = !!account && !!marketplace && Array.isArray(accountIds) && new Set(accountIds).size === accountIds.length &&
    !!offers && new Set(offers.map(offer => offer.modelId)).size === offers.length && !!marketModels && catalogInventoryModelsValid(marketModels);
  const permittedKeys = key.facts.models.filter(model => !denied(model));
  const refusedIds = new Set(key.facts.models.filter(denied).map(model => model.id));
  const active = new Map(offers?.filter(offer => offer.active).map(offer => [offer.modelId, offer.baseModelId]));
  const catalog = { models: (marketModels ?? []).filter(model => model.metadata?.tk1688Routing === "merchant" &&
      !refusedIds.has(model.id) && active.get(model.id) === model.metadata?.tk1688BaseModel), excludedModelIds: marketValue?.excludedModelIds ?? [],
    complete, checkedAt: marketplace?.receipt.checkedAt ?? key.receipt.checkedAt };
  let models = mergeTk1688NormalizedModelInventory(permittedKeys, catalog,
    { ...(complete ? { accountModelIds: accountIds } : {}), savedModels: previous });
  // An explicit refusal remains visible as refused and never grants its family.
  models.push(...key.facts.models.filter(denied));
  const keyIds = new Set(key.facts.models.map(model => model.id));
  const derivation: NonNullable<CatalogReadObservation["facts"]["membershipDerivation"]> = { kind: "tk1688-three-way", complete,
    rawKey: { ...witness(key), modelIds: [...keyIds], ...(key.receipt.coverage ? { coverage: structuredClone(key.receipt.coverage) } : {}) },
    ...(account ? { account: witness(account) } : {}), ...(marketplace ? { marketplace: witness(marketplace) } : {}) };
  const latest = [key, ...(account ? [account] : []), ...(marketplace ? [marketplace] : [])]
    .reduce((a, b) => a.receipt.context.dispatchSeq >= b.receipt.context.dispatchSeq ? a : b);
  const localProjectionDispatchSeq = Number.isSafeInteger(options.localProjectionDispatchSeq) && Number(options.localProjectionDispatchSeq) > 0
    ? Math.max(Number(options.localProjectionDispatchSeq), latest.receipt.context.dispatchSeq) : latest.receipt.context.dispatchSeq;
  derivation.localProjectionDispatchSeq = localProjectionDispatchSeq;
  models = models.map(model => model.metadata?.tk1688Catalog !== true ? model : ({ ...model, metadata: { ...model.metadata,
    tk1688CatalogStale: !complete, ...(complete ? { catalogMembershipDerivation: {
      kind: "tk1688-three-way", rawKeyModel: keyIds.has(model.id), baseModelId: model.metadata.tk1688BaseModel ?? model.id,
      observationCycleId: options.observationCycleId, localProjectionDispatchSeq, key: witness(key), account: witness(account!), marketplace: witness(marketplace!),
    } } : {}) } }));
  const projected: CatalogReadObservation = { receipt: { ...structuredClone(key.receipt),
    // Recompiling unchanged source facts is a new local CAS projection, not a
    // new HTTP read. Every original sequence and sample remains in its witness.
    context: { ...key.receipt.context, dispatchSeq: localProjectionDispatchSeq }, checkedAt: latest.receipt.checkedAt,
    complete, ...(complete ? {} : { reason: "incomplete" }),
    coverage: { domain: "key-list", modelIds: models.map(model => model.id), exhaustive: complete } },
    facts: { ...structuredClone(key.facts), models, validatedMembershipModelIds: complete ? models.map(model => model.id) : [...keyIds], membershipDerivation: derivation } };
  return { observations: observations.map(row => row === key ? projected : row),
    descriptors: [...new Map([...stale, ...models.filter(model => model.metadata?.tk1688Catalog === true)].map(model => [model.id, model])).values()] };
}

/** Membership keeps prior descriptors; refresh only fields owned by this exact
 * marketplace identity, keeping price reduction and accepted transports intact. */
export function applyCatalogTk1688Descriptors(models: readonly ModelDescriptor[], descriptors: readonly ModelDescriptor[]): ModelDescriptor[] {
  const byId = new Map(descriptors.map(model => [model.id, model]));
  return models.map(model => {
    const catalog = byId.get(model.id);
    if (!catalog || ["manual", "paid-test"].includes(String(model.metadata?.source)) || model.metadata?.protocolEvidence === "paid-test") return model;
    if (catalog.metadata?.tk1688CatalogStale === true) return { ...model, metadata: { ...model.metadata, tk1688CatalogStale: true } };
    const current = applyTk1688CatalogModel(model, { ...catalog, metadata: { ...catalog.metadata,
      tk1688Parameters: catalog.parameters, tk1688Pricing: model.pricing ?? catalog.pricing } }, String(catalog.metadata?.tk1688CatalogCheckedAt));
    return { ...current, name: catalog.name, description: catalog.description, operations: catalog.operations };
  });
}

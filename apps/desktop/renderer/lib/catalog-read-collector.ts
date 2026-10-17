import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { randomUUID } from "node:crypto";
import type { ModelDescriptor } from "@super-canvas/providers";
import { collectGenericKeyInventory, collectNativeKeyInventory, collectChentuPublicCatalog, collectCyberAfeiPublicCatalog,
  collectMiaowuPublicCatalog, collectMiaowuMediaInventory, collectMiaowuSchema, collectChentuImageCapabilities,
  type InventoryCollectorResult } from "./provider-inventory-collector";
import { collectCangyuanCatalogRead } from "./cangyuan-catalog";
import { collectWeAiPricingRead } from "./weai-pricing-server";
import { collectTk1688CatalogRead } from "./tk1688-catalog";
import { collectCatalogInterfaceDocument, discoverCatalogInterfaceEntries } from "./catalog-interface-document-collector";
import { catalogConnectionScopes, catalogReadItem, catalogSafeSourceUrl, catalogSourcePlan } from "./catalog-source-plan";
import { modelInventoryFailure } from "./model-inventory-failure";
import { collectGenericSupplierSource, type GenericSupplierSourceEntry } from "./catalog-generic-source-collector";
import { collectCatalogSupplementRead, type CatalogSupplementEntry } from "./catalog-supplement-collector";
import { catalogConnectionManifest, catalogReadReason, type CatalogReadCollection, type CatalogReadItemSpec,
  type CatalogObservationContext, type CatalogReadObservation, type CatalogNormalizedFacts } from "./catalog-read-contracts";

interface ReadResult {
  status: "live" | "empty" | "failed" | "unauthorized";
  complete: boolean;
  checkedAt: string;
  facts: CatalogNormalizedFacts;
  failure?: { code: string; httpStatus?: number };
  attemptedUrls?: string[];
}
export interface CatalogCollectorDependencies {
  /** Deliberate opt-in, not a page-load or production default. */
  enabled?: boolean;
  apiKey: string;
  fetchFor: (spec: CatalogReadItemSpec) => typeof fetch | undefined;
  context: CatalogObservationContext;
  now?: () => string;
  signal?: AbortSignal;
  documentBudget?: number;
  supplementBudget?: number;
  schemaBudget?: number;
}
const inventory = (value: InventoryCollectorResult): ReadResult => ({ ...value, facts: { models: value.models,
  ...(value.groups ? { groups: value.groups } : {}) } });
const bareModels = (offers: readonly { modelId: string; groupId?: string }[]): ModelDescriptor[] => offers.map(({ modelId: id, groupId }) =>
  ({ id, name: id, operations: [], ...(groupId ? { metadata: { catalogGroup: groupId, publicCatalogOnly: true } } : {}) }));

async function readItem(spec: CatalogReadItemSpec, connection: ProviderConnectionRecord, supplier: SupplierRecord | undefined,
  fetcher: typeof fetch, deps: CatalogCollectorDependencies): Promise<ReadResult> {
  const checkedAt = deps.now?.() ?? new Date().toISOString(), options = { fetch: fetcher, now: deps.now };
  const loaderOptions = { fetch: fetcher, signal: deps.signal, checkedAt };
  switch (spec.entryId) {
    case "key-models": return inventory(await collectGenericKeyInventory({ baseUrl: String(connection.config.baseUrl), apiKey: deps.apiKey,
      protocol: String(connection.config.directorProtocol ?? connection.config.protocol ?? ""),
      defaultModel: typeof connection.config.defaultModel === "string" ? connection.config.defaultModel : undefined }, options));
    case "native-key-models": return inventory(await collectNativeKeyInventory({ config: connection.config, apiKey: deps.apiKey }, options));
    case "chentu-pricing": return inventory(await collectChentuPublicCatalog(options));
    case "chentu-image-capabilities": {
      const value = await collectChentuImageCapabilities(deps.apiKey, options);
      return { ...inventory(value), facts: { models: [], sourceFacts: { kind: "chentu-capabilities", capabilities: value.capabilities } } };
    }
    case "cyberafei-pricing": return inventory(await collectCyberAfeiPublicCatalog(options));
    case "miaowu-pricing": return inventory(await collectMiaowuPublicCatalog(options));
    case "miaowu-media": return inventory(await collectMiaowuMediaInventory(deps.apiKey, options));
    case "cangyuan-homepage": case "cangyuan-documentation": case "cangyuan-pricing": {
      const source = spec.entryId.slice("cangyuan-".length) as "homepage" | "documentation" | "pricing";
      const value = await collectCangyuanCatalogRead(source, loaderOptions);
      return { status: "live", complete: value.complete, checkedAt: value.checkedAt,
        facts: { models: bareModels(value.catalogOffers ?? []), sourceFacts: { kind: "cangyuan", value } } };
    }
    case "weai-model-plaza": case "weai-official-docs": {
      const source = spec.entryId === "weai-model-plaza" ? "model-plaza" : "official-docs";
      const value = await collectWeAiPricingRead(source, { ...loaderOptions, baseUrl: String(connection.config.baseUrl) });
      return { status: "live", complete: value.complete, checkedAt: value.checkedAt,
        facts: { models: bareModels(value.catalogOffers), sourceFacts: { kind: "weai", value } } };
    }
    case "tk1688-marketplace": case "tk1688-status": case "tk1688-account-models": {
      const source = spec.entryId.slice("tk1688-".length) as "marketplace" | "status" | "account-models";
      const value = await collectTk1688CatalogRead(source, loaderOptions);
      return { status: "live", complete: value.complete, checkedAt: value.checkedAt,
        facts: { models: value.catalogOffers ? bareModels(value.catalogOffers).map((model, index) => ({ ...model,
          metadata: { publicCatalogOnly: true, catalogActive: value.catalogOffers![index]!.active } }))
          : bareModels((value.accountVisibleModelIds ?? []).map(modelId => ({ modelId }))),
          sourceFacts: { kind: "tk1688", value },
          ...(source === "account-models" ? { dependencies: { accountVisibleModelCount: value.accountVisibleModelIds?.length ?? 0 } } : {}) } };
    }
  }
  if (spec.entryId.startsWith("supplier:") && supplier) {
    const entry = spec.entryId.split(":")[1] as GenericSupplierSourceEntry;
    const value = await collectGenericSupplierSource({ url: spec.sourceUrl, siteUrl: supplier.siteUrl, entry }, loaderOptions);
    return { status: value.models.length ? "live" : "empty", complete: value.complete, checkedAt: value.checkedAt,
      facts: { models: value.models, supplierGroups: value.groups, dependencies: value.dependencies,
        groups: value.groups.map(group => ({ id: group.id, label: group.label, modelIds: group.models.map(model => model.id) })) } };
  }
  throw new Error("Unsupported catalog source");
}

/** A source failure is a receipt, never a gate in front of another source. No repository is used. */
export async function collectCatalogReadCycle(connection: ProviderConnectionRecord, supplier: SupplierRecord | undefined,
  deps: CatalogCollectorDependencies): Promise<CatalogReadCollection> {
  const observations: CatalogReadObservation[] = [];
  const plan = deps.enabled === true ? catalogSourcePlan(connection, supplier) : [];
  const supplements: CatalogSupplementEntry[] = plan.filter(spec => spec.entryId.startsWith("supplement:")).map(spec => ({
    entryId: spec.entryId.slice("supplement:".length), sourceUrl: spec.sourceUrl,
    role: spec.role as CatalogSupplementEntry["role"], authKind: spec.authScope.kind as CatalogSupplementEntry["authKind"],
  }));
  const now = () => deps.now?.() ?? new Date().toISOString();
  const finish = (): CatalogReadCollection => ({ enabled: deps.enabled === true, observations,
    catalogOffers: observations.filter(row => row.receipt.spec.role === "catalog-offer" && row.receipt.status === "succeeded").flatMap(row => row.facts.models),
    keyVisibleModels: [...new Map(observations.filter(row => row.receipt.spec.role === "key-membership" &&
      row.receipt.spec.authScope.kind === "connection-key" && row.receipt.status === "succeeded").flatMap(row => row.facts.models).map(model => [model.id, model])).values()],
    manifest: catalogConnectionManifest(connection.id, deps.context.observationCycleId, observations, plan), publication: "disabled" });
  if (deps.enabled !== true) return finish();
  const capture = async (spec: CatalogReadItemSpec, work: (fetcher: typeof fetch) => Promise<ReadResult>) => {
    const attemptedUrls: string[] = [];
    let startedAt: string | undefined;
    const attemptId = randomUUID();
    try {
      const transport = deps.signal?.aborted ? undefined : deps.fetchFor(spec);
      if (!transport) {
        observations.push({ receipt: { spec, context: { ...deps.context }, status: "deferred", complete: false, freshness: "unread",
          checkedAt: now(), reason: deps.signal?.aborted ? "cancelled" : "credentials-unavailable" }, facts: { models: [] } }); return;
      }
      const fetcher: typeof fetch = (input, init) => {
        deps.signal?.throwIfAborted();
        const url = catalogSafeSourceUrl(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        if ((init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() !== "GET")
          throw new Error("Catalog collector accepts GET only");
        if (spec.authScope.kind !== "anonymous" && new URL(url).origin !== new URL(spec.sourceUrl).origin)
          throw new Error("Catalog credential scope mismatch");
        startedAt ??= now(); attemptedUrls.push(url);
        return transport(input, { ...init, ...(deps.signal ? { signal: init?.signal
          ? AbortSignal.any([deps.signal, init.signal]) : deps.signal } : {}) });
      };
      const value = await work(fetcher);
      deps.signal?.throwIfAborted();
      const succeeded = ["live", "empty"].includes(value.status);
      const domain = spec.entryId.startsWith("supplier:") && /:(?:newapi-groups|sub2api-groups):/u.test(spec.entryId) ? "group-options"
        : spec.role === "key-membership" ? "key-list" : spec.role === "catalog-offer" ? "offers"
        : spec.role === "price" ? "price-fragment" : spec.role === "schema" ? "contract" : "health";
      const groupIdentities = value.facts.supplierGroups?.map(group => group.supplierGroupId !== undefined
        ? `site-id:${group.supplierGroupId}` : `name:${group.id}`) ?? value.facts.groups?.map(group => `name:${group.id}`);
      observations.push({ receipt: { spec, context: { ...deps.context }, status: succeeded ? "succeeded" : "failed",
        complete: succeeded && value.complete, freshness: "live", checkedAt: value.checkedAt,
        coverage: { domain, modelIds: [...new Set(value.facts.models.map(model => model.id))],
          ...(groupIdentities ? { groupIdentities } : {}),
          exhaustive: succeeded && value.complete && (domain === "key-list" || domain === "offers") },
        ...(!succeeded || !value.complete ? { reason: catalogReadReason(value.failure?.code ?? (succeeded ? "incomplete" : undefined), value.failure?.httpStatus) } : {}),
        ...(value.failure?.httpStatus ? { httpStatus: value.failure.httpStatus } : {}),
        ...(startedAt ? { attemptId, startedAt, completedAt: now(), attemptedUrls } : {}) }, facts: value.facts });
    } catch (error) {
      const failure = modelInventoryFailure(error);
      observations.push({ receipt: { spec, context: { ...deps.context }, status: "failed", complete: false, freshness: "live",
        checkedAt: now(), reason: deps.signal?.aborted ? "cancelled" : catalogReadReason(failure.code, failure.httpStatus),
        ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
        ...(startedAt ? { attemptId, startedAt, completedAt: now(), attemptedUrls } : {}) }, facts: { models: [] } });
    }
  };
  for (const spec of plan.filter(spec => !spec.entryId.startsWith("supplement:")))
    await capture(spec, fetcher => readItem(spec, connection, supplier, fetcher, deps));
  const scopes = catalogConnectionScopes(connection, supplier), visible = finish().keyVisibleModels;
  const supplementSeen = new Set<string>(); let supplementSpent = 0;
  for (const entry of supplements) {
    const spec = catalogReadItem(`supplement:${entry.entryId}`, entry.sourceUrl, entry.role,
      entry.authKind === "anonymous" ? scopes.anonymous : scopes.account,
      { ...scopes.apply, ...(entry.groupId !== undefined ? { groupIdentity: `site-id:${entry.groupId}` } : {}) });
    if (supplementSeen.has(spec.sourceKey)) continue; supplementSeen.add(spec.sourceKey);
    if (supplementSpent >= (deps.supplementBudget ?? 32)) {
      observations.push({ receipt: { spec, context: { ...deps.context }, status: "deferred", complete: false, freshness: "unread",
        checkedAt: now(), reason: "budget" }, facts: { models: [] } }); continue;
    }
    supplementSpent++;
    await capture(spec, async fetcher => {
      const value = await collectCatalogSupplementRead({ ...entry, modelIds: visible.map(model => model.id) },
        { fetch: fetcher, checkedAt: now(), signal: deps.signal });
      supplements.push(...value.entries);
      return { status: value.status, complete: value.complete, checkedAt: value.checkedAt, facts: { models: value.models, supplement: value } };
    });
  }
  // Schemas have independent identities. They cannot grant membership or affect a list receipt.
  let schemaSpent = 0;
  if (plan.some(spec => spec.entryId === "miaowu-media")) for (const model of visible) {
    const kind = model.outputKinds?.includes("video") ? "video" : model.outputKinds?.includes("image") ? "image" : undefined;
    if (!kind) continue;
    const spec = catalogReadItem(`miaowu-schema:${model.id}`, `https://api.miaowuai.store/v1/dream/model_schema?model=${encodeURIComponent(model.id)}`,
      "schema", scopes.key, { ...scopes.apply, modelId: model.id });
    if (schemaSpent >= (deps.schemaBudget ?? 32)) {
      observations.push({ receipt: { spec, context: { ...deps.context }, status: "deferred", complete: false, freshness: "unread",
        checkedAt: now(), reason: "budget" }, facts: { models: [] } }); continue;
    }
    schemaSpent++;
    await capture(spec, async fetcher => { const value = await collectMiaowuSchema(model.id, kind, deps.apiKey, { fetch: fetcher, now: deps.now });
      return { ...inventory(value), facts: { models: [], sourceFacts: { kind: "miaowu-schema", contract: value.contract },
        ...(value.normalizedSchemaSha256 ? { contractDigests: [value.normalizedSchemaSha256] } : {}) } }; });
  }
  const entries = discoverCatalogInterfaceEntries(String(connection.config.baseUrl), supplier?.siteUrl ?? String(connection.config.baseUrl), visible);
  const seen = new Set<string>(); let spent = 0;
  for (const entry of entries) {
    if (seen.has(entry.url)) continue; seen.add(entry.url);
    const spec = catalogReadItem(`schema-document:${entry.url}`, entry.url, "schema", scopes.anonymous, scopes.apply);
    if (spent >= (deps.documentBudget ?? 32)) { observations.push({ receipt: { spec, context: { ...deps.context }, status: "deferred",
      complete: false, freshness: "unread", checkedAt: now(), reason: "budget" }, facts: { models: [] } }); continue; }
    spent++;
    await capture(spec, async fetcher => {
      const value = await collectCatalogInterfaceDocument({ url: entry.url, baseUrl: String(connection.config.baseUrl), models: visible },
        { fetch: fetcher, checkedAt: now(), signal: deps.signal });
      entries.push(...value.discoveredEntries);
      return { status: value.complete ? "live" : "failed", complete: value.complete, checkedAt: value.checkedAt,
        facts: { models: [], contracts: value.contracts }, failure: value.failure ?? (!value.complete ? { code: "invalid_response" } : undefined) };
    });
  }
  return finish();
}

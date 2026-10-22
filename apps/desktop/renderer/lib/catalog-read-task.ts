import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { randomUUID } from "node:crypto";
import { readCatalogItemFacts, type CatalogCollectorDependencies, type CatalogItemReadResult } from "./catalog-read-collector";
import { catalogConnectionScopes, catalogReadItem, catalogSafeSourceUrl } from "./catalog-source-plan";
import { collectCatalogSupplementRead, type CatalogSupplementEntry } from "./catalog-supplement-collector";
import { collectCatalogInterfaceDocument, discoverCatalogInterfaceEntries } from "./catalog-interface-document-collector";
import { collectMiaowuSchema } from "./provider-inventory-collector";
import { catalogReadReason, type CatalogReadItemSpec, type CatalogReadObservation } from "./catalog-read-contracts";
import { ModelInventoryReadError, modelInventoryFailure } from "./model-inventory-failure";
import { catalogInventoryModelsValid } from "./catalog-inventory-policy";

/** Persisted discovery input, without credentials or HTTP bodies. */
export interface CatalogReadTask {
  spec: CatalogReadItemSpec;
  supplement?: CatalogSupplementEntry;
}
export interface CatalogTaskResult { observation: CatalogReadObservation; discovered: CatalogReadTask[] }

/** One logical read; all actual HTTP, including fallback URLs, uses the supplied dispatcher. */
export async function collectCatalogReadTask(task: CatalogReadTask, connection: ProviderConnectionRecord,
  supplier: SupplierRecord | undefined, models: readonly ModelDescriptor[], deps: CatalogCollectorDependencies): Promise<CatalogTaskResult> {
  const { spec } = task, discovered: CatalogReadTask[] = [], attemptedUrls: string[] = [];
  const now = () => deps.now?.() ?? new Date().toISOString();
  const scopes = catalogConnectionScopes(connection, supplier);
  let startedAt: string | undefined;
  const checkedAt = now(), attemptId = randomUUID();
  const deferred = (reason: "cancelled" | "credentials-unavailable"): CatalogTaskResult => ({ discovered, observation: {
    receipt: { spec, context: deps.context, status: "deferred", complete: false, freshness: "unread", checkedAt, reason }, facts: { models: [] } } });
  const transport = deps.enabled === true && !deps.signal?.aborted ? deps.fetchFor(spec) : undefined;
  if (!transport) return deferred(deps.signal?.aborted ? "cancelled" : "credentials-unavailable");
  try {
    const fetcher: typeof fetch = async (input, init) => {
      deps.signal?.throwIfAborted();
      const url = catalogSafeSourceUrl(input instanceof Request ? input.url : String(input), spec.authScope.kind === "connection-key");
      if ((init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() !== "GET") throw new Error("Catalog read requires GET");
      if (spec.authScope.kind !== "anonymous" && new URL(url).origin !== new URL(spec.sourceUrl).origin) throw new Error("Catalog credential scope mismatch");
      startedAt ??= now(); attemptedUrls.push(url);
      return transport(input, { ...init, ...(deps.signal ? { signal: init?.signal ? AbortSignal.any([deps.signal, init.signal]) : deps.signal } : {}) });
    };
    let value: CatalogItemReadResult;
    if (task.supplement) {
      const result = await collectCatalogSupplementRead({ ...task.supplement, modelIds: models.map(model => model.id) },
        { fetch: fetcher, checkedAt, signal: deps.signal });
      for (const entry of result.entries) discovered.push({ supplement: entry, spec: catalogReadItem(`supplement:${entry.entryId}`, entry.sourceUrl,
        entry.role, entry.authKind === "anonymous" ? scopes.anonymous : scopes.account,
        { ...scopes.apply, ...(entry.groupId !== undefined ? { groupIdentity: `site-id:${entry.groupId}` } : {}) }) });
      value = { ...result, facts: { models: result.models, supplement: result } };
    } else if (spec.entryId.startsWith("schema-document:")) {
      const result = await collectCatalogInterfaceDocument({ url: spec.sourceUrl, baseUrl: String(connection.config.baseUrl), models, groupIdentity: scopes.apply.groupIdentity },
        { fetch: fetcher, checkedAt, signal: deps.signal });
      for (const entry of result.discoveredEntries) discovered.push({ spec: catalogReadItem(`schema-document:${entry.url}`, entry.url, "schema", scopes.anonymous, scopes.apply) });
      value = { status: result.complete ? "live" : "failed", complete: result.complete, checkedAt: result.checkedAt,
        facts: { models: [], interfaceDocuments: result.interfaceDocuments, contracts: result.contracts, contractDiagnostics: result.contractDiagnostics }, failure: result.failure };
    } else if (spec.entryId.startsWith("miaowu-schema:")) {
      const model = models.find(model => model.id === spec.applyScope.modelId);
      const kind = model?.outputKinds?.includes("video") ? "video" : "image";
      const result = await collectMiaowuSchema(String(spec.applyScope.modelId), kind, deps.apiKey, { fetch: fetcher, now: deps.now });
      value = { ...result, facts: { models: [], sourceFacts: { kind: "miaowu-schema", contract: result.contract },
        ...(result.normalizedSchemaSha256 ? { contractDigests: [result.normalizedSchemaSha256] } : {}) } };
    } else value = await readCatalogItemFacts(spec, connection, supplier, fetcher, deps);
    if (value.facts.contracts?.length || value.facts.contractDiagnostics?.length)
      value.facts.contractOrigin = new URL(String(connection.config.baseUrl)).origin;
    deps.signal?.throwIfAborted();
    const succeeded = value.status === "live" || value.status === "empty";
    if (succeeded && spec.role === "key-membership" && spec.authScope.kind === "connection-key" && catalogInventoryModelsValid(value.facts.models))
      value.facts.validatedMembershipModelIds = value.facts.models.map(model => model.id);
    const domain = spec.role === "key-membership" ? "key-list" : spec.role === "catalog-offer" ? "offers" : spec.role === "price" ? "price-fragment"
      : spec.role === "schema" ? "contract" : "health";
    return { discovered, observation: { receipt: { spec, context: deps.context, status: succeeded ? "succeeded" : "failed",
      complete: succeeded && value.complete, freshness: "live", checkedAt: value.checkedAt,
      coverage: { domain, modelIds: [...new Set(value.facts.models.map(model => model.id))], exhaustive: succeeded && value.complete && ["key-list", "offers"].includes(domain) },
      ...(!succeeded || !value.complete ? { reason: catalogReadReason(value.failure?.code ?? "incomplete", value.failure?.httpStatus) } : {}),
      ...(value.failure?.code === "timeout" ? { failureCode: "timeout" as const } : {}),
      ...(value.failure?.httpStatus ? { httpStatus: value.failure.httpStatus } : {}),
      ...(startedAt ? { attemptId, startedAt, completedAt: now(), attemptedUrls } : {}) }, facts: value.facts } };
  } catch (error) {
    const failure = modelInventoryFailure(error);
    return { discovered, observation: { receipt: { spec, context: deps.context, status: "failed", complete: false, freshness: "live", checkedAt: now(),
      reason: deps.signal?.aborted ? "cancelled" : catalogReadReason(failure.code, failure.httpStatus),
      ...(error instanceof ModelInventoryReadError && error.code === "timeout" ? { failureCode: "timeout" as const } : {}),
      ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}), ...(startedAt ? { attemptId, startedAt, completedAt: now(), attemptedUrls } : {}) }, facts: { models: [] } } };
  }
}

export function discoverCatalogModelTasks(connection: ProviderConnectionRecord, supplier: SupplierRecord | undefined,
  models: readonly ModelDescriptor[], miaowu: boolean): CatalogReadTask[] {
  const scopes = catalogConnectionScopes(connection, supplier), tasks: CatalogReadTask[] = [];
  for (const entry of discoverCatalogInterfaceEntries(String(connection.config.baseUrl), supplier?.siteUrl ?? String(connection.config.baseUrl), models))
    tasks.push({ spec: catalogReadItem(`schema-document:${entry.url}`, entry.url, "schema", scopes.anonymous, scopes.apply) });
  if (miaowu) for (const model of models) if (model.outputKinds?.some(kind => kind === "image" || kind === "video"))
    tasks.push({ spec: catalogReadItem(`miaowu-schema:${model.id}`, `https://api.miaowuai.store/v1/dream/model_schema?model=${encodeURIComponent(model.id)}`,
      "schema", scopes.key, { ...scopes.apply, modelId: model.id }) });
  return tasks;
}

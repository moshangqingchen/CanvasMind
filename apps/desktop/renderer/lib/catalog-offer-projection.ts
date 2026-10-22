import { catalogObservationCurrentGroup, catalogObservationGroupIdentity, type CatalogGroupPatch, type CatalogPipelineState, type JsonObject,
  type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import { isDeepStrictEqual } from "node:util";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import { catalogPriceDescriptor } from "./supplier-catalog-price-merge";
import { reduceCatalogPrices, type CatalogPriceState } from "./catalog-price-observations";
import { applyWeAiLivePricing } from "./weai-catalog";
import type { CatalogChange } from "./supplier-catalog-contracts";
import { catalogChanges } from "./supplier-catalog-policy";

type Group = SupplierRecord["catalog"]["groups"][number];
type OfferState = { schemaVersion: 1; lastDispatchSeq: number; groups: Record<string, string[]> };
const json = (value: unknown) => value as JsonObject;
const capability = (model: ModelDescriptor): Group["models"][number]["capability"] => model.outputKinds?.includes("image") ? "image"
  : model.outputKinds?.includes("video") ? "video" : model.outputKinds?.includes("audio") ? "music" : model.outputKinds?.includes("text") ? "chat" : "other";

/** Generic price rows do not revoke a separately read same-group contract.
 * Explicit fields still replace their old value; prices use the reducer below. */
function retainCatalogDeclaration(previous: Group["models"][number] | undefined, current: Group["models"][number]) {
  if (!previous) return current;
  const contractBillingFields = new Set(["billingIncludesInputDuration", "referenceVideoPricingUnpublished", "priceContractWarning",
    "videoReferenceVideoBilling", "jijiuReferenceVideoDurationBilling", "videoAutomaticBillingSeconds", "chentuBillingUsageSchema",
    "cangyuanAudioBillingBasis", "cangyuanAudioBillingEvidence", "cangyuanAudioRawBillingValues"]);
  const metadata = Object.fromEntries(Object.entries(previous.metadata ?? {}).filter(([key]) =>
    (contractBillingFields.has(key) || !/price|pricing|billing/iu.test(key)) && !/^tk1688(?:FxRate|PlatformMarkupPercent|RetailPriceIncludesMarkup)/u.test(key)));
  return { ...previous, ...current,
    ...(current.protocol === "unknown" && previous.protocol ? { protocol: previous.protocol } : {}),
    ...((current.capability === "other" && current.metadata?.outputKindsSource !== "declared" || current.metadata?.outputKindsSource === "inferred") && previous.outputKinds?.length
      ? { capability: previous.capability, outputKinds: previous.outputKinds } : {}),
    metadata: { ...metadata, ...current.metadata } };
}

/** These are offers only. This projection never writes a Key's membership. */
function groupsFromFact(fact: CatalogReadObservation): Group[] {
  if (fact.facts.supplierGroups) return fact.facts.supplierGroups.map(group => ({ ...structuredClone(group), source: "catalog" }));
  const source = fact.facts.sourceFacts;
  if (source?.kind === "cangyuan") return structuredClone(source.value.snapshot?.marketplaceGroups ?? []).map(group => ({ ...group, label: group.id,
    source: "catalog" as const, models: group.models.map(model => ({ ...model, capability: model.capability === "audio" ? "music" : model.capability })) }));
  if (source?.kind === "weai") return source.value.groups.map(group => ({ id: group.groupId, label: group.groupId, source: "catalog",
    models: applyWeAiLivePricing(Object.keys(group.models).map(id => ({ id, name: id, operations: [] })), group).map(model => ({ id: model.id,
      name: model.name, capability: capability(model), metadata: { ...model.metadata, ...(model.pricing ? { officialCatalogPricing: model.pricing } : {}) } })) }));
  const groups = new Map<string, Group>();
  for (const entry of fact.facts.groups ?? []) {
    const descriptors = fact.facts.models.filter(model => entry.modelIds.includes(model.id) &&
      (model.metadata?.catalogGroup === entry.id || model.metadata?.supplierPriceGroup === entry.id ||
        (fact.facts.groups?.filter(group => group.modelIds.includes(model.id)).length ?? 0) === 1));
    groups.set(entry.id, { id: entry.id, label: entry.label, source: "catalog", models: descriptors.map(model => ({ id: model.id,
      name: model.name, capability: capability(model), metadata: { ...model.metadata, ...(model.pricing ? { officialCatalogPricing: model.pricing } : {}) } })) });
  }
  for (const model of fact.facts.models) {
    const id = model.metadata?.catalogGroup;
    if (typeof id !== "string") continue;
    const group = groups.get(id) ?? { id, label: id, source: "catalog" as const, models: [] };
    if (!group.models.some(row => row.id === model.id)) group.models.push({ id: model.id, name: model.name, capability: capability(model), metadata: { ...model.metadata,
      ...(model.pricing ? { officialCatalogPricing: model.pricing } : {}) } }); groups.set(id, group);
  }
  return [...groups.values()];
}

export function projectCatalogOffers(pipeline: CatalogPipelineState, supplier: SupplierRecord | undefined,
  fact: CatalogReadObservation, mode: string, observedAt: string): {
    groups: CatalogGroupPatch[]; state: Array<{ key: string; expected?: JsonObject; value: JsonObject }>; changes: CatalogChange[];
  } {
  const result: ReturnType<typeof projectCatalogOffers> = { groups: [], state: [], changes: [] };
  const receipt = fact.receipt;
  if (!supplier || receipt.context.identityEpoch !== pipeline.identityEpoch || receipt.status !== "succeeded" || !receipt.complete ||
    receipt.freshness !== "live" || receipt.spec.role !== "catalog-offer" || receipt.spec.authScope.kind === "connection-key" ||
    receipt.spec.applyScope.supplierId !== supplier.id || supplier.state && receipt.spec.applyScope.supplierSourceId !== supplier.state.sourceId) return result;
  const key = `offers:${receipt.spec.sourceKey}`, prior = pipeline.entries[key] as unknown as OfferState | undefined;
  if (prior && prior.lastDispatchSeq >= receipt.context.dispatchSeq) return result;
  const incoming = groupsFromFact(fact), groupOptionsOnly = receipt.coverage?.domain === "group-options";
  const contribution: OfferState = { schemaVersion: 1, lastDispatchSeq: receipt.context.dispatchSeq, groups: {} };
  for (const group of incoming) {
    const identity = catalogObservationGroupIdentity(group), old = catalogObservationCurrentGroup(supplier.catalog.groups, identity);
    contribution.groups[identity] = groupOptionsOnly ? prior?.groups[identity] ?? [] : group.models.map(model => model.id);
    if (old?.source === "manual") continue;
    const otherIds = new Set(Object.entries(pipeline.entries).filter(([entryKey]) => entryKey.startsWith("offers:") && entryKey !== key)
      .flatMap(([, value]) => (value as unknown as OfferState).groups?.[identity] ?? []));
    const genericPricing = receipt.spec.entryId.startsWith("supplier:pricing:");
    const declarations = genericPricing ? group.models.map(model => retainCatalogDeclaration(old?.models.find(row => row.id === model.id), model)) : group.models;
    const models = groupOptionsOnly ? old?.models ?? [] : [...declarations,
      ...(old?.models ?? []).filter(model => otherIds.has(model.id) && !group.models.some(current => current.id === model.id))];
    // Public prices share the exact same reducer/selector as connection menus.
    const virtual: ProviderConnectionRecord = { id: `offer:${supplier.id}:${identity}`, name: group.label, provider: "openai",
      config: { baseUrl: supplier.apiUrl ?? supplier.siteUrl, supplierId: supplier.id, supplierSourceId: supplier.state?.sourceId,
        ...(group.supplierGroupId !== undefined ? { accountKeyGroupId: group.supplierGroupId } : { modelGroup: group.id }),
        modelCatalogModels: (old?.models ?? []).map(catalogPriceDescriptor) }, createdAt: supplier.createdAt, updatedAt: supplier.updatedAt };
    const priceKey = `offer-prices:${identity}`;
    const prices = reduceCatalogPrices(pipeline.entries[priceKey] as unknown as CatalogPriceState | undefined,
      { connection: virtual, supplier, models: models.map(catalogPriceDescriptor), observations: [fact], identityEpoch: pipeline.identityEpoch, mode, observedAt });
    const pricedModels = models.map((model, index) => ({ ...model, pricing: prices.models[index]?.pricing,
      priceLabel: String(prices.models[index]?.metadata?.priceLabel ?? model.priceLabel ?? ""), metadata: prices.models[index]?.metadata ?? model.metadata }));
    const next = { ...group, models: pricedModels, status: "available" as const };
    if (!old) { result.groups.push({ kind: "insert", group: next }); result.changes.push({ kind: "group-added", groupId: identity, after: group.label }); }
    else {
      const fields = { label: next.label, source: "catalog" as const, models: next.models, status: next.status };
      const expected = { label: old.label, source: old.source, models: old.models, status: old.status };
      const details = next.details ? Object.fromEntries(Object.entries(next.details).filter(([field]) => field !== "ledgerPrices")) : undefined;
      const detailFields = details ? { expected: Object.fromEntries(Object.keys(details).map(field => [field, old.details?.[field as keyof NonNullable<Group["details"]>]])), set: details } : undefined;
      if (!isDeepStrictEqual(fields, expected) || detailFields && !isDeepStrictEqual(detailFields.expected, detailFields.set))
        result.groups.push({ kind: "fields", groupId: identity, fields: { expected, set: fields }, ...(detailFields ? { details: detailFields } : {}) });
      const publishedGroup: Group = { ...old, ...next, details: next.details ? { ...old.details, ...next.details } : old.details };
      result.changes.push(...catalogChanges(virtual, virtual,
        { ...supplier, catalog: { ...supplier.catalog, groups: [old] } },
        { ...supplier, catalog: { ...supplier.catalog, groups: [publishedGroup] } })
        .filter(change => change.modelId === undefined && ["price", "group-changed"].includes(change.kind))
        .map(change => ({ ...change, groupId: identity })));
    }
    if (!groupOptionsOnly) {
      result.state.push({ key: priceKey, expected: pipeline.entries[priceKey], value: json(prices.state) });
      result.changes.push(...catalogChanges(virtual, { ...virtual, config: { ...virtual.config, modelCatalogModels: pricedModels.map(catalogPriceDescriptor) } })
        .filter(change => change.kind !== "price").map(change => ({ ...change, groupId: identity })));
      result.changes.push(...prices.changes);
    }
  }
  // Only an already accepted source may retract its own public group. A failed
  // or first-ever list never proves another source's group disappeared.
  if (!groupOptionsOnly && receipt.coverage?.exhaustive) for (const identity of Object.keys(prior?.groups ?? {})) {
    if (Object.hasOwn(contribution.groups, identity)) continue;
    const other = Object.entries(pipeline.entries).some(([entryKey, value]) => entryKey.startsWith("offers:") && entryKey !== key &&
      Object.hasOwn((value as unknown as OfferState).groups ?? {}, identity));
    const old = catalogObservationCurrentGroup(supplier.catalog.groups, identity);
    if (!other && old && old.source !== "manual" && old.status !== "missing") {
      result.groups.push({ kind: "fields", groupId: identity, fields: { expected: { status: old.status }, set: { status: "missing" } } });
      result.changes.push({ kind: "group-removed", groupId: identity, before: "该来源目录不再列出此分组" });
    }
  }
  result.state.push({ key, expected: pipeline.entries[key], value: json(contribution) });
  return result;
}

import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import type { CatalogPriceProvenance, ModelDescriptor, ProviderOperation, StructuredModelPricing, StructuredPriceTier } from "@super-canvas/providers";
import { catalogPriceDescriptor } from "./supplier-catalog-price-merge";
import { catalogConnectionScopes } from "./catalog-source-plan";
import { applyWeAiLivePricing } from "./weai-catalog";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import type { CatalogChange } from "./supplier-catalog-contracts";
import { modelPickerPriceLabelData } from "./model-picker-data";
import { normalizeTk1688CnyModel } from "@super-canvas/providers/tk1688-catalog";

const DAY = 86_400_000;
export const CATALOG_UNPUBLISHED_CYCLES = 3;
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const clone = <T>(value: T): T => structuredClone(value);
const stable = (value: unknown): string => JSON.stringify(canonical(value));
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
}
const validPricing = (value: StructuredModelPricing | undefined): value is StructuredModelPricing => !!value &&
  typeof value.currency === "string" && !!value.currency.trim() && Number.isFinite(Date.parse(value.checkedAt)) &&
  [value.unitAmount, value.inputPerMillion, value.outputPerMillion, value.imageOutputPerMillion, ...(value.tiers ?? []).map(tier => tier.price)]
    .some(value => typeof value === "number" && Number.isFinite(value) && value >= 0) &&
  [value.unitAmount, value.inputPerMillion, value.outputPerMillion, value.imageOutputPerMillion, ...(value.tiers ?? []).map(tier => tier.price)]
    .every(value => value === undefined || typeof value === "number" && Number.isFinite(value) && value >= 0);
const priceSignature = (pricing: StructuredModelPricing | undefined): string => stable(pricing && {
  kind: pricing.kind, currency: pricing.currency, unitAmount: pricing.unitAmount, billingUnit: pricing.billingUnit,
  inputPerMillion: pricing.inputPerMillion, outputPerMillion: pricing.outputPerMillion, imageOutputPerMillion: pricing.imageOutputPerMillion,
  timeMultipliers: pricing.timeMultipliers, tiers: pricing.tiers?.map(({ evidence: _evidence, ...tier }) => { void _evidence; return tier; }),
});

export interface CatalogPriceSample {
  pricing?: StructuredModelPricing;
  label?: string;
  checkedAt: string;
  sourceUrl?: string;
}
export interface CatalogPriceEntry {
  sourceKey: string;
  modelId: string;
  operation?: ProviderOperation;
  conditionKey: string;
  status: "published" | "explicit-unpublished" | "unknown";
  checkedAt: string;
  sourceUrl?: string;
  pricing?: StructuredModelPricing;
  label?: string;
  unpublishedCycles: number;
  lastCountedCycleId?: string;
  lastCountedAt?: string;
  lastDispatchSeq: number;
  scopePriority?: number;
  lastObservationFingerprint?: string;
  billingMetadata?: Record<string, string | number | boolean>;
  conflict?: boolean;
  history: CatalogPriceSample[];
  conditionStates?: Record<string, { status: "explicit-unpublished" | "unknown"; unpublishedCycles: number;
    lastCountedCycleId?: string; lastCountedAt?: string }>;
}
export interface CatalogPriceState {
  schemaVersion: 1;
  connectionId: string;
  groupIdentity: string;
  identityEpoch: string;
  entries: Record<string, CatalogPriceEntry>;
}
export interface CatalogModelPriceEvidence {
  schemaVersion: 1;
  status: CatalogPriceEntry["status"];
  entries: CatalogPriceEntry[];
}

/** Only equality conjunctions over finite scalar wire values are independent.
 * Otherwise, including any/none/contains/fallback, the tariff remains opaque.
 */
export function discreteCatalogPriceConditions(tier: StructuredPriceTier): Record<string, string | number> | undefined {
  if (tier.otherwise || tier.conditionMode && tier.conditionMode !== "all") return;
  if (tier.conditions?.length) {
    const result: Record<string, string | number> = {};
    for (const condition of tier.conditions) {
      if (condition.operator !== "equals" || Object.hasOwn(result, condition.parameter)) return;
      result[condition.parameter] = condition.value;
    }
    return result;
  }
  // The legacy dimension matcher folds case and stringifies values. Only its
  // string subset has an unambiguous wire domain for incremental merging.
  if (tier.dimension && tier.dimension !== "fixed" && typeof tier.value === "string")
    return { [tier.dimension]: tier.value.toLowerCase() };
}
export function canMergeDiscreteCatalogPrices(a: StructuredModelPricing, b: StructuredModelPricing): boolean {
  if (!a.tiers?.length || !b.tiers?.length || a.unitAmount !== undefined || b.unitAmount !== undefined || a.kind === "token" || b.kind === "token") return false;
  const framework = (price: StructuredModelPricing) => stable({ kind: price.kind, currency: price.currency, billingUnit: price.billingUnit,
    timeMultipliers: price.timeMultipliers, inputPerMillion: price.inputPerMillion, outputPerMillion: price.outputPerMillion, imageOutputPerMillion: price.imageOutputPerMillion,
    frameworkKey: price.evidence?.frameworkKey, operations: price.evidence?.operations });
  if (framework(a) !== framework(b)) return false;
  const forms = new Set([...a.tiers, ...b.tiers].map(tier => tier.conditions?.length ? "conjunction" : `dimension:${tier.dimension}`));
  if (forms.size !== 1) return false;
  const rows = [...a.tiers, ...b.tiers].map(discreteCatalogPriceConditions);
  if (rows.some(row => !row)) return false;
  const unique = [...new Map(rows.map(row => [stable(row), row!])).values()];
  // Nonidentical conditions must disagree on at least one shared dimension.
  return unique.every((left, i) => unique.slice(i + 1).every(right => Object.keys(left).some(key =>
    Object.hasOwn(right, key) && (typeof left[key] !== typeof right[key] || left[key] !== right[key]))));
}

function history(entry: CatalogPriceEntry): CatalogPriceSample[] {
  if (!entry.pricing && !entry.label) return entry.history;
  const sample: CatalogPriceSample = { ...(entry.pricing ? { pricing: clone(entry.pricing) } : {}),
    ...(entry.label ? { label: entry.label } : {}), checkedAt: entry.checkedAt, ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}) };
  const rows = [...entry.history];
  if (!rows.some(row => priceSignature(row.pricing) === priceSignature(sample.pricing) && row.label === sample.label)) rows.push(sample);
  return rows.slice(-32);
}

function mergePricing(previous: StructuredModelPricing | undefined, incoming: StructuredModelPricing,
  provenance: CatalogPriceProvenance, complete: boolean): StructuredModelPricing | undefined {
  const current = { ...clone(incoming), evidence: provenance };
  if (previous && canMergeDiscreteCatalogPrices(previous, current)) {
    const tiers = new Map<string, StructuredPriceTier>(previous.tiers!.map(tier => [stable(discreteCatalogPriceConditions(tier)), {
      ...clone(tier), evidence: { ...(tier.evidence ?? { sourceKey: provenance.sourceKey, checkedAt: previous.checkedAt,
        ...(previous.sourceUrl ? { sourceUrl: previous.sourceUrl } : {}) }), status: "retained" as const },
    }]));
    for (const tier of current.tiers!) tiers.set(stable(discreteCatalogPriceConditions(tier)), { ...tier, evidence: provenance });
    return { ...current, tiers: [...tiers.values()], evidence: provenance };
  }
  // A partial ordered tariff is never spliced into or substituted for a whole tariff.
  if (!complete && current.tiers?.length && !canMergeDiscreteCatalogPrices(current, current)) return;
  return { ...current, ...(current.tiers ? { tiers: current.tiers.map(tier => ({ ...tier, evidence: provenance })) } : {}), evidence: provenance };
}

function groupNames(connection: ProviderConnectionRecord, supplier: SupplierRecord | undefined, identity: string): string[] {
  const names = [connection.config.accountKeyGroup, connection.config.modelGroup].filter((value): value is string => typeof value === "string");
  for (const group of supplier?.catalog.groups ?? []) if ((group.supplierGroupId !== undefined ? `site-id:${group.supplierGroupId}` : `name:${group.id}`) === identity) names.push(group.id);
  return [...new Set(names)];
}
function observationModels(observation: CatalogReadObservation, connection: ProviderConnectionRecord,
  supplier: SupplierRecord | undefined, identity: string, observations: readonly CatalogReadObservation[] = []): ModelDescriptor[] {
  const names = groupNames(connection, supplier, identity), facts = observation.facts, source = facts.sourceFacts;
  if (facts.supplierGroups?.length) return facts.supplierGroups.filter(group =>
    (group.supplierGroupId !== undefined ? `site-id:${group.supplierGroupId}` : `name:${group.id}`) === identity)
    .flatMap(group => group.models.map(catalogPriceDescriptor));
  if (source?.kind === "cangyuan") {
    const snapshot = source.value.snapshot;
    if (!snapshot) return [];
    const descriptors = names.flatMap(name => (snapshot.groups as Record<string, ModelDescriptor[]>)[name] ?? []).map(clone);
    const known = new Set(descriptors.map(model => model.id));
    return [...descriptors, ...snapshot.marketplaceGroups.filter(group => names.includes(group.id)).flatMap(group => group.models)
      .filter(model => !known.has(model.id)).map(model => ({ id: model.id, name: model.name, operations: [], metadata: { priceLabel: model.priceLabel } }))];
  }
  if (source?.kind === "weai") {
    const groups = source.value.groups.filter(group => names.includes(group.groupId));
    if (groups.length !== 1) return [];
    const group = groups[0]!;
    return applyWeAiLivePricing(Object.keys(group.models).map(id => ({ id, name: id, operations: [] })), group);
  }
  if (source?.kind === "tk1688") {
    const scopes = catalogConnectionScopes(connection, supplier);
    const dependency = observations.find(row => row.facts.sourceFacts?.kind === "tk1688" && row.facts.sourceFacts.value.source === "status" &&
      row.receipt.status === "succeeded" && row.receipt.complete && row.receipt.freshness === "live" &&
      row.receipt.context.identityEpoch === observation.receipt.context.identityEpoch && row.receipt.context.observationCycleId === observation.receipt.context.observationCycleId &&
      row.receipt.spec.applyScope.supplierId === scopes.apply.supplierId && row.receipt.spec.applyScope.supplierSourceId === scopes.apply.supplierSourceId &&
      row.receipt.spec.authScope.kind === "anonymous" && row.receipt.spec.authScope.principalRef === scopes.anonymous.principalRef &&
      row.receipt.spec.authScope.credentialEpoch === scopes.anonymous.credentialEpoch);
    const status = dependency?.facts.sourceFacts?.kind === "tk1688" && dependency.facts.sourceFacts.value.source === "status"
      ? dependency.facts.sourceFacts.value : undefined;
    return source.value.models?.map(value => {
      const model = clone(value), raw = object(model.metadata?.tk1688OriginalPricing) as unknown as StructuredModelPricing;
      if (source.value.source !== "marketplace" || !status?.paymentFxRateCnyPerUsd || !validPricing(raw)) return model;
      return normalizeTk1688CnyModel({ ...model, pricing: raw, metadata: { ...model.metadata,
        priceLabel: model.metadata?.tk1688OriginalPriceLabel ?? model.metadata?.priceLabel,
        tk1688FxRate: status.paymentFxRateCnyPerUsd, tk1688FxRateCheckedAt: status.checkedAt, tk1688FxRateSourceUrl: status.sourceUrl,
        ...(status.platformMarkupPercent !== undefined ? { tk1688PlatformMarkupPercent: status.platformMarkupPercent } : {}) } });
    }) ?? [];
  }
  return facts.models.filter(model => {
    const metadata = model.metadata ?? {};
    if (metadata.supplierPriceGroupId !== undefined) return identity === `site-id:${metadata.supplierPriceGroupId}`;
    const name = metadata.supplierPriceGroup ?? metadata.catalogGroup;
    if (name !== undefined) return names.includes(String(name));
    // A connection-key fact has exact scope; public facts need an explicit group domain.
    return observation.receipt.spec.authScope.kind === "connection-key" || observation.receipt.spec.applyScope.groupIdentity === identity ||
      observation.receipt.coverage?.groupIdentities?.includes(identity) === true;
  }).map(model => catalogPriceDescriptor(model));
}

export function applicablePriceObservation(observation: CatalogReadObservation, connection: ProviderConnectionRecord,
  supplier: SupplierRecord | undefined, identity: string): boolean {
  const { spec } = observation.receipt, scopes = catalogConnectionScopes(connection, supplier);
  if (spec.applyScope.supplierId !== scopes.apply.supplierId || spec.applyScope.supplierSourceId !== scopes.apply.supplierSourceId) return false;
  const expectedAuth = spec.authScope.kind === "anonymous" ? scopes.anonymous : spec.authScope.kind === "site-account" ? scopes.account : scopes.key;
  if (spec.authScope.principalRef !== expectedAuth.principalRef || spec.authScope.credentialEpoch !== expectedAuth.credentialEpoch) return false;
  if (spec.applyScope.groupIdentity === identity) return true;
  if (spec.authScope.kind === "connection-key") return false;
  const { facts } = observation;
  if (facts.supplierGroups?.some(group => (group.supplierGroupId !== undefined ? `site-id:${group.supplierGroupId}` : `name:${group.id}`) === identity)) return true;
  const names = groupNames(connection, supplier, identity);
  if (facts.sourceFacts?.kind === "cangyuan") return !!facts.sourceFacts.value.snapshot?.marketplaceGroups.some(group => names.includes(group.id));
  if (facts.sourceFacts?.kind === "weai") return facts.sourceFacts.value.groups.some(group => names.includes(group.groupId));
  // Marketplace SKU aliases contain their channel identity; the same exact SKU
  // may appear in multiple Key groups. This adapter does not publish group prices.
  if (facts.sourceFacts?.kind === "tk1688" && facts.sourceFacts.value.source === "marketplace") return true;
  return facts.priceStates?.some(row => row.groupIdentity === identity) === true && observation.receipt.coverage?.groupIdentities?.includes(identity) === true;
}

function measuredEvidence(connection: ProviderConnectionRecord, model: ModelDescriptor, supplier: SupplierRecord | undefined, identity: string): Row[] {
  const sourceId = supplier?.state?.sourceId ?? connection.config.supplierSourceId;
  return (Array.isArray(connection.config.measuredPriceEvidence) ? connection.config.measuredPriceEvidence : []).filter(value => {
    const row = object(value), charge = object(row.actualCharge);
    if (row.modelId !== model.id || row.parameterScope !== "exact" || !Object.keys(object(row.parameters)).length && !row.parameters ||
      identity !== `site-id:${row.supplierGroupId}` || row.sourceId !== sourceId || row.accountKeyId !== String(connection.config.accountKeyId ?? "")) return false;
    return typeof charge.amount === "number" && Number.isFinite(charge.amount) && charge.amount >= 0 &&
      (typeof row.requestId === "string" && !!row.requestId && row.requestId === charge.requestId ||
       typeof row.providerTaskId === "string" && !!row.providerTaskId && row.providerTaskId === charge.taskId);
  }).map(value => clone(object(value)));
}

/** Pure per-connection reducer. Facts are never allowed to lend another group's quote. */
export function reduceCatalogPrices(previous: CatalogPriceState | undefined, input: {
  connection: ProviderConnectionRecord; supplier?: SupplierRecord; models: readonly ModelDescriptor[];
  observations: readonly CatalogReadObservation[]; identityEpoch: string; mode: string; observedAt: string;
}): { state: CatalogPriceState; models: ModelDescriptor[]; changes: CatalogChange[]; retainedPriceModelCount: number } {
  const { connection } = input, scopes = catalogConnectionScopes(connection, input.supplier), identity = scopes.apply.groupIdentity ?? "name:";
  const state: CatalogPriceState = previous?.schemaVersion === 1 && previous.connectionId === connection.id && previous.groupIdentity === identity
    ? clone(previous) : { schemaVersion: 1, connectionId: connection.id, groupIdentity: identity, identityEpoch: input.identityEpoch, entries: {} };
  if (state.identityEpoch !== input.identityEpoch) { state.entries = {}; state.identityEpoch = input.identityEpoch; }
  // Existing schema-1 entries were unscoped tariffs. Rekey without fabricating
  // an operation or a new observation/confirmation cycle.
  for (const [key, entry] of Object.entries(state.entries)) {
    const scoped = stable([entry.sourceKey, identity, entry.modelId, entry.operation ?? "*"]);
    if (scoped !== key && !state.entries[scoped]) { state.entries[scoped] = entry; delete state.entries[key]; }
  }
  const original = new Map((Array.isArray(connection.config.modelCatalogModels) ? connection.config.modelCatalogModels : []).map(value => {
    const model = catalogPriceDescriptor(value); return [model.id, model] as const;
  }));
  const candidates = input.observations.filter(row => row.receipt.context.identityEpoch === input.identityEpoch &&
    row.receipt.freshness === "live" &&
    (["catalog-offer", "price"].includes(row.receipt.spec.role) || row.receipt.spec.role === "schema" &&
      row.facts.sourceFacts?.kind === "miaowu-schema" && row.facts.models.some(model => !!model.pricing)) &&
    applicablePriceObservation(row, connection, input.supplier, identity))
    .sort((a, b) => Date.parse(a.receipt.checkedAt) - Date.parse(b.receipt.checkedAt) || a.receipt.context.dispatchSeq - b.receipt.context.dispatchSeq);
  for (const observation of candidates) {
    const { receipt } = observation;
    const projected = observationModels(observation, connection, input.supplier, identity, input.observations);
    const byId = new Map<string, ModelDescriptor[]>();
    for (const model of projected) { const rows = byId.get(model.id) ?? []; rows.push(model); byId.set(model.id, rows); }
    const oldSlots = new Map<string, Array<ProviderOperation | undefined>>();
    for (const entry of Object.values(state.entries)) if (entry.sourceKey === receipt.spec.sourceKey) {
      const slots = oldSlots.get(entry.modelId) ?? []; slots.push(entry.operation); oldSlots.set(entry.modelId, slots);
    }
    const slots = input.models.flatMap(model => {
      const byOperation = new Map<ProviderOperation | undefined, ModelDescriptor[]>();
      for (const row of byId.get(model.id) ?? []) {
        const declared = row.metadata?.catalogPriceOperation ?? (row.operations.length === 1 ? row.operations[0] : model.operations.length === 1 ? model.operations[0] : undefined);
        if (declared !== undefined && (typeof declared !== "string" || !model.operations.includes(declared as ProviderOperation))) continue;
        const operation = declared as ProviderOperation | undefined, rows = byOperation.get(operation) ?? [];
        rows.push(row); byOperation.set(operation, rows);
      }
      for (const operation of oldSlots.get(model.id) ?? []) if (!byOperation.has(operation)) byOperation.set(operation, []);
      for (const declared of observation.facts.priceStates ?? []) {
        const operation = declared.operation ?? (model.operations.length === 1 ? model.operations[0] : undefined);
        if (declared.modelId === model.id && (!declared.groupIdentity || declared.groupIdentity === identity) &&
          (!operation || model.operations.includes(operation)) && !byOperation.has(operation)) byOperation.set(operation, []);
      }
      if (!byOperation.size) byOperation.set(undefined, []);
      return [...byOperation].map(([operation, rows]) => ({ model, operation,
        next: rows[0], conflicting: new Set(rows.map(row => stable([priceSignature(row.pricing), row.metadata?.priceLabel]))).size > 1 }));
    });
    for (const { model, operation, next, conflicting } of slots) {
      const key = stable([receipt.spec.sourceKey, identity, model.id, operation ?? "*"]);
      let entry = state.entries[key];
      const fingerprint = stable({ pricing: priceSignature(next?.pricing), label: next?.metadata?.priceLabel, status: receipt.status,
        complete: receipt.complete, priceStates: observation.facts.priceStates, conflicting });
      if (entry && (receipt.context.dispatchSeq < entry.lastDispatchSeq || receipt.context.dispatchSeq === entry.lastDispatchSeq &&
        fingerprint === entry.lastObservationFingerprint)) continue;
      const explicitRows = ((observation.facts as typeof observation.facts & { priceStates?: Array<{ modelId: string; state: string; groupIdentity?: string; operation?: ProviderOperation; conditions?: StructuredPriceTier["conditions"] }> }).priceStates ?? [])
        .map(row => ({ ...row, operation: row.operation ?? (model.operations.length === 1 ? model.operations[0] : undefined) }))
        .filter(row => (!row.groupIdentity || row.groupIdentity === identity) && row.operation === operation);
      const declared = explicitRows.find(row => row.modelId === model.id && row.state === "explicit-unpublished" && !row.conditions?.length &&
        row.operation === operation);
      const conditionDeclarations = explicitRows.filter(row => row.modelId === model.id && row.state === "explicit-unpublished" && row.conditions?.length);
      const explicit = !!declared || next?.metadata?.catalogPricePresence === "explicit-unpublished";
      const pricing = next?.metadata?.supplierPriceConflict !== true && next?.metadata?.priceStatus !== "conflict" && validPricing(next?.pricing) ? next.pricing : undefined;
      const proseLabel = modelPickerPriceLabelData(next?.metadata?.priceLabel);
      const published = !conflicting && receipt.status === "succeeded" && (!!pricing || proseLabel !== "—");
      // A complete source must explicitly declare this model/condition as unpriced.
      const unpublished = receipt.status === "succeeded" && receipt.complete && receipt.coverage?.exhaustive === true && explicit &&
        receipt.coverage.modelIds.includes(model.id);
      const savedPricing = original.get(model.id)?.pricing;
      const sameLegacySource = savedPricing?.sourceUrl === receipt.spec.sourceUrl || savedPricing?.evidence?.sourceKey === receipt.spec.sourceKey;
      if (!entry && !published && !unpublished && !conflicting && !conditionDeclarations.length && (!sameLegacySource || !validPricing(savedPricing))) continue;
      if (!entry) {
        const old = original.get(model.id), savedPrice = old?.metadata?.priceSource === "generated-result" ? undefined : old?.pricing;
        const sameOperation = operation ? savedPrice?.evidence?.operations?.length === 1 && savedPrice.evidence.operations[0] === operation ||
          !savedPrice?.evidence?.operations?.length && old?.operations.length === 1 && old.operations[0] === operation
          : !savedPrice?.evidence?.operations?.length;
        const oldPrice = !sameOperation || savedPrice?.evidence?.sourceKey && savedPrice.evidence.sourceKey !== receipt.spec.sourceKey ? undefined : savedPrice;
        const oldAt = oldPrice?.checkedAt ?? String(old?.metadata?.priceCheckedAt ?? receipt.checkedAt);
        const oldLabel = modelPickerPriceLabelData(old?.metadata?.priceLabel);
        entry = { sourceKey: receipt.spec.sourceKey, modelId: model.id, ...(operation ? { operation } : {}), conditionKey: "tariff", status: "unknown", checkedAt: oldAt,
          ...(oldPrice ? { pricing: clone(oldPrice) } : {}), ...(sameOperation && old?.metadata?.priceSource !== "generated-result" && oldLabel !== "—" ? { label: oldLabel } : {}),
          unpublishedCycles: 0, lastDispatchSeq: 0, history: [] };
        if (entry.pricing && operation && !entry.pricing.evidence?.operations?.length)
          entry.pricing.evidence = { ...(entry.pricing.evidence ?? { sourceKey: "legacy", checkedAt: entry.pricing.checkedAt, status: "retained" }), operations: [operation] };
      }
      if (published) {
        const dependencies = Object.fromEntries(Object.entries(next?.metadata ?? {}).filter(([key]) =>
          /^(?:billingExpression|billingRuleVersion|billingIncludesInputDuration|tk1688FxRate|tk1688FxRateCheckedAt|tk1688FxRateSourceUrl|tk1688PlatformMarkupPercent|rateMultiplier)$/u.test(key)));
        const oldDependencies = Object.fromEntries(Object.entries(original.get(model.id)?.metadata ?? {}).filter(([key]) =>
          /^(?:billingExpression|billingRuleVersion|billingIncludesInputDuration|tk1688FxRate|tk1688FxRateCheckedAt|tk1688FxRateSourceUrl|tk1688PlatformMarkupPercent|rateMultiplier)$/u.test(key)));
        const framework = (values: Row) => stable(Object.fromEntries(Object.entries(values).filter(([key]) => !/At$|SourceUrl$/u.test(key))));
        const scalarDependencies = (values: Row) => Object.fromEntries(Object.entries(values).filter((row): row is [string, string | number | boolean] =>
          typeof row[1] === "string" || typeof row[1] === "number" || typeof row[1] === "boolean"));
        const evidence: CatalogPriceProvenance = { sourceKey: receipt.spec.sourceKey, checkedAt: pricing?.checkedAt ?? receipt.checkedAt,
          status: "published", sourceUrl: pricing?.sourceUrl ?? receipt.spec.sourceUrl,
          ...(operation ? { operations: [operation] } : {}),
          ...(Object.keys(dependencies).length ? { frameworkKey: framework(dependencies), dependencies: scalarDependencies(dependencies) } : {}) };
        if (entry.pricing && !entry.pricing.evidence && Object.keys(oldDependencies).length)
          entry.pricing.evidence = { sourceKey: entry.sourceKey, checkedAt: entry.pricing.checkedAt, status: "retained",
            frameworkKey: framework(oldDependencies), dependencies: scalarDependencies(oldDependencies) };
        const merged = pricing ? mergePricing(entry.pricing, pricing, evidence, receipt.complete) : undefined;
        if (merged && priceSignature(merged) !== priceSignature(entry.pricing) || !pricing && proseLabel !== entry.label) entry.history = history(entry);
        // Text-only partial fragments cannot replace a numeric tariff.
        const acceptedProse = !pricing && proseLabel !== "—" && receipt.complete;
        if (acceptedProse) delete entry.pricing;
        entry = { ...entry, ...(merged ? { pricing: merged } : {}), status: merged || acceptedProse ? "published" : "unknown",
          checkedAt: merged?.checkedAt ?? (acceptedProse ? receipt.checkedAt : entry.checkedAt), sourceUrl: receipt.spec.sourceUrl, unpublishedCycles: 0,
          ...(acceptedProse ? { label: proseLabel } : typeof next?.metadata?.priceLabel === "string" && merged ? { label: next.metadata.priceLabel } : {}) };
        if (merged) entry.billingMetadata = { ...entry.billingMetadata, ...scalarDependencies(dependencies) };
        delete entry.lastCountedCycleId; delete entry.lastCountedAt;
        if (entry.conditionStates && merged) for (const tier of pricing?.tiers ?? []) {
          const condition = discreteCatalogPriceConditions(tier);
          if (condition) delete entry.conditionStates[stable(condition)];
        }
      } else if (unpublished) {
        const at = Date.parse(receipt.checkedAt), before = entry.unpublishedCycles;
        if (entry.lastCountedCycleId !== receipt.context.observationCycleId && (!entry.lastCountedAt || at - Date.parse(entry.lastCountedAt) >= DAY)) {
          entry.unpublishedCycles++;
          entry.lastCountedCycleId = receipt.context.observationCycleId; entry.lastCountedAt = receipt.checkedAt;
        }
        if (before < CATALOG_UNPUBLISHED_CYCLES && entry.unpublishedCycles >= CATALOG_UNPUBLISHED_CYCLES) {
          entry.history = history(entry); delete entry.pricing; delete entry.label;
        }
        entry.status = entry.unpublishedCycles >= CATALOG_UNPUBLISHED_CYCLES ? "explicit-unpublished" : "unknown";
      } else {
        // Unknown breaks consecutive evidence; it neither increments nor clears prices.
        entry.unpublishedCycles = 0; delete entry.lastCountedCycleId; delete entry.lastCountedAt; entry.status = "unknown";
        if (!conditionDeclarations.length) delete entry.conditionStates;
      }
      if (receipt.status === "succeeded" && receipt.complete && receipt.coverage?.exhaustive === true && receipt.coverage.modelIds.includes(model.id) &&
        conditionDeclarations.length && entry.pricing && canMergeDiscreteCatalogPrices(entry.pricing, entry.pricing)) {
        for (const declaration of conditionDeclarations) {
          const tariff = entry.pricing;
          if (!tariff) break;
          const condition = discreteCatalogPriceConditions({ id: "declaration", label: "", price: 0, conditionMode: "all", conditions: declaration.conditions });
          if (!condition || declaration.operation && !model.operations.includes(declaration.operation)) continue;
          const tier = tariff.tiers?.find(tier => stable(discreteCatalogPriceConditions(tier)) === stable(condition) ||
            !tier.conditions && declaration.conditions?.length === 1 && tier.dimension === declaration.conditions[0]?.parameter &&
            String(tier.value).toLowerCase() === declaration.conditions[0].value.toLowerCase());
          if (!tier) continue;
          const conditionKey = stable(discreteCatalogPriceConditions(tier));
          // Operation-scoped absence cannot remove a price shared with another operation.
          const scope = tier.evidence?.operations ?? tariff.evidence?.operations;
          if (declaration.operation && (!scope?.length || scope.some(operation => operation !== declaration.operation))) continue;
          const counters = entry.conditionStates ??= {}, counter = counters[conditionKey] ?? { status: "unknown" as const, unpublishedCycles: 0 };
          if (counter.lastCountedCycleId !== receipt.context.observationCycleId && (!counter.lastCountedAt ||
            Date.parse(receipt.checkedAt) - Date.parse(counter.lastCountedAt) >= DAY)) {
            counter.unpublishedCycles++; counter.lastCountedCycleId = receipt.context.observationCycleId; counter.lastCountedAt = receipt.checkedAt;
          }
          if (counter.unpublishedCycles >= CATALOG_UNPUBLISHED_CYCLES) {
            counter.status = "explicit-unpublished";
            const sampled = tier.evidence?.checkedAt ?? tariff.checkedAt;
            entry.history.push({ pricing: { ...clone(tariff), tiers: [clone(tier)] }, checkedAt: sampled,
              ...(tier.evidence?.sourceUrl ?? entry.sourceUrl ? { sourceUrl: tier.evidence?.sourceUrl ?? entry.sourceUrl } : {}) });
            entry.history = entry.history.slice(-32);
            tariff.tiers = tariff.tiers?.filter(row => row !== tier);
            if (!tariff.tiers?.length) { delete entry.pricing; delete entry.label; entry.status = "explicit-unpublished"; }
          }
          counters[conditionKey] = counter;
        }
      }
      entry.lastDispatchSeq = receipt.context.dispatchSeq;
      entry.conflict = conflicting;
      entry.lastObservationFingerprint = fingerprint;
      entry.scopePriority = receipt.spec.authScope.kind === "connection-key" ? 2 : receipt.spec.authScope.kind === "site-account" ? 1 : 0;
      state.entries[key] = entry;
    }
  }
  const changes: CatalogChange[] = [], retained = new Set<string>(), entriesByModel = new Map<string, CatalogPriceEntry[]>();
  for (const entry of Object.values(state.entries)) {
    const entries = entriesByModel.get(entry.modelId);
    if (entries) entries.push(entry); else entriesByModel.set(entry.modelId, [entry]);
  }
  const models = input.models.map(value => {
    const model = clone(value), old = original.get(model.id) ?? model;
    // Preserve every manually authored rule, original billed evidence and user parameter.
    if (old.metadata?.priceSource === "manual" || old.metadata?.customBilling === true) {
      return { ...model, pricing: clone(old.pricing), metadata: { ...model.metadata, ...old.metadata } };
    }
    const entries = entriesByModel.get(model.id) ?? [];
    if (!entries.length) return model;
    const latest = [...entries].sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt) || b.lastDispatchSeq - a.lastDispatchSeq)[0]!;
    const priced = entries.filter(entry => entry.pricing || entry.label).sort((a, b) =>
      (b.scopePriority ?? 0) - (a.scopePriority ?? 0) || Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
    // Newer explicit withdrawal supersedes this source only, never a different source's published evidence.
    const chosen = priced[0];
    const operationConflict = new Set(priced.map(entry => entry.operation ?? "*")).size > 1 &&
      new Set(priced.map(entry => stable([priceSignature(entry.pricing), entry.label]))).size > 1;
    const conflict = entries.some(entry => entry.conflict) || operationConflict || !!chosen && priced.some(entry => entry !== chosen && (entry.scopePriority ?? 0) === (chosen.scopePriority ?? 0) &&
      entry.checkedAt === chosen.checkedAt && entry.status === "published" && chosen.status === "published" &&
      (priceSignature(entry.pricing) !== priceSignature(chosen.pricing) || entry.label !== chosen.label));
    const pricing = !conflict && chosen?.pricing ? clone(chosen.pricing) : undefined;
    const unknown = chosen?.status !== "published" || new Set(priced.map(entry => entry.operation ?? "*")).size > 1 && priced.some(entry => entry.status !== "published");
    if (pricing && !priced.some(entry => !entry.operation)) {
      const operations = [...new Set(priced.flatMap(entry => entry.operation ? [entry.operation] : []))];
      if (operations.length) pricing.evidence = { ...(pricing.evidence ?? { sourceKey: chosen!.sourceKey, checkedAt: pricing.checkedAt, status: "published" }), operations };
    }
    if (pricing && unknown) {
      const evidence = { ...pricing.evidence, sourceKey: chosen!.sourceKey, checkedAt: pricing.checkedAt, status: "retained" as const,
        ...(pricing.sourceUrl ? { sourceUrl: pricing.sourceUrl } : {}) };
      pricing.evidence = evidence;
      if (pricing.tiers) pricing.tiers = pricing.tiers.map(tier => ({ ...tier, evidence: { ...(tier.evidence ?? evidence), status: "retained" } }));
    }
    const partial = !!pricing && (unknown || pricing.tiers?.some(tier => tier.evidence?.status === "retained"));
    if (partial) retained.add(model.id);
    const measured = measuredEvidence(connection, model, input.supplier, identity);
    const metadata: Row = { ...model.metadata, ...chosen?.billingMetadata,
      ...(old.metadata?.measuredPrice ? { measuredPrice: clone(old.metadata.measuredPrice) } : {}),
      ...(old.metadata?.priceSource === "generated-result" ? { catalogLegacyMeasuredPrice: {
        ...(old.pricing ? { pricing: clone(old.pricing) } : {}), ...(old.metadata.measuredPrice ? { evidence: clone(old.metadata.measuredPrice) } : {}),
        label: old.metadata.priceLabel, checkedAt: old.metadata.priceCheckedAt ?? old.pricing?.checkedAt,
      } } : {}),
      ...(measured.length ? { catalogMeasuredPrices: measured } : {}),
      priceSource: "supplier-catalog", priceStatus: conflict ? "conflict" : partial ? "partial" : pricing ? "published" : latest.status,
      priceCheckedAt: pricing?.checkedAt ?? latest.checkedAt,
      priceLastAttemptAt: input.observedAt, supplierPriceGroupId: identity.startsWith("site-id:") ? identity.slice(8) : undefined,
      catalogUnavailablePriceOperations: [...new Set(entries.filter(entry => entry.operation && (entry.status !== "published" || entry.conflict)).map(entry => entry.operation))],
      catalogPriceEvidence: { schemaVersion: 1, status: pricing ? "published" : latest.status, entries: entries.map(({ pricing: _pricing, billingMetadata: _billingMetadata, ...entry }) => {
        void _pricing; void _billingMetadata;
        return { ...clone(entry), history: clone(entry.history.slice(-4)) };
      }) } satisfies CatalogModelPriceEvidence,
      priceLabel: conflict ? "价格存在冲突，待确认" : chosen?.label ? `${chosen.label.replace(/（上次价格）$/u, "")}${unknown ? "（上次价格）" : ""}` : pricing ? partial ? "（上次价格）" : "" : "价格未公布",
    };
    if (conflict) metadata.supplierPriceConflict = true;
    else delete metadata.supplierPriceConflict;
    const result = { ...model, ...(pricing ? { pricing } : { pricing: undefined }), metadata };
    const beforePricing = old.metadata?.priceSource === "generated-result" ? undefined : old.pricing;
    const oldLabel = modelPickerPriceLabelData(old.metadata?.priceLabel);
    const beforeLabel = beforePricing || old.metadata?.priceSource === "generated-result" || oldLabel === "—" ? "" : oldLabel.replace(/（上次价格）$/u, "");
    const afterLabel = pricing ? "" : chosen?.label ?? "";
    if (!conflict && (priceSignature(beforePricing) !== priceSignature(pricing) || beforeLabel !== afterLabel)) changes.push({ kind: "price", modelId: model.id, groupId: identity,
      before: beforePricing ? priceDescription(beforePricing) : beforeLabel || "—", after: pricing ? priceDescription(pricing) : afterLabel || "—" });
    return result;
  });
  return { state, models, changes, retainedPriceModelCount: retained.size };
}

function priceDescription(pricing: StructuredModelPricing | undefined): string {
  if (!pricing) return "—";
  const unit = pricing.billingUnit ?? pricing.kind;
  return `${pricing.currency} / ${unit} · ${pricing.tiers?.map(tier => `${tier.label}: ${tier.price}`).join("；") ??
    [pricing.unitAmount, pricing.inputPerMillion, pricing.outputPerMillion, pricing.imageOutputPerMillion].filter(value => value !== undefined).join(" / ")}`;
}

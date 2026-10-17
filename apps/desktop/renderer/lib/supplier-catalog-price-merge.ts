import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { modelPickerPriceData } from "./model-picker-data";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const historicalSuffix = /（上次价格）$/u;
const priceMetadata = (key: string): boolean => /price|pricing|billing/iu.test(key) ||
  ["tk1688FxRate", "tk1688FxRateSourceUrl", "tk1688FxRateCheckedAt", "tk1688PlatformMarkupPercent", "tk1688RetailPriceIncludesMarkup"].includes(key);
const pricingFields = ["secureSkillCatalogPricing", "chuangxiangCatalogPricing", "tk1688Pricing", "weaiLegacyPricing",
  "sub2apiPlazaPricing", "miaowuCatalogPricing", "hangCatalogPricing", "officialCatalogPricing"];

/** A numeric-looking group name is not an official group ID. Joining these
 * namespaces would transfer a quote across unrelated supplier groups. */
export function catalogGroupIdentity(group: { id: string; supplierGroupId?: string }): string {
  return group.supplierGroupId === undefined ? `name:${group.id}` : `site-id:${group.supplierGroupId}`;
}

/** Catalog models store a tariff in metadata; connection models also have a
 * top-level pricing field. Read those existing shapes without inventing rates. */
export function catalogPriceDescriptor(value: unknown): ModelDescriptor {
  const row = object(value), metadata = object(row.metadata);
  return { ...row, id: String(row.id ?? ""), name: String(row.name ?? row.id ?? ""),
    operations: Array.isArray(row.operations) ? row.operations : [],
    metadata: { ...metadata, ...(typeof row.priceLabel === "string" ? { priceLabel: row.priceLabel } : {}) },
    pricing: row.pricing ?? pricingFields.map(key => metadata[key]).find(value => value !== undefined) } as ModelDescriptor;
}
export function catalogHasPrice(value: unknown, fresh = false): boolean {
  const descriptor = catalogPriceDescriptor(value), metadata = object(descriptor.metadata);
  if (metadata.supplierPriceConflict === true || metadata.priceStatus === "conflict") return false;
  if (fresh && (["partial", "failed", "unknown", "unavailable", "unconfirmed", "conflict"].includes(String(metadata.priceStatus ?? "")) ||
    ["partial", "failed", "unauthorized"].includes(String(metadata.priceLastAttemptStatus ?? "")) ||
    historicalSuffix.test(String(metadata.priceLabel ?? "")))) return false;
  return modelPickerPriceData(descriptor) !== "—";
}
function sampledAt(value: unknown, fallback?: string): string | undefined {
  const row = object(value), metadata = object(row.metadata), pricing = object(catalogPriceDescriptor(row).pricing);
  return [metadata.priceCheckedAt, pricing.checkedAt, metadata.supplierCatalogPriceCheckedAt, fallback]
    .find((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)));
}
function copyPrice(previous: Row, current: Row): Row {
  const metadata = { ...object(current.metadata) };
  for (const key of Object.keys(metadata)) if (priceMetadata(key)) delete metadata[key];
  for (const [key, value] of Object.entries(object(previous.metadata))) if (priceMetadata(key)) metadata[key] = structuredClone(value);
  const result: Row = { ...current, metadata };
  for (const key of ["pricing", "priceLabel"]) {
    if (Object.hasOwn(previous, key)) result[key] = structuredClone(previous[key]);
    else delete result[key];
  }
  return result;
}
function exactPriceGroup(value: unknown, groupId: string | undefined, groupName: string | undefined): boolean {
  const metadata = object(object(value).metadata);
  if (metadata.supplierPriceGroupId !== undefined)
    return groupId !== undefined && String(metadata.supplierPriceGroupId) === groupId;
  const named = metadata.supplierPriceGroup ?? metadata.catalogGroup;
  return named === undefined || groupName !== undefined && named === groupName;
}
interface PriceScope { groupId?: string; groupName?: string; previousSample?: string; attemptedAt: string }
function mergeModel(previous: unknown, current: unknown, scope: PriceScope): { model: Row; retained: boolean } {
  const next = structuredClone(object(current)), old = object(previous);
  if (!Object.keys(old).length || !exactPriceGroup(old, scope.groupId, scope.groupName)) return { model: next, retained: false };
  // Observed charges are an independent, parameter-scoped source of evidence.
  // A catalog check never rewrites that evidence, even when an advertised rate
  // is now available. Its parameters and original timestamp stay untouched.
  if (object(old.metadata).priceSource === "generated-result")
    return { model: copyPrice(old, next), retained: false };
  if (catalogHasPrice(next, true) || !catalogHasPrice(old)) return { model: next, retained: false };
  const model = copyPrice(old, next), metadata = object(model.metadata);
  const at = sampledAt(old, scope.previousSample);
  const label = typeof model.priceLabel === "string" ? model.priceLabel : metadata.priceLabel;
  if (typeof label === "string" && label.trim()) {
    const historical = `${label.replace(historicalSuffix, "")}（上次价格）`;
    if (typeof model.priceLabel === "string") model.priceLabel = historical;
    metadata.priceLabel = historical;
  }
  model.metadata = { ...metadata, priceStatus: "partial", ...(at ? { priceCheckedAt: at } : {}),
    priceLastAttemptAt: scope.attemptedAt, priceLastAttemptStatus: "partial" };
  return { model, retained: true };
}
function models(value: unknown): Row[] { return Array.isArray(value) ? value.map(object) : []; }
function indexModels(value: unknown): Map<string, Row> {
  const result = new Map<string, Row>(), ambiguous = new Set<string>();
  for (const row of models(value)) {
    const id = String(row.id ?? "");
    // Ambiguous duplicate identities are not evidence for a fallback price.
    if (id && !result.has(id) && !ambiguous.has(id)) result.set(id, row);
    else if (id) { result.delete(id); ambiguous.add(id); }
  }
  return result;
}
function groupScope(connection: ProviderConnectionRecord, supplier?: SupplierRecord): Pick<PriceScope, "groupId" | "groupName"> {
  const name = String(connection.config.accountKeyGroup ?? connection.config.modelGroup ?? "");
  const stable = connection.config.accountKeyGroupId;
  const candidates = supplier?.catalog.groups.filter(group => stable !== undefined
    ? group.supplierGroupId === String(stable) : group.id === name) ?? [];
  return { ...(stable !== undefined ? { groupId: String(stable) } : candidates.length === 1 && candidates[0]!.supplierGroupId
    ? { groupId: candidates[0]!.supplierGroupId } : {}), ...(name ? { groupName: name } : {}) };
}
function priceIdentity(value: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/At$/u.test(key) && !["sourceUrl", "confidence"].includes(key))
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  };
  const model = catalogPriceDescriptor(value), metadata = object(model.metadata);
  return JSON.stringify(canonical({ pricing: model.pricing, label: typeof metadata.priceLabel === "string" ? metadata.priceLabel.replace(historicalSuffix, "") : undefined,
    billingExpression: metadata.billingExpression, priceConditions: metadata.priceConditions, billingIncludesInputDuration: metadata.billingIncludesInputDuration,
    tk1688FxRate: metadata.tk1688FxRate }));
}
/** Pure staging projection. Never changes the old snapshots, list membership,
 * model parameters, routes or unrelated metadata. Whole saved tariffs retain
 * their original conditions; a missing price is never filled from another
 * model/group or extrapolated into a new condition. */
export function mergeCatalogSnapshotPrices(before: ProviderConnectionRecord, after: ProviderConnectionRecord,
  oldSupplier: SupplierRecord | undefined, newSupplier: SupplierRecord | undefined, attemptedAt: string): {
    connection: ProviderConnectionRecord; supplier?: SupplierRecord; retainedPriceModelCount: number;
  } {
  const connection = structuredClone(after), scope = { ...groupScope(before, oldSupplier), attemptedAt,
    previousSample: typeof before.config.modelScanLastSuccessAt === "string" ? before.config.modelScanLastSuccessAt : undefined };
  // Prefer the primary advertised snapshot, then the same connection's
  // connector/template. Measured charges belong to their original cache entry
  // and request conditions, so they cannot supply another entry's tariff.
  const old = new Map<string, Row>();
  for (const value of [before.config.modelCatalogModels, object(before.config.connector).models, object(before.config.modelProtocolTemplate).models])
    for (const [id, model] of indexModels(value)) if (object(model.metadata).priceSource !== "generated-result" &&
      (!old.has(id) || !catalogHasPrice(old.get(id)) && catalogHasPrice(model))) old.set(id, model);
  // Price enrichment can populate a connector before its primary snapshot.
  // Inspect the whole current connection first, so an empty primary entry does
  // not replace a genuinely current quote with a historical one. Conflicting
  // current quotes do not authorize a guess between caches.
  const fresh = new Map<string, Row>(), conflicts = new Set<string>(), freshPriority = new Map<string, number>();
  const primary = indexModels(after.config.modelCatalogModels);
  for (const value of [after.config.modelCatalogModels, object(after.config.connector).models, object(after.config.modelProtocolTemplate).models])
    for (const [id, model] of indexModels(value)) if (object(model.metadata).priceSource !== "generated-result" &&
      catalogHasPrice(model, true) && exactPriceGroup(model, scope.groupId, scope.groupName)) {
      const saved = old.get(id), sample = sampledAt(model), oldSample = sampledAt(saved);
      // A protocol template may retain yesterday's rate unchanged; that is not
      // a second current observation. A changed quote or a newer price sample
      // can supply a missing primary entry, never a template merely existing.
      const changed = !catalogHasPrice(saved) || priceIdentity(saved) !== priceIdentity(model) ||
        sample !== undefined && (oldSample === undefined || Date.parse(sample) > Date.parse(oldSample));
      if (!changed && model !== primary.get(id)) continue;
      const priority = changed ? 1 : 0, previousPriority = freshPriority.get(id) ?? -1;
      if (priority < previousPriority) continue;
      if (priority > previousPriority) { fresh.delete(id); conflicts.delete(id); freshPriority.set(id, priority); }
      const previous = fresh.get(id);
      if (previous && priceIdentity(previous) !== priceIdentity(model)) conflicts.add(id);
      else if (!previous) fresh.set(id, model);
    }
  const visibleIds = new Set(models(connection.config.modelCatalogModels).map(model => String(model.id ?? "")));
  const retained = new Set<string>(), merged = new Map<string, Row>();
  const project = (value: unknown, previousValue: unknown): Row[] => {
    const previousEntries = indexModels(previousValue);
    return models(value).map(model => {
    const previousEntry = previousEntries.get(String(model.id ?? ""));
    // A catalog publication cannot replace an entry's observed charge with
    // its primary cache's advertised rate, nor spread a different observed
    // request/parameter scope into this entry through the shared merge map.
    if (previousEntry && object(previousEntry.metadata).priceSource === "generated-result" &&
      exactPriceGroup(previousEntry, scope.groupId, scope.groupName)) return copyPrice(previousEntry, structuredClone(model));
    if (object(model.metadata).priceSource === "generated-result") return structuredClone(model);
    const id = String(model.id ?? ""), existing = merged.get(id);
    if (existing) return copyPrice(existing, structuredClone(model));
    const current = conflicts.has(id) ? { ...copyPrice({}, model), metadata: { ...object(copyPrice({}, model).metadata),
      priceLabel: "价格存在冲突，待确认", priceStatus: "conflict", supplierPriceConflict: true } } :
      fresh.has(id) ? copyPrice(fresh.get(id)!, model) : model;
    const result = mergeModel(old.get(id), current, scope);
    if (result.retained && visibleIds.has(id)) retained.add(id);
    merged.set(id, result.model);
    return result.model;
    });
  };
  if (Array.isArray(connection.config.modelCatalogModels))
    connection.config.modelCatalogModels = project(connection.config.modelCatalogModels, before.config.modelCatalogModels) as ProviderConnectionRecord["config"][string];
  for (const key of ["connector", "modelProtocolTemplate"]) {
    const connector = object(connection.config[key]);
    if (Array.isArray(connector.models)) connection.config[key] = { ...connector,
      models: project(connector.models, object(before.config[key]).models) } as ProviderConnectionRecord["config"][string];
  }
  const supplier = newSupplier ? structuredClone(newSupplier) : undefined;
  if (supplier && oldSupplier) {
    const oldGroups = new Map(oldSupplier.catalog.groups.map(group => [catalogGroupIdentity(group), group]));
    supplier.catalog.groups = supplier.catalog.groups.map(group => {
      const previous = oldGroups.get(catalogGroupIdentity(group));
      if (!previous) return group;
      const previousModels = indexModels(previous.models);
      const nextModels = group.models.map(model => mergeModel(previousModels.get(model.id), model,
        { groupId: group.supplierGroupId, groupName: previous.id, attemptedAt,
          previousSample: oldSupplier.scanLastSuccessAt ?? (["live", "empty"].includes(oldSupplier.scanStatus) ? oldSupplier.scannedAt : undefined) }).model as unknown as typeof model);
      const details: typeof group.details = group.details ? { ...group.details } : previous.details ? { source: previous.details.source } : undefined;
      if (details && previous.details) {
        // Ledger observations survive independently of advertised group prices.
        if (previous.details.ledgerPrices) details.ledgerPrices = structuredClone(previous.details.ledgerPrices);
      }
      return { ...group, models: nextModels, ...(details ? { details } : {}) };
    });
  }
  return { connection, ...(supplier ? { supplier } : {}), retainedPriceModelCount: retained.size };
}

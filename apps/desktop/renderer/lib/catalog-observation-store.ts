import {
  assertCatalogPipelineState,
  catalogObservationIdentity,
  catalogPipelineSettingKey,
  type CatalogObservationReservation,
  type CatalogPipelineState,
  type JsonObject,
  type ProviderConnectionRecord,
  type Repository,
  type SupplierRecord,
} from "@super-canvas/db";
import { nextCatalogCheckAt } from "./supplier-catalog-upgrade";
import { CATALOG_MODE_SETTING, catalogMode } from "./supplier-catalog-policy";
import type { CatalogCheckMode } from "./supplier-catalog-contracts";

const legacyFields = ["catalogCheckAttemptedAt", "catalogCheckAttemptRevision", "catalogUpgradeAttemptedAt",
  "catalogUpgradeAttemptRevision", "catalogUpgradeRevision", "catalogCheckLastResult", "catalogCheckFailureStreak",
  "catalogCheckPaused", "catalogCheckManualRequired", "catalogCheckFailureReason", "catalogCheckRetainedPriceModelCount"] as const;

export interface LegacyCatalogObservationEntry extends JsonObject {
  migrationVersion: 1;
  connectionId: string;
  supplierSourceId: string | null;
  modeAtMigration: CatalogCheckMode;
  nextEligibleAt: string | null;
  legacy: JsonObject;
}
export const catalogLegacyConnectionEntryKey = (id: string): string => `legacy:connection:${id}`;

/** Preserve existing eligibility/markers without inventing per-source evidence. */
export function legacyCatalogObservationEntries(supplier: SupplierRecord, connections: readonly ProviderConnectionRecord[],
  mode: CatalogCheckMode, now: number): Record<string, LegacyCatalogObservationEntry> {
  const entries: Record<string, LegacyCatalogObservationEntry> = {};
  for (const connection of connections) {
    if (connection.config.supplierId !== supplier.id || connection.config.supplierArchived === true ||
      supplier.state && connection.config.supplierSourceId !== supplier.state.sourceId) continue;
    const legacy: JsonObject = {};
    for (const key of legacyFields) {
      const value = connection.config[key];
      // Only the old safe scalar metadata is migrated, never arbitrary config.
      if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))
        legacy[key] = value;
    }
    const next = nextCatalogCheckAt(connection, mode, now);
    const entry: LegacyCatalogObservationEntry = { migrationVersion: 1, connectionId: connection.id,
      supplierSourceId: typeof connection.config.supplierSourceId === "string" ? connection.config.supplierSourceId : null,
      modeAtMigration: mode, nextEligibleAt: next === null ? null : new Date(next).toISOString(), legacy,
      ...(Array.isArray(connection.config.catalogCheckHistory)
        ? { historyRef: { connectionId: connection.id, field: "catalogCheckHistory" } } : {}) };
    Object.defineProperty(entries, catalogLegacyConnectionEntryKey(connection.id), { value: entry, enumerable: true, configurable: true, writable: true });
  }
  return entries;
}

export interface CatalogObservationStoreView {
  mode: CatalogCheckMode;
  state?: CatalogPipelineState;
  /** Preview only; reading this view never writes the migration. */
  initialEntries: Record<string, LegacyCatalogObservationEntry>;
}
export async function readCatalogObservationStore(repository: Repository, supplier: SupplierRecord,
  connections: readonly ProviderConnectionRecord[], now: number): Promise<CatalogObservationStoreView> {
  const [saved, modeValue] = await Promise.all([
    repository.getApplicationSetting(catalogPipelineSettingKey(supplier.id)), repository.getApplicationSetting(CATALOG_MODE_SETTING),
  ]);
  const mode = catalogMode(modeValue);
  if (saved !== undefined) {
    assertCatalogPipelineState(saved, supplier.id);
    return { mode, state: structuredClone(saved), initialEntries: {} };
  }
  return { mode, initialEntries: legacyCatalogObservationEntries(supplier, connections, mode, now) };
}

export interface CatalogReadReservationInput {
  supplier: SupplierRecord;
  /** Include all current sibling rows for migration, not as whole-row CAS. */
  connections: readonly ProviderConnectionRecord[];
  /** Only actual targets/auth principals need connection identity guards. */
  guardedConnectionIds: readonly string[];
  sourceKey: string;
  observationCycleId: string;
  expectedMode: CatalogCheckMode;
  invalidatePrevious?: boolean;
}
/** Internal reservation bridge; no scheduler, request dispatch or implicit retry. */
export async function reserveCatalogReadObservation(repository: Repository, input: CatalogReadReservationInput,
  now: number): Promise<CatalogObservationReservation> {
  const store = await readCatalogObservationStore(repository, input.supplier, input.connections, now);
  const ids = new Set(input.guardedConnectionIds);
  const targets = input.connections.filter(connection => ids.has(connection.id));
  if (targets.length !== ids.size) throw new Error("目录观察的目标连接不存在");
  return repository.reserveCatalogObservation({ identity: catalogObservationIdentity(input.supplier, targets), sourceKey: input.sourceKey,
    observationCycleId: input.observationCycleId, expectedMode: input.expectedMode,
    initialEntries: store.initialEntries, invalidatePrevious: input.invalidatePrevious });
}

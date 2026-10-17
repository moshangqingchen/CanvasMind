import type { CatalogObservationCommit, CatalogPipelineState, JsonObject, ProviderConnectionRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { CatalogInventoryState } from "./catalog-inventory-policy";
import type { CatalogReadItemSpec } from "./catalog-read-contracts";
import type { CatalogSchedulerState } from "./catalog-read-scheduler";

export const catalogManualRefreshFenceKey = (connectionId: string): string => `manual-fence:${connectionId}`;
export interface CatalogManualRefreshFence {
  schemaVersion: 1;
  identityEpoch: string;
  dispatchedThrough: number;
  checkedAt: string;
}
export function readCatalogManualRefreshFence(pipeline: CatalogPipelineState, connectionId: string): CatalogManualRefreshFence | undefined {
  const value = pipeline.entries[catalogManualRefreshFenceKey(connectionId)];
  return value?.schemaVersion === 1 && value.identityEpoch === pipeline.identityEpoch && Number.isSafeInteger(value.dispatchedThrough) &&
    Number(value.dispatchedThrough) >= 0 && typeof value.checkedAt === "string" && Number.isFinite(Date.parse(value.checkedAt))
    ? value as unknown as CatalogManualRefreshFence : undefined;
}

/** A successful legacy/manual scan owns its display, not a fabricated new
 * per-source baseline. Only subsequent independently collected Key facts may
 * resume automatic membership publication for this target. */
export function catalogManualRefreshPatches(pipeline: CatalogPipelineState, connection: ProviderConnectionRecord,
  plan: readonly CatalogReadItemSpec[], revision: string, now: number): NonNullable<CatalogObservationCommit["state"]> {
  const checkedAt = String(connection.config.modelScanCheckedAt), stamp = Date.parse(checkedAt);
  if (!Number.isFinite(stamp)) return [];
  const patches: NonNullable<CatalogObservationCommit["state"]> = [{ key: catalogManualRefreshFenceKey(connection.id),
    expected: pipeline.entries[catalogManualRefreshFenceKey(connection.id)], value: { schemaVersion: 1, identityEpoch: pipeline.identityEpoch,
      dispatchedThrough: pipeline.nextDispatchSeq - 1, checkedAt } }];
  const inventoryKey = `membership:${connection.id}`, previous = pipeline.entries[inventoryKey] as unknown as CatalogInventoryState | undefined;
  if (previous?.schemaVersion === 1 && previous.identityEpoch === pipeline.identityEpoch) {
    const inventory = structuredClone(previous);
    inventory.visibleModels = Array.isArray(connection.config.modelCatalogModels) ? structuredClone(connection.config.modelCatalogModels) as ModelDescriptor[] : [];
    inventory.observedAt = new Date(now).toISOString();
    for (const source of Object.values(inventory.sources)) if (source.candidate) {
      delete source.candidate; source.lastOutcome = "incomplete";
    }
    patches.push({ key: inventoryKey, expected: pipeline.entries[inventoryKey], value: inventory as unknown as JsonObject });
  }
  const previousQueue = pipeline.entries["scheduler:v1"] as unknown as CatalogSchedulerState | undefined;
  if (previousQueue) {
    const scheduler = structuredClone(previousQueue);
    // A connection scan does not establish when a shared public/account source
    // was read. Its siblings retain their own due/cooldown and pending work.
    const keys = new Set(plan.filter(spec => spec.authScope.kind === "connection-key" && spec.authScope.principalRef === connection.id).map(spec => spec.sourceKey));
    for (const key of keys) {
      const source = scheduler.sources[key]; if (!source) continue;
      source.paused = false; source.failureStreak = 0; source.lastAttemptAt = stamp;
      source.nextEligibleAt = Math.max(source.nextEligibleAt, stamp + 86_400_000); source.lastAttemptRevision = revision;
    }
    for (const job of Object.values(scheduler.jobs)) if (keys.has(job.sourceKey) && ["queued", "deferred", "running"].includes(job.status)) {
      job.status = "superseded"; job.reason = "identity-changed"; delete job.lease;
    }
    patches.push({ key: "scheduler:v1", expected: pipeline.entries["scheduler:v1"], value: scheduler as unknown as JsonObject });
  }
  return patches;
}

export function catalogManualRefreshReady(fence: CatalogManualRefreshFence | undefined, inventory: CatalogInventoryState,
  requiredSourceKeys: readonly string[], manifestComplete: boolean): boolean {
  return !fence || manifestComplete && requiredSourceKeys.length > 0 && requiredSourceKeys.every(key => {
    const source = inventory.sources[key];
    return source?.lastIdentityEpoch === fence.identityEpoch && source.lastDispatchSeq > fence.dispatchedThrough &&
      Date.parse(source.lastObservedAt) >= Date.parse(fence.checkedAt) && source.lastOutcome === "accepted";
  });
}

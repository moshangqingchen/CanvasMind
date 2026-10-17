import { isDeepStrictEqual } from "node:util";
import { assertCatalogPipelineState, catalogLegacyObservationOwner, catalogPipelineSettingKey,
  type ProviderConnectionRecord, type Repository } from "@super-canvas/db";
import { catalogConnectionScopes, catalogSourcePlan } from "./catalog-source-plan";
import { assertCatalogSchedulerState, CATALOG_DAILY_INTERVAL_MS, type CatalogReadJob, type CatalogSchedulerState } from "./catalog-read-scheduler";
import type { CatalogReadItemSpec } from "./catalog-read-contracts";
import { nextCatalogCheckAt, SUPPLIER_CATALOG_REVISION, type CatalogUpgradeEligibility } from "./supplier-catalog-upgrade";
import type { CatalogCheckMode, CatalogFailureReason } from "./supplier-catalog-contracts";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const reason = (jobs: readonly CatalogReadJob[]): CatalogFailureReason | undefined => {
  const value = [...jobs].sort((a, b) => (b.completedAt ?? b.attemptConsumedAt ?? b.queuedAt) - (a.completedAt ?? a.attemptConsumedAt ?? a.queuedAt))[0]?.reason;
  if (value === "authentication" || value === "balance" || value === "unsupported" || value === "network" || value === "upstream" || value === "incomplete") return value;
  return value === "invalid-response" || value === "budget" ? "incomplete" : undefined;
};

/** Read-only protection for the emergency monolithic checker. It cannot skip
 * individual sources, so it waits if any source it might repeat is not due.
 * Manual supplier refresh does not use this automatic eligibility hook.
 */
export function createCatalogLegacyEligibility(repository: Repository, revision = SUPPLIER_CATALOG_REVISION) {
  return async (connection: ProviderConnectionRecord, mode: CatalogCheckMode, now: number): Promise<CatalogUpgradeEligibility | undefined> => {
    const supplierId = connection.config.supplierId;
    const supplier = typeof supplierId === "string" ? await repository.getSupplier(supplierId) : null;
    if (typeof supplierId === "string" && !supplier) return { nextCheckAt: null, manualRequired: true };
    const owner = supplier ?? catalogLegacyObservationOwner(connection);
    const saved = await repository.getApplicationSetting(catalogPipelineSettingKey(owner.id));
    if (saved === undefined) return undefined; // Exact old behavior for old profiles.
    assertCatalogPipelineState(saved, owner.id);
    const raw = saved.entries["scheduler:v1"];
    if (raw === undefined) return undefined; // A reservation alone did not dispatch.
    assertCatalogSchedulerState(raw);
    const scheduler = raw as unknown as CatalogSchedulerState;
    const scopes = catalogConnectionScopes(connection, supplier ?? undefined);
    const specs = new Map(catalogSourcePlan(connection, supplier ?? undefined).map(spec => [spec.sourceKey, spec]));
    const applicable = (spec: CatalogReadItemSpec): boolean => {
      const auth = spec.authScope.kind === "anonymous" ? scopes.anonymous : spec.authScope.kind === "site-account" ? scopes.account : scopes.key;
      return spec.applyScope.supplierId === scopes.apply.supplierId && spec.applyScope.supplierSourceId === scopes.apply.supplierSourceId &&
        isDeepStrictEqual(spec.authScope, auth) && (spec.authScope.kind !== "connection-key" || spec.authScope.principalRef === connection.id) &&
        // Public whole-site reads can be shared across groups. Conservatively
        // protect them in rollback rather than repeating another group's read.
        (spec.applyScope.groupIdentity === scopes.apply.groupIdentity || spec.authScope.kind !== "connection-key");
    };
    for (const job of Object.values(scheduler.jobs)) if (applicable(job.spec)) specs.set(job.sourceKey, job.spec);
    // Compaction may remove a completed job while its durable fact survives.
    for (const [key, value] of Object.entries(saved.entries)) if (key.startsWith("fact:") || key.startsWith("task:")) {
      const spec = (key.startsWith("fact:") ? object(object(value).receipt).spec : object(value).spec) as CatalogReadItemSpec | undefined;
      if (spec && applicable(spec)) specs.set(spec.sourceKey, spec);
    }
    const sourceKeys = new Set(specs.keys());
    const sources = Object.entries(scheduler.sources).filter(([key]) => sourceKeys.has(key)).map(([, value]) => value);
    const jobs = Object.values(scheduler.jobs).filter(job => sourceKeys.has(job.sourceKey) && applicable(job.spec));
    const consumedJobs = jobs.filter(job => finite(job.attemptConsumedAt));
    const attempted = sources.filter(source => finite(source.lastAttemptAt));
    const latest = Math.max(-Infinity, ...attempted.map(source => source.lastAttemptAt!), ...consumedJobs.map(job => job.attemptConsumedAt!));
    const paused = sources.some(source => source.paused);
    const blockedRevision = sources.some(source => source.lastAttemptRevision === revision) || consumedJobs.some(job => job.revision === revision);
    const failJobs = jobs.filter(job => ["failed", "unknown"].includes(job.status));
    const lastAttemptAt = Number.isFinite(latest) ? new Date(latest).toISOString() : undefined;
    const base = nextCatalogCheckAt(connection, mode, now);
    if (mode === "off") return { nextCheckAt: null, paused, manualRequired: paused || failJobs.length > 0 || base === null,
      ...(lastAttemptAt ? { lastAttemptAt } : {}), ...(reason(failJobs) ? { pauseReason: reason(failJobs) } : {}) };
    if (paused || mode === "upgrade" && blockedRevision) return { nextCheckAt: null, paused, manualRequired: paused || failJobs.length > 0,
      ...(lastAttemptAt ? { lastAttemptAt } : {}), ...(reason(failJobs) ? { pauseReason: reason(failJobs) } : {}) };
    // A new successful explicit refresh may have cleared a source pause while
    // old connection flags remain. Source state owns its newer eligibility.
    const hasNewAttempt = Number.isFinite(latest);
    const legacyAt = Date.parse(String(connection.config.catalogCheckAttemptedAt ?? connection.config.catalogUpgradeAttemptedAt ?? ""));
    const newerThanLegacy = hasNewAttempt && (!Number.isFinite(legacyAt) || latest > legacyAt);
    if (base === null && (mode === "upgrade" || !newerThanLegacy)) return { nextCheckAt: null, paused: connection.config.catalogCheckPaused === true,
      manualRequired: connection.config.catalogCheckManualRequired === true };
    const hostTimes = [...specs.values()].map(spec => {
      const host = scheduler.hosts[new URL(spec.sourceUrl).host];
      return host ? Math.max(host.cooldownUntil, host.nextStartAt) : now;
    });
    const delayed = jobs.filter(job => ["queued", "deferred", "running"].includes(job.status)).map(job =>
      Math.max(job.nextAttemptEligibleAt, job.lease?.expiresAt ?? 0));
    const next = Math.max(now, base ?? now, ...(mode === "daily" ? [hasNewAttempt ? latest + CATALOG_DAILY_INTERVAL_MS : now,
      ...sources.filter(source => finite(source.lastAttemptAt)).map(source => source.nextEligibleAt)] : []), ...hostTimes, ...delayed);
    return { nextCheckAt: next, paused: false, manualRequired: failJobs.length > 0 || !hasNewAttempt && connection.config.catalogCheckManualRequired === true,
      ...(lastAttemptAt ? { lastAttemptAt } : {}), ...(reason(failJobs) ? { pauseReason: reason(failJobs) } : {}) };
  };
}

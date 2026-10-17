import { createHash } from "node:crypto";
import type { CatalogReadItemSpec } from "./catalog-read-contracts";

export const CATALOG_SCHEDULER_VERSION = 1;
export const CATALOG_DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CATALOG_STARTUP_DELAY_MS = 60_000;
export const CATALOG_JOB_LEASE_MS = 2 * 60 * 1000;
export const CATALOG_SCHEDULER_SOFT_BYTES = 8 * 1024 * 1024;
export const CATALOG_SCHEDULER_MAX_BYTES = 32 * 1024 * 1024;
export const CATALOG_SCHEDULER_MAX_JOBS = 4096;
export const CATALOG_HOST_BACKOFF_MS = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, CATALOG_DAILY_INTERVAL_MS] as const;

export type CatalogScheduledMode = "daily" | "upgrade" | "manual";
export type CatalogJobStatus = "queued" | "running" | "deferred" | "completed" | "failed" | "unknown" | "superseded";
export type CatalogSchedulerReason = "network" | "authentication" | "balance" | "unsupported" | "incomplete" | "invalid-response" |
  "cancelled" | "mode-off" | "draining" | "identity-changed" | "host-cooldown" | "budget" | "lease-expired" | "upstream" | "attempt-consumed";

/** References only. Credentials, HTTP bodies and descriptors do not belong in a job. */
export interface CatalogReadJob {
  id: string;
  sourceKey: string;
  supplierId: string;
  identityEpoch: string;
  observationCycleId: string;
  mode: CatalogScheduledMode;
  revision: string;
  spec: CatalogReadItemSpec;
  status: CatalogJobStatus;
  queuedAt: number;
  order: number;
  nextAttemptEligibleAt: number;
  attemptConsumedAt?: number;
  lease?: { owner: string; expiresAt: number };
  completedAt?: number;
  /** A durable normalized observation or publication, never merely a completed flag. */
  resultRef?: string;
  reason?: CatalogSchedulerReason;
  /** One-way method/URL identities prevent a failed page being replayed in this cycle. */
  dispatchedRequestKeys?: string[];
}
export interface CatalogSourceCycleState {
  identityEpoch: string;
  lastAttemptAt?: number;
  lastAttemptCycleId?: string;
  lastAttemptRevision?: string;
  nextEligibleAt: number;
  failureStreak: number;
  paused: boolean;
}
export interface CatalogHostCooldown {
  nextStartAt: number;
  cooldownUntil: number;
  failures: number;
}
export interface CatalogSchedulerState {
  schemaVersion: 1;
  jobs: Record<string, CatalogReadJob>;
  sources: Record<string, CatalogSourceCycleState>;
  hosts: Record<string, CatalogHostCooldown>;
  nextOrder: number;
}
export const emptyCatalogSchedulerState = (): CatalogSchedulerState => ({ schemaVersion: 1, jobs: {}, sources: {}, hosts: {}, nextOrder: 1 });
const clone = <T>(value: T): T => structuredClone(value);
const active = (job: CatalogReadJob) => job.status === "queued" || job.status === "deferred" || job.status === "running";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const catalogScheduledJobId = (sourceKey: string, identityEpoch: string, cycleId: string, mode: CatalogScheduledMode): string =>
  hash([sourceKey, identityEpoch, cycleId, mode]);

export function assertCatalogSchedulerState(value: unknown): asserts value is CatalogSchedulerState {
  const state = value as CatalogSchedulerState | undefined;
  if (!state || state.schemaVersion !== 1 || !state.jobs || !state.sources || !state.hosts || Array.isArray(state.jobs) ||
    Array.isArray(state.sources) || Array.isArray(state.hosts) || !Number.isSafeInteger(state.nextOrder) || state.nextOrder < 1)
    throw new Error("目录调度状态无效，未派发请求");
  if (Object.keys(state.jobs).length > CATALOG_SCHEDULER_MAX_JOBS || Buffer.byteLength(JSON.stringify(state), "utf8") > CATALOG_SCHEDULER_MAX_BYTES)
    throw new Error("目录调度状态超过保护上限，未丢弃待办或可信历史");
  for (const [id, job] of Object.entries(state.jobs)) {
    if (job.id !== id || !job.sourceKey || !job.identityEpoch || !job.observationCycleId || !job.supplierId ||
      !["queued", "running", "deferred", "completed", "failed", "unknown", "superseded"].includes(job.status) ||
      !Number.isFinite(job.queuedAt) || !Number.isFinite(job.nextAttemptEligibleAt) || !Number.isSafeInteger(job.order) ||
      job.status === "completed" && !job.resultRef || job.status === "running" && !job.lease)
      throw new Error("目录调度任务无效，未派发请求");
  }
}

export interface CatalogEnqueueOptions {
  now: number;
  mode: CatalogScheduledMode | "off";
  identityEpoch: string;
  observationCycleId: string;
  revision: string;
  /** A stable backend session start, not a page mount time. */
  sessionStartedAt: number;
  /** Migrated legacy due/paused state is inherited only for new sources. */
  initialEligibility?: Record<string, CatalogInitialSourceEligibility>;
}
export interface CatalogInitialSourceEligibility {
  nextEligibleAt: number;
  paused?: boolean;
  lastAttemptRevision?: string;
  lastAttemptAt?: number;
  failureStreak?: number;
}
export function enqueueCatalogReadJobs(current: CatalogSchedulerState, specs: readonly CatalogReadItemSpec[], options: CatalogEnqueueOptions):
  { state: CatalogSchedulerState; jobIds: string[]; deferred: number } {
  if (options.mode === "off") return { state: clone(current), jobIds: [], deferred: 0 };
  const scheduledMode = options.mode;
  const pendingBySource = new Map(Object.values(current.jobs).filter(job => job.identityEpoch === options.identityEpoch && active(job) &&
    (scheduledMode !== "manual" || job.mode === "manual")).map(job => [job.sourceKey, job]));
  const incoming = [...new Map(specs.map(spec => [spec.sourceKey, spec])).values()].filter(spec => {
    const source = current.sources[spec.sourceKey], manual = scheduledMode === "manual";
    if (pendingBySource.has(spec.sourceKey)) return false;
    if (current.jobs[catalogScheduledJobId(spec.sourceKey, options.identityEpoch, options.observationCycleId, scheduledMode)]) return false;
    const due = source?.nextEligibleAt ?? options.initialEligibility?.[spec.sourceKey]?.nextEligibleAt ?? 0;
    const paused = source?.paused ?? options.initialEligibility?.[spec.sourceKey]?.paused ?? false;
    const lastRevision = source?.lastAttemptRevision ?? options.initialEligibility?.[spec.sourceKey]?.lastAttemptRevision;
    return manual || !paused && options.now >= due && !(options.mode === "upgrade" && lastRevision === options.revision);
  }).length;
  const state = Buffer.byteLength(JSON.stringify(current), "utf8") >= CATALOG_SCHEDULER_SOFT_BYTES || Object.keys(current.jobs).length + incoming > CATALOG_SCHEDULER_MAX_JOBS
    ? compactCatalogSchedulerState(current, { reserveJobs: Math.min(incoming, CATALOG_SCHEDULER_MAX_JOBS), targetBytes: CATALOG_SCHEDULER_SOFT_BYTES }) : clone(current);
  const jobIds: string[] = [];
  let deferred = 0;
  for (const spec of specs) {
    const sourceKey = spec.sourceKey;
    const initial = options.initialEligibility?.[sourceKey];
    const previous = state.sources[sourceKey];
    if (previous && previous.identityEpoch !== options.identityEpoch)
      for (const job of Object.values(state.jobs)) if (job.sourceKey === sourceKey && active(job)) {
        job.status = "superseded"; job.reason = "identity-changed"; delete job.lease;
      }
    // A namespace epoch is a publication fence, not a new read identity. A
    // sibling's manual refresh may rotate it without changing this sourceKey.
    // Preserve this source's consumed qualification, pause and terminal streak.
    const source = previous ? { ...previous, identityEpoch: options.identityEpoch } : {
      identityEpoch: options.identityEpoch, nextEligibleAt: initial?.nextEligibleAt ?? 0, failureStreak: initial?.failureStreak ?? 0, paused: initial?.paused ?? false,
      ...(initial?.lastAttemptRevision !== undefined ? { lastAttemptRevision: initial.lastAttemptRevision } : {}),
      ...(initial?.lastAttemptAt !== undefined ? { lastAttemptAt: initial.lastAttemptAt } : {}),
    };
    state.sources[sourceKey] = source;
    // Pending work crosses midnight/restarts unchanged; do not create a second cycle beside it.
    const pending = pendingBySource.get(sourceKey);
    if (pending) { jobIds.push(pending.id); continue; }
    const manual = options.mode === "manual";
    if (!manual && (source.paused || options.now < source.nextEligibleAt ||
      options.mode === "upgrade" && source.lastAttemptRevision === options.revision)) { deferred++; continue; }
    const id = catalogScheduledJobId(sourceKey, options.identityEpoch, options.observationCycleId, options.mode);
    if (state.jobs[id]) { jobIds.push(id); continue; }
    if (Object.keys(state.jobs).length >= CATALOG_SCHEDULER_MAX_JOBS) { deferred++; continue; }
    const job: CatalogReadJob = { id, sourceKey, supplierId: spec.applyScope.supplierId, identityEpoch: options.identityEpoch,
      observationCycleId: options.observationCycleId, mode: options.mode, revision: options.revision, spec: clone(spec),
      status: "queued", queuedAt: options.now, order: state.nextOrder++, nextAttemptEligibleAt: manual ? options.now :
        Math.max(options.now, source.nextEligibleAt, options.sessionStartedAt + CATALOG_STARTUP_DELAY_MS) };
    state.jobs[id] = job;
    if (Buffer.byteLength(JSON.stringify(state), "utf8") > CATALOG_SCHEDULER_MAX_BYTES) { delete state.jobs[id]; deferred++; continue; }
    jobIds.push(id);
    pendingBySource.set(sourceKey, job);
  }
  assertCatalogSchedulerState(state);
  return { state, jobIds, deferred };
}

export interface CatalogDispatchGuards { now: number; owner: string; mode: "daily" | "upgrade" | "off"; draining: boolean; identityEpoch: string }
export function claimCatalogReadJob(current: CatalogSchedulerState, jobId: string, guard: CatalogDispatchGuards):
  { state: CatalogSchedulerState; claimed: boolean } {
  const state = clone(current), job = state.jobs[jobId];
  if (!job || !active(job)) return { state, claimed: false };
  if (guard.draining || job.mode !== "manual" && guard.mode === "off" || job.identityEpoch !== guard.identityEpoch) {
    job.status = job.attemptConsumedAt === undefined ? "deferred" : "unknown";
    job.reason = guard.draining ? "draining" : job.identityEpoch !== guard.identityEpoch ? "identity-changed" : "mode-off";
    if (job.reason === "identity-changed") job.status = "superseded";
    delete job.lease;
    return { state, claimed: false };
  }
  if (job.lease && job.lease.owner !== guard.owner && job.lease.expiresAt > guard.now || guard.now < job.nextAttemptEligibleAt)
    return { state, claimed: false };
  if (job.attemptConsumedAt !== undefined) {
    // Only the same live owner may continue the first logical collection's later pages/endpoints.
    if (job.status !== "running" || !job.lease || job.lease.owner !== guard.owner || job.lease.expiresAt <= guard.now)
      return { state, claimed: false };
    job.lease.expiresAt = guard.now + CATALOG_JOB_LEASE_MS;
    return { state, claimed: true };
  }
  const source = state.sources[job.sourceKey];
  if (!source || source.identityEpoch !== job.identityEpoch || job.mode !== "manual" && (source.paused || guard.now < source.nextEligibleAt))
    return { state, claimed: false };
  job.status = "running"; job.attemptConsumedAt = guard.now; job.lease = { owner: guard.owner, expiresAt: guard.now + CATALOG_JOB_LEASE_MS };
  delete job.reason;
  if (job.mode !== "manual") {
    source.lastAttemptAt = guard.now; source.lastAttemptCycleId = job.observationCycleId; source.lastAttemptRevision = job.revision;
    source.nextEligibleAt = guard.now + CATALOG_DAILY_INTERVAL_MS;
  }
  return { state, claimed: true };
}

export function finishCatalogReadJob(current: CatalogSchedulerState, jobId: string, owner: string, now: number,
  outcome: { status: "completed"; resultRef: string } | { status: "failed" | "unknown" | "superseded"; reason: CatalogSchedulerReason; resultRef?: string }): CatalogSchedulerState {
  const state = clone(current), job = state.jobs[jobId];
  if (!job || job.status !== "running" || job.lease?.owner !== owner || job.lease.expiresAt <= now)
    throw new Error("目录任务租约已失效，旧结果不能发布");
  if (outcome.status === "completed" && !outcome.resultRef) throw new Error("目录任务完成必须同时保存规范化事实引用");
  job.status = outcome.status; job.completedAt = now; delete job.lease;
  if (outcome.resultRef) job.resultRef = outcome.resultRef;
  if ("reason" in outcome) job.reason = outcome.reason; else delete job.reason;
  const source = state.sources[job.sourceKey];
  if (source?.identityEpoch === job.identityEpoch) {
    if (outcome.status === "completed") { source.failureStreak = 0; if (job.mode === "manual") source.paused = false; }
    else if (outcome.status === "failed" && ["authentication", "balance", "unsupported"].includes(outcome.reason)) {
      source.failureStreak++; source.paused = source.failureStreak >= 3;
    } else if (outcome.status === "failed" || outcome.status === "unknown") source.failureStreak = 0;
  }
  return state;
}

export function recoverCatalogReadJobs(current: CatalogSchedulerState, now: number): CatalogSchedulerState {
  const state = clone(current);
  for (const job of Object.values(state.jobs)) if (job.status === "running" && (!job.lease || job.lease.expiresAt <= now)) {
    job.status = job.attemptConsumedAt === undefined ? "queued" : "unknown";
    job.reason = "lease-expired"; delete job.lease;
  }
  return state;
}

export function parseCatalogRetryAfter(value: string | null | undefined, now: number): number | undefined {
  if (!value?.trim()) return undefined;
  const raw = value.trim();
  if (/^\d+(?:\.\d+)?$/u.test(raw)) { const result = now + Number(raw) * 1000; return Number.isFinite(result) ? result : undefined; }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.max(now, parsed) : undefined;
}
export function catalogHostStartInterval(random: number): number { return 1500 + Math.min(1, Math.max(0, random)) * 1000; }
export function recordCatalogHostStart(current: CatalogSchedulerState, host: string, now: number, random: number): CatalogSchedulerState {
  const state = clone(current), previous = state.hosts[host];
  state.hosts[host] = { nextStartAt: now + catalogHostStartInterval(random), cooldownUntil: previous?.cooldownUntil ?? 0, failures: previous?.failures ?? 0 };
  return state;
}
export function recordCatalogHostResponse(current: CatalogSchedulerState, host: string, now: number, status: number,
  retryAfter?: string | null): CatalogSchedulerState {
  const state = clone(current), previous = state.hosts[host] ?? { nextStartAt: 0, cooldownUntil: 0, failures: 0 };
  const retryAt = parseCatalogRetryAfter(retryAfter, now);
  if (status === 429 || status === 503 && retryAt !== undefined) {
    const failures = previous.failures + 1, local = CATALOG_HOST_BACKOFF_MS[Math.min(failures - 1, CATALOG_HOST_BACKOFF_MS.length - 1)]!;
    state.hosts[host] = { ...previous, failures, cooldownUntil: Math.max(previous.cooldownUntil, now + local, retryAt ?? 0) };
    for (const job of Object.values(state.jobs)) if (active(job) && job.attemptConsumedAt === undefined && new URL(job.spec.sourceUrl).host === host) {
      job.status = "deferred"; job.reason = "host-cooldown"; job.nextAttemptEligibleAt = Math.max(job.nextAttemptEligibleAt, state.hosts[host]!.cooldownUntil);
    }
  } else if (status >= 200 && status < 400) state.hosts[host] = { ...previous, failures: 0 };
  return state;
}

/** Only disposable old terminal indices are pruned. Facts, baselines and descriptor history live outside this state. */
export function compactCatalogSchedulerState(current: CatalogSchedulerState,
  pressure?: { reserveJobs: number; targetBytes?: number }): CatalogSchedulerState {
  const state = clone(current), bySource = new Map<string, CatalogReadJob[]>();
  for (const job of Object.values(state.jobs)) if (!active(job)) bySource.set(job.sourceKey, [...(bySource.get(job.sourceKey) ?? []), job]);
  const disposable = (job: CatalogReadJob) => !active(job) && Boolean(job.resultRef);
  for (const jobs of bySource.values()) for (const job of jobs.sort((a, b) => b.order - a.order).slice(2))
    if (disposable(job)) delete state.jobs[job.id];
  if (pressure) {
    // Ordinarily keep current/previous terminal indices per source. Under a hard
    // queue/soft byte budget those are also disposable if their normalized result
    // is durable elsewhere. Qualification and confirmation data remain in sources
    // and the publisher's entries, never in this bounded execution index.
    const published = Object.values(state.jobs).filter(disposable).sort((a, b) => a.order - b.order);
    let count = Object.keys(state.jobs).length, size = Buffer.byteLength(JSON.stringify(state), "utf8");
    for (const job of published) {
      if (count + pressure.reserveJobs <= CATALOG_SCHEDULER_MAX_JOBS && size < (pressure.targetBytes ?? CATALOG_SCHEDULER_SOFT_BYTES)) break;
      delete state.jobs[job.id]; count--;
      size -= Buffer.byteLength(JSON.stringify(job), "utf8") + Buffer.byteLength(JSON.stringify(job.id), "utf8") + 2;
    }
  }
  return state;
}

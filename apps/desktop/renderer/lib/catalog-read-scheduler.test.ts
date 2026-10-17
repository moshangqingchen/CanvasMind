import { describe, expect, it } from "vitest";
import type { CatalogReadItemSpec } from "./catalog-read-contracts";
import {
  CATALOG_DAILY_INTERVAL_MS, CATALOG_JOB_LEASE_MS, CATALOG_SCHEDULER_MAX_JOBS, CATALOG_STARTUP_DELAY_MS, assertCatalogSchedulerState,
  catalogHostStartInterval, claimCatalogReadJob, compactCatalogSchedulerState, emptyCatalogSchedulerState,
  enqueueCatalogReadJobs, finishCatalogReadJob, parseCatalogRetryAfter, recordCatalogHostResponse, recoverCatalogReadJobs,
  type CatalogSchedulerState,
} from "./catalog-read-scheduler";

const day = CATALOG_DAILY_INTERVAL_MS;
const spec = (key = "models", host = "fixture.invalid"): CatalogReadItemSpec => ({ sourceKey: key, entryId: key,
  sourceUrl: `https://${host}/models`, parserVersion: "fixture-v1", authScope: { kind: "connection-key", principalRef: "fixture-key", credentialEpoch: "fixture-credential" },
  applyScope: { supplierId: "fixture-supplier", supplierSourceId: "fixture-source", connectionIds: ["fixture-connection"] }, role: "key-membership", requiredForMembership: true });
const options = { now: 100_000, mode: "daily" as const, identityEpoch: "identity-1", observationCycleId: "cycle-1", revision: "revision-1", sessionStartedAt: 0 };
function queued() { return enqueueCatalogReadJobs(emptyCatalogSchedulerState(), [spec()], options); }
function claimed() { const { state, jobIds } = queued(); return { id: jobIds[0]!, ...claimCatalogReadJob(state, jobIds[0]!,
  { now: options.now, owner: "owner-1", mode: "daily", draining: false, identityEpoch: options.identityEpoch }) }; }

describe("catalog scheduler durable eligibility", () => {
  it("off enqueues nothing and preserves migrated source state", () => {
    const initial = emptyCatalogSchedulerState();
    expect(enqueueCatalogReadJobs(initial, [spec()], { ...options, mode: "off" })).toEqual({ state: initial, jobIds: [], deferred: 0 });
  });
  it("waits sixty seconds from backend startup, independent of page mounts", () => {
    const result = enqueueCatalogReadJobs(emptyCatalogSchedulerState(), [spec()], { ...options, now: 100, sessionStartedAt: 100 });
    expect(result.state.jobs[result.jobIds[0]!]!.nextAttemptEligibleAt).toBe(100 + CATALOG_STARTUP_DELAY_MS);
    expect(claimCatalogReadJob(result.state, result.jobIds[0]!, { now: 100, owner: "o", mode: "daily", draining: false, identityEpoch: "identity-1" }).claimed).toBe(false);
  });
  it("inherits due and pause without creating source baselines", () => {
    const result = enqueueCatalogReadJobs(emptyCatalogSchedulerState(), [spec()], { ...options,
      initialEligibility: { models: { nextEligibleAt: 200_000, paused: true } } });
    expect(result.jobIds).toEqual([]);
    expect(result.state.sources.models).toMatchObject({ nextEligibleAt: 200_000, paused: true, failureStreak: 0 });
    expect(JSON.stringify(result.state)).not.toContain("baseline");
  });
  it("migrates an already-attempted upgrade revision and failure streak without an extra attempt", () => {
    const result = enqueueCatalogReadJobs(emptyCatalogSchedulerState(), [spec()], { ...options, mode: "upgrade",
      initialEligibility: { models: { nextEligibleAt: 0, paused: false, lastAttemptRevision: "revision-1", lastAttemptAt: 50_000, failureStreak: 2 } } });
    expect(result.jobIds).toEqual([]);
    expect(result.state.sources.models).toEqual({ identityEpoch: "identity-1", nextEligibleAt: 0, paused: false,
      lastAttemptRevision: "revision-1", lastAttemptAt: 50_000, failureStreak: 2 });
    expect(result.state.sources.models!.lastAttemptCycleId).toBeUndefined();
    const repeated = enqueueCatalogReadJobs(result.state, [spec()], { ...options, mode: "upgrade", now: options.now + day,
      initialEligibility: { models: { nextEligibleAt: 0, failureStreak: 0, lastAttemptRevision: "older-revision", lastAttemptAt: 0 } } });
    expect(repeated.jobIds).toEqual([]); expect(repeated.state.sources.models).toEqual(result.state.sources.models);
    expect(enqueueCatalogReadJobs(result.state, [spec()], { ...options, mode: "upgrade", revision: "revision-2" }).jobIds).toHaveLength(1);
  });
  it("continues a migrated terminal-failure streak and lets explicit manual success clear it", () => {
    const migrated = enqueueCatalogReadJobs(emptyCatalogSchedulerState(), [spec()], { ...options,
      initialEligibility: { models: { nextEligibleAt: 0, lastAttemptAt: 1, lastAttemptRevision: "old", failureStreak: 2 } } });
    const claim = claimCatalogReadJob(migrated.state, migrated.jobIds[0]!, { now: options.now, owner: "o", mode: "daily", draining: false, identityEpoch: "identity-1" });
    const failed = finishCatalogReadJob(claim.state, migrated.jobIds[0]!, "o", options.now + 1, { status: "failed", reason: "authentication" });
    expect(failed.sources.models).toMatchObject({ failureStreak: 3, paused: true });
    const manual = enqueueCatalogReadJobs(failed, [spec()], { ...options, mode: "manual", observationCycleId: "explicit-user-request" });
    const explicit = claimCatalogReadJob(manual.state, manual.jobIds[0]!, { now: options.now + 2, owner: "manual", mode: "daily", draining: false, identityEpoch: "identity-1" });
    const success = finishCatalogReadJob(explicit.state, manual.jobIds[0]!, "manual", options.now + 3, { status: "completed", resultRef: "fact:explicit" });
    expect(success.sources.models).toMatchObject({ failureStreak: 0, paused: false });
  });
  it("duplicates and restarts do not create a second pending cycle", () => {
    const first = queued();
    const next = enqueueCatalogReadJobs(first.state, [spec()], { ...options, now: options.now + day * 2, observationCycleId: "new-run" });
    expect(next.jobIds).toEqual(first.jobIds);
    expect(Object.keys(next.state.jobs)).toHaveLength(1);
    expect(next.state.jobs[first.jobIds[0]!]!.observationCycleId).toBe("cycle-1");
  });
  it("daily failure consumes exactly one qualification until twenty four hours pass", () => {
    const first = claimed();
    const failed = finishCatalogReadJob(first.state, first.id, "owner-1", options.now + 1, { status: "failed", reason: "network" });
    expect(enqueueCatalogReadJobs(failed, [spec()], { ...options, now: options.now + day - 1, observationCycleId: "new-cycle" }).jobIds).toEqual([]);
    expect(enqueueCatalogReadJobs(failed, [spec()], { ...options, now: options.now + day, observationCycleId: "new-cycle" }).jobIds).toHaveLength(1);
  });
  it("unknown crash outcome consumes the cycle and cannot be resent on lease expiry", () => {
    const first = claimed();
    const recovered = recoverCatalogReadJobs(first.state, options.now + CATALOG_JOB_LEASE_MS);
    expect(recovered.jobs[first.id]).toMatchObject({ status: "unknown", reason: "lease-expired", attemptConsumedAt: options.now });
    expect(claimCatalogReadJob(recovered, first.id, { now: options.now + CATALOG_JOB_LEASE_MS, owner: "new-owner", mode: "daily", draining: false, identityEpoch: "identity-1" }).claimed).toBe(false);
    expect(enqueueCatalogReadJobs(recovered, [spec()], { ...options, now: options.now + CATALOG_JOB_LEASE_MS, observationCycleId: "new-cycle" }).jobIds).toEqual([]);
  });
  it("an already durable complete result is not reread", () => {
    const first = claimed();
    const done = finishCatalogReadJob(first.state, first.id, "owner-1", options.now + 1, { status: "completed", resultRef: "facts:source-cycle" });
    expect(recoverCatalogReadJobs(done, options.now + day).jobs[first.id]).toEqual(done.jobs[first.id]);
    expect(claimCatalogReadJob(done, first.id, { now: options.now + day, owner: "owner-2", mode: "daily", draining: false, identityEpoch: "identity-1" }).claimed).toBe(false);
  });
  it("upgrade failures end this revision instead of retrying daily", () => {
    const queued = enqueueCatalogReadJobs(emptyCatalogSchedulerState(), [spec()], { ...options, mode: "upgrade" });
    const first = claimCatalogReadJob(queued.state, queued.jobIds[0]!, { now: options.now, owner: "o", mode: "upgrade", draining: false, identityEpoch: "identity-1" });
    const failed = finishCatalogReadJob(first.state, queued.jobIds[0]!, "o", options.now + 1, { status: "failed", reason: "network" });
    expect(enqueueCatalogReadJobs(failed, [spec()], { ...options, mode: "upgrade", now: options.now + day * 3, observationCycleId: "new-cycle" }).jobIds).toEqual([]);
    expect(enqueueCatalogReadJobs(failed, [spec()], { ...options, mode: "upgrade", revision: "revision-2", now: options.now + day * 3, observationCycleId: "new-cycle" }).jobIds).toHaveLength(1);
  });
  it("manual requests bypass daily eligibility and paused state", () => {
    const first = claimed(); first.state.sources.models!.paused = true;
    const manual = enqueueCatalogReadJobs(first.state, [spec()], { ...options, mode: "manual", observationCycleId: "explicit-user-request" });
    const claim = claimCatalogReadJob(manual.state, manual.jobIds[0]!, { now: options.now, owner: "manual-owner", mode: "off", draining: false, identityEpoch: "identity-1" });
    expect(claim.claimed).toBe(true);
    const done = finishCatalogReadJob(claim.state, manual.jobIds[0]!, "manual-owner", options.now + 1, { status: "completed", resultRef: "facts:manual" });
    expect(done.sources.models!.paused).toBe(false);
    expect(done.sources.models!.nextEligibleAt).toBe(first.state.sources.models!.nextEligibleAt);
  });
  it.each(["authentication", "balance", "unsupported"] as const)("three consecutive %s failures pause only that source", reason => {
    let state = emptyCatalogSchedulerState();
    for (let index = 0; index < 3; index++) {
      const now = options.now + index * day;
      const queued = enqueueCatalogReadJobs(state, [spec()], { ...options, now, observationCycleId: `cycle-${index}` });
      const claim = claimCatalogReadJob(queued.state, queued.jobIds[0]!, { now, owner: "o", mode: "daily", draining: false, identityEpoch: "identity-1" });
      state = finishCatalogReadJob(claim.state, queued.jobIds[0]!, "o", now + 1, { status: "failed", reason });
    }
    expect(state.sources.models).toMatchObject({ paused: true, failureStreak: 3 });
    expect(enqueueCatalogReadJobs(state, [spec("another-key")], { ...options, now: options.now + day * 3, observationCycleId: "cycle-4" }).jobIds).toHaveLength(1);
  });
  it("temporary errors interrupt terminal-failure streak", () => {
    const first = claimed(); first.state.sources.models!.failureStreak = 2;
    expect(finishCatalogReadJob(first.state, first.id, "owner-1", options.now + 1, { status: "failed", reason: "network" }).sources.models!.failureStreak).toBe(0);
  });
  it.each([{ mode: "off" as const, draining: false }, { mode: "daily" as const, draining: true }])("blocks dispatch before network with %j", change => {
    const first = queued();
    expect(claimCatalogReadJob(first.state, first.jobIds[0]!, { now: options.now, owner: "o", identityEpoch: "identity-1", ...change }).claimed).toBe(false);
    expect(first.state.jobs[first.jobIds[0]!]!.attemptConsumedAt).toBeUndefined();
  });
  it("old owners cannot continue or commit after lease expiry", () => {
    const first = claimed(), now = options.now + CATALOG_JOB_LEASE_MS;
    expect(claimCatalogReadJob(first.state, first.id, { now, owner: "owner-1", mode: "daily", draining: false, identityEpoch: "identity-1" }).claimed).toBe(false);
    expect(() => finishCatalogReadJob(first.state, first.id, "owner-1", now, { status: "completed", resultRef: "facts:old" })).toThrow("租约");
  });
  it("same owner may fetch another page within the first logical attempt without another eligibility", () => {
    const first = claimed();
    const second = claimCatalogReadJob(first.state, first.id, { now: options.now + 100, owner: "owner-1", mode: "daily", draining: false, identityEpoch: "identity-1" });
    expect(second.claimed).toBe(true);
    expect(second.state.sources.models!.lastAttemptAt).toBe(options.now);
  });
  it("changed source identity supersedes pending jobs", () => {
    const first = queued();
    const next = enqueueCatalogReadJobs(first.state, [spec()], { ...options, identityEpoch: "identity-2" });
    expect(next.state.jobs[first.jobIds[0]!]!.status).toBe("superseded");
    expect(next.jobIds).not.toEqual(first.jobIds);
  });
  it("a sibling namespace epoch change cannot consume another same-source daily attempt", () => {
    const first = claimed();
    const saved = finishCatalogReadJob(first.state, first.id, "owner-1", options.now + 1, { status: "completed", resultRef: "fact:daily" });
    saved.sources.models!.failureStreak = 2;
    const before = structuredClone(saved.sources.models);
    const next = enqueueCatalogReadJobs(saved, [spec()], { ...options, now: options.now + 2, identityEpoch: "sibling-manual-epoch", observationCycleId: "new-run" });
    expect(next.jobIds).toEqual([]);
    expect(next.state.sources.models).toEqual({ ...before, identityEpoch: "sibling-manual-epoch" });
    const due = enqueueCatalogReadJobs(next.state, [spec()], { ...options, now: options.now + day, identityEpoch: "sibling-manual-epoch", observationCycleId: "next-daily-cycle" });
    expect(due.jobIds).toHaveLength(1);
  });
  it("namespace epoch rotation preserves same-source terminal pause and upgrade revision", () => {
    const first = claimed();
    const state = finishCatalogReadJob(first.state, first.id, "owner-1", options.now + 1, { status: "failed", reason: "authentication", resultRef: "fact:authentication" });
    state.sources.models!.failureStreak = 3; state.sources.models!.paused = true;
    const next = enqueueCatalogReadJobs(state, [spec()], { ...options, now: options.now + day * 5, identityEpoch: "new-namespace-epoch" });
    expect(next.jobIds).toEqual([]);
    expect(next.state.sources.models).toEqual({ ...state.sources.models, identityEpoch: "new-namespace-epoch" });
    state.sources.models!.paused = false;
    const upgrade = enqueueCatalogReadJobs(state, [spec()], { ...options, mode: "upgrade", now: options.now + day * 5, identityEpoch: "new-namespace-epoch" });
    expect(upgrade.jobIds).toEqual([]);
    expect(upgrade.state.sources.models!.lastAttemptRevision).toBe("revision-1");
  });
  it("invalidates an old live lease without resetting that source's next daily eligibility", () => {
    const first = claimed();
    const next = enqueueCatalogReadJobs(first.state, [spec()], { ...options, now: options.now + 1, identityEpoch: "sibling-manual-epoch" });
    expect(next.jobIds).toEqual([]);
    expect(next.state.jobs[first.id]).toMatchObject({ status: "superseded", reason: "identity-changed" });
    expect(next.state.jobs[first.id]!.lease).toBeUndefined();
    expect(next.state.sources.models!.nextEligibleAt).toBe(options.now + day);
    expect(next.state.sources.models!.lastAttemptAt).toBe(options.now);
  });
  it("a different source key inherits only its own migration eligibility, never another identity's pause", () => {
    const first = claimed(); first.state.sources.models!.paused = true; first.state.sources.models!.failureStreak = 3;
    const next = enqueueCatalogReadJobs(first.state, [spec("different-credential-source")], { ...options, identityEpoch: "new-namespace-epoch" });
    expect(next.jobIds).toHaveLength(1);
    expect(next.state.sources["different-credential-source"]).toMatchObject({ paused: false, failureStreak: 0, nextEligibleAt: 0 });
    expect(next.state.sources.models).toEqual(first.state.sources.models);
  });
});

describe("catalog host cooldown and state budget", () => {
  it("parses Retry-After seconds and HTTP dates without truncating server requirements", () => {
    expect(parseCatalogRetryAfter("172800", options.now)).toBe(options.now + day * 2);
    const later = new Date(options.now + day * 2).toUTCString();
    expect(parseCatalogRetryAfter(later, options.now)).toBe(Date.parse(later));
    expect(parseCatalogRetryAfter("nonsense", options.now)).toBeUndefined();
    expect(parseCatalogRetryAfter("", options.now)).toBeUndefined();
  });
  it("cooldown delays only un-dispatched jobs on that host, not completed or another host", () => {
    const queued = enqueueCatalogReadJobs(emptyCatalogSchedulerState(), [spec(), spec("next"), spec("other", "other.invalid")], options);
    const first = claimCatalogReadJob(queued.state, queued.jobIds[0]!, { now: options.now, owner: "o", mode: "daily", draining: false, identityEpoch: "identity-1" });
    const state = recordCatalogHostResponse(first.state, "fixture.invalid", options.now, 429, "172800");
    expect(state.jobs[queued.jobIds[0]!]!.attemptConsumedAt).toBe(options.now);
    expect(state.jobs[queued.jobIds[1]!]!).toMatchObject({ status: "deferred", reason: "host-cooldown", nextAttemptEligibleAt: options.now + day * 2 });
    expect(state.jobs[queued.jobIds[2]!]!.status).toBe("queued");
    expect(state.sources.next!.lastAttemptAt).toBeUndefined();
  });
  it("uniform start jitter stays in the agreed range", () => {
    expect(catalogHostStartInterval(0)).toBe(1500);
    expect(catalogHostStartInterval(0.5)).toBe(2000);
    expect(catalogHostStartInterval(1)).toBe(2500);
  });
  it("compaction keeps pending work and last two terminal indices without touching external facts", () => {
    let state: CatalogSchedulerState = emptyCatalogSchedulerState();
    for (let index = 0; index < 4; index++) {
      const now = options.now + index * day, queued = enqueueCatalogReadJobs(state, [spec()], { ...options, now, observationCycleId: `cycle-${index}` });
      const claim = claimCatalogReadJob(queued.state, queued.jobIds[0]!, { now, owner: "o", mode: "daily", draining: false, identityEpoch: "identity-1" });
      state = finishCatalogReadJob(claim.state, queued.jobIds[0]!, "o", now + 1, { status: "completed", resultRef: `facts:${index}` });
    }
    const next = enqueueCatalogReadJobs(state, [spec("pending")], { ...options, now: options.now + day * 4 });
    const compacted = compactCatalogSchedulerState(next.state);
    expect(Object.values(compacted.jobs).filter(job => job.status === "completed")).toHaveLength(2);
    expect(compacted.jobs[next.jobIds[0]!]!.status).toBe("queued");
    expect(Object.keys(compacted.sources)).toEqual(["models", "pending"]);
  });
  it("rejects completed indices without facts and preserves input on failed claim", () => {
    const first = claimed(), original = structuredClone(first.state);
    expect(() => finishCatalogReadJob(first.state, first.id, "owner-1", options.now + 1, { status: "completed", resultRef: "" })).toThrow("规范化");
    expect(first.state).toEqual(original);
    const invalid = structuredClone(first.state); invalid.jobs[first.id]!.status = "completed";
    expect(() => assertCatalogSchedulerState(invalid)).toThrow("无效");
  });
  function fullPublishedQueue() {
    const first = claimed(), saved = finishCatalogReadJob(first.state, first.id, "owner-1", options.now + 1, { status: "completed", resultRef: "fact:models" });
    const prototype = saved.jobs[first.id]!, source = saved.sources.models!;
    const state = emptyCatalogSchedulerState();
    for (let index = 0; index < CATALOG_SCHEDULER_MAX_JOBS; index++) {
      const sourceKey = `source-${index}`, id = `job-${index}`;
      state.jobs[id] = { ...structuredClone(prototype), id, sourceKey, spec: spec(sourceKey), order: index + 1, resultRef: `fact:${sourceKey}` };
      state.sources[sourceKey] = structuredClone(source);
    }
    state.nextOrder = CATALOG_SCHEDULER_MAX_JOBS + 1;
    return state;
  }
  it("makes room after 4096 distinct sources completed without resetting any eligibility or facts", () => {
    const state = fullPublishedQueue(), sources = structuredClone(state.sources);
    const next = enqueueCatalogReadJobs(state, [spec("new-source")], options);
    expect(next.deferred).toBe(0); expect(next.jobIds).toHaveLength(1);
    expect(Object.keys(next.state.jobs)).toHaveLength(CATALOG_SCHEDULER_MAX_JOBS);
    expect(next.state.jobs["job-0"]).toBeUndefined();
    expect(next.state.jobs[next.jobIds[0]!]!.status).toBe("queued");
    for (const [sourceKey, source] of Object.entries(sources)) expect(next.state.sources[sourceKey]).toEqual(source);
    expect(state.jobs["job-0"]!.resultRef).toBe("fact:source-0");
    // Removing an execution index does not authorize another same-day attempt.
    const sameCycle = enqueueCatalogReadJobs(next.state, [spec("source-0")], options);
    expect(sameCycle.jobIds).toEqual([]);
    expect(sameCycle.state.sources["source-0"]).toEqual(sources["source-0"]);
  });
  it.each(["unknown", "running", "deferred"] as const)("budget recovery never deletes %s work without durable facts", status => {
    const state = fullPublishedQueue(), protectedJob = state.jobs["job-0"]!;
    protectedJob.status = status; delete protectedJob.resultRef;
    if (status === "running") protectedJob.lease = { owner: "other-owner", expiresAt: options.now + CATALOG_JOB_LEASE_MS };
    const next = enqueueCatalogReadJobs(state, [spec("new-source")], options);
    expect(next.jobIds).toHaveLength(1); expect(next.state.jobs["job-0"]).toEqual(protectedJob);
    expect(next.state.jobs["job-1"]).toBeUndefined();
  });
  it("ordinary per-source compaction preserves old unknown indices that have no fact reference", () => {
    const first = claimed(), state = first.state;
    const prototype = state.jobs[first.id]!;
    for (let index = 0; index < 4; index++) state.jobs[`unknown-${index}`] = {
      ...structuredClone(prototype), id: `unknown-${index}`, order: index + 1, status: "unknown", reason: "lease-expired",
    };
    const compacted = compactCatalogSchedulerState(state);
    for (let index = 0; index < 4; index++) expect(compacted.jobs[`unknown-${index}`]).toEqual(state.jobs[`unknown-${index}`]);
  });
  it("automatic mode off performs no budget cleanup or state mutation", () => {
    const state = fullPublishedQueue();
    expect(enqueueCatalogReadJobs(state, [spec("new-source")], { ...options, mode: "off" })).toEqual({ state, jobIds: [], deferred: 0 });
  });
});

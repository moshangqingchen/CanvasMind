import { describe, expect, it } from "vitest";
import type { CatalogPipelineState, JsonObject, ProviderConnectionRecord } from "@super-canvas/db";
import type { CatalogInventoryState } from "./catalog-inventory-policy";
import { catalogManualRefreshFenceKey, catalogManualRefreshPatches, catalogManualRefreshReady, readCatalogManualRefreshFence } from "./catalog-manual-refresh-fence";
import { catalogConnectionScopes, catalogReadItem } from "./catalog-source-plan";
import { emptyCatalogSchedulerState, enqueueCatalogReadJobs, type CatalogSchedulerState } from "./catalog-read-scheduler";

const stamp = "2026-10-17T09:00:00Z", now = Date.parse(stamp);
const connection: ProviderConnectionRecord = { id: "key-a", name: "Fixture", provider: "openai", createdAt: stamp, updatedAt: stamp,
  config: { baseUrl: "https://fixture.invalid", modelScanCheckedAt: stamp, modelCatalogModels: [{ id: "manual", name: "Manual", operations: ["image.generate"] }] } };
const scopes = catalogConnectionScopes(connection);
const key = catalogReadItem("models", "https://fixture.invalid/models", "key-membership", scopes.key, scopes.apply, true);
const shared = catalogReadItem("public", "https://fixture.invalid/public", "schema", scopes.anonymous, scopes.apply);
function inventory(): CatalogInventoryState {
  const model = { id: "old", name: "Old", operations: ["image.generate" as const] };
  return { schemaVersion: 1, connectionId: connection.id, identityEpoch: "epoch", observedAt: stamp, visibleModels: [model], historicalModels: [], sources: {
    [key.sourceKey]: { sourceKey: key.sourceKey, identity: "exact-key", acceptedModels: [model], lastIdentityEpoch: "epoch", lastDispatchSeq: 2,
      lastObservationCycleId: "prior", lastObservedAt: stamp, lastOutcome: "candidate",
      baseline: { modelIds: [model.id], fingerprint: "old", checkedAt: stamp, observationCycleId: "prior" },
      candidate: { modelIds: [], models: [], fingerprint: "drop", version: "stale-version", checkedAt: stamp, observationCycleId: "prior", countedCycles: ["prior"] } },
  } };
}
describe("per-connection manual refresh fence", () => {
  it("keeps actual source baselines, clears stale candidates and leaves shared source eligibility unchanged", () => {
    const scheduler = enqueueCatalogReadJobs(emptyCatalogSchedulerState(), [key, shared], { now, mode: "daily", identityEpoch: "epoch", observationCycleId: "prior",
      revision: "old", sessionStartedAt: now - 60_000 }).state;
    scheduler.sources[key.sourceKey]!.paused = true; scheduler.sources[key.sourceKey]!.failureStreak = 3;
    const publicBefore = structuredClone(scheduler.sources[shared.sourceKey]);
    const pipeline: CatalogPipelineState = { schemaVersion: 1, supplierId: "owner", identityEpoch: "epoch", nextDispatchSeq: 4, sources: {},
      entries: { "scheduler:v1": scheduler as unknown as JsonObject, [`membership:${connection.id}`]: inventory() as unknown as JsonObject } };
    const original = structuredClone(pipeline);
    const patches = catalogManualRefreshPatches(pipeline, connection, [key, shared], "new", now);
    const nextInventory = patches.find(patch => patch.key === `membership:${connection.id}`)!.value as unknown as CatalogInventoryState;
    const nextScheduler = patches.find(patch => patch.key === "scheduler:v1")!.value as unknown as CatalogSchedulerState;
    expect(nextInventory.visibleModels.map(model => model.id)).toEqual(["manual"]);
    expect(nextInventory.sources[key.sourceKey]?.baseline?.modelIds).toEqual(["old"]);
    expect(nextInventory.sources[key.sourceKey]?.acceptedModels.map(model => model.id)).toEqual(["old"]);
    expect(nextInventory.sources[key.sourceKey]?.candidate).toBeUndefined();
    expect(nextScheduler.sources[key.sourceKey]).toMatchObject({ paused: false, failureStreak: 0, nextEligibleAt: now + 86_400_000, lastAttemptRevision: "new" });
    expect(nextScheduler.sources[shared.sourceKey]).toEqual(publicBefore);
    expect(Object.values(nextScheduler.jobs).find(job => job.sourceKey === key.sourceKey)?.status).toBe("superseded");
    expect(Object.values(nextScheduler.jobs).find(job => job.sourceKey === shared.sourceKey)?.status).toBe("queued");
    expect(pipeline).toEqual(original);
  });
  it("requires all independent Key sources after the fence and a complete manifest before releasing", () => {
    const state = inventory(), source = state.sources[key.sourceKey]!;
    const fence = { schemaVersion: 1 as const, identityEpoch: "epoch", dispatchedThrough: 3, checkedAt: stamp };
    expect(catalogManualRefreshReady(fence, state, [key.sourceKey], true)).toBe(false);
    source.lastDispatchSeq = 4; source.lastOutcome = "accepted"; delete source.candidate;
    expect(catalogManualRefreshReady(fence, state, [key.sourceKey], false)).toBe(false);
    expect(catalogManualRefreshReady(fence, state, [key.sourceKey, "second-key-source"], true)).toBe(false);
    expect(catalogManualRefreshReady(fence, state, [key.sourceKey], true)).toBe(true);
    const pipeline: CatalogPipelineState = { schemaVersion: 1, supplierId: "owner", identityEpoch: "epoch", nextDispatchSeq: 5, sources: {},
      entries: { [catalogManualRefreshFenceKey(connection.id)]: fence } };
    expect(readCatalogManualRefreshFence(pipeline, connection.id)).toEqual(fence);
    pipeline.identityEpoch = "changed";
    expect(readCatalogManualRefreshFence(pipeline, connection.id)).toBeUndefined();
  });
});

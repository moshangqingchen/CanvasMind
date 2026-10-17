import { describe, expect, it, vi } from "vitest";
import { catalogLegacyObservationOwner, catalogPipelineSettingKey, MemoryRepository, type JsonObject } from "@super-canvas/db";
import { createCatalogLegacyEligibility } from "./catalog-legacy-eligibility";
import { catalogSourcePlan } from "./catalog-source-plan";
import { CATALOG_DAILY_INTERVAL_MS, emptyCatalogSchedulerState, type CatalogReadJob } from "./catalog-read-scheduler";
import { SupplierCatalogUpgrade, SUPPLIER_CATALOG_REVISION } from "./supplier-catalog-upgrade";

const NOW = Date.parse("2026-10-17T00:00:00Z");
async function fixture() {
  const repository = new MemoryRepository();
  const connection = await repository.saveConnection({ id: "fixture-key", name: "Key", provider: "openai", encryptedSecret: "fixture-encrypted",
    config: { baseUrl: "https://api.tk1688.com/v1", modelGroup: "default" } });
  const owner = catalogLegacyObservationOwner(connection), key = catalogPipelineSettingKey(owner.id), spec = catalogSourcePlan(connection)[0]!;
  const scheduler = emptyCatalogSchedulerState();
  const save = () => repository.setApplicationSetting(key, { schemaVersion: 1, supplierId: owner.id, identityEpoch: "epoch", nextDispatchSeq: 1,
    sources: {}, entries: { "scheduler:v1": scheduler as unknown as JsonObject } });
  const source = (paused = false) => { scheduler.sources[spec.sourceKey] = { identityEpoch: "epoch", lastAttemptAt: NOW,
    lastAttemptCycleId: "day", lastAttemptRevision: SUPPLIER_CATALOG_REVISION, nextEligibleAt: NOW + CATALOG_DAILY_INTERVAL_MS,
    failureStreak: paused ? 3 : 0, paused }; };
  const job = (extra: Partial<CatalogReadJob> = {}) => { scheduler.jobs.job = { id: "job", sourceKey: spec.sourceKey, supplierId: owner.id,
    identityEpoch: "epoch", observationCycleId: "day", mode: "daily", revision: SUPPLIER_CATALOG_REVISION, spec,
    status: "unknown", queuedAt: NOW, order: 1, nextAttemptEligibleAt: NOW, reason: "lease-expired", ...extra }; };
  return { repository, connection, scheduler, source, job, key, save, eligibility: createCatalogLegacyEligibility(repository) };
}
describe("emergency legacy catalog eligibility", () => {
  it("preserves old behavior when no new scheduler exists, without any writes", async () => {
    const f = await fixture(), before = f.repository.exportSnapshot(), write = vi.spyOn(f.repository, "setApplicationSetting"), saveConnection = vi.spyOn(f.repository, "saveConnection");
    expect(await f.eligibility(f.connection, "daily", NOW)).toBeUndefined();
    expect(write).not.toHaveBeenCalled(); expect(saveConnection).not.toHaveBeenCalled(); expect(f.repository.exportSnapshot()).toEqual(before);
  });
  it("guards compacted consumed sources for 24 hours and keeps status and run consistent", async () => {
    const f = await fixture(); f.source(); await f.save();
    const namespace = await f.repository.getApplicationSetting(f.key);
    const refreshCatalog = vi.fn(async () => ({ complete: false, code: "network" }));
    let now = NOW + 1000;
    const service = new SupplierCatalogUpgrade({ repository: f.repository, refreshCatalog, now: () => now, eligibility: f.eligibility });
    expect((await service.status()).connections[0]?.nextCheckAt).toBe(new Date(NOW + CATALOG_DAILY_INTERVAL_MS).toISOString());
    service.start(); await service.settle(); expect(refreshCatalog).not.toHaveBeenCalled();
    expect(await f.repository.getApplicationSetting(f.key)).toEqual(namespace);
    now = NOW + CATALOG_DAILY_INTERVAL_MS;
    service.start(); await service.settle(); expect(refreshCatalog).toHaveBeenCalledTimes(1);
    expect(await f.repository.getApplicationSetting(f.key)).toEqual(namespace);
  });
  it("keeps source pause and upgrade revision barriers after switching engines", async () => {
    const f = await fixture(); f.source(true); await f.save();
    expect(await f.eligibility(f.connection, "daily", NOW + 10 * CATALOG_DAILY_INTERVAL_MS)).toMatchObject({ nextCheckAt: null, paused: true, manualRequired: true });
    f.source(false); await f.save();
    expect(await f.eligibility(f.connection, "upgrade", NOW + 10 * CATALOG_DAILY_INTERVAL_MS)).toMatchObject({ nextCheckAt: null });
    expect((await createCatalogLegacyEligibility(f.repository, "next-revision")(f.connection, "upgrade", NOW + 10 * CATALOG_DAILY_INTERVAL_MS))?.nextCheckAt).toBe(NOW + 10 * CATALOG_DAILY_INTERVAL_MS);
  });
  it("protects consumed results unknown even if their source state was not published", async () => {
    const f = await fixture(); f.job({ attemptConsumedAt: NOW }); await f.save();
    expect(await f.eligibility(f.connection, "daily", NOW + 1)).toMatchObject({ nextCheckAt: NOW + CATALOG_DAILY_INTERVAL_MS, manualRequired: true });
  });
  it("keeps an unconsumed 429 delay without inventing another 24-hour restriction", async () => {
    const f = await fixture(), cooldown = NOW + 3_600_000;
    f.job({ status: "deferred", reason: "host-cooldown", nextAttemptEligibleAt: cooldown });
    f.scheduler.hosts["api.tk1688.com"] = { nextStartAt: NOW, cooldownUntil: cooldown, failures: 1 }; await f.save();
    expect((await f.eligibility(f.connection, "daily", NOW))?.nextCheckAt).toBe(cooldown);
    expect((await f.eligibility(f.connection, "daily", cooldown))?.nextCheckAt).toBe(cooldown);
  });
  it("does not apply another credential's private source pause to the current Key", async () => {
    const f = await fixture(); f.source(true); f.job({ attemptConsumedAt: NOW }); await f.save();
    const changed = { ...f.connection, encryptedSecret: "new-encrypted-fixture" };
    expect(await f.eligibility(changed, "daily", NOW)).toMatchObject({ nextCheckAt: NOW, paused: false });
  });
  it("can clear a stale old pause only after a newer successful source attempt", async () => {
    const f = await fixture(); f.source(false); await f.save();
    const old = { ...f.connection, config: { ...f.connection.config, catalogCheckPaused: true, catalogCheckManualRequired: true,
      catalogCheckAttemptedAt: new Date(NOW - CATALOG_DAILY_INTERVAL_MS).toISOString() } };
    expect(await f.eligibility(old, "daily", NOW + 1)).toMatchObject({ paused: false, manualRequired: false, nextCheckAt: NOW + CATALOG_DAILY_INTERVAL_MS });
    const newer = { ...old, config: { ...old.config, catalogCheckAttemptedAt: new Date(NOW + 1000).toISOString() } };
    expect(await f.eligibility(newer, "daily", NOW + 2000)).toMatchObject({ nextCheckAt: null, paused: true });
  });
  it("off never creates eligibility and corrupt persisted state fails closed", async () => {
    const f = await fixture(); f.source(); await f.save();
    expect((await f.eligibility(f.connection, "off", NOW))?.nextCheckAt).toBeNull();
    await f.repository.setApplicationSetting(f.key, { invalid: true });
    await expect(f.eligibility(f.connection, "daily", NOW)).rejects.toThrow("状态格式无效");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, catalogPipelineSettingKey, type ProviderConnectionRecord } from "@super-canvas/db";
import { catalogLegacyConnectionEntryKey, legacyCatalogObservationEntries, readCatalogObservationStore, reserveCatalogReadObservation } from "./catalog-observation-store";
import { CATALOG_CHECK_INTERVAL_MS, CATALOG_MODE_SETTING } from "./supplier-catalog-policy";
import { SUPPLIER_CATALOG_REVISION } from "./supplier-catalog-upgrade";

const now = Date.parse("2026-10-17T12:00:00Z"), attemptedAt = "2026-10-17T08:00:00Z";
afterEach(() => { vi.unstubAllGlobals(); });
async function fixture(config: Record<string, unknown> = {}) {
  const repository = new MemoryRepository();
  const supplier = await repository.saveSupplier({ id: "migration-supplier", name: "Fixture supplier", supplierKey: "fixture", siteUrl: "https://fixture.invalid",
    apiUrl: "https://fixture.invalid/v1", kind: "newapi", scanStatus: "live", catalog: { groups: [] },
    state: { version: 1, revision: 4, sourceId: "source-a", fingerprint: "fixture", visibility: "visible", history: [] } });
  const connection = await repository.saveConnection({ id: "connection", name: "Fixture Key", provider: "openai", encryptedSecret: "opaque-key-do-not-copy", config: {
    supplierId: supplier.id, supplierSourceId: "source-a", baseUrl: supplier.apiUrl, catalogCheckAttemptedAt: attemptedAt,
    catalogCheckAttemptRevision: SUPPLIER_CATALOG_REVISION, modelCatalogModels: [{ id: "old-model", metadata: { priceLabel: "¥0.20/张" } }],
    catalogCheckHistory: [{ id: "saved-history", changes: [{ kind: "price" }] }], ...config,
  } });
  return { repository, supplier, connection };
}
describe("catalog observation lazy legacy migration", () => {
  it("purely preserves old eligibility/attempt/revision/manual markers without new source evidence", async () => {
    const { supplier, connection } = await fixture({ catalogCheckFailureStreak: 2, catalogCheckPaused: false,
      catalogCheckManualRequired: true, catalogCheckFailureReason: "network", catalogCheckLastResult: "failed", catalogCheckRetainedPriceModelCount: 32,
      catalogUpgradeRevision: "older-version" });
    const before = structuredClone(connection);
    const entries = legacyCatalogObservationEntries(supplier, [connection], "daily", now);
    const value = entries[catalogLegacyConnectionEntryKey(connection.id)]!;
    expect(value).toMatchObject({ migrationVersion: 1, connectionId: connection.id, supplierSourceId: "source-a", modeAtMigration: "daily",
      nextEligibleAt: new Date(Date.parse(attemptedAt) + CATALOG_CHECK_INTERVAL_MS).toISOString(),
      legacy: { catalogCheckAttemptedAt: attemptedAt, catalogCheckAttemptRevision: SUPPLIER_CATALOG_REVISION,
        catalogCheckFailureStreak: 2, catalogCheckPaused: false, catalogCheckManualRequired: true,
        catalogCheckFailureReason: "network", catalogCheckLastResult: "failed", catalogCheckRetainedPriceModelCount: 32, catalogUpgradeRevision: "older-version" },
      historyRef: { connectionId: connection.id, field: "catalogCheckHistory" } });
    expect(value).not.toHaveProperty("baseline"); expect(value).not.toHaveProperty("sources"); expect(value).not.toHaveProperty("lastCountedCycleId");
    expect(JSON.stringify(entries)).not.toContain("opaque-key-do-not-copy"); expect(JSON.stringify(entries)).not.toContain("priceLabel");
    expect(connection).toEqual(before);
    expect(legacyCatalogObservationEntries(supplier, [connection], "daily", now)).toEqual(entries);
  });
  it.each(["off", "paused", "upgrade"])("does not revive ineligible legacy connection: %s", async reason => {
    const { supplier, connection } = await fixture({ ...(reason === "paused" ? { catalogCheckPaused: true, catalogCheckFailureStreak: 3 } : {}) });
    const mode = reason === "off" ? "off" : reason === "upgrade" ? "upgrade" : "daily";
    const entry = legacyCatalogObservationEntries(supplier, [connection], mode, now)[catalogLegacyConnectionEntryKey(connection.id)]!;
    expect(entry.nextEligibleAt).toBeNull();
    if (reason === "paused") expect(entry.legacy).toMatchObject({ catalogCheckPaused: true, catalogCheckFailureStreak: 3 });
  });
  it("inherits old upgrade attempt fields and the prior revision compatibility rule", async () => {
    const { supplier, connection } = await fixture({ baseUrl: "https://api.tk1688.com/v1", catalogCheckAttemptedAt: undefined, catalogCheckAttemptRevision: undefined,
      catalogUpgradeAttemptedAt: attemptedAt, catalogUpgradeAttemptRevision: "2026-10-09-full-supplier-recheck-contracts-prices-v11" });
    expect(legacyCatalogObservationEntries(supplier, [connection], "daily", now)[catalogLegacyConnectionEntryKey(connection.id)]?.nextEligibleAt)
      .toBe("2026-10-18T08:00:00.000Z");
    expect(legacyCatalogObservationEntries(supplier, [connection], "upgrade", now)[catalogLegacyConnectionEntryKey(connection.id)]?.nextEligibleAt).toBeNull();
  });
  it("reading previews or existing state does not write, dispatch or mutate legacy rows", async () => {
    const { repository, supplier, connection } = await fixture({ catalogCheckPaused: true });
    const set = vi.spyOn(repository, "setApplicationSetting"), save = vi.spyOn(repository, "saveConnection"), reserve = vi.spyOn(repository, "reserveCatalogObservation");
    const network = vi.fn(() => { throw new Error("Unexpected network"); }); vi.stubGlobal("fetch", network);
    const before = repository.exportSnapshot();
    const preview = await readCatalogObservationStore(repository, supplier, [connection], now);
    expect(preview.state).toBeUndefined(); expect(preview.initialEntries[catalogLegacyConnectionEntryKey(connection.id)]?.nextEligibleAt).toBeNull();
    expect(repository.exportSnapshot()).toEqual(before);
    expect(set).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it("initializes only on durable reserve and never overwrites existing migrated entries", async () => {
    const { repository, supplier, connection } = await fixture({ catalogCheckPaused: true, catalogCheckManualRequired: true });
    const input = { supplier, connections: [connection], guardedConnectionIds: [connection.id], sourceKey: "fixture-key-source", observationCycleId: "cycle-a", expectedMode: "daily" as const };
    expect(await repository.getApplicationSetting(catalogPipelineSettingKey(supplier.id))).toBeUndefined();
    const first = await reserveCatalogReadObservation(repository, input, now);
    const migrated = (await readCatalogObservationStore(repository, supplier, [connection], now)).state!;
    expect(migrated).toMatchObject({ schemaVersion: 1, nextDispatchSeq: 2, sources: { "fixture-key-source": { lastAcceptedSeq: 0 } } });
    expect(migrated.entries[catalogLegacyConnectionEntryKey(connection.id)]).toMatchObject({ nextEligibleAt: null, legacy: { catalogCheckPaused: true, catalogCheckManualRequired: true } });
    const altered: ProviderConnectionRecord = { ...connection, config: { ...connection.config, catalogCheckPaused: false, catalogCheckManualRequired: false } };
    const second = await reserveCatalogReadObservation(repository, { ...input, connections: [altered], guardedConnectionIds: [], observationCycleId: "cycle-b" }, now + CATALOG_CHECK_INTERVAL_MS);
    expect(second.dispatchSeq).toBe(first.dispatchSeq + 1);
    const retained = (await readCatalogObservationStore(repository, supplier, [altered], now)).state!;
    expect(retained.entries).toEqual(migrated.entries); expect(retained.sources["fixture-key-source"]?.lastAcceptedSeq).toBe(0);
  });
  it("off mode rejects reserve without persisting a migration", async () => {
    const { repository, supplier, connection } = await fixture();
    await repository.setApplicationSetting(CATALOG_MODE_SETTING, "off");
    await expect(reserveCatalogReadObservation(repository, { supplier, connections: [connection], guardedConnectionIds: [connection.id],
      sourceKey: "source", observationCycleId: "cycle", expectedMode: "daily" }, now)).rejects.toThrow();
    expect(await repository.getApplicationSetting(catalogPipelineSettingKey(supplier.id))).toBeUndefined();
  });
  it("does not mix archived/foreign supplier or old source rows into an active namespace", async () => {
    const { supplier, connection } = await fixture();
    const variants = [connection,
      { ...connection, id: "foreign", config: { ...connection.config, supplierId: "different" } },
      { ...connection, id: "archived", config: { ...connection.config, supplierArchived: true } },
      { ...connection, id: "old-source", config: { ...connection.config, supplierSourceId: "source-old" } }];
    expect(Object.keys(legacyCatalogObservationEntries(supplier, variants, "daily", now))).toEqual([catalogLegacyConnectionEntryKey(connection.id)]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, catalogPipelineSettingKey, type CatalogPipelineState, type JsonObject, type ProviderConnectionRecord } from "@super-canvas/db";
import type { CatalogInventoryState } from "./catalog-inventory-policy";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import { emptyCatalogSchedulerState } from "./catalog-read-scheduler";
import { acknowledgeCatalogPipelineCursors, buildCatalogPipelineDiagnostics, catalogDiagnosticSourceUrl, catalogPipelineCursorKey, CATALOG_PIPELINE_NOTICE_CURSORS, readCatalogPipelineStatus } from "./catalog-pipeline-diagnostics";

const now = Date.parse("2026-10-17T09:00:00Z"), checkedAt = new Date(now).toISOString();
const connection = { id: "connection-a", name: "Fixture connection", provider: "openai", encryptedSecret: "not-a-real-secret", config: {
  supplierId: "supplier-a", baseUrl: "https://ai.cangyuansuanli.cn", catalogCheckAttemptedAt: checkedAt,
}, createdAt: checkedAt, updatedAt: checkedAt } satisfies ProviderConnectionRecord;
const state = (): CatalogPipelineState => ({ schemaVersion: 1, supplierId: "supplier-a", identityEpoch: "epoch-a", nextDispatchSeq: 8, sources: {}, entries: {} });
const observation = (): CatalogReadObservation => ({ receipt: { spec: {
  sourceKey: "source-a", entryId: "key-models", sourceUrl: "https://fixture.invalid/v1/models?api_key=NEVER-EXPOSE",
  parserVersion: "fixture", authScope: { kind: "connection-key", principalRef: connection.id, credentialEpoch: "NEVER-EXPOSE-EPOCH" },
  applyScope: { supplierId: "supplier-a", supplierSourceId: "fixture", connectionIds: [connection.id], groupIdentity: "site-id:one" },
  role: "key-membership", requiredForMembership: true,
}, context: { runId: "fixture", identityEpoch: "epoch-a", observationCycleId: "daily-one", dispatchSeq: 2 }, status: "succeeded", complete: true,
freshness: "live", checkedAt, coverage: { domain: "key-list", modelIds: ["image-a"], exhaustive: true } }, facts: { models: [{ id: "image-a", name: "Image A", operations: ["image.generate"] }] } });

afterEach(() => vi.unstubAllGlobals());
describe("committed catalog diagnostics", () => {
  it("exposes independent roles and safe source references, never credentials or raw errors", () => {
    const value = state(), fact = observation();
    value.entries["fact:source-a"] = fact as unknown as JsonObject;
    const result = buildCatalogPipelineDiagnostics([{ ownerId: value.supplierId, state: value }], [connection]);
    expect(result.diagnostics[0]).toMatchObject({ role: "key-membership", status: "succeeded", complete: true, modelCount: 1,
      requiredForMembership: true, identity: "connection-key", sourceUrl: "https://fixture.invalid/v1/models" });
    expect(JSON.stringify(result)).not.toContain("NEVER-EXPOSE");
    expect(catalogDiagnosticSourceUrl("https://user:pass@fixture.invalid/models")).toBeUndefined();
    expect(catalogDiagnosticSourceUrl("javascript:alert(1)")).toBeUndefined();
  });
  it("returns exact soft candidate versions and complete historical descriptors without granting execution", () => {
    const value = state(), model = { id: "retired-full-model-id", name: "Retired", operations: ["image.generate" as const], parameters: [
      { key: "quality", label: "质量", control: "select" as const, options: [{ value: "high", label: "High" }], default: "high" },
    ], metadata: { apiKey: "NEVER-EXPOSE", sourceUrl: "https://fixture.invalid/detail?token=NEVER-EXPOSE" } };
    const inventory: CatalogInventoryState = { schemaVersion: 1, connectionId: connection.id, identityEpoch: "epoch-a", observedAt: checkedAt,
      visibleModels: [], sources: { "source-a": { sourceKey: "source-a", identity: "identity", acceptedModels: [], baseline: {
        modelIds: ["a", "b", "c"], fingerprint: "baseline", checkedAt, observationCycleId: "old",
      }, candidate: { modelIds: ["a"], models: [], fingerprint: "candidate", version: "exact-version", countedCycles: ["daily-one"], checkedAt, observationCycleId: "daily-one" },
      lastIdentityEpoch: "epoch-a", lastDispatchSeq: 2, lastObservationCycleId: "daily-one", lastObservedAt: checkedAt, lastOutcome: "candidate" } },
      historicalModels: [{ modelId: model.id, descriptor: model, identityEpoch: "epoch-a", unavailableAt: checkedAt, observationCycleId: "daily-one", sourceKeys: ["source-a"] }] };
    value.entries[`membership:${connection.id}`] = inventory as unknown as JsonObject;
    const result = buildCatalogPipelineDiagnostics([{ ownerId: value.supplierId, state: value }], [connection]);
    expect(result.candidates).toEqual([{ connectionId: connection.id, sourceKey: "source-a", candidateVersion: "exact-version", baselineCount: 3,
      candidateCount: 1, missingCount: 2, countedCycles: 1, requiredCycles: 3, checkedAt }]);
    expect(result.historyDescriptors[0]?.descriptor.parameters?.[0]?.key).toBe("quality");
    expect(JSON.stringify(result)).not.toContain("NEVER-EXPOSE");
    inventory.identityEpoch = "old-epoch";
    expect(buildCatalogPipelineDiagnostics([{ ownerId: value.supplierId, state: value }], [connection]).candidates).toEqual([]);
  });
  it("keeps supplier entry cursors independent and rejects unknown or future acknowledgements", () => {
    const a = catalogPipelineCursorKey("supplier-a", "changes:connection-a"), b = catalogPipelineCursorKey("supplier-b", "changes:connection-b");
    expect(acknowledgeCatalogPipelineCursors({ [a]: 4, [b]: 1 }, { [a]: 9, [b]: 2, unknown: 200 }, { [a]: 5, [b]: 2 })).toEqual({ [a]: 4, [b]: 2 });
    expect(acknowledgeCatalogPipelineCursors({}, { [a]: -1 }, { [a]: 5 })).toEqual({ [a]: 0 });
  });
  it("reads cached status without network, writes, or source initialization; acknowledgements hide only noticed changes", async () => {
    const repository = new MemoryRepository();
    await repository.saveSupplier({ id: "supplier-a", name: "Fixture", supplierKey: "cangyuan", siteUrl: "https://ai.cangyuansuanli.cn", apiUrl: "https://ai.cangyuansuanli.cn", kind: "newapi", catalog: { groups: [] }, scanStatus: "live" });
    await repository.saveConnection(connection);
    await repository.saveConnection({ ...connection, config: { ...connection.config, catalogCheckHistory: [
      { id: "legacy-diff", checkedAt, connectionId: connection.id, connectionName: connection.name, changes: [{ kind: "model-added", modelId: "legacy-added" }] },
      { id: "change-a", checkedAt, connectionId: connection.id, connectionName: connection.name, changes: [{ kind: "model-added", modelId: "overridden-by-new" }] },
      { id: "expired", checkedAt: "2026-08-01T00:00:00Z", connectionId: connection.id, connectionName: connection.name, changes: [{ kind: "model-added", modelId: "expired" }] },
    ] } });
    const value = state(), fact = observation();
    value.entries["fact:source-a"] = fact as unknown as JsonObject;
    value.entries[`diagnostics:${connection.id}`] = { schemaVersion: 1, cursor: 5, checkedAt, outcome: "partial", manualRequired: false, retainedPriceModelCount: 2 };
    value.entries[`changes:${connection.id}`] = { schemaVersion: 1, cursor: 5, records: [{ id: "change-a", checkedAt,
      connectionId: connection.id, connectionName: connection.name, supplierId: "supplier-a", changes: [{ kind: "price", modelId: "image-a", before: "1 CNY / 张", after: "2 CNY / 张" }] }] };
    await repository.setApplicationSetting(catalogPipelineSettingKey("supplier-a"), value as unknown as JsonObject);
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    const save = vi.spyOn(repository, "saveConnection"), settings = vi.spyOn(repository, "setApplicationSetting"), reserve = vi.spyOn(repository, "reserveCatalogObservation");
    const pipelineRead = vi.spyOn(repository, "getCatalogPipelineState"), applicationRead = vi.spyOn(repository, "getApplicationSetting");
    const first = await readCatalogPipelineStatus(repository, { revision: "fixture", now });
    expect(first).toMatchObject({ total: 1, retainedPriceModelCount: 2, changedConnectionIds: [connection.id], priceChangedSupplierIds: ["supplier-a"] });
    expect(first.noticeId).toBeTruthy();
    expect(pipelineRead).toHaveBeenLastCalledWith("supplier-a", ["scheduler:v1"], ["task:", "diagnostics:", "changes:", "membership:", "contracts:", "fact:"]);
    expect(applicationRead).not.toHaveBeenCalledWith(catalogPipelineSettingKey("supplier-a"));
    expect(save).not.toHaveBeenCalled(); expect(settings).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
    await repository.setApplicationSetting(CATALOG_PIPELINE_NOTICE_CURSORS, first.pipeline!.noticeCursors);
    const second = await readCatalogPipelineStatus(repository, { revision: "fixture", now, summary: true });
    expect(pipelineRead).toHaveBeenLastCalledWith("supplier-a", ["scheduler:v1"], ["task:", "diagnostics:", "changes:"]);
    expect(second.noticeId).toBeNull(); expect(second.changedConnectionIds).toEqual([]);
    expect(second.history).toEqual([]); expect(second.pipeline?.diagnostics).toEqual([]);
    expect(second.pipeline?.noticeCursors).toEqual(first.pipeline!.noticeCursors);
    expect(first.history).toHaveLength(2);
    expect(first.history.find(row => row.id === "change-a")?.changes[0]?.kind).toBe("price");
    expect(first.history.some(row => row.id === "expired")).toBe(false);
  });
  it("derives terminal source state from committed scheduler references without hydrating large facts", () => {
    const value = state(), fact = observation(), scheduler = emptyCatalogSchedulerState();
    scheduler.sources[fact.receipt.spec.sourceKey] = { identityEpoch: value.identityEpoch, nextEligibleAt: now + 86_400_000, failureStreak: 0, paused: false };
    scheduler.jobs.complete = { id: "complete", sourceKey: fact.receipt.spec.sourceKey, supplierId: value.supplierId, identityEpoch: value.identityEpoch,
      observationCycleId: "cycle", mode: "daily", revision: "revision", spec: fact.receipt.spec, status: "completed", queuedAt: now - 10, attemptConsumedAt: now - 5,
      completedAt: now, resultRef: `fact:${fact.receipt.spec.sourceKey}`, order: 1, nextAttemptEligibleAt: now };
    value.entries["scheduler:v1"] = scheduler as unknown as JsonObject;
    expect(buildCatalogPipelineDiagnostics([{ ownerId: value.supplierId, state: value }], [connection]).diagnostics[0]).toMatchObject({
      status: "succeeded", complete: true, checkedAt, nextCheckAt: new Date(now + 86_400_000).toISOString(),
    });
    scheduler.jobs.complete!.status = "failed"; scheduler.jobs.complete!.reason = "authentication"; delete scheduler.jobs.complete!.resultRef;
    scheduler.sources[fact.receipt.spec.sourceKey]!.paused = true;
    expect(buildCatalogPipelineDiagnostics([{ ownerId: value.supplierId, state: value }], [connection]).diagnostics[0]).toMatchObject({
      status: "failed", complete: false, checkedAt, reason: "authentication", paused: true, nextCheckAt: null,
    });
  });
  it("preserves old due and pause state when no source has been migrated", async () => {
    const repository = new MemoryRepository();
    await repository.saveConnection({ ...connection, config: { baseUrl: "https://ai.cangyuansuanli.cn", catalogCheckAttemptedAt: checkedAt } });
    const original = await repository.getConnection(connection.id);
    const first = await readCatalogPipelineStatus(repository, { revision: "fixture", now });
    expect(first.nextCheckAt).toBe(new Date(now + 86_400_000).toISOString());
    expect(first.noticeId).toBeNull();
    expect(await repository.getConnection(connection.id)).toEqual(original);
    await repository.saveConnection({ ...original!, config: { ...original!.config, catalogCheckPaused: true } });
    expect((await readCatalogPipelineStatus(repository, { revision: "fixture", now })).nextCheckAt).toBeNull();
  });
});

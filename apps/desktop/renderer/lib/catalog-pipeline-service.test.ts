import { describe, expect, it, vi } from "vitest";
import { MemoryRepository, catalogObservationIdentity, catalogPipelineSettingKey, type CatalogPipelineState,
  type JsonObject, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import type { DocumentedModelInterface, ModelDescriptor } from "@super-canvas/providers";
import type { CatalogReadItemSpec } from "./catalog-read-contracts";
import type { CatalogInventoryState } from "./catalog-inventory-policy";
import { CATALOG_JOB_LEASE_MS, claimCatalogReadJob, enqueueCatalogReadJobs, type CatalogSchedulerState } from "./catalog-read-scheduler";
import type { CatalogSchedulerClock } from "./catalog-scheduler-store";

vi.mock("./catalog-source-plan", async importOriginal => {
  const original = await importOriginal<typeof import("./catalog-source-plan")>();
  return { ...original, catalogSourcePlan(connection: ProviderConnectionRecord, supplier?: SupplierRecord) {
    const scopes = original.catalogConnectionScopes(connection, supplier);
    const key = original.catalogReadItem("key-models", `${String(connection.config.baseUrl)}/models`, "key-membership", scopes.key, scopes.apply, true);
    return [key, ...(connection.config.fixtureNative ? [original.catalogReadItem("fixture-native", `${String(connection.config.baseUrl)}/native`,
      "key-membership", scopes.key, scopes.apply, true)] : []),
    ...(connection.config.fixturePrivateSchema ? [original.catalogReadItem("fixture-schema", `${String(connection.config.baseUrl)}/schema`,
      "schema", scopes.key, scopes.apply)] : []),
    ...(connection.config.fixturePublicSchema ? [original.catalogReadItem("fixture-public-schema", `${supplier?.siteUrl ?? String(connection.config.baseUrl)}/public-schema`,
      "schema", scopes.anonymous, scopes.apply)] : [])];
  } };
});
vi.mock("./catalog-read-task", () => ({
  discoverCatalogModelTasks: () => [],
  async collectCatalogReadTask(task: { spec: CatalogReadItemSpec }, connection: ProviderConnectionRecord, _supplier: SupplierRecord | undefined,
    _models: ModelDescriptor[], deps: { fetchFor(spec: CatalogReadItemSpec): typeof fetch; context: object; now(): string }) {
    const response = await deps.fetchFor(task.spec)(task.spec.sourceUrl);
    const body = await response.json() as { models?: ModelDescriptor[]; contracts?: DocumentedModelInterface[]; complete?: boolean };
    const complete = response.ok && body.complete !== false, models = body.models ?? [];
    return { discovered: [], observation: { receipt: { spec: task.spec, context: deps.context,
      status: response.ok ? "succeeded" : "failed", complete, freshness: "live", checkedAt: deps.now(),
      coverage: { domain: task.spec.role === "schema" ? "contract" : "key-list", modelIds: models.map(model => model.id), exhaustive: complete },
      ...(!complete ? { reason: response.status === 401 ? "authentication" : "incomplete" } : {}) }, facts: { models,
        ...(body.contracts ? { contracts: body.contracts, contractOrigin: new URL(String(connection.config.baseUrl)).origin } : {}) } } };
  },
}));

import { CATALOG_SCHEDULER_ENTRY, createCatalogPipelineService } from "./catalog-pipeline-service";

const environment = { USE_MEMORY_STORE: "ephemeral", SUPERCANVAS_CATALOG_READ_PREVIEW: "1" };
const rows = (count: number, prefix = "fixture-"): ModelDescriptor[] => Array.from({ length: count }, (_, i) =>
  ({ id: `${prefix}${i}`, name: `${prefix}${i}`, operations: ["image.generate"] }));
function fakeClock() {
  let now = Date.UTC(2001, 0, 1);
  const timers = new Map<number, () => void>(); let next = 1;
  const clock: CatalogSchedulerClock = { now: () => now,
    setTimeout: callback => { const id = next++; timers.set(id, callback); return id; }, clearTimeout: id => { timers.delete(Number(id)); } };
  return { clock, advance(ms: number) { now += ms; }, get timerCount() { return timers.size; } };
}
async function fixture(native = false, privateSchema = false, publicSchema = false) {
  const repository = new MemoryRepository(), timer = fakeClock();
  const supplier = await repository.saveSupplier({ id: "supplier", supplierKey: "fixture", name: "Fixture supplier", kind: "newapi",
    siteUrl: "https://fixture.invalid", apiUrl: "https://fixture.invalid/v1", scanStatus: "live", scanComplete: true,
    state: { version: 1, revision: 1, visibility: "visible", sourceId: "source-1", fingerprint: "source-fixture", history: [] }, catalog: { groups: [] } });
  const connection = await repository.saveConnection({ id: "connection", name: "Fixture Key", provider: "openai", encryptedSecret: "encrypted-fixture",
    config: { supplierId: supplier.id, supplierSourceId: "source-1", baseUrl: supplier.apiUrl, accountKeyGroupId: "fixture-group",
      fixtureNative: native, fixturePrivateSchema: privateSchema, fixturePublicSchema: publicSchema,
      modelScanStatus: "live", modelCatalogModels: rows(2), defaultModel: "fixture-1" } });
  let data = rows(3), nativeData = rows(1, "native-"), status = 200, retryAfter: string | undefined;
  const privateBinding: DocumentedModelInterface = { sourceUrl: "https://fixture.invalid/v1/schema",
    model: { ...rows(1)[0]!, inputKinds: ["text"], outputKinds: ["image"], parameters: [], limits: {} }, connector: {
    auth: { type: "bearer" }, submit: { method: "POST", path: "/private-submit", bodyMode: "json", mappings: [
      { target: "/model", source: { kind: "request", path: "$.model" } }, { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
    ] }, output: { kind: "image", path: "$.data", urlPath: "$.url" } } };
  const publicBinding = { ...privateBinding, sourceUrl: "https://fixture.invalid/public-schema",
    connector: { ...privateBinding.connector, submit: { ...privateBinding.connector.submit, path: "/public-submit" } } };
  const fetcher = vi.fn<typeof fetch>(async url => Response.json(String(url).endsWith("/public-schema") ? { models: [], contracts: [publicBinding] }
    : String(url).endsWith("/schema") ? { models: [], contracts: [privateBinding] }
    : { models: String(url).endsWith("/native") ? nativeData : data }, { status, ...(retryAfter ? { headers: { "Retry-After": retryAfter } } : {}) }));
  const readers = vi.fn(async () => ({ apiKey: "fixture-only", fetchFor: () => fetcher }));
  const service = () => createCatalogPipelineService({ environment, repository, clock: timer.clock, sessionStartedAt: timer.clock.now() - 60_000,
    random: () => 0.5, readers });
  const state = async () => await repository.getApplicationSetting(catalogPipelineSettingKey(supplier.id)) as {
    nextDispatchSeq: number; sources: Record<string, { lastAcceptedSeq: number }>; entries: Record<string, unknown>;
  };
  return { repository, timer, supplier, connection, fetcher, readers, service, state,
    setData(value: ModelDescriptor[]) { data = value; }, setNativeData(value: ModelDescriptor[]) { nativeData = value; },
    setStatus(value: number) { status = value; }, setRetryAfter(value?: string) { retryAfter = value; } };
}
const runOptions = { observationCycleId: "cycle-0", revision: "fixture-revision" };

describe("catalog slice-2 fixture service orchestration", () => {
  it("keeps legacy models view-only when the Key read fails even if a public contract is complete", async () => {
    const value = await fixture(false, false, true), service = value.service();
    const original = value.fetcher.getMockImplementation()!;
    value.fetcher.mockImplementation((input, init) => String(input).endsWith("/models")
      ? Promise.resolve(Response.json({ models: [] }, { status: 503 })) : original(input, init));
    await service.run(value.connection.id, runOptions); value.timer.advance(2_000); await service.run(value.connection.id, runOptions);
    const current = await value.repository.getConnection(value.connection.id);
    const legacy = (current?.config.modelCatalogModels as ModelDescriptor[]).find(model => model.id === "fixture-0");
    expect(legacy?.metadata?.catalogMembershipVerified).toBe(false);
    expect(legacy?.metadata?.canvasRunnable).toBe(false);
    expect(current?.config.defaultModel).toBe("fixture-1"); service.close();
  });
  it("keeps the legacy aggregate failure counter as history without inventing failures for each new source", async () => {
    const value = await fixture();
    await value.repository.saveConnection({ ...value.connection, config: { ...value.connection.config,
      catalogCheckFailureStreak: 2, catalogCheckPaused: false, catalogCheckLastResult: "failed" } });
    value.setStatus(401);
    const service = value.service(); await service.run(value.connection.id, runOptions);
    const state = await value.state(), scheduler = state.entries[CATALOG_SCHEDULER_ENTRY] as CatalogSchedulerState;
    expect(Object.values(scheduler.sources)).toHaveLength(1);
    expect(Object.values(scheduler.sources)[0]).toMatchObject({ failureStreak: 1, paused: false });
    expect(state.entries["legacy:connection:connection"]).toMatchObject({ legacy: { catalogCheckFailureStreak: 2 } });
    service.close();
  });
  it("is fully inert outside the internal ephemeral gate", async () => {
    const value = await fixture();
    const service = createCatalogPipelineService({ environment: {}, repository: value.repository, readers: value.readers, clock: value.timer.clock });
    expect(await service.run(value.connection.id, runOptions)).toMatchObject({ enabled: false, published: 0 });
    expect(value.readers).not.toHaveBeenCalled(); expect(value.fetcher).not.toHaveBeenCalled();
    expect(await value.state()).toBeUndefined(); service.close();
  });
  it("commits normalized fact, queue result, source sequence and membership together", async () => {
    const value = await fixture(), service = value.service();
    expect(await service.run(value.connection.id, runOptions)).toMatchObject({ published: 1, pending: 0 });
    expect(value.fetcher).toHaveBeenCalledTimes(1);
    const state = await value.state(), scheduler = state.entries[CATALOG_SCHEDULER_ENTRY] as CatalogSchedulerState;
    expect(state.nextDispatchSeq).toBe(2); expect(Object.values(state.sources)[0]?.lastAcceptedSeq).toBe(1);
    const job = Object.values(scheduler.jobs)[0]!;
    expect(job.status).toBe("completed"); expect(job.resultRef).toBeTruthy(); expect(state.entries[job.resultRef!]).toBeTruthy();
    expect((state.entries["membership:connection"] as CatalogInventoryState).visibleModels).toHaveLength(3);
    expect((await value.repository.getConnection(value.connection.id))?.config.defaultModel).toBe("fixture-1");
    service.close(); expect(value.timer.timerCount).toBe(0);
  });
  it("does not repeat completed reads after restart or duplicate POST in the same cycle", async () => {
    const value = await fixture(), first = value.service();
    const [a, b] = await Promise.all([first.run(value.connection.id, runOptions), first.run(value.connection.id, runOptions)]);
    expect(a).toEqual(b); first.close();
    const restarted = value.service(); await restarted.run(value.connection.id, runOptions);
    expect(value.fetcher).toHaveBeenCalledTimes(1); expect((await value.state()).nextDispatchSeq).toBe(2); restarted.close();
  });
  it("resumes an undispatched sibling after host spacing without replaying the completed source", async () => {
    const value = await fixture(true), first = value.service();
    expect(await first.run(value.connection.id, runOptions)).toMatchObject({ published: 1, pending: 1 }); first.close();
    const partial = await value.state(); expect((partial.entries["membership:connection"] as CatalogInventoryState).visibleModels).toHaveLength(3);
    value.timer.advance(2_000);
    const restarted = value.service(); expect(await restarted.run(value.connection.id, runOptions)).toMatchObject({ published: 1, pending: 0 });
    expect(value.fetcher).toHaveBeenCalledTimes(2);
    const state = await value.state(), membership = state.entries["membership:connection"] as CatalogInventoryState;
    expect(membership.visibleModels).toHaveLength(4);
    expect((await value.repository.getConnection(value.connection.id))?.config.modelScanComplete).toBe(true);
    expect(Object.values((state.entries[CATALOG_SCHEDULER_ENTRY] as CatalogSchedulerState).jobs).every(job => job.status === "completed")).toBe(true);
    restarted.close();
  });
  it("holds connection removals until every required source in that cycle finishes", async () => {
    const value = await fixture(true), service = value.service();
    await service.run(value.connection.id, runOptions); value.timer.advance(2_000); await service.run(value.connection.id, runOptions);
    value.setData(rows(1)); value.timer.advance(24 * 60 * 60_000);
    const next = { ...runOptions, observationCycleId: "cycle-1" };
    await service.run(value.connection.id, next);
    expect((await value.repository.getConnection(value.connection.id))?.config.modelCatalogModels).toHaveLength(4);
    value.timer.advance(2_000); await service.run(value.connection.id, next);
    expect((await value.repository.getConnection(value.connection.id))?.config.modelCatalogModels).toHaveLength(2);
    service.close();
  });
  it("does not retry a dispatched failure or unknown result on the same day", async () => {
    const value = await fixture(), first = value.service(); value.setStatus(500);
    await first.run(value.connection.id, runOptions); first.close(); value.timer.advance(CATALOG_JOB_LEASE_MS + 1);
    const restarted = value.service(); await restarted.run(value.connection.id, { ...runOptions, observationCycleId: "same-day-new-post" });
    expect(value.fetcher).toHaveBeenCalledTimes(1);
    const connection = await value.repository.getConnection(value.connection.id);
    expect((connection?.config.modelCatalogModels as ModelDescriptor[]).map(model => model.id)).toEqual(rows(2).map(model => model.id));
    expect(connection?.config.defaultModel).toBe("fixture-1"); restarted.close();
  });
  it("keeps two source candidates across task boundaries until three independent daily cycles", async () => {
    const value = await fixture(true), service = value.service(); value.setData(rows(100)); value.setNativeData(rows(100, "native-"));
    async function finishCycle(day: number) {
      const options = { ...runOptions, observationCycleId: `cycle-${day}` };
      await service.run(value.connection.id, options); value.timer.advance(2_000); await service.run(value.connection.id, options);
    }
    await finishCycle(0); value.setData(rows(40)); value.setNativeData(rows(40, "native-"));
    for (const day of [1, 2, 3]) {
      value.timer.advance(24 * 60 * 60_000); await finishCycle(day);
      const state = await value.state(), inventory = state.entries["membership:connection"] as CatalogInventoryState;
      expect(inventory.visibleModels).toHaveLength(day === 3 ? 80 : 200);
      if (day < 3) expect(Object.values(inventory.sources).map(source => source.candidate?.countedCycles.length)).toEqual([day, day]);
    }
    expect(value.fetcher).toHaveBeenCalledTimes(8); service.close();
  });
  it("retains historical display on explicit Key auth failure while denying current availability", async () => {
    const value = await fixture(), service = value.service(); value.setStatus(401);
    await service.run(value.connection.id, runOptions);
    const connection = await value.repository.getConnection(value.connection.id);
    expect(connection?.config.modelScanStatus).toBe("unauthorized");
    expect((connection?.config.modelCatalogModels as ModelDescriptor[]).map(model => model.id)).toEqual(rows(2).map(model => model.id));
    expect(connection?.config.defaultModel).toBe("fixture-1"); service.close();
  });
  it("keeps one required-source cohort across a host delay longer than a day and changing POST cycle IDs", async () => {
    const value = await fixture(true), service = value.service();
    await service.run(value.connection.id, runOptions); value.timer.advance(2_000); await service.run(value.connection.id, runOptions);
    value.setData(rows(1)); value.timer.advance(24 * 60 * 60_000);
    value.setStatus(429); value.setRetryAfter(String(26 * 60 * 60));
    await service.run(value.connection.id, { ...runOptions, observationCycleId: "first-shrink-cycle" });
    expect(value.fetcher).toHaveBeenCalledTimes(3);
    value.setStatus(200); value.setRetryAfter(); value.timer.advance(26 * 60 * 60_000);
    await service.run(value.connection.id, { ...runOptions, observationCycleId: "post-after-midnight" });
    expect(value.fetcher).toHaveBeenCalledTimes(4);
    expect(String(value.fetcher.mock.calls[3]![0])).toMatch(/\/native$/u);
    let state = await value.state();
    const firstFacts = Object.entries(state.entries).filter(([key]) => key.startsWith("fact:")).map(([, row]) => row as {
      receipt: { context: { observationCycleId: string } } });
    expect(firstFacts.every(row => row.receipt.context.observationCycleId === "first-shrink-cycle")).toBe(true);
    expect((await value.repository.getConnection(value.connection.id))?.config.modelCatalogModels).toHaveLength(4);
    // A is due now, B is not: a new POST cannot split them into different new cycles.
    await service.run(value.connection.id, { ...runOptions, observationCycleId: "post-before-b-due" });
    expect(value.fetcher).toHaveBeenCalledTimes(4);
    value.timer.advance(24 * 60 * 60_000);
    await service.run(value.connection.id, { ...runOptions, observationCycleId: "next-cohort" });
    value.timer.advance(2_000);
    await service.run(value.connection.id, { ...runOptions, observationCycleId: "different-post-id" });
    expect(value.fetcher).toHaveBeenCalledTimes(6);
    state = await value.state();
    const finalFacts = Object.entries(state.entries).filter(([key]) => key.startsWith("fact:")).map(([, row]) => row as {
      receipt: { context: { observationCycleId: string } } });
    expect(finalFacts.every(row => row.receipt.context.observationCycleId === "next-cohort")).toBe(true);
    expect((await value.repository.getConnection(value.connection.id))?.config.modelScanComplete).toBe(true);
    expect((await value.repository.getConnection(value.connection.id))?.config.modelCatalogModels).toHaveLength(2); service.close();
  });
  it("keeps all network and namespace writes off when automatic checks are disabled", async () => {
    const value = await fixture(); await value.repository.setApplicationSetting("supplierCatalogCheckMode", "off");
    const service = value.service(); await service.run(value.connection.id, runOptions);
    expect(value.fetcher).not.toHaveBeenCalled(); expect(value.readers).not.toHaveBeenCalled(); expect(await value.state()).toBeUndefined(); service.close();
  });
  it.each(["fixture-group", "different-group"])("does not relabel another Key's private schema as a sibling contract: %s", async groupId => {
    const value = await fixture(false, true), service = value.service();
    await service.run(value.connection.id, runOptions); value.timer.advance(2_000); await service.run(value.connection.id, runOptions);
    const a = await value.repository.getConnection(value.connection.id);
    expect((a?.config.modelCatalogModels as ModelDescriptor[]).find(model => model.id === "fixture-0")?.metadata?.canvasRunnable).toBe(true);
    const sibling = await value.repository.saveConnection({ ...value.connection, id: "connection-b", name: "Sibling fixture Key", encryptedSecret: "encrypted-fixture-b",
      config: { ...value.connection.config, accountKeyGroupId: groupId, fixturePrivateSchema: false } });
    value.timer.advance(2_000); await service.run(sibling.id, runOptions);
    const b = await value.repository.getConnection(sibling.id), connector = b?.config.connector as {
      modelOverrides?: Record<string, { submit?: { path?: string } }> } | undefined;
    expect((b?.config.modelCatalogModels as ModelDescriptor[]).find(model => model.id === "fixture-0")?.metadata?.canvasRunnable).toBe(false);
    expect(connector?.modelOverrides?.["fixture-0"]?.submit?.path).not.toBe("/private-submit"); service.close();
  });
  it("restores runnable status immediately after a fresh complete Key success, using its saved valid contract", async () => {
    const value = await fixture(false, true), service = value.service();
    await service.run(value.connection.id, runOptions); value.timer.advance(2_000); await service.run(value.connection.id, runOptions);
    value.timer.advance(24 * 60 * 60_000); value.setStatus(401);
    await service.run(value.connection.id, { ...runOptions, observationCycleId: "auth-failed-cycle" });
    expect((await value.repository.getConnection(value.connection.id))?.config.modelScanStatus).toBe("unauthorized");
    value.timer.advance(24 * 60 * 60_000); value.setStatus(200);
    await service.run(value.connection.id, { ...runOptions, observationCycleId: "auth-restored-cycle" });
    const connection = await value.repository.getConnection(value.connection.id);
    expect(connection?.config.modelScanStatus).toBe("live");
    expect((connection?.config.modelCatalogModels as ModelDescriptor[]).find(model => model.id === "fixture-0")?.metadata?.canvasRunnable).toBe(true);
    service.close();
  });
  it("does not reuse a private automatic contract after the Key identity changes", async () => {
    const value = await fixture(false, true), service = value.service();
    await service.run(value.connection.id, runOptions); value.timer.advance(2_000); await service.run(value.connection.id, runOptions);
    const before = (await value.repository.getConnection(value.connection.id))!;
    expect((before.config.modelCatalogModels as ModelDescriptor[])[0]?.metadata?.canvasRunnable).toBe(true);
    await value.repository.saveConnection({ ...before, encryptedSecret: "new-encrypted-fixture",
      config: { ...before.config, fixturePrivateSchema: false } });
    value.timer.advance(2_000);
    await service.run(value.connection.id, { ...runOptions, mode: "manual", observationCycleId: "changed-key-explicit-refresh" });
    const after = await value.repository.getConnection(value.connection.id);
    expect(after?.config.modelScanStatus).toBe("live");
    expect((after?.config.modelCatalogModels as ModelDescriptor[])[0]?.metadata?.canvasRunnable).toBe(false);
    expect(after?.config.defaultModel).toBe("fixture-1"); service.close();
  });
  it("reads one shared public schema once and projects it to applicable same-group sibling Keys", async () => {
    const value = await fixture(false, false, true), service = value.service();
    await service.run(value.connection.id, runOptions); value.timer.advance(2_000); await service.run(value.connection.id, runOptions);
    const sibling = await value.repository.saveConnection({ ...value.connection, id: "connection-b", name: "Same-group fixture sibling",
      encryptedSecret: "encrypted-fixture-b" });
    value.timer.advance(2_000); await service.run(sibling.id, runOptions);
    const b = await value.repository.getConnection(sibling.id), connector = b?.config.connector as {
      modelOverrides?: Record<string, { submit?: { path?: string } }> } | undefined;
    expect(value.fetcher.mock.calls.filter(([url]) => String(url).endsWith("/public-schema"))).toHaveLength(1);
    expect(value.fetcher).toHaveBeenCalledTimes(3);
    expect((b?.config.modelCatalogModels as ModelDescriptor[]).find(model => model.id === "fixture-0")?.metadata?.canvasRunnable).toBe(true);
    expect(connector?.modelOverrides?.["fixture-0"]?.submit?.path).toBe("/public-submit"); service.close();
  });
  it("confirms an exact saved shrink candidate locally without reading credentials or sending HTTP", async () => {
    const value = await fixture(), service = value.service(); value.setData(rows(100));
    await service.run(value.connection.id, runOptions);
    value.timer.advance(24 * 60 * 60_000); value.setData(rows(40));
    await service.run(value.connection.id, { ...runOptions, observationCycleId: "candidate-cycle" });
    const inventory = (await value.state()).entries["membership:connection"] as CatalogInventoryState;
    const source = Object.values(inventory.sources)[0]!;
    expect(source.candidate).toBeTruthy();
    const requests = value.fetcher.mock.calls.length, credentials = value.readers.mock.calls.length;
    await service.run(value.connection.id, { ...runOptions, mode: "manual", observationCycleId: "confirm-only",
      manualConfirmation: { sourceKey: source.sourceKey, candidateVersion: source.candidate!.version } });
    expect(value.fetcher).toHaveBeenCalledTimes(requests); expect(value.readers).toHaveBeenCalledTimes(credentials);
    expect((await value.repository.getConnection(value.connection.id))?.config.modelCatalogModels).toHaveLength(40);
    service.close();
  });
  it("does not move a shared public contract's relative paths to a different API origin", async () => {
    const value = await fixture(false, false, true), service = value.service();
    await service.run(value.connection.id, runOptions); value.timer.advance(2_000); await service.run(value.connection.id, runOptions);
    const sibling = await value.repository.saveConnection({ ...value.connection, id: "connection-b", name: "Different-origin fixture sibling",
      encryptedSecret: "encrypted-fixture-b", config: { ...value.connection.config, baseUrl: "https://other-api.invalid/v1" } });
    value.timer.advance(2_000); await service.run(sibling.id, runOptions);
    const b = await value.repository.getConnection(sibling.id);
    expect(value.fetcher.mock.calls.filter(([url]) => String(url).endsWith("/public-schema"))).toHaveLength(1);
    expect((b?.config.modelCatalogModels as ModelDescriptor[]).find(model => model.id === "fixture-0")?.metadata?.canvasRunnable).toBe(false);
    service.close();
  });
  it("blocks automatic continuation after only supplier account credentials change and rotates on explicit refresh", async () => {
    const value = await fixture(false, true), service = value.service();
    await service.run(value.connection.id, runOptions); value.timer.advance(2_000); await service.run(value.connection.id, runOptions);
    const before = await value.repository.getApplicationSetting(catalogPipelineSettingKey(value.supplier.id)) as CatalogPipelineState;
    const supplier = (await value.repository.getSupplier(value.supplier.id))!;
    await value.repository.saveSupplier({ ...supplier, state: { ...supplier.state!, siteLogin: { authMode: "password", username: "fixture-new-account",
      encryptedPassword: "encrypted-fixture-password", siteUrl: supplier.siteUrl } } });
    value.timer.advance(2_000);
    const requests = value.fetcher.mock.calls.length, credentials = value.readers.mock.calls.length;
    expect(await service.run(value.connection.id, { ...runOptions, observationCycleId: "account-changed-auto" })).toMatchObject({ superseded: 1, published: 0 });
    expect(value.fetcher).toHaveBeenCalledTimes(requests); expect(value.readers).toHaveBeenCalledTimes(credentials);
    expect((await value.repository.getApplicationSetting(catalogPipelineSettingKey(value.supplier.id)) as CatalogPipelineState).identityEpoch).toBe(before.identityEpoch);
    await service.run(value.connection.id, { ...runOptions, mode: "manual", observationCycleId: "account-changed-explicit-refresh", budget: 1 });
    const after = await value.repository.getApplicationSetting(catalogPipelineSettingKey(value.supplier.id)) as CatalogPipelineState;
    expect(after.identityEpoch).not.toBe(before.identityEpoch);
    expect((await value.repository.getConnection(value.connection.id))?.config.defaultModel).toBe("fixture-1"); service.close();
  });
  it("rejects candidate confirmation when a later consumed attempt expired before any fact was saved", async () => {
    const value = await fixture(), service = value.service(); value.setData(rows(100));
    await service.run(value.connection.id, runOptions); value.timer.advance(24 * 60 * 60_000); value.setData(rows(40));
    await service.run(value.connection.id, { ...runOptions, observationCycleId: "candidate-cycle" });
    const saved = await value.repository.getApplicationSetting(catalogPipelineSettingKey(value.supplier.id)) as CatalogPipelineState;
    const inventory = saved.entries["membership:connection"] as unknown as CatalogInventoryState;
    const source = Object.values(inventory.sources)[0]!, candidateVersion = source.candidate!.version;
    const scheduler = saved.entries[CATALOG_SCHEDULER_ENTRY] as unknown as CatalogSchedulerState;
    const spec = Object.values(scheduler.jobs)[0]!.spec;
    value.timer.advance(24 * 60 * 60_000);
    const connection = (await value.repository.getConnection(value.connection.id))!, supplier = (await value.repository.getSupplier(value.supplier.id))!;
    const identity = catalogObservationIdentity(supplier, [connection]);
    await value.repository.reserveCatalogObservation({ identity, sourceKey: source.sourceKey, expectedMode: "daily", observationCycleId: "crashed-later-cycle" });
    const queued = enqueueCatalogReadJobs(scheduler, [spec], { now: value.timer.clock.now(), mode: "daily", identityEpoch: saved.identityEpoch,
      observationCycleId: "crashed-later-cycle", revision: "fixture-revision", sessionStartedAt: value.timer.clock.now() - 60_000 });
    const claimed = claimCatalogReadJob(queued.state, queued.jobIds[0]!, { now: value.timer.clock.now(), owner: "crashed-fixture-owner",
      mode: "daily", draining: false, identityEpoch: saved.identityEpoch });
    expect(claimed.claimed).toBe(true);
    await value.repository.updateCatalogPipelineState({ identity, expectedMode: "daily", expectedIdentityEpoch: saved.identityEpoch,
      state: [{ key: CATALOG_SCHEDULER_ENTRY, expected: scheduler as unknown as JsonObject, value: claimed.state as unknown as JsonObject }] });
    value.timer.advance(CATALOG_JOB_LEASE_MS + 1);
    const requests = value.fetcher.mock.calls.length, credentials = value.readers.mock.calls.length;
    expect(await service.run(value.connection.id, { ...runOptions, mode: "manual", observationCycleId: "confirm-before-recovery",
      manualConfirmation: { sourceKey: source.sourceKey, candidateVersion } })).toMatchObject({ superseded: 1, published: 0 });
    expect(value.fetcher).toHaveBeenCalledTimes(requests); expect(value.readers).toHaveBeenCalledTimes(credentials);
    expect((await value.repository.getConnection(value.connection.id))?.config.modelCatalogModels).toHaveLength(100); service.close();
  });
  it("lets a same-supplier sibling on another API host finish while the first HTTP is still pending", async () => {
    const value = await fixture(), service = value.service();
    const sibling = await value.repository.saveConnection({ ...value.connection, id: "connection-b", name: "Concurrent fixture sibling",
      encryptedSecret: "encrypted-fixture-b", config: { ...value.connection.config, baseUrl: "https://other-api.invalid/v1" } });
    let entered!: () => void, release!: () => void;
    const firstStarted = new Promise<void>(resolve => { entered = resolve; });
    const firstHeld = new Promise<void>(resolve => { release = resolve; });
    value.fetcher.mockImplementation(async url => {
      if (new URL(String(url)).hostname === "fixture.invalid") { entered(); await firstHeld; return Response.json({ models: rows(3) }); }
      return Response.json({ models: rows(3, "sibling-") });
    });
    const a = service.run(value.connection.id, runOptions);
    try {
      await firstStarted;
      expect(await service.run(sibling.id, runOptions)).toMatchObject({ published: 1, pending: 0 });
      expect(value.fetcher).toHaveBeenCalledTimes(2);
      expect(((await value.repository.getConnection(sibling.id))?.config.modelCatalogModels as ModelDescriptor[]).map(model => model.id))
        .toEqual(rows(3, "sibling-").map(model => model.id));
      // A has not returned a receipt; only B may have accepted its source so far.
      expect(Object.values((await value.state()).sources).filter(source => source.lastAcceptedSeq > 0)).toHaveLength(1);
    } finally { release(); }
    expect(await a).toMatchObject({ published: 1, pending: 0 });
    const state = await value.state();
    expect(Object.values(state.sources).filter(source => source.lastAcceptedSeq > 0)).toHaveLength(2);
    expect((await value.repository.getConnection(value.connection.id))?.config.modelCatalogModels).toHaveLength(3);
    expect((await value.repository.getConnection(sibling.id))?.config.modelCatalogModels).toHaveLength(3);
    service.close();
  });
});


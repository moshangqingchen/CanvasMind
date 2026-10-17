import { rename, stat, mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { FileRepository, MemoryRepository, catalogPipelineSettingKey, type CatalogPipelineState, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { catalogScaleDocument, catalogScaleModels, catalogScaleSnapshot, CATALOG_SCALE_CONNECTIONS, CATALOG_SCALE_SUPPLIERS, CATALOG_SCALE_PUBLIC_MODELS } from "./catalog-pipeline-scale.fixture";
import type { CatalogReadTask } from "./catalog-read-task";
import type { CatalogCollectorDependencies } from "./catalog-read-collector";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import type { CatalogInventoryState } from "./catalog-inventory-policy";
import type { CatalogSchedulerClock } from "./catalog-scheduler-store";
import type { CatalogSchedulerState } from "./catalog-read-scheduler";
import { normalizeCatalogInterfaceDocument } from "./catalog-interface-document-compile";

vi.mock("./catalog-source-plan", async original => {
  const actual = await original<typeof import("./catalog-source-plan")>();
  return { ...actual, catalogSourcePlan(connection: ProviderConnectionRecord, supplier: SupplierRecord) {
    const scopes = actual.catalogConnectionScopes(connection, supplier), base = String(connection.config.baseUrl), origin = new URL(base).origin;
    return [actual.catalogReadItem("key-models", base + "/models", "key-membership", scopes.key, scopes.apply, true),
      ...(connection.config.scaleScenario === "member-source-failure" ? [actual.catalogReadItem("native-key-models", base + "/native", "key-membership", scopes.key, scopes.apply, true)] : []),
      actual.catalogReadItem("supplier-offers", origin + "/public", "catalog-offer", scopes.anonymous, scopes.apply),
      actual.catalogReadItem("schema-document:shared", origin + "/openapi.json", "schema", scopes.anonymous, scopes.apply)];
  } };
});
vi.mock("./catalog-read-task", () => ({ discoverCatalogModelTasks: () => [],
  async collectCatalogReadTask(task: CatalogReadTask, connection: ProviderConnectionRecord, _supplier: SupplierRecord | undefined, _models: ModelDescriptor[], deps: CatalogCollectorDependencies) {
    let response: Response;
    try { response = await deps.fetchFor(task.spec)!(task.spec.sourceUrl); } catch {
      return { discovered: [], observation: { receipt: { spec: task.spec, context: deps.context, status: "failed", complete: false, freshness: "live", checkedAt: deps.now!(), reason: "network" }, facts: { models: [] } } };
    }
    const value = await response.json() as {
      models?: ModelDescriptor[]; complete?: boolean; document?: unknown; priceStates?: CatalogReadObservation["facts"]["priceStates"];
    };
    const complete = response.ok && value.complete !== false, models = value.models ?? [];
    const normalized = value.document ? normalizeCatalogInterfaceDocument(value.document, String(connection.config.baseUrl), task.spec.sourceUrl) : undefined;
    return { discovered: [], observation: { receipt: { spec: task.spec, context: deps.context, status: response.ok ? "succeeded" : "failed",
      complete, freshness: "live", checkedAt: deps.now!(), coverage: { domain: task.spec.role === "key-membership" ? "key-list" : "offers", modelIds: models.map(model => model.id), exhaustive: complete },
      ...(!complete ? { reason: response.status === 401 ? "authentication" : response.status === 402 ? "balance" : response.status === 429 || response.status >= 500 ? "network" : "incomplete" } : {}),
      ...(!response.ok ? { httpStatus: response.status } : {}) }, facts: { models, ...(normalized ? { interfaceDocuments: [normalized], contractOrigin: normalized.apiOrigin } : {}),
        ...(value.priceStates ? { priceStates: value.priceStates } : {}),
        ...(complete && task.spec.role === "key-membership" ? { validatedMembershipModelIds: models.map(model => model.id) } : {}) } } };
  },
}));
import { CATALOG_SCHEDULER_ENTRY, createCatalogPipelineService } from "./catalog-pipeline-service";
const DAY = 86_400_000;
function fixtureClock() {
  let now = Date.parse("2001-01-02T00:00:00Z"), next = 1;
  const timers = new Map<number, () => void>();
  const clock: CatalogSchedulerClock = { now: () => now, setTimeout(fn, delay) { const id = next++, target = now + delay; timers.set(id, fn); queueMicrotask(() => { if (timers.delete(id)) { now = Math.max(now, target); fn(); } }); return id; }, clearTimeout(id) { timers.delete(Number(id)); } };
  return { clock, advance(ms: number) { now += ms; } };
}
function fixtureTransport(clock: CatalogSchedulerClock, scenarioPhase: () => number) {
  return vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input)), index = Number(/^scale-(\d+)\./u.exec(url.host)?.[1]), phase = scenarioPhase();
    const scenario = ["partial-price", "auxiliary-failure", "aggregate-incomplete", "member-source-failure", "hard-truncation", "soft-drop", "authentication", "balance", "upstream", "rate-limited"][index];
    const at = new Date(clock.now()).toISOString(), isKey = url.pathname.endsWith("/models"), isNative = url.pathname.endsWith("/native"), isDocument = url.pathname.endsWith(".json");
    if (phase > 0 && (scenario === "authentication" || scenario === "balance" || scenario === "upstream" || scenario === "rate-limited") && isKey)
      return Response.json({ models: [] }, { status: scenario === "authentication" ? 401 : scenario === "balance" ? 402 : scenario === "upstream" ? 503 : 429,
        ...(scenario === "rate-limited" ? { headers: { "Retry-After": new Date(clock.now() + 48 * 60 * 60_000).toUTCString() } } : {}) });
    if (phase > 0 && (scenario === "auxiliary-failure" && isDocument || scenario === "member-source-failure" && isNative)) return Response.json({ models: [] }, { status: 503 });
    if (isDocument) return Response.json({ document: catalogScaleDocument(index) });
    if (url.pathname === "/public" && phase > 0 && scenario === "aggregate-incomplete") return Response.json({ models: catalogScaleModels(index, 20, at), complete: false });
    let count = isNative ? 4 : isKey ? 64 : CATALOG_SCALE_PUBLIC_MODELS;
    if (phase > 0 && isKey && ["partial-price", "aggregate-incomplete", "member-source-failure"].includes(scenario ?? "")) count = 65;
    if (phase > 0 && isKey && scenario === "soft-drop") count = 12;
    if (phase > 0 && isKey && scenario === "hard-truncation") count = 8;
    const models = catalogScaleModels(index, count, at);
    if (phase > 0 && scenario === "partial-price") models.slice(0, 32).forEach(model => { delete model.pricing; });
    if (scenario === "never-published" || index === 13) models.forEach(model => { delete model.pricing; });
    if (phase > 0 && index === 14) models.forEach(model => { if (model.pricing) model.pricing.unitAmount = .9; });
    if (phase > 0 && index === 15) models.forEach(model => { delete model.pricing; });
    return Response.json({ models, ...(phase > 0 && isKey && scenario === "hard-truncation" ? { complete: false } : {}),
      ...(phase > 0 && index === 15 ? { priceStates: models.map(model => ({ modelId: model.id, state: "explicit-unpublished" })) } : {}) });
  });
}
const stateFor = async (repository: MemoryRepository, supplierId: string) => await repository.getApplicationSetting(catalogPipelineSettingKey(supplierId)) as CatalogPipelineState;
async function sweep(service: ReturnType<typeof createCatalogPipelineService>, ids: string[], timer: ReturnType<typeof fixtureClock>, cycle: string, repository: MemoryRepository) {
  const runIds = async (targets: string[]) => {
    for (let offset = 0; offset < targets.length; offset += 2) {
      timer.advance(2_500);
      await Promise.all(targets.slice(offset, offset + 2).map(id => service.run(id, { observationCycleId: cycle, revision: "scale-revision", budget: 32 })));
      await new Promise<void>(done => setImmediate(done));
    }
  };
  const pendingOwners = async () => {
    const targets = new Set<string>(), allowed = new Set(ids);
    for (const supplierId of new Set(ids.map(id => id.replace(/-key-\d+$/u, "")))) {
      const state = await repository.getCatalogPipelineState(supplierId, [CATALOG_SCHEDULER_ENTRY]);
      const scheduler = state?.entries[CATALOG_SCHEDULER_ENTRY] as unknown as CatalogSchedulerState | undefined;
      for (const job of Object.values(scheduler?.jobs ?? {})) {
        const host = scheduler?.hosts[new URL(job.spec.sourceUrl).host];
        if (["queued", "deferred"].includes(job.status) && Math.max(job.nextAttemptEligibleAt, host?.cooldownUntil ?? 0, host?.nextStartAt ?? 0) <= timer.clock.now() + 5_000)
          job.spec.applyScope.connectionIds.filter(id => allowed.has(id)).forEach(id => targets.add(id));
      }
    }
    return [...targets];
  };
  // Initialize each namespace, then retain same-owner concurrent starts.
  for (const id of ids.filter(id => id.endsWith("-key-0"))) { timer.advance(2_500); await service.run(id, { observationCycleId: cycle, revision: "scale-revision" }); }
  await runIds(ids);
  for (let round = 0; round < 8; round++) {
    const targets = await pendingOwners(); if (!targets.length) break;
    await runIds(targets);
  }
  expect(await pendingOwners()).toEqual([]);
  // Every target receives the latest shared declarations locally, with no new read.
  await runIds(ids);
}
const quantile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;

describe("16 supplier / 131 Key isolated catalog scale", () => {
  it("keeps inherited due and pause eligibility instead of rescanning all connections during takeover", async () => {
    for (const paused of [false, true]) {
      const repository = new MemoryRepository(catalogScaleSnapshot({ futureDue: true, paused })), timer = fixtureClock();
      // The active case is only 6h old; paused connections remain stopped even after 48h.
      const snapshot = repository.exportSnapshot();
      for (const connection of snapshot.connections) connection.config.catalogCheckAttemptedAt = new Date(timer.clock.now() - (paused ? 48 : 6) * 60 * 60_000).toISOString();
      const migrated = new MemoryRepository(snapshot), transport = fixtureTransport(timer.clock, () => 0);
      const service = createCatalogPipelineService({ environment: {}, repository: migrated, clock: timer.clock, sessionStartedAt: timer.clock.now() - 60_000,
        readers: async () => ({ apiKey: "fictional", fetchFor: () => transport }) });
      for (const connection of snapshot.connections) await service.run(connection.id, { observationCycleId: "migration", revision: "scale-revision" });
      expect(transport).not.toHaveBeenCalled();
      expect(await migrated.listConnections()).toHaveLength(CATALOG_SCALE_CONNECTIONS); service.close();
    }
  }, 120_000);
  it("publishes independent facts at scale, retains unsafe removals, shares documents once and remains bounded over daily cycles", async () => {
    const repository = new MemoryRepository(catalogScaleSnapshot()), timer = fixtureClock(); let phase = 0;
    const transport = fixtureTransport(timer.clock, () => phase), service = createCatalogPipelineService({ environment: {}, repository, clock: timer.clock,
      sessionStartedAt: timer.clock.now() - 60_000, random: () => .5, readers: async () => ({ apiKey: "fictional", fetchFor: () => transport }) });
    const connections = await repository.listConnections(), ids = connections.map(connection => connection.id), sizes: number[] = [], totalSizes: number[] = [], counts: number[] = [];
    if (process.env.CATALOG_SCALE_PROFILE === "1") {
      const { Session } = await import("node:inspector"), session = new Session(); session.connect();
      const post = (method: string) => new Promise<Record<string, unknown>>((done, reject) => session.post(method, (error, result) => error ? reject(error) : done(result as Record<string, unknown>)));
      await post("Profiler.enable"); await post("Profiler.start"); const started = performance.now();
      await sweep(service, ids.filter(id => id.startsWith("scale-supplier-0-")), timer, "profile-cycle", repository);
      const result = await post("Profiler.stop"); session.disconnect(); service.close();
      if (process.env.CATALOG_SCALE_EVIDENCE) {
        const label = process.env.CATALOG_SCALE_PROFILE_LABEL ?? "single-owner";
        if (!/^[a-z0-9-]+$/u.test(label)) throw new Error("Invalid diagnostic label");
        await writeFile(resolve(process.env.CATALOG_SCALE_EVIDENCE, label + ".cpuprofile"), JSON.stringify(result.profile));
        await writeFile(resolve(process.env.CATALOG_SCALE_EVIDENCE, label + "-meta.json"), JSON.stringify({ diagnosticOnly: true, oneOwnerKeys: 9, elapsedMs: performance.now() - started, calls: transport.mock.calls.length, supplierStateBytes: Buffer.byteLength(JSON.stringify(await stateFor(repository, "scale-supplier-0"))) }, null, 2));
      }
      console.info(JSON.stringify({ diagnosticOnly: true, oneOwnerKeys: 9, elapsedMs: performance.now() - started, calls: transport.mock.calls.length }));
      expect(transport.mock.calls.length).toBeGreaterThan(0); return;
    }
    expect(await repository.listSuppliers()).toHaveLength(CATALOG_SCALE_SUPPLIERS); expect(ids).toHaveLength(CATALOG_SCALE_CONNECTIONS);
    for (let cycle = 0; cycle < 4; cycle++) {
      phase = cycle; if (cycle) timer.advance(DAY + 1000);
      const before = transport.mock.calls.length, began = performance.now();
      await sweep(service, ids, timer, "scale-cycle-" + cycle, repository);
      counts.push(transport.mock.calls.length - before);
      console.info(JSON.stringify({ scaleCycle: cycle, elapsedMs: performance.now() - began, calls: counts.at(-1) }));
      const state = await stateFor(repository, "scale-supplier-0"); sizes.push(Buffer.byteLength(JSON.stringify(state)));
      if (process.env.CATALOG_SCALE_EVIDENCE) await writeFile(resolve(process.env.CATALOG_SCALE_EVIDENCE, "scale-progress.json"), JSON.stringify({ completedCycle: cycle, callsPerCycle: counts, supplierStateBytesPerCycle: sizes }, null, 2));
      let totalBytes = 0;
      for (const supplier of await repository.listSuppliers()) {
        const bytes = Buffer.byteLength(JSON.stringify(await stateFor(repository, supplier.id))); totalBytes += bytes;
        expect(bytes).toBeLessThan(8 * 1024 * 1024);
      }
      totalSizes.push(totalBytes);
      if (process.env.CATALOG_SCALE_EVIDENCE) await writeFile(resolve(process.env.CATALOG_SCALE_EVIDENCE, "scale-progress.json"), JSON.stringify({ completedCycle: cycle, callsPerCycle: counts, supplierStateBytesPerCycle: sizes, totalStateBytesPerCycle: totalSizes }, null, 2));
      for (const index of [3, 4]) {
        const connection = await repository.getConnection("scale-supplier-" + index + "-key-0");
        expect((connection?.config.modelCatalogModels as ModelDescriptor[]).length).toBeGreaterThanOrEqual(64);
        expect((await stateFor(repository, "scale-supplier-" + index)).entries["membership:" + connection!.id]).toMatchObject({ historicalModels: [] });
      }
      const noBorrow = await repository.getConnection("scale-supplier-12-key-7");
      expect((noBorrow?.config.modelCatalogModels as ModelDescriptor[]).every(model => model.id.startsWith("fixture-12-"))).toBe(true);
      expect((noBorrow?.config.modelCatalogModels as ModelDescriptor[]).length).toBe(64);
    }
    expect(counts[0]).toBe(171);
    const firstDoc = transport.mock.calls.filter(([input]) => String(input) === "https://scale-12.invalid/openapi.json"); expect(firstDoc).toHaveLength(4);
    const soft = await stateFor(repository, "scale-supplier-5"), softInventory = soft.entries["membership:scale-supplier-5-key-0"] as unknown as CatalogInventoryState;
    expect(softInventory.visibleModels).toHaveLength(12); expect(softInventory.historicalModels).toHaveLength(52);
    const hard = await stateFor(repository, "scale-supplier-4"), hardInventory = hard.entries["membership:scale-supplier-4-key-0"] as unknown as CatalogInventoryState;
    expect(hardInventory.visibleModels).toHaveLength(64); expect(hardInventory.historicalModels).toHaveLength(0);
    const auth = await stateFor(repository, "scale-supplier-6"), scheduler = auth.entries[CATALOG_SCHEDULER_ENTRY] as unknown as CatalogSchedulerState;
    expect(Object.values(scheduler.sources).filter(source => source.paused)).toHaveLength(8);
    const byIndex = async (index: number) => (await repository.getConnection("scale-supplier-" + index + "-key-0"))!;
    const modelAt = (connection: ProviderConnectionRecord) => (connection.config.modelCatalogModels as ModelDescriptor[])[0]!;
    expect(modelAt(await byIndex(0)).metadata?.priceStatus).toBe("partial");
    expect(modelAt(await byIndex(0)).pricing?.checkedAt).not.toBe(new Date(timer.clock.now()).toISOString());
    expect((await byIndex(1)).config.modelScanStatus).toBe("live");
    expect((await byIndex(2)).config.modelScanStatus).toBe("live");
    for (const index of [0, 2, 3]) expect((await byIndex(index)).config.scannedModelIds).toContain("fixture-" + index + "-full-model-64");
    expect(((await byIndex(0)).config.modelCatalogModels as ModelDescriptor[]).find(model => model.id.endsWith("-64"))?.pricing?.unitAmount).toBe(.1);
    expect((await byIndex(6)).config.modelScanStatus).toBe("unauthorized");
    expect(modelAt(await byIndex(13)).pricing).toBeUndefined();
    expect(modelAt(await byIndex(14)).pricing?.unitAmount).toBe(.9);
    expect(modelAt(await byIndex(14)).metadata?.measuredPrice).toEqual({ requestId: "fictional-request-14", amount: .21,
      currency: "CNY", parameters: { quality: "high" }, checkedAt: "2001-01-01T00:00:00.000Z" });
    expect(modelAt(await byIndex(15)).pricing).toBeUndefined();
    expect(Math.abs(sizes[3]! - sizes[2]!)).toBeLessThan(128 * 1024);
    expect(totalSizes[3]!).toBeLessThan(totalSizes[2]! * 1.25);
    expect(JSON.stringify(repository.exportSnapshot())).not.toContain('"apiKey"');
    service.close();
    const filledDirectory = resolve(process.cwd(), "../../../.codex-temp/catalog-slice3-scale"); await mkdir(filledDirectory, { recursive: true });
    await writeFile(resolve(filledDirectory, "filled-snapshot.json"), JSON.stringify(repository.exportSnapshot()));
    await writeFile(resolve(filledDirectory, "filled-snapshot-meta.json"), JSON.stringify({ fixtureOnly: true, suppliers: 16, connections: 131, clockNow: timer.clock.now(), cycles: 4, keyModels: 64, publicModels: 512 }));
    if (process.env.CATALOG_SCALE_EVIDENCE) { await mkdir(resolve(process.env.CATALOG_SCALE_EVIDENCE), { recursive: true });
      await writeFile(resolve(process.env.CATALOG_SCALE_EVIDENCE, "scale-memory.json"), JSON.stringify({ fixture: { suppliers: 16, connections: 131, keyModels: 64, publicModelsPerSupplier: 512 },
        callsPerCycle: counts, supplierStateBytesPerCycle: sizes, totalStateBytesPerCycle: totalSizes, actualUpstreamRequests: 0 }, null, 2)); }
  }, 600_000);
  it("keeps a same-field manual refresh that lands while a 131-connection fixture read is in flight", async () => {
    const repository = new MemoryRepository(catalogScaleSnapshot()), timer = fixtureClock(); let race = false;
    const target = "scale-supplier-11-key-0", underlying = fixtureTransport(timer.clock, () => 0);
    const transport: typeof fetch = async (input, init) => {
      const response = await underlying(input, init);
      if (race && String(input) === "https://scale-11.invalid/v1/models") {
        race = false;
        const current = (await repository.getConnection(target))!, models = structuredClone(current.config.modelCatalogModels) as ModelDescriptor[];
        models[0]!.pricing = { kind: "per-image", currency: "CNY", billingUnit: "image", unitAmount: .777, confidence: "exact", checkedAt: new Date(timer.clock.now()).toISOString() };
        models[0]!.metadata = { ...models[0]!.metadata, priceSource: "manual" };
        await repository.saveConnection({ ...current, config: { ...current.config, modelCatalogModels: models, modelScanComplete: true,
          modelScanCheckedAt: new Date(timer.clock.now()).toISOString() } });
      }
      return response;
    };
    const service = createCatalogPipelineService({ environment: {}, repository, clock: timer.clock, sessionStartedAt: timer.clock.now() - 60_000,
      random: () => .5, readers: async () => ({ apiKey: "fictional", fetchFor: () => transport }) });
    for (let pass = 0; pass < 3; pass++) { timer.advance(2_500); await service.run(target, { observationCycleId: "before-race", revision: "scale-revision" }); }
    timer.advance(DAY + 1_000); race = true;
    const result = await service.run(target, { observationCycleId: "during-race", revision: "scale-revision" });
    const connection = await repository.getConnection(target), models = connection?.config.modelCatalogModels as ModelDescriptor[];
    expect(result.superseded).toBeGreaterThan(0); expect(models[0]!.pricing?.unitAmount).toBe(.777);
    expect(models[0]!.metadata?.priceSource).toBe("manual"); expect(connection?.config.defaultModel).toBe("fixture-11-full-model-1");
    expect(connection?.config.parameters).toEqual({ quality: "high", userMustKeep: true }); service.close();
  }, 30_000);
  it("measures full-state atomic writes and foreground canvas saves with all 16 namespaces populated", async () => {
    const directory = resolve(process.cwd(), "../../../.codex-temp/catalog-slice3-scale");
    const runDirectory = await mkdtemp(resolve(directory, "save-run-")), path = resolve(runDirectory, "full-state-snapshot.json");
    const meta = JSON.parse(await readFile(resolve(directory, "filled-snapshot-meta.json"), "utf8")) as { fixtureOnly: boolean; suppliers: number; connections: number; clockNow: number; cycles: number };
    expect(meta).toMatchObject({ fixtureOnly: true, suppliers: 16, connections: 131, cycles: 4 });
    const seed = await readFile(resolve(directory, "filled-snapshot.json"), "utf8");
    const initial = JSON.parse(seed) as { connections: ProviderConnectionRecord[]; suppliers: SupplierRecord[]; applicationSettings: Record<string, unknown> };
    expect(initial.connections).toHaveLength(131); expect(initial.suppliers).toHaveLength(16);
    const namespaceValues = Object.entries(initial.applicationSettings).filter(([key]) => key.startsWith("supplierCatalogPipeline:"));
    expect(namespaceValues).toHaveLength(16);
    const initialStateBytes = namespaceValues.reduce((sum, [, value]) => sum + Buffer.byteLength(JSON.stringify(value)), 0);
    await writeFile(path, seed);
    let writes = 0, maxSnapshotBytes = 0;
    const foregroundMs: number[] = [], replacementMs: number[] = [], fullStateReadMs: number[] = [];
    const repository = new FileRepository(path, async (from, to) => {
      const begin = performance.now(); writes++; maxSnapshotBytes = Math.max(maxSnapshotBytes, (await stat(String(from))).size);
      await rename(from, to); replacementMs.push(performance.now() - begin);
    });
    // Separate migration from steady-state saves. Schedule foreground work
    // independently: pure state checkpoints no longer replace the main file.
    await repository.flush();
    const timer = fixtureClock(); timer.advance(meta.clockNow - timer.clock.now() + DAY + 1_000);
    const transport = fixtureTransport(timer.clock, () => 0), service = createCatalogPipelineService({ environment: {}, repository, clock: timer.clock,
      sessionStartedAt: timer.clock.now() - 60_000, random: () => .5, readers: async () => ({ apiKey: "fictional", fetchFor: () => transport }) });
    const ids = (await repository.listConnections()).filter(connection => connection.id.startsWith("scale-supplier-0-")).map(connection => connection.id);
    const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable(); const started = performance.now();
    let settled = false, savesWhileChecking = 0;
    const checking = sweep(service, ids, timer, "full-state-file-cycle", repository).finally(() => { settled = true; });
    void checking.catch(() => {});
    try {
    for (let sample = 0; sample < 24; sample++) {
      await new Promise<void>(done => setImmediate(done));
      if (!settled) savesWhileChecking++;
      const readStarted = performance.now(); await repository.getCatalogPipelineState("scale-supplier-0"); fullStateReadMs.push(performance.now() - readStarted);
      const savedAt = performance.now();
      await repository.saveCanvas({ id: "foreground-fixture", title: "Foreground fixture", graph: {
        nodes: Array.from({ length: 200 }, (_, index) => ({ id: "foreground-" + index, position: { x: index * 240 + sample, y: 0 }, data: { text: "Fictional foreground save" } })), edges: [],
      } });
      foregroundMs.push(performance.now() - savedAt);
    }
    await checking; service.close(); lag.disable();
    const data = JSON.parse(await readFile(path, "utf8")) as { applicationSettings: Record<string, unknown> };
    const result = { fixture: { suppliers: 16, connections: 131, keyModels: 64, publicModelsPerSupplier: 512, populatedCycles: 4, activeOwnerKeys: 9 },
      elapsedMs: performance.now() - started, writes, actualUpstreamRequests: 0, mockedHttpCalls: transport.mock.calls.length,
      initialSnapshotBytes: Buffer.byteLength(seed), maxSnapshotBytes, initialPipelineStateBytes: initialStateBytes,
      pipelineStateBytesInMain: Object.entries(data.applicationSettings).filter(([key]) => key.startsWith("supplierCatalogPipeline:")).reduce((sum, [, value]) => sum + Buffer.byteLength(JSON.stringify(value)), 0),
      savesWhileChecking,
      atomicRenameCallbackMs: { p50: quantile(replacementMs, .5), p95: quantile(replacementMs, .95), max: Math.max(0, ...replacementMs) },
      fullNamespaceReadMs: { samples: fullStateReadMs.length, p50: quantile(fullStateReadMs, .5), p95: quantile(fullStateReadMs, .95), max: Math.max(0, ...fullStateReadMs) },
      eventLoopDelayMs: { resolution: 10, p50: lag.percentile(50) / 1e6, p95: lag.percentile(95) / 1e6, max: lag.max / 1e6 },
      foregroundSaveMs: { samples: foregroundMs.length, p50: quantile(foregroundMs, .5), p95: quantile(foregroundMs, .95), max: Math.max(0, ...foregroundMs) } };
    if (process.env.CATALOG_SCALE_EVIDENCE) await writeFile(resolve(process.env.CATALOG_SCALE_EVIDENCE, "scale-file-full-state.json"), JSON.stringify(result, null, 2));
    expect(writes).toBeGreaterThan(0); expect(transport).toHaveBeenCalledTimes(11); expect(foregroundMs).toHaveLength(24);
    expect(savesWhileChecking).toBeGreaterThan(0);
    expect(result.pipelineStateBytesInMain).toBe(0);
    expect(await repository.getCatalogPipelineState("scale-supplier-0")).toBeDefined();
    expect((await repository.getCanvas("foreground-fixture"))?.graph.nodes).toHaveLength(200);
    for (const original of initial.connections.filter(connection => !connection.id.startsWith("scale-supplier-0-")))
      expect(await repository.getConnection(original.id)).toEqual(original);
    expect(result.foregroundSaveMs.p95).toBeLessThan(1500);
    } finally {
      await checking.catch(() => {}); service.close(); lag.disable();
      // Unique fictional run directory, never a user's data path.
      await rm(runDirectory, { recursive: true, force: true });
    }
  }, 600_000);
});

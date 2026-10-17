import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertCatalogPipelineState, catalogConnectionIdentity, catalogSupplierIdentity, catalogLegacyObservationOwner, catalogObservationIdentity,
  catalogPipelineSettingKey, SupplierConflictError, type CatalogObservationCommit, type CatalogObservationReservation,
  type CatalogPipelineState, type JsonObject, type ProviderConnectionRecord, type Repository, type SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { catalogConnectionScopes, catalogReadPreviewEnabled, catalogSourcePlan } from "./catalog-source-plan";
import { readCatalogObservationStore, catalogLegacyConnectionEntryKey } from "./catalog-observation-store";
import { catalogMode, CATALOG_MODE_SETTING } from "./supplier-catalog-policy";
import { collectCatalogReadTask, discoverCatalogModelTasks, type CatalogReadTask } from "./catalog-read-task";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import { reduceCatalogInventory, type CatalogInventoryState } from "./catalog-inventory-policy";
import { applyCatalogContractDiagnostics, catalogContractFromDocumented, emptyCatalogContractState, reduceCatalogContract, type CatalogContractState } from "./catalog-contract-policy";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { createCatalogPublisher } from "./catalog-publisher";
import { createCatalogHttpDispatcher, createCatalogSchedulerStore, createCatalogTransportCoordinator,
  type CatalogSchedulerClock, type CatalogSchedulerPersistence } from "./catalog-scheduler-store";
import { compactCatalogSchedulerState, emptyCatalogSchedulerState, enqueueCatalogReadJobs, finishCatalogReadJob,
  recoverCatalogReadJobs, type CatalogScheduledMode, type CatalogSchedulerState } from "./catalog-read-scheduler";

export const CATALOG_SCHEDULER_ENTRY = "scheduler:v1";
const taskKey = (source: string) => `task:${source}`;
const factKey = (source: string) => `fact:${source}`;
const inventoryKey = (connection: string) => `membership:${connection}`;
const guardKey = (connection: string) => `identity:${connection}`;
const projectionKey = (connection: string) => `projection:${connection}`;
const contractKey = (connection: string) => `contracts:${connection}`;
const contractEpochKey = (connection: string) => `contractEpoch:${connection}`;
const json = (value: unknown): JsonObject => value as JsonObject;
const modelsOf = (connection: ProviderConnectionRecord): ModelDescriptor[] => Array.isArray(connection.config.modelCatalogModels)
  ? structuredClone(connection.config.modelCatalogModels) as ModelDescriptor[] : [];
const identityFingerprint = (connection: ProviderConnectionRecord, owner: SupplierRecord) => createHash("sha256")
  .update(JSON.stringify([catalogSupplierIdentity(owner), catalogConnectionIdentity(connection)])).digest("hex");
const systemClock: CatalogSchedulerClock = { now: Date.now, setTimeout: (fn, delay) => setTimeout(fn, delay),
  clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>) };

function applicableFact(row: { receipt: Pick<CatalogReadObservation["receipt"], "spec">;
  facts: Pick<CatalogReadObservation["facts"], "contracts" | "contractDiagnostics" | "contractOrigin"> }, connection: ProviderConnectionRecord, supplier?: SupplierRecord): boolean {
  const spec = row.receipt.spec, scopes = catalogConnectionScopes(connection, supplier);
  const scope = spec.authScope.kind === "anonymous" ? scopes.anonymous : spec.authScope.kind === "site-account" ? scopes.account : scopes.key;
  if ((row.facts.contracts?.length || row.facts.contractDiagnostics?.length) && spec.authScope.kind !== "connection-key" &&
    row.facts.contractOrigin !== new URL(String(connection.config.baseUrl)).origin) return false;
  return spec.applyScope.supplierSourceId === scopes.apply.supplierSourceId &&
    spec.applyScope.groupIdentity === scopes.apply.groupIdentity && isDeepStrictEqual(spec.authScope, scope) &&
    (spec.authScope.kind !== "connection-key" || spec.authScope.principalRef === connection.id);
}
function projectionFingerprint(rows: readonly CatalogReadObservation[], epoch: string, connection: ProviderConnectionRecord, supplier?: SupplierRecord): string {
  return createHash("sha256").update(JSON.stringify([epoch, rows.filter(row => row.receipt.context.identityEpoch === epoch && applicableFact(row, connection, supplier))
    .map(row => [row.receipt.spec.sourceKey, row.receipt.context.dispatchSeq]).sort(([a], [b]) => String(a).localeCompare(String(b)))])).digest("hex");
}

export interface CatalogPipelineDependencies {
  environment: Record<string, string | undefined>;
  repository: Repository;
  /** Explicit read transports only; no production/global fetch fallback. */
  readers(connection: ProviderConnectionRecord, supplier?: SupplierRecord): Promise<{ apiKey: string; fetchFor(scope: CatalogReadTask["spec"]): typeof fetch | undefined }>;
  clock?: CatalogSchedulerClock;
  random?: () => number;
  sessionStartedAt?: number;
  canContinue?(): boolean;
  trackWrite?<T>(work: () => Promise<T>): Promise<T>;
}
export interface CatalogPipelineRunOptions {
  observationCycleId: string;
  revision: string;
  mode?: CatalogScheduledMode;
  budget?: number;
  manualConfirmation?: { sourceKey: string; candidateVersion: string };
}
export interface CatalogPipelineRunResult { enabled: boolean; published: number; pending: number; superseded: number; nextWakeAt?: number }

/** Internal slice-2 integration. Until P4 exists this cannot run in an installed profile. */
export function createCatalogPipelineService(deps: CatalogPipelineDependencies) {
  const repository = deps.repository, clock = deps.clock ?? systemClock, coordinator = createCatalogTransportCoordinator();
  const sessionStartedAt = deps.sessionStartedAt ?? clock.now();
  let closed = false;
  const active = new Map<string, Promise<CatalogPipelineRunResult>>();
  const controllers = new Set<AbortController>();
  const write = <T>(work: () => Promise<T>) => deps.trackWrite ? deps.trackWrite(work) : work();
  const enabled = () => !closed && catalogReadPreviewEnabled(deps.environment) && deps.canContinue?.() !== false;
  const publisher = createCatalogPublisher(repository, () => enabled());
  async function loadState(owner: SupplierRecord): Promise<CatalogPipelineState | undefined> {
    const saved = await repository.getApplicationSetting(catalogPipelineSettingKey(owner.id));
    if (saved === undefined) return undefined;
    assertCatalogPipelineState(saved, owner.id); return saved;
  }
  async function currentOwner(connectionId: string) {
    const connection = await repository.getConnection(connectionId);
    if (!connection || connection.config.supplierArchived === true) throw new SupplierConflictError("连接已经移除");
    const supplierId = connection.config.supplierId;
    const supplier = typeof supplierId === "string" ? await repository.getSupplier(supplierId) ?? undefined : undefined;
    if (typeof supplierId === "string" && (!supplier || supplier.state?.visibility === "deleted") || supplier?.state && supplier.state.sourceId !== connection.config.supplierSourceId)
      throw new SupplierConflictError("连接来源已经变化");
    return { connection, supplier, owner: supplier ?? catalogLegacyObservationOwner(connection) };
  }
  async function run(connectionId: string, options: CatalogPipelineRunOptions): Promise<CatalogPipelineRunResult> {
    const result: CatalogPipelineRunResult = { enabled: enabled(), published: 0, pending: 0, superseded: 0 };
    if (!result.enabled) return result;
    let snapshot = await currentOwner(connectionId);
    let mode = catalogMode(await repository.getApplicationSetting(CATALOG_MODE_SETTING));
    if (mode === "off" && options.mode !== "manual" && !options.manualConfirmation) return result;
    // Manual is an explicit call. It bypasses frequency policy, never host limits.
    const scheduledMode = options.mode ?? (mode === "off" ? "daily" : mode);
    const migration = await readCatalogObservationStore(repository, snapshot.owner, await repository.listConnections(), clock.now());
    let state = await loadState(snapshot.owner);
    const identity = () => catalogObservationIdentity(snapshot.owner, [snapshot.connection]);
    const fingerprint = identityFingerprint(snapshot.connection, snapshot.owner);
    const oldGuard = state?.entries[guardKey(connectionId)]?.fingerprint;
    if (options.manualConfirmation && (!state || oldGuard !== fingerprint)) return { ...result, superseded: 1 };
    if (state && oldGuard !== undefined && oldGuard !== fingerprint && options.mode !== "manual") return { ...result, superseded: 1 };
    // Invalidate old reservations on external config/manual refresh changes. The
    // namespace survives; no accepted baseline is fabricated from legacy data.
    if (state && oldGuard !== undefined && oldGuard !== fingerprint) {
      await write(() => repository.reserveCatalogObservation({ identity: identity(), sourceKey: `invalidate:${connectionId}`,
        observationCycleId: options.observationCycleId, expectedMode: mode, manual: options.mode === "manual", invalidatePrevious: true }));
      state = await loadState(snapshot.owner);
    }
    if (!state || oldGuard !== fingerprint) state = await write(() => repository.updateCatalogPipelineState({ identity: identity(), expectedMode: mode,
      expectedIdentityEpoch: state?.identityEpoch, initialEntries: migration.initialEntries,
      state: [{ key: guardKey(connectionId), expected: state?.entries[guardKey(connectionId)], value: { fingerprint } }] }));
    const epoch = state.identityEpoch;
    const store: CatalogSchedulerPersistence = createCatalogSchedulerStore({
      load: async () => (await loadState(snapshot.owner))?.entries[CATALOG_SCHEDULER_ENTRY] as unknown as CatalogSchedulerState | undefined,
      compareAndSwap: async (expected, next) => {
        try {
          const fresh = await currentOwner(connectionId);
          if (catalogConnectionIdentity(fresh.connection) !== catalogConnectionIdentity(snapshot.connection)) return false;
          await repository.updateCatalogPipelineState({ identity: identity(), expectedMode: mode, expectedIdentityEpoch: epoch,
            state: [{ key: CATALOG_SCHEDULER_ENTRY, expected: expected && json(expected), value: json(next) }] }); return true;
        } catch (error) { if (error instanceof SupplierConflictError) return false; throw error; }
      }, trackWrite: write,
    });
    // Restore all durable host cooldowns before starting any request, including
    // cooldowns recorded by another supplier in the previous backend session.
    const settings = await repository.listSuppliers();
    const legacyOwners: SupplierRecord[] = [];
    for (const connection of await repository.listConnections()) if (typeof connection.config.supplierId !== "string" && connection.config.supplierArchived !== true) {
      try { legacyOwners.push(catalogLegacyObservationOwner(connection)); } catch { /* Invalid legacy sources never dispatch. */ }
    }
    for (const owner of [snapshot.owner, ...settings, ...legacyOwners]) {
      const saved = await loadState(owner);
      const scheduler = saved?.entries[CATALOG_SCHEDULER_ENTRY] as unknown as CatalogSchedulerState | undefined;
      if (scheduler) coordinator.absorb(scheduler.hosts);
    }
    const plan = catalogSourcePlan(snapshot.connection, snapshot.supplier);
    const requiredKeys = new Set(plan.filter(spec => spec.requiredForMembership).map(spec => spec.sourceKey));
    const previousQueue = await store.read();
    const requiredJobs = Object.values(previousQueue.jobs).filter(job => requiredKeys.has(job.sourceKey) && job.identityEpoch === epoch)
      .sort((a, b) => b.order - a.order);
    const pendingCycle = requiredJobs.find(job => ["queued", "deferred", "running"].includes(job.status))?.observationCycleId;
    const allDue = [...requiredKeys].every(key => (previousQueue.sources[key]?.nextEligibleAt ?? 0) <= clock.now());
    // A deferred required source retains its cohort over midnight. Completed
    // siblings cannot overwrite the cohort's receipts with a newer daily run.
    const cycleId = scheduledMode === "manual" ? options.observationCycleId : pendingCycle ??
      (!allDue && requiredJobs.length ? requiredJobs[0]!.observationCycleId : options.observationCycleId);
    if (options.manualConfirmation) {
      const latest = await loadState(snapshot.owner), confirmation = options.manualConfirmation;
      const inventory = latest?.entries[inventoryKey(connectionId)] as unknown as CatalogInventoryState | undefined;
      const source = inventory?.sources[confirmation.sourceKey];
      const candidate = source?.candidate;
      const receipt = latest?.entries[factKey(confirmation.sourceKey)] as unknown as CatalogReadObservation | undefined;
      if (!latest || !source || !candidate || inventory?.identityEpoch !== epoch || candidate.version !== confirmation.candidateVersion ||
        source.lastOutcome !== "candidate" || !receipt || receipt.receipt.context.identityEpoch !== epoch) return { ...result, superseded: 1 };
      const laterUnsettled = (latest.sources[confirmation.sourceKey]?.lastDispatchedSeq ?? 0) > source.lastDispatchSeq &&
        Object.values(previousQueue.jobs).some(job => job.sourceKey === confirmation.sourceKey && job.attemptConsumedAt !== undefined &&
          ["running", "unknown"].includes(job.status));
      if (laterUnsettled) return { ...result, superseded: 1 };
      const token = await write(() => repository.reserveCatalogObservation({ identity: identity(), sourceKey: `confirmation:${connectionId}`,
        observationCycleId: candidate.observationCycleId, expectedMode: mode, manual: true }));
      await write(() => publisher.publish(preparePublication(latest, snapshot.connection, token, receipt, previousQueue, "", clock.now(), "manual",
        [...requiredKeys], confirmation, { discovered: [], supplier: snapshot.supplier, sessionStartedAt, revision: options.revision })));
      return { ...result, published: 1, pending: Object.values(previousQueue.jobs).filter(job => ["queued", "deferred"].includes(job.status)).length };
    }
    const staticTasks = plan.map(spec => ({ spec, ...(spec.entryId.startsWith("supplement:") ? { supplement: {
      entryId: spec.entryId.slice(11), sourceUrl: spec.sourceUrl, role: spec.role as "price" | "schema" | "catalog-offer",
      authKind: spec.authScope.kind as "anonymous" | "site-account" } } : {}) } as CatalogReadTask));
    const persistedTasks = Object.entries(state.entries).filter(([key]) => key.startsWith("task:")).map(([, value]) => value as unknown as CatalogReadTask)
      .filter(task => task.spec.applyScope.connectionIds.includes(connectionId) && applicableFact({ receipt: { spec: task.spec }, facts: {} },
        snapshot.connection, snapshot.supplier));
    const tasks = [...new Map([...persistedTasks, ...staticTasks].map(task => [task.spec.sourceKey, task])).values()];
    const enqueue = async (next: readonly CatalogReadTask[]) => {
      for (let retry = 0; retry < 4; retry++) {
        const saved = await loadState(snapshot.owner); if (!saved || saved.identityEpoch !== epoch) throw new SupplierConflictError("目录代次已改变");
        const scheduler = saved.entries[CATALOG_SCHEDULER_ENTRY] as unknown as CatalogSchedulerState | undefined;
        const legacy = saved.entries[catalogLegacyConnectionEntryKey(connectionId)];
        const due = legacy?.nextEligibleAt ? Date.parse(String(legacy.nextEligibleAt)) : 0;
        const legacyValues = legacy?.legacy as JsonObject | undefined;
        const paused = legacyValues?.catalogCheckPaused === true;
        const attemptedAt = Date.parse(String(legacyValues?.catalogCheckAttemptedAt ?? legacyValues?.catalogUpgradeAttemptedAt ?? ""));
        const initialEligibility = { nextEligibleAt: Number.isFinite(due) ? due : 0, paused,
          // The legacy counter belongs to a whole connection scan, not this
          // newly identified source. Keep it in history, never distribute it.
          failureStreak: 0,
          ...(Number.isFinite(attemptedAt) ? { lastAttemptAt: attemptedAt } : {}),
          ...(legacy?.modeAtMigration === "upgrade" && legacy.nextEligibleAt === null && !paused ? { lastAttemptRevision: options.revision }
            : typeof (legacyValues?.catalogCheckAttemptRevision ?? legacyValues?.catalogUpgradeAttemptRevision ?? legacyValues?.catalogUpgradeRevision) === "string"
              ? { lastAttemptRevision: String(legacyValues?.catalogCheckAttemptRevision ?? legacyValues?.catalogUpgradeAttemptRevision ?? legacyValues?.catalogUpgradeRevision) } : {}) };
        const queued = enqueueCatalogReadJobs(recoverCatalogReadJobs(scheduler ?? emptyCatalogSchedulerState(), clock.now()), next.map(task => task.spec), {
          now: clock.now(), mode: scheduledMode, identityEpoch: epoch, observationCycleId: cycleId, revision: options.revision,
          sessionStartedAt, initialEligibility: Object.fromEntries(next.map(task => [task.spec.sourceKey, initialEligibility])) });
        // A shared read keeps its immutable first discovery/auth identity. Its
        // facts are projected to further targets locally, never fetched twice.
        const patches = next.filter(task => !saved.entries[taskKey(task.spec.sourceKey)]).map(task =>
          ({ key: taskKey(task.spec.sourceKey), expected: saved.entries[taskKey(task.spec.sourceKey)], value: json(task) }));
        const priorInventory = saved.entries[inventoryKey(connectionId)] as unknown as CatalogInventoryState | undefined;
        if (priorInventory) {
          const interrupted = structuredClone(priorInventory);
          const unknown = new Map(Object.values(queued.state.jobs).filter(job => job.status === "unknown" && job.spec.applyScope.connectionIds.includes(connectionId))
            .sort((a, b) => a.order - b.order).map(job => [job.sourceKey, job]));
          for (const job of unknown.values()) if (Number(saved.entries[`interrupted:${job.sourceKey}`]?.order ?? -1) < job.order) {
            const source = interrupted.sources[job.sourceKey];
            if (source?.candidate && Date.parse(source.candidate.lastCountedAt ?? source.candidate.checkedAt) <= (job.attemptConsumedAt ?? job.queuedAt)) {
              delete source.candidate; source.lastOutcome = "incomplete";
            }
            patches.push({ key: `interrupted:${job.sourceKey}`, expected: saved.entries[`interrupted:${job.sourceKey}`], value: { order: job.order, cycleId: job.observationCycleId } });
          }
          if (!isDeepStrictEqual(priorInventory, interrupted)) patches.push({ key: inventoryKey(connectionId), expected: json(priorInventory), value: json(interrupted) });
        }
        if (!patches.length && isDeepStrictEqual(scheduler ?? emptyCatalogSchedulerState(), queued.state)) return;
        try {
          await write(() => repository.updateCatalogPipelineState({ identity: identity(), expectedMode: mode, expectedIdentityEpoch: epoch,
            state: [...patches, { key: CATALOG_SCHEDULER_ENTRY, expected: scheduler && json(scheduler), value: json(queued.state) }] })); return;
        } catch (error) { if (!(error instanceof SupplierConflictError) || retry === 3) throw error; }
      }
    };
    await enqueue(tasks);
    const readers = await deps.readers(snapshot.connection, snapshot.supplier);
    const abort = new AbortController(); controllers.add(abort);
    let currentTransport: typeof fetch | undefined;
    const dispatcher = createCatalogHttpDispatcher({ store, coordinator, clock, random: deps.random,
      fetch: (input, init) => { if (!currentTransport) throw new Error("目录读取凭据不可用"); return currentTransport(input, init); },
      guards: () => ({ mode, draining: !enabled(), identityEpoch: () => epoch }) });
    try {
      let spent = 0;
      while (enabled() && spent < (options.budget ?? 32)) {
        mode = catalogMode(await repository.getApplicationSetting(CATALOG_MODE_SETTING));
        if (mode === "off" && scheduledMode !== "manual") break;
        const saved = await loadState(snapshot.owner); if (!saved || saved.identityEpoch !== epoch) break;
        const scheduler = await store.read();
        const job = Object.values(scheduler.jobs).filter(job => job.spec.applyScope.connectionIds.includes(connectionId) &&
          ["queued", "deferred"].includes(job.status) && job.identityEpoch === epoch && job.nextAttemptEligibleAt <= clock.now() &&
          Math.max(scheduler.hosts[new URL(job.spec.sourceUrl).host]?.cooldownUntil ?? 0, scheduler.hosts[new URL(job.spec.sourceUrl).host]?.nextStartAt ?? 0,
            coordinator.nextEligibleAt(new URL(job.spec.sourceUrl).host)) <= clock.now())
          .sort((a, b) => Number(b.spec.role === "key-membership") - Number(a.spec.role === "key-membership") || a.order - b.order)[0];
        if (!job) break;
        const task = saved.entries[taskKey(job.sourceKey)] as unknown as CatalogReadTask | undefined;
        if (!task) throw new Error("目录任务缺少持久化读取输入");
        currentTransport = readers.fetchFor(job.spec);
        if (!currentTransport) {
          await store.mutate(state => { const pending = state.jobs[job.id]!; pending.status = "deferred";
            pending.nextAttemptEligibleAt = clock.now() + 24 * 60 * 60_000; pending.reason = "authentication"; return { state, result: undefined }; });
          continue; // Unread, never an empty list or a consumed HTTP attempt.
        }
        const fresh = await currentOwner(connectionId);
        if (catalogConnectionIdentity(fresh.connection) !== catalogConnectionIdentity(snapshot.connection)) { result.superseded++; break; }
        const reservation = await write(() => repository.reserveCatalogObservation({ identity: identity(), sourceKey: job.sourceKey,
          observationCycleId: job.observationCycleId, expectedMode: mode, manual: scheduledMode === "manual" }));
        const inventory = saved.entries[inventoryKey(connectionId)] as unknown as CatalogInventoryState | undefined;
        const collected = await collectCatalogReadTask(task, snapshot.connection, snapshot.supplier, inventory?.visibleModels ?? modelsOf(snapshot.connection), {
          enabled: true, apiKey: readers.apiKey, fetchFor: () => dispatcher.fetchFor(job.id), now: () => new Date(clock.now()).toISOString(),
          signal: abort.signal, context: { runId: randomUUID(), observationCycleId: job.observationCycleId, identityEpoch: epoch, dispatchSeq: reservation.dispatchSeq } });
        spent++;
        // CAS rebase uses the same immutable facts, never a second upstream request.
        let committed = false;
        for (let rebase = 0; rebase < 4 && !committed; rebase++) {
          const latest = await loadState(snapshot.owner); if (!latest || latest.identityEpoch !== epoch) break;
          const live = await store.read(), liveJob = live.jobs[job.id];
          if (!liveJob || liveJob.status !== "running" || liveJob.lease?.owner !== dispatcher.owner || liveJob.lease.expiresAt <= clock.now()) break;
          const ownerNow = await currentOwner(connectionId);
          if (catalogConnectionIdentity(ownerNow.connection) !== catalogConnectionIdentity(snapshot.connection)) break;
          const commit = preparePublication(latest, ownerNow.connection, reservation, collected.observation, live, dispatcher.owner,
            clock.now(), scheduledMode, plan.filter(spec => spec.requiredForMembership).map(spec => spec.sourceKey), options.manualConfirmation,
            { jobId: job.id, discovered: collected.discovered, supplier: snapshot.supplier, sessionStartedAt, revision: options.revision });
          try { await write(() => publisher.publish(commit)); committed = true; result.published++; snapshot = ownerNow;
            snapshot.connection = (await repository.getConnection(connectionId))!;
          } catch (error) {
            if (!(error instanceof SupplierConflictError)) throw error;
            // Only unrelated state entries may be rebased. A newer owned value
            // is not overwritten; token/identity/lease are checked on each pass.
            const current = await repository.getConnection(connectionId);
            if (!current || !isDeepStrictEqual(current.config.modelCatalogModels, ownerNow.connection.config.modelCatalogModels) ||
              catalogConnectionIdentity(current) !== catalogConnectionIdentity(ownerNow.connection)) break;
          }
        }
        if (!committed) { result.superseded++; break; }
      }
      // A shared public/document read may already have completed for a sibling.
      // Apply saved facts to this target with a fresh local CAS token, without
      // pretending that a cache read is a new HTTP observation or daily cycle.
      const latest = await loadState(snapshot.owner);
      const cached = latest && Object.entries(latest.entries).filter(([key]) => key.startsWith("fact:")).map(([, row]) => row as unknown as CatalogReadObservation)
        .filter(row => row.receipt.spec.role === "key-membership" && row.receipt.spec.authScope.principalRef === connectionId && row.receipt.context.identityEpoch === epoch)
        .sort((a, b) => b.receipt.context.dispatchSeq - a.receipt.context.dispatchSeq)[0];
      const latestFacts = latest ? Object.entries(latest.entries).filter(([key]) => key.startsWith("fact:")).map(([, row]) => row as unknown as CatalogReadObservation) : [];
      if (latest && cached && enabled() && (options.manualConfirmation || latest.entries[projectionKey(connectionId)]?.fingerprint !==
        projectionFingerprint(latestFacts, epoch, snapshot.connection, snapshot.supplier))) {
        const token = await write(() => repository.reserveCatalogObservation({ identity: identity(), sourceKey: `projection:${connectionId}`,
          observationCycleId: cached.receipt.context.observationCycleId, expectedMode: mode, manual: scheduledMode === "manual" }));
        const local = preparePublication(latest, snapshot.connection, token, cached, await store.read(), dispatcher.owner, clock.now(), scheduledMode,
          plan.filter(spec => spec.requiredForMembership).map(spec => spec.sourceKey), options.manualConfirmation,
          { discovered: [], supplier: snapshot.supplier, sessionStartedAt, revision: options.revision });
        await write(() => publisher.publish(local));
      }
    } finally { controllers.delete(abort); await dispatcher.close("cancelled"); }
    const terminal = await store.read();
    const pending = Object.values(terminal.jobs).filter(job => ["queued", "deferred"].includes(job.status)); result.pending = pending.length;
    if (pending.length) result.nextWakeAt = Math.min(...pending.map(job => Math.max(job.nextAttemptEligibleAt,
      terminal.hosts[new URL(job.spec.sourceUrl).host]?.cooldownUntil ?? 0, terminal.hosts[new URL(job.spec.sourceUrl).host]?.nextStartAt ?? 0,
      coordinator.nextEligibleAt(new URL(job.spec.sourceUrl).host))));
    else if (scheduledMode === "daily") result.nextWakeAt = Math.max(clock.now() + 1500, ...[...requiredKeys].map(key => terminal.sources[key]?.nextEligibleAt ?? clock.now()));
    return result;
  }
  return {
    run(connectionId: string, options: CatalogPipelineRunOptions) {
      const existing = active.get(connectionId); if (existing) return existing;
      // Only duplicate calls for this exact target share work. Supplier mutexes
      // belong to the short publisher transaction, never network or cooldown.
      const work = run(connectionId, options); active.set(connectionId, work);
      void work.finally(() => { if (active.get(connectionId) === work) active.delete(connectionId); }).catch(() => undefined);
      return work;
    },
    close() { closed = true; for (const controller of controllers) controller.abort(); },
  };
}

function preparePublication(pipeline: CatalogPipelineState, connection: ProviderConnectionRecord, reservation: CatalogObservationReservation,
  observation: CatalogReadObservation, scheduler: CatalogSchedulerState, owner: string, now: number, mode: CatalogScheduledMode,
  requiredSourceKeys: string[], manualConfirmation: CatalogPipelineRunOptions["manualConfirmation"],
  work: { jobId?: string; discovered: CatalogReadTask[]; supplier?: SupplierRecord; sessionStartedAt: number; revision: string }): CatalogObservationCommit {
  const priorInventory = pipeline.entries[inventoryKey(connection.id)] as unknown as CatalogInventoryState | undefined;
  const observations = Object.entries(pipeline.entries).filter(([key]) => key.startsWith("fact:")).map(([, value]) => value as unknown as CatalogReadObservation)
    .filter(row => row.receipt.context.observationCycleId === observation.receipt.context.observationCycleId && row.receipt.spec.sourceKey !== observation.receipt.spec.sourceKey &&
      row.receipt.context.identityEpoch === pipeline.identityEpoch && applicableFact(row, connection, work.supplier));
  observations.push(observation);
  const reduction = reduceCatalogInventory(priorInventory, { connectionId: connection.id, identityEpoch: pipeline.identityEpoch,
    observationCycleId: observation.receipt.context.observationCycleId, observedAt: new Date(now).toISOString(), mode, requiredSourceKeys, observations,
    initialModels: modelsOf(connection), manualConfirmation, validatedPartialModelIds: Object.fromEntries(observations.filter(row => row.facts.validatedMembershipModelIds)
      .map(row => [row.receipt.spec.sourceKey, row.facts.validatedMembershipModelIds!])) });
  let contracts = pipeline.entries[contractKey(connection.id)] as unknown as CatalogContractState | undefined ?? emptyCatalogContractState();
  if (pipeline.entries[contractEpochKey(connection.id)]?.identityEpoch !== pipeline.identityEpoch) {
    contracts = structuredClone(contracts);
    for (const slot of Object.values(contracts.slots)) if (slot.accepted?.owner === "automatic") {
      if (!slot.history.some(item => isDeepStrictEqual(item.identity, slot.accepted!.identity))) slot.history.push(slot.accepted);
      delete slot.accepted; slot.blocked = true; slot.reason = "incomplete";
    }
  }
  const knownFacts = Object.entries(pipeline.entries).filter(([key]) => key.startsWith("fact:")).map(([, value]) => value as unknown as CatalogReadObservation)
    .filter(row => row.receipt.spec.sourceKey !== observation.receipt.spec.sourceKey);
  knownFacts.push(observation);
  for (const fact of knownFacts) if (fact.receipt.context.identityEpoch === pipeline.identityEpoch && applicableFact(fact, connection, work.supplier))
    contracts = applyCatalogContractDiagnostics(contracts, fact.facts.contractDiagnostics ?? [], { origin: new URL(String(connection.config.baseUrl)).origin,
      sourceId: fact.receipt.spec.applyScope.supplierSourceId, groupIdentity: catalogConnectionScopes(connection).apply.groupIdentity ?? "name:",
      sourceKey: fact.receipt.spec.sourceKey, checkedAt: fact.receipt.checkedAt });
  for (const fact of knownFacts) if (fact.receipt.status === "succeeded" && fact.receipt.context.identityEpoch === pipeline.identityEpoch && applicableFact(fact, connection, work.supplier))
  for (const binding of fact.facts.contracts ?? []) for (const operation of binding.model.operations) {
    const scope = catalogConnectionScopes(connection);
    try {
      const contract = catalogContractFromDocumented({ origin: new URL(String(connection.config.baseUrl)).origin,
        sourceId: fact.receipt.spec.applyScope.supplierSourceId, groupIdentity: scope.apply.groupIdentity ?? "name:", modelId: binding.model.id, operation }, "rest", binding);
      contracts = reduceCatalogContract(contracts, { ...contract, sourceKey: fact.receipt.spec.sourceKey, owner: "automatic", presence: "present",
        complete: fact.receipt.complete, checkedAt: fact.receipt.checkedAt });
    } catch { /* Invalid or incomplete contracts never borrow an old transport. */ }
  }
  // P4 is intentionally absent: retain exact saved prices; newly found IDs carry
  // no new price projection. Public facts cannot lend prices or permissions.
  const existing = new Map(modelsOf(connection).map(model => [model.id, model]));
  const priceField = (key: string) => /pric|billing|tariff|cost|currency|rateMultiplier|quota/iu.test(key);
  const unpriced = reduction.visibleModels.map(model => {
    const saved = existing.get(model.id), descriptor = structuredClone(model);
    delete descriptor.pricing;
    descriptor.name = saved?.name ?? descriptor.id;
    descriptor.metadata = Object.fromEntries([...Object.entries(descriptor.metadata ?? {}).filter(([key]) => !priceField(key)),
      ...Object.entries(saved?.metadata ?? {}).filter(([key]) => priceField(key)).map(([key, value]) => [key, structuredClone(value)])]);
    if (saved?.pricing) descriptor.pricing = structuredClone(saved.pricing);
    return descriptor;
  });
  const scope = observation.receipt.spec.applyScope;
  const denied = observations.some(row => row.receipt.spec.role === "key-membership" && row.receipt.spec.authScope.principalRef === connection.id &&
    row.receipt.reason === "authentication");
  const modelScanStatus = denied ? "unauthorized" : reduction.manifestComplete ? unpriced.length ? "live" : "empty" : connection.config.modelScanStatus ?? "unscanned";
  const effective = { ...connection, config: { ...connection.config, modelScanStatus } };
  const reconciled = unpriced.map(model => {
    const fresh = observations.filter(row => row.receipt.spec.role === "key-membership" && row.receipt.spec.authScope.principalRef === connection.id &&
      row.receipt.status === "succeeded" && row.receipt.complete).flatMap(row => row.facts.models).find(row => row.id === model.id);
    if (modelScanStatus !== "live" || !fresh || fresh.metadata?.canvasRunnable === false) return model;
    const metadata = { ...model.metadata }; delete metadata.canvasRunnable; delete metadata.canvasUnavailableReason;
    return { ...model, metadata };
  });
  const activeSources = new Set(requiredSourceKeys);
  const provenMembers = new Set(Object.values(reduction.state.sources).filter(source => activeSources.has(source.sourceKey))
    .flatMap(source => source.acceptedModels.map(model => model.id)));
  const membership = reconciled.map(model => ({ ...model, metadata: { ...model.metadata, catalogMembershipVerified: provenMembers.has(model.id) } }));
  const projected = bindScannedModelProtocols(effective, membership, effective, { catalogContracts: contracts,
    sourceId: scope.supplierSourceId, groupIdentity: catalogConnectionScopes(connection).apply.groupIdentity ?? "name:" });
  reduction.state.visibleModels = structuredClone(projected.models);
  const complete = observation.receipt.status === "succeeded" && observation.receipt.complete;
  let nextScheduler = work.jobId ? compactCatalogSchedulerState(finishCatalogReadJob(scheduler, work.jobId, owner, now,
    complete ? { status: "completed", resultRef: factKey(reservation.sourceKey) } : { status: "failed",
      reason: observation.receipt.reason === "credentials-unavailable" ? "authentication" : observation.receipt.reason ?? "incomplete", resultRef: factKey(reservation.sourceKey) })) : scheduler;
  const discovered = [...work.discovered, ...(work.jobId && observation.receipt.spec.role === "key-membership" ? discoverCatalogModelTasks(connection, work.supplier,
    reduction.visibleModels, requiredSourceKeys.some(key => scheduler.jobs[work.jobId ?? ""]?.spec.entryId === "miaowu-media" && key === reservation.sourceKey)) : [])];
  if (discovered.length) nextScheduler = enqueueCatalogReadJobs(nextScheduler, discovered.map(task => task.spec), { now, mode,
    identityEpoch: pipeline.identityEpoch, observationCycleId: observation.receipt.context.observationCycleId, revision: work.revision,
    sessionStartedAt: work.sessionStartedAt }).state;
  const fields = { modelCatalogModels: projected.models, scannedModelIds: projected.models.map(model => model.id), modelScanComplete: reduction.manifestComplete,
    modelScanStatus };
  const nextConnection = { ...connection, config: { ...connection.config, ...fields, ...(projected.connector ? { connector: projected.connector } : {}) } };
  const patches: CatalogObservationCommit["state"] = [
    ...(work.jobId ? [{ key: factKey(observation.receipt.spec.sourceKey), expected: pipeline.entries[factKey(observation.receipt.spec.sourceKey)], value: json(observation) }] : []),
    { key: inventoryKey(connection.id), expected: pipeline.entries[inventoryKey(connection.id)], value: json(reduction.state) },
    { key: contractKey(connection.id), expected: pipeline.entries[contractKey(connection.id)], value: json(contracts) },
    { key: contractEpochKey(connection.id), expected: pipeline.entries[contractEpochKey(connection.id)], value: { identityEpoch: pipeline.identityEpoch } },
    { key: CATALOG_SCHEDULER_ENTRY, expected: json(scheduler), value: json(nextScheduler) },
    { key: guardKey(connection.id), expected: pipeline.entries[guardKey(connection.id)], value: {
      fingerprint: identityFingerprint(nextConnection, work.supplier ?? catalogLegacyObservationOwner(nextConnection)) } },
    { key: projectionKey(connection.id), expected: pipeline.entries[projectionKey(connection.id)], value: {
      fingerprint: projectionFingerprint(knownFacts, pipeline.identityEpoch, connection, work.supplier) } },
    ...[...new Map(discovered.filter(task => !pipeline.entries[taskKey(task.spec.sourceKey)]).map(task => [task.spec.sourceKey, task])).values()]
      .map(task => ({ key: taskKey(task.spec.sourceKey), value: json(task) })),
  ];
  return { reservation, ...(work.jobId ? { leaseDeadline: Date.now() + Math.max(0, (scheduler.jobs[work.jobId]?.lease?.expiresAt ?? now) - now) } : {}),
    connections: [{ connectionId: connection.id, fields: {
    expected: Object.fromEntries(Object.keys(fields).map(key => [key, connection.config[key]])), set: fields },
    ...(projected.connector ? { connectorContract: { expected: connection.config.connector, value: projected.connector } } : {}) }], state: patches };
}

import { mkdir, open, rename, unlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { OwnedJsonMemo } from "./owned-json-memo.js";
import {
  VerificationEvidenceStore, VERIFICATION_EVIDENCE_SETTING,
  readVerificationEvidenceSnapshot, verificationEvidenceSummary,
  type VerificationEvidenceReference, type StoredVerificationSummary,
} from "./verification-evidence-store.js";
import type { SupplierVerificationRecord } from "./supplier-verification.js";
import { CatalogSidecarStore, isCatalogSidecarSetting } from "./catalog-sidecar.js";
import { catalogPipelineSettingKey, prepareCatalogReservation, prepareCatalogPipelineUpdate, type CatalogObservationPrepared, type CatalogObservationReservation } from "./catalog-observation.js";
import { setTimeout as delay } from "node:timers/promises";
import type {
  AssetRecord,
  CanvasRecord,
  CanvasRevisionRecord,
  DirectorMessageRecord,
  DirectorProfileRecord,
  DirectorProposalRecord,
  DirectorProposalUpdateOptions,
  DirectorSessionRecord,
  NodeRunRecord,
  NodeRunUpdateOptions,
  ProviderConnectionRecord,
  SupplierRecord,
  SupplierCommit,
  ConnectionSaveOptions,
  WebhookEventRecord,
  WorkflowRunRecord,
  WorkflowStatus,
} from "./types.js";
import {
  MemoryRepository,
  migrateMemoryRepositorySnapshot,
  type MemoryRepositorySnapshot,
  type MemoryRepositorySnapshotInput,
} from "./memory.js";

export const LOCAL_CANVAS_REVISION_LIMIT = 20;
export const LOCAL_RETRYABLE_RUN_LIMIT = 20;
export const RUN_RECOVERY_EXPIRED_KEY = "localRecoveryExpired";
export const verificationEvidenceDirectory = (path: string): string => basename(path) === "super-canvas.json"
  ? join(dirname(path), "supplier-verification-evidence") : `${path}.supplier-verification-evidence`;

const compactedRunGraph: Record<string, unknown> = {
  schemaVersion: 1,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const expiredRecoveryRunGraph: Record<string, unknown> = {
  ...compactedRunGraph,
  [RUN_RECOVERY_EXPIRED_KEY]: true,
};

export function isRunRecoveryExpired(run: WorkflowRunRecord): boolean {
  return run.revisionGraph[RUN_RECOVERY_EXPIRED_KEY] === true;
}

function compactTerminalRun(run: WorkflowRunRecord): WorkflowRunRecord {
  if (run.status !== "succeeded" && run.status !== "cancelled") return run;
  const nodes = run.revisionGraph.nodes;
  if (Array.isArray(nodes) && nodes.length === 0 && !isRunRecoveryExpired(run))
    return run;
  // Successful runs are immutable and cannot be resumed. Their public history
  // is fully represented by the run row plus node-run request/output fields,
  // so retaining a complete copy of a large canvas graph only slows every
  // subsequent local save.
  return { ...run, revisionGraph: structuredClone(compactedRunGraph) };
}

function compactNodeRun(
  nodeRun: NodeRunRecord,
  expiredRunIds: ReadonlySet<string>,
): NodeRunRecord {
  if (
    nodeRun.status !== "succeeded" &&
    !expiredRunIds.has(nodeRun.workflowRunId)
  )
    return nodeRun;
  const {
    providerTask: _providerTask,
    historicalInputs: _historical,
    ...input
  } = nodeRun.inputJson;
  if (_providerTask === undefined && _historical === undefined) {
    return nodeRun;
  }
  return { ...nodeRun, inputJson: input };
}

function compactRuns(runs: WorkflowRunRecord[]): {
  runs: WorkflowRunRecord[];
  expiredRunIds: Set<string>;
} {
  const retainedPerCanvas = new Map<string, number>();
  const retainedRunIds = new Set<string>();

  // Runs are stored in creation order. Walking backwards retains the newest
  // recovery snapshots even when several runs share the same timestamp.
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index]!;
    if (run.status !== "failed" && run.status !== "needs_attention") continue;
    const count = retainedPerCanvas.get(run.canvasId) ?? 0;
    if (count >= LOCAL_RETRYABLE_RUN_LIMIT) continue;
    retainedPerCanvas.set(run.canvasId, count + 1);
    retainedRunIds.add(run.id);
  }

  const expiredRunIds = new Set<string>();
  const compacted = runs.map((run) => {
    const terminal = compactTerminalRun(run);
    if (terminal !== run) return terminal;
    if (
      (run.status === "failed" || run.status === "needs_attention") &&
      !retainedRunIds.has(run.id)
    ) {
      expiredRunIds.add(run.id);
      if (isRunRecoveryExpired(run)) return run;
      return {
        ...run,
        revisionGraph: structuredClone(expiredRecoveryRunGraph),
      };
    }
    return run;
  });
  return { runs: compacted, expiredRunIds };
}

function compactRevisions(
  revisions: CanvasRevisionRecord[],
): CanvasRevisionRecord[] {
  const retainedPerCanvas = new Map<string, number>();
  const retained: CanvasRevisionRecord[] = [];

  // Snapshot revisions are in insertion order, so walking backwards keeps
  // the newest entries even when several autosaves share a timestamp.
  for (let index = revisions.length - 1; index >= 0; index -= 1) {
    const revision = revisions[index]!;
    const count = retainedPerCanvas.get(revision.canvasId) ?? 0;
    if (count >= LOCAL_CANVAS_REVISION_LIMIT) continue;
    retainedPerCanvas.set(revision.canvasId, count + 1);
    retained.push(revision);
  }
  return retained.reverse();
}

function compactSnapshot(snapshot: MemoryRepositorySnapshot | undefined): {
  snapshot: MemoryRepositorySnapshot | undefined;
  changed: boolean;
} {
  if (!snapshot) return { snapshot, changed: false };
  const revisions = compactRevisions(snapshot.revisions);
  const compactedRuns = compactRuns(snapshot.runs);
  const runs = compactedRuns.runs;
  const nodeRuns = snapshot.nodeRuns.map((nodeRun) =>
    compactNodeRun(nodeRun, compactedRuns.expiredRunIds),
  );
  if (
    revisions.length === snapshot.revisions.length &&
    runs.every((run, index) => run === snapshot.runs[index]) &&
    nodeRuns.every((nodeRun, index) => nodeRun === snapshot.nodeRuns[index])
  )
    return { snapshot, changed: false };
  return {
    snapshot: { ...snapshot, revisions, runs, nodeRuns },
    changed: true,
  };
}

const directorSnapshotFields = [
  "directorProfiles",
  "directorSessions",
  "directorMessages",
  "directorProposals",
] as const;

type DirectorSnapshotField = (typeof directorSnapshotFields)[number];

/** The document has already passed JSON.parse; retain only its top-level values. */
function readDirectorFieldJson(contents: string): Map<DirectorSnapshotField, string> {
  const fields = new Map<DirectorSnapshotField, string>();
  const skipString = (start: number): number => {
    let index = start + 1;
    while (index < contents.length) {
      if (contents[index] === "\\") index += 2;
      else if (contents[index++] === '"') break;
    }
    return index;
  };
  let index = contents.indexOf("{") + 1;
  while (index < contents.length) {
    while (/\s/u.test(contents[index] ?? "")) index += 1;
    if (contents[index] === "}") break;
    const keyEnd = skipString(index);
    const key = JSON.parse(contents.slice(index, keyEnd)) as DirectorSnapshotField;
    index = keyEnd;
    while (/\s/u.test(contents[index] ?? "")) index += 1;
    index += 1; // Colon between the key and its value.
    while (/\s/u.test(contents[index] ?? "")) index += 1;
    const start = index;
    let depth = 0;
    while (index < contents.length) {
      const character = contents[index];
      if (character === '"') {
        index = skipString(index);
        continue;
      }
      if (character === "{" || character === "[") depth += 1;
      else if (character === "}" || character === "]") {
        if (depth === 0) break;
        depth -= 1;
      } else if (character === "," && depth === 0) break;
      index += 1;
    }
    if (directorSnapshotFields.includes(key))
      fields.set(key, contents.slice(start, index).trimEnd());
    if (contents[index] === "}") break;
    index += 1;
  }
  return fields;
}

function readSnapshot(path: string): {
  snapshot: MemoryRepositorySnapshotInput;
  directorFieldJson: Map<DirectorSnapshotField, string>;
} | undefined {
  try {
    const contents = readFileSync(path, "utf8").replace(/^\uFEFF/u, "");
    const parsed = JSON.parse(contents) as {
      version?: unknown;
      canvases?: unknown;
      revisions?: unknown;
      assets?: unknown;
      connections?: unknown;
      directorProfiles?: unknown;
      directorSessions?: unknown;
      directorMessages?: unknown;
      directorProposals?: unknown;
      runs?: unknown;
      nodeRuns?: unknown;
      webhookKeys?: unknown;
    };
    if (
      (parsed.version !== 1 && parsed.version !== 2) ||
      !Array.isArray(parsed.canvases) ||
      !Array.isArray(parsed.revisions) ||
      !Array.isArray(parsed.assets) ||
      !Array.isArray(parsed.connections) ||
      !Array.isArray(parsed.runs) ||
      !Array.isArray(parsed.nodeRuns) ||
      !Array.isArray(parsed.webhookKeys)
    ) {
      throw new Error(`Unsupported local database format: ${path}`);
    }
    if (
      parsed.version === 2 &&
      (!Array.isArray(parsed.directorProfiles) ||
        !Array.isArray(parsed.directorSessions) ||
        !Array.isArray(parsed.directorMessages) ||
        !Array.isArray(parsed.directorProposals))
    ) {
      throw new Error(`Unsupported local database format: ${path}`);
    }
    return {
      snapshot: parsed as unknown as MemoryRepositorySnapshotInput,
      directorFieldJson: readDirectorFieldJson(contents),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export interface FileRepositoryOptions {
  /** Benchmark/import tooling only. Existing external evidence cannot be downgraded. */
  verificationEvidence?: "external" | "inline";
}

export class FileRepository extends MemoryRepository {
  private catalogGate: Promise<void> | null = null;
  private activeMutations = 0;
  private readonly mutationScope = new AsyncLocalStorage<boolean>();
  private readonly mutationIdleWaiters: Array<() => void> = [];
  private completedWriteGeneration = 0;
  private requestedWriteGeneration = 0;
  private writeLoop: Promise<void> | null = null;
  private readonly writeWaiters: Array<{
    generation: number;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private writeSequence = 0;
  private needsSnapshotWrite: boolean;
  private readonly path: string;
  private readonly replaceFile: typeof rename;
  private readonly ownedJson = new OwnedJsonMemo(256, 8 * 1024 * 1024);
  private readonly catalogSidecars: CatalogSidecarStore;
  private readonly evidenceStore: VerificationEvidenceStore;
  private readonly externalEvidence: boolean;
  private readonly evidenceCache = new WeakMap<SupplierVerificationRecord, {
    reference: VerificationEvidenceReference; summary: StoredVerificationSummary;
  }>();
  private readonly preservedDirectorFields = new Map<
    string,
    { originalJson: string; loadedJson: string }
  >();

  constructor(path: string, replaceFile: typeof rename = rename, options: FileRepositoryOptions = {}) {
    const storedFile = readSnapshot(path);
    const stored = storedFile?.snapshot;
    const sidecars = new CatalogSidecarStore(path, stored?.version === 2 ? stored.applicationSettings : undefined);
    const evidenceStore = new VerificationEvidenceStore(verificationEvidenceDirectory(path));
    const evidenceReferences = readVerificationEvidenceSnapshot(sidecars.settings[VERIFICATION_EVIDENCE_SETTING]);
    if (options.verificationEvidence === "inline" && evidenceReferences)
      throw new Error("Cannot downgrade an external verification evidence snapshot");
    const records = stored?.version === 2
      ? evidenceStore.hydrateRecordsSync(stored.supplierVerifications ?? [], evidenceReferences) : undefined;
    // Storage references never leak into portable in-memory snapshots or DTOs.
    delete sidecars.settings[VERIFICATION_EVIDENCE_SETTING];
    const compacted = compactSnapshot(
      stored ? { ...migrateMemoryRepositorySnapshot(stored), applicationSettings: sidecars.settings,
        ...(records ? { supplierVerifications: records } : {}) } : undefined,
    );
    super(compacted.snapshot);
    this.path = path;
    this.catalogSidecars = sidecars;
    this.evidenceStore = evidenceStore;
    this.externalEvidence = options.verificationEvidence !== "inline";
    this.replaceFile = replaceFile;
    this.needsSnapshotWrite = compacted.changed || stored?.version === 1;
    const loadedSnapshot = this.exportSnapshotView();
    for (const row of loadedSnapshot.supplierVerifications ?? []) {
      const reference = evidenceReferences && Object.hasOwn(evidenceReferences.entries, row.id)
        ? evidenceReferences.entries[row.id] : undefined;
      if (reference) this.evidenceCache.set(row, { reference, summary: verificationEvidenceSummary(row) });
    }
    this.needsSnapshotWrite ||= this.externalEvidence && Boolean(loadedSnapshot.supplierVerifications?.length) && !evidenceReferences;
    sidecars.adoptReferences(loadedSnapshot.applicationSettings ?? {});
    this.needsSnapshotWrite ||= sidecars.hasUnmigrated(loadedSnapshot.applicationSettings ?? {});
    for (const [field, originalJson] of storedFile?.directorFieldJson ?? []) {
      this.preservedDirectorFields.set(field, {
        originalJson,
        loadedJson: JSON.stringify(loadedSnapshot[field]),
      });
    }
    // Keep normal saves concurrent/coalesced, but admit none while a catalog
    // candidate is being made durable. Reentrant MemoryRepository calls remain
    // part of their original mutation, avoiding nested-save deadlocks.
    for (const name of ["flush", "saveSupplierVerification", "ensureDefaultCanvas", "saveCanvas", "deleteCanvas", "saveAsset",
      "updateImageDesignReview", "deleteAsset", "deleteAssets", "saveConnection", "saveSupplier", "commitSupplier", "deleteConnection",
      "saveDirectorProfile", "deleteDirectorProfile", "createDirectorSession", "updateDirectorSession", "deleteDirectorSession",
      "createDirectorMessage", "updateDirectorMessage", "deleteDirectorMessage", "createDirectorProposal", "updateDirectorProposal",
      "deleteDirectorProposal", "createRun", "updateRun", "transitionRunStatus", "createNodeRun", "updateNodeRun", "saveWebhookEvent"]) {
      const original = Reflect.get(this, name) as (...args: unknown[]) => Promise<unknown>;
      Object.defineProperty(this, name, { configurable: true, writable: true,
        value: (...args: unknown[]) => this.withMutation(() => original.apply(this, args)) });
    }
  }

  private withMutation<T>(work: () => Promise<T>): Promise<T> {
    if (this.mutationScope.getStore()) return work();
    if (this.catalogGate) return this.catalogGate.then(() => this.withMutation(work));
    this.activeMutations++;
    const done = () => { this.activeMutations--; if (!this.activeMutations) for (const resolve of this.mutationIdleWaiters.splice(0)) resolve(); };
    try { return this.mutationScope.run(true, work).finally(done); }
    catch (error) { done(); return Promise.reject(error); }
  }

  private catalogTransaction(candidate: (current: MemoryRepositorySnapshot) => MemoryRepositorySnapshot, publish: () => Promise<void>, stateOnlyKey?: string): Promise<void> {
    const previous = this.catalogGate;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    this.catalogGate = gate;
    const work = async () => {
      if (previous) await previous;
      if (this.activeMutations) await new Promise<void>(resolve => { this.mutationIdleWaiters.push(resolve); });
      if (this.writeLoop) await this.writeLoop;
      await this.catalogSidecars.recover((path, contents) => this.replaceDurableFile(path, contents));
      // Reuse untouched records while saves are gated. A catalog check need not
      // clone the user's canvases, media or conversation history into memory.
      const next = candidate(this.exportSnapshotView());
      if (stateOnlyKey && !this.catalogSidecars.hasUnmigrated(next.applicationSettings ?? {}) &&
        await this.catalogSidecars.writeState(stateOnlyKey, next.applicationSettings?.[stateOnlyKey],
          (path, contents) => this.replaceDurableFile(path, contents), publish)) {
        this.catalogSidecars.adoptReferences(this.exportSnapshotView().applicationSettings ?? {});
        return;
      }
      await this.persistSnapshot(next, publish);
      this.catalogSidecars.adoptReferences(this.exportSnapshotView().applicationSettings ?? {});
      // No foreground mutation can have entered since the candidate was built.
      // Only a successful atomic replacement publishes in-memory records.
      this.needsSnapshotWrite = false;
    };
    return work().finally(() => { if (this.catalogGate === gate) this.catalogGate = null; release(); });
  }

  private serializeSnapshot(snapshot: MemoryRepositorySnapshot): string {
    const properties: string[] = [];
    for (const [key, value] of Object.entries(snapshot)) {
      // These two stores use copy-on-write owned rows. Reuse their JSON without
      // cloning/stringifying all other suppliers on every scheduler checkpoint.
      // The final snapshot, barrier, CAS and single atomic rename stay intact.
      const serialized = key === "connections"
          ? `[${snapshot.connections.map(row => this.ownedJson.stringify(`connection:${row.id}`, row)).join(",")}]`
          : JSON.stringify(value);
      if (serialized === undefined) continue;
      const preserved = this.preservedDirectorFields.get(key);
      // Current agent sessions share these tables. Preserve untouched historical
      // JSON verbatim, while allowing genuine agent mutations to persist normally.
      const json = preserved?.loadedJson === serialized
        ? preserved.originalJson
        : serialized;
      properties.push(`${JSON.stringify(key)}:${json}`);
    }
    return `{${properties.join(",")}}`;
  }

  private async replaceSnapshot(
    temporaryPath: string,
    contents: string,
  ): Promise<void> {
    await this.replaceDurableFile(this.path, contents, temporaryPath);
  }

  private async replaceDurableFile(path: string, contents: string,
    temporaryPath = `${path}.${process.pid}.${++this.writeSequence}.tmp`): Promise<void> {
    await mkdir(dirname(path), { recursive: true });

    // Windows can briefly hold the destination while another reader closes it.
    // Retry the atomic replacement instead of poisoning the save queue.
    const retryableCodes = new Set(["EPERM", "EACCES", "EBUSY", "ETXTBSY"]);
    try {
      const file = await open(temporaryPath, "w");
      try { await file.writeFile(contents, "utf8"); await file.sync(); }
      finally { await file.close(); }
      for (let attempt = 0; ; attempt += 1) {
        try {
          await this.replaceFile(temporaryPath, path);
          // Directory fsync is available on POSIX. Windows does not permit
          // opening a directory; the fully synced file is still atomically replaced.
          try {
            const directory = await open(dirname(path), "r");
            try { await directory.sync(); } finally { await directory.close(); }
          } catch (error) {
            if (process.platform !== "win32" || !["EPERM", "EACCES", "EISDIR", "EINVAL", "ENOTSUP", "EBADF"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          }
          return;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (!retryableCodes.has(code ?? "") || attempt >= 7) throw error;
          await delay(Math.min(25 * 2 ** attempt, 500));
        }
      }
    } finally {
      // A killed/rejected replacement must not leave a truncated snapshot that
      // looks like a future write. The rename-success path is already gone, so
      // this is safe for both normal and failed replacements.
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  private async persistSnapshot(snapshot: MemoryRepositorySnapshot, publish?: () => Promise<void>): Promise<void> {
    await this.catalogSidecars.recover((path, contents) => this.replaceDurableFile(path, contents));
    const withEvidence = await this.externalizeEvidence(snapshot);
    const prepared = await this.catalogSidecars.prepare(snapshot.applicationSettings ?? {},
      (path, contents) => this.replaceDurableFile(path, contents));
    const diskSnapshot = { ...withEvidence, applicationSettings: this.catalogSidecars.mainSettings(withEvidence.applicationSettings ?? {}, prepared.marker) };
    const contents = this.serializeSnapshot(diskSnapshot);
    try {
      await this.replaceSnapshot(`${this.path}.${process.pid}.${++this.writeSequence}.tmp`, contents);
    } catch (error) {
      // A rename can land before directory fsync (or an injected error) fails.
      // Compare complete bytes only on failure: an unchanged marker alone does
      // not prove that a legacy business-only candidate reached disk.
      let landed = false;
      try { landed = readFileSync(this.path, "utf8") === contents; } catch { /* No durable replacement can be proved. */ }
      if (landed) {
        this.catalogSidecars.accept(prepared, snapshot.applicationSettings ?? {});
        if (publish) await publish();
      }
      throw error;
    }
    // The main atomic rename is the commit point. Publish memory before
    // finalizing the sidecar so even a finalization error cannot expose old
    // business rows next to a committed new queue/counter on disk.
    this.catalogSidecars.accept(prepared, snapshot.applicationSettings ?? {});
    if (publish) await publish();
    await this.catalogSidecars.recover((path, contents) => this.replaceDurableFile(path, contents));
  }

  private async externalizeEvidence(snapshot: MemoryRepositorySnapshot): Promise<MemoryRepositorySnapshot> {
    const records = snapshot.supplierVerifications ?? [];
    if (!this.externalEvidence || !records.length) return snapshot;
    const entries: Record<string, VerificationEvidenceReference> = Object.create(null) as Record<string, VerificationEvidenceReference>;
    const summaries: StoredVerificationSummary[] = [];
    for (const record of records) {
      if (Object.hasOwn(entries, record.id)) throw new Error("Duplicate verification evidence identity");
      let cached = this.evidenceCache.get(record);
      if (!cached) {
        cached = { reference: await this.evidenceStore.writeRecord(record), summary: verificationEvidenceSummary(record) };
        // Only immutable repository-owned rows are memoized. Public inputs and
        // returned DTOs are clones, and updates replace the owned row identity.
        this.evidenceCache.set(record, cached);
      }
      entries[record.id] = cached.reference;
      summaries.push(cached.summary);
    }
    return { ...snapshot, supplierVerifications: summaries, applicationSettings: {
      ...snapshot.applicationSettings, [VERIFICATION_EVIDENCE_SETTING]: { schemaVersion: 1, entries },
    } };
  }

  private resolveWriteWaiters(): void {
    for (let index = this.writeWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.writeWaiters[index]!;
      if (waiter.generation > this.completedWriteGeneration) continue;
      this.writeWaiters.splice(index, 1);
      waiter.resolve();
    }
  }

  private rejectWriteWaiters(error: unknown): void {
    const waiters = this.writeWaiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }

  private async flushWrites(): Promise<void> {
    try {
      while (this.completedWriteGeneration < this.requestedWriteGeneration) {
        const generation = this.requestedWriteGeneration;
        const compacted = compactSnapshot(this.exportSnapshotView());
        const snapshot = compacted.snapshot ?? this.exportSnapshotView();
        this.applyCompactedRecords(snapshot);
        await this.persistSnapshot(snapshot);
        this.completedWriteGeneration = generation;
        this.needsSnapshotWrite = generation < this.requestedWriteGeneration;
        this.resolveWriteWaiters();
      }
    } catch (error) {
      // A later mutation retries the complete current snapshot. Resetting the
      // generation prevents a failed filesystem write from spinning forever.
      this.requestedWriteGeneration = this.completedWriteGeneration;
      // In-memory records remain available for recovery. A cached canvas must
      // not be acknowledged as initialized until this dirty snapshot is saved.
      this.needsSnapshotWrite = true;
      this.rejectWriteWaiters(error);
      throw error;
    }
  }

  private ensureWriteLoop(): void {
    if (this.writeLoop) return;
    const loop = this.flushWrites();
    this.writeLoop = loop;
    void loop
      .catch(() => undefined)
      .finally(() => {
        if (this.writeLoop === loop) this.writeLoop = null;
        if (
          this.writeWaiters.length > 0 &&
          this.completedWriteGeneration < this.requestedWriteGeneration
        )
          this.ensureWriteLoop();
      });
  }

  private persist(): Promise<void> {
    this.needsSnapshotWrite = true;
    const generation = ++this.requestedWriteGeneration;
    const result = new Promise<void>((resolve, reject) => {
      this.writeWaiters.push({ generation, resolve, reject });
    });
    this.ensureWriteLoop();
    return result;
  }

  /** Explicit durability barrier used before a desktop process exits. */
  async flush(): Promise<void> {
    await this.persist();
  }

  override async saveSupplierVerification(input: Parameters<MemoryRepository["saveSupplierVerification"]>[0], expectedRevision: number) {
    const result = await super.saveSupplierVerification(input, expectedRevision);
    await this.persist();
    return result;
  }

  override async ensureDefaultCanvas(): Promise<CanvasRecord> {
    const existing = await this.listCanvases();
    const result = await super.ensureDefaultCanvas();
    if (existing.length === 0 || this.needsSnapshotWrite) await this.persist();
    return result;
  }

  override async saveCanvas(
    input: Parameters<MemoryRepository["saveCanvas"]>[0],
  ): Promise<CanvasRecord> {
    const previousRevision = this.savedCanvasRevision(input.id);
    const result = await super.saveCanvas(input);
    if (previousRevision === result.revision) {
      // A prior failed or still-running write must become durable before a
      // matching autosave is acknowledged. Clean no-ops do not write or prune.
      if (this.writeLoop) await this.writeLoop;
      if (this.needsSnapshotWrite) await this.persist();
      return result;
    }
    this.pruneCanvasRevisions(input.id, LOCAL_CANVAS_REVISION_LIMIT);
    await this.persist();
    return result;
  }

  override async deleteCanvas(id: string): Promise<void> {
    await super.deleteCanvas(id);
    await this.persist();
  }

  override async saveAsset(
    input: Omit<AssetRecord, "createdAt" | "deleted"> & {
      createdAt?: string;
      deleted?: boolean;
    },
  ): Promise<AssetRecord> {
    const result = await super.saveAsset(input);
    await this.persist();
    return result;
  }

  override async updateImageDesignReview(
    id: string,
    input: Parameters<MemoryRepository["updateImageDesignReview"]>[1],
  ): Promise<AssetRecord | null> {
    const result = await super.updateImageDesignReview(id, input);
    if (result) await this.persist();
    return result;
  }

  override async deleteAsset(id: string): Promise<void> {
    await super.deleteAsset(id);
    await this.persist();
  }

  override async deleteAssets(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await super.deleteAssets(ids);
    await this.persist();
  }

  override async saveConnection(
    input: Omit<ProviderConnectionRecord, "createdAt" | "updatedAt">,
    options: ConnectionSaveOptions = {},
  ): Promise<ProviderConnectionRecord> {
    const result = await super.saveConnection(input, options);
    await this.persist();
    return result;
  }

  override async setApplicationSetting(key: string, value: unknown): Promise<void> {
    const saved = structuredClone(value);
    await this.catalogTransaction(snapshot => ({ ...snapshot, applicationSettings: { ...snapshot.applicationSettings, [key]: saved } }),
      () => super.setApplicationSetting(key, saved), isCatalogSidecarSetting(key) ? key : undefined);
  }

  override async commitCatalogSnapshot(input: Parameters<MemoryRepository["commitCatalogSnapshot"]>[0]): Promise<void> {
    const commit = structuredClone(input);
    await this.catalogTransaction(snapshot => {
      this.assertCatalogSnapshot(commit);
      const connections = new Map(commit.connections.map(row => [row.id, row]));
      return { ...snapshot, suppliers: snapshot.suppliers?.map(row => commit.supplier && row.id === commit.supplier.id ? commit.supplier : row),
        connections: snapshot.connections.map(row => connections.get(row.id) ?? row) };
    }, () => super.commitCatalogSnapshot(commit));
  }

  override async reserveCatalogObservation(input: Parameters<MemoryRepository["reserveCatalogObservation"]>[0]): Promise<CatalogObservationReservation> {
    const request = structuredClone(input);
    let reservation!: CatalogObservationReservation, prepared!: CatalogObservationPrepared;
    await this.catalogTransaction(snapshot => {
      const result = prepareCatalogReservation(this.catalogObservationView(request.identity.supplierId), request,
        (value, supplierId) => this.assertStoredCatalogPipelineState(value, supplierId));
      reservation = structuredClone(result.reservation);
      prepared = { connections: [], pipeline: result.pipeline };
      return { ...snapshot, applicationSettings: { ...snapshot.applicationSettings,
        [catalogPipelineSettingKey(result.pipeline.supplierId)]: result.pipeline } };
    }, async () => { this.publishCatalogObservation(prepared); }, catalogPipelineSettingKey(request.identity.supplierId));
    return reservation;
  }

  override async commitCatalogObservation(input: Parameters<MemoryRepository["commitCatalogObservation"]>[0]): ReturnType<MemoryRepository["commitCatalogObservation"]> {
    const request = structuredClone(input);
    let prepared!: CatalogObservationPrepared;
    await this.catalogTransaction(snapshot => {
      prepared = this.prepareCatalogObservation(request);
      const rows = new Map(prepared.connections.map(row => [row.id, row]));
      return { ...snapshot, applicationSettings: { ...snapshot.applicationSettings,
        [catalogPipelineSettingKey(prepared.pipeline.supplierId)]: prepared.pipeline },
        suppliers: snapshot.suppliers?.map(row => row.id === prepared.supplier?.id ? prepared.supplier : row),
        connections: snapshot.connections.map(row => rows.get(row.id) ?? row) };
    }, async () => { this.publishCatalogObservation(prepared); },
      request.connections?.length || request.groups?.length || request.supplierFields ? undefined : catalogPipelineSettingKey(request.reservation.identity.supplierId));
    return this.catalogPipelineResult(prepared.pipeline, request.resultEntryKeys, request.resultEntryPrefixes);
  }

  override async updateCatalogPipelineState(input: Parameters<MemoryRepository["updateCatalogPipelineState"]>[0]): ReturnType<MemoryRepository["updateCatalogPipelineState"]> {
    const request = structuredClone(input);
    let prepared!: CatalogObservationPrepared;
    await this.catalogTransaction(snapshot => {
      const pipeline = prepareCatalogPipelineUpdate(this.catalogObservationView(request.identity.supplierId), request,
        (value, supplierId) => this.assertStoredCatalogPipelineState(value, supplierId));
      prepared = { connections: [], pipeline };
      return { ...snapshot, applicationSettings: { ...snapshot.applicationSettings, [catalogPipelineSettingKey(pipeline.supplierId)]: pipeline } };
    }, async () => { this.publishCatalogObservation(prepared); }, catalogPipelineSettingKey(request.identity.supplierId));
    return this.catalogPipelineResult(prepared.pipeline, request.resultEntryKeys, request.resultEntryPrefixes);
  }

  override async saveSupplier(
    input: Omit<SupplierRecord, "createdAt" | "updatedAt">,
  ): Promise<SupplierRecord> {
    const result = await super.saveSupplier(input);
    await this.persist();
    return result;
  }

  override async commitSupplier(
    input: SupplierCommit,
  ): Promise<SupplierRecord> {
    const result = await super.commitSupplier(input);
    await this.persist();
    return result;
  }

  override async deleteConnection(id: string): Promise<void> {
    await super.deleteConnection(id);
    await this.persist();
  }

  override async saveDirectorProfile(
    input: Omit<DirectorProfileRecord, "createdAt" | "updatedAt">,
  ): Promise<DirectorProfileRecord> {
    const result = await super.saveDirectorProfile(input);
    await this.persist();
    return result;
  }

  override async deleteDirectorProfile(id: string): Promise<void> {
    await super.deleteDirectorProfile(id);
    await this.persist();
  }

  override async createDirectorSession(
    input: Omit<DirectorSessionRecord, "createdAt" | "updatedAt">,
  ): Promise<DirectorSessionRecord> {
    const result = await super.createDirectorSession(input);
    await this.persist();
    return result;
  }

  override async updateDirectorSession(
    id: string,
    patch: Partial<
      Pick<DirectorSessionRecord, "title" | "metadata" | "profileId">
    >,
    options?: { expectedTurnId: string | null },
  ): Promise<DirectorSessionRecord | null> {
    const result = await super.updateDirectorSession(id, patch, options);
    if (result) await this.persist();
    return result;
  }

  override async deleteDirectorSession(id: string): Promise<void> {
    await super.deleteDirectorSession(id);
    await this.persist();
  }

  override async createDirectorMessage(
    input: Omit<DirectorMessageRecord, "createdAt">,
  ): Promise<DirectorMessageRecord> {
    const result = await super.createDirectorMessage(input);
    await this.persist();
    return result;
  }

  override async updateDirectorMessage(
    id: string,
    patch: Partial<Pick<DirectorMessageRecord, "content" | "metadata">>,
  ): Promise<DirectorMessageRecord | null> {
    const result = await super.updateDirectorMessage(id, patch);
    if (result) await this.persist();
    return result;
  }

  override async deleteDirectorMessage(id: string): Promise<void> {
    await super.deleteDirectorMessage(id);
    await this.persist();
  }

  override async createDirectorProposal(
    input: Omit<DirectorProposalRecord, "createdAt" | "updatedAt">,
  ): Promise<DirectorProposalRecord> {
    const result = await super.createDirectorProposal(input);
    await this.persist();
    return result;
  }

  override async updateDirectorProposal(
    id: string,
    patch: Partial<
      Omit<
        DirectorProposalRecord,
        "id" | "sessionId" | "canvasId" | "createdAt" | "updatedAt"
      >
    >,
    options: DirectorProposalUpdateOptions = {},
  ): Promise<DirectorProposalRecord | null> {
    const result = await super.updateDirectorProposal(id, patch, options);
    if (result) await this.persist();
    return result;
  }

  override async deleteDirectorProposal(id: string): Promise<void> {
    await super.deleteDirectorProposal(id);
    await this.persist();
  }

  override async createRun(
    input: Omit<WorkflowRunRecord, "createdAt" | "updatedAt">,
  ): Promise<WorkflowRunRecord> {
    const result = await super.createRun(input);
    await this.persist();
    return result;
  }

  override async updateRun(
    id: string,
    patch: Partial<Pick<WorkflowRunRecord, "status" | "updatedAt">>,
  ): Promise<WorkflowRunRecord | null> {
    const result = await super.updateRun(id, patch);
    if (result) await this.persist();
    return result;
  }

  override async transitionRunStatus(
    id: string,
    fromStatuses: readonly WorkflowStatus[],
    status: WorkflowStatus,
  ): Promise<WorkflowRunRecord | null> {
    const result = await super.transitionRunStatus(id, fromStatuses, status);
    if (result) await this.persist();
    return result;
  }

  override async createNodeRun(
    input: Omit<NodeRunRecord, "createdAt" | "updatedAt">,
  ): Promise<NodeRunRecord> {
    const result = await super.createNodeRun(input);
    await this.persist();
    return result;
  }

  override async updateNodeRun(
    id: string,
    patch: Partial<Omit<NodeRunRecord, "id" | "createdAt" | "updatedAt">>,
    options: NodeRunUpdateOptions = {},
  ): Promise<NodeRunRecord | null> {
    const result = await super.updateNodeRun(id, patch, options);
    if (result) await this.persist();
    return result;
  }

  override async saveWebhookEvent(input: WebhookEventRecord): Promise<boolean> {
    const saved = await super.saveWebhookEvent(input);
    if (saved) await this.persist();
    return saved;
  }
}

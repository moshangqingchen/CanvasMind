import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
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

function readSnapshot(path: string): MemoryRepositorySnapshotInput | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
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
    return parsed as unknown as MemoryRepositorySnapshotInput;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export class FileRepository extends MemoryRepository {
  private completedWriteGeneration = 0;
  private requestedWriteGeneration = 0;
  private writeLoop: Promise<void> | null = null;
  private readonly writeWaiters: Array<{
    generation: number;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private writeSequence = 0;
  private needsCompaction: boolean;
  private readonly path: string;
  private readonly replaceFile: typeof rename;

  constructor(path: string, replaceFile: typeof rename = rename) {
    const stored = readSnapshot(path);
    const compacted = compactSnapshot(
      stored ? migrateMemoryRepositorySnapshot(stored) : undefined,
    );
    super(compacted.snapshot);
    this.path = path;
    this.replaceFile = replaceFile;
    this.needsCompaction = compacted.changed || stored?.version === 1;
  }

  private async replaceSnapshot(
    temporaryPath: string,
    contents: string,
  ): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(temporaryPath, contents, "utf8");

    // Windows can briefly hold the destination while another reader closes it.
    // Retry the atomic replacement instead of poisoning the save queue.
    const retryableCodes = new Set(["EPERM", "EACCES", "EBUSY", "ETXTBSY"]);
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await this.replaceFile(temporaryPath, this.path);
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
        const contents = JSON.stringify(snapshot);
        const temporaryPath = `${this.path}.${process.pid}.${++this.writeSequence}.tmp`;
        await this.replaceSnapshot(temporaryPath, contents);
        this.completedWriteGeneration = generation;
        this.needsCompaction = false;
        this.resolveWriteWaiters();
      }
    } catch (error) {
      // A later mutation retries the complete current snapshot. Resetting the
      // generation prevents a failed filesystem write from spinning forever.
      this.requestedWriteGeneration = this.completedWriteGeneration;
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
    const generation = ++this.requestedWriteGeneration;
    const result = new Promise<void>((resolve, reject) => {
      this.writeWaiters.push({ generation, resolve, reject });
    });
    this.ensureWriteLoop();
    return result;
  }

  override async ensureDefaultCanvas(): Promise<CanvasRecord> {
    const existing = await this.listCanvases();
    const result = await super.ensureDefaultCanvas();
    if (existing.length === 0 || this.needsCompaction) await this.persist();
    return result;
  }

  override async saveCanvas(
    input: Parameters<MemoryRepository["saveCanvas"]>[0],
  ): Promise<CanvasRecord> {
    const result = await super.saveCanvas(input);
    this.pruneCanvasRevisions(input.id, LOCAL_CANVAS_REVISION_LIMIT);
    await this.persist();
    return result;
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
  ): Promise<ProviderConnectionRecord> {
    const result = await super.saveConnection(input);
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
  ): Promise<DirectorSessionRecord | null> {
    const result = await super.updateDirectorSession(id, patch);
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

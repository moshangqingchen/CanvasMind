import { randomUUID } from "node:crypto";
import type {
  AssetRecord,
  CanvasRecord,
  CanvasRevisionRecord,
  JsonObject,
  NodeRunRecord,
  ProviderConnectionRecord,
  Repository,
  NodeRunUpdateOptions,
  WebhookEventRecord,
  WorkflowRunRecord,
} from "./types.js";

const now = (): string => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);

export interface MemoryRepositorySnapshot {
  version: 1;
  canvases: CanvasRecord[];
  revisions: CanvasRevisionRecord[];
  assets: AssetRecord[];
  connections: ProviderConnectionRecord[];
  runs: WorkflowRunRecord[];
  nodeRuns: NodeRunRecord[];
  webhookKeys: string[];
}

export class MemoryRepository implements Repository {
  private readonly canvases = new Map<string, CanvasRecord>();
  private readonly revisions = new Map<string, CanvasRevisionRecord>();
  private readonly assets = new Map<string, AssetRecord>();
  private readonly connections = new Map<string, ProviderConnectionRecord>();
  private readonly runs = new Map<string, WorkflowRunRecord>();
  private readonly nodeRuns = new Map<string, NodeRunRecord>();
  private readonly webhookKeys = new Set<string>();

  constructor(snapshot?: MemoryRepositorySnapshot) {
    if (!snapshot) return;
    for (const record of snapshot.canvases)
      this.canvases.set(record.id, clone(record));
    for (const record of snapshot.revisions)
      this.revisions.set(record.id, clone(record));
    for (const record of snapshot.assets)
      this.assets.set(record.id, clone(record));
    for (const record of snapshot.connections)
      this.connections.set(record.id, clone(record));
    for (const record of snapshot.runs) this.runs.set(record.id, clone(record));
    for (const record of snapshot.nodeRuns)
      this.nodeRuns.set(record.id, clone(record));
    for (const key of snapshot.webhookKeys) this.webhookKeys.add(key);
  }

  public exportSnapshot(): MemoryRepositorySnapshot {
    return clone({
      version: 1,
      canvases: [...this.canvases.values()],
      revisions: [...this.revisions.values()],
      assets: [...this.assets.values()],
      connections: [...this.connections.values()],
      runs: [...this.runs.values()],
      nodeRuns: [...this.nodeRuns.values()],
      webhookKeys: [...this.webhookKeys],
    });
  }

  async ensureDefaultCanvas(): Promise<CanvasRecord> {
    const existing = [...this.canvases.values()][0];
    if (existing) return clone(existing);
    const timestamp = now();
    const record: CanvasRecord = {
      id: randomUUID(),
      title: "我的第一个工作流",
      graph: {
        schemaVersion: 1,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.canvases.set(record.id, record);
    return clone(record);
  }

  async listCanvases(): Promise<CanvasRecord[]> {
    return [...this.canvases.values()].map(clone);
  }

  async getCanvas(id: string): Promise<CanvasRecord | null> {
    const record = this.canvases.get(id);
    return record ? clone(record) : null;
  }

  async saveCanvas(input: {
    id: string;
    title?: string;
    graph: JsonObject;
    reason?: string;
  }): Promise<CanvasRecord> {
    const previous = this.canvases.get(input.id);
    const timestamp = now();
    const record: CanvasRecord = previous
      ? {
          ...previous,
          title: input.title ?? previous.title,
          graph: clone(input.graph),
          revision: previous.revision + 1,
          updatedAt: timestamp,
        }
      : {
          id: input.id,
          title: input.title ?? "未命名画布",
          graph: clone(input.graph),
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
    this.canvases.set(record.id, record);
    const revision: CanvasRevisionRecord = {
      id: randomUUID(),
      canvasId: record.id,
      graph: clone(record.graph),
      reason: input.reason ?? "autosave",
      createdAt: timestamp,
    };
    this.revisions.set(revision.id, revision);
    return clone(record);
  }

  async listRevisions(canvasId: string): Promise<CanvasRevisionRecord[]> {
    return [...this.revisions.values()]
      .filter((item) => item.canvasId === canvasId)
      .map(clone);
  }

  async listAssets(): Promise<AssetRecord[]> {
    return [...this.assets.values()]
      .filter((item) => !item.deleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async getAsset(id: string): Promise<AssetRecord | null> {
    const record = this.assets.get(id);
    return record && !record.deleted ? clone(record) : null;
  }

  async saveAsset(
    input: Omit<AssetRecord, "createdAt" | "deleted"> & {
      createdAt?: string;
      deleted?: boolean;
    },
  ): Promise<AssetRecord> {
    const record: AssetRecord = {
      ...input,
      createdAt: input.createdAt ?? now(),
      deleted: input.deleted ?? false,
      metadata: clone(input.metadata),
    };
    this.assets.set(record.id, record);
    return clone(record);
  }

  async deleteAsset(id: string): Promise<void> {
    const existing = this.assets.get(id);
    if (existing) this.assets.set(id, { ...existing, deleted: true });
  }

  async deleteAssets(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      const existing = this.assets.get(id);
      if (existing) this.assets.set(id, { ...existing, deleted: true });
    }
  }

  async listConnections(): Promise<ProviderConnectionRecord[]> {
    return [...this.connections.values()].map(clone);
  }

  async getConnection(id: string): Promise<ProviderConnectionRecord | null> {
    const record = this.connections.get(id);
    return record ? clone(record) : null;
  }

  async saveConnection(
    input: Omit<ProviderConnectionRecord, "createdAt" | "updatedAt">,
  ): Promise<ProviderConnectionRecord> {
    const previous = this.connections.get(input.id);
    const timestamp = now();
    const record: ProviderConnectionRecord = {
      ...input,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
      config: clone(input.config),
    };
    this.connections.set(record.id, record);
    return clone(record);
  }

  async deleteConnection(id: string): Promise<void> {
    this.connections.delete(id);
  }

  async getRunByClientRequest(
    canvasId: string,
    clientRequestId: string,
  ): Promise<WorkflowRunRecord | null> {
    const record = [...this.runs.values()].find(
      (item) =>
        item.canvasId === canvasId && item.clientRequestId === clientRequestId,
    );
    return record ? clone(record) : null;
  }

  async createRun(
    input: Omit<WorkflowRunRecord, "createdAt" | "updatedAt">,
  ): Promise<WorkflowRunRecord> {
    const existing = [...this.runs.values()].find(
      (run) =>
        run.canvasId === input.canvasId &&
        run.clientRequestId === input.clientRequestId,
    );
    if (existing) return clone(existing);
    if (this.runs.has(input.id))
      throw new Error(`Run already exists: ${input.id}`);
    const timestamp = now();
    const record = {
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
      revisionGraph: clone(input.revisionGraph),
    };
    this.runs.set(record.id, record);
    return clone(record);
  }

  async getRun(id: string): Promise<WorkflowRunRecord | null> {
    const record = this.runs.get(id);
    return record ? clone(record) : null;
  }

  async listRuns(canvasId?: string): Promise<WorkflowRunRecord[]> {
    return [...this.runs.values()]
      .filter((run) => !canvasId || run.canvasId === canvasId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async listRunsByStatus(
    statuses: readonly WorkflowRunRecord["status"][],
  ): Promise<WorkflowRunRecord[]> {
    const allowed = new Set(statuses);
    return [...this.runs.values()]
      .filter((run) => allowed.has(run.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async listRecoverableRuns(): Promise<WorkflowRunRecord[]> {
    return [...this.runs.values()]
      .filter((run) => run.status === "queued" || run.status === "running")
      .map(clone);
  }

  async updateRun(
    id: string,
    patch: Partial<Pick<WorkflowRunRecord, "status" | "updatedAt">>,
  ): Promise<WorkflowRunRecord | null> {
    const existing = this.runs.get(id);
    if (!existing) return null;
    if (
      existing.status === "cancelled" &&
      patch.status !== undefined &&
      patch.status !== "cancelled"
    ) {
      return clone(existing);
    }
    const record = {
      ...existing,
      ...patch,
      updatedAt: patch.updatedAt ?? now(),
    };
    this.runs.set(id, record);
    return clone(record);
  }

  async transitionRunStatus(
    id: string,
    fromStatuses: readonly WorkflowRunRecord["status"][],
    status: WorkflowRunRecord["status"],
  ): Promise<WorkflowRunRecord | null> {
    const existing = this.runs.get(id);
    if (!existing || !fromStatuses.includes(existing.status)) return null;
    const record = { ...existing, status, updatedAt: now() };
    this.runs.set(id, record);
    return clone(record);
  }

  async listNodeRuns(runId: string): Promise<NodeRunRecord[]> {
    return [...this.nodeRuns.values()]
      .filter((item) => item.workflowRunId === runId)
      .map(clone);
  }

  async createNodeRun(
    input: Omit<NodeRunRecord, "createdAt" | "updatedAt">,
  ): Promise<NodeRunRecord> {
    const existing = [...this.nodeRuns.values()].find(
      (nodeRun) =>
        nodeRun.workflowRunId === input.workflowRunId &&
        nodeRun.nodeId === input.nodeId,
    );
    if (existing) return clone(existing);
    if (this.nodeRuns.has(input.id))
      throw new Error(`Node run already exists: ${input.id}`);
    const timestamp = now();
    const record = {
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
      inputJson: clone(input.inputJson),
      outputAssetIds: [...input.outputAssetIds],
    };
    this.nodeRuns.set(record.id, record);
    return clone(record);
  }

  async updateNodeRun(
    id: string,
    patch: Partial<Omit<NodeRunRecord, "id" | "createdAt" | "updatedAt">>,
    options: NodeRunUpdateOptions = {},
  ): Promise<NodeRunRecord | null> {
    const existing = this.nodeRuns.get(id);
    if (!existing) return null;
    if (
      (options.expectedStatus !== undefined &&
        existing.status !== options.expectedStatus) ||
      (options.expectedUpdatedAt !== undefined &&
        existing.updatedAt !== options.expectedUpdatedAt)
    ) {
      return null;
    }
    if (
      (existing.status === "cancelled" ||
        existing.status === "cancel_requested") &&
      patch.status !== undefined &&
      patch.status !== "cancelled" &&
      (existing.status === "cancelled" || patch.status !== "cancel_requested")
    ) {
      return null;
    }
    const record: NodeRunRecord = {
      ...existing,
      ...patch,
      updatedAt: now(),
      inputJson: patch.inputJson ? clone(patch.inputJson) : existing.inputJson,
      outputAssetIds: patch.outputAssetIds
        ? [...patch.outputAssetIds]
        : existing.outputAssetIds,
    };
    this.nodeRuns.set(id, record);
    return clone(record);
  }

  async getNodeRun(id: string): Promise<NodeRunRecord | null> {
    const record = this.nodeRuns.get(id);
    return record ? clone(record) : null;
  }

  async findNodeRunByProviderTaskId(
    providerTaskId: string,
    connectionId?: string,
  ): Promise<NodeRunRecord | null> {
    const record = [...this.nodeRuns.values()].find(
      (item) =>
        item.providerTaskId === providerTaskId &&
        (connectionId === undefined ||
          item.inputJson.connectionId === connectionId),
    );
    return record ? clone(record) : null;
  }

  async findLatestSucceededNodeRun(
    canvasId: string,
    nodeId: string,
  ): Promise<NodeRunRecord | null> {
    const record = [...this.nodeRuns.values()]
      .filter((nodeRun) => {
        const run = this.runs.get(nodeRun.workflowRunId);
        return (
          run?.canvasId === canvasId &&
          nodeRun.nodeId === nodeId &&
          nodeRun.status === "succeeded" &&
          nodeRun.outputAssetIds.length > 0
        );
      })
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.createdAt.localeCompare(left.createdAt) ||
          right.id.localeCompare(left.id),
      )[0];
    return record ? clone(record) : null;
  }

  async saveWebhookEvent(input: WebhookEventRecord): Promise<boolean> {
    const key = `${input.provider}:${input.connectionId ?? ""}:${input.externalId}`;
    if (this.webhookKeys.has(key)) return false;
    this.webhookKeys.add(key);
    return true;
  }
}

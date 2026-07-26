export type JsonObject = Record<string, unknown>;

export interface CanvasRecord {
  id: string;
  title: string;
  graph: JsonObject;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasRevisionRecord {
  id: string;
  canvasId: string;
  graph: JsonObject;
  reason: string;
  createdAt: string;
}

export interface AssetRecord {
  id: string;
  name: string;
  kind: "image" | "video" | "audio" | "text";
  mimeType: string;
  size: number;
  storageKey: string;
  metadata: JsonObject;
  deleted: boolean;
  createdAt: string;
}

export interface ProviderConnectionRecord {
  id: string;
  name: string;
  provider: string;
  encryptedSecret?: string | null;
  config: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "needs_attention";

export interface WorkflowRunRecord {
  id: string;
  canvasId: string;
  clientRequestId: string;
  scope: "node" | "downstream" | "all";
  nodeId?: string | null;
  status: WorkflowStatus;
  revisionGraph: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export type NodeRunStatus =
  | "blocked"
  | "queued"
  | "submitting"
  | "running"
  | "archiving"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "cancelled"
  | "needs_attention";

export interface NodeRunRecord {
  id: string;
  workflowRunId: string;
  nodeId: string;
  status: NodeRunStatus;
  attempt: number;
  providerTaskId?: string | null;
  inputJson: JsonObject;
  outputAssetIds: string[];
  errorJson?: JsonObject | null;
  createdAt: string;
  updatedAt: string;
}

/** Optional optimistic-concurrency guards for node-run mutations. */
export interface NodeRunUpdateOptions {
  expectedStatus?: NodeRunStatus;
  expectedUpdatedAt?: string;
}

export interface WebhookEventRecord {
  id: string;
  provider: string;
  connectionId?: string | null;
  externalId: string;
  payload: JsonObject;
  createdAt: string;
}

export interface Repository {
  ensureDefaultCanvas(): Promise<CanvasRecord>;
  listCanvases(): Promise<CanvasRecord[]>;
  getCanvas(id: string): Promise<CanvasRecord | null>;
  saveCanvas(input: {
    id: string;
    title?: string;
    graph: JsonObject;
    reason?: string;
  }): Promise<CanvasRecord>;
  listRevisions(canvasId: string): Promise<CanvasRevisionRecord[]>;
  listAssets(): Promise<AssetRecord[]>;
  getAsset(id: string): Promise<AssetRecord | null>;
  saveAsset(
    input: Omit<AssetRecord, "createdAt" | "deleted"> & {
      createdAt?: string;
      deleted?: boolean;
    },
  ): Promise<AssetRecord>;
  deleteAsset(id: string): Promise<void>;
  listConnections(): Promise<ProviderConnectionRecord[]>;
  getConnection(id: string): Promise<ProviderConnectionRecord | null>;
  saveConnection(
    input: Omit<ProviderConnectionRecord, "createdAt" | "updatedAt">,
  ): Promise<ProviderConnectionRecord>;
  deleteConnection(id: string): Promise<void>;
  getRunByClientRequest(
    canvasId: string,
    clientRequestId: string,
  ): Promise<WorkflowRunRecord | null>;
  createRun(
    input: Omit<WorkflowRunRecord, "createdAt" | "updatedAt">,
  ): Promise<WorkflowRunRecord>;
  getRun(id: string): Promise<WorkflowRunRecord | null>;
  listRuns(canvasId?: string): Promise<WorkflowRunRecord[]>;
  /** Unbounded status query used by recovery/cancellation workers. */
  listRunsByStatus(
    statuses: readonly WorkflowStatus[],
  ): Promise<WorkflowRunRecord[]>;
  listRecoverableRuns(): Promise<WorkflowRunRecord[]>;
  updateRun(
    id: string,
    patch: Partial<Pick<WorkflowRunRecord, "status" | "updatedAt">>,
  ): Promise<WorkflowRunRecord | null>;
  transitionRunStatus(
    id: string,
    fromStatuses: readonly WorkflowStatus[],
    status: WorkflowStatus,
  ): Promise<WorkflowRunRecord | null>;
  listNodeRuns(runId: string): Promise<NodeRunRecord[]>;
  createNodeRun(
    input: Omit<NodeRunRecord, "createdAt" | "updatedAt">,
  ): Promise<NodeRunRecord>;
  updateNodeRun(
    id: string,
    patch: Partial<Omit<NodeRunRecord, "id" | "createdAt" | "updatedAt">>,
    options?: NodeRunUpdateOptions,
  ): Promise<NodeRunRecord | null>;
  getNodeRun(id: string): Promise<NodeRunRecord | null>;
  findNodeRunByProviderTaskId(
    providerTaskId: string,
    connectionId?: string,
  ): Promise<NodeRunRecord | null>;
  findLatestSucceededNodeRun(
    canvasId: string,
    nodeId: string,
  ): Promise<NodeRunRecord | null>;
  saveWebhookEvent(input: WebhookEventRecord): Promise<boolean>;
}

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

/** Raised when an optimistic canvas save targets an outdated revision. */
export class CanvasRevisionConflictError extends Error {
  readonly code = "CANVAS_REVISION_CONFLICT";

  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `Canvas revision conflict: expected ${expectedRevision}, current ${currentRevision}`,
    );
    this.name = "CanvasRevisionConflictError";
  }
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

export interface DirectorProfileRecord {
  id: string;
  brainConnectionId: string;
  brainModelId: string;
  researchConnectionId?: string | null;
  config: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface DirectorSessionRecord {
  id: string;
  canvasId: string;
  profileId?: string | null;
  title: string;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export type DirectorMessageRole = "user" | "assistant" | "system";

export interface DirectorMessageRecord {
  id: string;
  sessionId: string;
  role: DirectorMessageRole;
  content: string;
  metadata: JsonObject;
  createdAt: string;
}

export type DirectorProposalStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "cancelled"
  | "expired"
  | "running"
  | "succeeded"
  | "failed";

export interface DirectorProposalRecord {
  id: string;
  sessionId: string;
  canvasId: string;
  version: number;
  status: DirectorProposalStatus;
  baseCanvasRevision: number;
  plan: JsonObject;
  quote: JsonObject;
  knowledgeVersion: string;
  catalogFingerprint: string;
  expiresAt: string;
  workflowRunId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DirectorProposalUpdateOptions {
  expectedVersion?: number;
  expectedStatuses?: readonly DirectorProposalStatus[];
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
  scope: "node" | "downstream" | "selection" | "all";
  nodeId?: string | null;
  nodeIds?: string[] | null;
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
    expectedRevision?: number;
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
  deleteAssets(ids: readonly string[]): Promise<void>;
  listConnections(): Promise<ProviderConnectionRecord[]>;
  getConnection(id: string): Promise<ProviderConnectionRecord | null>;
  saveConnection(
    input: Omit<ProviderConnectionRecord, "createdAt" | "updatedAt">,
  ): Promise<ProviderConnectionRecord>;
  deleteConnection(id: string): Promise<void>;
  getDirectorProfile(id: string): Promise<DirectorProfileRecord | null>;
  saveDirectorProfile(
    input: Omit<DirectorProfileRecord, "createdAt" | "updatedAt">,
  ): Promise<DirectorProfileRecord>;
  deleteDirectorProfile(id: string): Promise<void>;
  createDirectorSession(
    input: Omit<DirectorSessionRecord, "createdAt" | "updatedAt">,
  ): Promise<DirectorSessionRecord>;
  getDirectorSession(id: string): Promise<DirectorSessionRecord | null>;
  listDirectorSessions(canvasId?: string): Promise<DirectorSessionRecord[]>;
  updateDirectorSession(
    id: string,
    patch: Partial<
      Pick<DirectorSessionRecord, "title" | "metadata" | "profileId">
    >,
  ): Promise<DirectorSessionRecord | null>;
  deleteDirectorSession(id: string): Promise<void>;
  createDirectorMessage(
    input: Omit<DirectorMessageRecord, "createdAt">,
  ): Promise<DirectorMessageRecord>;
  getDirectorMessage(id: string): Promise<DirectorMessageRecord | null>;
  listDirectorMessages(sessionId: string): Promise<DirectorMessageRecord[]>;
  updateDirectorMessage(
    id: string,
    patch: Partial<Pick<DirectorMessageRecord, "content" | "metadata">>,
  ): Promise<DirectorMessageRecord | null>;
  deleteDirectorMessage(id: string): Promise<void>;
  createDirectorProposal(
    input: Omit<DirectorProposalRecord, "createdAt" | "updatedAt">,
  ): Promise<DirectorProposalRecord>;
  getDirectorProposal(id: string): Promise<DirectorProposalRecord | null>;
  listDirectorProposals(sessionId: string): Promise<DirectorProposalRecord[]>;
  updateDirectorProposal(
    id: string,
    patch: Partial<
      Omit<
        DirectorProposalRecord,
        "id" | "sessionId" | "canvasId" | "createdAt" | "updatedAt"
      >
    >,
    options?: DirectorProposalUpdateOptions,
  ): Promise<DirectorProposalRecord | null>;
  deleteDirectorProposal(id: string): Promise<void>;
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

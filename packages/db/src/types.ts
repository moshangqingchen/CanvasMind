import type { SupplierVerificationRecord } from "./supplier-verification.js";
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

/** Structurally matches the public core contract without coupling storage to it. */
export interface AssetImageDesignReviewInput {
  status: "unreviewed" | "candidate" | "approved" | "rejected";
  note: string;
  expectedRevision: number;
}

export class ImageDesignReviewConflictError extends Error {
  readonly code = "IMAGE_DESIGN_REVIEW_CONFLICT";

  constructor(readonly asset: AssetRecord) {
    super("图片评审已被其他操作更新，请检查最新内容后重试");
    this.name = "ImageDesignReviewConflictError";
  }
}

export class ImageDesignReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageDesignReviewValidationError";
  }
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

export interface SupplierCatalogModel {
  id: string;
  name?: string;
  capability: "image" | "video" | "chat" | "other";
  protocol?:
    | "openai-images"
    | "openai-videos"
    | "chat-completions"
    | "responses"
    | "gemini"
    | "rest"
    | "unknown";
  priceLabel?: string;
  /** Model declarations do not grant a saved Key access to the public directory. */
  inputKinds?: readonly ("text" | "image" | "image[]" | "video" | "video[]" | "audio" | "audio[]")[];
  outputKinds?: readonly ("text" | "image" | "image[]" | "video" | "video[]")[];
  metadata?: Readonly<Record<string, unknown>>;
  limits?: {
    maxPromptCharacters?: number;
    maxInputImages?: number;
    maxInputVideos?: number;
    maxInputAudios?: number;
    maxInputAssets?: number;
    maxOutputImages?: number;
    maxInputVideoDurationSeconds?: number;
    maxTotalInputVideoDurationSeconds?: number;
    maxInputAudioDurationSeconds?: number;
    requiresInputImage?: boolean;
    requiresInputVideo?: boolean;
    supportedMimeTypes?: readonly string[];
  };
}

export interface SupplierRecord {
  id: string;
  name: string;
  /** Credential and preset namespace, independent of the editable label. */
  supplierKey: string;
  siteUrl: string;
  apiUrl: string;
  kind: "auto" | "newapi" | "sub2api" | "openai-compatible";
  catalog: {
    groups: Array<{
      id: string;
      label: string;
      source?: "manual" | "catalog";
      status?: "available" | "missing";
      models: SupplierCatalogModel[];
      details?: {
        source: "model-plaza" | "key-groups";
        description?: string;
        referencePrice?: string;
        supportedResolutions?: string[];
        unsupportedResolutions?: string[];
        nativeResolutions?: string[];
        upscaledResolutions?: string[];
        exclusiveResolutions?: boolean;
        imagePrices?: Array<{ resolution: string; amount: number }>;
        rateMultiplier?: number;
        imageRateMultiplier?: number;
        concurrencyLimit?: number;
        rpmLimit?: number;
        stale?: boolean;
      };
    }>;
  };
  scanStatus: "unscanned" | "live" | "empty" | "failed" | "unauthorized";
  /** Only a complete directory response can establish that a group disappeared. */
  scanComplete?: boolean;
  scannedAt?: string;
  /** Last confirmed directory result; failed attempts never advance this timestamp. */
  scanLastSuccessAt?: string;
  scanError?: string;
  scanErrorCode?: "invalid_credentials" | "invalid_token" | "permission_denied" | "user_id_required" | "verification_required" | "unsupported_platform" | "invalid_configuration" | "rate_limited" | "network" | "directory_unavailable";
  scanRetryable?: boolean;
  state?: SupplierState;
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
  | "materializing"
  | "awaiting_execution"
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
  expectedPreflightId?: string;
}

export interface SupplierSourceArchive {
  id: string;
  siteUrl: string;
  apiUrl: string;
  kind: SupplierRecord["kind"];
  catalog: SupplierRecord["catalog"];
  connectionIds: string[];
  connections?: Array<{
    id: string;
    name: string;
    group: string;
    modelIds: string[];
    usage: string;
    keyConfigured: boolean;
  }>;
  archivedAt: string;
  reason: "address-change" | "legacy-unverified" | "restored";
}
/** Missing authMode is the persisted legacy password format. Never store both secrets. */
export type SupplierSiteLogin =
  | { authMode?: "password"; username: string; encryptedPassword: string; siteUrl: string; encryptedAccessToken?: never; userId?: never }
  | { authMode: "access-token"; encryptedAccessToken: string; siteUrl: string; userId?: string; username?: never; encryptedPassword?: never };

export interface SupplierState {
  version: 1;
  revision: number;
  visibility: "visible" | "hidden" | "deleted";
  sourceId: string;
  fingerprint: string;
  scanId?: string;
  generationTransport?: "local" | "cloudflare";
  billing?: SupplierBillingSnapshot;
  /** Server-only website login, encrypted with MASTER_KEY and scoped to this source. */
  siteLogin?: SupplierSiteLogin;
  keySync?: {
    status: "live" | "partial" | "failed";
    imported: number;
    preserved: number;
    skipped: number;
    multipleGroups: number;
    checkedAt: string;
    error?: string;
  };
  history: SupplierSourceArchive[];
}

/** Account totals returned by this supplier, never summed across currencies or Keys. */
export interface SupplierBillingSnapshot {
  sourceId: string;
  status: "live" | "partial" | "failed" | "unconfigured";
  checkedAt: string;
  lastSuccessAt?: string;
  balance?: number;
  used?: number;
  todayUsed?: number;
  todayStatus?: "live" | "missing" | "unsupported" | "failed";
  todayError?: string;
  /** Explicit query range for sites that accept a local-day usage window. */
  todayWindow?: { startAt: string; endAt: string; timeZone: string };
  requests?: number;
  unit: string;
  /** Field-specific units when account and usage endpoints declare different currencies. */
  balanceUnit?: string;
  usedUnit?: string;
  todayUnit?: string;
  unitBasis?: "site-conversion" | "raw-quota" | "declared-currency" | "unspecified";
  unitNote?: string;
  sourceUrl: string;
  usedSourceUrl?: string;
  todaySourceUrl?: string;
  error?: string;
}
export interface SupplierCommit {
  supplier: Omit<SupplierRecord, "createdAt" | "updatedAt">;
  expectedRevision: number;
  expectedConnections: ProviderConnectionRecord[];
  connections: ProviderConnectionRecord[];
  deleteConnectionIds?: string[];
}
export interface ConnectionSaveOptions {
  expected?: ProviderConnectionRecord;
}
export class SupplierConflictError extends Error {
  constructor(message = "供应商配置已改变，请刷新后重试") {
    super(message);
    this.name = "SupplierConflictError";
  }
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
  /** Confirm all current changes are durable before acknowledging a retried save. */
  flush?(): Promise<void>;
  listSupplierVerifications(): Promise<SupplierVerificationRecord[]>;
  getSupplierVerification(id: string): Promise<SupplierVerificationRecord | null>;
  saveSupplierVerification(record: SupplierVerificationRecord, expectedRevision: number): Promise<SupplierVerificationRecord>;
  listSuppliers(): Promise<SupplierRecord[]>;
  getSupplier(id: string): Promise<SupplierRecord | null>;
  saveSupplier(
    input: Omit<SupplierRecord, "createdAt" | "updatedAt">,
  ): Promise<SupplierRecord>;
  commitSupplier(input: SupplierCommit): Promise<SupplierRecord>;
  ensureDefaultCanvas(): Promise<CanvasRecord>;
  listCanvases(): Promise<CanvasRecord[]>;
  getCanvas(id: string): Promise<CanvasRecord | null>;
  deleteCanvas(id: string): Promise<void>;
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
  /** Updates only review metadata; never creates or revives an asset. */
  updateImageDesignReview(
    id: string,
    input: AssetImageDesignReviewInput,
  ): Promise<AssetRecord | null>;
  deleteAsset(id: string): Promise<void>;
  deleteAssets(ids: readonly string[]): Promise<void>;
  listConnections(): Promise<ProviderConnectionRecord[]>;
  getConnection(id: string): Promise<ProviderConnectionRecord | null>;
  saveConnection(
    input: Omit<ProviderConnectionRecord, "createdAt" | "updatedAt">,
    options?: ConnectionSaveOptions,
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
    options?: { expectedTurnId: string | null },
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

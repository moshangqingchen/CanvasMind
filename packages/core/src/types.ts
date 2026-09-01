export const PORT_KINDS = [
  "text",
  "image",
  "image[]",
  "video",
  "video[]",
  "audio",
  "audio[]",
] as const;

export type PortKind = (typeof PORT_KINDS)[number];

export const RUN_SCOPES = ["node", "downstream", "selection", "all"] as const;

export type RunScope = (typeof RUN_SCOPES)[number];

export const BUILT_IN_NODE_TYPES = [
  "asset-input",
  "prompt",
  "image-generation",
  "video-generation",
  "preview",
] as const;

export type BuiltInNodeType = (typeof BUILT_IN_NODE_TYPES)[number];
export type NodeType = BuiltInNodeType | (string & {});

export const PROMPT_ASSET_ROLES = [
  "reference",
  "firstFrame",
  "lastFrame",
] as const;

export type PromptAssetRole = (typeof PROMPT_ASSET_ROLES)[number];

export type PromptPart =
  | { type: "text"; text: string }
  | {
      type: "asset";
      assetId: string;
      role: PromptAssetRole;
    };

export type PromptPartInput =
  PromptPart | string | readonly (PromptPart | string)[];

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface PortDefinition {
  readonly id: string;
  readonly kind: PortKind;
  readonly label?: string;
  readonly required?: boolean;
  /** Allows more than one incoming edge. Arrays are multiple by definition. */
  readonly multiple?: boolean;
  readonly maxConnections?: number;
}

export type PortMapValue = Omit<PortDefinition, "id"> & {
  readonly id?: string;
};

export type PortCollection =
  readonly PortDefinition[] | Readonly<Record<string, PortMapValue>>;

export interface WorkflowNode<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly id: string;
  readonly type: NodeType;
  /** Optional semantic alias used by non-React-Flow serializers. */
  readonly kind?: NodeType;
  readonly position?: Point;
  readonly data?: TData;
  readonly inputs?: PortCollection;
  readonly outputs?: PortCollection;
  readonly inputPorts?: PortCollection;
  readonly outputPorts?: PortCollection;
}

export interface WorkflowEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  /** Canonical port id used by core. */
  readonly sourcePort?: string | null;
  readonly targetPort?: string | null;
  /** React Flow compatible aliases accepted when canonical ids are absent. */
  readonly sourceHandle?: string | null;
  readonly targetHandle?: string | null;
  readonly sourceOutput?: string | null;
  readonly targetInput?: string | null;
}

export interface WorkflowGraph<
  TNode extends WorkflowNode = WorkflowNode,
  TEdge extends WorkflowEdge = WorkflowEdge,
> {
  readonly nodes: readonly TNode[];
  readonly edges: readonly TEdge[];
}

export type GraphNode = WorkflowNode;
export type GraphEdge = WorkflowEdge;
export type Graph = WorkflowGraph;
export type NodePort = PortDefinition;
export type Node = WorkflowNode;
export type Edge = WorkflowEdge;
export type Port = PortDefinition;

export const GRAPH_VALIDATION_ISSUE_CODES = [
  "duplicate_node_id",
  "duplicate_edge_id",
  "duplicate_port_id",
  "dangling_source",
  "dangling_target",
  "self_loop",
  "cycle",
  "missing_source_port",
  "missing_target_port",
  "unknown_source_port",
  "unknown_target_port",
  "incompatible_ports",
  "missing_required_input",
  "too_many_connections",
] as const;

export type GraphValidationIssueCode =
  (typeof GRAPH_VALIDATION_ISSUE_CODES)[number];

export interface GraphValidationIssue {
  readonly code: GraphValidationIssueCode;
  readonly message: string;
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly portId?: string;
  readonly path?: readonly string[];
}

export interface GraphValidationOptions {
  readonly checkPorts?: boolean;
  readonly checkRequiredInputs?: boolean;
}

export interface GraphValidationResult {
  readonly valid: boolean;
  readonly errors: readonly GraphValidationIssue[];
  readonly cycles: readonly (readonly string[])[];
}

export interface RunSubgraph<
  TNode extends WorkflowNode = WorkflowNode,
  TEdge extends WorkflowEdge = WorkflowEdge,
> extends WorkflowGraph<TNode, TEdge> {
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
}

export interface NormalizePromptOptions {
  /** Remove text parts that contain only whitespace. Defaults to true. */
  readonly dropBlankText?: boolean;
  /** Trim the outside edge of the first and last text part. Defaults to false. */
  readonly trimOuterWhitespace?: boolean;
}

export interface PromptAssetDescriptor {
  readonly id: string;
  readonly name?: string;
  readonly url?: string;
}

export type PromptAssetResolver = (
  assetId: string,
  role: PromptAssetRole,
) => string | PromptAssetDescriptor | null | undefined;

export interface RenderPromptOptions {
  readonly resolveAsset?: PromptAssetResolver;
  /** Called when no resolver value is available. Defaults to `@assetId`. */
  readonly unresolvedAsset?: "mention" | "id" | "empty";
  /** Inserted between adjacent non-whitespace chunks. Defaults to one space. */
  readonly separator?: string;
}

export const NODE_RUN_STATUSES = [
  "blocked",
  "queued",
  "submitting",
  "running",
  "archiving",
  "succeeded",
  "failed",
  "cancel_requested",
  "cancelled",
  "needs_attention",
] as const;

export type NodeRunStatus = (typeof NODE_RUN_STATUSES)[number];

export interface NodeRunError {
  readonly code?: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly statusCode?: number;
  readonly details?: unknown;
}

export interface NodeRunRecord {
  readonly id: string;
  readonly workflowRunId: string;
  readonly nodeId: string;
  readonly status: NodeRunStatus;
  readonly attempt: number;
  readonly providerTaskId?: string | null;
  readonly inputAssetIds?: readonly string[];
  readonly outputAssetIds?: readonly string[];
  readonly error?: NodeRunError | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
}

export type NodeRun = NodeRunRecord;

export interface NodeRunTransitionOptions {
  readonly now?: Date | string | number;
  readonly error?: NodeRunError | null;
  readonly providerTaskId?: string | null;
}

export const RETRY_PHASES = ["submit", "poll", "archive"] as const;
export type RetryPhase = (typeof RETRY_PHASES)[number];

export const SUBMISSION_OUTCOMES = [
  "not_submitted",
  "submitted",
  "unknown",
] as const;
export type SubmissionOutcome = (typeof SUBMISSION_OUTCOMES)[number];

export const RETRY_CLASSIFICATIONS = [
  "retryable",
  "non_retryable",
  "needs_attention",
] as const;
export type RetryClassification = (typeof RETRY_CLASSIFICATIONS)[number];

export const RETRY_ACTIONS = [
  "retry",
  "resume_poll",
  "resume_archive",
  "fail",
  "manual_review",
] as const;
export type RetryAction = (typeof RETRY_ACTIONS)[number];

export interface RetryContext {
  readonly phase: RetryPhase;
  /** One-based attempt number. */
  readonly attempt: number;
  readonly maxAttempts?: number;
  readonly error?: unknown;
  readonly statusCode?: number;
  readonly providerTaskId?: string | null;
  readonly submissionOutcome?: SubmissionOutcome;
}

export interface RetryDecision {
  readonly classification: RetryClassification;
  readonly action: RetryAction;
  readonly retryable: boolean;
  /** True only when a new paid provider submission is safe. */
  readonly canResubmit: boolean;
  readonly reason: string;
}

export interface BackoffOptions {
  readonly baseMs?: number;
  readonly maxMs?: number;
  /** Fractional symmetric jitter, from 0 through 1. Defaults to zero. */
  readonly jitter?: number;
  readonly random?: () => number;
}

export const PROVIDER_CAPABILITIES = [
  "image.generate",
  "image.edit",
  "video.generate",
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export interface ModelDescriptor {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly inputKinds?: readonly PortKind[];
  readonly outputKinds?: readonly PortKind[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ValidationIssue {
  readonly path?: readonly (string | number)[];
  readonly code: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface NormalizedAssetInput {
  readonly assetId: string;
  readonly kind: "image" | "video";
  readonly role?: PromptAssetRole;
  readonly mimeType?: string;
  readonly url?: string;
}

export interface NormalizedRequest {
  readonly provider: string;
  readonly model: string;
  readonly capability: ProviderCapability;
  readonly prompt: readonly PromptPart[];
  readonly assets: readonly NormalizedAssetInput[];
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
}

export interface ProviderTask {
  readonly id: string;
  readonly status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  readonly raw?: unknown;
}

export interface RemoteArtifact {
  readonly kind: "image" | "video";
  readonly url: string;
  readonly mimeType?: string;
  readonly filename?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NormalizedTaskState {
  readonly status: ProviderTask["status"];
  readonly progress?: number;
  readonly outputs?: readonly RemoteArtifact[];
  readonly error?: NodeRunError;
  readonly raw?: unknown;
}

export interface ProviderAdapter {
  testConnection(connectionId: string): Promise<void>;
  listModels(connectionId: string): Promise<readonly ModelDescriptor[]>;
  validate(request: NormalizedRequest): Promise<ValidationResult>;
  submit(request: NormalizedRequest): Promise<ProviderTask>;
  poll?(task: ProviderTask): Promise<NormalizedTaskState>;
  cancel?(task: ProviderTask): Promise<void>;
  verifyWebhook?(request: Request): Promise<NormalizedTaskState>;
  extractOutputs(result: unknown): Promise<readonly RemoteArtifact[]>;
}

export interface CreateRunRequest {
  readonly canvasId: string;
  readonly clientRequestId: string;
  readonly scope: RunScope;
  readonly nodeId?: string;
  readonly nodeIds?: readonly string[];
}

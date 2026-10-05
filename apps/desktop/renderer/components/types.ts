import type { Edge, Node } from "@xyflow/react";
import type { NodeRunStatus, PromptPart } from "@super-canvas/core";
import type { ModelDescriptor, ProviderErrorPresentation } from "@super-canvas/providers";
import type { NodeAlignmentAction } from "../lib/graph-ui";

export interface AssetView {
  id: string;
  name: string;
  kind: "image" | "video" | "audio" | "text";
  mimeType: string;
  size: number;
  storageKey: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RunErrorDetails {
  message: string;
  type?: string;
  code?: string;
  api?: string;
  statusCode?: number;
  providerMessage?: string;
  docsUrl?: string;
  actionUrl?: string;
  actionLabel?: string;
  phase?: ProviderErrorPresentation["phase"];
  retryable?: boolean;
  submissionMayHaveOccurred?: boolean;
  transport?: ProviderErrorPresentation["transport"];
  failureCategory?: ProviderErrorPresentation["failureCategory"];
  charge?: ProviderErrorPresentation["charge"];
}

export interface GenerationInputAsset {
  id: string;
  name?: string;
  kind?: "image" | "video" | "audio" | "text";
  role?: "reference" | "firstFrame" | "lastFrame" | "mask";
}

export interface GenerationDetails {
  imageMask?: { maskAssetId: string; maskSourceAssetId: string };
  taskEvidence?: RunTaskEvidence;
  submissionPhase?: string;
  operation?: string;
  prompt?: string;
  inputAssetIds?: string[];
  inputAssets?: GenerationInputAsset[];
  outputCount?: number;
  finishedAt?: string;
}

/** Whitelisted evidence about the original supplier task, without its recovery payload. */
export interface RunTaskEvidence {
  taskId: string;
  status?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
}

export interface CanvasDrawingPoint {
  x: number;
  y: number;
}

export interface CanvasDrawingStroke {
  id: string;
  color: string;
  width: number;
  points: CanvasDrawingPoint[];
}

export interface CanvasNodeData extends Record<string, unknown> {
  nodeType?: string;
  label: string;
  description?: string;
  inputs?: Array<{
    id: string;
    kind: string;
    label: string;
    required?: boolean;
    multiple?: boolean;
  }>;
  outputs?: Array<{ id: string; kind: string; label: string }>;
  parts?: PromptPart[];
  assetId?: string;
  assetKind?: "image" | "video" | "audio";
  pendingImport?: boolean;
  pendingPreviewUrl?: string;
  directorDraft?: boolean;
  directorCallId?: string;
  directorProposalId?: string;
  generatedResult?: boolean;
  generatedStatus?: NodeRunStatus;
  generatedError?: string | RunErrorDetails;
  generatedFromNodeId?: string;
  generatedFromRunId?: string;
  generatedProvider?: string;
  generatedCliCancelSupported?: boolean;
  generatedSupplier?: string;
  generatedConnectionId?: string;
  generatedConnectionName?: string;
  generatedGroup?: string;
  generatedModel?: string;
  generatedParameters?: Record<string, string | number | boolean>;
  generatedDetails?: GenerationDetails;
  generatedCreatedAt?: string;
  generatedPromptParts?: PromptPart[];
  generatedPromptText?: string;
  generatedPendingRequestId?: string;
  hiddenGeneratedResults?: Array<{ requestId?: string; runId?: string; outputIndex: number }>;
  generatedOutputIndex?: number;
  generatedRecoveryAction?: "retry" | "resume_poll" | "resume_archive";
  mediaAspectRatio?: number;
  provider?: string;
  connectionId?: string;
  model?: string;
  parameters?: Record<string, unknown>;
  /** Track model defaults separately from an explicitly chosen quality. */
  qualityMode?: "highest" | "custom";
  lastOutputAssetIds?: string[];
  lastOutputRunId?: string;
  lastOutputCreatedAt?: string;
  materializedOutputAssetIds?: string[];
  status?: string;
  onRun?: () => void;
  onRunDownstream?: () => void;
  onReconcileTask?: () => void;
  onCancelTask?: () => Promise<void>;
  cancelTaskLabel?: string;
  onRegenerate?: () => void;
  onRecoverResult?: () => Promise<void>;
  onSelect?: (additive?: boolean) => void;
  onOpenPreview?: (assetId: string) => void;
  onEditMask?: (assetId: string, editNodeId?: string) => void;
  imageEditingCapabilities?: { transparent: boolean; mask: "multipart" | "url" | null };
  onPrepareReversePrompt?: () => void;
  onReusePrompt?: () => Promise<void>;
  onDelete?: () => void;
  onResizeStart?: () => void;
  selectionAlignmentVisible?: boolean;
  selectionCount?: number;
  selectionSize?: number;
  onAlignSelection?: (action: NodeAlignmentAction) => void;
  onPromptPartsChange?: (parts: PromptPart[]) => void;
  onConnectionChange?: (connectionId: string) => void;
  onConfigurationFocus?: () => void;
  onConfigurationOpenChange?: (nodeId: string, open: boolean) => void;
  onModelChange?: (model: string) => void;
  onParametersChange?: (parameters: Record<string, unknown>) => void;
  onMediaAspectRatio?: (ratio: number) => void;
  onLinkedAssetDuration?: (assetId: string, seconds: number) => void;
  onRemoveLinkedAsset?: (assetId: string) => void;
  onOpenApiSettings?: () => void;
  connectionOptions?: Array<{
    id: string;
    name: string;
    provider: string;
    supplier: string;
    supplierLabel: string;
    supplierId?: string;
    modelQuote?: string;
    group: string;
    available?: boolean;
    unavailableReason?: string;
  }>;
  modelOptions?: ModelDescriptor[];
  modelOptionsAuthoritative?: boolean;
  modelOptionsLoading?: boolean;
  modelOptionsError?: boolean;
  assets?: AssetView[];
  mentionAssets?: AssetView[];
  linkedAssets?: AssetView[];
  linkedAssetDurations?: Record<string, number>;
  linkedAssetWarnings?: string[];
  linkedAssetLimitText?: string;
  connectionPreviewActive?: boolean;
  connectionHighlight?: "source" | "compatible";
  compatibleInputIds?: string[];
  /** Visual-only canvas grouping metadata. It never changes graph execution. */
  canvasGroupId?: string;
  canvasGroupLabel?: string;
  canvasGroupColor?: string;
}

export type CanvasNode = Node<CanvasNodeData>;
export type CanvasEdge = Edge;

export interface CanvasDocument {
  schemaVersion: number;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport?: { x: number; y: number; zoom: number };
  drawings?: CanvasDrawingStroke[];
}

export interface RunSnapshot {
  run: {
    id: string;
    clientRequestId?: string;
    status: NodeRunStatus;
    canvasId: string;
    scope: string;
    nodeId?: string | null;
    createdAt: string;
    updatedAt?: string;
    canResume?: boolean;
    canRecoverOutputs?: boolean;
  };
  nodes: Array<{
    id: string;
    nodeId: string;
    status: string;
    outputAssetIds: string[];
    updatedAt?: string;
    cliCancelSupported?: boolean;
    recoveryAction?: "retry" | "resume_poll" | "resume_archive";
    taskEvidence?: RunTaskEvidence;
    errorJson?: RunErrorDetails | null;
    request?: {
      submissionPhase?: string;
      submissionTimeline?: Array<{ phase: string; at: string }>;
      provider?: string;
      supplier?: string;
      connectionId?: string;
      connectionName?: string;
      modelGroup?: string;
      operation?: string;
      model?: string;
      parameters?: Record<string, string | number | boolean>;
      prompt?: string;
      inputAssetIds?: string[];
      inputAssets?: GenerationInputAsset[];
      imageMask?: { maskAssetId: string; maskSourceAssetId: string };
    };
  }>;
}

import type { Edge, Node } from "@xyflow/react";
import type { NodeRunStatus, PromptPart } from "@super-canvas/core";
import type { ModelDescriptor } from "@super-canvas/providers";
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
  docsUrl?: string;
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
  generatedResult?: boolean;
  generatedStatus?: NodeRunStatus;
  generatedError?: string | RunErrorDetails;
  generatedFromNodeId?: string;
  generatedFromRunId?: string;
  generatedProvider?: string;
  generatedPromptParts?: PromptPart[];
  generatedPromptText?: string;
  generatedPendingRequestId?: string;
  generatedOutputIndex?: number;
  mediaAspectRatio?: number;
  provider?: string;
  connectionId?: string;
  model?: string;
  parameters?: Record<string, unknown>;
  lastOutputAssetIds?: string[];
  materializedOutputAssetIds?: string[];
  status?: string;
  onRun?: () => void;
  onRegenerate?: () => void;
  onSelect?: () => void;
  onOpenPreview?: (assetId: string) => void;
  onPrepareReversePrompt?: () => void;
  onDelete?: () => void;
  onResizeStart?: () => void;
  selectionAlignmentVisible?: boolean;
  selectionCount?: number;
  onAlignSelection?: (action: NodeAlignmentAction) => void;
  onPromptPartsChange?: (parts: PromptPart[]) => void;
  onConnectionChange?: (connectionId: string) => void;
  onModelChange?: (model: string) => void;
  onParametersChange?: (parameters: Record<string, unknown>) => void;
  onMediaAspectRatio?: (ratio: number) => void;
  onLinkedAssetDuration?: (assetId: string, seconds: number) => void;
  onOpenApiSettings?: () => void;
  connectionOptions?: Array<{
    id: string;
    name: string;
    provider: string;
    supplier: string;
    supplierLabel: string;
    group: string;
    available?: boolean;
  }>;
  modelOptions?: ModelDescriptor[];
  assets?: AssetView[];
  mentionAssets?: AssetView[];
  linkedAssets?: AssetView[];
  linkedAssetDurations?: Record<string, number>;
  linkedAssetWarnings?: string[];
  linkedAssetLimitText?: string;
  connectionPreviewActive?: boolean;
  connectionHighlight?: "source" | "compatible";
  compatibleInputIds?: string[];
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
  };
  nodes: Array<{
    id: string;
    nodeId: string;
    status: string;
    outputAssetIds: string[];
    errorJson?: RunErrorDetails | null;
  }>;
}

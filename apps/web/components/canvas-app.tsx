"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type OnConnectStart,
  type OnConnect,
  type OnConnectEnd,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Circle,
  Combine,
  Copy,
  CopyPlus,
  Download,
  FolderOpen,
  Hand,
  History,
  Info,
  Image as ImageIcon,
  Keyboard,
  KeyRound,
  MousePointer2,
  MoreHorizontal,
  Minus,
  Pencil,
  Play,
  RefreshCw,
  Settings2,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  Redo2,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import {
  arePortKindsCompatible,
  validateGraph,
  wouldCreateCycle,
  WorkflowGraphSchema,
  renderPromptParts,
  type NodeRunStatus,
  type PortKind,
  type PromptPart,
} from "@super-canvas/core";
import type { ModelDescriptor } from "@super-canvas/providers";
import {
  createRun,
  claimMaterialDrop,
  discardMaterialDrop,
  fetchAssets,
  fetchCanvas,
  fetchCangyuanCatalog,
  fetchConnections,
  fetchModels,
  fetchMaterialDrops,
  fetchRun,
  fetchRuns,
  saveCanvas,
  uploadAsset,
  type ProviderConnectionView,
} from "../lib/client-api";
import {
  CANGYUAN_ALL_MODELS_GROUP,
  CANGYUAN_IMAGE_4K_MODEL,
  isCangyuanImageGroup,
  isCangyuanImagePreset,
} from "../lib/provider-presets";
import {
  providerConnectionGroup,
  providerConnectionSupplierKey,
  providerConnectionUsage,
  providerSupplierLabel,
} from "../lib/provider-connection-options";
import { LatestTaskQueue } from "../lib/latest-task-queue";
import { normalizeDraggedMediaFile } from "../lib/dropped-media";
import {
  drawingShapePoints,
  drawingStrokeIntersectsRect,
  hitTestDrawingStrokes,
  normalizeDrawingRect,
  renderDrawingStrokesToPng,
  translateDrawingStrokes,
  type DrawingTool,
  zoomViewportAtPoint,
} from "../lib/drawing";
import { localizeRunError } from "../lib/error-localization";
import {
  directLinkedAssetsForNode,
  linkedMediaLimitText,
  validateLinkedMediaInputs,
} from "../lib/linked-media";
import {
  getAutoConnectionOptions,
  getAutoConnectionTargetHandle,
  isCanvasHistoryShortcutAllowed,
  isCanvasShortcutAllowed,
  modelSupportsNodeType,
  providerSupportsNodeType,
  shouldPersistNodeChanges,
  type AutoConnectNodeType,
} from "../lib/graph-ui";
import {
  modelDescriptorFromConnectionConfig,
  modelDescriptorsFromConnectionConfig,
  parameterDescriptorsFor,
  parametersWithDefaults,
} from "../lib/model-parameters";
import { AgentPanel, type AgentDraftRequest } from "./agent-panel";
import { DrawingLayer } from "./drawing-layer";
import { NodeParameterFields } from "./node-parameter-fields";
import { ShortcutsModal } from "./shortcuts-modal";
import { useCanvasStore } from "./canvas-store";
import { WorkflowNode } from "./workflow-node";
import {
  AssetPreviewModal,
  GenerationHistoryModal,
  SettingsModal,
} from "./workspace-modals";
import type {
  AssetView,
  CanvasDocument,
  CanvasDrawingPoint,
  CanvasDrawingStroke,
  CanvasEdge,
  CanvasNode,
  CanvasNodeData,
  RunErrorDetails,
  RunSnapshot,
} from "./types";

type ToastTone = "info" | "success" | "error";

interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

/** Reflects the autosave pipeline so the top bar can stop guessing. */
type SaveState = "saved" | "pending" | "saving" | "error";

const SAVE_STATE_LABEL: Record<SaveState, string> = {
  saved: "已保存",
  pending: "待保存",
  saving: "保存中",
  error: "保存失败",
};

const nodeTypes = { workflow: WorkflowNode };
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "超级画布";
const ASSET_DRAG_TYPE = "application/x-super-canvas-asset";
const terminalRunStatuses = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "needs_attention",
]);
const terminalGeneratedResultStatuses = new Set<NodeRunStatus>([
  "blocked",
  "succeeded",
  "failed",
  "cancelled",
  "needs_attention",
]);
const GENERATED_RESULT_INPUT_HANDLE = "generated";
const GENERATED_RESULT_EDGE_PREFIX = "edge-generated-";
const MATERIAL_DROP_LEASE_STORAGE_KEY = "super-canvas:material-drop-consumer";
const INSPECTOR_MIN_WIDTH = 280;
const INSPECTOR_DEFAULT_WIDTH = 300;
const INSPECTOR_MAX_WIDTH = 720;
const INSPECTOR_WIDTH_STORAGE_KEY = "super-canvas:inspector-width";

type CanvasInteractionMode = "pan" | "draw" | "select-drawing";

const DRAWING_TOOL_LABEL: Record<DrawingTool, string> = {
  freehand: "画笔自由涂鸦",
  rectangle: "矩形绘制",
  ellipse: "椭圆绘制",
  line: "直线绘制",
  arrow: "箭头绘制",
};

type RunScope = "node" | "downstream" | "all";

interface RunRequestKey {
  nodeId: string | undefined;
  scope: RunScope;
  retryResultNodeId?: string;
}

function runRequestKey(request: RunRequestKey): string {
  return `${request.scope}:${request.nodeId ?? "all"}:${request.retryResultNodeId ?? "new"}`;
}

function clampInspectorWidth(width: number): number {
  const viewportLimit =
    typeof window === "undefined"
      ? INSPECTOR_MAX_WIDTH
      : Math.max(INSPECTOR_MIN_WIDTH, window.innerWidth - 420);
  return Math.min(
    INSPECTOR_MAX_WIDTH,
    viewportLimit,
    Math.max(INSPECTOR_MIN_WIDTH, Math.round(width)),
  );
}

interface ConnectionMenuState {
  x: number;
  y: number;
  source: string;
  sourceHandle: string;
  sourceKind: PortKind;
}

interface CanvasMenuState {
  x: number;
  y: number;
  position: { x: number; y: number };
}

interface NodeMenuState {
  x: number;
  y: number;
  nodeId: string;
  label: string;
  runnable: boolean;
}

interface CanvasSaveRequest {
  canvasId: string;
  graph: CanvasDocument;
  title: string;
}

const port = (
  id: string,
  kind: PortKind,
  label: string,
  required = false,
  multiple = false,
) => ({ id, kind, label, required, multiple });

function createNode(
  type: string,
  position: { x: number; y: number },
  index = 0,
): CanvasNode {
  const base: CanvasNodeData = {
    nodeType: type,
    label:
      type === "asset-input"
        ? "素材输入"
        : type === "prompt"
          ? "Prompt"
          : type === "image-generation"
            ? "图片生成"
            : type === "video-generation"
              ? "视频生成"
              : "结果预览",
  };
  if (type === "asset-input")
    Object.assign(base, {
      description: "选择一个图片、视频或音频素材",
      assetKind: "image",
      outputs: [port("asset", "image", "素材")],
    });
  if (type === "prompt")
    Object.assign(base, {
      parts: [
        {
          type: "text",
          text:
            index === 0
              ? "一张电影感的未来城市海报，柔和光线，高细节"
              : "延续上一镜头的视觉风格",
        } satisfies PromptPart,
      ],
      outputs: [port("prompt", "text", "提示词")],
    });
  if (type === "image-generation")
    Object.assign(base, {
      provider: "fake",
      model: "fake-image-v1",
      parts: [{ type: "text", text: "" } satisfies PromptPart],
      inputs: [
        port("prompt", "text", "Prompt", false),
        port("references", "image[]", "参考图", false, true),
      ],
      outputs: [port("images", "image", "图片")],
      parameters: { size: "1024x1024", quality: "auto", n: 1 },
    });
  if (type === "video-generation")
    Object.assign(base, {
      provider: "fake",
      model: "fake-video-v1",
      parts: [{ type: "text", text: "" } satisfies PromptPart],
      inputs: [
        port("prompt", "text", "Prompt", false),
        port("firstFrame", "image", "首帧", false),
        port("lastFrame", "image", "尾帧", false),
        port("references", "image[]", "参考图", false, true),
        port("referenceVideos", "video[]", "参考视频", false, true),
        port("referenceAudios", "audio[]", "参考音频", false, true),
      ],
      outputs: [port("video", "video", "视频")],
      parameters: { duration: 5, ratio: "1280:720" },
    });
  if (type === "preview")
    Object.assign(base, {
      inputs: [
        // Preview accepts both a single artifact and an artifact array. The
        // core port rules coerce single outputs into these array inputs, while
        // keeping fan-in available for multi-output providers.
        port("image", "image[]", "图片", false, true),
        port("video", "video[]", "视频", false, true),
      ],
    });
  return {
    id: `${type}-${crypto.randomUUID().slice(0, 8)}`,
    type: "workflow",
    position,
    style:
      type === "image-generation" || type === "video-generation"
        ? { width: 420, height: 210 }
        : type === "prompt"
          ? { width: 360, height: 210 }
          : type === "asset-input" || type === "preview"
            ? { width: 300, height: 230 }
            : undefined,
    data: base,
  };
}

function createAssetInputNode(
  asset: AssetView,
  position: { x: number; y: number },
  index = 0,
): CanvasNode {
  const node = createNode("asset-input", position, index);
  node.data = {
    ...node.data,
    label: asset.name,
    description: "固定引用素材库中的不可变素材 ID",
    assetId: asset.id,
    assetKind:
      asset.kind === "video"
        ? "video"
        : asset.kind === "audio"
          ? "audio"
          : "image",
    outputs: [
      port(
        "asset",
        asset.kind === "video"
          ? "video"
          : asset.kind === "audio"
            ? "audio"
            : "image",
        asset.kind === "video"
          ? "视频"
          : asset.kind === "audio"
            ? "音频"
            : "图片",
      ),
    ],
  };
  return node;
}

function positiveDimension(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function parseAspectRatio(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  const match = value
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(?:x|:|\/)\s*(\d+(?:\.\d+)?)$/iu);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : undefined;
}

function generatedMediaAspectRatio(source: CanvasNode): number {
  const parameters = source.data.parameters ?? {};
  const candidates =
    source.data.nodeType === "video-generation"
      ? [parameters.ratio, parameters.size, parameters.aspect_ratio]
      : [parameters.size, parameters.aspect_ratio];
  for (const candidate of candidates) {
    const ratio = parseAspectRatio(candidate);
    if (ratio) return Math.min(4, Math.max(0.25, ratio));
  }
  return 1;
}

function nodeDimensions(node: CanvasNode): { width: number; height: number } {
  return {
    width:
      positiveDimension(node.measured?.width, node.width, node.style?.width) ??
      300,
    height:
      positiveDimension(
        node.measured?.height,
        node.height,
        node.style?.height,
      ) ?? 230,
  };
}

function linkedAssetsForNode(
  nodeId: string,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  assets: readonly AssetView[],
): AssetView[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const upstream = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const target = queue.shift();
    if (!target) continue;
    for (const edge of edges) {
      if (edge.target !== target || upstream.has(edge.source)) continue;
      upstream.add(edge.source);
      queue.push(edge.source);
    }
  }

  const assetIds = new Set<string>();
  for (const upstreamId of upstream) {
    const data = nodeById.get(upstreamId)?.data;
    if (!data) continue;
    if (typeof data.assetId === "string") assetIds.add(data.assetId);
    for (const assetId of data.lastOutputAssetIds ?? []) assetIds.add(assetId);
    for (const part of data.parts ?? []) {
      if (part.type === "asset") assetIds.add(part.assetId);
    }
  }
  return assets.filter((asset) => assetIds.has(asset.id));
}

function generatedResultPosition(
  source: CanvasNode,
  width: number,
  height: number,
  occupiedNodes: readonly CanvasNode[],
): { x: number; y: number } {
  const sourceSize = nodeDimensions(source);
  const sourceGap = 72;
  const resultGap = 40;
  const x = source.position.x + sourceSize.width + sourceGap;
  let y = source.position.y;
  for (let attempt = 0; attempt < occupiedNodes.length + 8; attempt += 1) {
    const overlaps = occupiedNodes.some((node) => {
      if (node.id === source.id) return false;
      const size = nodeDimensions(node);
      return !(
        x + width + 24 <= node.position.x ||
        x >= node.position.x + size.width + 24 ||
        y + height + 24 <= node.position.y ||
        y >= node.position.y + size.height + 24
      );
    });
    if (!overlaps) return { x, y };
    y += height + resultGap;
  }
  return { x, y };
}

function layoutGeneratedResults(nodes: CanvasNode[]): CanvasNode[] {
  const sources = new Map(nodes.map((node) => [node.id, node]));
  const generated = nodes
    .filter(
      (node) =>
        node.data.generatedResult === true &&
        typeof node.data.generatedFromNodeId === "string",
    )
    .sort(
      (left, right) =>
        (left.data.generatedFromNodeId ?? "").localeCompare(
          right.data.generatedFromNodeId ?? "",
        ) ||
        (left.data.generatedOutputIndex ?? 0) -
          (right.data.generatedOutputIndex ?? 0),
    );
  if (generated.length === 0) return nodes;

  const occupied = nodes.filter((node) => node.data.generatedResult !== true);
  let changed = false;
  const next = nodes.map((node) => {
    if (node.data.generatedResult !== true) return node;
    const sourceId = node.data.generatedFromNodeId;
    const source = sourceId ? sources.get(sourceId) : undefined;
    if (!source) return node;
    const size = nodeDimensions(node);
    const position = generatedResultPosition(
      source,
      size.width,
      size.height,
      occupied,
    );
    occupied.push({ ...node, position });
    if (
      Math.abs(node.position.x - position.x) < 0.5 &&
      Math.abs(node.position.y - position.y) < 0.5
    )
      return node;
    changed = true;
    return { ...node, position };
  });
  return changed ? next : nodes;
}

function createGeneratedResultNode(
  source: CanvasNode,
  runId: string,
  kind: "image" | "video",
  outputIndex: number,
  status: NodeRunStatus,
  assetId: string | undefined,
  error: string | RunErrorDetails | undefined,
  occupiedNodes: readonly CanvasNode[],
  generatedPromptParts: PromptPart[] = [],
): CanvasNode {
  const aspectRatio = generatedMediaAspectRatio(source);
  const width = 320;
  const height = width / aspectRatio;
  return {
    id: `generated-result-${runId}-${source.id}-${outputIndex}`,
    type: "workflow",
    position: generatedResultPosition(source, width, height, occupiedNodes),
    style: { width, height },
    data: {
      nodeType: "asset-input",
      label:
        kind === "video"
          ? `生成视频 ${outputIndex + 1}`
          : `生成图片 ${outputIndex + 1}`,
      assetId,
      assetKind: kind,
      generatedResult: true,
      generatedStatus: status,
      generatedError: error,
      generatedFromNodeId: source.id,
      generatedFromRunId: runId,
      generatedPromptParts: structuredClone(generatedPromptParts),
      ...(typeof source.data.provider === "string"
        ? { generatedProvider: source.data.provider }
        : {}),
      generatedOutputIndex: outputIndex,
      mediaAspectRatio: aspectRatio,
      inputs: [port(GENERATED_RESULT_INPUT_HANDLE, kind, "生成来源")],
      outputs: [port("asset", kind, kind === "video" ? "视频" : "图片")],
    },
  };
}

function generatedResultEdgeId(resultNodeId: string): string {
  return `${GENERATED_RESULT_EDGE_PREFIX}${resultNodeId}`;
}

function generatedResultSourceHandle(
  source: CanvasNode,
  kind: "image" | "video",
): string {
  const compatibleKinds =
    kind === "video"
      ? new Set(["video", "video[]"])
      : new Set(["image", "image[]"]);
  return (
    source.data.outputs?.find((output) => compatibleKinds.has(output.kind))
      ?.id ?? (kind === "video" ? "video" : "images")
  );
}

function ensureGeneratedResultInputs(nodes: CanvasNode[]): CanvasNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.data.generatedResult !== true) return node;
    const kind = node.data.assetKind === "video" ? "video" : "image";
    const input = node.data.inputs?.find(
      (candidate) => candidate.id === GENERATED_RESULT_INPUT_HANDLE,
    );
    if (
      input?.kind === kind &&
      input.label === "生成来源" &&
      input.required !== true &&
      input.multiple !== true
    ) {
      return node;
    }
    changed = true;
    return {
      ...node,
      data: {
        ...node.data,
        inputs: [port(GENERATED_RESULT_INPUT_HANDLE, kind, "生成来源")],
      },
    };
  });
  return changed ? next : nodes;
}

function generatedResultEdge(
  source: CanvasNode,
  result: CanvasNode,
): CanvasEdge {
  const kind = result.data.assetKind === "video" ? "video" : "image";
  const status = result.data.generatedStatus;
  const animated = status
    ? !terminalGeneratedResultStatuses.has(status)
    : !result.data.assetId;
  return {
    id: generatedResultEdgeId(result.id),
    source: source.id,
    sourceHandle: generatedResultSourceHandle(source, kind),
    target: result.id,
    targetHandle: GENERATED_RESULT_INPUT_HANDLE,
    type: "smoothstep",
    animated,
  };
}

function sameGeneratedResultEdge(
  current: CanvasEdge,
  expected: CanvasEdge,
): boolean {
  return (
    current.id === expected.id &&
    current.source === expected.source &&
    current.sourceHandle === expected.sourceHandle &&
    current.target === expected.target &&
    current.targetHandle === expected.targetHandle &&
    current.type === expected.type &&
    current.animated === expected.animated
  );
}

function syncGeneratedResultEdges(
  nodes: readonly CanvasNode[],
  edges: CanvasEdge[],
): CanvasEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const expectedById = new Map<string, CanvasEdge>();
  const resultById = new Map<string, CanvasNode>();

  for (const result of nodes) {
    if (result.data.generatedResult !== true) continue;
    resultById.set(result.id, result);
    const sourceId = result.data.generatedFromNodeId;
    const source = sourceId ? nodeById.get(sourceId) : undefined;
    if (!source) continue;
    const expected = generatedResultEdge(source, result);
    expectedById.set(expected.id, expected);
  }

  const seen = new Set<string>();
  const next: CanvasEdge[] = [];
  for (const edge of edges) {
    const expected = expectedById.get(edge.id);
    if (expected) {
      if (seen.has(expected.id)) continue;
      next.push(sameGeneratedResultEdge(edge, expected) ? edge : expected);
      seen.add(expected.id);
      continue;
    }

    const result = resultById.get(edge.target);
    const expectedForTarget = result
      ? expectedById.get(generatedResultEdgeId(result.id))
      : undefined;
    if (
      expectedForTarget &&
      (edge.targetHandle === GENERATED_RESULT_INPUT_HANDLE ||
        edge.id.startsWith(GENERATED_RESULT_EDGE_PREFIX))
    ) {
      continue;
    }
    next.push(edge);
  }

  for (const [id, expected] of expectedById) {
    if (!seen.has(id)) next.push(expected);
  }

  return next.length === edges.length &&
    next.every((edge, index) => edge === edges[index])
    ? edges
    : next;
}

function generatedOutputCount(
  source: CanvasNode,
  archivedOutputCount: number,
): number {
  const configured = Number(source.data.parameters?.n ?? 1);
  const requested =
    Number.isFinite(configured) && configured > 0
      ? Math.min(10, Math.max(1, Math.trunc(configured)))
      : 1;
  return Math.min(10, Math.max(requested, archivedOutputCount));
}

function generatedResultError(
  status: NodeRunStatus,
  error: RunErrorDetails | null | undefined,
  provider?: string,
): string | RunErrorDetails | undefined {
  const localized = localizeRunError(error, { provider });
  if (localized) return localized;
  if (status === "failed") return "生成失败";
  if (status === "cancelled") return "生成已取消";
  if (status === "needs_attention") return "生成需要人工处理";
  return undefined;
}

function sameRunError(
  left: CanvasNodeData["generatedError"],
  right: CanvasNodeData["generatedError"],
): boolean {
  if (left === right) return true;
  if (typeof left === "string" || typeof right === "string") return false;
  if (!left || !right) return false;
  return (
    left.message === right.message &&
    left.type === right.type &&
    left.code === right.code &&
    left.api === right.api &&
    left.docsUrl === right.docsUrl
  );
}

function runErrorMessage(value: CanvasNodeData["generatedError"]): string {
  return localizeRunError(value)?.message ?? "生成失败";
}

function generationNodesForRun(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  nodeId: string | undefined,
  scope: "node" | "downstream" | "all",
): CanvasNode[] {
  if (scope === "all") {
    return nodes.filter(
      (node) =>
        node.data.nodeType === "image-generation" ||
        node.data.nodeType === "video-generation",
    );
  }
  if (!nodeId) return [];

  const selected = new Set<string>([nodeId]);
  if (scope === "downstream") {
    const pending = [nodeId];
    while (pending.length > 0) {
      const sourceId = pending.pop()!;
      for (const edge of edges) {
        if (edge.source !== sourceId || selected.has(edge.target)) continue;
        selected.add(edge.target);
        pending.push(edge.target);
      }
    }
  }
  return nodes.filter(
    (node) =>
      selected.has(node.id) &&
      (node.data.nodeType === "image-generation" ||
        node.data.nodeType === "video-generation"),
  );
}

function promptPartsFromNode(node: CanvasNode | undefined): PromptPart[] {
  return Array.isArray(node?.data.parts)
    ? structuredClone(node.data.parts)
    : [{ type: "text", text: "" }];
}

function hasPromptText(parts: readonly PromptPart[]): boolean {
  return parts.some(
    (part) => part.type === "text" && part.text.trim().length > 0,
  );
}

function generationPromptParts(
  source: CanvasNode,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): PromptPart[] {
  const inlineParts = promptPartsFromNode(source);
  const connectedParts = edges
    .filter((edge) => edge.target === source.id)
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node) => node?.data.nodeType === "prompt")
    .flatMap((node, index) => [
      ...(index > 0 ? ([{ type: "text", text: " " }] as PromptPart[]) : []),
      ...promptPartsFromNode(node),
    ]);
  return hasPromptText(inlineParts) || connectedParts.length === 0
    ? inlineParts
    : connectedParts;
}

function createPendingGeneratedResults(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  nodeId: string | undefined,
  scope: "node" | "downstream" | "all",
  requestId: string,
  retryResultNodeId?: string,
): CanvasNode[] {
  const additions: CanvasNode[] = [];
  let changed = false;
  const nextNodes = [...nodes];
  const sources = generationNodesForRun(nodes, edges, nodeId, scope);

  if (retryResultNodeId) {
    const retryIndex = nextNodes.findIndex(
      (node) =>
        node.id === retryResultNodeId &&
        node.data.generatedResult === true &&
        sources.some((source) => source.id === node.data.generatedFromNodeId),
    );
    if (retryIndex >= 0) {
      const retryResult = nextNodes[retryIndex]!;
      const retrySource = sources.find(
        (source) => source.id === retryResult.data.generatedFromNodeId,
      );
      nextNodes[retryIndex] = {
        ...retryResult,
        data: {
          ...retryResult.data,
          assetId: undefined,
          generatedStatus: "queued",
          generatedError: undefined,
          generatedFromRunId: undefined,
          generatedPendingRequestId: requestId,
          ...(retrySource
            ? {
                generatedPromptParts: generationPromptParts(
                  retrySource,
                  nodes,
                  edges,
                ),
              }
            : {}),
        },
      };
      changed = true;
    }
  }

  for (const source of sources) {
    const kind =
      source.data.nodeType === "video-generation" ? "video" : "image";
    const outputCount = generatedOutputCount(source, 0);
    for (let outputIndex = 0; outputIndex < outputCount; outputIndex += 1) {
      const matchesPendingOutput = (node: CanvasNode) =>
        node.data.generatedResult === true &&
        node.data.generatedPendingRequestId === requestId &&
        node.data.generatedFromNodeId === source.id &&
        node.data.generatedOutputIndex === outputIndex;
      const existingIndex = nextNodes.findIndex(matchesPendingOutput);
      if (existingIndex >= 0) {
        const existing = nextNodes[existingIndex]!;
        if (
          existing.data.generatedStatus !== "queued" ||
          existing.data.generatedError !== undefined
        ) {
          nextNodes[existingIndex] = {
            ...existing,
            data: {
              ...existing.data,
              generatedStatus: "queued",
              generatedError: undefined,
            },
          };
          changed = true;
        }
        continue;
      }

      const pendingNode = createGeneratedResultNode(
        source,
        `pending-${requestId}`,
        kind,
        outputIndex,
        "queued",
        undefined,
        undefined,
        [...nextNodes, ...additions],
        generationPromptParts(source, nodes, edges),
      );
      pendingNode.data.generatedFromRunId = undefined;
      pendingNode.data.generatedPendingRequestId = requestId;
      additions.push(pendingNode);
      changed = true;
    }
  }

  return changed ? [...nextNodes, ...additions] : nodes;
}

function defaultModelForConnection(
  connection: ProviderConnectionView | undefined,
): string | undefined {
  const direct = connection?.config.defaultModel;
  return typeof direct === "string" && direct.trim()
    ? direct.trim()
    : undefined;
}

function modelForConnectionAndNode(
  connection: ProviderConnectionView,
  nodeType: "image-generation" | "video-generation",
  preferredId?: string,
): ModelDescriptor | null {
  const compatible = modelDescriptorsFromConnectionConfig(
    connection.config,
  ).filter((model) => modelSupportsNodeType(model, nodeType));
  return (
    compatible.find((model) => model.id === preferredId) ??
    compatible.find((model) => model.isDefault) ??
    compatible[0] ??
    null
  );
}

function connectionIsConfigured(connection: ProviderConnectionView): boolean {
  if (connection.apiKeyUsable ?? connection.apiKeySet) return true;
  const connector = connection.config.connector;
  if (!connector || typeof connector !== "object" || Array.isArray(connector))
    return false;
  const auth = (connector as Record<string, unknown>).auth;
  return Boolean(
    auth &&
    typeof auth === "object" &&
    !Array.isArray(auth) &&
    (auth as Record<string, unknown>).type === "none",
  );
}

function newGenerationConnectionPriority(
  connection: ProviderConnectionView,
  nodeType: "image-generation" | "video-generation",
): number {
  if (providerConnectionUsage(connection) !== "canvas") return -1;
  if (!connectionIsConfigured(connection)) return -1;
  if (
    nodeType === "image-generation" &&
    isCangyuanImagePreset(connection.config.preset)
  ) {
    if (connection.config.modelGroup === CANGYUAN_ALL_MODELS_GROUP) return 100;
    if (connection.config.modelGroup === "IMAGE") return 80;
    return 60;
  }
  return 0;
}

function configureNewGenerationNode(
  node: CanvasNode,
  connections: readonly ProviderConnectionView[],
): CanvasNode | null {
  const nodeType = node.data.nodeType;
  if (nodeType !== "image-generation" && nodeType !== "video-generation")
    return node;
  const rankedConnections = connections
    .map((connection, index) => ({
      connection,
      index,
      priority: newGenerationConnectionPriority(connection, nodeType),
    }))
    .filter((candidate) => candidate.priority >= 0)
    .sort(
      (left, right) =>
        right.priority - left.priority || left.index - right.index,
    );
  for (const { connection } of rankedConnections) {
    if (providerConnectionUsage(connection) !== "canvas") continue;
    if (!connectionIsConfigured(connection)) continue;
    const preferredModel =
      nodeType === "image-generation" &&
      isCangyuanImagePreset(connection.config.preset) &&
      connection.config.modelGroup === CANGYUAN_ALL_MODELS_GROUP
        ? CANGYUAN_IMAGE_4K_MODEL
        : defaultModelForConnection(connection);
    const model = modelForConnectionAndNode(
      connection,
      nodeType,
      preferredModel,
    );
    if (!model) continue;
    return {
      ...node,
      data: {
        ...node.data,
        provider: connection.provider,
        connectionId: connection.id,
        model: model.id,
        inputs: generationInputsForModel(nodeType, model, node.data.inputs),
        parameters: parametersWithDefaults(
          parameterDescriptorsFor(nodeType, connection.provider, model),
        ),
      },
    };
  }
  return null;
}

function generationInputsForModel(
  nodeType: "image-generation" | "video-generation",
  model: ModelDescriptor | null | undefined,
  fallback: CanvasNodeData["inputs"],
): CanvasNodeData["inputs"] {
  if (nodeType === "image-generation" || !model) return fallback;
  const inputs = [port("prompt", "text", "Prompt", false)];
  const maxImages = model.limits?.maxInputImages ?? 0;
  const maxVideos = model.limits?.maxInputVideos ?? 0;
  const maxAudios = model.limits?.maxInputAudios ?? 0;
  const metadata = model.metadata ?? {};
  const referenceMode = metadata.referenceMode;
  const firstLast = metadata.supportsFirstLastFrames === true;
  if (maxImages > 0 && (referenceMode === "frame" || firstLast)) {
    inputs.push(
      port("firstFrame", "image", maxImages === 1 ? "参考帧" : "首帧", false),
    );
    if (maxImages > 1) inputs.push(port("lastFrame", "image", "尾帧", false));
  }
  if (maxImages > 0 && (referenceMode !== "frame" || firstLast)) {
    inputs.push(port("references", "image[]", "参考图", false, true));
  }
  if (maxVideos > 0) {
    inputs.push(port("referenceVideos", "video[]", "参考视频", false, true));
  }
  if (maxAudios > 0) {
    inputs.push(port("referenceAudios", "audio[]", "参考音频", false, true));
  }
  return inputs;
}

function modelOptionsForNode(
  node: CanvasNode,
  connections: readonly ProviderConnectionView[],
  listed: { connectionId: string; items: readonly ModelDescriptor[] },
): ModelDescriptor[] {
  const nodeType = node.data.nodeType;
  if (nodeType !== "image-generation" && nodeType !== "video-generation")
    return [];
  if (node.data.provider === "fake") {
    return [
      {
        id: nodeType === "video-generation" ? "fake-video-v1" : "fake-image-v1",
        name: "Fake",
        operations:
          nodeType === "video-generation"
            ? ["video.generate", "video.image-to-video"]
            : ["image.generate", "image.edit"],
      },
    ];
  }
  const connection = connections.find(
    (candidate) => candidate.id === node.data.connectionId,
  );
  const configured = connection
    ? modelDescriptorsFromConnectionConfig(connection.config).filter((model) =>
        modelSupportsNodeType(model, nodeType),
      )
    : [];
  if (listed.connectionId === node.data.connectionId) {
    const compatible = listed.items.filter((model) =>
      modelSupportsNodeType(model, nodeType),
    );
    if (compatible.length > 0) return [...compatible];
  }
  return configured;
}

function starterGraph(): CanvasDocument {
  const prompt = createNode("prompt", { x: 80, y: 185 }, 0);
  const image = createNode("image-generation", { x: 490, y: 150 });
  const video = createNode("video-generation", { x: 980, y: 150 });
  const preview = createNode("preview", { x: 1470, y: 185 });
  const edges: CanvasEdge[] = [
    {
      id: "edge-prompt-image",
      source: prompt.id,
      sourceHandle: "prompt",
      target: image.id,
      targetHandle: "prompt",
      type: "smoothstep",
    },
    {
      id: "edge-prompt-video",
      source: prompt.id,
      sourceHandle: "prompt",
      target: video.id,
      targetHandle: "prompt",
      type: "smoothstep",
      style: { strokeDasharray: "5 5" },
    },
    {
      id: "edge-image-video",
      source: image.id,
      sourceHandle: "images",
      target: video.id,
      targetHandle: "firstFrame",
      type: "smoothstep",
    },
    {
      id: "edge-video-preview",
      source: video.id,
      sourceHandle: "video",
      target: preview.id,
      targetHandle: "video",
      type: "smoothstep",
    },
  ];
  return {
    schemaVersion: 1,
    nodes: [prompt, image, video, preview],
    edges,
    viewport: { x: 0, y: 0, zoom: 0.85 },
  };
}

const transientNodeDataKeys = new Set([
  "onRun",
  "onRegenerate",
  "onSelect",
  "onOpenPreview",
  "onPrepareReversePrompt",
  "onDelete",
  "onResizeStart",
  "onPromptPartsChange",
  "onConnectionChange",
  "onModelChange",
  "onParametersChange",
  "onMediaAspectRatio",
  "onLinkedAssetDuration",
  "onOpenApiSettings",
  "generatedPromptText",
  "connectionOptions",
  "modelOptions",
  "assets",
  "mentionAssets",
  "linkedAssets",
  "linkedAssetDurations",
  "linkedAssetWarnings",
  "linkedAssetLimitText",
  "connectionPreviewActive",
  "connectionHighlight",
  "compatibleInputIds",
  "status",
]);

function serializableNode(node: CanvasNode): CanvasNode {
  return {
    ...node,
    data: Object.fromEntries(
      Object.entries(node.data).filter(
        ([key, value]) =>
          !transientNodeDataKeys.has(key) && typeof value !== "function",
      ),
    ) as CanvasNodeData,
  };
}

function serializableGraph(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  viewport?: { x: number; y: number; zoom: number },
  drawings: readonly CanvasDrawingStroke[] = useCanvasStore.getState().drawings,
): CanvasDocument {
  const persistedNodes = nodes.filter(
    (node) => node.data.pendingImport !== true,
  );
  const persistedNodeIds = new Set(persistedNodes.map((node) => node.id));
  return {
    schemaVersion: 1,
    nodes: persistedNodes.map(serializableNode),
    edges: edges.filter(
      (edge) =>
        persistedNodeIds.has(edge.source) && persistedNodeIds.has(edge.target),
    ),
    viewport,
    drawings: drawings.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    })),
  };
}

function parseImportedDrawings(value: unknown): CanvasDrawingStroke[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("涂鸦数据格式无效");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error(`第 ${index + 1} 条涂鸦格式无效`);
    const stroke = item as Record<string, unknown>;
    if (
      typeof stroke.id !== "string" ||
      !/^#[0-9a-f]{6}$/iu.test(String(stroke.color ?? "")) ||
      typeof stroke.width !== "number" ||
      !Number.isFinite(stroke.width) ||
      stroke.width <= 0 ||
      stroke.width > 96 ||
      !Array.isArray(stroke.points) ||
      stroke.points.length === 0 ||
      stroke.points.length > 4_000
    )
      throw new Error(`第 ${index + 1} 条涂鸦格式无效`);
    const points = stroke.points.map((point) => {
      if (!point || typeof point !== "object" || Array.isArray(point))
        throw new Error(`第 ${index + 1} 条涂鸦坐标无效`);
      const candidate = point as Record<string, unknown>;
      if (
        typeof candidate.x !== "number" ||
        !Number.isFinite(candidate.x) ||
        typeof candidate.y !== "number" ||
        !Number.isFinite(candidate.y)
      )
        throw new Error(`第 ${index + 1} 条涂鸦坐标无效`);
      return { x: candidate.x, y: candidate.y };
    });
    return {
      id: stroke.id,
      color: String(stroke.color),
      width: stroke.width,
      points,
    };
  });
}

function nodePortKind(
  node: CanvasNode,
  handle: string | null | undefined,
  direction: "source" | "target",
): PortKind | undefined {
  const ports =
    direction === "source"
      ? (node.data.outputs ?? [])
      : (node.data.inputs ?? []);
  return ports.find((port) => port.id === handle)?.kind as PortKind | undefined;
}

function CanvasShell() {
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const {
    title,
    nodes,
    edges,
    drawings,
    selectedId,
    viewport,
    setTitle,
    setNodes,
    setEdges,
    setDrawings,
    setSelectedId,
    setViewport,
  } = useCanvasStore();
  const [assets, setAssets] = useState<AssetView[]>([]);
  const [linkedAssetDurations, setLinkedAssetDurations] = useState<
    Record<string, number>
  >({});
  const [durationReadFailures, setDurationReadFailures] = useState<
    Record<string, boolean>
  >({});
  const [connections, setConnections] = useState<ProviderConnectionView[]>([]);
  const [connectionModels, setConnectionModels] = useState<{
    connectionId: string;
    items: ModelDescriptor[];
  }>({ connectionId: "", items: [] });
  const [nodeRunStatuses, setNodeRunStatuses] = useState<
    Map<string, NodeRunStatus>
  >(new Map());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialCangyuanGroup, setSettingsInitialCangyuanGroup] =
    useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<AssetView | null>(null);
  const [previewReturnsToHistory, setPreviewReturnsToHistory] = useState(false);
  const [agentDraftRequest, setAgentDraftRequest] =
    useState<AgentDraftRequest | null>(null);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [inspectorResizing, setInspectorResizing] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [connectionMenu, setConnectionMenu] =
    useState<ConnectionMenuState | null>(null);
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuState | null>(null);
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [canvasMode, setCanvasMode] = useState<CanvasInteractionMode>("pan");
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("freehand");
  const [brushColor, setBrushColor] = useState("#f4f1ff");
  const [brushSize, setBrushSize] = useState(8);
  const [activeStroke, setActiveStroke] = useState<CanvasDrawingStroke | null>(
    null,
  );
  const [selectedDrawingIds, setSelectedDrawingIds] = useState<Set<string>>(
    new Set(),
  );
  const [drawingSelectionStart, setDrawingSelectionStart] =
    useState<CanvasDrawingPoint | null>(null);
  const [drawingSelectionEnd, setDrawingSelectionEnd] =
    useState<CanvasDrawingPoint | null>(null);
  const [mergingDrawings, setMergingDrawings] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<{
    nodeId: string;
    handleId: string;
    kind: PortKind;
  } | null>(null);
  const [modelLoadError, setModelLoadError] = useState<{
    connectionId: string;
    message: string;
  } | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(
    null,
  );
  const canvasWrapRef = useRef<HTMLElement | null>(null);
  const recentNativeDropsRef = useRef(new Map<string, number>());
  const pendingNativeDropsRef = useRef(new Map<string, number>());
  const activeBridgeDropsRef = useRef(new Set<string>());
  const materialDropConsumerIdRef = useRef(crypto.randomUUID());
  const initialViewportApplied = useRef(false);
  const toastTimer = useRef<number | null>(null);
  const toastSeq = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSources = useRef<Map<string, EventSource>>(new Map());
  const activeRunKeys = useRef(new Set<string>());
  const inspectorResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const drawingInteractionRef = useRef<{
    pointerId: number;
    mode: "draw" | "select-drawing" | "move-drawing";
    start: CanvasDrawingPoint;
    additive: boolean;
    tool?: DrawingTool;
    originalDrawings?: CanvasDrawingStroke[];
    movingIds?: Set<string>;
    moved?: boolean;
  } | null>(null);
  const activeStrokeRef = useRef<CanvasDrawingStroke | null>(null);
  const linkedAssetDurationsRef = useRef<Record<string, number>>({});
  const durationLoadPromises = useRef(
    new Map<string, Promise<number | undefined>>(),
  );
  const importInput = useRef<HTMLInputElement | null>(null);
  const graphRef = useRef<{ nodes: CanvasNode[]; edges: CanvasEdge[] }>({
    nodes: [],
    edges: [],
  });
  const nodeClipboardRef = useRef<{
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    pasteCount: number;
  } | null>(null);
  const historyRef = useRef<{
    past: CanvasDocument[];
    future: CanvasDocument[];
    lastAt: number;
  }>({ past: [], future: [], lastAt: 0 });
  const saveQueue = useRef<LatestTaskQueue<CanvasSaveRequest> | null>(null);
  if (saveQueue.current === null) {
    saveQueue.current = new LatestTaskQueue(async (request) => {
      await saveCanvas(request.canvasId, request.graph, request.title);
    });
  }

  useEffect(() => {
    graphRef.current = { nodes, edges };
  }, [nodes, edges]);

  useEffect(() => {
    const stored = Number(
      window.localStorage.getItem(INSPECTOR_WIDTH_STORAGE_KEY),
    );
    const frame = Number.isFinite(stored)
      ? window.requestAnimationFrame(() =>
          setInspectorWidth(clampInspectorWidth(stored)),
        )
      : null;
    const handleResize = () =>
      setInspectorWidth((current) => clampInspectorWidth(current));
    window.addEventListener("resize", handleResize);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = inspectorResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      setInspectorWidth(
        clampInspectorWidth(resize.startWidth + resize.startX - event.clientX),
      );
    };
    const finishPointerResize = (event: PointerEvent) => {
      const resize = inspectorResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      const finalWidth = clampInspectorWidth(
        resize.startWidth + resize.startX - event.clientX,
      );
      inspectorResizeRef.current = null;
      setInspectorResizing(false);
      setInspectorWidth(finalWidth);
      window.localStorage.setItem(
        INSPECTOR_WIDTH_STORAGE_KEY,
        String(finalWidth),
      );
    };
    const cancelPointerResize = (event: PointerEvent) => {
      if (inspectorResizeRef.current?.pointerId !== event.pointerId) return;
      inspectorResizeRef.current = null;
      setInspectorResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishPointerResize);
    window.addEventListener("pointercancel", cancelPointerResize);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishPointerResize);
      window.removeEventListener("pointercancel", cancelPointerResize);
    };
  }, []);

  // React Flow initializes before the canvas graph is fetched. Apply the
  // persisted viewport once the first nodes arrive; otherwise
  // `onlyRenderVisibleElements` can keep every node unmounted after reload.
  useEffect(() => {
    if (
      !canvasId ||
      nodes.length === 0 ||
      initialViewportApplied.current ||
      !reactFlowRef.current
    )
      return;
    reactFlowRef.current.setViewport(viewport);
    initialViewportApplied.current = true;
  }, [canvasId, nodes.length, viewport]);

  const selectedNode = selectedId
    ? (nodes.find((node) => node.id === selectedId) ?? null)
    : null;
  const statuses = useMemo(() => nodeRunStatuses, [nodeRunStatuses]);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    // One timer for the whole app: without this a fast second toast used to be
    // cleared early by the first toast's pending timeout.
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ message, tone, id: (toastSeq.current += 1) });
    toastTimer.current = window.setTimeout(
      () => {
        toastTimer.current = null;
        setToast(null);
      },
      tone === "error" ? 5_500 : 3_500,
    );
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast(null);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const recordLinkedAssetDuration = useCallback(
    (assetId: string, seconds: number) => {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      const normalized = Number(seconds.toFixed(2));
      if (linkedAssetDurationsRef.current[assetId] === normalized) return;
      linkedAssetDurationsRef.current = {
        ...linkedAssetDurationsRef.current,
        [assetId]: normalized,
      };
      setLinkedAssetDurations(linkedAssetDurationsRef.current);
      setDurationReadFailures((current) => {
        if (!current[assetId]) return current;
        const next = { ...current };
        delete next[assetId];
        return next;
      });
    },
    [],
  );

  const loadLinkedAssetDuration = useCallback(
    (asset: AssetView): Promise<number | undefined> => {
      const cached = linkedAssetDurationsRef.current[asset.id];
      if (cached !== undefined) return Promise.resolve(cached);
      const pending = durationLoadPromises.current.get(asset.id);
      if (pending) return pending;
      if (asset.kind !== "video" && asset.kind !== "audio")
        return Promise.resolve(undefined);

      const promise = new Promise<number | undefined>((resolve) => {
        const media = document.createElement(asset.kind) as HTMLMediaElement;
        let settled = false;
        const finish = (seconds?: number) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          media.removeAttribute("src");
          media.load();
          if (seconds !== undefined)
            recordLinkedAssetDuration(asset.id, seconds);
          else
            setDurationReadFailures((current) => ({
              ...current,
              [asset.id]: true,
            }));
          resolve(seconds);
        };
        const timeout = window.setTimeout(() => finish(), 10_000);
        media.preload = "metadata";
        media.onloadedmetadata = () => {
          const seconds = media.duration;
          finish(Number.isFinite(seconds) && seconds > 0 ? seconds : undefined);
        };
        media.onerror = () => finish();
        media.src = `/api/assets/${encodeURIComponent(asset.id)}/content`;
        media.load();
      }).finally(() => durationLoadPromises.current.delete(asset.id));
      durationLoadPromises.current.set(asset.id, promise);
      return promise;
    },
    [recordLinkedAssetDuration],
  );

  const refreshAssets = useCallback(async () => {
    try {
      setAssets(await fetchAssets());
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "素材库读取失败",
        "error",
      );
    }
  }, [showToast]);

  useEffect(() => {
    const streams = eventSources.current;
    void (async () => {
      try {
        const [canvas, list, providerConnections] = await Promise.all([
          fetchCanvas(),
          fetchAssets(),
          fetchConnections(),
        ]);
        setCanvasId(canvas.id);
        setTitle(canvas.title);
        setAssets(list);
        setConnections(providerConnections);
        const graph = canvas.graph.nodes?.length
          ? canvas.graph
          : starterGraph();
        const typedNodes = graph.nodes.map((node) => ({
          ...node,
          type: "workflow" as const,
        }));
        const graphNodes = layoutGeneratedResults(
          ensureGeneratedResultInputs(typedNodes),
        );
        const graphEdges = syncGeneratedResultEdges(graphNodes, graph.edges);
        const graphDrawings = graph.drawings ?? [];
        const graphWasReconciled =
          graphNodes !== typedNodes || graphEdges !== graph.edges;
        setNodes(graphNodes);
        setEdges(graphEdges);
        setDrawings(graphDrawings);
        setViewport(graph.viewport ?? { x: 0, y: 0, zoom: 0.85 });
        if (!canvas.graph.nodes?.length || graphWasReconciled)
          saveTimer.current = setTimeout(() => {
            saveTimer.current = null;
            void saveQueue.current
              ?.enqueue({
                canvasId: canvas.id,
                title: canvas.title,
                graph: serializableGraph(
                  graphNodes,
                  graphEdges,
                  graph.viewport ?? { x: 0, y: 0, zoom: 0.85 },
                  graphDrawings,
                ),
              })
              .catch((error: unknown) =>
                showToast(
                  error instanceof Error ? error.message : "画布保存失败",
                  "error",
                ),
              );
          }, 200);
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "初始化失败",
          "error",
        );
      }
    })();
    return () => {
      for (const stream of streams.values()) stream.close();
      streams.clear();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveGraph = useCallback(
    async (
      id: string,
      nextNodes: CanvasNode[],
      nextEdges: CanvasEdge[],
      nextViewport = useCanvasStore.getState().viewport,
      nextDrawings = useCanvasStore.getState().drawings,
    ) => {
      setSaveState("saving");
      try {
        await saveQueue.current?.enqueue({
          canvasId: id,
          graph: serializableGraph(
            nextNodes,
            nextEdges,
            nextViewport,
            nextDrawings,
          ),
          title: useCanvasStore.getState().title,
        });
        // A newer edit may have queued another save while this one was in
        // flight; only the last writer clears the indicator.
        setSaveState((current) => (current === "saving" ? "saved" : current));
      } catch (error) {
        setSaveState("error");
        showToast(
          error instanceof Error ? error.message : "画布保存失败",
          "error",
        );
      }
    },
    [showToast],
  );

  const scheduleSave = useCallback(
    (
      nextNodes: CanvasNode[],
      nextEdges: CanvasEdge[],
      nextViewport = useCanvasStore.getState().viewport,
      nextDrawings = useCanvasStore.getState().drawings,
    ) => {
      if (!canvasId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState("pending");
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void saveGraph(
          canvasId,
          nextNodes,
          nextEdges,
          nextViewport,
          nextDrawings,
        );
      }, 650);
    },
    [canvasId, saveGraph],
  );

  /** Flushes the debounced autosave immediately (Ctrl/Cmd+S, project menu). */
  const saveNow = useCallback(async () => {
    if (!canvasId) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const state = useCanvasStore.getState();
    await saveGraph(
      canvasId,
      state.nodes,
      state.edges,
      state.viewport,
      state.drawings,
    );
  }, [canvasId, saveGraph]);

  const checkpoint = useCallback(
    (force = false) => {
      const history = historyRef.current;
      const now = Date.now();
      if (!force && now - history.lastAt < 450) return;
      history.past.push(
        serializableGraph(
          graphRef.current.nodes,
          graphRef.current.edges,
          viewport,
        ),
      );
      if (history.past.length > 50) history.past.shift();
      history.future = [];
      history.lastAt = now;
    },
    [viewport],
  );

  const restoreSnapshot = useCallback(
    (snapshot: CanvasDocument) => {
      const nextNodes = layoutGeneratedResults(
        ensureGeneratedResultInputs(
          snapshot.nodes.map((node) => ({
            ...node,
            type: "workflow" as const,
          })),
        ),
      );
      const nextEdges = syncGeneratedResultEdges(nextNodes, snapshot.edges);
      setNodes(nextNodes);
      setEdges(nextEdges);
      const nextDrawings = snapshot.drawings ?? [];
      setDrawings(nextDrawings);
      setViewport(snapshot.viewport ?? viewport);
      setSelectedId(null);
      setSelectedDrawingIds(new Set());
      scheduleSave(
        nextNodes,
        nextEdges,
        snapshot.viewport ?? viewport,
        nextDrawings,
      );
    },
    [
      scheduleSave,
      setDrawings,
      setEdges,
      setNodes,
      setSelectedId,
      setViewport,
      viewport,
    ],
  );

  const undo = useCallback(() => {
    const history = historyRef.current;
    const previous = history.past.pop();
    if (!previous) return;
    history.future.push(
      serializableGraph(
        graphRef.current.nodes,
        graphRef.current.edges,
        viewport,
      ),
    );
    restoreSnapshot(previous);
  }, [restoreSnapshot, viewport]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const next = history.future.pop();
    if (!next) return;
    history.past.push(
      serializableGraph(
        graphRef.current.nodes,
        graphRef.current.edges,
        viewport,
      ),
    );
    restoreSnapshot(next);
  }, [restoreSnapshot, viewport]);

  const changeCanvasMode = useCallback((mode: CanvasInteractionMode) => {
    const interaction = drawingInteractionRef.current;
    if (
      interaction?.mode === "move-drawing" &&
      interaction.moved &&
      interaction.originalDrawings
    )
      useCanvasStore.setState({ drawings: interaction.originalDrawings });
    drawingInteractionRef.current = null;
    activeStrokeRef.current = null;
    setActiveStroke(null);
    setDrawingSelectionStart(null);
    setDrawingSelectionEnd(null);
    setCanvasMode(mode);
    if (mode !== "pan") {
      useCanvasStore.setState((state) => ({
        selectedId: null,
        nodes: state.nodes.map((node) =>
          node.selected ? { ...node, selected: false } : node,
        ),
      }));
    }
  }, []);

  const activateDrawingTool = useCallback(
    (tool: DrawingTool) => {
      setDrawingTool(tool);
      changeCanvasMode("draw");
    },
    [changeCanvasMode],
  );

  const drawingPointForEvent = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): CanvasDrawingPoint | null =>
      reactFlowRef.current?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      }) ?? null,
    [],
  );

  const onDrawingWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (drawingInteractionRef.current) return;
      const instance = reactFlowRef.current;
      if (!instance) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const point = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      const deltaScale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1;
      const current = instance.getViewport();
      const targetZoom =
        current.zoom * Math.exp(-event.deltaY * deltaScale * 0.0015);
      const nextViewport = zoomViewportAtPoint(current, point, targetZoom);
      if (nextViewport === current) return;
      void instance.setViewport(nextViewport, { duration: 0 });
      setViewport(nextViewport);
      const state = useCanvasStore.getState();
      scheduleSave(state.nodes, state.edges, nextViewport, state.drawings);
    },
    [scheduleSave, setViewport],
  );

  const onDrawingPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || canvasMode === "pan") return;
      const point = drawingPointForEvent(event);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      drawingInteractionRef.current = {
        pointerId: event.pointerId,
        mode: canvasMode,
        start: point,
        additive,
        ...(canvasMode === "draw" ? { tool: drawingTool } : {}),
      };
      if (canvasMode === "draw") {
        checkpoint(true);
        const stroke: CanvasDrawingStroke = {
          id: `drawing-${crypto.randomUUID().slice(0, 12)}`,
          color: brushColor,
          width: brushSize,
          points: [point],
        };
        activeStrokeRef.current = stroke;
        setActiveStroke(stroke);
        setSelectedDrawingIds(new Set());
        return;
      }
      const zoom = reactFlowRef.current?.getViewport().zoom ?? 1;
      const hit = hitTestDrawingStrokes(
        useCanvasStore.getState().drawings,
        point,
        8 / zoom,
      );
      if (hit) {
        const nextSelection = new Set(selectedDrawingIds);
        if (additive) {
          if (nextSelection.has(hit.id)) nextSelection.delete(hit.id);
          else nextSelection.add(hit.id);
        } else if (!nextSelection.has(hit.id)) {
          nextSelection.clear();
          nextSelection.add(hit.id);
        }
        setSelectedDrawingIds(nextSelection);
        if (!nextSelection.has(hit.id)) {
          drawingInteractionRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          return;
        }
        drawingInteractionRef.current = {
          pointerId: event.pointerId,
          mode: "move-drawing",
          start: point,
          additive,
          originalDrawings: useCanvasStore.getState().drawings,
          movingIds: nextSelection,
          moved: false,
        };
        return;
      }
      if (!additive) setSelectedDrawingIds(new Set());
      setDrawingSelectionStart(point);
      setDrawingSelectionEnd(point);
    },
    [
      brushColor,
      brushSize,
      canvasMode,
      checkpoint,
      drawingTool,
      drawingPointForEvent,
      selectedDrawingIds,
    ],
  );

  const onDrawingPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const interaction = drawingInteractionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      const point = drawingPointForEvent(event);
      if (!point) return;
      event.preventDefault();
      if (interaction.mode === "move-drawing") {
        const originalDrawings = interaction.originalDrawings;
        const movingIds = interaction.movingIds;
        if (!originalDrawings || !movingIds) return;
        const deltaX = point.x - interaction.start.x;
        const deltaY = point.y - interaction.start.y;
        const zoom = reactFlowRef.current?.getViewport().zoom ?? 1;
        if (!interaction.moved && Math.hypot(deltaX, deltaY) < 2 / zoom) return;
        if (!interaction.moved) {
          checkpoint(true);
          interaction.moved = true;
        }
        setDrawings(
          translateDrawingStrokes(originalDrawings, movingIds, deltaX, deltaY),
        );
        return;
      }
      if (interaction.mode === "select-drawing") {
        setDrawingSelectionEnd(point);
        return;
      }
      const current = activeStrokeRef.current;
      if (!current) return;
      if (interaction.tool && interaction.tool !== "freehand") {
        const next = {
          ...current,
          points: drawingShapePoints(
            interaction.tool,
            interaction.start,
            point,
          ),
        };
        activeStrokeRef.current = next;
        setActiveStroke(next);
        return;
      }
      if (current.points.length >= 4_000) return;
      const previous = current.points.at(-1)!;
      const zoom = reactFlowRef.current?.getViewport().zoom ?? 1;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1.2 / zoom)
        return;
      const next = { ...current, points: [...current.points, point] };
      activeStrokeRef.current = next;
      setActiveStroke(next);
    },
    [checkpoint, drawingPointForEvent, setDrawings],
  );

  const finishDrawingInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
      const interaction = drawingInteractionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      drawingInteractionRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      if (interaction.mode === "move-drawing") {
        if (cancelled && interaction.originalDrawings) {
          setDrawings(interaction.originalDrawings);
          return;
        }
        if (interaction.moved) {
          const state = useCanvasStore.getState();
          scheduleSave(
            state.nodes,
            state.edges,
            state.viewport,
            state.drawings,
          );
        }
        return;
      }
      if (interaction.mode === "draw") {
        const stroke = activeStrokeRef.current;
        activeStrokeRef.current = null;
        setActiveStroke(null);
        const end = drawingPointForEvent(event) ?? interaction.start;
        const zoom = reactFlowRef.current?.getViewport().zoom ?? 1;
        const shapeTooSmall =
          interaction.tool !== undefined &&
          interaction.tool !== "freehand" &&
          Math.hypot(end.x - interaction.start.x, end.y - interaction.start.y) <
            3 / zoom;
        if (!cancelled && !shapeTooSmall && stroke) {
          const state = useCanvasStore.getState();
          const nextDrawings = [...state.drawings, stroke];
          setDrawings(nextDrawings);
          scheduleSave(state.nodes, state.edges, state.viewport, nextDrawings);
        }
        return;
      }
      const end =
        drawingPointForEvent(event) ?? drawingSelectionEnd ?? interaction.start;
      setDrawingSelectionStart(null);
      setDrawingSelectionEnd(null);
      if (cancelled) return;
      const zoom = reactFlowRef.current?.getViewport().zoom ?? 1;
      if (
        Math.hypot(end.x - interaction.start.x, end.y - interaction.start.y) <
        3 / zoom
      )
        return;
      const rect = normalizeDrawingRect(interaction.start, end);
      const matched = useCanvasStore
        .getState()
        .drawings.filter((stroke) => drawingStrokeIntersectsRect(stroke, rect))
        .map((stroke) => stroke.id);
      setSelectedDrawingIds((current) =>
        interaction.additive
          ? new Set([...current, ...matched])
          : new Set(matched),
      );
    },
    [drawingPointForEvent, drawingSelectionEnd, scheduleSave, setDrawings],
  );

  const deleteSelectedDrawings = useCallback(() => {
    if (selectedDrawingIds.size === 0) return false;
    checkpoint(true);
    const state = useCanvasStore.getState();
    const nextDrawings = state.drawings.filter(
      (stroke) => !selectedDrawingIds.has(stroke.id),
    );
    setDrawings(nextDrawings);
    setSelectedDrawingIds(new Set());
    scheduleSave(state.nodes, state.edges, state.viewport, nextDrawings);
    showToast(
      `已删除 ${state.drawings.length - nextDrawings.length} 条涂鸦`,
      "success",
    );
    return true;
  }, [checkpoint, scheduleSave, selectedDrawingIds, setDrawings, showToast]);

  const effectiveInputsForNode = useCallback(
    (node: CanvasNode): CanvasNodeData["inputs"] => {
      const nodeType = node.data.nodeType;
      if (nodeType !== "image-generation" && nodeType !== "video-generation")
        return node.data.inputs;
      const options = modelOptionsForNode(node, connections, connectionModels);
      const model =
        options.find((candidate) => candidate.id === node.data.model) ??
        options[0] ??
        null;
      return generationInputsForModel(nodeType, model, node.data.inputs);
    },
    [connectionModels, connections],
  );

  const connectionCheck = useCallback(
    (connection: Connection) => {
      const source = nodes.find((node) => node.id === connection.source);
      const target = nodes.find((node) => node.id === connection.target);
      const sourceKind = nodePortKind(
        source ?? ({} as CanvasNode),
        connection.sourceHandle,
        "source",
      );
      const targetInputs = target ? effectiveInputsForNode(target) : undefined;
      const targetKind = targetInputs?.find(
        (input) => input.id === connection.targetHandle,
      )?.kind as PortKind | undefined;
      const targetPort = targetInputs?.find(
        (input) => input.id === connection.targetHandle,
      );
      if (
        !source ||
        !target ||
        !sourceKind ||
        !targetKind ||
        !arePortKindsCompatible(sourceKind, targetKind)
      ) {
        return {
          valid: false,
          source,
          target,
          sourceKind,
          targetKind,
          targetPort,
          reason: `不能连接 ${sourceKind ?? "?"} → ${targetKind ?? "?"}`,
        };
      }
      if (
        wouldCreateCycle({ nodes, edges }, connection.source, connection.target)
      ) {
        return {
          valid: false,
          source,
          target,
          sourceKind,
          targetKind,
          targetPort,
          reason: "这条连线会形成循环，画布只支持无环工作流",
        };
      }
      if (
        targetPort &&
        !targetPort.multiple &&
        edges.some(
          (edge) =>
            edge.target === connection.target &&
            edge.targetHandle === connection.targetHandle,
        )
      ) {
        return {
          valid: false,
          source,
          target,
          sourceKind,
          targetKind,
          targetPort,
          reason: `${targetPort.label} 只能连接一个上游节点`,
        };
      }
      return {
        valid: true,
        source,
        target,
        sourceKind,
        targetKind,
        targetPort,
        reason: "",
      };
    },
    [edges, effectiveInputsForNode, nodes],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const check = connectionCheck(connection);
      setConnectingFrom(null);
      if (!check.valid || !connection.source || !connection.target) {
        showToast(check.reason);
        return;
      }
      checkpoint(true);
      const nextEdges = addEdge(
        {
          ...connection,
          id: `edge-${crypto.randomUUID().slice(0, 8)}`,
          type: "smoothstep",
        },
        edges,
      );
      setEdges(nextEdges);
      scheduleSave(nodes, nextEdges);
    },
    [
      checkpoint,
      connectionCheck,
      edges,
      nodes,
      scheduleSave,
      setEdges,
      showToast,
    ],
  );

  const onConnectStart: OnConnectStart = useCallback(
    (_event, params) => {
      if (
        params.handleType !== "source" ||
        !params.nodeId ||
        !params.handleId
      ) {
        setConnectingFrom(null);
        return;
      }
      const source = nodes.find((node) => node.id === params.nodeId);
      const kind = source
        ? nodePortKind(source, params.handleId, "source")
        : undefined;
      if (!kind) {
        setConnectingFrom(null);
        return;
      }
      setConnectingFrom({
        nodeId: params.nodeId,
        handleId: params.handleId,
        kind,
      });
    },
    [nodes],
  );

  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    setConnectingFrom(null);
    if (!state.fromNode || !state.fromHandle || state.toNode) return;
    const source = state.fromNode as unknown as CanvasNode;
    const kind = nodePortKind(source, state.fromHandle.id, "source");
    if (!kind) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    const rawX = point?.clientX ?? state.pointer?.x ?? 0;
    const rawY = point?.clientY ?? state.pointer?.y ?? 0;
    setConnectionMenu({
      x: Math.min(Math.max(12, rawX), Math.max(12, window.innerWidth - 188)),
      y: Math.min(Math.max(70, rawY), Math.max(70, window.innerHeight - 170)),
      source: source.id,
      sourceHandle: state.fromHandle.id ?? "output",
      sourceKind: kind,
    });
  }, []);

  const isValidConnection = useCallback(
    (connection: CanvasEdge | Connection) =>
      connectionCheck({
        source: connection.source,
        sourceHandle: connection.sourceHandle ?? null,
        target: connection.target,
        targetHandle: connection.targetHandle ?? null,
      }).valid,
    [connectionCheck],
  );

  const addConnectedNode = useCallback(
    (targetType: AutoConnectNodeType) => {
      if (!connectionMenu) return;
      const targetHandle = getAutoConnectionTargetHandle(
        connectionMenu.sourceKind,
        targetType,
      );
      if (!targetHandle) {
        showToast("没有兼容此输出类型的节点输入");
        setConnectionMenu(null);
        return;
      }
      checkpoint(true);
      const position = reactFlowRef.current?.screenToFlowPosition({
        x: connectionMenu.x,
        y: connectionMenu.y,
      }) ?? { x: 400, y: 240 };
      const node = configureNewGenerationNode(
        createNode(targetType, position, nodes.length),
        connections,
      );
      if (!node) {
        showToast("没有可用的 API 连接，请先配置并测试 API");
        setSettingsOpen(true);
        setConnectionMenu(null);
        return;
      }
      const targetPort = node.data.inputs?.find(
        (input) => input.id === targetHandle,
      );
      if (
        !targetPort ||
        !arePortKindsCompatible(
          connectionMenu.sourceKind,
          targetPort.kind as PortKind,
        )
      ) {
        showToast("没有兼容此输出类型的节点输入");
        setConnectionMenu(null);
        return;
      }
      const edge: CanvasEdge = {
        id: `edge-${crypto.randomUUID().slice(0, 8)}`,
        source: connectionMenu.source,
        sourceHandle: connectionMenu.sourceHandle,
        target: node.id,
        targetHandle,
        type: "smoothstep",
      };
      const nextNodes = [...nodes, node];
      const nextEdges = [...edges, edge];
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSelectedId(node.id);
      setConnectionMenu(null);
      scheduleSave(nextNodes, nextEdges);
    },
    [
      checkpoint,
      connectionMenu,
      connections,
      edges,
      nodes,
      scheduleSave,
      setEdges,
      setNodes,
      setSelectedId,
      showToast,
    ],
  );

  const insertNodeAt = useCallback(
    (type: string, position: { x: number; y: number }) => {
      checkpoint(true);
      const state = useCanvasStore.getState();
      const node = configureNewGenerationNode(
        createNode(type, position, state.nodes.length),
        connections,
      );
      if (!node) {
        showToast("没有可用的 API 连接，请先配置并测试 API");
        setSettingsOpen(true);
        setCanvasMenu(null);
        return null;
      }
      setNodes((current) => {
        const next = [...current, node];
        scheduleSave(next, useCanvasStore.getState().edges);
        return next;
      });
      setSelectedId(node.id);
      setCanvasMenu(null);
      setConnectionMenu(null);
      return node;
    },
    [checkpoint, connections, scheduleSave, setNodes, setSelectedId, showToast],
  );

  const addNewNode = useCallback(
    (type: string) => {
      const position = reactFlowRef.current?.screenToFlowPosition({
        x: 360 + Math.random() * 260,
        y: 150 + Math.random() * 260,
      }) ?? { x: 360, y: 180 };
      insertNodeAt(type, position);
    },
    [insertNodeAt],
  );

  const reuseHistoricalAsset = useCallback(
    (assetId: string) => {
      const asset = assets.find((item) => item.id === assetId);
      if (!asset || asset.kind === "text") {
        showToast("历史输出素材不存在或类型不受支持");
        return;
      }
      checkpoint(true);
      const position = reactFlowRef.current?.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }) ?? { x: 360, y: 220 };
      const node = createAssetInputNode(asset, position, nodes.length);
      node.data = {
        ...node.data,
        label: `固定输出 · ${asset.name}`,
        description: "固定引用某次历史运行的不可变素材 ID",
        outputs: [port("asset", asset.kind, "固定素材")],
      };
      setNodes((current) => {
        const next = [...current, node];
        scheduleSave(next, edges);
        return next;
      });
      setSelectedId(node.id);
      setHistoryOpen(false);
    },
    [
      assets,
      checkpoint,
      edges,
      nodes.length,
      scheduleSave,
      setNodes,
      setSelectedId,
      showToast,
    ],
  );

  const deleteNode = useCallback(
    (ids: string | readonly string[]) => {
      const removedIds = new Set(Array.isArray(ids) ? ids : [ids]);
      if (removedIds.size === 0) return;
      checkpoint(true);
      setNodes((current) => {
        const next = current.filter((node) => !removedIds.has(node.id));
        const nextEdges = edges.filter(
          (edge) =>
            !removedIds.has(edge.source) && !removedIds.has(edge.target),
        );
        setEdges(nextEdges);
        scheduleSave(next, nextEdges);
        return next;
      });
      setSelectedId((current) =>
        current && removedIds.has(current) ? null : current,
      );
    },
    [edges, scheduleSave, setEdges, setNodes, setSelectedId, checkpoint],
  );

  const copySelectedNodes = useCallback((): boolean => {
    const state = useCanvasStore.getState();
    const explicitlySelected = state.nodes.filter((node) => node.selected);
    const selected =
      explicitlySelected.length > 0
        ? explicitlySelected
        : state.selectedId
          ? state.nodes.filter((node) => node.id === state.selectedId)
          : [];
    if (selected.length === 0) return false;
    const selectedIds = new Set(selected.map((node) => node.id));
    nodeClipboardRef.current = {
      nodes: structuredClone(selected.map(serializableNode)),
      edges: structuredClone(
        state.edges.filter(
          (edge) =>
            selectedIds.has(edge.source) && selectedIds.has(edge.target),
        ),
      ),
      pasteCount: 0,
    };
    showToast(`已复制 ${selected.length} 个节点`, "success");
    return true;
  }, [showToast]);

  const pasteCopiedNodes = useCallback((): boolean => {
    const clipboard = nodeClipboardRef.current;
    if (!clipboard || clipboard.nodes.length === 0) return false;
    checkpoint(true);
    clipboard.pasteCount += 1;
    const offset = 36 * clipboard.pasteCount;
    const idMap = new Map(
      clipboard.nodes.map((node) => [node.id, crypto.randomUUID()] as const),
    );
    const pastedNodes = structuredClone(clipboard.nodes).map((node) => {
      const id = idMap.get(node.id)!;
      const generatedFromNodeId =
        typeof node.data.generatedFromNodeId === "string"
          ? (idMap.get(node.data.generatedFromNodeId) ??
            node.data.generatedFromNodeId)
          : undefined;
      return {
        ...node,
        id,
        selected: true,
        dragging: false,
        position: {
          x: node.position.x + offset,
          y: node.position.y + offset,
        },
        data: {
          ...node.data,
          ...(generatedFromNodeId ? { generatedFromNodeId } : {}),
        },
      } satisfies CanvasNode;
    });
    const pastedEdges = structuredClone(clipboard.edges).map((edge) => ({
      ...edge,
      id: `edge-${crypto.randomUUID()}`,
      source: idMap.get(edge.source)!,
      target: idMap.get(edge.target)!,
      selected: false,
    }));
    const state = useCanvasStore.getState();
    const nextNodes = [
      ...state.nodes.map((node) =>
        node.selected ? { ...node, selected: false } : node,
      ),
      ...pastedNodes,
    ];
    const nextEdges = syncGeneratedResultEdges(nextNodes, [
      ...state.edges,
      ...pastedEdges,
    ]);
    useCanvasStore.setState({
      nodes: nextNodes,
      edges: nextEdges,
      selectedId: pastedNodes.at(-1)?.id ?? null,
    });
    graphRef.current = { nodes: nextNodes, edges: nextEdges };
    scheduleSave(nextNodes, nextEdges, state.viewport);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(".react-flow")
        ?.focus({ preventScroll: true });
    });
    showToast(`已粘贴 ${pastedNodes.length} 个节点`, "success");
    return true;
  }, [checkpoint, scheduleSave, showToast]);

  /** Ctrl/Cmd+D — copy and paste in one step, keeping the clipboard untouched. */
  const duplicateSelectedNodes = useCallback((): boolean => {
    const preserved = nodeClipboardRef.current;
    if (!copySelectedNodes()) return false;
    const duplicated = pasteCopiedNodes();
    nodeClipboardRef.current = preserved;
    return duplicated;
  }, [copySelectedNodes, pasteCopiedNodes]);

  const selectAllNodes = useCallback((): boolean => {
    const state = useCanvasStore.getState();
    if (state.nodes.length === 0) return false;
    useCanvasStore.setState({
      nodes: state.nodes.map((node) =>
        node.selected ? node : { ...node, selected: true },
      ),
      selectedId: state.selectedId ?? state.nodes.at(-1)?.id ?? null,
    });
    showToast(`已选中 ${state.nodes.length} 个节点`);
    return true;
  }, [showToast]);

  const fitViewToCanvas = useCallback(() => {
    const instance = reactFlowRef.current;
    if (!instance) return;
    if (useCanvasStore.getState().nodes.length === 0) {
      showToast("画布还没有节点");
      return;
    }
    void instance.fitView({ padding: 0.24, duration: 320 });
  }, [showToast]);

  const updateNodeData = useCallback(
    (id: string, patch: Partial<CanvasNodeData>) => {
      checkpoint();
      setNodes((current) => {
        const next = current.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
        );
        scheduleSave(next, edges);
        return next;
      });
    },
    [edges, scheduleSave, setNodes, checkpoint],
  );

  const changeNodeConnection = useCallback(
    (nodeId: string, connectionId: string) => {
      const node = useCanvasStore
        .getState()
        .nodes.find((candidate) => candidate.id === nodeId);
      const nodeType = node?.data.nodeType;
      if (
        !node ||
        (nodeType !== "image-generation" && nodeType !== "video-generation")
      )
        return;
      if (connectionId === "fake-default") {
        updateNodeData(nodeId, {
          provider: "fake",
          connectionId,
          model:
            nodeType === "video-generation" ? "fake-video-v1" : "fake-image-v1",
          parameters: parametersWithDefaults(
            parameterDescriptorsFor(nodeType, "fake", null),
          ),
        });
        return;
      }
      const connection = connections.find((item) => item.id === connectionId);
      if (!connection) return;
      const configuredModel = modelForConnectionAndNode(
        connection,
        nodeType,
        defaultModelForConnection(connection),
      );
      updateNodeData(nodeId, {
        provider: connection.provider,
        connectionId: connection.id,
        model: configuredModel?.id,
        inputs: generationInputsForModel(
          nodeType,
          configuredModel,
          node.data.inputs,
        ),
        parameters: parametersWithDefaults(
          parameterDescriptorsFor(
            nodeType,
            connection.provider,
            configuredModel,
          ),
        ),
      });
    },
    [connections, updateNodeData],
  );

  const changeNodeModel = useCallback(
    (nodeId: string, modelId: string) => {
      const node = useCanvasStore
        .getState()
        .nodes.find((candidate) => candidate.id === nodeId);
      const nodeType = node?.data.nodeType;
      if (
        !node ||
        (nodeType !== "image-generation" && nodeType !== "video-generation")
      )
        return;
      const connection = connections.find(
        (item) => item.id === node.data.connectionId,
      );
      const listedModel =
        connectionModels.connectionId === node.data.connectionId
          ? connectionModels.items.find((model) => model.id === modelId)
          : undefined;
      const configuredModel = connection
        ? modelDescriptorFromConnectionConfig(connection.config, modelId)
        : null;
      const currentParameters = {
        ...((node.data.parameters as Record<string, unknown> | undefined) ??
          {}),
      };
      if (nodeType === "image-generation") {
        delete currentParameters.size;
        delete currentParameters.aspect_ratio;
        delete currentParameters.quality;
        delete currentParameters.n;
      }
      updateNodeData(nodeId, {
        model: modelId,
        inputs: generationInputsForModel(
          nodeType,
          listedModel ?? configuredModel,
          node.data.inputs,
        ),
        parameters: parametersWithDefaults(
          parameterDescriptorsFor(
            nodeType,
            node.data.provider ?? "fake",
            listedModel ?? configuredModel,
          ),
          currentParameters,
        ),
      });
    },
    [connectionModels, connections, updateNodeData],
  );

  const updateMediaAspectRatio = useCallback(
    (nodeId: string, ratio: number) => {
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      setNodes((current) => {
        let changed = false;
        const next = current.map((node) => {
          if (node.id !== nodeId) return node;
          const previous = node.data.mediaAspectRatio;
          const width = nodeDimensions(node).width;
          const nextHeight =
            node.data.generatedResult === true
              ? width / ratio
              : node.data.nodeType === "asset-input"
                ? Math.min(760, Math.max(230, width / ratio + 82))
                : nodeDimensions(node).height;
          const ratioChanged =
            typeof previous !== "number" || Math.abs(previous - ratio) >= 0.001;
          const heightChanged =
            Math.abs(nodeDimensions(node).height - nextHeight) >= 0.5;
          if (!ratioChanged && !heightChanged) return node;
          changed = true;
          return {
            ...node,
            ...(node.data.generatedResult === true ||
            node.data.nodeType === "asset-input"
              ? { style: { ...node.style, width, height: nextHeight } }
              : {}),
            data: { ...node.data, mediaAspectRatio: ratio },
          };
        });
        if (changed) scheduleSave(next, edges);
        return changed ? next : current;
      });
    },
    [edges, scheduleSave, setNodes],
  );

  const applyRunSnapshot = useCallback(
    (snapshot: RunSnapshot, pendingRequestId?: string) => {
      setNodeRunStatuses((current) => {
        const next = new Map(current);
        for (const node of snapshot.nodes)
          next.set(node.nodeId, node.status as NodeRunStatus);
        return next;
      });
      const state = useCanvasStore.getState();
      const normalizedNodes = ensureGeneratedResultInputs(state.nodes);
      let changed = normalizedNodes !== state.nodes;
      let nextNodes = normalizedNodes.map((node) => {
        const nodeRun = snapshot.nodes.find((item) => item.nodeId === node.id);
        if (!nodeRun?.outputAssetIds.length) return node;
        const outputIdsChanged =
          node.data.lastOutputAssetIds?.length !==
            nodeRun.outputAssetIds.length ||
          nodeRun.outputAssetIds.some(
            (assetId, index) =>
              node.data.lastOutputAssetIds?.[index] !== assetId,
          );
        const nextAssetKind =
          node.data.nodeType === "video-generation"
            ? "video"
            : node.data.nodeType === "image-generation"
              ? "image"
              : node.data.assetKind;
        if (!outputIdsChanged && node.data.assetKind === nextAssetKind)
          return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            lastOutputAssetIds: nodeRun.outputAssetIds,
            assetKind: nextAssetKind,
          },
        };
      });

      const additions: CanvasNode[] = [];
      const materializedBySource = new Map<string, string[]>();
      for (const nodeRun of snapshot.nodes) {
        const source = nextNodes.find((node) => node.id === nodeRun.nodeId);
        const kind =
          source?.data.nodeType === "image-generation"
            ? "image"
            : source?.data.nodeType === "video-generation"
              ? "video"
              : null;
        if (!source || !kind) continue;
        const status = nodeRun.status as NodeRunStatus;
        const trackedOutputCount = nextNodes.reduce((count, node) => {
          const belongsToRun =
            node.data.generatedResult === true &&
            node.data.generatedFromNodeId === source.id &&
            (node.data.generatedFromRunId === snapshot.run.id ||
              (pendingRequestId !== undefined &&
                node.data.generatedPendingRequestId === pendingRequestId));
          return belongsToRun &&
            typeof node.data.generatedOutputIndex === "number"
            ? Math.max(count, node.data.generatedOutputIndex + 1)
            : count;
        }, 0);
        const outputCount =
          trackedOutputCount > 0
            ? Math.max(trackedOutputCount, nodeRun.outputAssetIds.length)
            : generatedOutputCount(source, nodeRun.outputAssetIds.length);
        const materialized = new Set(
          source.data.materializedOutputAssetIds ?? [],
        );
        let materializedChanged = false;

        for (let outputIndex = 0; outputIndex < outputCount; outputIndex += 1) {
          const assetId = nodeRun.outputAssetIds[outputIndex];
          const slotStatus =
            status === "succeeded" && !assetId ? "failed" : status;
          const error = generatedResultError(
            slotStatus,
            status === "succeeded" && !assetId
              ? { message: "供应商未返回该结果" }
              : nodeRun.errorJson,
            typeof source.data.provider === "string"
              ? source.data.provider
              : undefined,
          );
          const matchesOutput = (node: CanvasNode) =>
            node.data.generatedResult === true &&
            node.data.generatedFromNodeId === source.id &&
            node.data.generatedOutputIndex === outputIndex &&
            (node.data.generatedFromRunId === snapshot.run.id ||
              (pendingRequestId !== undefined &&
                node.data.generatedPendingRequestId === pendingRequestId));
          const updateResultNode = (node: CanvasNode): CanvasNode => {
            const nextAssetId = assetId ?? node.data.assetId;
            if (
              node.data.generatedStatus === slotStatus &&
              sameRunError(node.data.generatedError, error) &&
              node.data.assetId === nextAssetId &&
              node.data.assetKind === kind &&
              node.data.generatedFromRunId === snapshot.run.id &&
              node.data.generatedProvider === source.data.provider &&
              node.data.generatedPendingRequestId === undefined
            ) {
              return node;
            }
            changed = true;
            return {
              ...node,
              data: {
                ...node.data,
                assetId: nextAssetId,
                assetKind: kind,
                generatedStatus: slotStatus,
                generatedError: error,
                generatedFromRunId: snapshot.run.id,
                ...(typeof source.data.provider === "string"
                  ? { generatedProvider: source.data.provider }
                  : {}),
                generatedPendingRequestId: undefined,
              },
            };
          };

          const existingIndex = nextNodes.findIndex(matchesOutput);
          if (existingIndex >= 0) {
            nextNodes[existingIndex] = updateResultNode(
              nextNodes[existingIndex]!,
            );
          } else {
            const additionIndex = additions.findIndex(matchesOutput);
            if (additionIndex >= 0) {
              additions[additionIndex] = updateResultNode(
                additions[additionIndex]!,
              );
            } else if (!assetId || !materialized.has(assetId)) {
              additions.push(
                createGeneratedResultNode(
                  source,
                  snapshot.run.id,
                  kind,
                  outputIndex,
                  slotStatus,
                  assetId,
                  error,
                  [...nextNodes, ...additions],
                  generationPromptParts(source, nextNodes, state.edges),
                ),
              );
              changed = true;
            }
          }

          if (assetId && !materialized.has(assetId)) {
            materialized.add(assetId);
            materializedChanged = true;
            changed = true;
          }
        }
        if (materializedChanged) {
          materializedBySource.set(source.id, [...materialized]);
        }
      }
      if (materializedBySource.size > 0) {
        nextNodes = nextNodes.map((node) => {
          const materialized = materializedBySource.get(node.id);
          return materialized
            ? {
                ...node,
                data: {
                  ...node.data,
                  materializedOutputAssetIds: materialized,
                },
              }
            : node;
        });
      }
      if (additions.length > 0) nextNodes = [...nextNodes, ...additions];
      const nextEdges = syncGeneratedResultEdges(nextNodes, state.edges);
      if (nextEdges !== state.edges) changed = true;
      if (!changed) return;
      useCanvasStore.setState({ nodes: nextNodes, edges: nextEdges });
      graphRef.current = { nodes: nextNodes, edges: nextEdges };
      scheduleSave(nextNodes, nextEdges, state.viewport);
    },
    [scheduleSave],
  );

  const stopRunSubscription = useCallback((runId?: string) => {
    if (runId) {
      eventSources.current.get(runId)?.close();
      eventSources.current.delete(runId);
    } else {
      for (const stream of eventSources.current.values()) stream.close();
      eventSources.current.clear();
    }
    setBusy(activeRunKeys.current.size > 0 || eventSources.current.size > 0);
  }, []);

  const subscribeToRun = useCallback(
    (runId: string) => {
      stopRunSubscription(runId);
      setBusy(true);
      const stream = new EventSource(
        `/api/runs/${encodeURIComponent(runId)}/events`,
      );
      eventSources.current.set(runId, stream);
      let refreshing = false;
      let refreshAgain = false;
      const isActive = () => eventSources.current.get(runId) === stream;
      const refresh = () => {
        if (!isActive()) return;
        if (refreshing) {
          refreshAgain = true;
          return;
        }
        refreshing = true;
        void fetchRun(runId)
          .then((snapshot) => {
            if (!isActive()) return;
            applyRunSnapshot(snapshot, snapshot.run.clientRequestId);
            if (terminalRunStatuses.has(snapshot.run.status)) {
              stopRunSubscription(runId);
              void refreshAssets();
            }
          })
          .catch(() => undefined)
          .finally(() => {
            refreshing = false;
            if (refreshAgain && isActive()) {
              refreshAgain = false;
              refresh();
            }
          });
      };
      stream.onmessage = refresh;
      // EventSource reconnects itself; polling the snapshot here also catches a
      // terminal state when the final event was lost during a network change.
      stream.onerror = refresh;
    },
    [applyRunSnapshot, refreshAssets, stopRunSubscription],
  );

  useEffect(() => {
    if (!canvasId) return;
    let cancelled = false;
    let reconciling = false;
    let reconcileAgain = false;
    const reconcileRuns = () => {
      if (reconciling) {
        reconcileAgain = true;
        return;
      }
      reconciling = true;
      void fetchRuns(canvasId)
        .then((runs) => {
          if (cancelled || runs.length === 0) return;
          const state = useCanvasStore.getState();
          const visibleRunIds = new Set(
            state.nodes.flatMap((node) =>
              node.data.generatedResult === true &&
              typeof node.data.generatedFromRunId === "string"
                ? [node.data.generatedFromRunId]
                : [],
            ),
          );
          const visibleRequestIds = new Set(
            state.nodes.flatMap((node) =>
              node.data.generatedResult === true &&
              typeof node.data.generatedPendingRequestId === "string"
                ? [node.data.generatedPendingRequestId]
                : [],
            ),
          );
          const visibleSnapshots = runs.filter(
            (snapshot, index) =>
              index === 0 ||
              visibleRunIds.has(snapshot.run.id) ||
              visibleRequestIds.has(snapshot.run.clientRequestId ?? ""),
          );
          // Apply oldest first so every visible placeholder is reconciled while
          // the newest run remains the status shown in the bottom bar. Passing
          // the client request id is essential after a reload: placeholders do
          // not have a provider run id until the first snapshot is reconciled.
          for (const snapshot of [...visibleSnapshots].reverse()) {
            applyRunSnapshot(snapshot, snapshot.run.clientRequestId);
          }

          const activeRunIds = new Set<string>();
          for (const snapshot of visibleSnapshots) {
            if (terminalRunStatuses.has(snapshot.run.status)) {
              if (eventSources.current.has(snapshot.run.id))
                stopRunSubscription(snapshot.run.id);
              continue;
            }
            activeRunIds.add(snapshot.run.id);
            if (!eventSources.current.has(snapshot.run.id))
              subscribeToRun(snapshot.run.id);
          }
          for (const subscribedRunId of eventSources.current.keys()) {
            if (!activeRunIds.has(subscribedRunId))
              stopRunSubscription(subscribedRunId);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          reconciling = false;
          if (reconcileAgain && !cancelled) {
            reconcileAgain = false;
            reconcileRuns();
          }
        });
    };
    const reconcileIfVisible = () => {
      if (document.visibilityState === "visible") reconcileRuns();
    };
    const reconcilePending = window.setInterval(() => {
      const hasPendingResult = useCanvasStore
        .getState()
        .nodes.some(
          (node) =>
            node.data.generatedResult === true &&
            typeof node.data.generatedPendingRequestId === "string",
        );
      if (hasPendingResult || eventSources.current.size > 0) reconcileRuns();
    }, 5_000);

    reconcileRuns();
    window.addEventListener("focus", reconcileRuns);
    document.addEventListener("visibilitychange", reconcileIfVisible);
    return () => {
      cancelled = true;
      window.clearInterval(reconcilePending);
      window.removeEventListener("focus", reconcileRuns);
      document.removeEventListener("visibilitychange", reconcileIfVisible);
      stopRunSubscription();
    };
  }, [applyRunSnapshot, canvasId, stopRunSubscription, subscribeToRun]);

  const validateRunMediaInputs = useCallback(
    async (
      nodeId: string | undefined,
      scope: "node" | "downstream" | "all",
    ): Promise<string | null> => {
      const state = useCanvasStore.getState();
      const candidates = generationNodesForRun(
        state.nodes,
        state.edges,
        nodeId,
        scope,
      );
      for (const node of candidates) {
        if (node.data.provider !== "fake") {
          const connectionId =
            typeof node.data.connectionId === "string"
              ? node.data.connectionId
              : "";
          const connection = connections.find(
            (item) => item.id === connectionId,
          );
          if (
            !connection ||
            providerConnectionUsage(connection) !== "canvas" ||
            !connectionIsConfigured(connection)
          ) {
            const group = connection
              ? providerConnectionGroup(connection)
              : "当前";
            return `${node.data.label}：${group} 群组的 API Key 未配置或不可用，请先在 API 设置中填写该群组自己的 Key`;
          }
        }
        const options = modelOptionsForNode(
          node,
          connections,
          connectionModels,
        );
        const model =
          options.find((candidate) => candidate.id === node.data.model) ??
          options[0] ??
          null;
        const linked = directLinkedAssetsForNode(
          node.id,
          state.nodes,
          state.edges,
          assets,
        );
        const immediate = validateLinkedMediaInputs(
          model,
          linked,
          linkedAssetDurationsRef.current,
        );
        if (immediate.length > 0) return `${node.data.label}：${immediate[0]}`;

        const needsDuration = linked.filter(
          (asset) =>
            (asset.kind === "video" &&
              (model?.limits?.maxInputVideoDurationSeconds !== undefined ||
                model?.limits?.maxTotalInputVideoDurationSeconds !==
                  undefined)) ||
            (asset.kind === "audio" &&
              model?.limits?.maxInputAudioDurationSeconds !== undefined),
        );
        const results = await Promise.all(
          needsDuration.map(async (asset) => ({
            asset,
            seconds: await loadLinkedAssetDuration(asset),
          })),
        );
        const failures = { ...durationReadFailures };
        for (const result of results) {
          if (result.seconds === undefined) failures[result.asset.id] = true;
          else delete failures[result.asset.id];
        }
        const warnings = validateLinkedMediaInputs(
          model,
          linked,
          linkedAssetDurationsRef.current,
          failures,
        );
        if (warnings.length > 0) return `${node.data.label}：${warnings[0]}`;
      }
      return null;
    },
    [
      assets,
      connectionModels,
      connections,
      durationReadFailures,
      loadLinkedAssetDuration,
    ],
  );

  const runNode = useCallback(
    async (
      nodeId: string | undefined,
      scope: RunScope = "node",
      retryResultNodeId?: string,
    ) => {
      if (!canvasId) return;
      const runRequest: RunRequestKey = {
        nodeId,
        scope,
        ...(retryResultNodeId ? { retryResultNodeId } : {}),
      };
      const submissionKey = runRequestKey(runRequest);
      if (activeRunKeys.current.has(submissionKey)) {
        showToast("这个任务已经在提交，请勿重复点击");
        return;
      }
      activeRunKeys.current.add(submissionKey);
      setBusy(true);
      try {
        const mediaValidationError = await validateRunMediaInputs(
          nodeId,
          scope,
        );
        if (mediaValidationError) {
          showToast(mediaValidationError);
          return;
        }
        const requestId = crypto.randomUUID();
        try {
          if (saveTimer.current) {
            clearTimeout(saveTimer.current);
            saveTimer.current = null;
          }
          const state = useCanvasStore.getState();
          const savePromise = saveQueue.current?.enqueue({
            canvasId,
            graph: serializableGraph(state.nodes, state.edges, state.viewport),
            title: state.title,
          });
          const pendingNodes = createPendingGeneratedResults(
            state.nodes,
            state.edges,
            nodeId,
            scope,
            requestId,
            retryResultNodeId,
          );
          const pendingEdges = syncGeneratedResultEdges(
            pendingNodes,
            state.edges,
          );
          if (pendingNodes !== state.nodes || pendingEdges !== state.edges) {
            useCanvasStore.setState({
              nodes: pendingNodes,
              edges: pendingEdges,
            });
            graphRef.current = { nodes: pendingNodes, edges: pendingEdges };
          }
          await savePromise;
          const snapshot = await createRun({
            canvasId,
            clientRequestId: requestId,
            ...(nodeId ? { nodeId } : {}),
            scope,
          });
          applyRunSnapshot(snapshot, requestId);
          if (terminalRunStatuses.has(snapshot.run.status)) {
            void refreshAssets();
          } else {
            showToast("任务已提交，正在等待 API 服务商返回", "success");
            subscribeToRun(snapshot.run.id);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "运行失败";
          const state = useCanvasStore.getState();
          let pendingChanged = false;
          const failedNodes = state.nodes.map((node) => {
            if (node.data.generatedPendingRequestId !== requestId) return node;
            pendingChanged = true;
            return {
              ...node,
              data: {
                ...node.data,
                generatedStatus: "failed" as const,
                generatedError: message,
              },
            };
          });
          if (pendingChanged) {
            const failedEdges = syncGeneratedResultEdges(
              failedNodes,
              state.edges,
            );
            useCanvasStore.setState({
              nodes: failedNodes,
              edges: failedEdges,
            });
            graphRef.current = { nodes: failedNodes, edges: failedEdges };
            scheduleSave(failedNodes, failedEdges, state.viewport);
          }
          showToast(message);
        }
      } finally {
        activeRunKeys.current.delete(submissionKey);
        setBusy(
          activeRunKeys.current.size > 0 || eventSources.current.size > 0,
        );
      }
    },
    [
      canvasId,
      refreshAssets,
      showToast,
      applyRunSnapshot,
      subscribeToRun,
      scheduleSave,
      validateRunMediaInputs,
    ],
  );

  const runAll = useCallback(() => {
    void runNode(undefined, "all");
  }, [runNode]);

  const regenerateResult = useCallback(
    (resultNodeId: string) => {
      const result = useCanvasStore
        .getState()
        .nodes.find((node) => node.id === resultNodeId);
      const sourceNodeId = result?.data.generatedFromNodeId;
      if (!sourceNodeId) {
        showToast("找不到该结果对应的生成节点，无法重新生成");
        return;
      }
      void runNode(sourceNodeId, "node", resultNodeId);
    },
    [runNode, showToast],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShortcutsOpen(false);
        setProjectMenuOpen(false);
        setConnectionMenu(null);
        setCanvasMenu(null);
        setNodeMenu(null);
        setDropActive(false);
        if (canvasMode !== "pan") changeCanvasMode("pan");
        return;
      }
      if (event.isComposing) return;
      // A keydown can be retargeted to a non-Element (window/document); calling
      // closest() on that throws and would disable every shortcut below.
      const target =
        event.target instanceof Element ? (event.target as HTMLElement) : null;
      const editing = Boolean(
        target?.closest("input, textarea, select, [contenteditable='true']"),
      );
      const inPromptEditor = Boolean(target?.closest(".tiptap-prompt"));
      if (inPromptEditor) return;
      const modalOpen = Boolean(
        document.querySelector(
          '[role="dialog"]:not(.node-config-popover), .connection-menu, .canvas-create-menu, .project-menu',
        ),
      );
      const interactiveControl = Boolean(
        target?.closest(
          "button, a, [role='menuitem'], .project-menu-backdrop, .mobile-backdrop",
        ),
      );
      const shortcutAllowed = isCanvasShortcutAllowed({
        selectedId,
        editing,
        inPromptEditor,
        modalOpen,
        interactiveControl,
      });
      // Plain-key canvas shortcuts must never fire while typing or in a dialog.
      // A focused button is fine: digits and "F" are not activation keys, and
      // clicking any node control would otherwise disable these shortcuts.
      const bareKeyAllowed =
        !editing &&
        !modalOpen &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey;

      if (bareKeyAllowed && (event.key === "?" || event.key === "F1")) {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (bareKeyAllowed && !event.shiftKey) {
        const modeKey = { "1": "pan", "2": "draw", "3": "select-drawing" }[
          event.key
        ] as CanvasInteractionMode | undefined;
        if (modeKey) {
          event.preventDefault();
          if (modeKey === "draw") activateDrawingTool("freehand");
          else changeCanvasMode(modeKey);
          return;
        }
        if (event.key === "f" || event.key === "F") {
          event.preventDefault();
          fitViewToCanvas();
          return;
        }
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !editing &&
        !modalOpen &&
        !interactiveControl &&
        selectedDrawingIds.size > 0
      ) {
        event.preventDefault();
        deleteSelectedDrawings();
        return;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !editing &&
        !modalOpen &&
        !interactiveControl
      ) {
        const selectedEdges = useCanvasStore
          .getState()
          .edges.filter((edge) => edge.selected);
        if (selectedEdges.length > 0) {
          event.preventDefault();
          checkpoint(true);
          const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
          setEdges((current) => {
            const next = current.filter(
              (edge) => !selectedEdgeIds.has(edge.id),
            );
            scheduleSave(nodes, next);
            return next;
          });
          showToast(`已断开 ${selectedEdges.length} 条连线`);
          return;
        }
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        shortcutAllowed &&
        !editing &&
        selectedId
      ) {
        event.preventDefault();
        const selectedIds = useCanvasStore
          .getState()
          .nodes.filter((node) => node.selected)
          .map((node) => node.id);
        deleteNode(selectedIds.length > 0 ? selectedIds : [selectedId]);
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const historyShortcutAllowed = isCanvasHistoryShortcutAllowed({
        editing,
        modalOpen,
        interactiveControl,
      });
      const currentSelectedId = useCanvasStore.getState().selectedId;
      const clipboardShortcutAllowed =
        !editing &&
        !inPromptEditor &&
        !modalOpen &&
        !interactiveControl &&
        (key === "v"
          ? nodeClipboardRef.current !== null
          : Boolean(currentSelectedId));
      if ((key === "c" || key === "v") && clipboardShortcutAllowed) {
        const handled = key === "c" ? copySelectedNodes() : pasteCopiedNodes();
        if (handled) event.preventDefault();
        return;
      }
      if (key === "d" && clipboardShortcutAllowed) {
        // Overrides the browser bookmark shortcut only when a node is selected.
        if (duplicateSelectedNodes()) event.preventDefault();
        return;
      }
      if (key === "s" && !editing && !modalOpen) {
        event.preventDefault();
        void saveNow().then(() => showToast("画布已保存", "success"));
        return;
      }
      if (key === "a" && !editing && !modalOpen && !interactiveControl) {
        if (selectAllNodes()) event.preventDefault();
        return;
      }
      if (key === "/" || (key === "?" && !editing)) {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }
      if ((key === "z" || key === "y") && historyShortcutAllowed) {
        event.preventDefault();
        if (key === "y" || event.shiftKey) redo();
        else undo();
        return;
      }
      if (key === "enter") {
        if (!shortcutAllowed) {
          if (!modalOpen && !interactiveControl && !editing && !selectedId) {
            event.preventDefault();
            showToast("请先选择一个节点");
          }
          return;
        }
        event.preventDefault();
        void runNode(
          selectedId ?? undefined,
          event.shiftKey ? "downstream" : "node",
        );
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    activateDrawingTool,
    canvasMode,
    changeCanvasMode,
    copySelectedNodes,
    checkpoint,
    deleteNode,
    deleteSelectedDrawings,
    duplicateSelectedNodes,
    fitViewToCanvas,
    nodes,
    pasteCopiedNodes,
    redo,
    runNode,
    saveNow,
    scheduleSave,
    selectAllNodes,
    selectedDrawingIds,
    selectedId,
    setEdges,
    showToast,
    undo,
  ]);

  const selectCanvasNode = useCallback((nodeId: string) => {
    useCanvasStore.setState((state) => {
      let changed = state.selectedId !== nodeId;
      const nextNodes = state.nodes.map((node) => {
        const selected = node.id === nodeId;
        if (node.selected === selected) return node;
        changed = true;
        return { ...node, selected };
      });
      return changed
        ? { nodes: nextNodes, selectedId: nodeId }
        : { selectedId: nodeId };
    });
  }, []);

  const renderedNodes = useMemo(
    () =>
      nodes.map((node): CanvasNode => {
        const nodeType = node.data.nodeType;
        const generationType =
          nodeType === "image-generation" || nodeType === "video-generation"
            ? nodeType
            : null;
        const nodeConnectionCandidates = generationType
          ? connections.filter(
              (connection) =>
                providerConnectionUsage(connection) === "canvas" &&
                providerSupportsNodeType(connection.provider, generationType),
            )
          : [];
        const modelOptions = modelOptionsForNode(
          node,
          connections,
          connectionModels,
        );
        const effectiveModel =
          modelOptions.find((model) => model.id === node.data.model) ??
          modelOptions[0] ??
          null;
        const linkedAssets = generationType
          ? directLinkedAssetsForNode(node.id, nodes, edges, assets)
          : [];
        const compatibleInputIds =
          connectingFrom && node.id !== connectingFrom.nodeId
            ? (effectiveInputsForNode(node) ?? [])
                .filter(
                  (input) =>
                    connectionCheck({
                      source: connectingFrom.nodeId,
                      sourceHandle: connectingFrom.handleId,
                      target: node.id,
                      targetHandle: input.id,
                    }).valid,
                )
                .map((input) => input.id)
            : [];
        const generatedPromptText =
          node.data.generatedResult === true
            ? renderPromptParts(
                node.data.generatedPromptParts ??
                  (() => {
                    const source = nodes.find(
                      (item) => item.id === node.data.generatedFromNodeId,
                    );
                    return source
                      ? generationPromptParts(source, nodes, edges)
                      : [];
                  })(),
                {
                  resolveAsset: (assetId) => {
                    const asset = assets.find((item) => item.id === assetId);
                    return asset ? `@${asset.name}` : `@${assetId}`;
                  },
                },
              ).trim()
            : undefined;
        return {
          ...node,
          data: {
            ...node.data,
            ...(generationType
              ? {
                  inputs: generationInputsForModel(
                    generationType,
                    effectiveModel,
                    node.data.inputs,
                  ),
                }
              : {}),
            assets,
            mentionAssets: linkedAssetsForNode(node.id, nodes, edges, assets),
            linkedAssets,
            linkedAssetDurations,
            linkedAssetWarnings: validateLinkedMediaInputs(
              effectiveModel,
              linkedAssets,
              linkedAssetDurations,
              durationReadFailures,
            ),
            linkedAssetLimitText: linkedMediaLimitText(
              effectiveModel,
              linkedAssets,
            ),
            connectionPreviewActive: Boolean(connectingFrom),
            connectionHighlight:
              connectingFrom?.nodeId === node.id
                ? "source"
                : compatibleInputIds.length > 0
                  ? "compatible"
                  : undefined,
            compatibleInputIds,
            connectionOptions: [
              ...(node.data.provider === "fake"
                ? [
                    {
                      id: "fake-default",
                      name: "Fake（离线演示）",
                      provider: "fake",
                      supplier: "fake",
                      supplierLabel: "Fake（离线演示）",
                      group: "默认群组",
                    },
                  ]
                : []),
              ...nodeConnectionCandidates.map((connection) => ({
                id: connection.id,
                name: connection.name,
                provider: connection.provider,
                supplier: providerConnectionSupplierKey(connection),
                supplierLabel: providerSupplierLabel(
                  providerConnectionSupplierKey(connection),
                ),
                group: providerConnectionGroup(connection),
                available: connectionIsConfigured(connection),
              })),
            ],
            modelOptions,
            generatedPromptText,
            status: statuses.get(node.id),
            onSelect: () => selectCanvasNode(node.id),
            onOpenPreview: (assetId: string) => {
              const asset = assets.find((item) => item.id === assetId);
              if (!asset) return;
              setPreviewReturnsToHistory(false);
              setPreviewAsset(asset);
            },
            onPrepareReversePrompt: () => {
              selectCanvasNode(node.id);
              setAgentDraftRequest({
                id: crypto.randomUUID(),
                ...(node.data.assetId ? { assetId: node.data.assetId } : {}),
                text: `请分析当前${node.data.assetKind === "video" ? "视频" : "图片"}，反推一份可复现画面主体、构图、风格、光线和细节的完整生成提示词。`,
              });
            },
            onRun: () => void runNode(node.id),
            onRegenerate:
              node.data.generatedResult === true
                ? () => regenerateResult(node.id)
                : undefined,
            onDelete: () => deleteNode(node.id),
            onResizeStart: () => checkpoint(true),
            onPromptPartsChange: (parts: PromptPart[]) =>
              updateNodeData(node.id, { parts }),
            onConnectionChange: (connectionId: string) =>
              changeNodeConnection(node.id, connectionId),
            onModelChange: (model: string) => changeNodeModel(node.id, model),
            onParametersChange: (parameters: Record<string, unknown>) =>
              updateNodeData(node.id, { parameters }),
            onMediaAspectRatio: (ratio: number) =>
              updateMediaAspectRatio(node.id, ratio),
            onLinkedAssetDuration: recordLinkedAssetDuration,
            onOpenApiSettings: () => setSettingsOpen(true),
          },
        };
      }),
    [
      assets,
      changeNodeConnection,
      changeNodeModel,
      checkpoint,
      connectionCheck,
      connectingFrom,
      connectionModels,
      connections,
      edges,
      effectiveInputsForNode,
      deleteNode,
      durationReadFailures,
      nodes,
      linkedAssetDurations,
      recordLinkedAssetDuration,
      regenerateResult,
      runNode,
      selectCanvasNode,
      statuses,
      updateNodeData,
      updateMediaAspectRatio,
    ],
  );

  const onNodesChangeWrapped = useCallback(
    (changes: Parameters<typeof applyNodeChanges<CanvasNode>>[0]) => {
      const selected = changes.find(
        (change) => change.type === "select" && change.selected,
      );
      if (selected?.type === "select") {
        setSelectedId(selected.id);
      }
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        if (shouldPersistNodeChanges(changes)) scheduleSave(next, edges);
        return next;
      });
    },
    [edges, setNodes, scheduleSave, setSelectedId],
  );
  const onEdgesChangeWrapped = useCallback(
    (changes: Parameters<typeof applyEdgeChanges<CanvasEdge>>[0]) => {
      if (changes.some((change) => change.type === "remove")) checkpoint(true);
      setEdges((current) => {
        const next = applyEdgeChanges(changes, current);
        if (changes.some((change) => change.type === "remove"))
          scheduleSave(nodes, next);
        return next;
      });
    },
    [checkpoint, nodes, scheduleSave, setEdges],
  );
  const onMoveEnd = useCallback(
    (_: unknown, nextViewport: { x: number; y: number; zoom: number }) => {
      setViewport(nextViewport);
      scheduleSave(nodes, edges, nextViewport);
    },
    [edges, nodes, scheduleSave, setViewport],
  );

  const selectedConnectionId =
    typeof selectedNode?.data.connectionId === "string"
      ? selectedNode.data.connectionId
      : "";
  const selectedConnectionRecord = connections.find(
    (connection) => connection.id === selectedConnectionId,
  );
  const selectedConnectionConfigured = selectedConnectionRecord
    ? connectionIsConfigured(selectedConnectionRecord)
    : false;
  useEffect(() => {
    if (!selectedConnectionId || selectedConnectionId === "fake-default")
      return;
    const selectedConnection = connections.find(
      (connection) => connection.id === selectedConnectionId,
    );
    const modelRequest =
      selectedConnection &&
      isCangyuanImagePreset(selectedConnection.config.preset) &&
      isCangyuanImageGroup(selectedConnection.config.modelGroup)
        ? fetchCangyuanCatalog(selectedConnection.config.modelGroup).then(
            (catalog) => catalog.models,
          )
        : fetchModels(selectedConnectionId);
    let cancelled = false;
    void modelRequest
      .then((items) => {
        if (!cancelled) {
          setConnectionModels({ connectionId: selectedConnectionId, items });
          setModelLoadError(null);
          const currentNode = useCanvasStore
            .getState()
            .nodes.find((node) => node.id === selectedId);
          const nodeType = currentNode?.data.nodeType;
          if (
            currentNode &&
            (nodeType === "image-generation" || nodeType === "video-generation")
          ) {
            const compatible = items.filter((model) =>
              modelSupportsNodeType(model, nodeType),
            );
            if (
              compatible.length > 0 &&
              !compatible.some((model) => model.id === currentNode.data.model)
            ) {
              const model = compatible[0]!;
              updateNodeData(currentNode.id, {
                model: model.id,
                inputs: generationInputsForModel(
                  nodeType,
                  model,
                  currentNode.data.inputs,
                ),
                parameters: parametersWithDefaults(
                  parameterDescriptorsFor(
                    nodeType,
                    currentNode.data.provider ?? "rest",
                    model,
                  ),
                ),
              });
            }
          }
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setConnectionModels({ connectionId: selectedConnectionId, items: [] });
        setModelLoadError({
          connectionId: selectedConnectionId,
          message: error instanceof Error ? error.message : "模型列表读取失败",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [connections, selectedConnectionId, selectedId, updateNodeData]);

  const selectedData = selectedNode?.data;
  const showLegacyInspector = false;
  const selectedGeneratedStatus =
    typeof selectedData?.generatedStatus === "string"
      ? selectedData.generatedStatus
      : selectedData?.assetId
        ? "succeeded"
        : "queued";
  const selectedGeneratedPending = [
    "blocked",
    "queued",
    "submitting",
    "running",
    "archiving",
    "cancel_requested",
  ].includes(selectedGeneratedStatus);
  const selectedGeneratedPrompt = useMemo(() => {
    if (selectedData?.generatedResult !== true) return "";
    const source = nodes.find(
      (node) => node.id === selectedData.generatedFromNodeId,
    );
    const parts =
      selectedData.generatedPromptParts ??
      (source ? generationPromptParts(source, nodes, edges) : []);
    return renderPromptParts(parts, {
      resolveAsset: (assetId) => {
        const asset = assets.find((item) => item.id === assetId);
        return asset ? `@${asset.name}` : `@${assetId}`;
      },
    }).trim();
  }, [assets, edges, nodes, selectedData]);
  const generationNodeType =
    selectedData?.nodeType === "image-generation" ||
    selectedData?.nodeType === "video-generation"
      ? selectedData.nodeType
      : null;
  const compatibleConnections = useMemo(() => {
    if (!generationNodeType) return [];
    return connections.filter(
      (connection) =>
        providerConnectionUsage(connection) === "canvas" &&
        connectionIsConfigured(connection) &&
        providerSupportsNodeType(connection.provider, generationNodeType),
    );
  }, [connections, generationNodeType]);
  const availableModels = useMemo(() => {
    if (!selectedData || !generationNodeType) return [];
    if (selectedData.provider === "fake") {
      return [
        {
          id:
            selectedData.nodeType === "video-generation"
              ? "fake-video-v1"
              : "fake-image-v1",
          name: "Fake",
          operations:
            selectedData.nodeType === "video-generation"
              ? (["video.generate", "video.image-to-video"] as const)
              : (["image.generate", "image.edit"] as const),
        },
      ];
    }
    const listed =
      connectionModels.connectionId === selectedConnectionId
        ? connectionModels.items.filter((model) =>
            modelSupportsNodeType(model, generationNodeType),
          )
        : [];
    if (listed.length > 0) return listed;
    const connection = connections.find(
      (candidate) => candidate.id === selectedConnectionId,
    );
    return connection
      ? modelDescriptorsFromConnectionConfig(connection.config).filter(
          (model) => modelSupportsNodeType(model, generationNodeType),
        )
      : [];
  }, [
    connectionModels,
    generationNodeType,
    selectedConnectionId,
    selectedData,
    connections,
  ]);
  const selectedModel = availableModels.find(
    (model) => model.id === selectedData?.model,
  );
  const connectionSourceKind = connectionMenu?.sourceKind;
  const connectionOptions = useMemo(
    () =>
      connectionSourceKind
        ? getAutoConnectionOptions(connectionSourceKind)
        : [],
    [connectionSourceKind],
  );
  const placeAssetsOnCanvas = useCallback(
    (items: AssetView[], position: { x: number; y: number }) => {
      const media = items.filter(
        (asset): asset is AssetView & { kind: "image" | "video" | "audio" } =>
          asset.kind === "image" ||
          asset.kind === "video" ||
          asset.kind === "audio",
      );
      if (media.length === 0) return;
      checkpoint(true);
      const state = useCanvasStore.getState();
      const added = media.map((asset, index) =>
        createAssetInputNode(
          asset,
          { x: position.x + index * 28, y: position.y + index * 36 },
          state.nodes.length + index,
        ),
      );
      const nextNodes = [...state.nodes, ...added];
      setNodes(nextNodes);
      setSelectedId(added.at(-1)?.id ?? null);
      scheduleSave(nextNodes, state.edges);
    },
    [checkpoint, scheduleSave, setNodes, setSelectedId],
  );

  useEffect(() => {
    if (!canvasId) return;
    let disposed = false;
    let polling = false;
    const consumerId = materialDropConsumerIdRef.current;
    const acquireConsumerLease = () => {
      try {
        const now = Date.now();
        const current = JSON.parse(
          window.localStorage.getItem(MATERIAL_DROP_LEASE_STORAGE_KEY) ??
            "null",
        ) as { id?: string; expiresAt?: number } | null;
        if (
          current?.id &&
          current.id !== consumerId &&
          Number(current.expiresAt) > now
        )
          return false;
        window.localStorage.setItem(
          MATERIAL_DROP_LEASE_STORAGE_KEY,
          JSON.stringify({ id: consumerId, expiresAt: now + 15_000 }),
        );
        const verified = JSON.parse(
          window.localStorage.getItem(MATERIAL_DROP_LEASE_STORAGE_KEY) ??
            "null",
        ) as { id?: string } | null;
        return verified?.id === consumerId;
      } catch {
        return true;
      }
    };
    const pollMaterialDrops = async () => {
      if (polling || disposed) return;
      const canvasIsVisible =
        typeof document.visibilityState !== "string" ||
        document.visibilityState === "visible";
      const canvasIsFocused =
        typeof document.hasFocus !== "function" || document.hasFocus();
      if (!canvasIsVisible || !canvasIsFocused || !acquireConsumerLease())
        return;
      polling = true;
      try {
        const drops = await fetchMaterialDrops();
        for (const drop of drops) {
          if (disposed) break;
          // Only the foreground canvas should consume a desktop drag. This also
          // prevents another open canvas tab from claiming the same bridge event.
          const recentKey = `${drop.name}:${drop.size}`;
          const pendingNativeAt =
            pendingNativeDropsRef.current.get(recentKey) ?? 0;
          if (Date.now() - pendingNativeAt < 8_000)
            pendingNativeDropsRef.current.delete(recentKey);
          const recentAt = recentNativeDropsRef.current.get(recentKey) ?? 0;
          if (Date.now() - recentAt < 8_000) {
            await discardMaterialDrop(drop.id);
            continue;
          }
          const canvasElement = canvasWrapRef.current;
          const flow = reactFlowRef.current;
          if (!canvasElement || !flow) continue;
          const rect = canvasElement.getBoundingClientRect();
          const hasScreenOrigin =
            Number.isFinite(window.screenX) && Number.isFinite(window.screenY);
          const sideFrame = hasScreenOrigin
            ? Math.max(0, (window.outerWidth - window.innerWidth) / 2)
            : 0;
          const topFrame = hasScreenOrigin
            ? Math.max(0, window.outerHeight - window.innerHeight - sideFrame)
            : 0;
          let clientX = hasScreenOrigin
            ? drop.screenX - (window.screenX + sideFrame)
            : Number.NaN;
          let clientY = hasScreenOrigin
            ? drop.screenY - (window.screenY + topFrame)
            : Number.NaN;
          const canUseDropPoint =
            Number.isFinite(clientX) &&
            Number.isFinite(clientY) &&
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom;
          if (!canUseDropPoint) {
            // Embedded browsers do not always expose their OS window origin.
            // Falling back to the visible canvas center keeps the imported node
            // reachable instead of creating it at NaN coordinates.
            clientX = rect.left + rect.width / 2;
            clientY = rect.top + rect.height / 2;
          }
          const position = flow.screenToFlowPosition({
            x: clientX,
            y: clientY,
          });
          const pendingKind = drop.mimeType.startsWith("video/")
            ? "video"
            : drop.mimeType.startsWith("audio/")
              ? "audio"
              : "image";
          const optimisticNode = createNode(
            "asset-input",
            position,
            useCanvasStore.getState().nodes.length,
          );
          optimisticNode.id = `material-drop-${drop.id}`;
          optimisticNode.data = {
            ...optimisticNode.data,
            label: drop.name,
            description: "正在从素材管理导入原始文件…",
            assetKind: pendingKind,
            pendingImport: true,
            pendingPreviewUrl:
              drop.previewAvailable && pendingKind === "image"
                ? `/api/integrations/material-drops?preview=${encodeURIComponent(drop.id)}`
                : undefined,
            outputs: [
              port(
                "asset",
                pendingKind,
                pendingKind === "video"
                  ? "视频"
                  : pendingKind === "audio"
                    ? "音频"
                    : "图片",
              ),
            ],
          };
          checkpoint(true);
          const beforeImport = useCanvasStore.getState();
          setNodes([...beforeImport.nodes, optimisticNode]);
          setSelectedId(optimisticNode.id);
          activeBridgeDropsRef.current.add(recentKey);
          showToast(`正在导入：${drop.name}`);

          try {
            const asset = await claimMaterialDrop(drop.id);
            setAssets((current) => [
              asset,
              ...current.filter((item) => item.id !== asset.id),
            ]);
            recentNativeDropsRef.current.set(recentKey, Date.now());
            const completedTemplate = createAssetInputNode(
              asset,
              optimisticNode.position,
              beforeImport.nodes.length,
            );
            const completedState = useCanvasStore.getState();
            const nextNodes = completedState.nodes.map((node) =>
              node.id === optimisticNode.id
                ? {
                    ...completedTemplate,
                    id: optimisticNode.id,
                    position: node.position,
                  }
                : node,
            );
            setNodes(nextNodes);
            scheduleSave(nextNodes, completedState.edges);
            showToast(
              canUseDropPoint
                ? `已从素材管理拖入：${asset.name}`
                : `已从素材管理拖入：${asset.name}（已放到画布中央）`,
            );
          } catch (error) {
            const failedState = useCanvasStore.getState();
            setNodes(
              failedState.nodes.filter((node) => node.id !== optimisticNode.id),
            );
            showToast(
              error instanceof Error ? error.message : "素材管理拖入失败",
              "error",
            );
          } finally {
            activeBridgeDropsRef.current.delete(recentKey);
          }
        }
        const cutoff = Date.now() - 12_000;
        for (const [key, createdAt] of recentNativeDropsRef.current) {
          if (createdAt < cutoff) recentNativeDropsRef.current.delete(key);
        }
      } catch (error) {
        if (!disposed)
          showToast(
            error instanceof Error ? error.message : "素材管理拖入失败",
            "error",
          );
      } finally {
        polling = false;
      }
    };
    void pollMaterialDrops();
    const timer = window.setInterval(() => void pollMaterialDrops(), 250);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      try {
        const current = JSON.parse(
          window.localStorage.getItem(MATERIAL_DROP_LEASE_STORAGE_KEY) ??
            "null",
        ) as { id?: string } | null;
        if (current?.id === consumerId)
          window.localStorage.removeItem(MATERIAL_DROP_LEASE_STORAGE_KEY);
      } catch {
        // Ignore unavailable storage during teardown.
      }
    };
  }, [canvasId, checkpoint, scheduleSave, setNodes, setSelectedId, showToast]);

  const handleUpload = useCallback(
    async (file: File) => {
      try {
        const asset = await uploadAsset(file);
        setAssets((current) => [
          asset,
          ...current.filter((item) => item.id !== asset.id),
        ]);
        showToast("素材已加入素材库", "success");
        return asset;
      } catch (error) {
        showToast(error instanceof Error ? error.message : "上传失败", "error");
        return null;
      }
    },
    [showToast],
  );

  const mergeSelectedDrawings = useCallback(async () => {
    if (selectedDrawingIds.size === 0 || mergingDrawings) return;
    const selected = useCanvasStore
      .getState()
      .drawings.filter((stroke) => selectedDrawingIds.has(stroke.id));
    if (selected.length === 0) {
      setSelectedDrawingIds(new Set());
      return;
    }
    setMergingDrawings(true);
    try {
      const rendered = await renderDrawingStrokesToPng(selected);
      const asset = await uploadAsset(rendered.file);
      checkpoint(true);
      const state = useCanvasStore.getState();
      const nextDrawings = state.drawings.filter(
        (stroke) => !selectedDrawingIds.has(stroke.id),
      );
      const node = createAssetInputNode(
        asset,
        { x: rendered.bounds.minX, y: rendered.bounds.minY },
        state.nodes.length,
      );
      const nodeWidth = 320;
      node.style = {
        width: nodeWidth,
        height: Math.max(140, Math.min(520, nodeWidth / rendered.aspectRatio)),
      };
      node.data = {
        ...node.data,
        label: `涂鸦图片 · ${selected.length} 笔`,
        description: "由画布中选中的涂鸦合并，可连接到图片模型的参考图输入",
        mediaAspectRatio: rendered.aspectRatio,
      };
      const nextNodes = [...state.nodes, node];
      setAssets((current) => [
        asset,
        ...current.filter((item) => item.id !== asset.id),
      ]);
      setDrawings(nextDrawings);
      setNodes(nextNodes);
      setSelectedId(node.id);
      setSelectedDrawingIds(new Set());
      changeCanvasMode("pan");
      scheduleSave(nextNodes, state.edges, state.viewport, nextDrawings);
      showToast(`已将 ${selected.length} 条涂鸦合并为图片素材节点`, "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "涂鸦合并失败",
        "error",
      );
    } finally {
      setMergingDrawings(false);
    }
  }, [
    changeCanvasMode,
    checkpoint,
    mergingDrawings,
    scheduleSave,
    selectedDrawingIds,
    setDrawings,
    setNodes,
    setSelectedId,
    showToast,
  ]);

  const onCanvasDragOver = useCallback((event: ReactDragEvent) => {
    // Native drags from Electron and Windows Explorer do not consistently
    // expose the `Files` type during dragover. Accept the drag at the canvas
    // boundary first, then validate its actual payload on drop.
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }, []);

  const onCanvasDrop = useCallback(
    async (event: ReactDragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDropActive(false);
      setCanvasMenu(null);
      setConnectionMenu(null);
      const position = reactFlowRef.current?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      if (!position) return;

      const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE);
      if (assetId) {
        const asset = assets.find((item) => item.id === assetId);
        if (asset) placeAssetsOnCanvas([asset], position);
        return;
      }

      const itemFiles = Array.from(event.dataTransfer.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      const uniqueFiles = new Map<string, File>();
      for (const file of [
        ...Array.from(event.dataTransfer.files),
        ...itemFiles,
      ])
        uniqueFiles.set(`${file.name}:${file.size}:${file.lastModified}`, file);
      const files = Array.from(uniqueFiles.values())
        .map(normalizeDraggedMediaFile)
        .filter((file): file is File => Boolean(file));
      if (files.length === 0) {
        showToast(
          "没有读取到可导入文件，请从素材卡右下角的“拖出原文件”按钮拖入",
        );
        return;
      }
      const pendingKeys = files.map((file) => `${file.name}:${file.size}`);
      for (const key of pendingKeys)
        pendingNativeDropsRef.current.set(key, Date.now());
      // Electron also emits a native file drop. Give its local bridge one short
      // polling window to claim the same file before falling back to uploading
      // the full original through the public origin.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 550));
      const uploaded: AssetView[] = [];
      for (const file of files) {
        const dropKey = `${file.name}:${file.size}`;
        const bridgeHandledAt = recentNativeDropsRef.current.get(dropKey) ?? 0;
        if (
          !pendingNativeDropsRef.current.has(dropKey) ||
          activeBridgeDropsRef.current.has(dropKey) ||
          Date.now() - bridgeHandledAt < 8_000
        ) {
          pendingNativeDropsRef.current.delete(dropKey);
          continue;
        }
        pendingNativeDropsRef.current.delete(dropKey);
        const asset = await handleUpload(file);
        if (asset) {
          uploaded.push(asset);
          recentNativeDropsRef.current.set(dropKey, Date.now());
        }
      }
      placeAssetsOnCanvas(uploaded, position);
      if (uploaded.length > 0)
        showToast(`已将 ${uploaded.length} 个素材放入画布`, "success");
    },
    [assets, handleUpload, placeAssetsOnCanvas, showToast],
  );

  const openCanvasMenu = useCallback((event: MouseEvent | ReactMouseEvent) => {
    event.preventDefault();
    const position = reactFlowRef.current?.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    if (!position) return;
    setConnectionMenu(null);
    setNodeMenu(null);
    setCanvasMenu({
      x: Math.min(Math.max(12, event.clientX), window.innerWidth - 196),
      y: Math.min(Math.max(62, event.clientY), window.innerHeight - 272),
      position,
    });
  }, []);

  const openNodeMenu = useCallback(
    (event: MouseEvent | ReactMouseEvent, node: CanvasNode) => {
      event.preventDefault();
      setConnectionMenu(null);
      setCanvasMenu(null);
      selectCanvasNode(node.id);
      const nodeType = node.data.nodeType;
      setNodeMenu({
        x: Math.min(Math.max(12, event.clientX), window.innerWidth - 200),
        y: Math.min(Math.max(62, event.clientY), window.innerHeight - 240),
        nodeId: node.id,
        label:
          typeof node.data.label === "string" && node.data.label
            ? node.data.label
            : "节点",
        runnable:
          nodeType === "image-generation" || nodeType === "video-generation",
      });
    },
    [selectCanvasNode],
  );

  function exportProject() {
    const payload = JSON.stringify(
      {
        title,
        exportedAt: new Date().toISOString(),
        graph: serializableGraph(nodes, edges, viewport),
      },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([payload], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title || "super-canvas"}.canvas.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importProject(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("文件不是有效的画布项目");
      const root = parsed as Record<string, unknown>;
      const rawGraph =
        root.graph &&
        typeof root.graph === "object" &&
        !Array.isArray(root.graph)
          ? (root.graph as Record<string, unknown>)
          : root;
      const graphShape = WorkflowGraphSchema.safeParse({
        nodes: rawGraph.nodes,
        edges: rawGraph.edges,
      });
      if (!graphShape.success) throw new Error("文件中的节点或连线结构无效");
      const graphValidation = validateGraph(graphShape.data, {
        checkPorts: true,
        checkRequiredInputs: false,
      });
      if (!graphValidation.valid)
        throw new Error(
          graphValidation.errors.map((issue) => issue.message).join("；"),
        );
      const rawViewport = rawGraph.viewport as
        { x?: unknown; y?: unknown; zoom?: unknown } | undefined;
      const importedViewport =
        rawViewport &&
        typeof rawViewport.x === "number" &&
        Number.isFinite(rawViewport.x) &&
        typeof rawViewport.y === "number" &&
        Number.isFinite(rawViewport.y) &&
        typeof rawViewport.zoom === "number" &&
        Number.isFinite(rawViewport.zoom)
          ? { x: rawViewport.x, y: rawViewport.y, zoom: rawViewport.zoom }
          : viewport;
      const importedTitle =
        typeof root.title === "string" ? root.title.trim() : title;
      const importedDrawings = parseImportedDrawings(rawGraph.drawings);
      checkpoint(true);
      const nextNodes = layoutGeneratedResults(
        ensureGeneratedResultInputs(
          (graphShape.data.nodes as unknown as CanvasNode[]).map((node) => ({
            ...node,
            type: "workflow" as const,
          })),
        ),
      );
      const nextEdges = syncGeneratedResultEdges(
        nextNodes,
        graphShape.data.edges as unknown as CanvasEdge[],
      );
      if (canvasId) {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        await saveQueue.current?.enqueue({
          canvasId,
          graph: serializableGraph(
            nextNodes,
            nextEdges,
            importedViewport,
            importedDrawings,
          ),
          title: importedTitle,
        });
      }
      setNodes(nextNodes);
      setEdges(nextEdges);
      setDrawings(importedDrawings);
      setViewport(importedViewport);
      setSelectedId(null);
      setSelectedDrawingIds(new Set());
      if (importedTitle) setTitle(importedTitle);
      showToast("项目已导入并保存", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "项目导入失败",
        "error",
      );
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">✦</span>
          <span>{APP_NAME}</span>
        </div>
        <nav className="top-create-actions" aria-label="生成工具">
          <button
            className="top-create-action"
            type="button"
            onClick={() => addNewNode("image-generation")}
            title="新建图片生成节点"
          >
            <WandSparkles size={14} />
            <span>图片生成</span>
          </button>
          <button
            className="top-create-action"
            type="button"
            onClick={() => addNewNode("video-generation")}
            title="新建视频生成节点"
          >
            <Video size={14} />
            <span>视频生成</span>
          </button>
          <button
            className="top-create-action"
            type="button"
            onClick={() => setHistoryOpen(true)}
            title="查看历史生成"
          >
            <History size={14} />
            <span>历史生成</span>
          </button>
        </nav>
        <div className="top-actions">
          <button
            className="icon-button inspector-toggle"
            type="button"
            onClick={() =>
              selectedId
                ? setMobileInspectorOpen(true)
                : showToast("请先选择节点")
            }
            aria-label="打开节点参数"
          >
            <Settings2 size={15} />
          </button>
          <span
            className={`pill save-state ${busy ? "is-running" : `is-${saveState}`}`}
            title={
              busy
                ? "有生成任务正在运行"
                : saveState === "error"
                  ? "上次保存失败，修改仍保留在浏览器中"
                  : "画布自动保存状态"
            }
          >
            <span
              className={`node-status ${
                busy
                  ? "running"
                  : saveState === "error"
                    ? "failed"
                    : saveState === "saved"
                      ? "succeeded"
                      : "running"
              }`}
            />
            {busy ? "任务运行中" : SAVE_STATE_LABEL[saveState]}
          </span>
          <button
            className="icon-button"
            type="button"
            onClick={undo}
            aria-label="撤销"
            title="撤销 (Ctrl+Z)"
          >
            <Undo2 size={14} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={redo}
            aria-label="重做"
            title="重做 (Ctrl+Y)"
          >
            <Redo2 size={14} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setShortcutsOpen(true)}
            aria-label="键盘快捷键"
            title="键盘快捷键 (?)"
          >
            <Keyboard size={14} />
          </button>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importProject(file);
              event.currentTarget.value = "";
            }}
          />
          <button
            className="button api-settings-button small"
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="配置生图与生视频 API"
          >
            <KeyRound size={13} /> API 设置
          </button>
          <button
            className="icon-button project-menu-toggle"
            type="button"
            onClick={() => setProjectMenuOpen((open) => !open)}
            aria-label="打开项目菜单"
            aria-expanded={projectMenuOpen}
            title="项目菜单"
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </header>
      {projectMenuOpen ? (
        <>
          <button
            className="project-menu-backdrop"
            type="button"
            aria-label="关闭项目菜单"
            onClick={() => setProjectMenuOpen(false)}
          />
          <div className="project-menu" role="menu" aria-label="项目操作">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setProjectMenuOpen(false);
                void saveNow().then(() => showToast("画布已保存", "success"));
              }}
            >
              <RefreshCw size={14} /> 保存画布
              <span className="project-menu-hint">Ctrl+S</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setProjectMenuOpen(false);
                exportProject();
              }}
            >
              <Download size={14} /> 导出项目
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setProjectMenuOpen(false);
                importInput.current?.click();
              }}
            >
              <Upload size={14} /> 导入项目
            </button>
            <div className="project-menu-divider" />
            <button
              className="danger"
              type="button"
              role="menuitem"
              onClick={() => {
                setProjectMenuOpen(false);
                if (!window.confirm("确定清空当前画布？此操作可通过撤销恢复。"))
                  return;
                checkpoint(true);
                setNodes([]);
                setEdges([]);
                setDrawings([]);
                setSelectedId(null);
                setSelectedDrawingIds(new Set());
                if (canvasId) void saveGraph(canvasId, [], [], viewport, []);
              }}
            >
              <Trash2 size={14} /> 清空画布
            </button>
          </div>
        </>
      ) : null}
      <main
        className={`workspace ${inspectorResizing ? "inspector-resizing" : ""}`}
        style={
          {
            "--inspector-width": `${inspectorWidth}px`,
          } as CSSProperties
        }
      >
        {mobileInspectorOpen ? (
          <button
            className="mobile-backdrop"
            type="button"
            aria-label="关闭面板"
            onClick={() => setMobileInspectorOpen(false)}
          />
        ) : null}
        <section
          ref={canvasWrapRef}
          className={`canvas-wrap ${dropActive ? "drop-active" : ""}`}
          onDragEnterCapture={onCanvasDragOver}
          onDragOverCapture={onCanvasDragOver}
          onDragLeaveCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setDropActive(false);
          }}
          onDropCapture={(event) => void onCanvasDrop(event)}
        >
          <div className="canvas-toolbar">
            <div className="toolbar-group">
              <button
                className="button primary small"
                type="button"
                onClick={runAll}
                disabled={nodes.length === 0 || busy}
              >
                <Play size={13} /> 运行全部
              </button>
            </div>
            <div
              className="canvas-drawing-tools"
              role="toolbar"
              aria-label="画布绘图工具"
            >
              <button
                className={canvasMode === "pan" ? "active" : ""}
                type="button"
                aria-label="抓手模式"
                aria-pressed={canvasMode === "pan"}
                title="抓手：拖动画布和操作节点"
                onClick={() => changeCanvasMode("pan")}
              >
                <Hand size={15} />
                <span>抓手</span>
              </button>
              <button
                className={
                  canvasMode === "draw" && drawingTool === "freehand"
                    ? "active"
                    : ""
                }
                type="button"
                aria-label="画笔模式"
                aria-pressed={
                  canvasMode === "draw" && drawingTool === "freehand"
                }
                title="画笔：绘制自由、不规则涂鸦"
                onClick={() => activateDrawingTool("freehand")}
              >
                <Pencil size={15} />
                <span>画笔</span>
              </button>
              <span className="canvas-drawing-tools-divider" />
              <span className="canvas-shape-label">形状</span>
              <button
                className={
                  canvasMode === "draw" && drawingTool === "rectangle"
                    ? "active shape-tool"
                    : "shape-tool"
                }
                type="button"
                aria-label="矩形工具"
                aria-pressed={
                  canvasMode === "draw" && drawingTool === "rectangle"
                }
                title="矩形：拖拽绘制矩形"
                onClick={() => activateDrawingTool("rectangle")}
              >
                <Square size={15} />
              </button>
              <button
                className={
                  canvasMode === "draw" && drawingTool === "ellipse"
                    ? "active shape-tool"
                    : "shape-tool"
                }
                type="button"
                aria-label="椭圆工具"
                aria-pressed={
                  canvasMode === "draw" && drawingTool === "ellipse"
                }
                title="椭圆：拖拽绘制圆形或椭圆"
                onClick={() => activateDrawingTool("ellipse")}
              >
                <Circle size={15} />
              </button>
              <button
                className={
                  canvasMode === "draw" && drawingTool === "line"
                    ? "active shape-tool"
                    : "shape-tool"
                }
                type="button"
                aria-label="直线工具"
                aria-pressed={canvasMode === "draw" && drawingTool === "line"}
                title="直线：拖拽绘制直线"
                onClick={() => activateDrawingTool("line")}
              >
                <Minus size={16} />
              </button>
              <button
                className={
                  canvasMode === "draw" && drawingTool === "arrow"
                    ? "active shape-tool"
                    : "shape-tool"
                }
                type="button"
                aria-label="箭头工具"
                aria-pressed={canvasMode === "draw" && drawingTool === "arrow"}
                title="箭头：拖拽绘制指向箭头"
                onClick={() => activateDrawingTool("arrow")}
              >
                <ArrowUpRight size={16} />
              </button>
              <span className="canvas-drawing-tools-divider" />
              <button
                className={canvasMode === "select-drawing" ? "active" : ""}
                type="button"
                aria-label="选择涂鸦"
                aria-pressed={canvasMode === "select-drawing"}
                title="点击或框选涂鸦，按 Ctrl 可多选；选中后可直接拖动"
                onClick={() => changeCanvasMode("select-drawing")}
              >
                <MousePointer2 size={15} />
                <span>选择</span>
              </button>
              <label className="canvas-brush-color" title="画笔颜色">
                <span>颜色</span>
                <input
                  type="color"
                  aria-label="画笔颜色"
                  value={brushColor}
                  onChange={(event) => setBrushColor(event.target.value)}
                />
              </label>
              <label className="canvas-brush-size" title="画笔粗细">
                <span>粗细</span>
                <input
                  type="range"
                  aria-label="画笔粗细"
                  min="1"
                  max="48"
                  step="1"
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                />
                <output>{brushSize}px</output>
              </label>
              <button
                className="merge-drawings-button"
                type="button"
                aria-label="将选中涂鸦合并为图片"
                title="合并后会生成可连接参考图输入的图片素材节点"
                disabled={selectedDrawingIds.size === 0 || mergingDrawings}
                onClick={() => void mergeSelectedDrawings()}
              >
                <Combine size={15} />
                <span>
                  {mergingDrawings
                    ? "合并中"
                    : selectedDrawingIds.size > 0
                      ? `合并 ${selectedDrawingIds.size} 笔`
                      : "合并为图片"}
                </span>
              </button>
            </div>
          </div>
          <ReactFlow
            nodes={renderedNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChangeWrapped}
            onEdgesChange={onEdgesChangeWrapped}
            onEdgeClick={(_, edge) => {
              setEdges((current) =>
                current.map((item) => ({
                  ...item,
                  selected: item.id === edge.id,
                })),
              );
            }}
            onNodeDragStart={() => checkpoint(true)}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            onPaneContextMenu={openCanvasMenu}
            onNodeContextMenu={openNodeMenu}
            onPaneClick={() => {
              setConnectionMenu(null);
              setCanvasMenu(null);
              setNodeMenu(null);
            }}
            onNodeClick={() => setNodeMenu(null)}
            onMoveStart={() => setNodeMenu(null)}
            onInit={(instance) => {
              reactFlowRef.current = instance;
              instance.setViewport(viewport);
            }}
            onMoveEnd={onMoveEnd}
            fitView={false}
            panOnDrag={canvasMode === "pan"}
            nodesDraggable={canvasMode === "pan"}
            nodesConnectable={canvasMode === "pan"}
            elementsSelectable={canvasMode === "pan"}
            edgesFocusable
            onlyRenderVisibleElements
            selectionKeyCode="Control"
            multiSelectionKeyCode="Control"
            selectionMode={SelectionMode.Partial}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={22} size={1} color="#2d3650" />
            <DrawingLayer
              drawings={drawings}
              activeStroke={activeStroke}
              selectedIds={selectedDrawingIds}
              selectionStart={drawingSelectionStart}
              selectionEnd={drawingSelectionEnd}
            />
            <Controls fitViewOptions={{ padding: 0.25 }} />
            <MiniMap
              nodeColor={(node) =>
                node.data?.nodeType === "video-generation"
                  ? "#5de2c2"
                  : "#9b8cff"
              }
            />
          </ReactFlow>
          {canvasMode !== "pan" ? (
            <div
              className={`canvas-drawing-input-layer ${canvasMode}`}
              tabIndex={-1}
              aria-label={
                canvasMode === "draw"
                  ? `画布${DRAWING_TOOL_LABEL[drawingTool]}区域`
                  : "涂鸦选择区域"
              }
              onPointerDown={onDrawingPointerDown}
              onPointerMove={onDrawingPointerMove}
              onPointerUp={(event) => finishDrawingInteraction(event)}
              onPointerCancel={(event) => finishDrawingInteraction(event, true)}
              onWheel={onDrawingWheel}
              onContextMenu={(event) => event.preventDefault()}
            />
          ) : null}
          {dropActive ? (
            <div className="canvas-drop-overlay" aria-hidden="true">
              <Upload size={22} />
              <span>放入画布</span>
            </div>
          ) : null}
          {nodes.length === 0 && !dropActive ? (
            <div className="canvas-empty-state">
              <h2>画布是空的</h2>
              <p>从这里开始，或者直接把图片、视频拖进画布。</p>
              <div className="canvas-empty-actions">
                <button
                  className="button primary small"
                  type="button"
                  onClick={() => addNewNode("image-generation")}
                >
                  <WandSparkles size={13} /> 新建图片生成
                </button>
                <button
                  className="button small"
                  type="button"
                  onClick={() => addNewNode("video-generation")}
                >
                  <Video size={13} /> 新建视频生成
                </button>
                <button
                  className="button small"
                  type="button"
                  onClick={() => addNewNode("prompt")}
                >
                  <Type size={13} /> 新建 Prompt
                </button>
              </div>
              <p className="canvas-empty-hint">
                在画布空白处点右键也能新建节点；按 <kbd>?</kbd> 查看全部快捷键。
              </p>
            </div>
          ) : null}
          {canvasMenu ? (
            <div
              className="connection-menu canvas-create-menu"
              style={{ left: canvasMenu.x, top: canvasMenu.y }}
              role="menu"
              aria-label="新建节点"
            >
              <span>新建节点</span>
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  insertNodeAt("image-generation", canvasMenu.position)
                }
              >
                <ImageIcon size={13} /> 图片节点
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  insertNodeAt("video-generation", canvasMenu.position)
                }
              >
                <Video size={13} /> 视频节点
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => insertNodeAt("prompt", canvasMenu.position)}
              >
                <Type size={13} /> Prompt
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => insertNodeAt("asset-input", canvasMenu.position)}
              >
                <Upload size={13} /> 素材输入
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => insertNodeAt("preview", canvasMenu.position)}
              >
                <FolderOpen size={13} /> 结果预览
              </button>
            </div>
          ) : null}
          {nodeMenu ? (
            <div
              className="connection-menu node-context-menu"
              style={{ left: nodeMenu.x, top: nodeMenu.y }}
              role="menu"
              aria-label={`${nodeMenu.label} 的操作`}
            >
              <span>{nodeMenu.label}</span>
              {nodeMenu.runnable ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setNodeMenu(null);
                      void runNode(nodeMenu.nodeId, "node");
                    }}
                  >
                    <Play size={13} /> 运行此节点
                    <span className="menu-hint">Ctrl+Enter</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setNodeMenu(null);
                      void runNode(nodeMenu.nodeId, "downstream");
                    }}
                  >
                    <Play size={13} /> 运行下游
                    <span className="menu-hint">Ctrl+Shift+Enter</span>
                  </button>
                  <div className="connection-menu-divider" />
                </>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setNodeMenu(null);
                  copySelectedNodes();
                }}
              >
                <Copy size={13} /> 复制
                <span className="menu-hint">Ctrl+C</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setNodeMenu(null);
                  duplicateSelectedNodes();
                }}
              >
                <CopyPlus size={13} /> 原地复制
                <span className="menu-hint">Ctrl+D</span>
              </button>
              <div className="connection-menu-divider" />
              <button
                className="danger"
                type="button"
                role="menuitem"
                onClick={() => {
                  const id = nodeMenu.nodeId;
                  setNodeMenu(null);
                  deleteNode(id);
                }}
              >
                <Trash2 size={13} /> 删除节点
                <span className="menu-hint">Delete</span>
              </button>
            </div>
          ) : null}
          {connectionMenu ? (
            <div
              className="connection-menu"
              style={{ left: connectionMenu.x, top: connectionMenu.y }}
              role="menu"
              aria-label="创建兼容节点"
            >
              <span>创建兼容节点</span>
              {connectionOptions.length > 0 ? (
                connectionOptions.map((option) => (
                  <button
                    key={`${option.nodeType}-${option.targetHandle}`}
                    type="button"
                    role="menuitem"
                    onClick={() => addConnectedNode(option.nodeType)}
                  >
                    {option.nodeType === "image-generation" ? (
                      <ImageIcon size={13} />
                    ) : option.nodeType === "video-generation" ? (
                      <Video size={13} />
                    ) : (
                      <FolderOpen size={13} />
                    )}
                    {option.label}
                  </button>
                ))
              ) : (
                <span className="connection-menu-empty">没有兼容节点</span>
              )}
            </div>
          ) : null}
        </section>
        <aside
          className={`inspector ${mobileInspectorOpen ? "mobile-open" : ""}`}
        >
          <div
            className="inspector-resize-handle"
            role="separator"
            aria-label="调整智能体面板宽度"
            aria-orientation="vertical"
            aria-valuemin={INSPECTOR_MIN_WIDTH}
            aria-valuemax={INSPECTOR_MAX_WIDTH}
            aria-valuenow={inspectorWidth}
            aria-valuetext={`${inspectorWidth} 像素`}
            title="左右拖动调整智能体面板宽度"
            tabIndex={0}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              inspectorResizeRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startWidth: inspectorWidth,
              };
              setInspectorResizing(true);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                return;
              event.preventDefault();
              const next = clampInspectorWidth(
                inspectorWidth + (event.key === "ArrowLeft" ? 20 : -20),
              );
              setInspectorWidth(next);
              window.localStorage.setItem(
                INSPECTOR_WIDTH_STORAGE_KEY,
                String(next),
              );
            }}
          />
          <button
            className="icon-button mobile-panel-close mobile-only"
            type="button"
            onClick={() => setMobileInspectorOpen(false)}
            aria-label="关闭"
          >
            <X size={15} />
          </button>
          {showLegacyInspector && selectedNode && selectedData ? (
            <>
              <h2>{selectedData.label}</h2>
              <div className="field">
                <label htmlFor={`node-name-${selectedNode.id}`}>节点名称</label>
                <input
                  id={`node-name-${selectedNode.id}`}
                  value={selectedData.label}
                  onChange={(event) =>
                    updateNodeData(selectedNode.id, {
                      label: event.target.value,
                    })
                  }
                />
              </div>
              {selectedData.nodeType === "asset-input" &&
              selectedData.generatedResult !== true ? (
                <>
                  <div className="field">
                    <label htmlFor={`node-asset-${selectedNode.id}`}>
                      选择素材
                    </label>
                    <select
                      id={`node-asset-${selectedNode.id}`}
                      value={selectedData.assetId ?? ""}
                      onChange={(event) => {
                        const asset = assets.find(
                          (item) => item.id === event.target.value,
                        );
                        updateNodeData(selectedNode.id, {
                          assetId: asset?.id,
                          assetKind:
                            asset?.kind === "video"
                              ? "video"
                              : asset?.kind === "audio"
                                ? "audio"
                                : "image",
                          outputs: [
                            port(
                              "asset",
                              asset?.kind === "video"
                                ? "video"
                                : asset?.kind === "audio"
                                  ? "audio"
                                  : "image",
                              "素材",
                            ),
                          ],
                        });
                      }}
                    >
                      <option value="">请选择…</option>
                      {assets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : null}
              {(selectedData.nodeType === "prompt" ||
                selectedData.nodeType === "image-generation" ||
                selectedData.nodeType === "video-generation") &&
              (selectedData.parts ?? []).some(
                (part) => part.type === "asset",
              ) ? (
                <div className="field">
                  <label>素材引用角色</label>
                  {(selectedData.parts ?? []).map((part, partIndex) =>
                    part.type === "asset" ? (
                      <div
                        className="mention-role-row"
                        key={`${part.assetId}-${partIndex}`}
                      >
                        <span>
                          @
                          {assets.find((asset) => asset.id === part.assetId)
                            ?.name ?? part.assetId}
                        </span>
                        <select
                          aria-label={`@${assets.find((asset) => asset.id === part.assetId)?.name ?? part.assetId} 的引用角色`}
                          value={part.role}
                          onChange={(event) => {
                            const nextParts = [...(selectedData.parts ?? [])];
                            nextParts[partIndex] = {
                              ...part,
                              role: event.target.value as
                                "reference" | "firstFrame" | "lastFrame",
                            };
                            updateNodeData(selectedNode.id, {
                              parts: nextParts,
                            });
                          }}
                        >
                          <option value="reference">参考素材</option>
                          <option value="firstFrame">首帧</option>
                          <option value="lastFrame">尾帧</option>
                        </select>
                      </div>
                    ) : null,
                  )}
                </div>
              ) : null}
              {selectedData.nodeType === "image-generation" ||
              selectedData.nodeType === "video-generation" ? (
                <>
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor={`node-connection-${selectedNode.id}`}>
                        API 连接
                      </label>
                      <select
                        id={`node-connection-${selectedNode.id}`}
                        value={
                          selectedData.provider === "fake"
                            ? "fake-default"
                            : (selectedData.connectionId ?? "")
                        }
                        onChange={(event) => {
                          changeNodeConnection(
                            selectedNode.id,
                            event.target.value,
                          );
                        }}
                      >
                        {!selectedData.connectionId ? (
                          <option value="">请选择 API 连接…</option>
                        ) : null}
                        {selectedData.provider === "fake" ||
                        compatibleConnections.length === 0 ? (
                          <option value="fake-default">Fake（离线演示）</option>
                        ) : null}
                        {compatibleConnections.map((connection) => (
                          <option key={connection.id} value={connection.id}>
                            {connection.name} ·{" "}
                            {typeof connection.config.modelGroup === "string"
                              ? connection.config.modelGroup
                              : connection.provider}
                          </option>
                        ))}
                        {selectedData.connectionId &&
                        !compatibleConnections.some(
                          (connection) =>
                            connection.id === selectedData.connectionId,
                        ) ? (
                          <option value={selectedData.connectionId}>
                            当前连接（
                            {selectedConnectionRecord &&
                            !selectedConnectionConfigured
                              ? "密钥未配置或不可用"
                              : "协议不匹配"}
                            ）
                          </option>
                        ) : null}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`node-model-${selectedNode.id}`}>
                        模型
                      </label>
                      <input
                        id={`node-model-${selectedNode.id}`}
                        list={`models-${selectedNode.id}`}
                        value={selectedData.model ?? ""}
                        onChange={(event) =>
                          changeNodeModel(selectedNode.id, event.target.value)
                        }
                        placeholder="自动"
                      />
                      {availableModels.length > 0 ? (
                        <datalist id={`models-${selectedNode.id}`}>
                          {availableModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.name}
                            </option>
                          ))}
                        </datalist>
                      ) : null}
                    </div>
                  </div>
                  <button
                    className="button ghost small api-manage-button"
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <KeyRound size={12} /> 管理 API 连接
                  </button>
                  {selectedConnectionRecord && !selectedConnectionConfigured ? (
                    <div className="field-note" role="status">
                      {providerConnectionGroup(selectedConnectionRecord)}
                      群组的 API Key 未配置或不可用，运行前请为该群组单独填写。
                    </div>
                  ) : null}
                  {modelLoadError?.connectionId === selectedConnectionId ? (
                    <div className="field-note" role="status">
                      {modelLoadError.message}；可直接填写模型 ID
                    </div>
                  ) : null}
                  <NodeParameterFields
                    nodeId={selectedNode.id}
                    nodeType={generationNodeType!}
                    provider={selectedData.provider ?? "fake"}
                    model={selectedModel ?? null}
                    parameters={
                      (selectedData.parameters as Record<string, unknown>) ?? {}
                    }
                    onChange={(parameters) =>
                      updateNodeData(selectedNode.id, { parameters })
                    }
                  />
                </>
              ) : null}
              {selectedData.generatedResult === true ? (
                <>
                  <div className="field generated-prompt-field">
                    <label htmlFor={`generated-prompt-${selectedNode.id}`}>
                      生成提示词
                    </label>
                    <textarea
                      id={`generated-prompt-${selectedNode.id}`}
                      value={selectedGeneratedPrompt || "未记录提示词"}
                      readOnly
                      rows={5}
                    />
                  </div>
                  {selectedData.assetId ? (
                    <div className="inspector-primary-action">
                      <a
                        className="button primary"
                        href={`/api/assets/${encodeURIComponent(selectedData.assetId)}/content`}
                        download
                      >
                        <Download size={14} /> 下载结果
                      </a>
                    </div>
                  ) : (
                    <span className="field-note" role="status">
                      {selectedGeneratedPending
                        ? selectedGeneratedStatus === "blocked"
                          ? "等待上游"
                          : "正在生成"
                        : runErrorMessage(selectedData.generatedError)}
                    </span>
                  )}
                </>
              ) : null}
              {selectedData.generatedResult !== true ||
              !selectedGeneratedPending ? (
                <div className="inspector-danger">
                  <button
                    className="button danger small"
                    type="button"
                    onClick={() => deleteNode(selectedNode.id)}
                  >
                    <Trash2 size={13} /> 删除节点
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <AgentPanel
              connections={connections}
              assets={assets}
              canvasId={canvasId ?? ""}
              selectedNode={selectedNode}
              selectedPrompt={selectedGeneratedPrompt}
              draftRequest={agentDraftRequest}
              onManageApi={(group) => {
                setSettingsInitialCangyuanGroup(group ?? null);
                setSettingsOpen(true);
              }}
            />
          )}
        </aside>
      </main>
      <SettingsModal
        open={settingsOpen}
        initialCangyuanGroup={settingsInitialCangyuanGroup}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsInitialCangyuanGroup(null);
          void fetchConnections()
            .then(setConnections)
            .catch(() => undefined);
        }}
      />
      <GenerationHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        assets={assets}
        onReuseAsset={reuseHistoricalAsset}
        onPreview={(asset) => {
          setHistoryOpen(false);
          setPreviewReturnsToHistory(true);
          setPreviewAsset(asset);
        }}
        onDropAsset={(assetId, screenPosition) => {
          const asset = assets.find((item) => item.id === assetId);
          const flowPosition =
            reactFlowRef.current?.screenToFlowPosition(screenPosition);
          if (!asset || !flowPosition) {
            showToast("图片无法放入画布，请重试");
            return;
          }
          placeAssetsOnCanvas([asset], flowPosition);
          setHistoryOpen(false);
        }}
      />
      <AssetPreviewModal
        key={previewAsset?.id ?? "no-preview"}
        asset={previewAsset}
        onClose={() => {
          setPreviewAsset(null);
          setPreviewReturnsToHistory(false);
        }}
        onBack={
          previewReturnsToHistory
            ? () => {
                setPreviewAsset(null);
                setPreviewReturnsToHistory(false);
                setHistoryOpen(true);
              }
            : undefined
        }
      />
      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
      {toast ? (
        <div
          key={toast.id}
          className={`toast toast-${toast.tone}`}
          role={toast.tone === "error" ? "alert" : "status"}
          aria-live={toast.tone === "error" ? "assertive" : "polite"}
        >
          {toast.tone === "success" ? (
            <CircleCheck aria-hidden="true" size={15} />
          ) : toast.tone === "error" ? (
            <CircleAlert aria-hidden="true" size={15} />
          ) : (
            <Info aria-hidden="true" size={15} />
          )}
          <span className="toast-text">{toast.message}</span>
          <button
            className="toast-close"
            type="button"
            onClick={dismissToast}
            aria-label="关闭提示"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CanvasApp() {
  return (
    <ReactFlowProvider>
      <CanvasShell />
    </ReactFlowProvider>
  );
}

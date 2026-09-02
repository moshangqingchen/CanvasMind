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
  ViewportPortal,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useUpdateNodeInternals,
  type Connection,
  type OnConnectStart,
  type OnConnect,
  type OnConnectEnd,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  Archive,
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
  LayoutGrid,
  MessageSquarePlus,
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
  wouldCreateCycle,
  renderPromptParts,
  type NodeRunStatus,
  type PortKind,
  type PromptPart,
} from "@super-canvas/core";
import type { DirectorGraphPatch } from "@super-canvas/director";
import type { DirectorApproveResult } from "../lib/director-contracts";
import type { ModelDescriptor } from "@super-canvas/providers";
import { appendPriceLabelOnce } from "../lib/model-display";
import {
  createRun,
  cleanupProjectDraft,
  openProjectFolder,
  renameProject,
  claimMaterialDrop,
  canvasErrorMessage,
  deleteAssets,
  deleteProject,
  fetchProjects,
  createProject,
  archiveProjectAssets,
  discardMaterialDrop,
  fetchAssets,
  fetchCanvas,
  fetchConnections,
  fetchAppUpdate,
  getCachedModels,
  invalidateModelCache,
  fetchModels,
  refreshModels,
  fetchMaterialDrops,
  fetchRun,
  fetchVisibleRuns,
  importDroppedMediaSources,
  resumeRun,
  saveCanvas,
  uploadAsset,
  CanvasSaveConflictError,
  type CanvasResponse,
  type ProviderConnectionView,
  requestAppUpdate,
  type AppUpdateView,
  type ProjectSummaryView,
  type RenameProjectResult,
} from "../lib/client-api";
import {
  ProjectActionDialog,
  type ProjectActionDialogState,
} from "./project-action-dialog";
import {
  CANGYUAN_ALL_MODELS_GROUP,
  CANGYUAN_IMAGE_4K_MODEL,
  isCangyuanImageGroup,
  isCangyuanImagePreset,
} from "../lib/provider-presets";
import { chentuFallbackImageDescriptor } from "../lib/chentu-catalog";
import { CHENTU_PRESET_ID } from "../lib/chentu-presets";
import {
  FRIMODEL_PRESET_ID,
  friModelFallbackImageDescriptor,
} from "../lib/frimodel-presets";
import {
  providerConnectionGroup,
  providerConnectionSupplierKey,
  providerConnectionUsage,
  providerSupplierLabel,
} from "../lib/provider-connection-options";
import { LatestTaskQueue } from "../lib/latest-task-queue";
import {
  applyPendingNodeConfigurations,
  clearPersistedNodeConfigurations,
  journalNodeConfiguration,
  readPendingNodeConfigurations,
  type PendingNodeConfiguration,
} from "../lib/node-configuration-journal";
import {
  droppedMediaUrlsFromStrings,
  filesFromDroppedMediaUrls,
  mapWithConcurrency,
  normalizeClipboardImageFile,
  prepareImportableMediaFile,
  preferNamedClipboardImages,
} from "../lib/dropped-media";
import {
  filterEdgesToKnownPorts,
  hasEdgeForNodePair,
  keepLatestEdgePerNodePair,
} from "../lib/canvas-connections";
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
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
import { removeUnreturnedGeneratedResults } from "../lib/generated-result-sync";
import {
  collectReferencedAssetIds,
  createPortableProjectPackage,
  prepareProjectImport,
  PROJECT_JSON_FORMAT,
  PROJECT_PACKAGE_EXTENSION,
  uploadPreparedPackageAssets,
  type PreparedProjectImport,
} from "../lib/project-transfer";
import { removeDeletedAssetsFromGraph } from "../lib/generation-history";
import {
  isPendingGeneratedResultStatus,
  shouldMarkPendingRunMissing,
} from "../lib/pending-run-reconciliation";
import {
  directLinkedAssetsForNode,
  linkedMediaLimitText,
  removeDirectLinkedAssetEdges,
  removeUnavailableAssetMentions,
  validateLinkedMediaInputs,
} from "../lib/linked-media";
import {
  alignedCanvasRectPositions,
  closestAvailableResultPosition,
  closestAvailableVerticalPosition,
  getAutoConnectionOptions,
  getAutoConnectionTargetHandle,
  hasSelectedBrowserText,
  isCanvasHistoryShortcutAllowed,
  isCanvasShortcutAllowed,
  modelCanvasUnavailableReason,
  modelSupportsNodeType,
  preferredCanvasLayoutDirection,
  providerSupportsNodeType,
  shouldPersistNodeChanges,
  tidyCanvasRectPositions,
  type AutoConnectNodeType,
  type NodeAlignmentAction,
} from "../lib/graph-ui";
import {
  modelDescriptorForSavedSelection,
  modelDescriptorForSavedSelectionOrDefault,
  modelDescriptorListsEqual,
  modelDescriptorsFromConnectionConfig,
  normalizedParametersForModel,
  parameterDescriptorsFor,
  parametersWithDefaults,
} from "../lib/model-parameters";
import {
  weAiCanvasModelDescriptors,
  weAiCanvasModelDescriptorsFromSavedScan,
  weAiSizePresetForTier,
} from "../lib/weai-catalog";
import {
  SuperDirectorPanel,
  type AgentDraftRequest,
} from "./super-director-panel";
import { AgentPanel } from "./agent-panel";
import { CanvasSaveConflictModal } from "./canvas-save-conflict-modal";
import { DrawingLayer } from "./drawing-layer";
import { NodeParameterFields } from "./node-parameter-fields";
import { ProjectImportModal } from "./project-import-modal";
import { ShortcutsModal } from "./shortcuts-modal";
import { AppUpdateModal } from "./app-update-modal";
import { useCanvasStore } from "./canvas-store";
import { WorkflowNode } from "./workflow-node";
import {
  AssetPreviewModal,
  GenerationHistoryModal,
  RunHistoryModal,
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
type SaveState = "saved" | "pending" | "saving" | "error" | "conflict";

type CanvasInitializationState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type InspectorMode = "node" | "agent";

const SAVE_STATE_LABEL: Record<SaveState, string> = {
  saved: "已保存",
  pending: "待保存",
  saving: "保存中",
  error: "保存失败",
  conflict: "保存冲突",
};

const nodeTypes = { workflow: WorkflowNode };
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "超级画布";
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";
const DIRECTOR_FEATURE_ENABLED =
  process.env.NEXT_PUBLIC_DIRECTOR_ENABLED !== "false";
const ASSET_DRAG_TYPE = "application/x-super-canvas-asset";
const NODE_CLIPBOARD_TYPE = "application/x-super-canvas-nodes";
const CANVAS_INITIALIZATION_TIMEOUT_MS = 20_000;
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
const INSPECTOR_MIN_WIDTH = 300;
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
}

function runRequestKey(request: RunRequestKey): string {
  return `${request.scope}:${request.nodeId ?? "all"}`;
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
  keepalive?: boolean;
  expectedRevision?: number;
  pendingNodeConfigurations?: PendingNodeConfiguration[];
}

interface CanvasSaveConflictState {
  expectedRevision: number;
  currentRevision: number;
  message: string;
}

interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export function canvasViewportsEqual(
  left: CanvasViewport,
  right: CanvasViewport,
  epsilon = 0.000_001,
): boolean {
  return (
    Math.abs(left.x - right.x) <= epsilon &&
    Math.abs(left.y - right.y) <= epsilon &&
    Math.abs(left.zoom - right.zoom) <= epsilon
  );
}

export async function persistCanvasSaveRequest(
  request: CanvasSaveRequest,
): Promise<CanvasResponse> {
  if (!request.keepalive) {
    return saveCanvas(
      request.canvasId,
      request.graph,
      request.title,
      request.expectedRevision,
    );
  }

  const response = await fetch(
    `/api/canvas/${encodeURIComponent(request.canvasId)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        graph: request.graph,
        title: request.title,
        expectedRevision: request.expectedRevision,
      }),
      keepalive: true,
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | (Partial<CanvasResponse> & {
        error?: string;
        code?: string;
        currentRevision?: number;
        issues?: unknown;
      })
    | null;
  if (response.status === 409 && payload?.code === "CANVAS_REVISION_CONFLICT") {
    throw new CanvasSaveConflictError(
      payload.currentRevision ?? request.expectedRevision ?? 0,
      payload.error,
    );
  }
  if (!response.ok)
    throw new Error(canvasErrorMessage(payload, "画布保存失败"));
  return payload as CanvasResponse;
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
      parameters: { size: "1024x1024", quality: "high", n: 1 },
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

interface PendingAssetImport {
  file: File;
  node: CanvasNode;
  nodeId: string;
  previewUrl?: string;
}

export interface PendingNativeDrop {
  nodeId: string;
  createdAt: number;
}

const NATIVE_DROP_DEDUPE_WINDOW_MS = 8_000;

export function nativeDropContentKey(input: {
  name: string;
  size: number;
}): string {
  return JSON.stringify([input.name, input.size]);
}

export function filesForNativeDrop(
  fileListFiles: readonly File[],
  itemFiles: readonly File[],
): File[] {
  // `DataTransfer.files` and `DataTransfer.items` usually expose the same
  // files as separate File objects. Prefer the canonical file list so two
  // genuinely distinct files with identical metadata are not collapsed.
  return [...(fileListFiles.length > 0 ? fileListFiles : itemFiles)];
}

interface NativeDropFileHandle {
  kind: string;
  getFile?: () => Promise<File>;
}

interface NativeDropFileEntry {
  isFile: boolean;
  file: (
    success: (file: File) => void,
    failure?: (error: DOMException) => void,
  ) => void;
}

type ExtendedNativeDropItem = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<NativeDropFileHandle | null>;
  webkitGetAsEntry?: () => NativeDropFileEntry | null;
};

function fileFromNativeDropEntry(
  entry: NativeDropFileEntry | null,
): Promise<File | null> {
  if (!entry?.isFile) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      entry.file(resolve, () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Chromium can expose files dragged from desktop applications through three
 * different surfaces. WeChat and other Electron apps sometimes leave the
 * classic FileList empty while still exposing a File System Access handle or
 * a legacy FileEntry, so try all of them while the drop permission is active.
 */
export async function filesFromNativeDrop(
  fileListFiles: readonly File[],
  transferItems: readonly DataTransferItem[],
): Promise<File[]> {
  if (fileListFiles.length > 0) return [...fileListFiles];

  const fileItems = transferItems.filter((item) => item.kind === "file");
  const pending = fileItems.map((rawItem) => {
    const item = rawItem as ExtendedNativeDropItem;
    const direct = item.getAsFile();
    if (direct) return { direct, handle: null, entry: null };

    let handle: Promise<NativeDropFileHandle | null> | null = null;
    try {
      handle = item.getAsFileSystemHandle?.() ?? null;
    } catch {
      handle = null;
    }

    let entry: NativeDropFileEntry | null = null;
    try {
      entry =
        (
          rawItem as unknown as {
            webkitGetAsEntry?: () => NativeDropFileEntry | null;
          }
        ).webkitGetAsEntry?.() ?? null;
    } catch {
      entry = null;
    }
    return { direct: null, handle, entry };
  });

  const files = await Promise.all(
    pending.map(async ({ direct, handle, entry }) => {
      if (direct) return direct;
      if (handle) {
        try {
          const resolved = await handle;
          if (resolved?.kind === "file" && resolved.getFile)
            return await resolved.getFile();
        } catch {
          // Fall through to the older FileEntry API below.
        }
      }
      return fileFromNativeDropEntry(entry);
    }),
  );
  return files.filter((file): file is File => Boolean(file));
}

export function availablePendingNativeDrop(
  entries: readonly PendingNativeDrop[],
  unavailableNodeIds: ReadonlySet<string>,
  now: number,
): PendingNativeDrop | undefined {
  return entries.find(
    (entry) =>
      now - entry.createdAt < NATIVE_DROP_DEDUPE_WINDOW_MS &&
      !unavailableNodeIds.has(entry.nodeId),
  );
}

function createPendingAssetInputNode(
  file: File,
  position: { x: number; y: number },
  index: number,
): { node: CanvasNode; previewUrl?: string } {
  const kind = file.type.startsWith("video/")
    ? "video"
    : file.type.startsWith("audio/")
      ? "audio"
      : "image";
  const previewUrl =
    (kind === "image" || kind === "video") &&
    typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(file)
      : undefined;
  const node = createNode("asset-input", position, index);
  node.id = `pending-import-${crypto.randomUUID()}`;
  node.data = {
    ...node.data,
    label: file.name || "剪贴板素材",
    description: "素材已放入画布，正在后台导入…",
    assetKind: kind,
    pendingImport: true,
    ...(previewUrl ? { pendingPreviewUrl: previewUrl } : {}),
    outputs: [
      port(
        "asset",
        kind,
        kind === "video" ? "视频" : kind === "audio" ? "音频" : "图片",
      ),
    ],
  };
  return { node, ...(previewUrl ? { previewUrl } : {}) };
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

function nodeGroupBounds(nodes: readonly CanvasNode[]): {
  position: { x: number; y: number };
  width: number;
  height: number;
} {
  const left = Math.min(...nodes.map((node) => node.position.x));
  const top = Math.min(...nodes.map((node) => node.position.y));
  const right = Math.max(
    ...nodes.map((node) => node.position.x + nodeDimensions(node).width),
  );
  const bottom = Math.max(
    ...nodes.map((node) => node.position.y + nodeDimensions(node).height),
  );
  return {
    position: { x: left, y: top },
    width: right - left,
    height: bottom - top,
  };
}

function generatedResultPosition(
  source: CanvasNode,
  width: number,
  height: number,
  occupiedNodes: readonly CanvasNode[],
): { x: number; y: number } {
  const sourceSize = nodeDimensions(source);
  return closestAvailableResultPosition(
    {
      id: source.id,
      position: source.position,
      ...sourceSize,
    },
    { width, height },
    occupiedNodes.map((node) => ({
      id: node.id,
      position: node.position,
      ...nodeDimensions(node),
    })),
  );
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
    selectable: false,
    deletable: false,
    focusable: false,
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
    current.animated === expected.animated &&
    current.selectable === expected.selectable &&
    current.deletable === expected.deletable &&
    current.focusable === expected.focusable
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
  frozenRequestedCount?: unknown,
): number {
  const configured = Number(
    frozenRequestedCount ?? source.data.parameters?.n ?? 1,
  );
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
  supplier?: string,
): string | RunErrorDetails | undefined {
  const localized = localizeRunError(error, { provider, supplier });
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
    left.statusCode === right.statusCode &&
    left.providerMessage === right.providerMessage &&
    left.docsUrl === right.docsUrl &&
    left.actionUrl === right.actionUrl &&
    left.actionLabel === right.actionLabel
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

function pendingAssetReferencesForRun(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  nodeId: string | undefined,
  scope: "node" | "downstream" | "all",
): CanvasNode[] {
  const generationIds = new Set(
    generationNodesForRun(nodes, edges, nodeId, scope).map((node) => node.id),
  );
  if (generationIds.size === 0) return [];
  const pendingIds = new Set(
    nodes
      .filter(
        (node) =>
          node.data.nodeType === "asset-input" &&
          node.data.pendingImport === true,
      )
      .map((node) => node.id),
  );
  if (pendingIds.size === 0) return [];
  const sourceIds = new Set(
    edges
      .filter(
        (edge) =>
          generationIds.has(edge.target) && pendingIds.has(edge.source),
      )
      .map((edge) => edge.source),
  );
  return nodes.filter((node) => sourceIds.has(node.id));
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
  let nextNodes = [...nodes];
  const sources = generationNodesForRun(nodes, edges, nodeId, scope);
  const retryTarget = retryResultNodeId
    ? nodes.find(
        (node) =>
          node.id === retryResultNodeId &&
          node.data.generatedResult === true &&
          node.data.generatedStatus === "failed",
      )
    : undefined;
  const retryRunId = retryTarget?.data.generatedFromRunId;

  if (!retryTarget) {
    const sourceIds = new Set(sources.map((source) => source.id));
    const outputCounts = new Map(
      sources.map((source) => [source.id, generatedOutputCount(source, 0)]),
    );
    const retained = nextNodes.filter((node) => {
      if (
        node.data.generatedResult !== true ||
        node.data.generatedStatus !== "failed" ||
        node.data.assetId !== undefined ||
        !sourceIds.has(node.data.generatedFromNodeId ?? "") ||
        typeof node.data.generatedOutputIndex !== "number"
      )
        return true;
      const outputCount = outputCounts.get(node.data.generatedFromNodeId!);
      return (
        outputCount === undefined ||
        node.data.generatedOutputIndex < outputCount
      );
    });
    if (retained.length !== nextNodes.length) {
      nextNodes = retained;
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

      const reusableIndex = retryTarget
        ? nextNodes.findIndex(
            (node) =>
              node.data.generatedResult === true &&
              node.data.generatedStatus === "failed" &&
              node.data.generatedFromNodeId === source.id &&
              node.data.generatedOutputIndex === outputIndex &&
              (node.id === retryTarget.id ||
                (retryRunId !== undefined &&
                  node.data.generatedFromRunId === retryRunId)),
          )
        : -1;
      if (reusableIndex >= 0) {
        const reusable = nextNodes[reusableIndex]!;
        nextNodes[reusableIndex] = {
          ...reusable,
          data: {
            ...reusable.data,
            assetId: undefined,
            generatedStatus: "queued",
            generatedError: undefined,
            generatedFromRunId: undefined,
            generatedPendingRequestId: requestId,
            generatedCreatedAt: new Date().toISOString(),
            generatedPromptParts: structuredClone(
              generationPromptParts(source, nodes, edges),
            ),
          },
        };
        changed = true;
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
      pendingNode.data.generatedCreatedAt = new Date().toISOString();
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

function verifiedWeAiModelDescriptorsForConnection(
  connection: ProviderConnectionView,
): ModelDescriptor[] {
  if (
    connection.provider === "weai" &&
    providerConnectionSupplierKey(connection) === "weai"
  ) {
    return weAiCanvasModelDescriptors(
      providerConnectionGroup(connection),
      connection.config.protocol,
      connection.config.defaultModel,
    );
  }
  return [];
}

function connectionRequiresAuthoritativeModelScan(
  connection: ProviderConnectionView,
): boolean {
  return (
    verifiedWeAiModelDescriptorsForConnection(connection).length > 0 ||
    connection.config.preset === "cyberafei-api" ||
    connection.config.preset === CHENTU_PRESET_ID ||
    connection.config.preset === FRIMODEL_PRESET_ID
  );
}

function modelDescriptorsForConnection(
  connection: ProviderConnectionView,
): ModelDescriptor[] {
  if (
    connection.provider === "weai" &&
    providerConnectionSupplierKey(connection) === "weai"
  ) {
    const saved = weAiCanvasModelDescriptorsFromSavedScan(connection.config);
    if (saved) return saved;
  }
  const verified = verifiedWeAiModelDescriptorsForConnection(connection);
  if (verified.length > 0) return verified;
  return modelDescriptorsFromConnectionConfig(connection.config);
}

function modelForConnectionAndNode(
  connection: ProviderConnectionView,
  nodeType: "image-generation" | "video-generation",
  preferredId?: string,
): ModelDescriptor | null {
  const compatible = modelDescriptorsForConnection(connection).filter((model) =>
    modelSupportsNodeType(model, nodeType),
  );
  return (
    modelDescriptorForSavedSelection(compatible, preferredId) ??
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
  if (nodeType === "image-generation") {
    const existing = [...(fallback ?? [])];
    // Image nodes created by older canvas versions may have only a Prompt
    // input. Restore the canonical reference port whenever the selected model
    // advertises image editing/reference support, so old edges remain usable.
    const supportsReferences =
      !model ||
      (model.limits?.maxInputImages !== undefined
        ? model.limits.maxInputImages > 0
        : model.operations?.includes("image.edit") === true ||
          model.inputKinds?.some(
            (kind) => kind === "image" || kind === "image[]",
          ) === true);
    if (!supportsReferences)
      return existing.filter((input) => input.id !== "references");
    if (existing.length === 0)
      return [
        port("prompt", "text", "Prompt", false),
        port("references", "image[]", "参考图", false, true),
      ];
    if (!existing.some((input) => input.id === "references"))
      existing.push(port("references", "image[]", "参考图", false, true));
    return existing;
  }
  if (!model) return fallback;
  const hasDeclaredMediaLimits = [
    model.limits?.maxInputImages,
    model.limits?.maxInputVideos,
    model.limits?.maxInputAudios,
  ].some((value) => value !== undefined);
  const hasDeclaredReferenceMode =
    model.metadata?.referenceMode !== undefined ||
    model.metadata?.supportsFirstLastFrames !== undefined;
  // Some built-in and legacy model descriptors intentionally omit media
  // capability metadata. In that case the saved ports are the authoritative
  // contract; treating an unknown limit as zero would silently remove existing
  // first-frame/reference connections from the canvas.
  if (!hasDeclaredMediaLimits && !hasDeclaredReferenceMode) return fallback;
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

function generationInputsEqual(
  left: CanvasNodeData["inputs"],
  right: CanvasNodeData["inputs"],
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((input, index) => {
    const other = right[index];
    return (
      input.id === other?.id &&
      input.kind === other.kind &&
      input.label === other.label &&
      input.required === other.required &&
      input.multiple === other.multiple
    );
  });
}

function ensureGenerationNodeInputs(nodes: CanvasNode[]): CanvasNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    const nodeType = node.data.nodeType;
    if (nodeType !== "image-generation" && nodeType !== "video-generation")
      return node;
    const inputs = generationInputsForModel(nodeType, null, node.data.inputs);
    if (generationInputsEqual(node.data.inputs, inputs)) return node;
    changed = true;
    return { ...node, data: { ...node.data, inputs } };
  });
  return changed ? next : nodes;
}

/**
 * Model discovery is allowed to migrate an obsolete model ID, but it must not
 * rewrite an explicit, still-valid selection. A catalog refresh can change
 * defaults or temporarily return a different parameter schema; applying those
 * defaults here made a saved node change merely because it was selected after
 * a page reload.
 */
export function modelDiscoveryMigrationPatch(
  nodeType: "image-generation" | "video-generation",
  data: CanvasNodeData,
  provider: string,
  model: ModelDescriptor,
): Partial<CanvasNodeData> | null {
  const normalizedInputs = generationInputsForModel(
    nodeType,
    model,
    data.inputs,
  );
  if (data.model === model.id && data.provider === provider) {
    return generationInputsEqual(data.inputs, normalizedInputs)
      ? null
      : { inputs: normalizedInputs };
  }

  const currentParameters =
    (data.parameters as Readonly<Record<string, unknown>> | undefined) ?? {};
  const migratedParameters = { ...currentParameters };
  const isFixedQualityAdobeModel =
    model.metadata?.modelGroup === "生图-openai-adobe-按次" &&
    typeof model.metadata?.fixedQuality === "string";
  if (isFixedQualityAdobeModel) delete migratedParameters.quality;

  return {
    provider,
    model: model.id,
    inputs: normalizedInputs,
    parameters: parametersWithDefaults(
      parameterDescriptorsFor(nodeType, provider, model),
      migratedParameters,
    ),
  };
}

function parameterValuesEqual(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        Object.is(left[key], right[key]),
    )
  );
}

/** Migrates obsolete Adobe virtual-resolution IDs to real We-AI model IDs. */
function migrateSavedWeAiAdobeNodes(
  nodes: CanvasNode[],
  connections: readonly ProviderConnectionView[],
): CanvasNode[] {
  const connectionsById = new Map(
    connections.map((connection) => [connection.id, connection] as const),
  );
  let changed = false;
  const migrated = nodes.map((node) => {
    const nodeType = node.data.nodeType;
    if (nodeType !== "image-generation" && nodeType !== "video-generation")
      return node;
    const connectionId = node.data.connectionId;
    const connection =
      typeof connectionId === "string"
        ? connectionsById.get(connectionId)
        : undefined;
    if (
      !connection ||
      connection.provider !== "weai" ||
      providerConnectionSupplierKey(connection) !== "weai" ||
      providerConnectionGroup(connection) !== "生图-openai-adobe-按次"
    ) {
      return node;
    }
    const compatible = modelDescriptorsForConnection(connection).filter(
      (model) => modelSupportsNodeType(model, nodeType),
    );
    if (compatible.length === 0) return node;
    const currentParameters =
      (node.data.parameters as Readonly<Record<string, unknown>> | undefined) ??
      {};
    const savedModel = node.data.model;
    const legacyVariant =
      typeof savedModel === "string"
        ? /^gpt-image-2(?:-(low|medium|high))?::(1k|2k|4k)$/iu.exec(
            savedModel.trim(),
          )
        : null;
    const alreadyReal = compatible.some(
      (candidate) => candidate.id === savedModel,
    );
    if (alreadyReal && currentParameters.quality === undefined) return node;

    const model =
      modelDescriptorForSavedSelection(
        compatible,
        savedModel,
        currentParameters,
      ) ??
      compatible.find((candidate) => candidate.isDefault) ??
      compatible[0]!;

    const migratedParameters = { ...currentParameters };
    // The fixed quality now lives exclusively in the real model ID.
    delete migratedParameters.quality;
    const savedSize = migratedParameters.size;
    if (
      legacyVariant?.[2] &&
      (typeof savedSize !== "string" || savedSize.trim() === "auto")
    ) {
      const size = weAiSizePresetForTier(
        model,
        legacyVariant[2].toLowerCase() as "1k" | "2k" | "4k",
        migratedParameters.aspect_ratio,
      );
      if (size) {
        migratedParameters.size = size;
        // `size` is the documented Images API request parameter.  Keeping an
        // old UI-only aspect ratio beside it can produce conflicting output.
        delete migratedParameters.aspect_ratio;
      }
    }

    const normalizedParameters = parametersWithDefaults(
      parameterDescriptorsFor(nodeType, connection.provider, model),
      migratedParameters,
    );
    if (
      typeof migratedParameters.size === "string" &&
      migratedParameters.size !== "auto"
    ) {
      delete normalizedParameters.aspect_ratio;
    }
    if (
      node.data.provider === connection.provider &&
      node.data.model === model.id &&
      parameterValuesEqual(currentParameters, normalizedParameters)
    ) {
      return node;
    }
    changed = true;
    return {
      ...node,
      data: {
        ...node.data,
        provider: connection.provider,
        model: model.id,
        inputs: generationInputsForModel(nodeType, model, node.data.inputs),
        parameters: normalizedParameters,
      },
    };
  });
  return changed ? migrated : nodes;
}

function modelOptionsForNode(
  node: CanvasNode,
  connections: readonly ProviderConnectionView[],
  listed: {
    connectionId: string;
    items: readonly ModelDescriptor[];
    authoritative?: boolean;
    loading?: boolean;
  },
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
    ? modelDescriptorsForConnection(connection).filter((model) =>
        modelSupportsNodeType(model, nodeType),
      )
    : [];
  const requiresAuthoritativeScan = Boolean(
    connection && connectionRequiresAuthoritativeModelScan(connection),
  );
  const hasSavedWeAiScan = Boolean(
    connection &&
    connection.provider === "weai" &&
    weAiCanvasModelDescriptorsFromSavedScan(connection.config) !== null,
  );
  if (listed.connectionId === node.data.connectionId) {
    const compatible = listed.items.filter((model) =>
      modelSupportsNodeType(model, nodeType),
    );
    if (
      compatible.length > 0 ||
      (listed.authoritative &&
        !(
          listed.loading &&
          (connection?.config.preset === CHENTU_PRESET_ID ||
            connection?.config.preset === FRIMODEL_PRESET_ID)
        )) ||
      (connection &&
        verifiedWeAiModelDescriptorsForConnection(connection).length > 0)
    )
      return [...compatible];
  }
  if (requiresAuthoritativeScan) {
    if (hasSavedWeAiScan) return configured;
    const keyedImageScanPending = Boolean(
      connection &&
      (connection.config.preset === CHENTU_PRESET_ID ||
        connection.config.preset === FRIMODEL_PRESET_ID) &&
      (listed.connectionId !== node.data.connectionId || listed.loading),
    );
    if (keyedImageScanPending && nodeType === "image-generation" && connection) {
      const selectedModel =
        typeof node.data.model === "string" && node.data.model.trim()
          ? node.data.model.trim()
          : defaultModelForConnection(connection);
      const fallback =
        connection.config.preset === CHENTU_PRESET_ID
          ? selectedModel
            ? chentuFallbackImageDescriptor(
                selectedModel,
                providerConnectionGroup(connection),
              )
            : undefined
          : selectedModel
            ? friModelFallbackImageDescriptor(
                selectedModel,
                providerConnectionGroup(connection),
              )
            : undefined;
      return fallback ? [fallback] : [];
    }
    return [];
  }
  return configured;
}

function normalizeGenerationNodeForRun(
  node: CanvasNode,
  connections: readonly ProviderConnectionView[],
  listed: {
    connectionId: string;
    items: readonly ModelDescriptor[];
    authoritative?: boolean;
    loading?: boolean;
  },
): CanvasNode {
  const nodeType = node.data.nodeType;
  if (nodeType !== "image-generation" && nodeType !== "video-generation")
    return node;
  const connection = connections.find(
    (candidate) => candidate.id === node.data.connectionId,
  );
  const options = modelOptionsForNode(node, connections, listed);
  const model = options.find((candidate) => candidate.id === node.data.model);
  const current =
    (node.data.parameters as Readonly<Record<string, unknown>> | undefined) ??
    {};
  const normalized = normalizedParametersForModel(
    nodeType,
    node.data.provider ?? "fake",
    model,
    current,
  );
  // Keep the pending-result count aligned with supplier capabilities even
  // while a live model scan is still loading. Without this fallback an old
  // node can briefly retain `n > 1` and render phantom failed slots before
  // the server has a chance to normalize or reject it.
  if (nodeType === "image-generation") {
    const supplier = connection
      ? providerConnectionSupplierKey(connection)
      : undefined;
    const group = connection ? providerConnectionGroup(connection) : undefined;
    const singleOutput =
      supplier === "frimodel" ||
      supplier === "cyberafei" ||
      supplier === "mikoto" ||
      (supplier === "chentu" && group !== "image2官key");
    if (singleOutput) delete normalized.n;
  }
  if (parameterValuesEqual(current, normalized)) return node;
  return {
    ...node,
    data: {
      ...node.data,
      parameters: normalized,
    },
  };
}

const transientNodeDataKeys = new Set([
  "onRun",
  "onRegenerate",
  "onRecoverResult",
  "onSelect",
  "onOpenPreview",
  "onPrepareReversePrompt",
  "onDelete",
  "onResizeStart",
  "selectionAlignmentVisible",
  "selectionCount",
  "onAlignSelection",
  "onPromptPartsChange",
  "onConnectionChange",
  "onModelChange",
  "onParametersChange",
  "onMediaAspectRatio",
  "onLinkedAssetDuration",
  "onRemoveLinkedAsset",
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

const generatedResultIdentityKeys: readonly (keyof CanvasNodeData)[] = [
  "generatedResult",
  "generatedStatus",
  "generatedError",
  "generatedFromNodeId",
  "generatedFromRunId",
  "generatedProvider",
  "generatedSupplier",
  "generatedConnectionId",
  "generatedConnectionName",
  "generatedGroup",
  "generatedModel",
  "generatedParameters",
  "generatedCreatedAt",
  "generatedPromptParts",
  "generatedPromptText",
  "generatedPendingRequestId",
  "generatedOutputIndex",
  "generatedRecoveryAction",
];

function copyableCanvasNode(node: CanvasNode): CanvasNode | null {
  const copy = serializableNode(node);
  if (copy.data.generatedResult !== true) return copy;
  if (!copy.data.assetId) return null;

  const data = { ...copy.data };
  for (const key of generatedResultIdentityKeys) delete data[key];
  data.inputs = [];
  data.label = data.assetKind === "video" ? "固定视频" : "固定图片";
  return { ...copy, data };
}

function serializableGraph(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  viewport?: { x: number; y: number; zoom: number },
  drawings: readonly CanvasDrawingStroke[] = useCanvasStore.getState().drawings,
): CanvasDocument {
  const persistedNodes = nodes.filter(
    (node) =>
      node.data.pendingImport !== true && node.data.directorDraft !== true,
  );
  const persistedNodeIds = new Set(persistedNodes.map((node) => node.id));
  const persistedEdges = filterEdgesToKnownPorts(
    persistedNodes,
    edges.filter(
      (edge) =>
        persistedNodeIds.has(edge.source) && persistedNodeIds.has(edge.target),
    ),
  );
  return {
    schemaVersion: 1,
    nodes: persistedNodes.map(serializableNode),
    edges: persistedEdges,
    viewport,
    drawings: drawings.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    })),
  };
}

function safeDownloadBaseName(value: string): string {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
      .replace(/[. ]+$/gu, "")
      .slice(0, 120) || "super-canvas"
  );
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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

interface CanvasShellProps {
  projectId: string;
  projects: ProjectSummaryView[];
  onSelectProject: (projectId: string) => void;
  onCreateProject: (title: string) => Promise<void>;
  onCleanupProject: (projectId: string) => Promise<void>;
  onOpenProjectFolder: (projectId: string) => Promise<void>;
  onRenameProject: (
    projectId: string,
    title: string,
  ) => Promise<RenameProjectResult>;
  onDeleteProject: (projectId: string) => Promise<string | undefined>;
}

interface ProjectContextMenuState {
  project: ProjectSummaryView;
  x: number;
  y: number;
}

function ProjectSidebar({
  projects,
  activeProjectId,
  mobileOpen = false,
  onSelectProject,
  onCreateProject,
  onCleanupProject,
  onOpenProjectFolder,
  onRenameProject,
  onDeleteProject,
}: {
  projects: ProjectSummaryView[];
  activeProjectId: string;
  mobileOpen?: boolean;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (title: string) => Promise<void>;
  onCleanupProject: (projectId: string) => Promise<void>;
  onOpenProjectFolder: (projectId: string) => Promise<void>;
  onRenameProject: (
    projectId: string,
    title: string,
  ) => Promise<RenameProjectResult>;
  onDeleteProject: (projectId: string) => Promise<string | undefined>;
}) {
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [contextMenu, setContextMenu] =
    useState<ProjectContextMenuState | null>(null);
  const [dialogAction, setDialogAction] =
    useState<ProjectActionDialogState | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contextMenu]);

  const submit = async () => {
    const title = draftTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    setError("");
    try {
      await onCreateProject(title);
      setDraftTitle("");
      setCreating(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "项目创建失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <aside
        className={`project-sidebar ${mobileOpen ? "mobile-open" : ""}`}
        aria-label="项目对话"
      >
      <div className="project-sidebar-head">
        <div>
          <strong>项目对话</strong>
          <small>{projects.length} 个项目</small>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => {
            setCreating((current) => !current);
            setError("");
          }}
          aria-label="新建对话"
          title="新建项目对话"
        >
          <MessageSquarePlus size={16} />
        </button>
      </div>
      {creating ? (
        <form
          className="project-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            autoFocus
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder="项目名称"
            maxLength={160}
            disabled={busy}
          />
          <div>
            <button className="button primary small" type="submit" disabled={!draftTitle.trim() || busy}>
              创建
            </button>
            <button
              className="button small"
              type="button"
              onClick={() => setCreating(false)}
              disabled={busy}
            >
              取消
            </button>
          </div>
        </form>
      ) : null}
      <div className="project-list" role="list">
        {projects.map((project) => (
          <div
            className={`project-row ${project.id === activeProjectId ? "active" : ""}`}
            key={project.id}
            role="listitem"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({
                project,
                x: Math.min(event.clientX, Math.max(8, window.innerWidth - 232)),
                y: Math.min(event.clientY, Math.max(8, window.innerHeight - 160)),
              });
            }}
          >
            <button
              className="project-row-main"
              type="button"
              onClick={() => onSelectProject(project.id)}
              aria-current={project.id === activeProjectId ? "page" : undefined}
              title={project.title}
            >
              <span className="project-row-icon"><MessageSquarePlus size={14} /></span>
              <span className="project-row-copy">
                <strong>{project.title}</strong>
                <small>{new Date(project.updatedAt).toLocaleDateString("zh-CN")}</small>
              </span>
            </button>
          </div>
        ))}
      </div>
      {contextMenu ? (
        <>
          <button
            className="project-context-menu-backdrop"
            type="button"
            aria-label="关闭项目菜单"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="project-context-menu"
            role="menu"
            aria-label={`${contextMenu.project.title} 的项目操作`}
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <span>{contextMenu.project.title}</span>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setDialogAction({
                  mode: "rename",
                  project: contextMenu.project,
                });
                setContextMenu(null);
                setError("");
              }}
            >
              <Pencil size={14} /> 重命名项目
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                const projectId = contextMenu.project.id;
                setContextMenu(null);
                setBusy(true);
                setError("");
                void onOpenProjectFolder(projectId)
                  .catch((nextError) => {
                    setError(
                      nextError instanceof Error
                        ? nextError.message
                        : "项目文件夹打开失败",
                    );
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <FolderOpen size={14} /> 查看项目文件夹
            </button>
            <div className="project-context-menu-divider" />
            <button
              className="danger"
              type="button"
              role="menuitem"
              disabled={busy || projects.length <= 1}
              title={projects.length <= 1 ? "至少需要保留一个项目" : undefined}
              onClick={() => {
                const project = contextMenu.project;
                setContextMenu(null);
                setDialogAction({ mode: "delete", project });
                setError("");
              }}
            >
              <Trash2 size={14} /> 删除项目
            </button>
          </div>
        </>
      ) : null}
      <div className="project-sidebar-foot">
        <button
          className="button danger small"
          type="button"
          onClick={() => {
            const project = projects.find((item) => item.id === activeProjectId);
            if (project) setDialogAction({ mode: "cleanup", project });
          }}
          disabled={busy || !activeProjectId}
        >
          <Trash2 size={13} /> 清理本项目草稿
        </button>
        {error ? <span className="field-note" role="alert">{error}</span> : null}
      </div>
      </aside>
      {dialogAction ? (
        <ProjectActionDialog
          key={`${dialogAction.mode}:${dialogAction.project.id}:${dialogAction.project.title}`}
          action={dialogAction}
          onClose={() => setDialogAction(null)}
          onRename={async (projectId, title) => {
            await onRenameProject(projectId, title);
          }}
          onDelete={async (projectId) => {
            await onDeleteProject(projectId);
          }}
          onCleanup={onCleanupProject}
        />
      ) : null}
    </>
  );
}

function CanvasShell({
  projectId,
  projects,
  onSelectProject,
  onCreateProject,
  onCleanupProject,
  onOpenProjectFolder,
  onRenameProject,
  onDeleteProject,
}: CanvasShellProps) {
  const [canvasId, setCanvasId] = useState<string | null>(projectId);
  const [initialization, setInitialization] =
    useState<CanvasInitializationState>({ status: "loading" });
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
    authoritative?: boolean;
    loading?: boolean;
  }>({
    connectionId: "",
    items: [],
    authoritative: false,
    loading: false,
  });
  const [modelScanRevision, setModelScanRevision] = useState(0);
  const [nodeRunStatuses, setNodeRunStatuses] = useState<
    Map<string, NodeRunStatus>
  >(new Map());
  const latestNodeRunAt = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateView | null>(
    null,
  );
  const [appUpdateOpen, setAppUpdateOpen] = useState(false);
  const [appUpdateBusy, setAppUpdateBusy] = useState(false);
  const [appUpdateReloadReady, setAppUpdateReloadReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveConflict, setSaveConflict] =
    useState<CanvasSaveConflictState | null>(null);
  const [saveConflictOpen, setSaveConflictOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialCangyuanGroup, setSettingsInitialCangyuanGroup] =
    useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [runHistoryOpen, setRunHistoryOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<AssetView | null>(null);
  const [previewReturnsToHistory, setPreviewReturnsToHistory] = useState(false);
  const [agentDraftRequest, setAgentDraftRequest] =
    useState<AgentDraftRequest | null>(null);
  const [mobileLibraryOpen, setMobileLibraryOpen] = useState(false);
  const [mobileProjectsOpen, setMobileProjectsOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("node");
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [inspectorResizing, setInspectorResizing] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [pendingProjectImport, setPendingProjectImport] =
    useState<PreparedProjectImport | null>(null);
  const [projectImportBusy, setProjectImportBusy] = useState(false);
  const [projectImportBackup, setProjectImportBackup] = useState(true);
  const [projectImportProgress, setProjectImportProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [projectImportError, setProjectImportError] = useState<string | null>(
    null,
  );
  const [portableExportProgress, setPortableExportProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
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
  const connectionStartRef = useRef<{
    nodeId: string;
    handleId: string;
    handleType: "source" | "target";
    edgeIds: Set<string>;
  } | null>(null);
  const [modelLoadError, setModelLoadError] = useState<{
    connectionId: string;
    message: string;
  } | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(
    null,
  );
  const updateNodeInternals = useUpdateNodeInternals();
  const portLayoutSignatureRef = useRef("");
  const canvasWrapRef = useRef<HTMLElement | null>(null);
  const recentNativeDropsRef = useRef(new Map<string, number>());
  const pendingNativeDropsRef = useRef(new Map<string, PendingNativeDrop[]>());
  const bridgeHandledNativeDropsRef = useRef(new Map<string, number>());
  const pendingPreviewUrlsRef = useRef(new Map<string, string>());
  const nativeUploadInProgressRef = useRef(new Set<string>());
  const activeBridgeDropsRef = useRef(new Set<string>());
  const materialDropPollRef = useRef<(() => Promise<void>) | null>(null);
  const materialDropConsumerIdRef = useRef(crypto.randomUUID());
  const initialViewportApplied = useRef(false);
  const toastTimer = useRef<number | null>(null);
  const toastSeq = useRef(0);
  const appUpdateVersionRef = useRef<string | null>(null);
  const appUpdateNoticeVersionRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<CanvasSaveRequest | null>(null);
  const conflictedSave = useRef<CanvasSaveRequest | null>(null);
  const canvasRevision = useRef<number | null>(null);
  const [canvasRevisionValue, setCanvasRevisionValue] = useState(0);
  const saveConflictRef = useRef<CanvasSaveConflictState | null>(null);
  const latestSaveAttempt = useRef(0);
  const eventSources = useRef<Map<string, EventSource>>(new Map());
  const activeRunKeys = useRef(new Set<string>());
  const submittingRequestIds = useRef(new Set<string>());
  const activeRunSources = useRef(new Map<string, Set<string>>());
  const runSubmissionKeys = useRef(new Map<string, string>());
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
  const groupSelectedNodesRef = useRef<(() => void) | null>(null);
  const ungroupSelectedNodesRef = useRef<(() => void) | null>(null);
  const directorPreviewNodeIdsRef = useRef(new Set<string>());
  const nodeClipboardRef = useRef<{
    nodes: CanvasNode[];
    edges: CanvasEdge[];
  } | null>(null);
  const historyRef = useRef<{
    past: CanvasDocument[];
    future: CanvasDocument[];
    lastAt: number;
  }>({ past: [], future: [], lastAt: 0 });
  const saveQueue = useRef<LatestTaskQueue<CanvasSaveRequest> | null>(null);
  const activeProjectIdRef = useRef(projectId);
  const persistQueuedCanvasSave = useCallback(
    async (request: CanvasSaveRequest) => {
      const existingConflict = saveConflictRef.current;
      if (existingConflict) {
        conflictedSave.current = request;
        throw new CanvasSaveConflictError(
          existingConflict.currentRevision,
          existingConflict.message,
        );
      }

      const expectedRevision = canvasRevision.current;
      if (expectedRevision === null)
        throw new Error("画布尚未完成初始化，无法保存");

      try {
        const saved = await persistCanvasSaveRequest({
          ...request,
          expectedRevision,
        });
        clearPersistedNodeConfigurations(request.pendingNodeConfigurations);
        if (request.canvasId !== activeProjectIdRef.current) return;
        canvasRevision.current = saved.revision;
        setCanvasRevisionValue(saved.revision);
      } catch (error) {
        if (error instanceof CanvasSaveConflictError) {
          const conflict: CanvasSaveConflictState = {
            expectedRevision,
            currentRevision: error.currentRevision,
            message: error.message,
          };
          saveConflictRef.current = conflict;
          conflictedSave.current = request;
          pendingSave.current = null;
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = null;
          setSaveConflict(conflict);
          // Open the modal only for the first conflict. Once the user closes
          // it, background reconciliation must not keep interrupting them;
          // the save-status button remains available for manual reopening.
          if (!existingConflict) setSaveConflictOpen(true);
          setSaveState("conflict");
        }
        throw error;
      }
    },
    [],
  );

  useEffect(() => {
    saveQueue.current = new LatestTaskQueue(persistQueuedCanvasSave);
  }, [persistQueuedCanvasSave]);

  useEffect(() => {
    graphRef.current = { nodes, edges };
  }, [nodes, edges]);

  useEffect(
    () => () => {
      for (const previewUrl of pendingPreviewUrlsRef.current.values())
        URL.revokeObjectURL(previewUrl);
      pendingPreviewUrlsRef.current.clear();
    },
    [],
  );

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

  const refreshAppUpdate = useCallback(async (announce = true) => {
    try {
      const next = await fetchAppUpdate();
      const previousCurrent = appUpdateVersionRef.current;
      if (
        previousCurrent &&
        previousCurrent !== next.currentVersion &&
        next.phase === "idle"
      ) {
        setAppUpdateReloadReady(true);
        setAppUpdateOpen(true);
      }
      appUpdateVersionRef.current = next.currentVersion;
      if (
        announce &&
        next.phase === "available" &&
        next.latest &&
        next.latest.version !== appUpdateNoticeVersionRef.current
      ) {
        appUpdateNoticeVersionRef.current = next.latest.version;
        setAppUpdateOpen(true);
      }
      setAppUpdateStatus(next);
    } catch {
      // A disconnected updater must never make the canvas unavailable.
    }
  }, []);

  const waitForAppUpdateCheck = useCallback(
    async (previousLastCheckedAt?: string) => {
      const deadline = Date.now() + 12_000;
      let latest = await fetchAppUpdate();
      while (Date.now() < deadline) {
        if (
          latest.phase === "available" ||
          latest.phase === "failed" ||
          (latest.phase === "idle" &&
            latest.lastCheckedAt !== previousLastCheckedAt)
        )
          break;
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        latest = await fetchAppUpdate();
      }
      appUpdateVersionRef.current = latest.currentVersion;
      setAppUpdateStatus(latest);
      return latest;
    },
    [],
  );

  useEffect(() => {
    const initialCheck = window.setTimeout(
      () => void refreshAppUpdate(),
      0,
    );
    const phase = appUpdateStatus?.phase;
    const isActiveUpdate =
      phase === "downloading" ||
      phase === "ready" ||
      phase === "waiting_for_idle" ||
      phase === "applying";
    const interval = window.setInterval(
      () => void refreshAppUpdate(),
      isActiveUpdate ? 2_000 : 10 * 60 * 1_000,
    );
    return () => {
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
    };
  }, [appUpdateStatus?.phase, refreshAppUpdate]);

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

  const projectTitle = projects.find((project) => project.id === projectId)?.title;

  useEffect(() => {
    const streams = eventSources.current;
    let active = true;
    let initializationSettled = false;
    // Switching projects keeps the page shell mounted, so clear only the
    // canvas-scoped state before the next snapshot arrives.
    /* eslint-disable react-hooks/set-state-in-effect */
    activeProjectIdRef.current = projectId;
    latestSaveAttempt.current += 1;
    setInitialization({ status: "loading" });
    setCanvasId(projectId);
    setNodes([]);
    setEdges([]);
    setDrawings([]);
    setSelectedId(null);
    setViewport({ x: 0, y: 0, zoom: 0.85 });
    graphRef.current = { nodes: [], edges: [] };
    initialViewportApplied.current = false;
    setNodeRunStatuses(new Map());
    latestNodeRunAt.current.clear();
    setBusy(false);
    setSaveState("saved");
    canvasRevision.current = null;
    setCanvasRevisionValue(0);
    saveConflictRef.current = null;
    conflictedSave.current = null;
    setSaveConflict(null);
    setSaveConflictOpen(false);
    if (projectTitle) setTitle(projectTitle);
    activeRunKeys.current.clear();
    activeRunSources.current.clear();
    runSubmissionKeys.current.clear();
    /* eslint-enable react-hooks/set-state-in-effect */
    const failInitialization = (error: unknown) => {
      if (!active || initializationSettled) return;
      initializationSettled = true;
      window.clearTimeout(initializationTimeout);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "无法读取画布";
      setInitialization({ status: "error", message });
      showToast(message, "error");
    };
    const initializationTimeout = window.setTimeout(
      () => failInitialization(new Error("画布加载超时，请重新加载页面")),
      CANVAS_INITIALIZATION_TIMEOUT_MS,
    );

    void (async () => {
      try {
        // Loading optional catalogs must not hold the canvas behind a permanent
        // loading screen when one provider or the asset store is unavailable.
        const assetsPromise = fetchAssets();
        const connectionsPromise = fetchConnections();
        // Attach rejection handlers before waiting for the critical canvas
        // request so an unavailable optional endpoint cannot become an
        // unhandled rejection while the canvas is loading.
        void assetsPromise.catch(() => undefined);
        void connectionsPromise.catch(() => undefined);
        const canvasResult = await Promise.allSettled([fetchCanvas(projectId)]);
        if (!active || initializationSettled) return;

        const canvasOutcome = canvasResult[0];
        if (canvasOutcome?.status === "rejected") {
          throw canvasOutcome.reason instanceof Error
            ? canvasOutcome.reason
            : new Error("无法读取画布");
        }

        const canvas = canvasOutcome?.value;
        if (!canvas) {
          throw new Error("无法读取画布");
        }

        // Provider connections are optional during the first paint. The
        // migration only affects legacy model IDs and can run when the catalog
        // arrives without preventing the saved graph from becoming interactive.
        const providerConnections: ProviderConnectionView[] = [];
        canvasRevision.current = canvas.revision;
        setCanvasRevisionValue(canvas.revision);
        saveConflictRef.current = null;
        conflictedSave.current = null;
        setSaveConflict(null);
        setSaveConflictOpen(false);
        setCanvasId(canvas.id);
        setTitle(canvas.title);
        setAssets([]);
        setConnections([]);
        const graph = canvas.graph;
        const typedNodes = graph.nodes.map((node) => ({
          ...node,
          type: "workflow" as const,
        }));
        const migratedNodes = migrateSavedWeAiAdobeNodes(
          typedNodes,
          providerConnections,
        );
        const pendingNodeConfigurations =
          readPendingNodeConfigurations().filter(
            (entry) => entry.canvasId === canvas.id,
          );
        const journaledNodes = applyPendingNodeConfigurations(
          migratedNodes,
          canvas.id,
          pendingNodeConfigurations,
        );
        const graphNodes = ensureGeneratedResultInputs(
          ensureGenerationNodeInputs(journaledNodes),
        );
        const syncedGraphEdges = syncGeneratedResultEdges(
          graphNodes,
          graph.edges,
        );
        const graphEdges = filterEdgesToKnownPorts(
          graphNodes,
          keepLatestEdgePerNodePair(syncedGraphEdges),
        );
        const graphDrawings = graph.drawings ?? [];
        const graphViewport = graph.viewport ?? { x: 0, y: 0, zoom: 0.85 };
        const graphWasReconciled =
          graphNodes !== typedNodes ||
          journaledNodes !== migratedNodes ||
          graphEdges !== graph.edges;
        setNodes(graphNodes);
        setEdges(graphEdges);
        setDrawings(graphDrawings);
        setViewport(graphViewport);
        initializationSettled = true;
        window.clearTimeout(initializationTimeout);
        setInitialization({ status: "ready" });

        void assetsPromise
          .then((loadedAssets) => {
            if (active) setAssets(loadedAssets);
          })
          .catch((error: unknown) => {
            if (active)
              showToast(
                `${error instanceof Error ? error.message : "素材库读取失败"}，画布仍可继续编辑`,
                "error",
              );
          });
        void connectionsPromise
          .then((loadedConnections) => {
            if (!active) return;
            setConnections(loadedConnections);
            setNodes((current) => {
              const migrated = migrateSavedWeAiAdobeNodes(
                current,
                loadedConnections,
              );
              const next =
                migrated === current
                  ? current
                  : ensureGeneratedResultInputs(
                      ensureGenerationNodeInputs(migrated),
                    );
              if (next !== current) {
                const state = useCanvasStore.getState();
                const nextEdges = filterEdgesToKnownPorts(next, state.edges);
                if (nextEdges.length !== state.edges.length)
                  useCanvasStore.setState({ edges: nextEdges });
              }
              return next;
            });
          })
          .catch((error: unknown) => {
            if (active)
              showToast(
                `${error instanceof Error ? error.message : "API 连接读取失败"}，画布仍可继续编辑`,
                "error",
              );
          });

        if (!canvas.graph.nodes?.length || graphWasReconciled) {
          const initialSaveAttempt = (latestSaveAttempt.current += 1);
          pendingSave.current = {
            canvasId: canvas.id,
            title: canvas.title,
            graph: serializableGraph(
              graphNodes,
              graphEdges,
              graphViewport,
              graphDrawings,
            ),
            pendingNodeConfigurations,
          };
          setSaveState("pending");
          saveTimer.current = setTimeout(() => {
            saveTimer.current = null;
            if (!active) return;
            const request = pendingSave.current;
            pendingSave.current = null;
            if (!request) return;
            setSaveState("saving");
            void saveQueue.current
              ?.enqueue(request)
              .then(() => {
                if (active && initialSaveAttempt === latestSaveAttempt.current)
                  setSaveState((current) =>
                    current === "saving" ? "saved" : current,
                  );
              })
              .catch((error: unknown) => {
                if (!active || initialSaveAttempt !== latestSaveAttempt.current)
                  return;
                setSaveState(
                  error instanceof CanvasSaveConflictError
                    ? "conflict"
                    : "error",
                );
                showToast(
                  error instanceof Error ? error.message : "画布保存失败",
                  "error",
                );
              });
          }, 200);
        }
      } catch (error) {
        failInitialization(error);
      } finally {
        // Every path through initialization must clear the deadline. If a
        // future refactor returns without settling, fail closed instead of
        // leaving the page's loading state forever.
        window.clearTimeout(initializationTimeout);
        if (active && !initializationSettled)
          failInitialization(new Error("画布初始化未完成，请重新加载页面"));
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(initializationTimeout);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pendingSave.current = null;
      for (const stream of streams.values()) stream.close();
      streams.clear();
      setBusy(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, showToast]);

  const saveRequest = useCallback(
    async (request: CanvasSaveRequest, reportError = true) => {
      const attempt = (latestSaveAttempt.current += 1);
      setSaveState("saving");
      try {
        await saveQueue.current?.enqueue(request);
        // Only the newest request may publish completion. An older in-flight
        // save can finish after a manual flush has already queued newer data.
        if (attempt === latestSaveAttempt.current)
          setSaveState((current) => (current === "saving" ? "saved" : current));
      } catch (error) {
        if (attempt === latestSaveAttempt.current) {
          const conflict = error instanceof CanvasSaveConflictError;
          setSaveState(conflict ? "conflict" : "error");
          if (reportError)
            showToast(
              conflict
                ? "检测到其他窗口更新，自动保存已暂停"
                : error instanceof Error
                  ? error.message
                  : "画布保存失败",
              "error",
            );
        }
        throw error;
      }
    },
    [showToast],
  );

  const saveGraph = useCallback(
    async (
      id: string,
      nextNodes: CanvasNode[],
      nextEdges: CanvasEdge[],
      nextViewport = useCanvasStore.getState().viewport,
      nextDrawings = useCanvasStore.getState().drawings,
      pendingNodeConfigurations?: PendingNodeConfiguration[],
    ) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pendingSave.current = null;
      const request: CanvasSaveRequest = {
        canvasId: id,
        graph: serializableGraph(
          nextNodes,
          nextEdges,
          nextViewport,
          nextDrawings,
        ),
        title: useCanvasStore.getState().title,
        pendingNodeConfigurations,
      };
      const conflict = saveConflictRef.current;
      if (conflict) {
        conflictedSave.current = request;
        latestSaveAttempt.current += 1;
        setSaveState("conflict");
        throw new CanvasSaveConflictError(
          conflict.currentRevision,
          conflict.message,
        );
      }
      await saveRequest(request);
    },
    [saveRequest],
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
      latestSaveAttempt.current += 1;
      const request: CanvasSaveRequest = {
        canvasId,
        graph: serializableGraph(
          nextNodes,
          nextEdges,
          nextViewport,
          nextDrawings,
        ),
        title: useCanvasStore.getState().title,
      };
      if (saveConflictRef.current) {
        pendingSave.current = null;
        conflictedSave.current = request;
        setSaveState("conflict");
        return;
      }
      pendingSave.current = request;
      setSaveState("pending");
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        const request = pendingSave.current;
        pendingSave.current = null;
        if (request) void saveRequest(request).catch(() => undefined);
      }, 650);
    },
    [canvasId, saveRequest],
  );

  /** Flushes the debounced autosave immediately (Ctrl/Cmd+S, project menu). */
  const saveNow = useCallback(async () => {
    if (!canvasId) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingSave.current = null;
    const state = useCanvasStore.getState();
    await saveGraph(
      canvasId,
      state.nodes,
      state.edges,
      state.viewport,
      state.drawings,
    );
  }, [canvasId, saveGraph]);

  const runAppUpdateAction = useCallback(
    async (action: "check" | "download" | "apply" | "defer") => {
      if (appUpdateBusy) return;
      setAppUpdateBusy(true);
      try {
        if (action === "apply") await saveNow();
        const previousLastCheckedAt = appUpdateStatus?.lastCheckedAt;
        await requestAppUpdate(action, appUpdateStatus?.latest?.version);
        if (action === "defer") {
          setAppUpdateOpen(false);
          showToast("已延后此版本更新");
        } else if (action === "check") {
          showToast("正在检查 GitHub Release");
        } else if (action === "download") {
          showToast("更新包开始后台下载", "success");
        } else {
          showToast("更新已提交，服务将在空闲后切换", "success");
        }
        if (action === "check")
          await waitForAppUpdateCheck(previousLastCheckedAt);
        else {
          await new Promise((resolve) => window.setTimeout(resolve, 700));
          await refreshAppUpdate(false);
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : "更新操作失败", "error");
      } finally {
        setAppUpdateBusy(false);
      }
    },
    [
      appUpdateBusy,
      appUpdateStatus,
      refreshAppUpdate,
      saveNow,
      showToast,
      waitForAppUpdateCheck,
    ],
  );

  useEffect(() => {
    const flushPendingSave = () => {
      if (saveConflictRef.current) {
        pendingSave.current = null;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = null;
        return;
      }
      const request = pendingSave.current;
      if (!request) return;
      pendingSave.current = null;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      // keepalive gives the request a chance to complete while the page is
      // being hidden. The same serialized queue preserves write order.
      void saveRequest({ ...request, keepalive: true }, false).catch(
        () => undefined,
      );
    };
    window.addEventListener("pagehide", flushPendingSave);
    return () => {
      window.removeEventListener("pagehide", flushPendingSave);
      flushPendingSave();
    };
  }, [saveRequest]);

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
      const nextNodes = ensureGeneratedResultInputs(
        ensureGenerationNodeInputs(
          snapshot.nodes.map((node) => ({
            ...node,
            type: "workflow" as const,
          })),
        ),
      );
      const nextEdges = filterEdgesToKnownPorts(
        nextNodes,
        syncGeneratedResultEdges(nextNodes, snapshot.edges),
      );
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
        modelDescriptorForSavedSelectionOrDefault(
          options,
          node.data.model,
          node.data.parameters as Readonly<Record<string, unknown>> | undefined,
        ) ?? null;
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
      if (hasEdgeForNodePair(edges, connection.source, connection.target)) {
        return {
          valid: false,
          source,
          target,
          sourceKind,
          targetKind,
          targetPort,
          reason: "同一图片只能连接目标节点的一个接口",
        };
      }
      if (
        targetPort &&
        !targetPort.multiple &&
        edges.some(
          (edge) =>
            edge.target === connection.target &&
            edge.targetHandle === connection.targetHandle &&
            !(
              edge.source === connection.source &&
              edge.target === connection.target
            ),
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
      const current = useCanvasStore.getState();
      if (
        hasEdgeForNodePair(current.edges, connection.source, connection.target)
      ) {
        showToast("同一图片只能连接目标节点的一个接口");
        return;
      }
      checkpoint(true);
      const nextEdges = keepLatestEdgePerNodePair(
        addEdge(
          {
            ...connection,
            id: `edge-${crypto.randomUUID().slice(0, 8)}`,
            type: "smoothstep",
          },
          current.edges,
        ),
      );
      setEdges(nextEdges);
      scheduleSave(current.nodes, nextEdges);
    },
    [checkpoint, connectionCheck, scheduleSave, setEdges, showToast],
  );

  const onConnectStart: OnConnectStart = useCallback(
    (_event, params) => {
      if (params.nodeId && params.handleId && params.handleType) {
        const edgeIds = new Set(
          edges
            .filter((edge) =>
              params.handleType === "source"
                ? edge.source === params.nodeId &&
                  edge.sourceHandle === params.handleId
                : edge.target === params.nodeId &&
                  edge.targetHandle === params.handleId,
            )
            .map((edge) => edge.id),
        );
        connectionStartRef.current = {
          nodeId: params.nodeId,
          handleId: params.handleId,
          handleType: params.handleType,
          edgeIds,
        };
      } else {
        connectionStartRef.current = null;
      }
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
    [edges, nodes],
  );

  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    const connectionStart = connectionStartRef.current;
    connectionStartRef.current = null;
    setConnectingFrom(null);
    if (!state.fromNode || !state.fromHandle || state.toNode) return;

    if (connectionStart && connectionStart.edgeIds.size > 0) {
      // Releasing a drag from a connected handle on empty canvas is a
      // cancelled connection attempt, not an explicit disconnect action.
      // Deletion remains available through edge selection + Delete.
      setConnectionMenu(null);
      return;
    }

    if (state.fromHandle.type !== "source") return;
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
      if (window.matchMedia("(max-width: 1100px)").matches)
        setMobileInspectorOpen(true);
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
        scheduleSave(next, useCanvasStore.getState().edges);
        return next;
      });
      setSelectedId(node.id);
      setHistoryOpen(false);
    },
    [
      assets,
      checkpoint,
      nodes.length,
      scheduleSave,
      setNodes,
      setSelectedId,
      showToast,
    ],
  );

  const deleteHistoricalAssets = useCallback(
    async (assetIds: string[]) => {
      const result = await deleteAssets(assetIds);
      if (result.deletedIds.length > 0) {
        checkpoint(true);
        const deletedIds = new Set(result.deletedIds);
        const state = useCanvasStore.getState();
        const cleaned = removeDeletedAssetsFromGraph(
          state.nodes,
          state.edges,
          deletedIds,
        );
        setAssets((current) =>
          current.filter((asset) => !deletedIds.has(asset.id)),
        );
        setNodes(cleaned.nodes);
        setEdges(cleaned.edges);
        setSelectedId((current) =>
          current && cleaned.removedNodeIds.has(current) ? null : current,
        );
        setPreviewAsset((current) =>
          current && deletedIds.has(current.id) ? null : current,
        );
        scheduleSave(cleaned.nodes, cleaned.edges);
      }
      if (result.failedIds.length > 0) {
        showToast(
          `${result.failedIds.length} 张历史图片删除失败，请重试`,
          "error",
        );
      } else if (result.deletedIds.length > 0) {
        showToast(`已删除 ${result.deletedIds.length} 张历史图片`, "success");
      }
      return result;
    },
    [checkpoint, scheduleSave, setEdges, setNodes, setSelectedId, showToast],
  );

  const deleteNode = useCallback(
    (ids: string | readonly string[]) => {
      const removedIds = new Set(Array.isArray(ids) ? ids : [ids]);
      if (removedIds.size === 0) return;
      checkpoint(true);
      const state = useCanvasStore.getState();
      const remainingNodes = state.nodes.filter(
        (node) => !removedIds.has(node.id),
      );
      const nextEdges = state.edges.filter(
        (edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target),
      );
      const nextNodes = removeUnavailableAssetMentions(
        remainingNodes,
        nextEdges,
      );
      setNodes(nextNodes);
      setEdges(nextEdges);
      scheduleSave(nextNodes, nextEdges);
      setSelectedId((current) =>
        current && removedIds.has(current) ? null : current,
      );
    },
    [scheduleSave, setEdges, setNodes, setSelectedId, checkpoint],
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
    const copyable = selected
      .map(copyableCanvasNode)
      .filter((node): node is CanvasNode => node !== null);
    if (copyable.length === 0) {
      showToast("未完成的生成结果不能复制，请先核对或删除该结果", "error");
      return false;
    }
    const selectedIds = new Set(copyable.map((node) => node.id));
    const detachedResultIds = new Set(
      selected
        .filter((node) => node.data.generatedResult === true)
        .map((node) => node.id),
    );
    nodeClipboardRef.current = {
      nodes: structuredClone(copyable),
      edges: structuredClone(
        state.edges.filter(
          (edge) =>
            selectedIds.has(edge.source) &&
            selectedIds.has(edge.target) &&
            !detachedResultIds.has(edge.target) &&
            !edge.id.startsWith(GENERATED_RESULT_EDGE_PREFIX),
        ),
      ),
    };
    const fixedCount = detachedResultIds.size;
    showToast(
      fixedCount > 0
        ? `已复制 ${copyable.length} 个节点，生成结果已转为固定素材`
        : `已复制 ${copyable.length} 个节点`,
      "success",
    );
    return true;
  }, [showToast]);

  const pasteCopiedNodes = useCallback((): boolean => {
    const clipboard = nodeClipboardRef.current;
    if (!clipboard || clipboard.nodes.length === 0) return false;
    const state = useCanvasStore.getState();
    const targetNodes = state.nodes.filter((node) => node.selected);
    if (targetNodes.length === 0) {
      showToast("请先选择一个节点作为粘贴位置", "error");
      return false;
    }
    checkpoint(true);
    const copiedBounds = nodeGroupBounds(clipboard.nodes);
    const targetBounds = nodeGroupBounds(targetNodes);
    const pastePosition = closestAvailableVerticalPosition(
      {
        id: "clipboard-target-group",
        ...targetBounds,
      },
      { width: copiedBounds.width, height: copiedBounds.height },
      state.nodes.map((node) => ({
        id: node.id,
        position: node.position,
        ...nodeDimensions(node),
      })),
    );
    const offset = {
      x: pastePosition.x - copiedBounds.position.x,
      y: pastePosition.y - copiedBounds.position.y,
    };
    const idMap = new Map(
      clipboard.nodes.map((node) => [node.id, crypto.randomUUID()] as const),
    );
    const groupIdMap = new Map(
      Array.from(
        new Set(
          clipboard.nodes
            .map((node) => node.data.canvasGroupId)
            .filter((groupId): groupId is string => Boolean(groupId)),
        ),
      ).map((groupId) => [groupId, `canvas-group-${crypto.randomUUID().slice(0, 8)}`] as const),
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
          x: node.position.x + offset.x,
          y: node.position.y + offset.y,
        },
        data: {
          ...node.data,
          ...(generatedFromNodeId ? { generatedFromNodeId } : {}),
          ...(node.data.canvasGroupId
            ? {
                canvasGroupId:
                  groupIdMap.get(node.data.canvasGroupId) ??
                  node.data.canvasGroupId,
              }
            : {}),
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
    void instance.fitView({
      padding: 0.24,
      minZoom: CANVAS_MIN_ZOOM,
      maxZoom: CANVAS_MAX_ZOOM,
      duration: 320,
    });
  }, [showToast]);

  const updateNodeData = useCallback(
    (
      id: string,
      patch: Partial<CanvasNodeData>,
      options?: { persistImmediately?: boolean },
    ) => {
      checkpoint();
      const state = useCanvasStore.getState();
      const next = state.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
      );
      const nextEdges = filterEdgesToKnownPorts(next, state.edges);
      setNodes(next);
      if (nextEdges.length !== state.edges.length) setEdges(nextEdges);
      // Async model discovery can finish after an edge was added. Always pair
      // the node patch with the store's latest edges so that save cannot erase
      // a newer connection through a stale React closure.
      // Explicit connection/model choices also bypass the debounce. They are
      // small, atomic configuration changes and must survive an immediate
      // refresh together with the parameters derived from the chosen model.
      if (options?.persistImmediately && canvasId) {
        const updatedNode = next.find((node) => node.id === id);
        const pendingNodeConfigurations = updatedNode
          ? journalNodeConfiguration(canvasId, updatedNode)
          : undefined;
        void saveGraph(
          canvasId,
          next,
          nextEdges,
          state.viewport,
          state.drawings,
          pendingNodeConfigurations,
        ).catch(() => undefined);
        return;
      }
      scheduleSave(next, nextEdges);
    },
    [canvasId, checkpoint, saveGraph, scheduleSave, setEdges, setNodes],
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
        updateNodeData(
          nodeId,
          {
            provider: "fake",
            connectionId,
            model:
              nodeType === "video-generation"
                ? "fake-video-v1"
                : "fake-image-v1",
            parameters: parametersWithDefaults(
              parameterDescriptorsFor(nodeType, "fake", null),
            ),
          },
          { persistImmediately: true },
        );
        return;
      }
      const connection = connections.find((item) => item.id === connectionId);
      if (!connection) return;
      const configuredModel = modelForConnectionAndNode(
        connection,
        nodeType,
        defaultModelForConnection(connection),
      );
      updateNodeData(
        nodeId,
        {
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
        },
        { persistImmediately: true },
      );
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
        ? modelDescriptorsForConnection(connection).find(
            (model) => model.id === modelId,
          )
        : null;
      const nextModel = listedModel ?? configuredModel;
      const currentModel = connection
        ? modelDescriptorsForConnection(connection).find(
            (model) => model.id === node.data.model,
          )
        : undefined;
      const currentParameters = {
        ...((node.data.parameters as Record<string, unknown> | undefined) ??
          {}),
      };
      const keepsWeAiGroupParameters =
        connection?.provider === "weai" &&
        typeof currentModel?.metadata?.modelGroup === "string" &&
        currentModel.metadata.modelGroup === nextModel?.metadata?.modelGroup;
      if (nodeType === "image-generation" && !keepsWeAiGroupParameters) {
        delete currentParameters.size;
        delete currentParameters.size_tier;
        delete currentParameters.aspect_ratio;
        const qualityDescriptor = nextModel?.parameters?.find(
          (parameter) => parameter.key === "quality",
        );
        const keepsCurrentQuality = qualityDescriptor?.options?.some(
          (option) => String(option.value) === currentParameters.quality,
        );
        if (!keepsCurrentQuality) delete currentParameters.quality;
        delete currentParameters.n;
      }
      updateNodeData(
        nodeId,
        {
          model: modelId,
          inputs: generationInputsForModel(
            nodeType,
            nextModel,
            node.data.inputs,
          ),
          parameters: parametersWithDefaults(
            parameterDescriptorsFor(
              nodeType,
              node.data.provider ?? "fake",
              nextModel,
            ),
            currentParameters,
          ),
        },
        { persistImmediately: true },
      );
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
        if (changed) scheduleSave(next, useCanvasStore.getState().edges);
        return changed ? next : current;
      });
    },
    [scheduleSave, setNodes],
  );

  const applyRunSnapshot = useCallback(
    (snapshot: RunSnapshot, pendingRequestId?: string) => {
      const rejectedConnections = new Set(
        snapshot.nodes.flatMap((node) =>
          node.request?.provider === "weai" &&
          typeof node.request.connectionId === "string" &&
          /Unknown model:/iu.test(node.errorJson?.providerMessage ?? "")
            ? [node.request.connectionId]
            : [],
        ),
      );
      if (rejectedConnections.size > 0) {
        for (const connectionId of rejectedConnections)
          invalidateModelCache(connectionId);
        setModelScanRevision((current) => current + 1);
      }
      setNodeRunStatuses((current) => {
        const next = new Map(current);
        for (const node of snapshot.nodes) {
          const latestAt = latestNodeRunAt.current.get(node.nodeId);
          if (latestAt && latestAt > snapshot.run.createdAt) continue;
          latestNodeRunAt.current.set(node.nodeId, snapshot.run.createdAt);
          next.set(node.nodeId, node.status as NodeRunStatus);
        }
        return next;
      });
      const state = useCanvasStore.getState();
      const normalizedNodes = ensureGeneratedResultInputs(
        ensureGenerationNodeInputs(state.nodes),
      );
      let changed = normalizedNodes !== state.nodes;
      let nextNodes = normalizedNodes.map((node) => {
        const nodeRun = snapshot.nodes.find((item) => item.nodeId === node.id);
        if (!nodeRun?.outputAssetIds.length) return node;
        if (
          node.data.lastOutputCreatedAt &&
          node.data.lastOutputCreatedAt > snapshot.run.createdAt
        ) {
          return node;
        }
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
        if (
          !outputIdsChanged &&
          node.data.assetKind === nextAssetKind &&
          node.data.lastOutputRunId === snapshot.run.id &&
          node.data.lastOutputCreatedAt === snapshot.run.createdAt
        )
          return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            lastOutputAssetIds: nodeRun.outputAssetIds,
            lastOutputRunId: snapshot.run.id,
            lastOutputCreatedAt: snapshot.run.createdAt,
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
        const runRequest = nodeRun.request;
        const sourceConnectionId =
          runRequest?.connectionId ?? source.data.connectionId;
        const sourceConnection = connections.find(
          (connection) => connection.id === sourceConnectionId,
        );
        const sourceProvider = runRequest?.provider ?? source.data.provider;
        const sourceSupplier =
          runRequest?.supplier ??
          (sourceConnection
            ? providerConnectionSupplierKey(sourceConnection)
            : undefined);
        const provenance = {
          generatedProvider: sourceProvider,
          generatedSupplier: sourceSupplier,
          generatedConnectionId: sourceConnectionId,
          generatedConnectionName:
            runRequest?.connectionName ?? sourceConnection?.name,
          generatedGroup:
            runRequest?.modelGroup ??
            (sourceConnection
              ? providerConnectionGroup(sourceConnection)
              : undefined),
          generatedModel: runRequest?.model,
          generatedParameters: runRequest?.parameters
            ? structuredClone(runRequest.parameters)
            : undefined,
          generatedCreatedAt: snapshot.run.createdAt,
          generatedRecoveryAction: nodeRun.recoveryAction,
        };
        const serializedProvenanceParameters = JSON.stringify(
          provenance.generatedParameters ?? null,
        );
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
            : generatedOutputCount(
                source,
                nodeRun.outputAssetIds.length,
                runRequest?.parameters?.n,
              );
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
            typeof sourceProvider === "string" ? sourceProvider : undefined,
            sourceSupplier,
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
              node.data.generatedProvider === provenance.generatedProvider &&
              node.data.generatedSupplier === provenance.generatedSupplier &&
              node.data.generatedConnectionId ===
                provenance.generatedConnectionId &&
              node.data.generatedConnectionName ===
                provenance.generatedConnectionName &&
              node.data.generatedGroup === provenance.generatedGroup &&
              node.data.generatedModel === provenance.generatedModel &&
              JSON.stringify(node.data.generatedParameters ?? null) ===
                serializedProvenanceParameters &&
              node.data.generatedCreatedAt === provenance.generatedCreatedAt &&
              node.data.generatedRecoveryAction ===
                provenance.generatedRecoveryAction &&
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
                ...provenance,
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
              const addition = createGeneratedResultNode(
                source,
                snapshot.run.id,
                kind,
                outputIndex,
                slotStatus,
                assetId,
                error,
                [...nextNodes, ...additions],
                generationPromptParts(source, nextNodes, state.edges),
              );
              addition.data = { ...addition.data, ...provenance };
              additions.push(addition);
              changed = true;
            }
          }

          if (assetId && !materialized.has(assetId)) {
            materialized.add(assetId);
            materializedChanged = true;
            changed = true;
          }
        }
        if (
          status === "succeeded" &&
          nodeRun.outputAssetIds.length > 0 &&
          outputCount > nodeRun.outputAssetIds.length
        ) {
          const trimmed = removeUnreturnedGeneratedResults(
            nextNodes,
            additions,
            source.id,
            snapshot.run.id,
            pendingRequestId,
            nodeRun.outputAssetIds.length,
          );
          if (
            trimmed.nodes.length !== nextNodes.length ||
            trimmed.additions.length !== additions.length
          ) {
            nextNodes = trimmed.nodes;
            additions.splice(0, additions.length, ...trimmed.additions);
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
      const nextEdges = filterEdgesToKnownPorts(
        nextNodes,
        syncGeneratedResultEdges(nextNodes, state.edges),
      );
      if (nextEdges !== state.edges) changed = true;
      if (!changed) return;
      useCanvasStore.setState({ nodes: nextNodes, edges: nextEdges });
      graphRef.current = { nodes: nextNodes, edges: nextEdges };
      scheduleSave(nextNodes, nextEdges, state.viewport);
    },
    [connections, scheduleSave],
  );

  const stopRunSubscription = useCallback((runId?: string) => {
    if (runId) {
      eventSources.current.get(runId)?.close();
      eventSources.current.delete(runId);
      const submissionKey = runSubmissionKeys.current.get(runId);
      if (submissionKey) {
        runSubmissionKeys.current.delete(runId);
        activeRunKeys.current.delete(submissionKey);
        activeRunSources.current.delete(submissionKey);
      }
    } else {
      for (const stream of eventSources.current.values()) stream.close();
      eventSources.current.clear();
      for (const submissionKey of runSubmissionKeys.current.values()) {
        activeRunKeys.current.delete(submissionKey);
        activeRunSources.current.delete(submissionKey);
      }
      runSubmissionKeys.current.clear();
    }
    setBusy(activeRunKeys.current.size > 0 || eventSources.current.size > 0);
  }, []);

  const subscribeToRun = useCallback(
    (runId: string, submissionKey?: string) => {
      stopRunSubscription(runId);
      setBusy(true);
      const stream = new EventSource(
        `/api/runs/${encodeURIComponent(runId)}/events`,
      );
      eventSources.current.set(runId, stream);
      if (submissionKey) runSubmissionKeys.current.set(runId, submissionKey);
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
      const stateBeforeFetch = useCanvasStore.getState();
      const visibleRunIdsBeforeFetch = stateBeforeFetch.nodes.flatMap((node) =>
        node.data.generatedResult === true &&
        typeof node.data.generatedFromRunId === "string"
          ? [node.data.generatedFromRunId]
          : [],
      );
      const visibleRequestIdsBeforeFetch = stateBeforeFetch.nodes.flatMap(
        (node) => {
          if (
            node.data.generatedResult !== true ||
            !isPendingGeneratedResultStatus(node.data.generatedStatus) ||
            typeof node.data.generatedPendingRequestId !== "string"
          )
            return [];
          return [node.data.generatedPendingRequestId];
        },
      );
      const submittingAtFetchStart = new Set(submittingRequestIds.current);
      // An empty graph has no run state to reconcile. Calling `/api/runs`
      // without identifiers falls back to the complete run history, which can
      // be very large and used to make a fresh canvas look frozen on startup.
      if (
        visibleRunIdsBeforeFetch.length === 0 &&
        visibleRequestIdsBeforeFetch.length === 0 &&
        eventSources.current.size === 0
      ) {
        reconciling = false;
        reconcileAgain = false;
        return;
      }
      void fetchVisibleRuns(
        canvasId,
        visibleRunIdsBeforeFetch,
        visibleRequestIdsBeforeFetch,
      )
        .then((runs) => {
          if (cancelled) return;
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
              isPendingGeneratedResultStatus(node.data.generatedStatus) &&
              typeof node.data.generatedPendingRequestId === "string"
                ? [node.data.generatedPendingRequestId]
                : [],
            ),
          );
          const visibleSnapshots = runs.filter(
            (snapshot) =>
              visibleRunIds.has(snapshot.run.id) ||
              visibleRequestIds.has(snapshot.run.clientRequestId ?? ""),
          );
          const matchedRequestIds = new Set(
            runs.flatMap((snapshot) =>
              typeof snapshot.run.clientRequestId === "string"
                ? [snapshot.run.clientRequestId]
                : [],
            ),
          );
          const orphanedRequestIds = new Set(
            [...visibleRequestIds].filter((requestId) => {
              const pendingNode = state.nodes.find(
                (node) =>
                  node.data.generatedResult === true &&
                  node.data.generatedPendingRequestId === requestId,
              );
              return shouldMarkPendingRunMissing({
                requestId,
                generatedCreatedAt: pendingNode?.data.generatedCreatedAt,
                matchedRequestIds,
                submittingAtFetchStart,
                submittingNow: submittingRequestIds.current,
              });
            }),
          );
          if (orphanedRequestIds.size > 0) {
            let orphanedChanged = false;
            const recoveredNodes = state.nodes.map((node) => {
              const requestId = node.data.generatedPendingRequestId;
              if (
                typeof requestId !== "string" ||
                !orphanedRequestIds.has(requestId)
              ) {
                return node;
              }
              orphanedChanged = true;
              return {
                ...node,
                data: {
                  ...node.data,
                  generatedStatus: "failed" as const,
                  // A missing local submission is terminal. Keeping the
                  // request id makes the five-second reconciliation loop
                  // treat the same failed placeholder as pending forever and
                  // schedule an identical autosave on every pass.
                  generatedPendingRequestId: undefined,
                  generatedError: {
                    message:
                      "本地没有找到对应运行，任务未提交到供应商，不会继续生成或扣费。可以点击再次运行。",
                    type: "local_submission_missing",
                    code: "LOCAL_RUN_NOT_CREATED",
                  },
                },
              };
            });
            if (orphanedChanged) {
              const recoveredEdges = syncGeneratedResultEdges(
                recoveredNodes,
                state.edges,
              );
              useCanvasStore.setState({
                nodes: recoveredNodes,
                edges: recoveredEdges,
              });
              graphRef.current = {
                nodes: recoveredNodes,
                edges: recoveredEdges,
              };
              scheduleSave(recoveredNodes, recoveredEdges, state.viewport);
            }
          }
          // Only reconcile runs that already have a materialized result or a
          // live placeholder in this graph. Historical runs are kept in the
          // history modal; materializing the newest historical run here would
          // resurrect stale results after a reset or a concurrent edit.
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
              isPendingGeneratedResultStatus(node.data.generatedStatus) &&
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
  }, [
    applyRunSnapshot,
    canvasId,
    scheduleSave,
    stopRunSubscription,
    subscribeToRun,
  ]);

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
      const cyberScans = new Map<string, Promise<ModelDescriptor[]>>();
      for (const node of candidates) {
        let freshlyScannedModels: ModelDescriptor[] | null = null;
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
          if (connection.config.preset === "cyberafei-api") {
            let scan = cyberScans.get(connection.id);
            if (!scan) {
              scan = fetchModels(connection.id);
              cyberScans.set(connection.id, scan);
            }
            try {
              freshlyScannedModels = await scan;
            } catch (error) {
              return `${node.data.label}：赛博阿飞分组模型扫描失败，已停止本次付费提交（${
                error instanceof Error ? error.message : "请稍后重试"
              }）`;
            }
            if (freshlyScannedModels.length === 0)
              return `${node.data.label}：当前赛博阿飞分组 Key 未扫描到可运行模型，已停止本次付费提交`;
            if (
              typeof node.data.model === "string" &&
              node.data.model.trim() &&
              !freshlyScannedModels.some(
                (model) => model.id === node.data.model,
              )
            )
              return `${node.data.label}：模型 ${node.data.model} 不在当前分组 Key 的最新扫描结果中，已停止本次付费提交`;
          }
        }
        const options =
          freshlyScannedModels ??
          modelOptionsForNode(node, connections, connectionModels);
        const model =
          modelDescriptorForSavedSelectionOrDefault(
            options,
            node.data.model,
            node.data.parameters as
              Readonly<Record<string, unknown>> | undefined,
          ) ?? null;
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
      };
      const currentState = useCanvasStore.getState();
      const sourceIds = new Set(
        generationNodesForRun(
          currentState.nodes,
          currentState.edges,
          nodeId,
          scope,
        ).map((source) => source.id),
      );
      const pendingReferences = pendingAssetReferencesForRun(
        currentState.nodes,
        currentState.edges,
        nodeId,
        scope,
      );
      if (pendingReferences.length > 0) {
        showToast("参考素材仍在导入，请等待素材导入完成后再运行");
        return;
      }
      const submissionKey = runRequestKey(runRequest);
      const overlapsActiveSubmission = [
        ...activeRunSources.current.values(),
      ].some((activeSources) =>
        [...sourceIds].some((sourceId) => activeSources.has(sourceId)),
      );
      const hasVisibleActiveRun = currentState.nodes.some(
        (node) =>
          node.data.generatedResult === true &&
          typeof node.data.generatedFromNodeId === "string" &&
          sourceIds.has(node.data.generatedFromNodeId) &&
          [
            "blocked",
            "queued",
            "submitting",
            "running",
            "archiving",
            "cancel_requested",
          ].includes(String(node.data.generatedStatus)),
      );
      if (
        activeRunKeys.current.has(submissionKey) ||
        overlapsActiveSubmission ||
        hasVisibleActiveRun
      ) {
        showToast("这个生成节点已有任务在运行，请等待完成后再提交");
        return;
      }
      const unresolvedCount = currentState.nodes.filter(
        (node) =>
          node.data.generatedResult === true &&
          node.data.generatedStatus === "needs_attention" &&
          typeof node.data.generatedFromNodeId === "string" &&
          sourceIds.has(node.data.generatedFromNodeId),
      ).length;
      if (
        unresolvedCount > 0 &&
        !window.confirm(
          `当前范围还有 ${unresolvedCount} 个“提交结果未知”的付费任务，供应商可能已经接单或扣费。\n\n请先在供应商后台核对。只有确认不需要追回这些任务时，才继续创建新的付费运行。\n\n确认已经核对并继续吗？`,
        )
      ) {
        showToast("已取消提交，请先核对供应商任务与扣费记录");
        return;
      }
      activeRunKeys.current.add(submissionKey);
      activeRunSources.current.set(submissionKey, sourceIds);
      setBusy(true);
      let holdSubmissionUntilTerminal = false;
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
        submittingRequestIds.current.add(requestId);
        let submissionAttempted = false;
        try {
          if (saveTimer.current) {
            clearTimeout(saveTimer.current);
            saveTimer.current = null;
          }
          pendingSave.current = null;
          const state = useCanvasStore.getState();
          const normalizedNodes = state.nodes.map((node) =>
            sourceIds.has(node.id)
              ? normalizeGenerationNodeForRun(
                  node,
                  connections,
                  connectionModels,
                )
              : node,
          );
          const normalizedEdges = filterEdgesToKnownPorts(
            normalizedNodes,
            state.edges,
          );
          const savePromise = saveRequest(
            {
              canvasId,
              graph: serializableGraph(
                normalizedNodes,
                normalizedEdges,
                state.viewport,
                state.drawings,
              ),
              title: state.title,
            },
            false,
          );
          const pendingNodes = createPendingGeneratedResults(
            normalizedNodes,
            normalizedEdges,
            nodeId,
            scope,
            requestId,
            retryResultNodeId,
          );
          const pendingEdges = syncGeneratedResultEdges(
            pendingNodes,
            normalizedEdges,
          );
          if (pendingNodes !== state.nodes || pendingEdges !== state.edges) {
            useCanvasStore.setState({
              nodes: pendingNodes,
              edges: pendingEdges,
            });
            graphRef.current = { nodes: pendingNodes, edges: pendingEdges };
          }
          await savePromise;
          submissionAttempted = true;
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
            subscribeToRun(snapshot.run.id, submissionKey);
            holdSubmissionUntilTerminal = true;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "运行失败";
          const submissionUnknown =
            submissionAttempted &&
            (error instanceof TypeError ||
              (error instanceof DOMException && error.name === "AbortError"));
          const state = useCanvasStore.getState();
          let pendingChanged = false;
          const failedNodes = state.nodes.map((node) => {
            if (node.data.generatedPendingRequestId !== requestId) return node;
            pendingChanged = true;
            return {
              ...node,
              data: {
                ...node.data,
                generatedStatus: submissionUnknown
                  ? ("needs_attention" as const)
                  : ("failed" as const),
                generatedError: submissionUnknown
                  ? {
                      message:
                        "提交运行时连接中断，无法确认服务端是否已创建任务。请先在运行记录或供应商后台核对，避免重复扣费。",
                      type: "network_connection_error",
                      code: "SUBMISSION_RESULT_UNKNOWN",
                      providerMessage: message,
                    }
                  : message,
                ...(submissionUnknown
                  ? {}
                  : { generatedPendingRequestId: undefined }),
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
          showToast(
            submissionUnknown
              ? "提交结果未知，请先核对运行记录，暂勿重复生成"
              : message,
          );
        } finally {
          submittingRequestIds.current.delete(requestId);
        }
      } finally {
        if (!holdSubmissionUntilTerminal) {
          activeRunKeys.current.delete(submissionKey);
          activeRunSources.current.delete(submissionKey);
        }
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
      saveRequest,
      scheduleSave,
      validateRunMediaInputs,
      connectionModels,
      connections,
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
    if (initialization.status !== "ready") return;
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
          '[role="dialog"]:not(.node-config-popover), .connection-menu, .canvas-create-menu, .project-menu, .project-context-menu',
        ),
      );
      const interactiveControl = Boolean(
        target?.closest(
          "button, a, [role='menuitem'], .project-menu-backdrop, .project-context-menu-backdrop, .mobile-backdrop",
        ),
      );
      const shortcutAllowed = isCanvasShortcutAllowed({
        selectedId,
        editing,
        inPromptEditor,
        modalOpen,
        interactiveControl,
      });
      const plainHelpKey =
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        (event.key === "?" ||
          (event.key === "/" && event.shiftKey) ||
          event.key === "F1");
      // The help dialog is the only modal that may handle its own plain-key
      // shortcut. Other dialogs keep exclusive keyboard focus.
      if (plainHelpKey && !editing && (!modalOpen || shortcutsOpen)) {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }

      // Plain-key canvas shortcuts must never fire while typing or in a dialog.
      // A focused button is fine: digits and "F" are not activation keys, and
      // clicking any node control would otherwise disable these shortcuts.
      const bareKeyAllowed =
        !editing &&
        !modalOpen &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey;

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
        const state = useCanvasStore.getState();
        const selectedEdges = state.edges.filter((edge) => edge.selected);
        if (selectedEdges.length > 0) {
          event.preventDefault();
          checkpoint(true);
          const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
          const nextEdges = state.edges.filter(
            (edge) => !selectedEdgeIds.has(edge.id),
          );
          const nextNodes = removeUnavailableAssetMentions(
            state.nodes,
            nextEdges,
          );
          setNodes(nextNodes);
          setEdges(nextEdges);
          scheduleSave(nextNodes, nextEdges);
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
      if (key === "g" && !editing && !modalOpen && !interactiveControl) {
        event.preventDefault();
        const state = useCanvasStore.getState();
        const selected = state.nodes.filter((node) => node.selected);
        const groupId = selected[0]?.data.canvasGroupId;
        const fullGroupSelected = Boolean(
          groupId &&
            selected.every((node) => node.data.canvasGroupId === groupId) &&
            state.nodes.filter((node) => node.data.canvasGroupId === groupId)
              .length === selected.length,
        );
        if (event.shiftKey) ungroupSelectedNodesRef.current?.();
        else if (fullGroupSelected) showToast("所选节点已经在同一分组中");
        else groupSelectedNodesRef.current?.();
        return;
      }
      const historyShortcutAllowed = isCanvasHistoryShortcutAllowed({
        editing,
        modalOpen,
        interactiveControl,
      });
      const duplicateShortcutAllowed =
        !editing &&
        !inPromptEditor &&
        !modalOpen &&
        !interactiveControl &&
        Boolean(useCanvasStore.getState().selectedId);
      if (key === "d" && duplicateShortcutAllowed) {
        // Overrides the browser bookmark shortcut only when a node is selected.
        if (duplicateSelectedNodes()) event.preventDefault();
        return;
      }
      if (key === "s" && !editing && !modalOpen) {
        event.preventDefault();
        void saveNow()
          .then(() => showToast("画布已保存", "success"))
          .catch(() => undefined);
        return;
      }
      if (key === "a" && !editing && !modalOpen && !interactiveControl) {
        if (selectAllNodes()) event.preventDefault();
        return;
      }
      if (
        (key === "/" || key === "?") &&
        !editing &&
        (!modalOpen || shortcutsOpen)
      ) {
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
    checkpoint,
    deleteNode,
    deleteSelectedDrawings,
    duplicateSelectedNodes,
    fitViewToCanvas,
    initialization.status,
    nodes,
    redo,
    runNode,
    saveNow,
    scheduleSave,
    selectAllNodes,
    selectedDrawingIds,
    selectedId,
    shortcutsOpen,
    setEdges,
    setNodes,
    showToast,
    undo,
  ]);

  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData) return;
      const target =
        event.target instanceof Element ? (event.target as HTMLElement) : null;
      const editing = Boolean(
        target?.closest("input, textarea, select, [contenteditable='true']"),
      );
      const modalOpen = Boolean(
        document.querySelector(
          '[role="dialog"]:not(.node-config-popover), .connection-menu, .canvas-create-menu, .project-menu, .project-context-menu',
        ),
      );
      const interactiveControl = Boolean(
        target?.closest(
          "button, a, [role='menuitem'], .project-menu-backdrop, .project-context-menu-backdrop, .mobile-backdrop",
        ),
      );
      if (editing || modalOpen || interactiveControl) return;
      if (hasSelectedBrowserText(window.getSelection())) return;
      if (!copySelectedNodes()) return;
      event.clipboardData.setData(NODE_CLIPBOARD_TYPE, "1");
      event.preventDefault();
    };
    window.addEventListener("copy", handler, true);
    return () => window.removeEventListener("copy", handler, true);
  }, [copySelectedNodes]);

  const selectCanvasNode = useCallback((nodeId: string, additive = false) => {
    let selectionRemains = false;
    useCanvasStore.setState((state) => {
      const target = state.nodes.find((node) => node.id === nodeId);
      if (!target) return {};

      if (!additive) {
        let changed = state.selectedId !== nodeId;
        const nextNodes = state.nodes.map((node) => {
          const selected = node.id === nodeId;
          if (node.selected === selected) return node;
          changed = true;
          return { ...node, selected };
        });
        selectionRemains = true;
        // Pointer events from controls inside a selected node must not publish
        // the same selection again. Doing so re-renders the React Flow node
        // between pointerdown and click, which closes native select popups and
        // makes the model panel appear to flicker.
        return changed ? { nodes: nextNodes, selectedId: nodeId } : state;
      }

      const willSelect = target.selected !== true;
      const nextNodes = state.nodes.map((node) =>
        node.id === nodeId ? { ...node, selected: willSelect } : node,
      );
      let fallbackId: string | null = null;
      for (let index = nextNodes.length - 1; index >= 0; index -= 1) {
        if (!nextNodes[index]?.selected) continue;
        fallbackId = nextNodes[index]!.id;
        break;
      }
      const currentPrimaryStillSelected = nextNodes.some(
        (node) => node.id === state.selectedId && node.selected,
      );
      const nextSelectedId = willSelect
        ? nodeId
        : currentPrimaryStillSelected
          ? state.selectedId
          : fallbackId;
      selectionRemains = nextSelectedId !== null;
      return { nodes: nextNodes, selectedId: nextSelectedId };
    });
    if (window.matchMedia("(max-width: 1100px)").matches) {
      setMobileInspectorOpen(selectionRemains);
    }
  }, []);

  const selectedCanvasNodes = useMemo(
    () => nodes.filter((node) => node.selected),
    [nodes],
  );
  const canvasGroups = useMemo(() => {
    const grouped = new Map<string, CanvasNode[]>();
    for (const node of nodes) {
      const groupId = node.data.canvasGroupId;
      if (!groupId) continue;
      const members = grouped.get(groupId) ?? [];
      members.push(node);
      grouped.set(groupId, members);
    }
    return Array.from(grouped, ([id, members]) => {
      const bounds = nodeGroupBounds(members);
      const padding = 26;
      return {
        id,
        label: members[0]?.data.canvasGroupLabel ?? "节点组",
        color: members[0]?.data.canvasGroupColor ?? "#9b8cff",
        count: members.length,
        position: {
          x: bounds.position.x - padding,
          y: bounds.position.y - padding - 26,
        },
        width: bounds.width + padding * 2,
        height: bounds.height + padding * 2 + 26,
      };
    });
  }, [nodes]);
  const selectedHasGroup = selectedCanvasNodes.some(
    (node) => Boolean(node.data.canvasGroupId),
  );
  const displayedEdges = useMemo(() => {
    if (selectedCanvasNodes.length === 0) return edges;
    const selectedNodeIds = new Set(selectedCanvasNodes.map((node) => node.id));
    return edges.map((edge) =>
      selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)
        ? {
            ...edge,
            className: [edge.className, "edge-connected-to-selection"]
              .filter(Boolean)
              .join(" "),
          }
        : edge,
    );
  }, [edges, selectedCanvasNodes]);
  const selectionToolbarAnchorId =
    selectedCanvasNodes.length >= 2
      ? selectedCanvasNodes.some((node) => node.id === selectedId)
        ? selectedId
        : (selectedCanvasNodes.at(-1)?.id ?? null)
      : null;

  const alignSelectedNodes = useCallback(
    (action: NodeAlignmentAction) => {
      const state = useCanvasStore.getState();
      const selected = state.nodes.filter((node) => node.selected);
      if (selected.length < 2) return;
      if (
        (action === "distribute-x" || action === "distribute-y") &&
        selected.length < 3
      )
        return;

      checkpoint(true);
      const positions = alignedCanvasRectPositions(
        selected.map((node) => ({
          id: node.id,
          position: node.position,
          ...nodeDimensions(node),
        })),
        action,
      );
      const nextNodes = state.nodes.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
      });
      useCanvasStore.setState({ nodes: nextNodes });
      graphRef.current = { nodes: nextNodes, edges: state.edges };
      scheduleSave(nextNodes, state.edges, state.viewport);
      const labels: Record<NodeAlignmentAction, string> = {
        left: "左对齐",
        "center-x": "水平居中",
        right: "右对齐",
        top: "上对齐",
        "center-y": "垂直居中",
        bottom: "下对齐",
        "distribute-x": "水平等距分布",
        "distribute-y": "垂直等距分布",
      };
      showToast(`已${labels[action]} ${selected.length} 个节点`, "success");
    },
    [checkpoint, scheduleSave, showToast],
  );

  const groupSelectedNodes = useCallback(() => {
    const state = useCanvasStore.getState();
    const selected = state.nodes.filter((node) => node.selected);
    if (selected.length < 2) {
      showToast("至少选择两个节点才能打组");
      return;
    }
    const existingLabels = new Set(
      state.nodes
        .map((node) => node.data.canvasGroupLabel)
        .filter((label): label is string => Boolean(label)),
    );
    let groupNumber = existingLabels.size + 1;
    while (existingLabels.has(`分组 ${groupNumber}`)) groupNumber += 1;
    const colors = ["#9b8cff", "#5de2c2", "#74b8ff", "#f2c66d", "#ff7f98"];
    const groupId = `canvas-group-${crypto.randomUUID().slice(0, 8)}`;
    const groupLabel = `分组 ${groupNumber}`;
    const groupColor = colors[(groupNumber - 1) % colors.length] ?? colors[0];
    const selectedIds = new Set(selected.map((node) => node.id));
    const nextNodes = state.nodes.map((node) =>
      selectedIds.has(node.id)
        ? {
            ...node,
            data: { ...node.data, canvasGroupId: groupId, canvasGroupLabel: groupLabel, canvasGroupColor: groupColor },
          }
        : node,
    );
    checkpoint(true);
    setNodes(nextNodes);
    graphRef.current = { nodes: nextNodes, edges: state.edges };
    scheduleSave(nextNodes, state.edges, state.viewport);
    showToast(`已将 ${selected.length} 个节点放入${groupLabel}`, "success");
  }, [checkpoint, scheduleSave, setNodes, showToast]);

  const ungroupSelectedNodes = useCallback(() => {
    const state = useCanvasStore.getState();
    const groupIds = new Set(
      state.nodes
        .filter((node) => node.selected && node.data.canvasGroupId)
        .map((node) => node.data.canvasGroupId),
    );
    if (groupIds.size === 0) {
      showToast("请选择一个已打组的节点");
      return;
    }
    const nextNodes = state.nodes.map((node) => {
      if (!node.data.canvasGroupId || !groupIds.has(node.data.canvasGroupId))
        return node;
      const nextData = { ...node.data };
      delete nextData.canvasGroupId;
      delete nextData.canvasGroupLabel;
      delete nextData.canvasGroupColor;
      return { ...node, data: nextData };
    });
    checkpoint(true);
    setNodes(nextNodes);
    graphRef.current = { nodes: nextNodes, edges: state.edges };
    scheduleSave(nextNodes, state.edges, state.viewport);
    showToast(`已解组 ${groupIds.size} 个节点组`, "success");
  }, [checkpoint, scheduleSave, setNodes, showToast]);

  const selectCanvasGroup = useCallback(
    (groupId: string) => {
      const state = useCanvasStore.getState();
      const members = state.nodes.filter(
        (node) => node.data.canvasGroupId === groupId,
      );
      if (members.length === 0) return;
      const selectedId = members.at(-1)?.id ?? null;
      useCanvasStore.setState({
        selectedId,
        nodes: state.nodes.map((node) => ({
          ...node,
          selected: node.data.canvasGroupId === groupId,
        })),
      });
      if (window.matchMedia("(max-width: 1100px)").matches)
        setMobileInspectorOpen(true);
    },
    [],
  );
  useEffect(() => {
    groupSelectedNodesRef.current = groupSelectedNodes;
    ungroupSelectedNodesRef.current = ungroupSelectedNodes;
  }, [groupSelectedNodes, ungroupSelectedNodes]);

  const tidyCanvasLayout = useCallback(() => {
    const state = useCanvasStore.getState();
    if (state.nodes.length < 2) {
      showToast("至少需要两个节点才能整理");
      return;
    }
    const layoutNodes = state.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      ...nodeDimensions(node),
      ...(node.data.generatedResult === true &&
      typeof node.data.generatedFromNodeId === "string"
        ? { generatedFromNodeId: node.data.generatedFromNodeId }
        : {}),
      ...(node.data.canvasGroupId
        ? { canvasGroupId: node.data.canvasGroupId }
        : {}),
    }));
    const layoutEdges = state.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    }));
    const direction = preferredCanvasLayoutDirection(layoutNodes, layoutEdges);
    const positions = tidyCanvasRectPositions(
      layoutNodes,
      layoutEdges,
      direction,
      { layerGap: 104, nodeGap: 44, resultGap: 28, resultGridGap: 16, componentGap: 96, maxComponentColumns: 4 },
    );
    let changed = false;
    const nextNodes = state.nodes.map((node) => {
      const position = positions.get(node.id);
      if (
        !position ||
        (Math.abs(position.x - node.position.x) < 0.5 &&
          Math.abs(position.y - node.position.y) < 0.5)
      )
        return node;
      changed = true;
      return { ...node, position };
    });
    if (!changed) {
      showToast("画布已经很整齐了");
      return;
    }

    checkpoint(true);
    useCanvasStore.setState({ nodes: nextNodes });
    graphRef.current = { nodes: nextNodes, edges: state.edges };
    scheduleSave(nextNodes, state.edges, state.viewport);
    window.requestAnimationFrame(() => {
      void reactFlowRef.current?.fitView({
        padding: 0.18,
        minZoom: CANVAS_MIN_ZOOM,
        maxZoom: CANVAS_MAX_ZOOM,
        duration: 320,
      });
    });
    showToast(
      `已按关联分组并${direction === "horizontal" ? "横向" : "纵向"}整理 ${nextNodes.length} 个节点`,
      "success",
    );
  }, [checkpoint, scheduleSave, showToast]);

  const applyDirectorPreviewPatch = useCallback(
    (patch: DirectorGraphPatch | null) => {
      const state = useCanvasStore.getState();
      const previousIds = directorPreviewNodeIdsRef.current;
      const baseNodes = state.nodes.filter((node) => !previousIds.has(node.id));
      const baseNodeIds = new Set(baseNodes.map((node) => node.id));
      const baseEdges = state.edges.filter(
        (edge) => baseNodeIds.has(edge.source) && baseNodeIds.has(edge.target),
      );

      if (!patch) {
        directorPreviewNodeIdsRef.current = new Set();
        useCanvasStore.setState({ nodes: baseNodes, edges: baseEdges });
        graphRef.current = { nodes: baseNodes, edges: baseEdges };
        return;
      }

      const previewNodes = patch.nodes.map((node): CanvasNode => ({
        ...(node as unknown as CanvasNode),
        type: "workflow",
        draggable: false,
        selectable: false,
        deletable: false,
        connectable: false,
        data: {
          ...(node.data as CanvasNodeData),
          directorDraft: true,
        },
      }));
      const previewEdges = patch.edges.map((edge): CanvasEdge => ({
        ...(edge as unknown as CanvasEdge),
        animated: true,
        selectable: false,
        style: {
          stroke: "rgba(69, 200, 173, 0.72)",
          strokeDasharray: "7 6",
        },
      }));
      directorPreviewNodeIdsRef.current = new Set(
        previewNodes.map((node) => node.id),
      );
      const nextNodes = [...baseNodes, ...previewNodes];
      const nextEdges = [...baseEdges, ...previewEdges];
      useCanvasStore.setState({ nodes: nextNodes, edges: nextEdges });
      graphRef.current = { nodes: nextNodes, edges: nextEdges };
    },
    [],
  );

  const applyDirectorApproval = useCallback(
    async (result: DirectorApproveResult) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pendingSave.current = null;
      directorPreviewNodeIdsRef.current = new Set();

      const document = result.canvas.graph as unknown as CanvasDocument;
      const approvedNodes = ensureGeneratedResultInputs(
        ensureGenerationNodeInputs(
          document.nodes.map((node) => ({
            ...node,
            type: "workflow" as const,
            data: { ...node.data, directorDraft: false },
          })),
        ),
      );
      const approvedEdges = filterEdgesToKnownPorts(
        approvedNodes,
        keepLatestEdgePerNodePair(document.edges),
      );
      const approvedViewport =
        document.viewport ?? useCanvasStore.getState().viewport;
      canvasRevision.current = result.canvas.revision;
      setCanvasRevisionValue(result.canvas.revision);
      saveConflictRef.current = null;
      conflictedSave.current = null;
      setSaveConflict(null);
      setSaveConflictOpen(false);
      setSaveState("saved");
      useCanvasStore.setState({
        title: result.canvas.title,
        nodes: approvedNodes,
        edges: approvedEdges,
        drawings: document.drawings ?? [],
        viewport: approvedViewport,
        selectedId: null,
      });
      graphRef.current = { nodes: approvedNodes, edges: approvedEdges };

      const snapshot = result.run as RunSnapshot | null;
      if (!snapshot?.run?.id) return;
      applyRunSnapshot(snapshot, snapshot.run.clientRequestId);
      if (terminalRunStatuses.has(snapshot.run.status)) {
        await refreshAssets();
      } else {
        subscribeToRun(snapshot.run.id);
      }
    },
    [applyRunSnapshot, refreshAssets, subscribeToRun],
  );

  const renderedNodes = useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
    const assetById = new Map(
      assets.map((asset) => [asset.id, asset] as const),
    );
    const incomingEdges = new Map<string, CanvasEdge[]>();
    for (const edge of edges) {
      const incoming = incomingEdges.get(edge.target);
      if (incoming) incoming.push(edge);
      else incomingEdges.set(edge.target, [edge]);
    }
    const directAssetsForNode = (nodeId: string) => {
      const seen = new Set<string>();
      const linked: AssetView[] = [];
      for (const edge of incomingEdges.get(nodeId) ?? []) {
        const source = nodeById.get(edge.source);
        if (!source) continue;
        const ids = [
          ...(typeof source.data.assetId === "string"
            ? [source.data.assetId]
            : []),
          ...(source.data.lastOutputAssetIds ?? []),
        ];
        for (const id of ids) {
          if (seen.has(id)) continue;
          const asset = assetById.get(id);
          if (!asset || asset.kind === "text") continue;
          seen.add(id);
          linked.push(asset);
        }
      }
      return linked;
    };
    const mentionAssetsForNode = (nodeId: string) => {
      const upstream = new Set<string>();
      const queue = [nodeId];
      while (queue.length > 0) {
        const target = queue.shift();
        if (!target) continue;
        for (const edge of incomingEdges.get(target) ?? []) {
          if (upstream.has(edge.source)) continue;
          upstream.add(edge.source);
          queue.push(edge.source);
        }
      }
      const assetIds = new Set<string>();
      for (const upstreamId of upstream) {
        const data = nodeById.get(upstreamId)?.data;
        if (!data) continue;
        if (typeof data.assetId === "string") assetIds.add(data.assetId);
        for (const assetId of data.lastOutputAssetIds ?? [])
          assetIds.add(assetId);
        for (const part of data.parts ?? []) {
          if (part.type === "asset") assetIds.add(part.assetId);
        }
      }
      return assets.filter((asset) => assetIds.has(asset.id));
    };

    return nodes.map((node): CanvasNode => {
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
        modelDescriptorForSavedSelectionOrDefault(
          modelOptions,
          node.data.model,
          node.data.parameters as Readonly<Record<string, unknown>> | undefined,
        ) ?? null;
      const linkedAssets = generationType ? directAssetsForNode(node.id) : [];
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
                  const source = node.data.generatedFromNodeId
                    ? nodeById.get(node.data.generatedFromNodeId)
                    : undefined;
                  return source
                    ? generationPromptParts(source, nodes, edges)
                    : [];
                })(),
              {
                resolveAsset: (assetId) => {
                  const asset = assetById.get(assetId);
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
          mentionAssets: mentionAssetsForNode(node.id),
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
          modelOptionsAuthoritative: Boolean(
            generationType &&
            ((connectionModels.connectionId === node.data.connectionId &&
              connectionModels.authoritative) ||
              connections.some(
                (connection) =>
                  connection.id === node.data.connectionId &&
                  connectionRequiresAuthoritativeModelScan(connection),
              )),
          ),
          modelOptionsLoading: Boolean(
            generationType &&
            connections.some(
              (connection) =>
                connection.id === node.data.connectionId &&
                connectionRequiresAuthoritativeModelScan(connection) &&
                !(
                  connection.provider === "weai" &&
                  weAiCanvasModelDescriptorsFromSavedScan(connection.config) !==
                    null
                ),
            ) &&
            (connectionModels.connectionId !== node.data.connectionId ||
              connectionModels.loading),
          ),
          modelOptionsError: Boolean(
            generationType &&
            modelLoadError?.connectionId === node.data.connectionId &&
            !connectionModels.loading,
          ),
          generatedPromptText,
          status: statuses.get(node.id),
          ...(selectionToolbarAnchorId === node.id
            ? {
                selectionAlignmentVisible: true,
                selectionCount: selectedCanvasNodes.length,
                onAlignSelection: alignSelectedNodes,
              }
            : {}),
          onSelect: (additive = false) => selectCanvasNode(node.id, additive),
          onOpenPreview: (assetId: string) => {
            const asset = assetById.get(assetId);
            if (!asset) return;
            setPreviewReturnsToHistory(false);
            setPreviewAsset(asset);
          },
          onPrepareReversePrompt: () => {
            selectCanvasNode(node.id);
            setInspectorMode("agent");
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
          onRecoverResult:
            node.data.generatedResult === true &&
            (node.data.generatedRecoveryAction === "resume_poll" ||
              node.data.generatedRecoveryAction === "resume_archive") &&
            typeof node.data.generatedFromRunId === "string"
              ? async () => {
                  const runId = node.data.generatedFromRunId!;
                  showToast(
                    node.data.generatedRecoveryAction === "resume_poll"
                      ? "正在恢复查询现有供应商任务，不会重新提交或扣费…"
                      : "正在从已完成的供应商任务取回结果，不会再次提交或扣费…",
                  );
                  try {
                    const snapshot = await resumeRun(runId);
                    applyRunSnapshot(snapshot, snapshot.run.clientRequestId);
                    if (terminalRunStatuses.has(snapshot.run.status)) {
                      await refreshAssets();
                    } else {
                      subscribeToRun(snapshot.run.id);
                    }
                  } catch (error) {
                    showToast(
                      error instanceof Error
                        ? error.message
                        : "结果取回失败，请稍后重试",
                      "error",
                    );
                    throw error;
                  }
                }
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
          onRemoveLinkedAsset: (assetId: string) => {
            const state = useCanvasStore.getState();
            const nextEdges = removeDirectLinkedAssetEdges(
              node.id,
              assetId,
              state.nodes,
              state.edges,
            );
            if (nextEdges.length === state.edges.length) return;
            const nextNodes = removeUnavailableAssetMentions(
              state.nodes,
              nextEdges,
            );
            checkpoint(true);
            setNodes(nextNodes);
            setEdges(nextEdges);
            scheduleSave(nextNodes, nextEdges);
          },
          onOpenApiSettings: () => setSettingsOpen(true),
        },
      };
    });
  }, [
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
    modelLoadError,
    recordLinkedAssetDuration,
    applyRunSnapshot,
    refreshAssets,
    regenerateResult,
    runNode,
    scheduleSave,
    setEdges,
    setNodes,
    showToast,
    subscribeToRun,
    alignSelectedNodes,
    selectCanvasNode,
    selectedCanvasNodes.length,
    selectionToolbarAnchorId,
    statuses,
    updateNodeData,
    updateMediaAspectRatio,
  ]);

  const portLayoutSignature = useMemo(
    () =>
      renderedNodes
        .map((node) => {
          const inputs = (node.data.inputs ?? [])
            .map((port) => `${port.id}:${port.kind}`)
            .join(",");
          const outputs = (node.data.outputs ?? [])
            .map((port) => `${port.id}:${port.kind}`)
            .join(",");
          return `${node.id}:${node.width ?? ""}:${node.height ?? ""}:${inputs}:${outputs}`;
        })
        .join("|"),
    [renderedNodes],
  );

  useEffect(() => {
    if (portLayoutSignatureRef.current === portLayoutSignature) return;
    portLayoutSignatureRef.current = portLayoutSignature;
    for (const node of renderedNodes) updateNodeInternals(node.id);
  }, [portLayoutSignature, renderedNodes, updateNodeInternals]);

  const onNodesChangeWrapped = useCallback(
    (changes: Parameters<typeof applyNodeChanges<CanvasNode>>[0]) => {
      const selected = changes.find(
        (change) => change.type === "select" && change.selected,
      );
      const selectionMayChange = changes.some(
        (change) => change.type === "select" || change.type === "remove",
      );
      let nodesToPersist: CanvasNode[] | null = null;
      useCanvasStore.setState((state) => {
        const next = applyNodeChanges(changes, state.nodes);
        if (shouldPersistNodeChanges(changes)) nodesToPersist = next;
        if (!selectionMayChange) return { nodes: next };

        const primaryStillSelected = next.some(
          (node) => node.id === state.selectedId && node.selected,
        );
        const fallbackSelectedId = [...next]
          .reverse()
          .find((node) => node.selected)?.id;
        const nextSelectedId =
          selected?.type === "select"
            ? selected.id
            : primaryStillSelected
              ? state.selectedId
              : (fallbackSelectedId ?? null);
        return { nodes: next, selectedId: nextSelectedId };
      });
      if (nodesToPersist)
        scheduleSave(nodesToPersist, useCanvasStore.getState().edges);
    },
    [scheduleSave],
  );
  const onEdgesChangeWrapped = useCallback(
    (changes: Parameters<typeof applyEdgeChanges<CanvasEdge>>[0]) => {
      const removesEdge = changes.some((change) => change.type === "remove");
      if (!removesEdge) {
        setEdges((current) => applyEdgeChanges(changes, current));
        return;
      }
      checkpoint(true);
      const state = useCanvasStore.getState();
      const nextEdges = applyEdgeChanges(changes, state.edges);
      const nextNodes = removeUnavailableAssetMentions(state.nodes, nextEdges);
      setNodes(nextNodes);
      setEdges(nextEdges);
      scheduleSave(nextNodes, nextEdges);
    },
    [checkpoint, scheduleSave, setEdges, setNodes],
  );
  const onMoveEnd = useCallback(
    (_: unknown, nextViewport: { x: number; y: number; zoom: number }) => {
      const state = useCanvasStore.getState();
      if (canvasViewportsEqual(state.viewport, nextViewport)) return;
      setViewport(nextViewport);
      scheduleSave(state.nodes, state.edges, nextViewport, state.drawings);
    },
    [scheduleSave, setViewport],
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

  // Marketplace prices are supplier-owned data. Keep the canvas selector in
  // sync when the tab regains focus (for example after refreshing a supplier's
  // model-plaza page) and at the same cadence as the client model cache.
  useEffect(() => {
    if (!selectedConnectionRecord || !selectedConnectionId) return;
    const supplier = providerConnectionSupplierKey(selectedConnectionRecord);
    const marketplaceSuppliers = new Set([
      "cangyuan",
      "cyberafei",
      "chentu",
      "miaowu",
      "weai",
    ]);
    if (!marketplaceSuppliers.has(supplier)) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      invalidateModelCache(selectedConnectionId);
      setModelScanRevision((current) => current + 1);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(interval);
    };
  }, [selectedConnectionId, selectedConnectionRecord]);

  useEffect(() => {
    if (!selectedConnectionId || selectedConnectionId === "fake-default")
      return;
    const selectedConnection = connections.find(
      (connection) => connection.id === selectedConnectionId,
    );
    if (!selectedConnection) return;
    let cancelled = false;
    const requiresLiveWeAiScan =
      verifiedWeAiModelDescriptorsForConnection(selectedConnection).length > 0;
    const requiresLiveCyberAfeiScan =
      selectedConnection.config.preset === "cyberafei-api";
    const requiresLiveChentuScan =
      selectedConnection.config.preset === CHENTU_PRESET_ID;
    const requiresLiveFriModelScan =
      selectedConnection.config.preset === FRIMODEL_PRESET_ID;
    const requiresAuthoritativeScan =
      connectionRequiresAuthoritativeModelScan(selectedConnection);
    const savedWeAiItems = requiresLiveWeAiScan
      ? weAiCanvasModelDescriptorsFromSavedScan(selectedConnection.config)
      : null;
    const cachedItems = requiresAuthoritativeScan
      ? getCachedModels(selectedConnectionId)
      : undefined;
    if (
      requiresAuthoritativeScan &&
      cachedItems === undefined &&
      savedWeAiItems === null
    ) {
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setConnectionModels({
          connectionId: selectedConnectionId,
          items: [],
          authoritative: true,
          loading: true,
        });
        setModelLoadError(null);
      });
    }
    const localItems =
      cachedItems ??
      savedWeAiItems ??
      (requiresAuthoritativeScan
        ? []
        : modelDescriptorsForConnection(selectedConnection));
    const applyModels = (items: readonly ModelDescriptor[]) => {
      if (cancelled) return;
      setConnectionModels((current) => {
        if (
          current.connectionId === selectedConnectionId &&
          Boolean(current.authoritative) === requiresAuthoritativeScan &&
          current.loading === false &&
          modelDescriptorListsEqual(current.items, items)
        ) {
          return current;
        }
        return {
          connectionId: selectedConnectionId,
          items: [...items],
          authoritative: requiresAuthoritativeScan,
          loading: false,
        };
      });
      const currentNode = useCanvasStore
        .getState()
        .nodes.find((node) => node.id === selectedId);
      const nodeType = currentNode?.data.nodeType;
      if (
        !currentNode ||
        (nodeType !== "image-generation" && nodeType !== "video-generation")
      )
        return;
      const compatible = items.filter((model) =>
        modelSupportsNodeType(model, nodeType),
      );
      if (compatible.length === 0) {
        setModelLoadError(
          requiresLiveCyberAfeiScan
            ? {
                connectionId: selectedConnectionId,
                message:
                  "赛博阿飞分组扫描完成：当前 Key 没有可运行的图片或视频模型，已隐藏旧模型",
              }
            : requiresLiveWeAiScan
              ? {
                  connectionId: selectedConnectionId,
                  message:
                    "We-AI 实时扫描完成：当前群组没有可用图片模型，已隐藏本地旧模型",
                }
              : requiresLiveChentuScan
                ? {
                    connectionId: selectedConnectionId,
                    message:
                      "辰途实时扫描完成：当前 Key 没有可运行的图片或视频模型，已隐藏本地旧模型",
                  }
                : requiresLiveFriModelScan
                  ? {
                      connectionId: selectedConnectionId,
                      message:
                        "FriModel 实时扫描完成：当前 Key 没有可运行的图片模型，已隐藏本地旧模型",
                    }
                : null,
        );
        return;
      }
      setModelLoadError(null);
      const runnableCompatible = compatible.filter(
        (model) => modelCanvasUnavailableReason(model) === null,
      );
      if (runnableCompatible.length === 0) {
        setModelLoadError({
          connectionId: selectedConnectionId,
          message: requiresLiveCyberAfeiScan
            ? "赛博阿飞已扫描到相关模型，但当前都没有已验证的画布协议；模型会显示为禁用且不会提交扣费"
            : requiresLiveChentuScan
              ? "辰途已扫描到相关模型，但当前都没有已验证的画布协议；模型会显示为禁用且不会提交扣费"
              : requiresLiveFriModelScan
                ? "FriModel 已扫描到相关模型，但当前都没有可运行的图片协议；模型会显示为禁用且不会提交扣费"
              : "当前连接没有可运行的模型",
        });
        return;
      }
      const selectedUnavailable = compatible.find(
        (model) =>
          model.id === currentNode.data.model &&
          modelCanvasUnavailableReason(model) !== null,
      );
      if (selectedUnavailable) {
        setModelLoadError({
          connectionId: selectedConnectionId,
          message: `${selectedUnavailable.id} 已由当前 Key 扫描到，但${modelCanvasUnavailableReason(selectedUnavailable)}，不会自动提交`,
        });
        return;
      }
      const hasExactModel = runnableCompatible.some(
        (model) => model.id === currentNode.data.model,
      );
      if (
        (requiresLiveCyberAfeiScan ||
          requiresLiveChentuScan ||
          requiresLiveFriModelScan) &&
        typeof currentNode.data.model === "string" &&
        currentNode.data.model.trim() &&
        !hasExactModel
      ) {
        setModelLoadError({
          connectionId: selectedConnectionId,
          message: `${currentNode.data.model} 不在当前 Key 的最新扫描结果中，已禁止自动换模`,
        });
        return;
      }
      const currentParameters =
        (currentNode.data.parameters as
          Readonly<Record<string, unknown>> | undefined) ?? {};
      const model = modelDescriptorForSavedSelectionOrDefault(
        runnableCompatible,
        currentNode.data.model,
        currentParameters,
      );
      if (!model) {
        if (requiresAuthoritativeScan) {
          setModelLoadError({
            connectionId: selectedConnectionId,
            message: `${currentNode.data.model} 不在最新模型目录中，已保留当前选择，不会自动换模`,
          });
        }
        return;
      }
      const migration = modelDiscoveryMigrationPatch(
        nodeType,
        currentNode.data,
        selectedConnection.provider,
        model,
      );
      if (migration) updateNodeData(currentNode.id, migration);
    };
    if (
      localItems.length > 0 ||
      cachedItems !== undefined ||
      savedWeAiItems !== null
    )
      applyModels(localItems);
    const modelRequest =
      isCangyuanImagePreset(selectedConnection.config.preset) &&
      isCangyuanImageGroup(selectedConnection.config.modelGroup)
        ? refreshModels(selectedConnectionId)
        : fetchModels(selectedConnectionId);
    void modelRequest
      .then((items) => {
        applyModels(items);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (!requiresAuthoritativeScan && localItems.length > 0) return;
        setConnectionModels({
          connectionId: selectedConnectionId,
          items: [],
          authoritative: requiresAuthoritativeScan,
          loading: false,
        });
        setModelLoadError({
          connectionId: selectedConnectionId,
          message:
            error instanceof Error
              ? error.message
              : requiresLiveCyberAfeiScan
                ? "赛博阿飞实时模型扫描失败，已隐藏本地旧模型"
                : requiresLiveWeAiScan
                  ? "We-AI 实时模型扫描失败"
                : requiresLiveChentuScan
                  ? "辰途实时模型扫描失败，已隐藏本地旧模型"
                  : requiresLiveFriModelScan
                    ? "FriModel 实时模型扫描失败，已隐藏本地旧模型"
                  : "模型列表读取失败",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    connections,
    modelScanRevision,
    selectedConnectionId,
    selectedId,
    updateNodeData,
  ]);

  const selectedData = selectedNode?.data;
  const effectiveInspectorMode: InspectorMode = DIRECTOR_FEATURE_ENABLED
    ? "agent"
    : inspectorMode === "node" && selectedNode
      ? "node"
      : "agent";
  const showNodeInspector = effectiveInspectorMode === "node";
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
    if (!selectedNode || !selectedData || !generationNodeType) return [];
    return modelOptionsForNode(selectedNode, connections, connectionModels);
  }, [
    connectionModels,
    generationNodeType,
    selectedData,
    selectedNode,
    connections,
  ]);
  const selectedModel = availableModels.find(
    (model) => model.id === selectedData?.model,
  );
  const selectedModelListAuthoritative = Boolean(
    selectedConnectionId &&
    ((connectionModels.connectionId === selectedConnectionId &&
      connectionModels.authoritative) ||
      (selectedConnectionRecord &&
        connectionRequiresAuthoritativeModelScan(selectedConnectionRecord))),
  );
  const selectedModelListLoading = Boolean(
    selectedConnectionId &&
    selectedConnectionRecord &&
    connectionRequiresAuthoritativeModelScan(selectedConnectionRecord) &&
    (connectionModels.connectionId !== selectedConnectionId ||
      connectionModels.loading),
  );
  const selectedModelListFailed = Boolean(
    selectedConnectionId &&
    modelLoadError?.connectionId === selectedConnectionId &&
    !selectedModelListLoading,
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

  const handleUpload = useCallback(
    async (file: File, announceSuccess = true) => {
      try {
        const importable = await prepareImportableMediaFile(file);
        if (!importable) throw new Error("图片、视频或音频格式不受支持");
        if (importable !== file)
          showToast(`已自动转换为可导入格式：${importable.name}`, "success");
        const asset = await uploadAsset(importable);
        setAssets((current) => [
          asset,
          ...current.filter((item) => item.id !== asset.id),
        ]);
        void archiveProjectAssets(canvasId ?? "", [asset.id]).catch(() => undefined);
        if (announceSuccess) showToast("素材已加入素材库", "success");
        return asset;
      } catch (error) {
        showToast(error instanceof Error ? error.message : "上传失败", "error");
        return null;
      }
    },
    [canvasId, showToast],
  );

  const prepareFilesForImport = useCallback(
    async (files: readonly File[]) => {
      const prepared = await mapWithConcurrency(files, 2, async (file) => {
        try {
          const importable = await prepareImportableMediaFile(file);
          if (!importable) {
            showToast(`不支持的素材格式：${file.name}`, "error");
            return null;
          }
          if (importable !== file)
            showToast(`已自动转换为可导入格式：${importable.name}`, "success");
          return importable;
        } catch (error) {
          showToast(
            error instanceof Error ? error.message : `${file.name} 转换失败`,
            "error",
          );
          return null;
        }
      });
      return prepared.filter((file): file is File => Boolean(file));
    },
    [showToast],
  );

  const revokePendingPreview = useCallback((nodeId: string) => {
    const previewUrl = pendingPreviewUrlsRef.current.get(nodeId);
    if (!previewUrl) return;
    pendingPreviewUrlsRef.current.delete(nodeId);
    URL.revokeObjectURL(previewUrl);
  }, []);

  const unregisterPendingNativeDrop = useCallback(
    (contentKey: string, nodeId: string) => {
      const entries = pendingNativeDropsRef.current.get(contentKey);
      if (!entries) return;
      const remaining = entries.filter((entry) => entry.nodeId !== nodeId);
      if (remaining.length > 0)
        pendingNativeDropsRef.current.set(contentKey, remaining);
      else pendingNativeDropsRef.current.delete(contentKey);
    },
    [],
  );

  const beginPendingAssetImports = useCallback(
    (files: readonly File[], position: { x: number; y: number }) => {
      if (files.length === 0) return [];
      checkpoint(true);
      const state = useCanvasStore.getState();
      const pending = files.map((file, index): PendingAssetImport => {
        const created = createPendingAssetInputNode(
          file,
          { x: position.x + index * 28, y: position.y + index * 36 },
          state.nodes.length + index,
        );
        if (created.previewUrl)
          pendingPreviewUrlsRef.current.set(
            created.node.id,
            created.previewUrl,
          );
        return {
          file,
          node: created.node,
          nodeId: created.node.id,
          ...(created.previewUrl ? { previewUrl: created.previewUrl } : {}),
        };
      });
      const additions = pending.map((item) => item.node);
      const nextNodes = [...state.nodes, ...additions];
      useCanvasStore.setState({
        nodes: nextNodes,
        selectedId: additions.at(-1)?.id ?? null,
      });
      graphRef.current = { nodes: nextNodes, edges: state.edges };
      return pending;
    },
    [checkpoint],
  );

  const completePendingAssetImport = useCallback(
    (nodeId: string, asset: AssetView) => {
      const state = useCanvasStore.getState();
      const pendingNode = state.nodes.find((node) => node.id === nodeId);
      if (!pendingNode) {
        revokePendingPreview(nodeId);
        return false;
      }
      const completed = createAssetInputNode(
        asset,
        pendingNode.position,
        state.nodes.indexOf(pendingNode),
      );
      const nextNodes = state.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...completed,
              id: nodeId,
              position: node.position,
              ...(node.style ? { style: node.style } : {}),
            }
          : node,
      );
      useCanvasStore.setState({ nodes: nextNodes });
      graphRef.current = { nodes: nextNodes, edges: state.edges };
      revokePendingPreview(nodeId);
      scheduleSave(nextNodes, state.edges, state.viewport);
      return true;
    },
    [revokePendingPreview, scheduleSave],
  );

  const failPendingAssetImport = useCallback(
    (nodeId: string) => {
      const state = useCanvasStore.getState();
      const nextNodes = state.nodes.filter((node) => node.id !== nodeId);
      if (nextNodes.length !== state.nodes.length) {
        useCanvasStore.setState({
          nodes: nextNodes,
          selectedId: state.selectedId === nodeId ? null : state.selectedId,
        });
        graphRef.current = { nodes: nextNodes, edges: state.edges };
      }
      revokePendingPreview(nodeId);
    },
    [revokePendingPreview],
  );

  const uploadPendingAssetImports = useCallback(
    async (pending: readonly PendingAssetImport[]) => {
      const results = await mapWithConcurrency(pending, 3, async (item) => {
        const asset = await handleUpload(item.file, false);
        if (!asset) {
          failPendingAssetImport(item.nodeId);
          return false;
        }
        completePendingAssetImport(item.nodeId, asset);
        return true;
      });
      return results.filter(Boolean).length;
    },
    [completePendingAssetImport, failPendingAssetImport, handleUpload],
  );

  useEffect(() => {
    if (!canvasId || initialization.status !== "ready") return;
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
          const contentKey = nativeDropContentKey(drop);
          const now = Date.now();
          const unavailableNodeIds = new Set([
            ...nativeUploadInProgressRef.current,
            ...activeBridgeDropsRef.current,
          ]);
          const registeredEntries =
            pendingNativeDropsRef.current.get(contentKey) ?? [];
          const currentNodeIds = new Set(
            useCanvasStore.getState().nodes.map((node) => node.id),
          );
          const liveEntries = registeredEntries.filter(
            (entry) =>
              currentNodeIds.has(entry.nodeId) &&
              (now - entry.createdAt < NATIVE_DROP_DEDUPE_WINDOW_MS ||
                unavailableNodeIds.has(entry.nodeId)),
          );
          if (liveEntries.length > 0)
            pendingNativeDropsRef.current.set(contentKey, liveEntries);
          else pendingNativeDropsRef.current.delete(contentKey);
          const pendingEntry = availablePendingNativeDrop(
            liveEntries,
            unavailableNodeIds,
            now,
          );
          if (
            !pendingEntry &&
            liveEntries.some((entry) => unavailableNodeIds.has(entry.nodeId))
          ) {
            await discardMaterialDrop(drop.id);
            continue;
          }
          const pendingNodeId = pendingEntry?.nodeId;
          const recentAt = recentNativeDropsRef.current.get(contentKey) ?? 0;
          if (!pendingEntry && now - recentAt < NATIVE_DROP_DEDUPE_WINDOW_MS) {
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
          const existingPendingNode = pendingNodeId
            ? useCanvasStore
                .getState()
                .nodes.find((node) => node.id === pendingNodeId)
            : undefined;
          const position =
            existingPendingNode?.position ??
            flow.screenToFlowPosition({
              x: clientX,
              y: clientY,
            });
          const pendingKind = drop.mimeType.startsWith("video/")
            ? "video"
            : drop.mimeType.startsWith("audio/")
              ? "audio"
              : "image";
          const optimisticNode =
            existingPendingNode ??
            (() => {
              const node = createNode(
                "asset-input",
                position,
                useCanvasStore.getState().nodes.length,
              );
              node.id = `material-drop-${drop.id}`;
              node.data = {
                ...node.data,
                label: drop.name,
                description: "素材已放入画布，正在从素材管理导入…",
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
              return node;
            })();
          if (!existingPendingNode) {
            checkpoint(true);
            const state = useCanvasStore.getState();
            const nextNodes = [...state.nodes, optimisticNode];
            useCanvasStore.setState({
              nodes: nextNodes,
              selectedId: optimisticNode.id,
            });
            graphRef.current = { nodes: nextNodes, edges: state.edges };
          }
          activeBridgeDropsRef.current.add(optimisticNode.id);
          showToast(`正在后台导入：${drop.name}`);

          try {
            const asset = await claimMaterialDrop(drop.id);
            void archiveProjectAssets(canvasId, [asset.id]).catch(() => undefined);
            setAssets((current) => [
              asset,
              ...current.filter((item) => item.id !== asset.id),
            ]);
            const handledAt = Date.now();
            recentNativeDropsRef.current.set(contentKey, handledAt);
            if (pendingEntry) {
              bridgeHandledNativeDropsRef.current.set(
                optimisticNode.id,
                handledAt,
              );
              unregisterPendingNativeDrop(contentKey, optimisticNode.id);
            }
            completePendingAssetImport(optimisticNode.id, asset);
            showToast(
              canUseDropPoint
                ? `已从素材管理拖入：${asset.name}`
                : `已从素材管理拖入：${asset.name}（已放到画布中央）`,
            );
          } catch (error) {
            if (existingPendingNode) {
              useCanvasStore.setState((state) => ({
                nodes: state.nodes.map((node) =>
                  node.id === optimisticNode.id
                    ? {
                        ...node,
                        data: {
                          ...node.data,
                          description: "本地桥接未完成，正在改用浏览器上传…",
                        },
                      }
                    : node,
                ),
              }));
            } else {
              failPendingAssetImport(optimisticNode.id);
              showToast(
                error instanceof Error ? error.message : "素材管理拖入失败",
                "error",
              );
            }
          } finally {
            activeBridgeDropsRef.current.delete(optimisticNode.id);
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
    materialDropPollRef.current = pollMaterialDrops;
    void pollMaterialDrops();
    // Desktop bridge drops do not need a four-requests-per-second idle loop.
    // A 750 ms foreground poll still feels immediate while cutting idle API
    // traffic by two thirds.
    const timer = window.setInterval(() => void pollMaterialDrops(), 750);
    window.addEventListener("focus", pollMaterialDrops);
    return () => {
      disposed = true;
      if (materialDropPollRef.current === pollMaterialDrops)
        materialDropPollRef.current = null;
      window.clearInterval(timer);
      window.removeEventListener("focus", pollMaterialDrops);
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
  }, [
    canvasId,
    checkpoint,
    completePendingAssetImport,
    failPendingAssetImport,
    initialization.status,
    showToast,
    unregisterPendingNativeDrop,
  ]);

  const pasteExternalImages = useCallback(
    async (files: File[]) => {
      const flow = reactFlowRef.current;
      if (!flow || files.length === 0) return;
      const importableFiles = await prepareFilesForImport(files);
      if (importableFiles.length === 0) return;
      const bounds = canvasWrapRef.current?.getBoundingClientRect();
      const position = flow.screenToFlowPosition({
        x: bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2,
        y: bounds ? bounds.top + bounds.height / 2 : window.innerHeight / 2,
      });
      showToast(
        importableFiles.length === 1
          ? "剪贴板图片已放入画布，正在后台导入…"
          : `已放入 ${importableFiles.length} 张剪贴板图片，正在并行导入…`,
      );
      const pending = beginPendingAssetImports(importableFiles, position);
      const completed = await uploadPendingAssetImports(pending);
      if (completed > 0)
        showToast(`已完成 ${completed} 张剪贴板图片导入`, "success");
    },
    [
      beginPendingAssetImports,
      prepareFilesForImport,
      showToast,
      uploadPendingAssetImports,
    ],
  );

  useEffect(() => {
    if (initialization.status !== "ready") return;
    const handler = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData) return;
      const target =
        event.target instanceof Element ? (event.target as HTMLElement) : null;
      const editing = Boolean(
        target?.closest("input, textarea, select, [contenteditable='true']"),
      );
      const modalOpen = Boolean(
        document.querySelector(
          '[role="dialog"]:not(.node-config-popover), .connection-menu, .canvas-create-menu, .project-menu, .project-context-menu',
        ),
      );
      const interactiveControl = Boolean(
        target?.closest(
          "button, a, [role='menuitem'], .project-menu-backdrop, .project-context-menu-backdrop, .mobile-backdrop",
        ),
      );
      if (editing || modalOpen || interactiveControl) return;

      const rawFiles = [
        ...Array.from(event.clipboardData.files),
        ...Array.from(event.clipboardData.items)
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file)),
      ];
      const uniqueFiles = new Map<string, File>();
      for (const file of rawFiles)
        uniqueFiles.set(
          `${file.name}:${file.size}:${file.type}:${file.lastModified}`,
          file,
        );
      const candidates = Array.from(uniqueFiles.values());
      const images = preferNamedClipboardImages(
        candidates
          .map((file, index) => normalizeClipboardImageFile(file, index))
          .filter((file): file is File => Boolean(file)),
      );

      if (images.length > 0) {
        event.preventDefault();
        void pasteExternalImages(images);
        return;
      }
      if (candidates.some((file) => file.type.startsWith("image/"))) {
        event.preventDefault();
        showToast("剪贴板中的图片格式不受支持，请复制 PNG、JPG、WebP 或 GIF");
        return;
      }
      if (
        event.clipboardData.getData(NODE_CLIPBOARD_TYPE) === "1" &&
        nodeClipboardRef.current &&
        pasteCopiedNodes()
      )
        event.preventDefault();
    };
    window.addEventListener("paste", handler, true);
    return () => window.removeEventListener("paste", handler, true);
  }, [initialization.status, pasteCopiedNodes, pasteExternalImages, showToast]);

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
      void archiveProjectAssets(canvasId ?? "", [asset.id]).catch(() => undefined);
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
    canvasId,
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

      const stringPayloads = Array.from(event.dataTransfer.types).flatMap(
        (type) => {
          try {
            const data = event.dataTransfer.getData(type);
            return data ? [{ type, data }] : [];
          } catch {
            return [];
          }
        },
      );
      const droppedSources = droppedMediaUrlsFromStrings(stringPayloads);
      let files = await prepareFilesForImport(
        await filesFromNativeDrop(
          Array.from(event.dataTransfer.files),
          Array.from(event.dataTransfer.items),
        ),
      );
      let downloadedAssets: AssetView[] = [];
      let sourceFailures: Array<{ index: number; message: string }> = [];
      if (files.length === 0 && droppedSources.length > 0) {
        const inlineSources = droppedSources.filter((source) =>
          source.startsWith("data:"),
        );
        const downloadableSources = droppedSources.filter(
          (source) => !source.startsWith("data:"),
        );
        if (inlineSources.length > 0)
          files = await prepareFilesForImport(
            await filesFromDroppedMediaUrls(inlineSources),
          );
        if (downloadableSources.length > 0) {
          showToast("正在下载微信/网页拖入的素材…");
          try {
            const imported =
              await importDroppedMediaSources(downloadableSources);
            downloadedAssets = imported.assets;
            sourceFailures = imported.failures;
            void archiveProjectAssets(
              canvasId ?? "",
              imported.assets.map((asset) => asset.id),
            ).catch(() => undefined);
          } catch (error) {
            sourceFailures = [
              {
                index: 0,
                message:
                  error instanceof Error ? error.message : "拖入素材下载失败",
              },
            ];
          }
        }
      }
      if (files.length === 0 && downloadedAssets.length === 0) {
        showToast(
          sourceFailures[0]?.message ??
            "微信未提供可读取的文件或下载地址；请先点开原图再拖入",
          "error",
        );
        return;
      }
      if (downloadedAssets.length > 0) {
        setAssets((current) => [
          ...downloadedAssets,
          ...current.filter(
            (item) => !downloadedAssets.some((asset) => asset.id === item.id),
          ),
        ]);
        placeAssetsOnCanvas(downloadedAssets, position);
      }
      if (files.length === 0) {
        showToast(
          sourceFailures.length > 0
            ? `已导入 ${downloadedAssets.length} 个素材，${sourceFailures.length} 个下载失败：${sourceFailures[0]?.message}`
            : `已下载并导入 ${downloadedAssets.length} 个素材`,
          "success",
        );
        return;
      }
      const filePosition = {
        x: position.x + downloadedAssets.length * 28,
        y: position.y + downloadedAssets.length * 36,
      };
      const pending = beginPendingAssetImports(files, filePosition);
      const registeredAt = Date.now();
      for (const item of pending) {
        const contentKey = nativeDropContentKey(item.file);
        const entries = pendingNativeDropsRef.current.get(contentKey) ?? [];
        pendingNativeDropsRef.current.set(contentKey, [
          ...entries,
          { nodeId: item.nodeId, createdAt: registeredAt },
        ]);
      }
      showToast(
        files.length === 1
          ? "素材已放入画布，正在后台导入…"
          : `已放入 ${files.length} 个素材，正在并行导入…`,
      );

      // Ask the local material bridge immediately and once more after its
      // event has had a moment to arrive. This replaces the old unconditional
      // 550ms pause while still preventing duplicate imports from Electron.
      void materialDropPollRef.current?.();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
      await materialDropPollRef.current?.();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
      await materialDropPollRef.current?.();

      const results = await mapWithConcurrency(pending, 3, async (item) => {
        const contentKey = nativeDropContentKey(item.file);
        const bridgeDeadline = Date.now() + 15_000;
        while (
          activeBridgeDropsRef.current.has(item.nodeId) &&
          Date.now() < bridgeDeadline
        )
          await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
        if (activeBridgeDropsRef.current.has(item.nodeId)) return false;
        const bridgeHandledAt =
          bridgeHandledNativeDropsRef.current.get(item.nodeId) ?? 0;
        if (Date.now() - bridgeHandledAt < NATIVE_DROP_DEDUPE_WINDOW_MS) {
          bridgeHandledNativeDropsRef.current.delete(item.nodeId);
          unregisterPendingNativeDrop(contentKey, item.nodeId);
          return true;
        }
        nativeUploadInProgressRef.current.add(item.nodeId);
        try {
          const asset = await handleUpload(item.file, false);
          if (!asset) {
            failPendingAssetImport(item.nodeId);
            return false;
          }
          recentNativeDropsRef.current.set(contentKey, Date.now());
          completePendingAssetImport(item.nodeId, asset);
          return true;
        } finally {
          nativeUploadInProgressRef.current.delete(item.nodeId);
          bridgeHandledNativeDropsRef.current.delete(item.nodeId);
          unregisterPendingNativeDrop(contentKey, item.nodeId);
        }
      });
      const completed = results.filter(Boolean).length;
      // Some Electron/WeChat builds expose a non-empty virtual File whose
      // bytes cannot actually be read. If that upload failed, retry the text
      // URL/cache-path payload through the downloader instead of asking the
      // user to save the media manually.
      if (completed === 0 && downloadedAssets.length === 0) {
        const fallbackSources = droppedSources.filter(
          (source) => !source.startsWith("data:"),
        );
        if (fallbackSources.length > 0) {
          showToast("正在重试下载微信拖入的素材…");
          try {
            const imported = await importDroppedMediaSources(fallbackSources);
            downloadedAssets = imported.assets;
            sourceFailures = imported.failures;
            void archiveProjectAssets(
              canvasId ?? "",
              imported.assets.map((asset) => asset.id),
            ).catch(() => undefined);
            if (downloadedAssets.length > 0) {
              setAssets((current) => [
                ...downloadedAssets,
                ...current.filter(
                  (item) =>
                    !downloadedAssets.some((asset) => asset.id === item.id),
                ),
              ]);
              placeAssetsOnCanvas(downloadedAssets, position);
            }
          } catch (error) {
            sourceFailures = [
              {
                index: 0,
                message:
                  error instanceof Error
                    ? error.message
                    : "微信拖入素材下载失败",
              },
            ];
          }
        }
      }
      const totalCompleted = completed + downloadedAssets.length;
      if (totalCompleted > 0)
        showToast(
          sourceFailures.length > 0
            ? `已完成 ${totalCompleted} 个素材导入，${sourceFailures.length} 个下载失败`
            : `已完成 ${totalCompleted} 个素材导入`,
          "success",
        );
      else if (sourceFailures.length > 0)
        showToast(sourceFailures[0]?.message ?? "素材导入失败", "error");
    },
    [
      assets,
      beginPendingAssetImports,
      completePendingAssetImport,
      failPendingAssetImport,
      handleUpload,
      placeAssetsOnCanvas,
      prepareFilesForImport,
      showToast,
      unregisterPendingNativeDrop,
      canvasId,
    ],
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

  function exportProject(useConflictedSnapshot = false) {
    const conflictSnapshot = useConflictedSnapshot
      ? conflictedSave.current
      : null;
    const projectTitle =
      conflictSnapshot?.title?.trim() || title.trim() || "超级画布项目";
    const payload = JSON.stringify(
      {
        format: PROJECT_JSON_FORMAT,
        version: 1,
        title: projectTitle,
        exportedAt: new Date().toISOString(),
        graph:
          conflictSnapshot?.graph ??
          serializableGraph(nodes, edges, viewport, drawings),
      },
      null,
      2,
    );
    downloadBlob(
      new Blob([payload], { type: "application/json" }),
      `${safeDownloadBaseName(projectTitle)}.canvas.json`,
    );
  }

  async function exportPortableProject() {
    if (portableExportProgress) return;
    const projectTitle = title.trim() || "超级画布项目";
    const graph = serializableGraph(nodes, edges, viewport, drawings);
    const total = collectReferencedAssetIds(graph).length;
    setPortableExportProgress({ completed: 0, total });
    try {
      const archive = await createPortableProjectPackage({
        title: projectTitle,
        graph,
        assets,
        onProgress: (completed, progressTotal) =>
          setPortableExportProgress({ completed, total: progressTotal }),
      });
      downloadBlob(
        archive,
        `${safeDownloadBaseName(projectTitle)}${PROJECT_PACKAGE_EXTENSION}`,
      );
      showToast(
        total > 0 ? `完整项目包已导出（${total} 个素材）` : "完整项目包已导出",
        "success",
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "完整项目包导出失败",
        "error",
      );
    } finally {
      setPortableExportProgress(null);
      setProjectMenuOpen(false);
    }
  }

  async function importProject(file: File) {
    if (busy) {
      showToast("有生成任务正在运行，请等待任务结束后再导入项目", "error");
      return;
    }
    setProjectImportBusy(true);
    setProjectImportError(null);
    try {
      const prepared = await prepareProjectImport({
        file,
        fallbackTitle: title || "超级画布项目",
        fallbackViewport: viewport,
        availableAssetIds: new Set(assets.map((asset) => asset.id)),
      });
      setPendingProjectImport(prepared);
      setProjectImportBackup(true);
      setProjectImportProgress(null);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "项目文件预检失败",
        "error",
      );
    } finally {
      setProjectImportBusy(false);
    }
  }

  async function confirmProjectImport() {
    const prepared = pendingProjectImport;
    if (!prepared || projectImportBusy) return;
    if (!canvasId) {
      setProjectImportError("画布尚未初始化，无法导入");
      return;
    }
    if (busy) {
      setProjectImportError("有生成任务正在运行，请等待任务结束后再导入项目");
      return;
    }

    const uploadedForRollback: AssetView[] = [];
    setProjectImportBusy(true);
    setProjectImportError(null);
    setProjectImportProgress(
      prepared.source === "package"
        ? { completed: 0, total: prepared.packageAssets.length }
        : null,
    );
    try {
      if (projectImportBackup) exportProject();
      const materialized = await uploadPreparedPackageAssets({
        prepared,
        upload: async (assetFile) => {
          const uploaded = await uploadAsset(assetFile);
          void archiveProjectAssets(canvasId, [uploaded.id]).catch(() => undefined);
          uploadedForRollback.push(uploaded);
          setAssets((current) => [
            uploaded,
            ...current.filter((asset) => asset.id !== uploaded.id),
          ]);
          return uploaded;
        },
        onProgress: (completed, totalCount) =>
          setProjectImportProgress({ completed, total: totalCount }),
      });
      const importedGraph = materialized.graph;
      const importedViewport = importedGraph.viewport ?? viewport;
      const importedDrawings = importedGraph.drawings ?? [];
      const nextNodes = ensureGeneratedResultInputs(
        ensureGenerationNodeInputs(
          (importedGraph.nodes as CanvasNode[]).map((node) => ({
            ...node,
            type: "workflow" as const,
          })),
        ),
      );
      const nextEdges = filterEdgesToKnownPorts(
        nextNodes,
        keepLatestEdgePerNodePair(
          syncGeneratedResultEdges(
            nextNodes,
            importedGraph.edges as CanvasEdge[],
          ),
        ),
      );

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pendingSave.current = null;
      await saveRequest(
        {
          canvasId,
          graph: serializableGraph(
            nextNodes,
            nextEdges,
            importedViewport,
            importedDrawings,
          ),
          title: prepared.title,
        },
        false,
      );

      checkpoint(true);
      setNodes(nextNodes);
      setEdges(nextEdges);
      setDrawings(importedDrawings);
      setViewport(importedViewport);
      setTitle(prepared.title);
      setSelectedId(null);
      setSelectedDrawingIds(new Set());
      graphRef.current = { nodes: nextNodes, edges: nextEdges };
      reactFlowRef.current?.setViewport(importedViewport);
      setPendingProjectImport(null);
      setProjectImportProgress(null);
      if (prepared.source === "package") void refreshAssets();
      showToast(
        prepared.source === "package"
          ? `完整项目已导入（${materialized.uploadedAssets.length} 个素材）`
          : "项目结构已导入并保存",
        "success",
      );
    } catch (error) {
      let cleanupFailed = 0;
      if (uploadedForRollback.length > 0) {
        const cleanup = await deleteAssets(
          uploadedForRollback.map((asset) => asset.id),
        );
        cleanupFailed = cleanup.failedIds.length;
        const deleted = new Set(cleanup.deletedIds);
        if (deleted.size > 0)
          setAssets((current) =>
            current.filter((asset) => !deleted.has(asset.id)),
          );
      }
      const message = error instanceof Error ? error.message : "项目导入失败";
      setProjectImportError(
        cleanupFailed > 0
          ? `${message}；另有 ${cleanupFailed} 个临时上传素材清理失败，请在素材库中手动删除`
          : message,
      );
    } finally {
      setProjectImportBusy(false);
      setProjectImportProgress(null);
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">✦</span>
          <span>{APP_NAME}</span>
          <span className="brand-version">v{APP_VERSION}</span>
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
            className="icon-button project-toggle"
            type="button"
            onClick={() => setMobileProjectsOpen(true)}
            aria-label="打开项目对话"
            title="项目对话"
          >
            <MessageSquarePlus size={15} />
          </button>
          <button
            className="icon-button library-toggle"
            type="button"
            onClick={() => setMobileLibraryOpen(true)}
            aria-label="打开节点与素材库"
            title="节点与素材库"
          >
            <FolderOpen size={15} />
          </button>
          <button
            className="icon-button inspector-toggle"
            type="button"
            onClick={() => {
              setInspectorMode(selectedId ? "node" : "agent");
              setMobileInspectorOpen(true);
            }}
            aria-label="打开参数与导演台"
            title="参数与导演台"
          >
            <Settings2 size={15} />
          </button>
          <button
            type="button"
            className={`pill save-state ${busy ? "is-running" : `is-${saveState}`}`}
            disabled={!saveConflict}
            onClick={() => {
              if (saveConflict) setSaveConflictOpen(true);
            }}
            aria-label={saveConflict ? "处理画布保存冲突" : "画布自动保存状态"}
            title={
              busy
                ? "有生成任务正在运行"
                : saveState === "conflict"
                  ? "画布已在其他窗口更新；点击处理保存冲突"
                  : saveState === "error"
                    ? "上次保存失败，修改仍保留在浏览器中"
                    : "画布自动保存状态"
            }
          >
            <span
              className={`node-status ${
                busy
                  ? "running"
                  : saveState === "error" || saveState === "conflict"
                    ? "failed"
                    : saveState === "saved"
                      ? "succeeded"
                      : "running"
              }`}
            />
            {busy ? "任务运行中" : SAVE_STATE_LABEL[saveState]}
          </button>
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
            accept={`application/json,application/zip,.json,${PROJECT_PACKAGE_EXTENSION}`}
            disabled={projectImportBusy || busy}
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
                void saveNow()
                  .then(() => showToast("画布已保存", "success"))
                  .catch(() => undefined);
              }}
            >
              <RefreshCw size={14} /> 保存画布
              <span className="project-menu-hint">Ctrl+S</span>
            </button>
            <button
              type="button"
              role="menuitem"
              aria-label="导出结构 JSON"
              onClick={() => {
                setProjectMenuOpen(false);
                exportProject();
              }}
            >
              <Download size={14} /> 导出结构 JSON
              <span className="project-menu-hint">JSON</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={portableExportProgress !== null}
              onClick={() => {
                void exportPortableProject();
              }}
            >
              <Archive size={14} />
              {portableExportProgress
                ? portableExportProgress.total > 0
                  ? `正在打包 ${portableExportProgress.completed}/${portableExportProgress.total}`
                  : "正在打包…"
                : "导出完整项目包（含素材）"}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={projectImportBusy || busy}
              onClick={() => {
                setProjectMenuOpen(false);
                importInput.current?.click();
              }}
            >
              <Upload size={14} /> 导入 JSON / 完整项目包
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setProjectMenuOpen(false);
                setRunHistoryOpen(true);
              }}
            >
              <History size={14} /> 运行历史
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setProjectMenuOpen(false);
                setAppUpdateOpen(true);
                void refreshAppUpdate(false);
              }}
            >
              <RefreshCw size={14} /> 检查更新
              <span className="project-menu-hint">
                {appUpdateStatus?.latest
                  ? `v${appUpdateStatus.latest.version}`
                  : `v${APP_VERSION}`}
              </span>
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
                if (canvasId)
                  void saveGraph(canvasId, [], [], viewport, []).catch(
                    () => undefined,
                  );
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
        {mobileInspectorOpen || mobileLibraryOpen || mobileProjectsOpen ? (
          <button
            className="mobile-backdrop"
            type="button"
            aria-label="关闭面板"
            onClick={() => {
              setMobileInspectorOpen(false);
              setMobileLibraryOpen(false);
              setMobileProjectsOpen(false);
            }}
          />
        ) : null}
        <ProjectSidebar
          projects={projects}
          activeProjectId={projectId}
          mobileOpen={mobileProjectsOpen}
          onSelectProject={(nextId) => {
            setMobileProjectsOpen(false);
            onSelectProject(nextId);
          }}
          onCreateProject={onCreateProject}
          onCleanupProject={async (nextId) => {
            await onCleanupProject(nextId);
            showToast("项目草稿已清理，成品文件保持不变", "success");
          }}
          onOpenProjectFolder={async (nextId) => {
            await onOpenProjectFolder(nextId);
            showToast("已打开项目文件夹", "success");
          }}
          onRenameProject={async (nextId, nextTitle) => {
            if (nextId === canvasId) await saveNow();
            const result = await onRenameProject(nextId, nextTitle);
            if (nextId === canvasId) {
              canvasRevision.current = result.revision;
              setCanvasRevisionValue(result.revision);
              setTitle(result.project.title);
            }
            showToast("项目与文件夹已同步重命名", "success");
            return result;
          }}
          onDeleteProject={async (nextId) => {
            const warning = await onDeleteProject(nextId);
            showToast(warning ?? "项目已删除", warning ? "error" : "success");
            return warning;
          }}
        />
        <aside className={`sidebar ${mobileLibraryOpen ? "mobile-open" : ""}`}>
          <button
            className="icon-button mobile-panel-close mobile-only"
            type="button"
            onClick={() => setMobileLibraryOpen(false)}
            aria-label="关闭素材库"
          >
            <X size={15} />
          </button>
          <div className="section-title">节点库</div>
          <div className="node-menu">
            <button
              type="button"
              onClick={() => {
                addNewNode("image-generation");
                setMobileLibraryOpen(false);
              }}
            >
              <span className="icon">
                <ImageIcon size={14} />
              </span>
              <strong>图片生成</strong>
            </button>
            <button
              type="button"
              onClick={() => {
                addNewNode("video-generation");
                setMobileLibraryOpen(false);
              }}
            >
              <span className="icon">
                <Video size={14} />
              </span>
              <strong>视频生成</strong>
            </button>
            <button
              type="button"
              onClick={() => {
                addNewNode("prompt");
                setMobileLibraryOpen(false);
              }}
            >
              <span className="icon">
                <Type size={14} />
              </span>
              <strong>Prompt</strong>
            </button>
            <button
              type="button"
              onClick={() => {
                addNewNode("preview");
                setMobileLibraryOpen(false);
              }}
            >
              <span className="icon">
                <FolderOpen size={14} />
              </span>
              <strong>结果预览</strong>
            </button>
          </div>
          <div className="sidebar-divider" />
          <div className="section-title asset-section-title">
            <span>素材库</span>
            <span className="section-count">{assets.length}</span>
          </div>
          <label className="upload-label">
            <Upload size={14} />
            <span>上传图片、视频或音频</span>
            <input
              type="file"
              accept="image/*,video/*,audio/*"
              multiple
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void Promise.all(files.map((file) => handleUpload(file)));
              }}
            />
          </label>
          <div className="asset-list">
            {assets.length === 0 ? (
              <span className="field-note">暂无素材，可上传或拖入画布。</span>
            ) : (
              assets.map((asset) => (
                <button
                  className="asset-row"
                  type="button"
                  key={asset.id}
                  onClick={() => {
                    const bounds =
                      canvasWrapRef.current?.getBoundingClientRect();
                    const position = reactFlowRef.current?.screenToFlowPosition(
                      {
                        x: bounds
                          ? bounds.left + bounds.width / 2
                          : window.innerWidth / 2,
                        y: bounds
                          ? bounds.top + bounds.height / 2
                          : window.innerHeight / 2,
                      },
                    );
                    if (position) placeAssetsOnCanvas([asset], position);
                    setMobileLibraryOpen(false);
                  }}
                  title="放入画布"
                >
                  <span className="asset-thumb">
                    {asset.kind === "image" ? (
                      <img
                        src={`/api/assets/${encodeURIComponent(asset.id)}/preview?size=160`}
                        alt=""
                      />
                    ) : asset.kind === "video" ? (
                      <Video size={15} />
                    ) : (
                      <FolderOpen size={15} />
                    )}
                  </span>
                  <span className="asset-meta">
                    <span className="asset-name">{asset.name}</span>
                    <span className="asset-kind">{asset.kind}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>
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
              <button
                className="button small canvas-tidy-button"
                type="button"
                onClick={tidyCanvasLayout}
                disabled={nodes.length < 2}
                aria-label="一键整理画布"
                title="先整理每组相连的工作流，再整齐排列互不相连的工作流"
              >
                <LayoutGrid size={13} />
                <span>一键整理</span>
              </button>
              <button
                className="button small canvas-group-button"
                type="button"
                onClick={
                  selectedHasGroup
                    ? ungroupSelectedNodes
                    : groupSelectedNodes
                }
                disabled={
                  selectedHasGroup
                    ? false
                    : selectedCanvasNodes.length < 2
                }
                aria-label={selectedHasGroup ? "解组所选节点" : "将所选节点打组"}
                title={
                  selectedHasGroup
                    ? "解组所选节点（Ctrl+Shift+G）"
                    : "将至少两个所选节点放入一个视觉分组（Ctrl+G）"
                }
              >
                <Combine size={13} />
                <span>{selectedHasGroup ? "解组" : "打组"}</span>
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
            edges={displayedEdges}
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
              useCanvasStore.setState((state) => {
                const hasSelectedNodes = state.nodes.some(
                  (node) => node.selected,
                );
                if (!hasSelectedNodes && state.selectedId === null) return {};
                return {
                  selectedId: null,
                  nodes: state.nodes.map((node) =>
                    node.selected ? { ...node, selected: false } : node,
                  ),
                };
              });
              setMobileInspectorOpen(false);
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
            minZoom={CANVAS_MIN_ZOOM}
            maxZoom={CANVAS_MAX_ZOOM}
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
            <ViewportPortal>
              <div className="canvas-group-layer" aria-label="节点分组">
                {canvasGroups.map((group) => (
                  <div
                    className="canvas-node-group"
                    key={group.id}
                    style={{
                      left: group.position.x,
                      top: group.position.y,
                      width: group.width,
                      height: group.height,
                      "--group-accent": group.color,
                    } as CSSProperties}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => selectCanvasGroup(group.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectCanvasGroup(group.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    title="点击选择整个节点组"
                  >
                    <span className="canvas-node-group-header">
                      <span className="canvas-node-group-title">
                        <Combine size={13} />
                        <strong>{group.label}</strong>
                        <small>{group.count} 个节点</small>
                      </span>
                      <button
                        type="button"
                        aria-label={`解组${group.label}`}
                        title="解组"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectCanvasGroup(group.id);
                          window.setTimeout(() => ungroupSelectedNodes(), 0);
                        }}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </ViewportPortal>
            <Background gap={22} size={1} color="#2d3650" />
            <DrawingLayer
              drawings={drawings}
              activeStroke={activeStroke}
              selectedIds={selectedDrawingIds}
              selectionStart={drawingSelectionStart}
              selectionEnd={drawingSelectionEnd}
            />
            <Controls
              fitViewOptions={{
                padding: 0.25,
                minZoom: CANVAS_MIN_ZOOM,
                maxZoom: CANVAS_MAX_ZOOM,
              }}
            />
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
          {initialization.status === "error" ? (
            <div className="canvas-empty-state" role="alert" aria-live="polite">
              <h2>画布加载失败</h2>
              <p>{initialization.message}</p>
              <div className="canvas-empty-actions">
                <button
                  className="button primary small"
                  type="button"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw size={13} /> 重新加载
                </button>
              </div>
            </div>
          ) : initialization.status === "ready" &&
            nodes.length === 0 &&
            !dropActive ? (
            <div className="canvas-empty-state">
              <h2>画布是空的</h2>
              <p>从这里开始，或者直接把图片、视频或音频拖进画布。</p>
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
                <CopyPlus size={13} /> 紧邻复制
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
            aria-label="调整右侧面板宽度"
            aria-orientation="vertical"
            aria-valuemin={INSPECTOR_MIN_WIDTH}
            aria-valuemax={INSPECTOR_MAX_WIDTH}
            aria-valuenow={inspectorWidth}
            aria-valuetext={`${inspectorWidth} 像素`}
            title="左右拖动调整右侧面板宽度"
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
            aria-label="关闭参数与导演台"
          >
            <X size={15} />
          </button>
          {!DIRECTOR_FEATURE_ENABLED ? (
            <div
              className="inspector-mode-tabs"
              role="tablist"
              aria-label="右侧工作面板"
            >
            <button
              className={`inspector-mode-tab ${effectiveInspectorMode === "node" ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={effectiveInspectorMode === "node"}
              aria-controls="inspector-node-panel"
              disabled={!selectedNode}
              onClick={() => setInspectorMode("node")}
              title={selectedNode ? "编辑当前节点参数" : "请先选择一个节点"}
            >
              <Settings2 size={13} /> 节点参数
            </button>
            <button
              className={`inspector-mode-tab ${effectiveInspectorMode === "agent" ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={effectiveInspectorMode === "agent"}
              aria-controls="inspector-agent-panel"
              onClick={() => setInspectorMode("agent")}
            >
              <WandSparkles size={13} /> 导演台
            </button>
            </div>
          ) : null}
          {showNodeInspector && selectedNode && selectedData ? (
            <div
              className="inspector-mode-content is-node"
              id="inspector-node-panel"
              role="tabpanel"
            >
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
                      {selectedModelListAuthoritative ? (
                        <select
                          id={`node-model-${selectedNode.id}`}
                          value={selectedData.model ?? ""}
                          onChange={(event) =>
                            changeNodeModel(selectedNode.id, event.target.value)
                          }
                        >
                          <option value="">自动模型</option>
                          {selectedData.model && !selectedModel ? (
                            <option value={selectedData.model} disabled>
                              {selectedData.model}
                              {selectedModelListLoading
                                ? "（正在扫描模型…）"
                                : selectedModelListFailed
                                  ? "（模型扫描失败，暂不可用）"
                                  : "（当前扫描不可用）"}
                            </option>
                          ) : null}
                          {availableModels.map((model) => {
                            const unavailableReason =
                              modelCanvasUnavailableReason(model);
                            return (
                              <option
                                key={model.id}
                                value={model.id}
                                disabled={unavailableReason !== null}
                              >
                                {appendPriceLabelOnce(
                                  model.name,
                                  model.metadata?.["priceLabel"],
                                )}
                                {unavailableReason
                                  ? `（不可运行：${unavailableReason}）`
                                  : ""}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <input
                          id={`node-model-${selectedNode.id}`}
                          list={`models-${selectedNode.id}`}
                          value={selectedData.model ?? ""}
                          onChange={(event) =>
                            changeNodeModel(selectedNode.id, event.target.value)
                          }
                          placeholder="自动"
                        />
                      )}
                      {!selectedModelListAuthoritative &&
                      availableModels.length > 0 ? (
                        <datalist id={`models-${selectedNode.id}`}>
                          {availableModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {appendPriceLabelOnce(
                                model.name,
                                model.metadata?.["priceLabel"],
                              )}
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
                      {modelLoadError.message}
                      {selectedModelListAuthoritative ||
                      (selectedConnectionRecord &&
                        connectionRequiresAuthoritativeModelScan(
                          selectedConnectionRecord,
                        ))
                        ? "。不可用模型不会进入选择列表"
                        : "；可直接填写模型 ID"}
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
                        href={`/api/assets/${encodeURIComponent(selectedData.assetId)}/content?download=1`}
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
            </div>
          ) : (
            <div
              className="inspector-mode-content is-agent"
              id="inspector-agent-panel"
              role="tabpanel"
            >
              {DIRECTOR_FEATURE_ENABLED ? (
                <SuperDirectorPanel
                  connections={connections}
                  assets={assets}
                  canvasId={canvasId ?? ""}
                  selectedNode={selectedNode}
                  selectedPrompt={selectedGeneratedPrompt}
                  draftRequest={agentDraftRequest}
                  canvasRevision={canvasRevisionValue}
                  viewport={viewport}
                  onPreviewPatch={(patch) => applyDirectorPreviewPatch(patch)}
                  onApproved={applyDirectorApproval}
                  onManageApi={() => {
                    setSettingsInitialCangyuanGroup(null);
                    setSettingsOpen(true);
                  }}
                />
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
            </div>
          )}
        </aside>
      </main>
      {saveConflict ? (
        <CanvasSaveConflictModal
          open={saveConflictOpen}
          currentRevision={saveConflict.currentRevision}
          onClose={() => setSaveConflictOpen(false)}
          onExport={() => exportProject(true)}
          onReload={() => {
            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = null;
            pendingSave.current = null;
            if (canvasId) {
              const localConfigurations = readPendingNodeConfigurations().filter(
                (entry) => entry.canvasId === canvasId,
              );
              clearPersistedNodeConfigurations(localConfigurations);
            }
            // Invalidate callbacks from a save that was already in flight;
            // the reload must start from the server snapshot only.
            latestSaveAttempt.current += 1;
            saveConflictRef.current = null;
            conflictedSave.current = null;
            setSaveConflict(null);
            setSaveConflictOpen(false);
            window.location.reload();
          }}
        />
      ) : null}
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
      {pendingProjectImport ? (
        <ProjectImportModal
          prepared={pendingProjectImport}
          busy={projectImportBusy}
          backupCurrent={projectImportBackup}
          progress={projectImportProgress}
          error={projectImportError}
          onBackupCurrentChange={setProjectImportBackup}
          onCancel={() => {
            if (projectImportBusy) return;
            setPendingProjectImport(null);
            setProjectImportError(null);
            setProjectImportProgress(null);
          }}
          onConfirm={() => void confirmProjectImport()}
        />
      ) : null}
      <GenerationHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        assets={assets}
        onReuseAsset={reuseHistoricalAsset}
        onDeleteAssets={deleteHistoricalAssets}
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
      <RunHistoryModal
        open={runHistoryOpen}
        onClose={() => setRunHistoryOpen(false)}
        canvasId={canvasId}
        onReuseAsset={reuseHistoricalAsset}
        onResumeRun={async (runId) => {
          const snapshot = await resumeRun(runId);
          applyRunSnapshot(snapshot, snapshot.run.clientRequestId);
          if (!terminalRunStatuses.has(snapshot.run.status))
            subscribeToRun(snapshot.run.id);
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
      <AppUpdateModal
        open={appUpdateOpen}
        status={appUpdateStatus}
        busy={appUpdateBusy}
        reloadReady={appUpdateReloadReady}
        onReload={() => window.location.reload()}
        onClose={() => setAppUpdateOpen(false)}
        onCheck={() => void runAppUpdateAction("check")}
        onDownload={() => void runAppUpdateAction("download")}
        onApply={() => void runAppUpdateAction("apply")}
        onDefer={() => void runAppUpdateAction("defer")}
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
  const [projects, setProjects] = useState<ProjectSummaryView[] | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadProjects = useCallback(async () => {
    try {
      const next = await fetchProjects();
      setProjects(next);
      setActiveProjectId((current) =>
        current && next.some((project) => project.id === current)
          ? current
          : (next[0]?.id ?? null),
      );
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "项目列表读取失败");
    }
  }, []);

  useEffect(() => {
    // Initial project discovery synchronizes the shell with the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadProjects();
  }, [reloadProjects]);

  const handleCreateProject = useCallback(async (title: string) => {
    const project = await createProject(title);
    setProjects((current) =>
      current ? [project, ...current.filter((item) => item.id !== project.id)] : [project],
    );
    setActiveProjectId(project.id);
  }, []);

  const handleCleanupProject = useCallback(async (projectId: string) => {
    const result = await cleanupProjectDraft(projectId);
    if (result.failed.length > 0)
      throw new Error(`已清理 ${result.deleted} 项，另有 ${result.failed.length} 项失败`);
  }, []);

  const handleOpenProjectFolder = useCallback(async (projectId: string) => {
    await openProjectFolder(projectId);
  }, []);

  const handleRenameProject = useCallback(
    async (projectId: string, title: string) => {
      const result = await renameProject(projectId, title);
      setProjects((current) =>
        current?.map((project) =>
          project.id === projectId ? result.project : project,
        ) ?? null,
      );
      return result;
    },
    [],
  );

  const handleDeleteProject = useCallback(async (projectId: string) => {
    const result = await deleteProject(projectId);
    setProjects((current) =>
      current?.filter((project) => project.id !== projectId) ?? null,
    );
    setActiveProjectId((current) =>
      current === projectId ? result.nextProjectId : current,
    );
    return result.warning;
  }, []);

  if (!projects || !activeProjectId) {
    return (
      <div className="shell" aria-busy="true">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">✦</span>
            <span>{APP_NAME}</span>
          </div>
        </header>
        <main className="workspace project-bootstrap">
          <div className="canvas-empty-state" role={error ? "alert" : "status"}>
            <h2>{error ? "项目加载失败" : "正在加载项目…"}</h2>
            <p>{error ?? "正在读取项目对话和画布，请稍候。"}</p>
            {error ? (
              <button className="button primary small" type="button" onClick={() => void reloadProjects()}>
                <RefreshCw size={13} /> 重新加载
              </button>
            ) : null}
          </div>
        </main>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <CanvasShell
        projectId={activeProjectId}
        projects={projects}
        onSelectProject={setActiveProjectId}
        onCreateProject={handleCreateProject}
        onCleanupProject={handleCleanupProject}
        onOpenProjectFolder={handleOpenProjectFolder}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
      />
    </ReactFlowProvider>
  );
}

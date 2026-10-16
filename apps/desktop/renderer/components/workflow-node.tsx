"use client";

import { cliOperationForNode } from "../lib/cli-input-ports";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import musicStyles from "./music-node.module.css";
import resultStyles from "./result-feedback.module.css";
import {
  Handle,
  NodeResizeControl,
  NodeToolbar,
  Position,
  useStoreApi,
  type NodeProps,
} from "@xyflow/react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  CircleAlert,
  Brush,
  ExternalLink,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  Music,
  Play,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Type,
  Upload,
  X,
} from "lucide-react";
import { renderPromptParts } from "@super-canvas/core";
import { localizeRunError } from "../lib/error-localization";
import { taskOutcomeLabel, taskOutcomeNote } from "../lib/task-evidence";
import { TaskEvidence } from "./task-evidence";
import { ResultActions } from "./result-actions";
import { ResultFailureFeedback } from "./result-failure-feedback";
import { ReadableName, ResultInformation, ResultToolbar, WaitElapsed } from "./result-information";
import { pendingGeneratedResultLabel } from "../lib/pending-run-reconciliation";
import { cleanModelDisplayName } from "../lib/model-display";
import { modelPickerPriceData } from "../lib/model-picker-data";
import { SupplierBillingSummary } from "./supplier-billing-summary";
import { useSupplierBillingOverview } from "../lib/client-supplier-billing";
import { billingCompact } from "../lib/supplier-billing-display";
import { choosePickerConnection, pickerConnectionGroups, pickerConnectionLabel } from "../lib/model-picker";
import { ModelPicker } from "./model-picker";
import { ModelPriceDetails } from "./model-price-details";
import {
  fetchCangyuanAvailability,
} from "../lib/client-api";
import { cangyuanAvailabilityForModel, receiveModelAvailabilitySnapshot, CANGYUAN_AVAILABILITY_REFRESH_MS,
  type ModelAvailabilitySnapshot } from "../lib/cangyuan-availability-ui";
import { CangyuanAvailabilityBadge, CangyuanModelAvailability } from "./cangyuan-model-availability";
import { NodeParameterFields } from "./node-parameter-fields";
import { parameterDescriptorsForValues } from "../lib/model-parameters";
import { ModelResolutionShortcuts } from "./model-resolution-shortcuts";
import { shouldReselectNodeFromConfigPointer } from "../lib/node-config-pointer";
import { placeNodeConfigPanel } from "../lib/node-config-placement";
import { PromptEditor } from "./prompt-editor";
import { AssetPreviewImage } from "./asset-preview-image";
import { useResultPreviewSize } from "../lib/use-result-preview-size";
import { hasImageMask, IMAGE_REFERENCE_NODE_MIN_HEIGHT, MASK_EDIT_NODE_MIN_HEIGHT } from "../lib/generation-node-layout";
import type { CanvasNode, CanvasNodeData, RunErrorDetails } from "./types";
import { NodeStateLabel } from "./node-state-label";
import { assetHasKnownAlpha, nodeVisualStatus } from "../lib/node-state-presentation";
import { canvasMotionEnabled } from "./canvas-motion";
import { DeferredPanelContent } from "./deferred-panel-content";
import { nodePortTop } from "../lib/node-port-layout";
import { acquireNodeConfigSurfaceMarkers } from "../lib/node-config-surface-markers";

const ASSET_DRAG_TYPE = "application/x-super-canvas-asset";

function handleAssetDragStart(
  event: React.DragEvent<HTMLElement>,
  assetId: string | undefined,
) {
  if (!assetId) return;
  event.stopPropagation();
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(ASSET_DRAG_TYPE, assetId);
  event.dataTransfer.setData("text/plain", assetId);
}

const icons: Record<string, React.ReactNode> = {
  "asset-input": <Upload size={14} />,
  prompt: <Type size={14} />,
  "image-generation": <ImageIcon size={14} />,
  "video-generation": <Film size={14} />,
  "music-generation": <Music size={14} />,
  preview: <Send size={14} />,
};

function portTop(
  node: CanvasNode,
  direction: "input" | "output",
  index: number,
  total: number,
): string {
  return nodePortTop(node.data.nodeType, direction, index, total);
}

function formatMediaDuration(seconds: number | undefined): string | null {
  if (seconds === undefined || !Number.isFinite(seconds)) return null;
  return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
}

function generatedResultProvenance(data: CanvasNodeData): string | null {
  const parameters = data.generatedParameters ?? {};
  const connection =
    data.generatedGroup ??
    data.generatedConnectionName?.replace(/^.+?\s*·\s*/u, "");
  const sizeValue = parameters.size ?? parameters.image_size;
  const size =
    typeof sizeValue === "string" ? sizeValue.replace(/x/giu, "×") : null;
  const ratioValue = parameters.aspect_ratio ?? parameters.aspectRatio;
  const ratio = typeof ratioValue === "string" ? ratioValue : null;
  const qualityValue =
    parameters.quality ??
    (typeof data.generatedModel === "string"
      ? /^gpt-image-2-(low|medium|high)$/u.exec(data.generatedModel)?.[1]
      : undefined);
  const quality =
    typeof qualityValue === "string" ? qualityValue.toUpperCase() : null;
  let time: string | null = null;
  if (data.generatedCreatedAt) {
    const date = new Date(data.generatedCreatedAt);
    if (!Number.isNaN(date.getTime())) {
      const twoDigits = (value: number) => String(value).padStart(2, "0");
      time = `${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;
    }
  }
  const runTag = data.generatedFromRunId
    ? `#${data.generatedFromRunId.slice(0, 8)}`
    : data.generatedPendingRequestId
      ? `#${data.generatedPendingRequestId.slice(0, 8)}`
      : null;
  const parts = [
    runTag,
    time,
    connection,
    data.generatedModel,
    size,
    ratio && ratio !== size ? ratio : null,
    quality,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function LinkedAssetStrip({ data }: { data: CanvasNodeData }) {
  const linked = data.linkedAssets ?? [];
  if (linked.length === 0) return null;
  const indexes = { image: 0, video: 0, audio: 0 };

  return (
    <div className="node-linked-assets nodrag nowheel nopan">
      <div className="node-linked-assets-list">
        {linked.map((asset) => {
          if (asset.kind === "text") return null;
          const index = ++indexes[asset.kind];
          const kindLabel =
            asset.kind === "image"
              ? "图片"
              : asset.kind === "video"
                ? "视频"
                : "音频";
          const duration = formatMediaDuration(
            data.linkedAssetDurations?.[asset.id],
          );
          const src =
            asset.kind === "image"
              ? `/api/assets/${encodeURIComponent(asset.id)}/preview?size=160`
              : `/api/assets/${encodeURIComponent(asset.id)}/content`;
          const recordDuration = (
            event: React.SyntheticEvent<HTMLMediaElement>,
          ) => {
            const seconds = event.currentTarget.duration;
            if (Number.isFinite(seconds) && seconds > 0) {
              data.onLinkedAssetDuration?.(asset.id, seconds);
            }
          };
          return (
            <div
              className={`node-linked-asset ${asset.kind}`}
              key={asset.id}
              title={asset.name}
              draggable
              onDragStart={(event) => handleAssetDragStart(event, asset.id)}
            >
              <button
                type="button"
                className="node-linked-asset-remove nodrag nopan"
                aria-label={`移除素材 ${asset.name} 并断开连线`}
                title="移除素材并断开连线"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  data.onRemoveLinkedAsset?.(asset.id);
                }}
              >
                <X size={10} strokeWidth={2.4} />
              </button>
              <div
                className={`node-linked-asset-preview ${asset.kind === "image" ? "previewable-image" : ""}`}
                onDoubleClick={(event) => {
                  if (asset.kind !== "image") return;
                  event.stopPropagation();
                  data.onOpenPreview?.(asset.id);
                }}
              >
                {asset.kind === "image" ? (
                  <AssetPreviewImage
                    key={asset.id}
                    assetId={asset.id}
                    compact
                    src={src}
                    alt={asset.name}
                    title="双击查看原图"
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                  />
                ) : asset.kind === "video" ? (
                  <video
                    src={src}
                    muted
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={recordDuration}
                  />
                ) : (
                  <>
                    <Music size={18} />
                    <audio
                      src={src}
                      preload="metadata"
                      onLoadedMetadata={recordDuration}
                    />
                  </>
                )}
              </div>
              <span className="node-linked-asset-copy">
                <strong>
                  {kindLabel} {index}
                  {duration ? ` · ${duration}` : ""}
                </strong>
                <small>{asset.name}</small>
              </span>
            </div>
          );
        })}
      </div>
      {data.linkedAssetLimitText ? (
        <small className="node-linked-limit">{data.linkedAssetLimitText}</small>
      ) : null}
      {(data.linkedAssetWarnings ?? []).map((warning) => (
        <div className="node-linked-warning" role="alert" key={warning}>
          <CircleAlert size={12} />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  );
}

function PortHandles({
  node,
  direction,
}: {
  node: CanvasNode;
  direction: "input" | "output";
}) {
  const data = node.data as CanvasNodeData;
  const ports =
    direction === "input" ? (data.inputs ?? []) : (data.outputs ?? []);
  return (
    <>
      {ports.map((port, index) => (
        <span key={`${direction}-${port.id}`}>
          <Handle
            id={port.id}
            type={direction === "input" ? "target" : "source"}
            position={direction === "input" ? Position.Left : Position.Right}
            style={{ top: portTop(node, direction, index, ports.length), "--port-color": `var(--port-${port.kind.replace(/\[\]$/u, "")}, var(--port-asset))` } as React.CSSProperties}
            aria-label={`${direction === "input" ? "输入" : "输出"} ${port.label}（${port.kind}）`}
            title={`${port.label} · ${port.kind} · ${data.portConnectionCounts?.[direction][port.id] ?? 0} 个连接`}
            data-port-kind={port.kind}
            data-connection-active={
              data.connectionPreviewActive ? "true" : undefined
            }
            data-connection-compatible={
              direction === "input" &&
              data.compatibleInputIds?.includes(port.id)
                ? "true"
                : undefined
            }
          />
          <span
            className={`port-label node-port-title ${direction === "input" ? "left" : "right"}`}
            title={`${port.label} · ${port.kind} · ${data.portConnectionCounts?.[direction][port.id] ?? 0} 个连接`}
            style={{ top: portTop(node, direction, index, ports.length) }}
          >
            {port.label}
          </span>
        </span>
      ))}
    </>
  );
}

function CanvasPromptEditor({data, active}: {data: CanvasNodeData; active: boolean}) {
  const placeholder = data.nodeType === "image-generation" && hasImageMask(data.parameters)
    ? "描述涂抹区域要如何修改，例如：将衣服改成蓝色…"
    : data.nodeType === "music-generation" ? "描述曲风、乐器、人声和情绪…" : "输入提示词，描述你希望生成的内容…";
  // Selection, dragging and opening parameters are reading operations. Only
  // an explicit click/keyboard action on the prompt creates an editor.
  const [editing, setEditing] = useState(false);
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setEditing(false);
  }
  const compact = !editing;
  const host = useRef<HTMLDivElement>(null);
  const focusRequested = useRef(false);
  useEffect(() => {
    if (!compact && focusRequested.current) {
      focusRequested.current = false;
      // Wait for the editor mount and the activating pointer event's default focus.
      const frame = requestAnimationFrame(() =>
        host.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus({preventScroll:true}),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [compact]);
  const activate = () => { focusRequested.current = true; data.onSelect?.(); setEditing(true); };
  return <div ref={host} className="canvas-prompt-content">
    {compact ? <div className="prompt-overview" role="button" tabIndex={0} aria-label={`编辑 ${data.label} 提示词`}
      onPointerDownCapture={(event) => {if(!event.ctrlKey && !event.metaKey)focusRequested.current=true;}}
      onClick={(event) => {if(!event.ctrlKey && !event.metaKey)activate();}}
      onKeyDown={(event) => {if((event.key==="Enter" || event.key===" ") && !event.ctrlKey && !event.metaKey){event.preventDefault();activate();}}}>
      {renderPromptParts(data.parts ?? [], {resolveAsset:(id) => data.assets?.find(asset=>asset.id===id)?.name ?? "参考素材"}) || placeholder}
    </div> : <PromptEditor parts={data.parts ?? [{type:"text",text:""}]} assets={data.assets ?? []} mentionAssets={data.mentionAssets ?? []}
      onChange={(parts) => data.onPromptPartsChange?.(parts)} ariaLabel={`编辑 ${data.label} 提示词`} placeholder={placeholder} />}
  </div>;
}

export interface GenerationNodeBodyProps {
  nodeId: string;
  data: CanvasNodeData;
  active: boolean;
  /** Fixed for this instance's lifetime; parameter instances are owned by root. */
  presentation?: "node" | "parameters";
  onRequestClose?: () => void;
  onRequestFocus?: () => void;
  registerPanelElement?: (element: HTMLElement | null) => void;
}

export function GenerationNodeBody({
  nodeId,
  data,
  active,
  presentation = "node",
  onRequestClose,
  onRequestFocus,
  registerPanelElement,
}: GenerationNodeBodyProps) {
  const [localSettingsOpen, setLocalSettingsOpen] = useState(false);
  const settingsOpen = presentation === "parameters" || localSettingsOpen;
  const uiActive = settingsOpen && (presentation !== "parameters" || active);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const onConfigurationOpenChange = data.onConfigurationOpenChange;
  useLayoutEffect(() => {
    if (presentation === "parameters" || !settingsOpen) return;
    onConfigurationOpenChange?.(nodeId, true);
    return () => onConfigurationOpenChange?.(nodeId, false);
  }, [nodeId, onConfigurationOpenChange, settingsOpen, presentation]);
  // Only standalone legacy consumers attach their local panel to node space.
  const [settingsHost, setSettingsHost] = useState<HTMLElement | null>(null);
  const settingsPopoverRef = useRef<HTMLElement | null>(null);
  const settingsTrigger = useRef<HTMLButtonElement | null>(null);
  const settingsBody = useRef<HTMLDivElement | null>(null);
  const flowStore = useStoreApi<CanvasNode>();
  const attachSettingsPopover = useCallback((element: HTMLElement | null) => {
    settingsPopoverRef.current = element;
    registerPanelElement?.(element);
  }, [registerPanelElement]);
  const closeSettings = useCallback(() => {
    // Width/height drafts commit on native blur. React unmount alone does not
    // deliver that event; commit only this card's active field before closing.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && settingsPopoverRef.current?.contains(focused)) focused.blur();
    setModelMenuOpen(false);
    if (presentation === "parameters") onRequestClose?.();
    else setLocalSettingsOpen(false);
  }, [presentation, onRequestClose]);
  const attachSettingsTrigger = useCallback((trigger: HTMLButtonElement | null) => {
    settingsTrigger.current = trigger;
    setSettingsHost(trigger?.closest<HTMLElement>(".react-flow__node") ?? null);
  }, []);
  useLayoutEffect(() => {
    if (presentation === "parameters") return;
    const popover = settingsPopoverRef.current;
    if (!settingsOpen || !settingsHost || !popover) return;
    const releaseSurfaceMarkers = acquireNodeConfigSurfaceMarkers(settingsHost);
    const canvas = settingsHost.closest<HTMLElement>(".canvas-wrap");
    const rail = settingsHost.closest(".canvas-editor")?.querySelector<HTMLElement>(".editor-rail");
    if (!canvas) return releaseSurfaceMarkers;
    const toolSelector = ".canvas-toolbar, .react-flow__controls, .react-flow__minimap";
    let viewportTools = [...canvas.querySelectorAll<HTMLElement>(toolSelector)];
    let active = true;
    let placementFrame = 0;
    let environment: { canvasBounds: DOMRect; railBounds?: DOMRect; obstacles: DOMRect[] } | null = null;
    let previousPlacementGeometry: number[] | undefined;
    // Detached controls must not stay alive until the parameter panel closes.
    const observedSizes = new WeakMap<Element, readonly [number, number]>();
    const rememberSize = (element: Element, bounds: DOMRect, scale = 1) => {
      observedSizes.set(element, [bounds.width / scale, bounds.height / scale]);
    };
    const readEnvironment = () => {
      if (environment) return environment;
      const canvasBounds = canvas.getBoundingClientRect();
      const railBounds = rail?.getBoundingClientRect();
      rememberSize(canvas, canvasBounds);
      if (rail && railBounds) rememberSize(rail, railBounds);
      const obstacles = viewportTools.map(tool => {
        const bounds = tool.getBoundingClientRect();
        rememberSize(tool, bounds);
        return bounds;
      }).filter(bounds => bounds.width > 0 && bounds.height > 0);
      environment = { canvasBounds, railBounds, obstacles };
      return environment;
    };
    const place = () => {
      const settingsZoom = flowStore.getState().transform[2];
      if (!active || !Number.isFinite(settingsZoom) || settingsZoom <= 0) return;
      const hostBounds = settingsHost.getBoundingClientRect();
      rememberSize(settingsHost, hostBounds, settingsZoom);
      // Panning transforms the node, while viewport tools stay in screen space.
      // Reuse their rectangles until an actual size/layout change invalidates them.
      const { canvasBounds, railBounds, obstacles } = readEnvironment();
      const leftBoundary = Math.max(canvasBounds.left + 8,
        railBounds && railBounds.width > 0 && railBounds.height > 0 ? railBounds.right + 8 : 0);
      const rightBoundary = Math.min(canvasBounds.right, window.innerWidth) - 8;
      if (hostBounds.width <= 0 || rightBoundary <= leftBoundary) return;
      const geometry = [settingsZoom, window.innerWidth, window.innerHeight,
        hostBounds.left, hostBounds.top, hostBounds.right, hostBounds.bottom,
        canvasBounds.left, canvasBounds.top, canvasBounds.right, canvasBounds.bottom,
        railBounds?.left ?? 0, railBounds?.top ?? 0, railBounds?.right ?? 0, railBounds?.bottom ?? 0,
        ...obstacles.flatMap(bounds => [bounds.left, bounds.top, bounds.right, bounds.bottom])];
      if (previousPlacementGeometry?.length === geometry.length &&
        geometry.every((value, index) => value === previousPlacementGeometry![index])) return;
      previousPlacementGeometry = geometry;
      const placement = placeNodeConfigPanel({
        node: hostBounds,
        viewport: {
          left: leftBoundary, right: rightBoundary,
          top: Math.max(canvasBounds.top, 0) + 8,
          bottom: Math.min(canvasBounds.bottom, window.innerHeight) - 8,
        },
        obstacles,
        zoom: settingsZoom,
      });
      // The portal remains inside the transformed node. Convert only its
      // visual placement to local coordinates; never move or resize the node.
      const next = { left: (placement.left - hostBounds.left) / settingsZoom, width: placement.width / settingsZoom,
        top: (placement.top - hostBounds.top) / settingsZoom, maxHeight: placement.maxHeight / settingsZoom };
      // Placement belongs to the transformed DOM layer. Updating React state
      // here used to rerender all model/parameter controls on every pan frame.
      for (const key of ["left", "top", "width", "maxHeight"] as const) {
        const value = `${next[key]}px`;
        if (popover.style[key] !== value) popover.style[key] = value;
      }
      // The top-layer model menu follows this inspector without invalidating
      // either component's React content during canvas geometry changes.
      popover.dispatchEvent(new Event("canvas-node-config-position"));
    };
    const schedulePlacement = () => {
      if (!active || placementFrame) return;
      placementFrame = window.requestAnimationFrame(() => {
        placementFrame = 0;
        place();
      });
    };
    const invalidateEnvironment = () => {
      environment = null;
      schedulePlacement();
    };
    const readGeometry = () => {
      const state = flowStore.getState();
      const node = state.nodeLookup.get(nodeId);
      return [...state.transform, node?.internals.positionAbsolute.x,
        node?.internals.positionAbsolute.y, node?.measured.width, node?.measured.height];
    };
    // React Flow mutates nodeLookup in place. Compare scalar snapshots rather
    // than the previous map, which can already contain the current geometry.
    let previousGeometry = readGeometry();
    const unsubscribe = flowStore.subscribe(() => {
      const geometry = readGeometry();
      if (geometry.some((value, index) => value !== previousGeometry[index])) {
        previousGeometry = geometry;
        schedulePlacement();
      }
    });
    place();
    const observer = new ResizeObserver(entries => {
      const changed = entries.some(entry => {
        const size = entry.borderBoxSize[0];
        const previous = observedSizes.get(entry.target);
        return !size || !previous || Math.abs(previous[0] - size.inlineSize) > .01 || Math.abs(previous[1] - size.blockSize) > .01;
      });
      // ResizeObserver delivers initial entries even when the first synchronous
      // placement already measured the same boxes. Avoid a redundant first RAF.
      if (changed) invalidateEnvironment();
    });
    observer.observe(settingsHost);
    observer.observe(canvas);
    // Placement uses available viewport space, not the panel's content height.
    // The deferred body and its scroll height cannot change these inputs.
    if (rail) observer.observe(rail);
    for (const tool of viewportTools) observer.observe(tool);
    const toolPositionObserver = new MutationObserver(records => {
      const toolsChanged = records.some(record => record.type === "childList" &&
        [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element &&
          (node.matches(toolSelector) || node.querySelector(toolSelector))));
      if (toolsChanged) {
        const nextTools = [...canvas.querySelectorAll<HTMLElement>(toolSelector)];
        for (const tool of viewportTools) if (!nextTools.includes(tool)) observer.unobserve(tool);
        for (const tool of nextTools) if (!viewportTools.includes(tool)) observer.observe(tool);
        viewportTools = nextTools;
      }
      if (toolsChanged || records.some(record => record.type === "attributes" && record.target === canvas)) invalidateEnvironment();
    });
    toolPositionObserver.observe(canvas, {
      attributes: true, attributeFilter: ["data-compact-tools"], childList: true, subtree: true,
    });
    window.addEventListener("resize", invalidateEnvironment);
    return () => {
      active = false;
      releaseSurfaceMarkers();
      window.cancelAnimationFrame(placementFrame);
      unsubscribe();
      observer.disconnect();
      toolPositionObserver.disconnect();
      window.removeEventListener("resize", invalidateEnvironment);
    };
  }, [flowStore, nodeId, settingsHost, settingsOpen, presentation]);
  useLayoutEffect(() => {
    if (!uiActive) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      // A modal opened from a keyboard shortcut owns Escape before this
      // nonmodal parameter panel; its useDialogFocus handler runs in bubble.
      if ([...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')]
        .some(dialog => dialog !== settingsPopoverRef.current && dialog.getClientRects().length > 0)) return;
      // Native popups own the first Escape. Once closed, a focused select in
      // the root card must not permanently block its ordinary close shortcut.
      if (event.target instanceof HTMLSelectElement &&
          (presentation !== "parameters" || event.target.matches(":open"))) return;
      if (event.target instanceof Element && event.target.closest(".node-model-select[data-open]")) return;
      event.stopImmediatePropagation();
      closeSettings();
      if (presentation !== "parameters") settingsTrigger.current?.focus();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [uiActive, closeSettings, presentation]);
  const modelSelectRef = useRef<HTMLDivElement | null>(null);
  const [availabilitySnapshot, setAvailabilitySnapshot] = useState<ModelAvailabilitySnapshot>(
    { connectionId: "", items: [], state: "idle" });
  const [, setAvailabilityClock] = useState(0);
  useEffect(() => {
    if (!uiActive) return;
    // Even a stalled refresh must eventually lose its healthy badge.
    const timer = setInterval(() => setAvailabilityClock(value => value + 1), CANGYUAN_AVAILABILITY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [uiActive]);
  const nodeType =
    data.nodeType === "video-generation"
      ? "video-generation"
      : data.nodeType === "music-generation" ? "music-generation" : "image-generation";
  const parameters = data.parameters ?? {};
  const maskEnabled = nodeType === "image-generation" && hasImageMask(parameters);
  const maskSource = data.linkedAssets?.find(asset => asset.kind === "image");
  const maskSourceChanged = Boolean(maskEnabled && parameters.maskAssetId && maskSource && parameters.maskSourceAssetId !== maskSource.id);
  const maskProblem = !maskEnabled ? null
    : !maskSource ? "请连接蒙版对应的原图"
    : maskSourceChanged ? "原图已改变，请重新绘制蒙版"
    : !data.connectionId || !data.model ? "请选择可编辑模型后再生成"
    : data.modelOptionsLoading ? "正在核对模型能力…"
    : data.modelOptionsError ? "模型列表读取失败，请重试"
    : !data.imageEditingCapabilities?.mask ? "当前模型不支持蒙版，请更换模型"
    : null;
  const currentConnection =
    data.connectionId || (data.provider === "fake" ? "fake-default" : "");
  // A delayed catalog may resolve the default model after the user opens the
  // list. Keep that list usable; explicit option clicks close it themselves.
  const menuContext = JSON.stringify([settingsOpen, currentConnection]);
  const [previousMenuContext, setPreviousMenuContext] = useState(menuContext);
  if (previousMenuContext !== menuContext) {
    setPreviousMenuContext(menuContext);
    setModelMenuOpen(false);
  }
  // Deactivation closes top-layer menus. Becoming active must not clear a
  // menu opened by the very pointer event that focused this retained card.
  if (!uiActive && modelMenuOpen) setModelMenuOpen(false);
  const previousScrollContext = useRef<readonly [boolean, string, string | undefined] | null>(null);
  useLayoutEffect(() => {
    const next = [settingsOpen, currentConnection, data.model] as const;
    const previous = previousScrollContext.current;
    previousScrollContext.current = next;
    // A new scroll container already starts at zero. Writing scrollTop on its
    // first layout effect forces the pending panel styles/layout synchronously.
    // Existing cards still reset after a real open/connection/model change.
    if (previous && next.some((value, index) => value !== previous[index]) && settingsBody.current)
      settingsBody.current.scrollTop = 0;
  }, [settingsOpen, currentConnection, data.model]);
  const connectionOptions = data.connectionOptions ?? [];
  const currentConnectionOption = connectionOptions.find(
    (connection) => connection.id === currentConnection,
  );
  const connectionAvailable = Boolean(
    currentConnectionOption && currentConnectionOption.available !== false,
  );
  const supplierOptions = Array.from(
    new Map(
      connectionOptions.map((connection) => [
        connection.supplier,
        connection.supplierLabel,
      ]),
    ),
  );
  const currentSupplier = currentConnectionOption?.supplier ?? "";
  const groupOptions = pickerConnectionGroups(connectionOptions, currentSupplier);
  const currentGroup = currentConnectionOption?.group ?? "";
  const currentGroupConnections = groupOptions.find(group => group.group === currentGroup)?.connections ?? [];
  const connectionName = currentConnectionOption
    ? `${currentConnectionOption.supplierLabel} · ${currentConnectionOption.group} · ${currentConnectionOption.name}`
    : currentConnection
      ? "当前 API"
      : "未配置 API";
  const modelOptions = useMemo<NonNullable<CanvasNodeData["modelOptions"]>>(() => {
    const options = data.modelOptions ?? [];
    if (data.model && options.length === 0 && !data.modelOptionsAuthoritative && !data.modelOptionsLoading) {
      return [{ id: data.model, name: data.model, operations: [] }];
    }
    return options;
  }, [data.modelOptions, data.model, data.modelOptionsAuthoritative, data.modelOptionsLoading]);
  const billingAccounts = useSupplierBillingOverview(uiActive);
  const selectedModel = modelOptions.find((model) => model.id === data.model);
  const modelPriceLabel = useMemo(() => modelPickerPriceData(selectedModel), [selectedModel]);
  const hasReferenceVideo = data.linkedAssets?.some(asset => asset.kind === "video") === true;
  const priceParameters = { ...parameters,
    has_reference_video: hasReferenceVideo,
    has_reference_image: data.linkedAssets?.some(asset => asset.kind === "image") === true,
    has_reference_audio: data.linkedAssets?.some(asset => asset.kind === "audio") === true,
  };
  const priceModel = selectedModel && nodeType === "video-generation" ? {
    ...selectedModel,
    parameters: parameterDescriptorsForValues(nodeType, data.provider ?? "fake", selectedModel, parameters, undefined, { hasReferenceVideo }),
  } : selectedModel;
  const modelName = selectedModel ? cleanModelDisplayName(selectedModel.name, selectedModel.metadata?.priceLabel) : data.model ?? "自动模型";
  const cangyuanAvailabilityEnabled =
    currentSupplier === "cangyuan" && nodeType !== "music-generation" &&
    Boolean(currentConnection) &&
    connectionAvailable;
  const availabilityItems =
    availabilitySnapshot.connectionId === currentConnection
      ? availabilitySnapshot.items
      : [];
  const availabilityState =
    availabilitySnapshot.connectionId === currentConnection
      ? availabilitySnapshot.state
      : cangyuanAvailabilityEnabled
        ? "loading"
        : "idle";
  const availabilityOptions = { category: nodeType === "video-generation" ? "video" : "image", group: currentGroup };
  const selectedAvailability = selectedModel ? cangyuanAvailabilityForModel(selectedModel, availabilityItems, availabilityOptions) : undefined;
  const parameterControlsUnavailable =
    selectedModel?.metadata?.parameterControlsUnavailable === true;
  const summary =
    nodeType === "music-generation" ? [parameters.instrumental ? "纯音乐" : "歌曲", parameters.audio_format ? String(parameters.audio_format).toUpperCase() : "MP3", parameters.duration ? `目标 ${parameters.duration}s` : null].filter(Boolean).join(" · ") : nodeType === "video-generation"
      ? parameterControlsUnavailable
        ? ""
        : [
            parameters.duration ? `${parameters.duration}s` : null,
            parameters.aspect_ratio ?? parameters.ratio,
            parameters.resolution,
          ]
            .filter(Boolean)
            .join(" · ")
      : [
          parameters.image_size ?? parameters.size_tier,
          parameters.size === "auto" && parameters.size_tier
            ? "自动比例"
            : (parameters.aspect_ratio ?? parameters.size),
          parameters.quality,
        ]
          .filter(Boolean)
          .join(" · ");
  const running = ["queued", "submitting", "running", "archiving"].includes(
    data.status ?? "",
  );

  const selectNode = (event?: { ctrlKey: boolean; metaKey: boolean }) =>
    data.onSelect?.(Boolean(event?.ctrlKey || event?.metaKey));
  const commitPromptBeforeRun = () => {
    // The editor batches updates briefly for smooth typing. Blur commits the
    // latest transaction immediately so Run cannot submit stale prompt text.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(".tiptap-prompt")) {
      active.blur();
    }
  };

  useEffect(() => {
    if (!uiActive || !modelMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !modelSelectRef.current?.contains(event.target)
      )
        setModelMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModelMenuOpen(false);
    };
    // Panel controls stop bubbling to the canvas. Observe outside presses in
    // capture so another field also dismisses the list before it handles input.
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [uiActive, modelMenuOpen]);

  useEffect(() => {
    if (!uiActive || !cangyuanAvailabilityEnabled) return;

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      setAvailabilitySnapshot((current) => ({
        connectionId: currentConnection,
        items: current.connectionId === currentConnection ? current.items : [],
        checkedAt:
          current.connectionId === currentConnection
            ? current.checkedAt
            : undefined,
        state:
          current.connectionId === currentConnection && current.items.length > 0
            ? current.state
            : "loading",
      }));
      try {
        const snapshot = await fetchCangyuanAvailability(currentConnection);
        if (cancelled) return;
        setAvailabilitySnapshot(current => receiveModelAvailabilitySnapshot(current, currentConnection, snapshot));
      } catch {
        if (cancelled) return;
        setAvailabilitySnapshot((current) => ({
          connectionId: currentConnection,
          items:
            current.connectionId === currentConnection ? current.items : [],
          checkedAt:
            current.connectionId === currentConnection
              ? current.checkedAt
              : undefined,
          state: "error",
        }));
      } finally {
        if (!cancelled)
          refreshTimer = setTimeout(refresh, CANGYUAN_AVAILABILITY_REFRESH_MS);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [cangyuanAvailabilityEnabled, currentConnection, uiActive]);

  const settingsPopover = settingsOpen ? (
    <section
      // Portals still participate in React Flow's capture handlers. `nokey`
      // keeps its Ctrl-selection handler from swallowing these form events.
      className={`node-config-popover node-config-popover-portal nodrag nowheel nopan nokey${presentation === "parameters" ? " node-config-docked" : ""}`}
      ref={attachSettingsPopover}
      id={`${presentation === "parameters" ? "canvas-parameters" : "node-parameters"}-${nodeId}`}
      data-config-node-id={nodeId}
      role="dialog"
      tabIndex={-1}
      aria-label={`${data.label} 模型与参数`}
      onAnimationEnd={event => {
        if (event.target === event.currentTarget) {
          event.currentTarget.dispatchEvent(new Event("canvas-node-config-position"));
        }
      }}
      // A portal still bubbles through the owning React node. Native select
      // clicks must not select that node and reopen the inspector mid-popup.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onFocusCapture={() => {
        if (presentation === "parameters") { if (!active) onRequestFocus?.(); }
        else data.onConfigurationFocus?.();
      }}
      onPointerDownCapture={() => {
        if (presentation === "parameters" && !active) onRequestFocus?.();
      }}
      onPointerDown={(event) => {
        if (presentation === "parameters") { event.stopPropagation(); return; }
        const target = event.target instanceof Element ? event.target : null;
        if (!shouldReselectNodeFromConfigPointer(target)) {
          event.stopPropagation();
          return;
        }
        selectNode(event);
      }}
    >
      <header className="node-config-header">
        <div className="node-config-header-content">
          <div className="node-config-title-block">
            <strong>模型与参数</strong>
          </div>
        </div>
        <button
          type="button"
          aria-label="关闭模型与参数面板"
          title="关闭模型与参数面板（Esc）"
          onClick={closeSettings}
        >
          <X size={14} />
        </button>
        <button
          className="node-config-manage-api"
          title="管理供应商与密钥"
          aria-label="管理供应商与密钥"
          type="button"
          onClick={() => {
            closeSettings();
            data.onOpenApiSettings?.();
          }}
        >
          <ExternalLink size={12} /> 管理供应商与密钥
        </button>
      </header>
      <div className="node-config-popover-body" ref={settingsBody}>
        <div className="node-config-connections">
          <div className="node-config-provider-selectors">
            <label className="node-config-provider-header">
              <span>供应商</span>
              <select
                aria-label={`${data.label} 供应商`}
                value={currentSupplier}
                title={currentConnectionOption?.supplierLabel}
                onChange={(event) => {
                  const next = choosePickerConnection(connectionOptions, currentConnection, event.target.value);
                  if (next) data.onConnectionChange?.(next.id);
                }}
              >
                {!currentSupplier && <option value="">{currentConnection ? "原连接已不可用，请选择" : "请选择供应商"}</option>}
                {supplierOptions.map(([supplier, label]) => {
                  const candidate = choosePickerConnection(connectionOptions, currentConnection, supplier);
                  return (
                  <option key={supplier} value={supplier}>
                    {label} · {supplier === currentSupplier ? modelPickerPriceData(selectedModel) : candidate?.modelQuote ?? "—"} · {billingCompact(billingAccounts.find(account => account.id === candidate?.supplierId)?.billing)}
                  </option>
                ); })}
              </select>
            </label>
            <label className="node-config-provider-header">
              <span>群组</span>
              <select
                aria-label={`${data.label} 模型群组`}
                value={currentGroup}
                title={currentGroup}
                onChange={(event) => {
                  const next = choosePickerConnection(connectionOptions, currentConnection, currentSupplier, event.target.value);
                  if (next) data.onConnectionChange?.(next.id);
                }}
              >
                {!currentGroup && <option value="">请选择群组</option>}
                {groupOptions.map((group) => (
                  <option key={group.group} value={group.group} disabled={!group.available && group.group !== currentGroup}>
                    {group.group}{group.connections.length > 1 ? `（${group.connections.length} 个连接）` : ""}{!group.available ? "（连接未就绪）" : ""}
                  </option>
                ))}
              </select>
            </label>
            {currentGroupConnections.length > 1 && <label className="node-config-provider-header" style={{ gridColumn: "1 / -1" }}>
              <span>连接</span>
              <select aria-label={`${data.label} API 连接`} value={currentConnection}
                onChange={event => data.onConnectionChange?.(event.target.value)}>
                {currentGroupConnections.map(connection => <option key={connection.id} value={connection.id}
                  disabled={connection.available === false && connection.id !== currentConnection}>
                  {pickerConnectionLabel(connection, currentGroupConnections)}{connection.available === false ? `（${connection.unavailableReason ?? "密钥不可用"}）` : ""}
                </option>)}
              </select>
            </label>}
          </div>
          <small className="node-config-supplier-quote" aria-label="当前供应商报价">{currentConnectionOption?.supplierLabel ?? "供应商"} · {modelPickerPriceData(selectedModel)} · {billingCompact(billingAccounts.find(account => account.id === currentConnectionOption?.supplierId)?.billing)}</small>
        </div>
        <div className="node-config-model-field node-config-model-header">
          <span>模型</span>
          <div className="node-config-model-control" ref={modelSelectRef}>
            <ModelPicker key={currentConnection} id={`node-inline-model-${nodeId}`} label={`${data.label} 模型`}
              connectionId={currentConnection} models={modelOptions} value={data.model ?? ""}
              capabilities={connectionAvailable ? data.modelImageCapabilities : undefined}
              parameters={{ ...priceParameters, prompt: renderPromptParts(data.parts ?? []) }}
              onChange={id => data.onModelChange?.(id)} open={uiActive && modelMenuOpen} onOpenChange={setModelMenuOpen}
              loading={data.modelOptionsLoading} failed={data.modelOptionsError}
              authoritative={data.modelOptionsAuthoritative} allowManual={!data.modelOptionsAuthoritative}
              catalogDirectory={data.catalogPickerDirectory}
              badge={cangyuanAvailabilityEnabled ? model => <CangyuanAvailabilityBadge
                availability={cangyuanAvailabilityForModel(model, availabilityItems, availabilityOptions)}
                loadState={availabilityState} checkedAt={availabilitySnapshot.checkedAt} /> : undefined} />
          </div>
        </div>

        {cangyuanAvailabilityEnabled && <CangyuanModelAvailability availability={selectedAvailability}
          loadState={availabilityState} checkedAt={availabilitySnapshot.connectionId === currentConnection ? availabilitySnapshot.checkedAt : undefined} />}

        {currentConnection && !currentConnectionOption && <div className="node-config-connection-warning" role="status">原连接已归档或删除（{currentConnection}）。节点选择已保留，请恢复连接或手动选择其他连接。</div>}
        {currentConnectionOption?.available === false ? (
          <div className="node-config-connection-warning" role="status">
            当前实际连接是 {currentConnectionOption.name}（{currentConnectionOption.group}），{currentConnectionOption.unavailableReason ?? "该分组密钥不可用"}。请重新配置或选择其他可用分组。
          </div>
        ) : null}
        <DeferredPanelContent immediate={presentation === "parameters"}>
        <section className="node-config-parameter-section" aria-label="输出参数" key={`${currentConnection}:${data.model}`}>
          <div className="node-config-section-heading">
            <strong>输出参数</strong>
          </div>
          <ModelResolutionShortcuts models={modelOptions} selected={selectedModel} onChange={id => data.onModelChange?.(id)} />
          <NodeParameterFields
            nodeId={nodeId}
            nodeType={nodeType}
            provider={data.provider ?? "fake"}
            operation={cliOperationForNode(nodeType, data.linkedAssets?.some(asset => asset.kind === "image") === true)}
            model={selectedModel ?? null}
            parameters={parameters}
            hasReferenceVideo={hasReferenceVideo}
            transparentSupported={data.imageEditingCapabilities?.transparent === true}
            transparency={data.imageEditingCapabilities?.transparency}
            showAdvanced={false}
            onChange={(nextParameters) =>
              data.onParametersChange?.(nextParameters)
            }
          />
        </section>
        <ModelPriceDetails model={priceModel} parameters={{ ...priceParameters, prompt: renderPromptParts(data.parts ?? []) }} />
        </DeferredPanelContent>
        {currentConnectionOption?.supplierId && <DeferredPanelContent>
          <SupplierBillingSummary key={currentConnectionOption?.supplierId} compact supplierId={currentConnectionOption?.supplierId} />
        </DeferredPanelContent>}
      </div>
    </section>
  ) : null;

  if (presentation === "parameters") return settingsPopover;

  const requestConfiguration = (trigger: HTMLElement | null) => {
    if (data.onRequestConfiguration) { data.onRequestConfiguration(trigger); return; }
    // Standalone node consumers retain the legacy surface until their root
    // supplies the callback; integrated canvas nodes never take this branch.
    setLocalSettingsOpen(open => {
      if (open) setModelMenuOpen(false);
      return !open;
    });
  };
  return (
    <div
      className={`node-generation-body ${(data.linkedAssets?.length ?? 0) > 0 ? "has-linked-assets" : ""}`}
    >
      {settingsHost && settingsPopover
        ? createPortal(settingsPopover, settingsHost)
        : null}
      <LinkedAssetStrip data={data} />
      {nodeType === "image-generation" && Boolean(maskSource || maskEnabled) && (
        <div className="node-mask-summary nodrag nopan nowheel" data-state={maskProblem ? "needs-attention" : "ready"} onPointerDown={event => event.stopPropagation()}>
          {maskEnabled && <div className="node-mask-status" role="status">
            {maskProblem ? <CircleAlert size={13} /> : <Brush size={13} />}
            <span>{maskProblem ?? (parameters.maskAssetId ? "已设置局部修改区域" : "已设置外部蒙版")}</span>
          </div>}
          <div className="node-mask-actions">
            {maskSource && <button type="button" onClick={() => data.onEditMask?.(maskSource.id, nodeId)}>
              <Brush size={13} />{parameters.maskAssetId ? "编辑蒙版" : "绘制蒙版"}
            </button>}
            {maskEnabled && (!data.connectionId || !data.model || !data.imageEditingCapabilities?.mask || data.modelOptionsError) && <button type="button" className="node-mask-choose-model" onClick={(event) => {
              selectNode(); requestConfiguration(event.currentTarget);
            }}>选择可编辑模型</button>}
            {maskEnabled && <button type="button" className="node-mask-remove" aria-label="移除蒙版" title="移除蒙版" onClick={() => {
              const next = { ...parameters }; delete next.maskAssetId; delete next.maskSourceAssetId; delete next.mask;
              data.onParametersChange?.(next);
            }}><X size={12} /></button>}
          </div>
        </div>
      )}
      <div
        className="node-inline-editor nodrag nowheel nopan"
        onPointerDownCapture={selectNode}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            if (connectionAvailable && !maskProblem) (event.shiftKey ? data.onRunDownstream : data.onRun)?.();
          }
        }}
      >
        <CanvasPromptEditor data={data} active={active} />
      </div>

      <div
        className="node-inline-toolbar nodrag nowheel nopan"
        onPointerDown={(event) => {
          event.stopPropagation();
          selectNode(event);
        }}
      >
        <button
          className="node-config-summary"
          ref={attachSettingsTrigger}
          type="button"
          aria-label={`打开 ${data.label} 模型与参数`}
          aria-haspopup="dialog"
          title={`${connectionName} · ${modelName} · ${summary || "使用 API 默认参数"}`}
          // Defer source selection until the native click has been delivered.
          // Selecting on pointerdown can reconcile this node before pointerup
          // and swallow the first click that was meant to open its parameters.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            selectNode(event);
            requestConfiguration(event.currentTarget);
          }}
        >
          <SlidersHorizontal size={13} />
          <span className="node-config-copy">
            <strong>
              {currentConnectionOption?.supplierLabel ?? connectionName} · {modelName}
            </strong>
            {modelPriceLabel && modelPriceLabel !== "—" ? <small className="node-model-price" title={modelPriceLabel}>{modelPriceLabel}</small> : null}
          </span>
        </button>
        <button
          className="node-delete-button"
          type="button"
          aria-label={`删除 ${data.label} 节点`}
          title="删除节点（Delete）"
          onClick={(event) => {
            event.stopPropagation();
            data.onDelete?.();
          }}
        >
          <X size={12} />
        </button>
        <button
          className="node-run-button"
          type="button"
          aria-label={`运行 ${data.label} 节点`}
          title={maskProblem ?? (connectionAvailable ? (running ? "创建新的独立任务，当前任务继续生成（Ctrl+Enter）" : "运行节点（Ctrl+Enter）") : "当前 API 连接不可用")}
          disabled={!connectionAvailable || Boolean(maskProblem)}
          onClick={(event) => {
            event.stopPropagation();
            if (connectionAvailable && !maskProblem) data.onRun?.();
          }}
          onPointerDown={commitPromptBeforeRun}
        >
          <Play size={12} />
          <span>{running ? (nodeType === "image-generation" ? "再生成一张" : "再生成一个") : "运行"}</span>
        </button>
      </div>
    </div>
  );
}

function WorkflowNodeComponent({ id, data, selected }: NodeProps<CanvasNode>) {
  const selectNode = (event?: { ctrlKey: boolean; metaKey: boolean }) =>
    data.onSelect?.(Boolean(event?.ctrlKey || event?.metaKey));
  const [mediaZoom, setMediaZoom] = useState(1);
  const [recoveringResult, setRecoveringResult] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const completionFlash = useRef<HTMLSpanElement>(null);
  const visualStatus = nodeVisualStatus(data.generatedResult ? data.generatedStatus ?? (data.assetId ? "succeeded" : "queued") : data.status);
  const previousStatus = useRef(visualStatus);
  useEffect(() => {
    if (visualStatus === "succeeded" && ["running", "queued"].includes(previousStatus.current) && canvasMotionEnabled()) {
      completionFlash.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    previousStatus.current = visualStatus;
  }, [visualStatus]);
  const node = { id, type: data.nodeType ?? "custom", data } as CanvasNode;
  const inputAsset = data.assets?.find((asset) => asset.id === data.assetId);
  const outputIds = data.lastOutputAssetIds ?? [];
  const firstOutput = outputIds[0];
  const outputAsset = data.assets?.find((asset) => asset.id === firstOutput);
  const outputKind = outputAsset?.kind ?? data.assetKind;
  const generatedPreviewSize = useResultPreviewSize(id, data.generatedResult === true || Boolean(firstOutput), mediaZoom);
  const previewUrl = firstOutput
    ? outputKind === "image"
      ? `/api/assets/${encodeURIComponent(firstOutput)}/preview?size=${generatedPreviewSize}`
      : `/api/assets/${encodeURIComponent(firstOutput)}/content`
    : null;
  const inputPreviewUrl =
    data.pendingPreviewUrl ??
    (data.assetId
      ? (inputAsset?.kind ?? data.assetKind) === "image"
        ? `/api/assets/${encodeURIComponent(data.assetId)}/preview?size=${data.generatedResult === true ? generatedPreviewSize : selected ? 640 : 160}`
        : `/api/assets/${encodeURIComponent(data.assetId)}/content`
      : null);
  const generationNode =
    data.nodeType === "image-generation" ||
    data.nodeType === "video-generation" || data.nodeType === "music-generation";
  const maskEdit = data.nodeType === "image-generation" && hasImageMask(data.parameters);
  const hasImageReference = data.nodeType === "image-generation" && Boolean(data.linkedAssets?.some(asset => asset.kind === "image"));
  const generatedResult =
    data.nodeType === "asset-input" && data.generatedResult === true;
  const generatedPrompt = generatedResult
    ? data.generatedPromptText ||
      renderPromptParts(data.generatedPromptParts ?? [], {
        resolveAsset: (assetId) => {
          const asset = data.assets?.find((item) => item.id === assetId);
          return asset ? `@${asset.name}` : `@${assetId}`;
        },
      }).trim() ||
      "未记录提示词"
    : "";
  const fakeResult = inputAsset?.metadata.fake === true;
  const generatedStatus =
    typeof data.generatedStatus === "string"
      ? data.generatedStatus
      : data.assetId
        ? "succeeded"
        : "queued";
  const generatedPending = [
    "blocked",
    "queued",
    "submitting",
    "running",
    "archiving",
    "cancel_requested",
  ].includes(generatedStatus);
  const generatedCancelled = generatedStatus === "cancelled";
  const generatedNeedsAttention = generatedStatus === "needs_attention";
  const generatedRecoveryAvailable =
    generatedNeedsAttention &&
    (data.generatedRecoveryAction === "resume_poll" ||
      data.generatedRecoveryAction === "resume_archive");
  const generatedFailed = generatedStatus === "failed";
  const generatedProblem = generatedFailed || generatedNeedsAttention;
  const hasArchivedGeneratedMedia = Boolean(
    data.assetId && inputPreviewUrl && !fakeResult && !generatedPending &&
    (data.assetKind === "image" || data.assetKind === "video" || data.assetKind === "audio"),
  );
  const recoveredGeneratedMedia = hasArchivedGeneratedMedia && (generatedProblem || generatedCancelled);
  const generatedErrorDetails = localizeRunError(data.generatedError, {
    provider: data.generatedProvider,
    supplier: data.generatedSupplier,
    status: generatedStatus,
    providerTaskStatus: data.generatedDetails?.taskEvidence?.status,
  }) as RunErrorDetails | null;
  const generatedError = generatedErrorDetails?.message ?? null;
  const generatedProvenance = generatedResult
    ? generatedResultProvenance(data)
    : null;
  const updateMediaZoom = (next: number) =>
    setMediaZoom(Math.min(3, Math.max(0.5, Number(next.toFixed(2)))));

  return (
    <>
      {selected && data.selectionAlignmentVisible === true ? <NodeToolbar
        isVisible
        position={Position.Right}
        offset={12}
      >
        <div
          className="selection-alignment-toolbar nodrag nopan nowheel"
          role="toolbar"
          aria-label="节点对齐工具"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span>{data.selectionCount ?? 0} 个节点</span>
          <div>
            <button
              type="button"
              aria-label="左对齐"
              title="左对齐"
              onClick={() => data.onAlignSelection?.("left")}
            >
              <AlignStartVertical size={14} />
            </button>
            <button
              type="button"
              aria-label="水平居中"
              title="水平居中"
              onClick={() => data.onAlignSelection?.("center-x")}
            >
              <AlignCenterVertical size={14} />
            </button>
            <button
              type="button"
              aria-label="右对齐"
              title="右对齐"
              onClick={() => data.onAlignSelection?.("right")}
            >
              <AlignEndVertical size={14} />
            </button>
            <button
              type="button"
              aria-label="水平等距分布"
              title={
                (data.selectionCount ?? 0) >= 3
                  ? "水平等距分布"
                  : "至少选择 3 个节点"
              }
              disabled={(data.selectionCount ?? 0) < 3}
              onClick={() => data.onAlignSelection?.("distribute-x")}
            >
              <AlignHorizontalSpaceBetween size={14} />
            </button>
          </div>
          <div>
            <button
              type="button"
              aria-label="上对齐"
              title="上对齐"
              onClick={() => data.onAlignSelection?.("top")}
            >
              <AlignStartHorizontal size={14} />
            </button>
            <button
              type="button"
              aria-label="垂直居中"
              title="垂直居中"
              onClick={() => data.onAlignSelection?.("center-y")}
            >
              <AlignCenterHorizontal size={14} />
            </button>
            <button
              type="button"
              aria-label="下对齐"
              title="下对齐"
              onClick={() => data.onAlignSelection?.("bottom")}
            >
              <AlignEndHorizontal size={14} />
            </button>
            <button
              type="button"
              aria-label="垂直等距分布"
              title={
                (data.selectionCount ?? 0) >= 3
                  ? "垂直等距分布"
                  : "至少选择 3 个节点"
              }
              disabled={(data.selectionCount ?? 0) < 3}
              onClick={() => data.onAlignSelection?.("distribute-y")}
            >
              <AlignVerticalSpaceBetween size={14} />
            </button>
          </div>
        </div>
      </NodeToolbar> : null}
      {selected && (data.selectionSize ?? 1) <= 1 && generatedResult && !generatedPending ? <ResultToolbar nodeId={id}>
        <ResultActions data={data} filename={inputAsset?.name} prompt={generatedPrompt}
          hasMedia={hasArchivedGeneratedMedia} zoom={mediaZoom} onZoom={updateMediaZoom} />
      </ResultToolbar> : null}
      {selected && (data.selectionSize ?? 1) <= 1 && <NodeResizeControl
        position="bottom-right" className="node-resize-corner" aria-label={`调整 ${data.label} 节点尺寸`}
        minWidth={
          generatedResult
            ? 120
            : generationNode
              ? 300
              : data.nodeType === "prompt"
                ? 260
                : 230
        }
        minHeight={generatedResult ? 72 : maskEdit ? MASK_EDIT_NODE_MIN_HEIGHT : hasImageReference ? IMAGE_REFERENCE_NODE_MIN_HEIGHT : generationNode ? 150 : 140}
        keepAspectRatio={
          generatedResult && !generatedProblem && !generatedCancelled
        }
        onResizeStart={() => data.onResizeStart?.()}
      ><span aria-hidden="true" /></NodeResizeControl>}
      <div
        className={`node-card ${selected ? "selected" : ""} ${generatedResult ? "generated-result-node" : ""} ${generatedProblem ? resultStyles.failureCard : ""}`}
        data-node-type={data.nodeType}
        data-node-status={visualStatus}
        data-mask-edit={maskEdit || undefined}
        data-has-image-reference={hasImageReference || undefined}
        data-pending-import={data.pendingImport || undefined}
        data-director-draft={data.directorDraft || undefined}
        data-connection-highlight={data.connectionHighlight}
        data-connection-active={data.connectionPreviewActive || undefined}
        data-generated-result={generatedResult || undefined}
        data-result-kind={generatedResult ? data.assetKind : undefined}
        data-generated-status={generatedResult ? generatedStatus : undefined}
        data-result-problem={generatedResult && generatedProblem || undefined}
        data-media-zoom={generatedResult ? mediaZoom : undefined}
        onClick={(event) => {
          event.stopPropagation();
          selectNode(event);
        }}
      >
        <span ref={completionFlash} className="node-complete-flash" aria-hidden="true" />
        {visualStatus === "running" && <span className="node-progress-track" aria-hidden="true"><span className="node-progress-fill" /></span>}
        <PortHandles node={node} direction="input" />
        <PortHandles node={node} direction="output" />
        {!generatedResult ? (
          <div className="node-head"
            title={generationNode ? "双击打开模型与参数" : undefined}
            onDoubleClick={generationNode && data.onRequestConfiguration ? event => {
              event.preventDefault();
              event.stopPropagation();
              selectNode(event);
              data.onRequestConfiguration?.(event.currentTarget.closest<HTMLElement>(".react-flow__node") ?? event.currentTarget);
            } : undefined}>
            <div className="node-title">
              <span className="node-icon">
                {icons[data.nodeType ?? ""] ?? <Sparkles size={14} />}
              </span>
              <ReadableName text={data.label} />
            </div>
            {visualStatus !== "idle" && <NodeStateLabel key={`${visualStatus}:${data.runStartedAt}`} status={visualStatus} since={data.runStartedAt} />}
          </div>
        ) : <div className="node-head node-result-head">
          <div className="node-title node-result-title">
            <span className="node-icon">{icons[data.assetKind === "image" ? "image-generation" : data.assetKind === "video" ? "video-generation" : data.assetKind === "audio" ? "music-generation" : "preview"] ?? <Sparkles size={14} />}</span>
            <span title={data.label}>{data.label}</span>
          </div>
          <NodeStateLabel key={`${visualStatus}:${data.generatedCreatedAt}`} status={visualStatus} since={data.generatedCreatedAt} result />
        </div>}
        {visualStatus === "failed" && !generatedResult && <div className={`${resultStyles.nodeFailureSummary} nodrag nopan nowheel`}>
          <ResultFailureFeedback error={localizeRunError(data.runError)} rawError={data.runError} status={data.status} />
        </div>}
        <div className="node-body">
          {data.nodeType === "prompt" ? (
            <div
              className="node-inline-editor prompt-node-editor nodrag nowheel nopan"
              onPointerDownCapture={selectNode}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  (event.shiftKey ? data.onRunDownstream : data.onRun)?.();
                }
              }}
            >
              <CanvasPromptEditor data={data} active={Boolean(selected) && (data.selectionSize ?? 1) <= 1} />
            </div>
          ) : null}

          {data.nodeType === "asset-input" ? (
            generatedResult ? (
              <div
                className="generated-result-media"
                draggable={Boolean(data.assetId)}
                onDragStart={(event) =>
                  handleAssetDragStart(event, data.assetId)
                }
              >
                <div
                  className={`generated-result-viewport ${assetHasKnownAlpha(inputAsset) ? "node-image-transparent" : ""} ${data.assetKind === "image" && inputPreviewUrl && !fakeResult ? "previewable-image" : ""}`}
                  onDoubleClick={(event) => {
                    if (
                      data.assetKind !== "image" ||
                      !data.assetId ||
                      !inputPreviewUrl ||
                      fakeResult
                    )
                      return;
                    event.stopPropagation();
                    data.onOpenPreview?.(data.assetId);
                  }}
                >
                  {generatedPending ||
                  (!inputPreviewUrl &&
                    !generatedProblem &&
                    !generatedCancelled) ? (
                    <div
                      className="generated-result-state pending"
                      role="status"
                      aria-live="polite"
                    >
                      <LoaderCircle
                        className="generated-result-spinner"
                        size={24}
                      />
                      <strong>
                        {pendingGeneratedResultLabel(generatedStatus, data.generatedDetails?.submissionPhase)}
                      </strong>
                      <WaitElapsed since={data.generatedCreatedAt} />
                      {generatedStatus === "archiving" ? (
                        <small>生成已完成，正在取回原图，无需重新生成</small>
                      ) : null}
                      <div className="generated-result-footer">
                        {data.onCancelTask && generatedStatus !== "cancel_requested" ? <button className="result-info-button nodrag nopan" type="button" disabled={cancelling}
                          title={data.cancelTaskLabel === "停止跟踪" ? "停止本地跟踪；网站任务可能仍在执行" : "请求取消当前任务；已被供应商处理的请求可能无法撤回"} onClick={async (event) => {event.stopPropagation();setCancelling(true);try {await data.onCancelTask?.();} finally {setCancelling(false);}}}>{cancelling ? "正在处理" : data.cancelTaskLabel ?? "取消任务"}</button> : null}
                        <ResultInformation nodeId={id} data={data} asset={inputAsset} />
                      </div>
                    </div>
                  ) : (generatedProblem || generatedCancelled) && !hasArchivedGeneratedMedia ? (
                    <div
                      className={`generated-result-state ${resultStyles.failureState} nopan nowheel ${
                        generatedCancelled
                          ? "cancelled"
                          : generatedNeedsAttention
                            ? "needs-attention"
                            : "failed"
                      }`}
                      role="status"
                    >
                      {generatedProblem ? <div className={resultStyles.failureHeading}>
                        <CircleAlert size={16} aria-hidden="true" />
                        <strong>{generatedFailed ? "生成失败" : taskOutcomeLabel(generatedStatus, data.generatedDetails?.taskEvidence, data.generatedRecoveryAction)}</strong>
                      </div> : <>
                        <CircleAlert size={23} />
                        <strong>{data.generatedProvider === "cli" && data.generatedCliCancelSupported !== true ? "已停止跟踪" : "生成已取消"}</strong>
                      </>}
                      {!generatedProblem ? <>
                        <ResultInformation nodeId={id} data={data} asset={inputAsset} />
                        <TaskEvidence request={{ supplier: data.generatedSupplier, connectionName: data.generatedConnectionName, modelGroup: data.generatedGroup }} evidence={data.generatedDetails?.taskEvidence} />
                      </> : null}
                      {generatedProblem || generatedError ? <ResultFailureFeedback error={generatedErrorDetails} rawError={data.generatedError}
                        taskId={data.generatedDetails?.taskEvidence?.taskId} runId={data.generatedFromRunId}
                        status={generatedStatus} providerTaskStatus={data.generatedDetails?.taskEvidence?.status}
                        recoveryAction={data.generatedRecoveryAction}
                        context={{ connection: data.generatedConnectionName, supplier: data.generatedSupplier, modelGroup: data.generatedGroup, model: data.generatedModel, taskEvidence: data.generatedDetails?.taskEvidence }} /> : null}
                      {!generatedProblem && taskOutcomeNote(generatedStatus, data.generatedDetails?.taskEvidence, data.generatedRecoveryAction) ? (
                        <small className="generated-result-attention-note">
                          {taskOutcomeNote(generatedStatus, data.generatedDetails?.taskEvidence, data.generatedRecoveryAction)}
                        </small>
                      ) : null}
                      {generatedNeedsAttention && data.generatedPendingRequestId ? <button type="button" className="generated-result-retry nodrag nopan" onClick={(event) => {event.stopPropagation();data.onReconcileTask?.();}}>核对任务</button> : null}
                      {generatedNeedsAttention && data.generatedProvider === "cli" && data.onCancelTask ? <button type="button" className="generated-result-retry nodrag nopan" disabled={cancelling} title="停止本地跟踪后，请到网站核对任务是否完成" onClick={async event => { event.stopPropagation(); setCancelling(true); try { await data.onCancelTask?.(); } finally { setCancelling(false); } }}>{cancelling ? "正在处理" : "停止跟踪"}</button> : null}
                      {generatedFailed && data.onRegenerate ? (
                        <button
                          className={`generated-result-retry ${resultStyles.primaryRetry} nodrag nopan`}
                          type="button"
                          aria-label={`再次运行 ${data.label}，原地替换失败结果`}
                          title="重新生成会发起新的请求，并可能产生新的费用"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            data.onRegenerate?.();
                          }}
                        >
                          <RotateCcw size={11} /> 重新生成
                        </button>
                      ) : null}
                      {generatedProblem ? <details className={`${resultStyles.sourceDetails} nodrag nopan nowheel`} onClick={event => event.stopPropagation()}>
                        <summary>来源与任务</summary>
                        <ResultInformation nodeId={id} data={data} asset={inputAsset} />
                        <TaskEvidence request={{ supplier: data.generatedSupplier, connectionName: data.generatedConnectionName, modelGroup: data.generatedGroup }} evidence={data.generatedDetails?.taskEvidence} />
                      </details> : null}
                      {generatedRecoveryAvailable && data.onRecoverResult ? (
                        <button
                          className="generated-result-retry nodrag nopan"
                          type="button"
                          disabled={recoveringResult}
                          aria-label={`${data.generatedRecoveryAction === "resume_poll" ? "恢复查询" : "取回"} ${data.label} 的现有任务`}
                          title={
                            data.generatedRecoveryAction === "resume_poll"
                              ? "继续查询现有供应商任务，不会重新提交或再次扣费"
                              : "从现有供应商任务取回结果，不会再次扣费"
                          }
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={async (event) => {
                            event.stopPropagation();
                            setRecoveringResult(true);
                            try {
                              await data.onRecoverResult?.();
                            } finally {
                              setRecoveringResult(false);
                            }
                          }}
                        >
                          <RotateCcw
                            className={recoveringResult ? "spin" : ""}
                            size={11}
                          />{" "}
                          {recoveringResult
                            ? data.generatedRecoveryAction === "resume_poll"
                              ? "查询中"
                              : "取回中"
                            : data.generatedRecoveryAction === "resume_poll"
                              ? "恢复查询"
                              : "取回已有结果"}
                        </button>
                      ) : null}
                    </div>
                  ) : data.assetKind === "video" &&
                    inputPreviewUrl &&
                    !fakeResult ? (
                    <video
                      src={inputPreviewUrl}
                      controls={selected}
                      muted={!selected}
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={(event) => {
                        const { videoWidth, videoHeight } = event.currentTarget;
                        if (videoWidth > 0 && videoHeight > 0)
                          data.onMediaAspectRatio?.(videoWidth / videoHeight);
                      }}
                    />
                  ) : data.assetKind === "audio" && inputPreviewUrl ? (
                    <div className={`${musicStyles.result} nodrag nopan nowheel`}><Music size={28} /><audio src={inputPreviewUrl} controls preload="metadata" aria-label={inputAsset?.name ?? "生成音乐"} onLoadedMetadata={event => { if (data.assetId && Number.isFinite(event.currentTarget.duration)) data.onLinkedAssetDuration?.(data.assetId, event.currentTarget.duration); }} /></div>
                  ) : data.assetKind === "image" &&
                    inputPreviewUrl &&
                    !fakeResult ? (
                    <AssetPreviewImage
                      assetId={data.assetId}
                      src={inputPreviewUrl}
                      alt={inputAsset?.name ?? data.label}
                      failureHint="图片为空、损坏或无法读取，请查看任务详情"
                      title="双击查看原图"
                      draggable={false}
                      decoding="async"
                      style={{ transform: `scale(${mediaZoom})` }}
                      onLoad={(event) => {
                        const { naturalWidth, naturalHeight } =
                          event.currentTarget;
                        if (naturalWidth > 0 && naturalHeight > 0)
                          data.onMediaAspectRatio?.(
                            naturalWidth / naturalHeight,
                          );
                      }}
                    />
                  ) : (
                    <span>
                      {data.assetKind === "video" ? "视频结果" : data.assetKind === "audio" ? "音乐结果" : "图片结果"}
                    </span>
                  )}
                  {recoveredGeneratedMedia ? (
                    <span
                      className={`status-label ${generatedStatus}`}
                      style={{ position: "absolute", top: 8, left: 8 }}
                      title="已保存结果可查看，原运行状态仍保留在历史中"
                    >
                      已取回 · {generatedCancelled ? "原任务已取消" : generatedFailed ? "原任务失败" : "原任务待处理"}
                    </span>
                  ) : null}
                  {generatedProvenance &&
                  hasArchivedGeneratedMedia &&
                  inputPreviewUrl ? (
                    <ResultInformation nodeId={id} data={data} asset={inputAsset} overlay />
                  ) : null}
                </div>
                <button
                    className="generated-result-delete nodrag nopan"
                    type="button"
                    aria-label={`删除 ${data.label} 节点`}
                    title={generatedPending ? "移出画布，任务继续，完成后可在历史中查看" : "移出画布，保留历史结果"}
                    onClick={(event) => {
                      event.stopPropagation();
                      data.onDelete?.();
                    }}
                  >
                    <X size={13} />
                  </button>
              </div>
            ) : inputPreviewUrl &&
              (inputAsset?.kind ?? data.assetKind) === "image" ? (
              <div
                className={`node-preview asset-node-preview previewable-image ${assetHasKnownAlpha(inputAsset) ? "node-image-transparent" : ""}`}
                draggable={Boolean(data.assetId)}
                onDragStart={(event) =>
                  handleAssetDragStart(event, data.assetId)
                }
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (data.assetId) data.onOpenPreview?.(data.assetId);
                }}
              >
                <AssetPreviewImage
                  key={data.assetId ?? inputPreviewUrl}
                  assetId={data.assetId}
                  src={inputPreviewUrl}
                  alt={inputAsset?.name ?? data.label}
                  title={data.pendingImport ? "正在导入原图" : "双击查看原图"}
                  loading="lazy"
                  decoding="async"
                  onLoad={(event) => {
                    const { naturalWidth, naturalHeight } = event.currentTarget;
                    if (naturalWidth > 0 && naturalHeight > 0)
                      data.onMediaAspectRatio?.(naturalWidth / naturalHeight);
                  }}
                />
              </div>
            ) : inputPreviewUrl &&
              (inputAsset?.kind === "video" ||
                (data.pendingImport && data.assetKind === "video")) ? (
              <div
                className={`node-preview asset-node-preview video-cover ${selected ? "active" : ""}`}
                draggable={Boolean(data.assetId)}
                onDragStart={(event) =>
                  handleAssetDragStart(event, data.assetId)
                }
              >
                <video
                  src={inputPreviewUrl}
                  controls={selected}
                  muted
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(event) => {
                    const { videoWidth, videoHeight } = event.currentTarget;
                    if (videoWidth > 0 && videoHeight > 0)
                      data.onMediaAspectRatio?.(videoWidth / videoHeight);
                  }}
                />
              </div>
            ) : inputPreviewUrl && inputAsset?.kind === "audio" ? (
              <div className={`node-preview ${musicStyles.result} nodrag nopan nowheel`}><Music size={28} /><audio src={inputPreviewUrl} controls preload="metadata" aria-label={inputAsset.name} /></div>
            ) : (
              <div>{data.assetId ? "素材已就绪" : "拖入图片、视频或音频"}</div>
            )
          ) : null}

          {generationNode ? (
            <GenerationNodeBody nodeId={id} data={data} active={Boolean(selected) && (data.selectionSize ?? 1) <= 1} />
          ) : null}

          {data.nodeType === "preview" ? (
            previewUrl && outputKind === "audio" ? <div className={`node-preview ${musicStyles.result} nodrag nopan nowheel`}><Music size={28} /><audio src={previewUrl} controls preload="metadata" aria-label="音乐结果预览" /></div> : previewUrl && outputKind !== "video" ? (
              <div
                className="node-preview previewable-image"
                draggable={Boolean(firstOutput)}
                onDragStart={(event) =>
                  handleAssetDragStart(event, firstOutput)
                }
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (firstOutput) data.onOpenPreview?.(firstOutput);
                }}
              >
                <img
                  src={previewUrl}
                  alt="生成结果"
                  title="双击查看原图"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            ) : previewUrl && outputAsset?.metadata.fake !== true ? (
              <div
                className={`node-preview video-cover ${selected ? "active" : ""}`}
                draggable={Boolean(firstOutput)}
                onDragStart={(event) =>
                  handleAssetDragStart(event, firstOutput)
                }
              >
                <video
                  src={previewUrl}
                  controls={selected}
                  muted={!selected}
                  playsInline
                  preload="metadata"
                />
              </div>
            ) : (
              <div className="node-preview">
                <span className="fake-video">
                  {firstOutput ? "结果已生成" : "等待生成结果"}
                </span>
              </div>
            )
          ) : null}

          {!generationNode &&
          !generatedResult &&
          data.nodeType !== "preview" ? (
            <div className="node-actions nodrag nopan">
              {data.assetKind === "image" && data.assetId && !data.pendingImport &&
                <button type="button" aria-label="绘制蒙版" onClick={event => {
                  event.stopPropagation(); data.onEditMask?.(data.assetId!);
                }} title="绘制蒙版"><Brush size={14} /></button>}
              <button
                type="button"
                aria-label={`运行 ${data.label} 节点`}
                title="运行节点（Ctrl+Enter）"
                onPointerDown={() => {
                  const active = document.activeElement;
                  if (
                    active instanceof HTMLElement &&
                    active.closest(".tiptap-prompt")
                  )
                    active.blur();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  data.onRun?.();
                }}
              >
                <Play size={14} />
              </button>
              <button
                type="button"
                aria-label={`删除 ${data.label} 节点`}
                title="删除节点（Delete）"
                onClick={(event) => {
                  event.stopPropagation();
                  data.onDelete?.();
                }}
              >
                <X size={14} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

// Position and dragging belong to React Flow's wrapper. The node content only
// reads these three props; geometry-aware children subscribe to the store.
export const WorkflowNode = memo(WorkflowNodeComponent, (previous, next) =>
  previous.id === next.id && previous.data === next.data && previous.selected === next.selected,
);

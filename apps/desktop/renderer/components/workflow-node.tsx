"use client";

import { cliOperationForNode } from "../lib/cli-input-ports";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  useStore,
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
  CopyPlus,
  Download,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  Music,
  Play,
  RotateCcw,
  ScanText,
  Send,
  SlidersHorizontal,
  Sparkles,
  Type,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { renderPromptParts } from "@super-canvas/core";
import {
  assetDownloadPath,
  downloadAssetPreferLocal,
} from "../lib/asset-download";
import { localizeRunError } from "../lib/error-localization";
import { ReadableName, ResultInformation, ResultToolbar, WaitElapsed } from "./result-information";
import { pendingGeneratedResultLabel } from "../lib/pending-run-reconciliation";
import { cleanModelDisplayName, modelPriceSummary } from "../lib/model-display";
import { SupplierBillingSummary } from "./supplier-billing-summary";
import { useSupplierBillingOverview } from "../lib/client-supplier-billing";
import { billingCompact } from "../lib/supplier-billing-display";
import { choosePickerConnection, pickerConnectionGroups } from "../lib/model-picker";
import { ModelPicker } from "./model-picker";
import { ModelPriceDetails } from "./model-price-details";
import {
  fetchCangyuanAvailability,
  type CangyuanAvailabilityView,
} from "../lib/client-api";
import { cangyuanAvailabilityForModel, modelAvailabilityBadgeState, type ModelAvailabilityLoadState } from "../lib/cangyuan-availability-ui";
import { NodeParameterFields } from "./node-parameter-fields";
import { ModelResolutionShortcuts } from "./model-resolution-shortcuts";
import { shouldReselectNodeFromConfigPointer } from "../lib/node-config-pointer";
import { PromptEditor } from "./prompt-editor";
import { AssetPreviewImage } from "./asset-preview-image";
import { useResultPreviewSize } from "../lib/use-result-preview-size";
import type { CanvasNode, CanvasNodeData, RunErrorDetails } from "./types";

const ASSET_DRAG_TYPE = "application/x-super-canvas-asset";
const CANGYUAN_AVAILABILITY_REFRESH_MS = 30_500;

function availabilityBadgeLabel(
  availability: CangyuanAvailabilityView | undefined,
  loadState: ModelAvailabilityLoadState,
  checkedAt: string | undefined,
): string {
  return modelAvailabilityBadgeState(availability, loadState, checkedAt).label;
}

function availabilityBadgeTitle(
  availability: CangyuanAvailabilityView | undefined,
  loadState: ModelAvailabilityLoadState,
  checkedAt: string | undefined,
): string {
  if (!availability) {
    if (loadState === "loading") return "正在读取沧元实时可用性";
    if (loadState === "error") return "沧元可用性查询暂时失败，不影响正常生成";
    return "沧元可用性接口暂未收录这个模型";
  }
  const state = modelAvailabilityBadgeState(availability, loadState, checkedAt);
  const parts = [state.label];
  if (state.tone === "error" || state.tone === "stale") parts.push("以下为上次监测记录，当前可用性待确认");
  if (availability.availability !== null)
    parts.push(`近期可用率 ${availability.availability}%`);
  if (availability.averageLatencyMs !== null)
    parts.push(`平均延迟 ${Math.round(availability.averageLatencyMs)}ms`);
  if (checkedAt) {
    const date = new Date(checkedAt);
    if (!Number.isNaN(date.getTime()))
      parts.push(
        `检测于 ${date.toLocaleTimeString("zh-CN", { hour12: false })}`,
      );
  }
  return parts.join(" · ");
}

function ModelAvailabilityBadge({
  availability,
  loadState,
  checkedAt,
}: {
  availability: CangyuanAvailabilityView | undefined;
  loadState: ModelAvailabilityLoadState;
  checkedAt: string | undefined;
}) {
  const status = modelAvailabilityBadgeState(availability, loadState, checkedAt).tone;
  return (
    <span
      className={`node-model-availability is-${status}`}
      title={availabilityBadgeTitle(availability, loadState, checkedAt)}
    >
      {availabilityBadgeLabel(availability, loadState, checkedAt)}
    </span>
  );
}

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
  preview: <Send size={14} />,
};

function portTop(
  node: CanvasNode,
  direction: "input" | "output",
  index: number,
  total: number,
): string {
  const generationNode =
    node.data.nodeType === "image-generation" ||
    node.data.nodeType === "video-generation";
  if (generationNode && direction === "input") {
    const preferred = 58 + index * 42;
    const bottomClearance = (total - index) * 24;
    return `min(${preferred}px, calc(100% - ${bottomClearance}px))`;
  }
  return `${((index + 1) / (total + 1)) * 100}%`;
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
            style={{ top: portTop(node, direction, index, ports.length) }}
            aria-label={`${direction === "input" ? "输入" : "输出"} ${port.label}（${port.kind}）`}
            title={`${port.label} · ${port.kind}`}
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
            className={`port-label ${direction === "input" ? "left" : "right"}`}
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
  const compact = useStore((state) => state.transform[2] < .5 && !active);
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
  const activate = () => { focusRequested.current = true; data.onSelect?.(); };
  return <div ref={host} className="canvas-prompt-content">
    {compact ? <div className="prompt-overview" role="button" tabIndex={0} aria-label={`编辑 ${data.label} 提示词`}
      onPointerDownCapture={(event) => {if(!event.ctrlKey && !event.metaKey)focusRequested.current=true;}}
      onClick={(event) => {if(!event.ctrlKey && !event.metaKey)activate();}}
      onKeyDown={(event) => {if((event.key==="Enter" || event.key===" ") && !event.ctrlKey && !event.metaKey){event.preventDefault();activate();}}}>
      {renderPromptParts(data.parts ?? [], {resolveAsset:(id) => data.assets?.find(asset=>asset.id===id)?.name ?? "参考素材"}) || "点击编辑提示词"}
    </div> : <PromptEditor parts={data.parts ?? [{type:"text",text:""}]} assets={data.assets ?? []} mentionAssets={data.mentionAssets ?? []}
      onChange={(parts) => data.onPromptPartsChange?.(parts)} ariaLabel={`编辑 ${data.label} 提示词`} />}
  </div>;
}

function GenerationNodeBody({
  nodeId,
  data,
  active,
}: {
  nodeId: string;
  data: CanvasNodeData;
  active: boolean;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const onConfigurationOpenChange = data.onConfigurationOpenChange;
  useLayoutEffect(() => {
    if (!settingsOpen) return;
    onConfigurationOpenChange?.(nodeId, true);
    return () => onConfigurationOpenChange?.(nodeId, false);
  }, [nodeId, onConfigurationOpenChange, settingsOpen]);
  // Share the node's coordinate space so the panel pans, zooms and resizes with it.
  const [settingsHost, setSettingsHost] = useState<HTMLElement | null>(null);
  const settingsTrigger = useRef<HTMLButtonElement | null>(null);
  const settingsPanel = useRef<HTMLElement | null>(null);
  const settingsBody = useRef<HTMLDivElement | null>(null);
  const settingsAnchor = useStore(state => {
    if (!modelMenuOpen) return "";
    const node = state.nodeLookup.get(nodeId);
    return [state.transform.join(","), node?.internals.positionAbsolute.x,
      node?.internals.positionAbsolute.y, node?.measured.width, node?.measured.height].join(":");
  });
  const attachSettingsTrigger = useCallback((trigger: HTMLButtonElement | null) => {
    settingsTrigger.current = trigger;
    setSettingsHost(trigger?.closest<HTMLElement>(".react-flow__node") ?? null);
  }, []);
  useLayoutEffect(() => {
    if (!settingsOpen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { if (event.target instanceof HTMLSelectElement || event.target instanceof Element && event.target.closest(".node-model-select[data-open]")) return; event.stopImmediatePropagation(); setSettingsOpen(false); setModelMenuOpen(false); settingsTrigger.current?.focus(); } };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [settingsOpen]);
  const modelSelectRef = useRef<HTMLDivElement | null>(null);
  const [modelMenuHeight, setModelMenuHeight] = useState(320);
  useLayoutEffect(() => {
    if (!modelMenuOpen) return;
    const select = modelSelectRef.current?.getBoundingClientRect();
    const panel = settingsPanel.current?.getBoundingClientRect();
    if (select && panel) setModelMenuHeight(Math.max(40, Math.min(320, panel.bottom - select.bottom - 16)));
  }, [modelMenuOpen, settingsAnchor]);
  const [availabilitySnapshot, setAvailabilitySnapshot] = useState<{
    connectionId: string;
    items: CangyuanAvailabilityView[];
    checkedAt?: string;
    state: ModelAvailabilityLoadState;
  }>({ connectionId: "", items: [], state: "idle" });
  const [, setAvailabilityClock] = useState(0);
  useEffect(() => {
    if (!settingsOpen) return;
    // Even a stalled refresh must eventually lose its healthy badge.
    const timer = setInterval(() => setAvailabilityClock(value => value + 1), CANGYUAN_AVAILABILITY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [settingsOpen]);
  const nodeType =
    data.nodeType === "video-generation"
      ? "video-generation"
      : "image-generation";
  const parameters = data.parameters ?? {};
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
  useLayoutEffect(() => {
    if (settingsBody.current) settingsBody.current.scrollTop = 0;
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
  const modelOptions = [...(data.modelOptions ?? [])];
  const billingAccounts = useSupplierBillingOverview();
  if (
    data.model &&
    modelOptions.length === 0 &&
    !data.modelOptionsAuthoritative &&
    !data.modelOptionsLoading &&
    !modelOptions.some((model) => model.id === data.model)
  ) {
    modelOptions.unshift({ id: data.model, name: data.model, operations: [] });
  }
  const selectedModel = modelOptions.find((model) => model.id === data.model);
  const modelName = selectedModel ? cleanModelDisplayName(selectedModel.name, selectedModel.metadata?.priceLabel) : data.model ?? "自动模型";
  const cangyuanAvailabilityEnabled =
    currentSupplier === "cangyuan" &&
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
  const parameterControlsUnavailable =
    selectedModel?.metadata?.parameterControlsUnavailable === true;
  const summary =
    nodeType === "video-generation"
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
    if (!modelMenuOpen) return;
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
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!settingsOpen || !cangyuanAvailabilityEnabled) return;

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
        const snapshot = await fetchCangyuanAvailability(currentConnection, {
          windowDays: 7,
        });
        if (cancelled) return;
        setAvailabilitySnapshot({
          connectionId: currentConnection,
          items: snapshot.items,
          checkedAt: snapshot.checkedAt,
          state: "ready",
        });
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
  }, [cangyuanAvailabilityEnabled, currentConnection, settingsOpen]);

  const settingsPopover = settingsOpen ? (
    <section
      // Portals still participate in React Flow's capture handlers. `nokey`
      // keeps its Ctrl-selection handler from swallowing these form events.
      className="node-config-popover node-config-popover-portal nodrag nowheel nopan nokey"
      ref={settingsPanel}
      role="dialog"
      aria-label={`${data.label} 模型与参数`}
      // A portal still bubbles through the owning React node. Native select
      // clicks must not select that node and reopen the inspector mid-popup.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onFocusCapture={() => data.onConfigurationFocus?.()}
      onPointerDown={(event) => {
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
          onClick={() => {
            setModelMenuOpen(false);
            setSettingsOpen(false);
          }}
        >
          <X size={14} />
        </button>
        <button
          className="node-config-manage-api"
          title="管理供应商与密钥"
          aria-label="管理供应商与密钥"
          type="button"
          onClick={() => {
            setModelMenuOpen(false);
            setSettingsOpen(false);
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
                    {label} · {supplier === currentSupplier ? modelPriceSummary(selectedModel, parameters) : candidate?.modelQuote ?? "选取后报价"} · {billingCompact(billingAccounts.find(account => account.id === candidate?.supplierId)?.billing)}
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
                  {connection.name} · {connection.id}{connection.available === false ? `（${connection.unavailableReason ?? "密钥不可用"}）` : ""}
                </option>)}
              </select>
            </label>}
          </div>
          <small className="node-config-supplier-quote" aria-label="当前供应商报价">{currentConnectionOption?.supplierLabel ?? "供应商"} · {modelPriceSummary(selectedModel, parameters)} · {billingCompact(billingAccounts.find(account => account.id === currentConnectionOption?.supplierId)?.billing)}</small>
        </div>
        <div className="node-config-model-field node-config-model-header">
          <span>模型</span>
          <div className="node-config-model-control" ref={modelSelectRef}>
            <ModelPicker key={currentConnection} id={`node-inline-model-${nodeId}`} label={`${data.label} 模型`}
              connectionId={currentConnection} models={modelOptions} value={data.model ?? ""}
              parameters={{ ...parameters, prompt: renderPromptParts(data.parts ?? []) }}
              onChange={id => data.onModelChange?.(id)} open={modelMenuOpen} onOpenChange={setModelMenuOpen}
              maxHeight={modelMenuHeight} anchorKey={settingsAnchor} loading={data.modelOptionsLoading} failed={data.modelOptionsError}
              authoritative={data.modelOptionsAuthoritative} allowManual={!data.modelOptionsAuthoritative}
              badge={cangyuanAvailabilityEnabled ? model => <ModelAvailabilityBadge
                availability={cangyuanAvailabilityForModel(model, availabilityItems)}
                loadState={availabilityState} checkedAt={availabilitySnapshot.checkedAt} /> : undefined} />
          </div>
        </div>

        {currentConnection && !currentConnectionOption && <div className="node-config-connection-warning" role="status">原连接已归档或删除（{currentConnection}）。节点选择已保留，请恢复连接或手动选择其他连接。</div>}
        {currentConnectionOption?.available === false ? (
          <div className="node-config-connection-warning" role="status">
            当前实际连接是 {currentConnectionOption.name}（{currentConnectionOption.group}），{currentConnectionOption.unavailableReason ?? "该分组密钥不可用"}。请重新配置或选择其他可用分组。
          </div>
        ) : null}
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
            showAdvanced={false}
            onChange={(nextParameters) =>
              data.onParametersChange?.(nextParameters)
            }
          />
        </section>
        <ModelPriceDetails model={selectedModel} parameters={{ ...parameters, prompt: renderPromptParts(data.parts ?? []) }} />
        <SupplierBillingSummary key={currentConnectionOption?.supplierId} compact supplierId={currentConnectionOption?.supplierId} />
      </div>
    </section>
  ) : null;

  return (
    <div
      className={`node-generation-body ${(data.linkedAssets?.length ?? 0) > 0 ? "has-linked-assets" : ""}`}
    >
      {settingsHost && settingsPopover
        ? createPortal(settingsPopover, settingsHost)
        : null}
      <LinkedAssetStrip data={data} />
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
            if (connectionAvailable) (event.shiftKey ? data.onRunDownstream : data.onRun)?.();
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
          title={`${connectionName} · ${modelName} · ${summary || "使用 API 默认参数"}`}
          onClick={(event) => {
            event.stopPropagation();
            setSettingsOpen((open) => {
              if (open) setModelMenuOpen(false);
              return !open;
            });
          }}
        >
          <SlidersHorizontal size={13} />
          <span className="node-config-copy">
            <strong>
              {modelName}
            </strong>
            <small title={connectionName}>{connectionName.replace(/\s*·\s*画布$/u, "")} · {summary || "API 默认参数"} · {modelPriceSummary(selectedModel, parameters)}</small>
          </span>
        </button>
        <button
          className="node-delete-button"
          type="button"
          aria-label={`删除 ${data.label} 节点`}
          title="删除节点"
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
          title={connectionAvailable ? (running ? "创建新的独立任务，当前任务继续生成" : "运行") : "当前 API 连接不可用"}
          disabled={!connectionAvailable}
          onClick={(event) => {
            event.stopPropagation();
            data.onRun?.();
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
  const [resultPromptOpen, setResultPromptOpen] = useState(false);
  const [reusingPrompt, setReusingPrompt] = useState(false);
  const [recoveringResult, setRecoveringResult] = useState(false);
  const [cancelling, setCancelling] = useState(false);
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
    data.nodeType === "video-generation";
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
  const generatedArchiveRecoverable =
    generatedNeedsAttention &&
    data.generatedRecoveryAction === "resume_archive";
  const generatedRecoveryAvailable =
    generatedNeedsAttention &&
    (data.generatedRecoveryAction === "resume_poll" ||
      data.generatedRecoveryAction === "resume_archive");
  const generatedFailed = generatedStatus === "failed";
  const generatedProblem = generatedFailed || generatedNeedsAttention;
  const hasArchivedGeneratedMedia = Boolean(
    data.assetId && inputPreviewUrl && !fakeResult && !generatedPending &&
    (data.assetKind === "image" || data.assetKind === "video"),
  );
  const recoveredGeneratedMedia = hasArchivedGeneratedMedia && (generatedProblem || generatedCancelled);
  const generatedErrorDetails = localizeRunError(data.generatedError, {
    provider: data.generatedProvider,
    supplier: data.generatedSupplier,
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
        <div className="generated-result-actions-wrap nodrag nopan nowheel">
          <div
            className="generated-result-actions"
            role="toolbar"
            aria-label="生成结果操作"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {hasArchivedGeneratedMedia &&
            data.assetKind === "image" &&
            inputPreviewUrl &&
            !fakeResult ? (
              <div
                className="generated-result-zoom"
                role="group"
                aria-label="图片缩放"
              >
                <button
                  type="button"
                  aria-label="缩小图片"
                  title="缩小"
                  disabled={mediaZoom <= 0.5}
                  onClick={(event) => {
                    event.stopPropagation();
                    updateMediaZoom(mediaZoom - 0.25);
                  }}
                >
                  <ZoomOut size={14} />
                </button>
                <button
                  type="button"
                  aria-label="还原图片缩放"
                  title="还原"
                  disabled={mediaZoom === 1}
                  onClick={(event) => {
                    event.stopPropagation();
                    updateMediaZoom(1);
                  }}
                >
                  <RotateCcw size={13} />
                </button>
                <button
                  type="button"
                  aria-label="放大图片"
                  title="放大"
                  disabled={mediaZoom >= 3}
                  onClick={(event) => {
                    event.stopPropagation();
                    updateMediaZoom(mediaZoom + 0.25);
                  }}
                >
                  <ZoomIn size={14} />
                </button>
              </div>
            ) : null}
            {data.assetId ? (
              <a
                href={assetDownloadPath(data.assetId)}
                download={inputAsset?.name ?? true}
                aria-label={`下载 ${data.label}`}
                title="下载结果"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void downloadAssetPreferLocal(
                    data.assetId!,
                    inputAsset?.name,
                  );
                }}
              >
                <Download size={13} />
                <span>下载</span>
              </a>
            ) : null}
            <button
              type="button"
              aria-label={`查看 ${data.label} 原提示词`}
              aria-expanded={resultPromptOpen}
              title="查看原提示词"
              onClick={(event) => {
                event.stopPropagation();
                setResultPromptOpen((open) => !open);
              }}
            >
              <FileText size={13} />
              <span>原提示词</span>
            </button>
            <button
              type="button"
              aria-label={`复用 ${data.label} 提示词`}
              title="复用提示词到新生成节点"
              disabled={reusingPrompt || !data.onReusePrompt}
              onClick={async (event) => {
                event.stopPropagation();
                setReusingPrompt(true);
                try { await data.onReusePrompt?.(); }
                finally { setReusingPrompt(false); }
              }}
            >
              {reusingPrompt ? <LoaderCircle size={13} /> : <CopyPlus size={13} />}
              <span>复用提示词</span>
            </button>
            <button
              type="button"
              aria-label={`反推 ${data.label} 提示词`}
              title="交给智能体反推提示词"
              onClick={(event) => {
                event.stopPropagation();
                data.onPrepareReversePrompt?.();
              }}
            >
              <ScanText size={13} />
              <span>反推提示词</span>
            </button>
          </div>
          {resultPromptOpen ? (
            <div className="generated-result-prompt-popover" role="note">
              <strong>原提示词</strong>
              <p>{generatedPrompt}</p>
            </div>
          ) : null}
        </div>
      </ResultToolbar> : null}
      <NodeResizer
        isVisible={selected && (data.selectionSize ?? 1) <= 1}
        minWidth={
          generatedResult
            ? 120
            : generationNode
              ? 300
              : data.nodeType === "prompt"
                ? 260
                : 230
        }
        minHeight={generatedResult ? 72 : generationNode ? 150 : 140}
        keepAspectRatio={
          generatedResult && !generatedProblem && !generatedCancelled
        }
        onResizeStart={() => data.onResizeStart?.()}
      />
      <div
        className={`node-card ${selected ? "selected" : ""} ${generatedResult ? "generated-result-node" : ""}`}
        data-node-type={data.nodeType}
        data-pending-import={data.pendingImport || undefined}
        data-director-draft={data.directorDraft || undefined}
        data-connection-highlight={data.connectionHighlight}
        data-generated-result={generatedResult || undefined}
        data-generated-status={generatedResult ? generatedStatus : undefined}
        data-media-zoom={generatedResult ? mediaZoom : undefined}
        onClick={(event) => {
          event.stopPropagation();
          selectNode(event);
        }}
      >
        <PortHandles node={node} direction="input" />
        <PortHandles node={node} direction="output" />
        {!generatedResult ? (
          <div className="node-head">
            <div className="node-title">
              <span className="node-icon">
                {icons[data.nodeType ?? ""] ?? <Sparkles size={14} />}
              </span>
              <ReadableName text={data.label} />
            </div>
            <span
              className={`node-status ${data.status ?? ""}`}
              role="status"
              aria-label={`状态：${data.status === "succeeded" ? "已完成" : data.status === "failed" || data.status === "needs_attention" ? "需要处理" : data.status ? pendingGeneratedResultLabel(data.status) : "等待开始"}`}
            />
          </div>
        ) : null}
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
                  className={`generated-result-viewport ${data.assetKind === "image" && inputPreviewUrl && !fakeResult ? "previewable-image" : ""}`}
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
                      {data.onCancelTask && generatedStatus !== "cancel_requested" ? <button className="result-info-button nodrag nopan" type="button" disabled={cancelling}
                        title={data.cancelTaskLabel === "停止跟踪" ? "停止本地跟踪；网站任务可能仍在执行" : "请求取消当前任务；已被供应商处理的请求可能无法撤回"} onClick={async (event) => {event.stopPropagation();setCancelling(true);try {await data.onCancelTask?.();} finally {setCancelling(false);}}}>{cancelling ? "正在处理" : data.cancelTaskLabel ?? "取消任务"}</button> : null}
                      {generatedStatus === "archiving" ? (
                        <small>生成已完成，正在取回原图，无需重新生成</small>
                      ) : null}
                      <ResultInformation data={data} asset={inputAsset} />
                    </div>
                  ) : (generatedProblem || generatedCancelled) && !hasArchivedGeneratedMedia ? (
                    <div
                      className={`generated-result-state nopan nowheel ${
                        generatedCancelled
                          ? "cancelled"
                          : generatedNeedsAttention
                            ? "needs-attention"
                            : "failed"
                      }`}
                      role="status"
                    >
                      <CircleAlert size={23} />
                      <strong>
                        {generatedCancelled
                          ? data.generatedProvider === "cli" && data.generatedCliCancelSupported !== true ? "已停止跟踪" : "生成已取消"
                          : generatedArchiveRecoverable
                            ? "生成成功，结果待取回"
                            : generatedNeedsAttention
                              ? "提交结果未知"
                              : "生成失败"}
                      </strong>
                      <ResultInformation data={data} asset={inputAsset} />
                      {generatedError ? <span className="result-error-summary">{generatedError}</span> : null}
                      {generatedNeedsAttention ? (
                        <small className="generated-result-attention-note">
                          {generatedArchiveRecoverable
                            ? "供应商已经完成生成。取回只会下载现有结果，不会重新提交或再次扣费。"
                            : "供应商可能已经收到任务。请先核对任务和扣费记录，确认未提交后再从源节点运行。"}
                        </small>
                      ) : null}
                      {generatedNeedsAttention && data.generatedPendingRequestId ? <button type="button" className="generated-result-retry nodrag nopan" onClick={(event) => {event.stopPropagation();data.onReconcileTask?.();}}>核对任务</button> : null}
                      {generatedNeedsAttention && data.generatedProvider === "cli" && data.onCancelTask ? <button type="button" className="generated-result-retry nodrag nopan" disabled={cancelling} title="停止本地跟踪后，请到网站核对任务是否完成" onClick={async event => { event.stopPropagation(); setCancelling(true); try { await data.onCancelTask?.(); } finally { setCancelling(false); } }}>{cancelling ? "正在处理" : "停止跟踪"}</button> : null}
                      {generatedFailed ? <small>可先查看详情排查原因，再重新生成。</small> : null}
                      <details className="result-error-details nodrag nopan" onClick={(event) => event.stopPropagation()}>
                      <summary>技术详情与上游原文</summary>
                      <p>{generatedError}</p>
                      <button type="button" className="result-info-button" onClick={(event) => {
                        const button = event.currentTarget;
                        void navigator.clipboard.writeText(JSON.stringify(generatedErrorDetails ?? data.generatedError, null, 2)).then(() => {button.textContent = "已复制";}).catch(() => {button.textContent = "复制失败，请手动选择";});
                      }}>复制错误详情</button>
                      {generatedErrorDetails?.type ||
                      generatedErrorDetails?.code ? (
                        <small className="generated-result-error-meta">
                          {generatedErrorDetails.type
                            ? `错误类型：${generatedErrorDetails.type}`
                            : null}
                          {generatedErrorDetails.type &&
                          generatedErrorDetails.code
                            ? " · "
                            : null}
                          {generatedErrorDetails.code
                            ? `代码：${generatedErrorDetails.code}`
                            : null}
                        </small>
                      ) : null}
                      {generatedErrorDetails?.api ? (
                        <small className="generated-result-error-api">
                          接入 API：{generatedErrorDetails.api}
                        </small>
                      ) : null}
                      {generatedErrorDetails?.statusCode ||
                      generatedErrorDetails?.providerMessage ? (
                        <small className="generated-result-error-upstream">
                          {generatedErrorDetails.statusCode
                            ? `HTTP ${generatedErrorDetails.statusCode}`
                            : null}
                          {generatedErrorDetails.statusCode &&
                          generatedErrorDetails.providerMessage
                            ? " · "
                            : null}
                          {generatedErrorDetails.providerMessage
                            ? `上游：${generatedErrorDetails.providerMessage}`
                            : null}
                        </small>
                      ) : null}
                      {generatedErrorDetails?.actionUrl ? (
                        <a
                          className="generated-result-error-doc generated-result-error-action nodrag nopan"
                          href={generatedErrorDetails.actionUrl}
                          target="_blank"
                          rel="noreferrer"
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <ExternalLink size={10} />
                          {generatedErrorDetails.actionLabel ??
                            "前往供应商官网"}
                        </a>
                      ) : null}
                      {generatedErrorDetails?.docsUrl ? (
                        <a
                          className="generated-result-error-doc nodrag nopan"
                          href={generatedErrorDetails.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <ExternalLink size={10} /> API 错误文档
                        </a>
                      ) : null}
                      </details>
                      {generatedFailed && data.onRegenerate ? (
                        <button
                          className="generated-result-retry nodrag nopan"
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
                  ) : data.assetKind === "image" &&
                    inputPreviewUrl &&
                    !fakeResult ? (
                    <img
                      src={inputPreviewUrl}
                      alt={inputAsset?.name ?? data.label}
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
                      {data.assetKind === "video" ? "视频结果" : "图片结果"}
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
                    <ResultInformation data={data} asset={inputAsset} overlay />
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
                className="node-preview asset-node-preview previewable-image"
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
            ) : (
              <div>{data.assetId ? "素材已就绪" : "拖入图片、视频或音频"}</div>
            )
          ) : null}

          {generationNode ? (
            <GenerationNodeBody nodeId={id} data={data} active={Boolean(selected) && (data.selectionSize ?? 1) <= 1} />
          ) : null}

          {data.nodeType === "preview" ? (
            previewUrl && outputKind !== "video" ? (
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
              <button
                type="button"
                aria-label={`运行 ${data.label} 节点`}
                title="运行"
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
                <Play size={10} /> 运行
              </button>
              <button
                type="button"
                aria-label={`删除 ${data.label} 节点`}
                title="删除"
                onClick={(event) => {
                  event.stopPropagation();
                  data.onDelete?.();
                }}
              >
                <X size={10} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

export const WorkflowNode = memo(WorkflowNodeComponent);


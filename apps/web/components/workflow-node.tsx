"use client";

import { memo, useState } from "react";
import {
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  type NodeProps,
} from "@xyflow/react";
import {
  CircleAlert,
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
import { localizeRunError } from "../lib/error-localization";
import { NodeParameterFields } from "./node-parameter-fields";
import { PromptEditor } from "./prompt-editor";
import type { CanvasNode, CanvasNodeData, RunErrorDetails } from "./types";

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
              <div
                className={`node-linked-asset-preview ${asset.kind === "image" ? "previewable-image" : ""}`}
                onDoubleClick={(event) => {
                  if (asset.kind !== "image") return;
                  event.stopPropagation();
                  data.onOpenPreview?.(asset.id);
                }}
              >
                {asset.kind === "image" ? (
                  <img
                    src={src}
                    alt=""
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

function GenerationNodeBody({
  nodeId,
  data,
}: {
  nodeId: string;
  data: CanvasNodeData;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const nodeType =
    data.nodeType === "video-generation"
      ? "video-generation"
      : "image-generation";
  const parameters = data.parameters ?? {};
  const currentConnection =
    data.connectionId || (data.provider === "fake" ? "fake-default" : "");
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
  const currentSupplier =
    currentConnectionOption?.supplier ?? supplierOptions[0]?.[0] ?? "";
  const groupOptions = Array.from(
    new Map(
      connectionOptions
        .filter((connection) => connection.supplier === currentSupplier)
        .map((connection) => [connection.group, connection]),
    ).values(),
  );
  const currentGroup =
    currentConnectionOption?.group ?? groupOptions[0]?.group ?? "默认群组";
  const connectionName = currentConnectionOption
    ? `${currentConnectionOption.supplierLabel} · ${currentConnectionOption.group}`
    : currentConnection
      ? "当前 API"
      : "未配置 API";
  const modelOptions = [...(data.modelOptions ?? [])];
  if (
    data.model &&
    modelOptions.length === 0 &&
    !modelOptions.some((model) => model.id === data.model)
  ) {
    modelOptions.unshift({ id: data.model, name: data.model, operations: [] });
  }
  const selectedModel = modelOptions.find((model) => model.id === data.model);
  const modelName = selectedModel?.name ?? data.model ?? "自动模型";
  const summary =
    nodeType === "video-generation"
      ? [
          parameters.duration ? `${parameters.duration}s` : null,
          parameters.aspect_ratio ?? parameters.ratio,
          parameters.resolution,
        ]
          .filter(Boolean)
          .join(" · ")
      : [parameters.size, parameters.quality].filter(Boolean).join(" · ");
  const running = ["queued", "submitting", "running", "archiving"].includes(
    data.status ?? "",
  );

  const selectNode = () => data.onSelect?.();
  const commitPromptBeforeRun = () => {
    // The editor keeps the latest transaction locally until blur. Commit it
    // explicitly so clicking Run immediately after typing cannot submit the
    // previous (possibly empty) prompt.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(".tiptap-prompt")) {
      active.blur();
    }
  };

  return (
    <div
      className={`node-generation-body ${(data.linkedAssets?.length ?? 0) > 0 ? "has-linked-assets" : ""}`}
    >
      {settingsOpen ? (
        <div className="node-config-popover-anchor nodrag nowheel nopan">
          <section
            className="node-config-popover nodrag nowheel nopan"
            role="dialog"
            aria-label={`${data.label} 模型与参数`}
            onPointerDown={selectNode}
          >
            <header>
              <div>
                <strong>模型与参数</strong>
                <div className="node-config-provider-selectors">
                  <label className="node-config-provider-header">
                    <span>供应商</span>
                    <select
                      aria-label={`${data.label} 供应商`}
                      value={currentSupplier}
                      onChange={(event) => {
                        const next = connectionOptions.find(
                          (connection) =>
                            connection.supplier === event.target.value,
                        );
                        const available = connectionOptions.find(
                          (connection) =>
                            connection.supplier === event.target.value &&
                            connection.available !== false,
                        );
                        if (available ?? next)
                          data.onConnectionChange?.((available ?? next)!.id);
                      }}
                    >
                      {supplierOptions.map(([supplier, label]) => (
                        <option key={supplier} value={supplier}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="node-config-provider-header">
                    <span>群组</span>
                    <select
                      aria-label={`${data.label} 模型群组`}
                      value={currentGroup}
                      onChange={(event) => {
                        const next = connectionOptions.find(
                          (connection) =>
                            connection.supplier === currentSupplier &&
                            connection.group === event.target.value &&
                            connection.available !== false,
                        );
                        if (next) data.onConnectionChange?.(next.id);
                      }}
                    >
                      {groupOptions.map((connection) => (
                        <option
                          key={connection.group}
                          value={connection.group}
                          disabled={connection.available === false}
                        >
                          {connection.group}
                          {connection.available === false
                            ? "（密钥不可用）"
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭模型与参数面板"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={14} />
              </button>
            </header>
            <div className="node-config-popover-body">
              <button
                className="node-config-manage-api"
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  data.onOpenApiSettings?.();
                }}
              >
                <ExternalLink size={12} /> 管理供应商与密钥
              </button>
              {currentConnectionOption?.available === false ? (
                <div className="node-config-connection-warning" role="status">
                  当前实际连接是 {currentConnectionOption.group}
                  ，但该分组密钥不可用。 请重新配置或选择其他可用分组。
                </div>
              ) : null}
              <label className="node-config-model-field">
                <span>模型</span>
                <select
                  aria-label={`${data.label} 模型`}
                  value={data.model ?? ""}
                  onChange={(event) => data.onModelChange?.(event.target.value)}
                >
                  <option value="">自动模型</option>
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
              <NodeParameterFields
                nodeId={nodeId}
                nodeType={nodeType}
                provider={data.provider ?? "fake"}
                model={selectedModel ?? null}
                parameters={parameters}
                showAdvanced={false}
                onChange={(nextParameters) =>
                  data.onParametersChange?.(nextParameters)
                }
              />
            </div>
          </section>
        </div>
      ) : null}
      <LinkedAssetStrip data={data} />
      <div
        className="node-inline-editor nodrag nowheel nopan"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            if (connectionAvailable) data.onRun?.();
          }
        }}
      >
        <PromptEditor
          parts={data.parts ?? [{ type: "text", text: "" }]}
          assets={data.assets ?? []}
          mentionAssets={data.mentionAssets ?? []}
          onChange={(parts) => data.onPromptPartsChange?.(parts)}
          ariaLabel={`编辑 ${data.label} 提示词`}
        />
      </div>

      <div
        className="node-inline-toolbar nodrag nowheel nopan"
        onPointerDown={selectNode}
      >
        <button
          className="node-config-summary"
          type="button"
          aria-label={`打开 ${data.label} 模型与参数`}
          title="打开模型与参数面板"
          onClick={(event) => {
            event.stopPropagation();
            selectNode();
            setSettingsOpen((open) => !open);
          }}
        >
          <SlidersHorizontal size={13} />
          <span className="node-config-copy">
            <strong>
              {connectionName} · {modelName}
            </strong>
            <small>{summary || "使用 API 默认参数"}</small>
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
          title={connectionAvailable ? "运行" : "当前 API 连接不可用"}
          disabled={running || !connectionAvailable}
          onClick={(event) => {
            event.stopPropagation();
            data.onRun?.();
          }}
          onPointerDown={commitPromptBeforeRun}
        >
          <Play size={12} />
          <span>{running ? "生成中" : "运行"}</span>
        </button>
      </div>
    </div>
  );
}

function WorkflowNodeComponent({
  id,
  data,
  selected,
}: NodeProps<CanvasNode>) {
  const [mediaZoom, setMediaZoom] = useState(1);
  const [resultPromptOpen, setResultPromptOpen] = useState(false);
  const node = { id, type: data.nodeType ?? "custom", data } as CanvasNode;
  const inputAsset = data.assets?.find((asset) => asset.id === data.assetId);
  const outputIds = data.lastOutputAssetIds ?? [];
  const firstOutput = outputIds[0];
  const outputAsset = data.assets?.find((asset) => asset.id === firstOutput);
  const outputKind = outputAsset?.kind ?? data.assetKind;
  const previewUrl = firstOutput
    ? outputKind === "image"
      ? `/api/assets/${encodeURIComponent(firstOutput)}/preview?size=1200`
      : `/api/assets/${encodeURIComponent(firstOutput)}/content`
    : null;
  const inputPreviewUrl =
    data.pendingPreviewUrl ??
    (data.assetId
      ? (inputAsset?.kind ?? data.assetKind) === "image"
        ? `/api/assets/${encodeURIComponent(data.assetId)}/preview?size=${data.generatedResult === true ? 1200 : 640}`
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
  const generatedFailed = ["failed", "needs_attention"].includes(
    generatedStatus,
  );
  const generatedErrorDetails = localizeRunError(data.generatedError, {
    provider: data.generatedProvider,
  }) as RunErrorDetails | null;
  const generatedError = generatedErrorDetails?.message ?? null;
  const updateMediaZoom = (next: number) =>
    setMediaZoom(Math.min(3, Math.max(0.5, Number(next.toFixed(2)))));

  return (
    <>
      <NodeToolbar
        isVisible={selected && generatedResult && !generatedPending}
        position={Position.Top}
        offset={9}
      >
        <div className="generated-result-actions-wrap nodrag nopan nowheel">
          <div
            className="generated-result-actions"
            role="toolbar"
            aria-label="生成结果操作"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {data.assetId ? (
              <a
                href={`/api/assets/${encodeURIComponent(data.assetId)}/content`}
                download={inputAsset?.name ?? true}
                aria-label={`下载 ${data.label}`}
                title="下载结果"
                onClick={(event) => event.stopPropagation()}
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
      </NodeToolbar>
      <NodeResizer
        isVisible={selected}
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
        keepAspectRatio={generatedResult}
        onResizeStart={() => data.onResizeStart?.()}
      />
      <div
        className={`node-card ${selected ? "selected" : ""} ${generatedResult ? "generated-result-node" : ""}`}
        data-node-type={data.nodeType}
        data-connection-highlight={data.connectionHighlight}
        data-generated-result={generatedResult || undefined}
        data-generated-status={generatedResult ? generatedStatus : undefined}
        data-media-zoom={generatedResult ? mediaZoom : undefined}
        onClick={(event) => {
          event.stopPropagation();
          data.onSelect?.();
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
              <span>{data.label}</span>
            </div>
            <span
              className={`node-status ${data.status ?? ""}`}
              role="status"
              aria-label={`状态：${data.status ?? "未运行"}`}
            />
          </div>
        ) : null}
        <div className="node-body">
          {data.nodeType === "prompt" ? (
            <div
              className="node-inline-editor prompt-node-editor nodrag nowheel nopan"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  data.onRun?.();
                }
              }}
            >
              <PromptEditor
                parts={data.parts ?? [{ type: "text", text: "" }]}
                assets={data.assets ?? []}
                mentionAssets={data.mentionAssets ?? []}
                onChange={(parts) => data.onPromptPartsChange?.(parts)}
                ariaLabel={`编辑 ${data.label} 提示词`}
              />
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
                    !generatedFailed &&
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
                        {generatedStatus === "blocked"
                          ? "等待上游"
                          : generatedStatus === "cancel_requested"
                            ? "正在取消"
                            : "正在生成"}
                      </strong>
                    </div>
                  ) : generatedFailed || generatedCancelled ? (
                    <div
                      className={`generated-result-state ${generatedCancelled ? "cancelled" : "failed"}`}
                      role="status"
                    >
                      <CircleAlert size={23} />
                      <strong>
                        {generatedCancelled ? "生成已取消" : "生成失败"}
                      </strong>
                      {generatedError ? <span>{generatedError}</span> : null}
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
                      {generatedFailed && data.onRegenerate ? (
                        <button
                          className="generated-result-retry nodrag nopan"
                          type="button"
                          aria-label={`重新生成 ${data.label}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            data.onRegenerate?.();
                          }}
                        >
                          <RotateCcw size={11} /> 重新生成
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
                </div>
                {selected &&
                generatedStatus === "succeeded" &&
                data.assetKind === "image" &&
                inputPreviewUrl &&
                !fakeResult ? (
                  <div
                    className="generated-result-zoom nodrag nopan nowheel"
                    role="toolbar"
                    aria-label="图片缩放"
                    onPointerDown={(event) => event.stopPropagation()}
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
                {!generatedPending ? (
                  <button
                    className="generated-result-delete nodrag nopan"
                    type="button"
                    aria-label={`删除 ${data.label} 节点`}
                    title="删除结果节点"
                    onClick={(event) => {
                      event.stopPropagation();
                      data.onDelete?.();
                    }}
                  >
                    <X size={13} />
                  </button>
                ) : null}
              </div>
            ) : inputPreviewUrl &&
              (inputAsset?.kind === "image" ||
                (data.pendingImport && data.assetKind === "image")) ? (
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
                <img
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
            ) : inputPreviewUrl && inputAsset?.kind === "video" ? (
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
              <div>{data.assetId ? "素材已就绪" : "拖入图片或视频"}</div>
            )
          ) : null}

          {generationNode ? (
            <GenerationNodeBody nodeId={id} data={data} />
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

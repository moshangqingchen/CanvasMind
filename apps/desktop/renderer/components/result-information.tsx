"use client";
import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NodeToolbar, useStore } from "@xyflow/react";
import { createPortal } from "react-dom";
import { Copy, FileImage, X } from "lucide-react";
import type { AssetView, CanvasNodeData, RunSnapshot } from "./types";
import { localizeRunError } from "../lib/error-localization";
import { FailureDiagnosis } from "./failure-diagnosis";
import { taskConnectionLabel, taskOutcomeLabel } from "../lib/task-evidence";
import { pendingGeneratedResultLabel } from "../lib/pending-run-reconciliation";
import { generationDetailsFromRun, resultElapsed, resultFileSize, resultPrompt, resultReferenceInputs } from "../lib/result-provenance";
import { useDialogFocus } from "./use-dialog-focus";

/** Mounted only for an active result. Keep actions clear of the fixed canvas controls. */
export function ResultToolbar({
  nodeId,
  children,
}: {
  nodeId: string;
  children: ReactNode;
}) {
  const transform = useStore((state) => {
    const node = state.nodeLookup.get(nodeId);
    if (!node) return "translate(0px, 80px)";
    const [tx, ty, zoom] = state.transform,
      p = node.internals.positionAbsolute;
    const center = (p.x + (node.measured.width ?? 320) / 2) * zoom + tx;
    const bottom = (p.y + (node.measured.height ?? 240)) * zoom + ty + 12;
    const x = Math.max(
      Math.min(300, state.width / 2 + 32),
      Math.min(center, state.width - Math.min(232, state.width / 2 - 32)),
    );
    const y =
      bottom < state.height - 110 ? bottom : Math.max(80, p.y * zoom + ty - 48);
    return `translate(${x}px, ${Math.min(y, state.height - 110)}px) translate(-50%, 0)`;
  });
  return (
    <NodeToolbar nodeId={nodeId} isVisible style={{ transform }}>
      {children}
    </NodeToolbar>
  );
}

export const WaitElapsed = memo(function WaitElapsed({
  since,
}: {
  since?: string;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  const start = Date.parse(since ?? "");
  if (!Number.isFinite(start)) return null;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return (
    <small className="result-elapsed">
      已等待{" "}
      {seconds < 60
        ? `${seconds} 秒`
        : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`}
    </small>
  );
});

export function ReadableName({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null),
    id = useId();
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const show = () => {
    const box = ref.current?.getBoundingClientRect();
    if (box)
      setPosition({
        left: Math.max(8, Math.min(box.left, window.innerWidth - 368)),
        top: Math.min(box.bottom + 8, window.innerHeight - 120),
      });
  };
  return (
    <span
      ref={ref}
      className="readable-name nodrag"
      tabIndex={0}
      title={text}
      aria-describedby={position ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={() => setPosition(null)}
      onFocus={show}
      onBlur={() => setPosition(null)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setPosition(null);
      }}
    >
      {text}
      {position
        ? createPortal(
            <span
              id={id}
              className="canvas-name-tooltip"
              role="tooltip"
              style={position}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

export function ResultInformation({
  nodeId,
  data,
  asset,
  overlay = false,
}: {
  nodeId: string;
  data: CanvasNodeData;
  asset?: AssetView;
  overlay?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [copy, setCopy] = useState("复制任务编号");
  const dialogLeaseId = useId();
  const onConfigurationOpenChange = data.onConfigurationOpenChange;
  useLayoutEffect(() => {
    if (!open) return;
    // The body portal still belongs to this node's React tree. Keep that tree
    // mounted when a resize or pan moves the source node outside the viewport.
    const leaseKey = `result-information:${nodeId}:${dialogLeaseId}`;
    onConfigurationOpenChange?.(leaseKey, true);
    return () => onConfigurationOpenChange?.(leaseKey, false);
  }, [dialogLeaseId, nodeId, onConfigurationOpenChange, open]);
  const [loadedDimensions, setLoadedDimensions] = useState<{ assetId: string; text: string } | null>(null);
  const imageAssetId = asset?.kind === "image" ? asset.id : null;
  const dimensions = imageAssetId
    ? loadedDimensions?.assetId === imageAssetId ? loadedDimensions.text : "正在读取原图尺寸…"
    : asset ? "非图片素材" : "尚无已保存结果";
  const close = () => setOpen(false);
  const dialog = useDialogFocus(open, close);
  const taskId = data.generatedFromRunId ?? data.generatedPendingRequestId;
  const [errorCopy, setErrorCopy] = useState("复制错误详情");
  const [loadedRun, setLoadedRun] = useState<{ id: string; node: RunSnapshot["nodes"][number] } | null>(null);
  const [detailsState, setDetailsState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [copiedDetail, setCopiedDetail] = useState("");
  const runNode = loadedRun && loadedRun.id === data.generatedFromRunId ? loadedRun.node : undefined;
  const details = { ...data.generatedDetails, ...(runNode ? generationDetailsFromRun(runNode) : {}) };
  const references = resultReferenceInputs(details, data.assets);
  const imageCount = references?.filter((input) => input.kind === "image").length ?? 0;
  const unknownCount = references?.filter((input) => !input.kind).length ?? 0;
  const referenceCount = references === undefined ? "未记录" : unknownCount ? `${imageCount} 张已知，${unknownCount} 个素材类型未记录` : `${imageCount} 张`;
  const prompt = resultPrompt(data, details);
  const parameters = runNode?.request?.parameters ?? data.generatedParameters;
  const status = runNode?.status ?? data.generatedStatus;
  const error = localizeRunError(runNode ? runNode.errorJson : data.generatedError, { provider: runNode?.request?.provider ?? data.generatedProvider, supplier: runNode?.request?.supplier ?? data.generatedSupplier, status, providerTaskStatus: details.taskEvidence?.status });
  const statusLabel = taskOutcomeLabel(status, details.taskEvidence, runNode?.recoveryAction ?? data.generatedRecoveryAction) ?? (status ? pendingGeneratedResultLabel(status, details.submissionPhase) : "未记录");
  const operationLabel = ({ "image.generate": "文生图", "image.edit": "参考图生成 / 编辑", "video.generate": "文生视频", "video.image-to-video": "图生视频" } as Record<string, string>)[details.operation ?? ""] ?? details.operation ?? "未记录";
  const unit = data.assetKind === "video" ? "个" : "张";
  const requestedCount = Number(parameters?.n);
  const copyDetail = (text: string, label: string) => {
    void navigator.clipboard.writeText(text)
      .then(() => setCopiedDetail(`已复制${label}`))
      .catch(() => setCopiedDetail("复制失败，请选中文字手动复制"));
  };
  useEffect(() => {
    if (!open || !data.generatedFromRunId) return;
    const controller = new AbortController();
    const runId = data.generatedFromRunId;
    void fetch(`/api/runs/${encodeURIComponent(runId)}?details=1`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const snapshot: RunSnapshot = await response.json();
        const node = snapshot.nodes.find((item) => item.nodeId === data.generatedFromNodeId || (asset && item.outputAssetIds.includes(asset.id)));
        if (!node) throw new Error();
        if (controller.signal.aborted) return;
        setLoadedRun({ id: runId, node });
        setDetailsState("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setDetailsState("unavailable"); });
    return () => controller.abort();
  }, [open, data.generatedFromRunId, data.generatedFromNodeId, asset]);
  useEffect(() => {
    if (!open || !imageAssetId) return;
    const controller = new AbortController();
      void fetch(`/api/assets/${encodeURIComponent(imageAssetId)}?dimensions=1`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const result = await response.json();
          if (controller.signal.aborted) return;
          setLoadedDimensions({ assetId: imageAssetId, text: result.actualDimensions
              ? `${result.actualDimensions.width} × ${result.actualDimensions.height} 像素`
              : "无法读取原图尺寸" });
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoadedDimensions({ assetId: imageAssetId, text: "无法读取原图尺寸" });
        });
    return () => controller.abort();
  }, [open, imageAssetId]);
  return (
    <>
      <button
        type="button"
        className={`${overlay ? "generated-result-provenance-overlay " : ""}result-info-button nodrag nopan`}
        aria-label={`查看 ${data.label} 来源`}
        aria-haspopup="dialog"
        title="查看参考图、提示词、模型、参数与任务信息"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setLoadedDimensions(null);
          setCopy("复制任务编号");
          setErrorCopy("复制错误详情");
          setLoadedRun(null);
          setDetailsState(data.generatedFromRunId ? "loading" : "unavailable");
          setCopiedDetail("");
          setOpen(true);
        }}
      >
        来源 · 详情
      </button>
      {open
        ? createPortal(
            <div
              className="modal-backdrop result-info-backdrop"
              role="presentation"
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.target === e.currentTarget) close();
              }}
            >
              <section
                ref={dialog}
                className="modal-window result-info-panel"
                role="dialog"
                aria-modal="true"
                aria-label="结果来源与参数"
                tabIndex={-1}
                onKeyDown={(e) => {
                  e.stopPropagation();
                }}
              >
                <header className="modal-head">
                  <h2>结果来源</h2>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="关闭来源详情"
                    onClick={close}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </header>
                <div className="result-info-body">
                  <h3>{data.label}</h3>
                  {error || status === "failed" || status === "needs_attention" || status === "cancelled" ? <section aria-label="完整错误详情">
                    <h4>{status === "cancelled" ? "取消信息" : "错误详情"}</h4>
                    <FailureDiagnosis error={error} status={status} providerTaskStatus={details.taskEvidence?.status} recoveryAction={runNode?.recoveryAction ?? data.generatedRecoveryAction} />
                    <details>
                      <summary>技术详情与上游原文</summary>
                      <pre>{error ? JSON.stringify(error, null, 2) : "该任务未记录原始错误"}</pre>
                    </details>
                    <button type="button" className="button" onClick={() => {
                      void navigator.clipboard.writeText(JSON.stringify(error, null, 2))
                        .then(() => setErrorCopy("已复制"))
                        .catch(() => setErrorCopy("复制失败，请选中文字手动复制"));
                    }}>{errorCopy}</button>
                  </section> : null}
                  <dl>
                    <dt>任务状态</dt>
                    <dd>{statusLabel}</dd>
                    <dt>生成方式</dt>
                    <dd>{operationLabel}</dd>
                    <dt>模型</dt>
                    <dd>{runNode?.request?.model ?? data.generatedModel ?? "未记录"}</dd>
                    <dt>供应商 / 连接</dt>
                    <dd>
                      {taskConnectionLabel(runNode?.request ?? { connectionName: data.generatedConnectionName, supplier: data.generatedSupplier, modelGroup: data.generatedGroup })}
                    </dd>
                    {data.generatedGroup ? (
                      <>
                        <dt>分组</dt>
                        <dd>{data.generatedGroup}</dd>
                      </>
                    ) : null}
                    <dt>参考图张数</dt>
                    <dd>{referenceCount}</dd>
                    {references?.some((input) => input.kind === "video" || input.kind === "audio") ? <>
                      <dt>其他参考素材</dt>
                      <dd>{references.filter((input) => input.kind === "video").length} 个视频，{references.filter((input) => input.kind === "audio").length} 个音频</dd>
                    </> : null}
                    <dt>请求数量</dt>
                    <dd>{Number.isInteger(requestedCount) && requestedCount > 0 ? `${requestedCount} ${unit}` : "未指定（供应商默认）"}</dd>
                    <dt>已保存结果</dt>
                    <dd>{details.outputCount !== undefined ? `${details.outputCount} ${unit}${details.outputCount > 0 && typeof data.generatedOutputIndex === "number" && Number.isInteger(data.generatedOutputIndex) && data.generatedOutputIndex >= 0 && data.generatedOutputIndex < details.outputCount ? `，当前为第 ${data.generatedOutputIndex + 1} ${unit}` : ""}` : "未记录"}</dd>
                    <dt>实际尺寸</dt>
                    <dd>{dimensions}</dd>
                    <dt>开始时间</dt>
                    <dd>
                      {data.generatedCreatedAt
                        ? new Date(data.generatedCreatedAt).toLocaleString(
                            "zh-CN",
                          )
                        : "未记录"}
                    </dd>
                    {asset ? (
                      <>
                        <dt>保存时间</dt>
                        <dd>
                          {new Date(asset.createdAt).toLocaleString("zh-CN")}
                        </dd>
                      </>
                    ) : null}
                    <dt>完成时间</dt>
                    <dd>{details.finishedAt ? new Date(details.finishedAt).toLocaleString("zh-CN") : "未记录"}</dd>
                    <dt>耗时（含排队）</dt>
                    <dd>{resultElapsed(data.generatedCreatedAt, details.finishedAt ?? asset?.createdAt)}</dd>
                    <dt>供应商任务号</dt>
                    <dd>{details.taskEvidence?.taskId ?? "未取得"}{details.taskEvidence?.taskId ? <button type="button" className="icon-button" aria-label="复制供应商任务号" onClick={() => copyDetail(details.taskEvidence!.taskId, "供应商任务号")}><Copy size={15} aria-hidden="true" /></button> : null}</dd>
                    <dt>本地运行编号</dt>
                    <dd>{taskId ?? "尚未分配"}</dd>
                  </dl>
                  <section aria-label="参考素材详情" className="result-info-section">
                    <h4>参考素材{references ? ` · ${references.length} 个` : ""}</h4>
                    {references?.length ? <ol className="result-info-references">
                      {references.map((input, index) => {
                        const available = data.assets?.some((item) => item.id === input.id);
                        return <li key={input.id}>
                          {available && input.kind === "image" ? <button type="button" className="result-info-reference-preview" aria-label={`查看 ${input.name ?? input.id}`} title={`查看 ${input.name ?? input.id}`} onClick={() => { close(); data.onOpenPreview?.(input.id); }}>
                            <img src={`/api/assets/${encodeURIComponent(input.id)}/preview?size=160`} alt={input.name ?? `参考图 ${index + 1}`} loading="lazy" />
                          </button> : <span className="result-info-reference-placeholder"><FileImage size={20} aria-hidden="true" /></span>}
                          <div><span>{index + 1}. {input.name ?? input.id}</span><small>{({ firstFrame: "首帧", lastFrame: "尾帧", reference: "参考素材" } as Record<string, string>)[input.role ?? ""] ?? "参考素材"}{available ? "" : " · 素材不可用"}</small></div>
                        </li>;
                      })}
                    </ol> : <p className="result-info-note">{references ? "无参考素材" : "未记录参考素材"}</p>}
                  </section>
                  <section aria-label="生成提示词" className="result-info-section">
                    <div className="result-info-section-head"><h4>生成提示词</h4>{prompt ? <button type="button" className="icon-button" aria-label="复制提示词" title="复制提示词" onClick={() => copyDetail(prompt, "提示词")}><Copy size={15} aria-hidden="true" /></button> : null}</div>
                    <pre>{prompt ?? "未记录"}{prompt === "" ? "（空提示词）" : ""}</pre>
                  </section>
                  {asset ? <section aria-label="结果文件" className="result-info-section">
                    <h4>结果文件</h4>
                    <dl><dt>文件名称</dt><dd>{asset.name}</dd><dt>文件格式</dt><dd>{asset.mimeType}</dd><dt>文件大小</dt><dd>{resultFileSize(asset.size)}</dd></dl>
                  </section> : null}
                  <h4>请求参数</h4>
                  <pre>
                    {JSON.stringify(parameters ?? {}, null, 2)}
                  </pre>
                  <p className="result-info-note">
                    请求尺寸与实际返回尺寸可能不同；实际尺寸读取自已保存的原图。
                  </p>
                  {detailsState !== "ready" ? <p className="result-info-note" role="status">{detailsState === "loading" ? "正在读取任务记录…" : "任务记录不可用，仅显示已保存的信息。"}</p> : null}
                  <div className="result-info-actions">
                  {taskId ? (
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(taskId)
                          .then(() => setCopy("已复制"))
                          .catch(() => setCopy("复制失败，请选中编号手动复制"));
                      }}
                    >
                      <Copy size={14} aria-hidden="true" />
                      {copy}
                    </button>
                  ) : null}
                  <button type="button" className="button" onClick={() => copyDetail(JSON.stringify({
                    label: data.label, taskId, status, error, model: runNode?.request?.model ?? data.generatedModel,
                    connection: runNode?.request?.connectionName ?? data.generatedConnectionName,
                    group: data.generatedGroup, ...details, references, prompt, parameters,
                    referenceImageCount: references && !unknownCount ? imageCount : undefined,
                    actualDimensions: dimensions, createdAt: data.generatedCreatedAt,
                    file: asset ? { name: asset.name, mimeType: asset.mimeType, size: asset.size, savedAt: asset.createdAt } : undefined,
                  }, null, 2), "完整信息")}><Copy size={14} aria-hidden="true" />复制完整信息</button>
                  </div>
                  {copiedDetail ? <p className="result-info-note" role="status">{copiedDetail}</p> : null}
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

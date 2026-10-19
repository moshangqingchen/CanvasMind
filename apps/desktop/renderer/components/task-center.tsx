"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  Pin,
  RefreshCw,
  X,
} from "lucide-react";
import { fetchRuns } from "../lib/client-api";
import { localizeRunError } from "../lib/error-localization";
import { runErrorTechnicalTitle } from "../lib/run-error-diagnostics";
import { taskOutcomeLabel, taskOutcomeNote } from "../lib/task-evidence";
import { TaskEvidence } from "./task-evidence";
import { FailureDiagnosis } from "./failure-diagnosis";
import { resultElapsed } from "../lib/result-provenance";
import { downloadBlob } from "../lib/blob-download";
import { useDialogFocus } from "./use-dialog-focus";
import type { RunSnapshot } from "./types";
import "./task-center.css";
import { VirtualList } from "./virtual-list";

function TaskDetails({ title, className = "", children, expanded, onExpanded }: { title: ReactNode; className?: string; children: ReactNode; expanded: boolean; onExpanded: (value: boolean) => void }) {
  return <details className={`history-errors ${className}`} open={expanded} onToggle={event => onExpanded(event.currentTarget.open)}>
    <summary className={className.includes("failure") ? "history-error" : undefined}>{title}</summary>
    {expanded ? children : null}
  </details>;
}
interface ModalProps {
  open: boolean;
  onClose: () => void;
}
const statusLabels: Record<string, string> = {
  blocked: "等待上游",
  queued: "排队中",
  submitting: "正在提交",
  running: "生成中",
  archiving: "保存结果",
  succeeded: "已完成",
  failed: "失败",
  cancel_requested: "取消中",
  cancelled: "已取消",
  needs_attention: "需要处理",
};
const phaseLabels: Record<string, string> = {
  cloud_queued: "云端排队",
  waiting_provider: "等待供应商",
  generating: "供应商生成",
  receiving: "接收结果",
  cloud_saving: "云端保存",
  downloading: "下载结果",
};
export function RunHistoryModal({
  open,
  onClose,
  canvasId,
  onReuseAsset,
  onResumeRun,
  onRecoverOutputs,
}: ModalProps & {
  canvasId: string | null;
  onReuseAsset: (assetId: string) => void;
  onResumeRun: (runId: string) => Promise<void>;
  onRecoverOutputs: (runId: string) => Promise<void>;
}) {
  const [runs, setRuns] = useState<RunSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const setDetailsExpanded = (id: string, value: boolean) => setExpanded(current => {
    if (current.has(id) === value) return current;
    const next = new Set(current);
    if (value) next.add(id); else next.delete(id);
    return next;
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  const dialogRef = useDialogFocus(open, onClose);
  const reload = async () => {
    if (!canvasId) return;
    const sequence = ++requestSequence.current;
    setBusy(true);
    setLoadError(null);
    try {
      const items = await fetchRuns(canvasId);
      if (sequence === requestSequence.current) { setRuns(items); setLoaded(true); }
    } catch (error) {
      if (sequence === requestSequence.current)
        setLoadError(
          error instanceof Error ? error.message : "无法读取运行历史",
        );
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (!open || !canvasId) return;
    let cancelled = false;
    const invalidate = () => {
      requestSequence.current += 1;
    };
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      const sequence = ++requestSequence.current;
      void fetchRuns(canvasId)
        .then((items) => {
          if (cancelled || sequence !== requestSequence.current) return;
          setRuns(items);
          setLoaded(true);
          setBusy(false);
          setLoadError(null);
        })
        .catch((error: unknown) => {
          if (cancelled || sequence !== requestSequence.current) return;
          setLoadError(
            error instanceof Error ? error.message : "无法读取运行历史",
          );
        })
        .finally(() => {
          if (!cancelled) {
            if (sequence === requestSequence.current) setBusy(false);
            timer = setTimeout(poll, 4000);
          }
        });
    };
    poll();
    return () => {
      cancelled = true;
      invalidate();
      clearTimeout(timer);
    };
  }, [open, canvasId]);
  const counts = useMemo(() => ({
    all: runs.length,
    active: runs.filter(({ run }) => ["blocked", "queued", "submitting", "running", "archiving", "cancel_requested"].includes(run.status)).length,
    attention: runs.filter(({ run }) => ["failed", "needs_attention"].includes(run.status)).length,
    succeeded: runs.filter(({ run }) => run.status === "succeeded").length,
  }), [runs]);
  const visibleRuns = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return runs.filter(
      ({ run }) =>
        filter === "all" ||
        (filter === "active"
          ? [
              "blocked",
              "queued",
              "submitting",
              "running",
              "archiving",
              "cancel_requested",
            ].includes(run.status)
          : filter === "attention"
            ? ["failed", "needs_attention"].includes(run.status)
            : run.status === filter),
    ).filter(({ run, nodes }) => !needle || `${run.id} ${nodes.map(node => `${node.nodeId} ${node.request?.model ?? ""} ${node.errorJson?.message ?? ""}`).join(" ")}`.toLocaleLowerCase().includes(needle));
  }, [runs, filter, query]);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal-window history-modal"
        role="dialog"
        aria-modal="true"
        aria-label="运行历史"
        tabIndex={-1}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          const typing = (event.target as HTMLElement).closest("input,textarea,[contenteditable=true]");
          if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") || (event.key === "/" && !typing)) {
            event.preventDefault(); event.stopPropagation(); searchRef.current?.focus();
          }
        }}
      >
        <header className="modal-head">
          <div className="task-heading">
            <span className="task-heading-icon" aria-hidden="true"><Clock3 size={22} strokeWidth={1.75} /></span>
            <div><span className="eyebrow">生成记录</span><h2>任务中心</h2></div>
          </div>
          <div className="modal-head-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => void reload()}
              aria-label="刷新"
              title="刷新任务"
            >
              <RefreshCw className={busy ? "spin" : ""} size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={onClose}
              aria-label="关闭"
              title="关闭（Esc）"
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="library-filter-row">
          <div className="task-tabs" role="tablist" aria-label="任务状态">
            {([['all', '全部'], ['active', '进行中'], ['attention', '需要处理'], ['succeeded', '已完成']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}>{label} <span>{counts[id]}</span></button>)}
          </div>
          <input ref={searchRef} className="task-search" aria-label="搜索任务" placeholder="搜索型号、任务或错误…" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <div className="task-content">
          {loadError ? (
            <div className="modal-message history-load-error" role="alert">
              <CircleAlert size={15} />
              <span>{loadError}</span>
              <button
                className="button small"
                type="button"
                onClick={() => void reload()}
                disabled={busy}
              >
                <RefreshCw className={busy ? "spin" : ""} size={12} />
                重试
              </button>
            </div>
          ) : null}
          {actionError ? (
            <div className="modal-message history-load-error" role="alert">
              <CircleAlert size={15} />
              <span>{actionError}</span>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭任务操作提示"
                title="关闭任务操作提示"
                onClick={() => setActionError(null)}
              >
                <X size={15} />
              </button>
            </div>
          ) : null}
          {!loaded && !loadError ? <div className="task-skeleton" role="status" aria-label="正在读取任务"><i /><i /><i /></div> : visibleRuns.length === 0 && !loadError ? (
            <div className="empty-state">
              <Clock3 size={24} />
              <span>{runs.length ? "当前筛选没有任务" : "还没有运行记录"}</span>
            </div>
          ) : visibleRuns.length > 0 ? (
            <VirtualList items={visibleRuns} itemKey={item => item.run.id} label="任务列表" className="history-list" estimatedHeight={180} resetKey={`${filter}:${query}`} renderItem={({ run, nodes }) => {
              const outputAssetIds = [
                ...new Set(nodes.flatMap((node) => node.outputAssetIds)),
              ];
              const nodeErrors = nodes.filter((node) =>
                Boolean(node.errorJson?.message) || ["failed", "needs_attention"].includes(node.status),
              );
              // The preview endpoint accepts images only; unknown and non-image results keep a neutral tile.
              const outputPreviewId = nodes.find(node => node.request?.operation?.startsWith("image.") && node.outputAssetIds.length)?.outputAssetIds[0];
              const completedNodes = nodes.filter(node => node.status === "succeeded").length;
              const completion = nodes.length ? completedNodes / nodes.length * 100 : 0;
              return (
                <article className="history-row" key={run.id} data-run-id={run.id} data-status={run.status}>
                  <span className={`history-status ${run.status}`} aria-hidden="true" />
                  <div className="task-preview">
                  {outputPreviewId ? <img className="task-thumbnail" src={`/api/assets/${encodeURIComponent(outputPreviewId)}/preview?size=160`} alt="" loading="lazy" decoding="async" /> : <span className="task-thumbnail task-thumbnail-empty"><Clock3 size={18} /></span>}
                    <svg className="task-progress-ring" viewBox="0 0 24 24" role="img" aria-label={`${completedNodes} / ${nodes.length} 个节点已完成`}>
                      <circle className="task-progress-track" cx="12" cy="12" r="9" />
                      <circle className="task-progress-value" cx="12" cy="12" r="9" pathLength="100" strokeDasharray={`${completion} 100`} />
                    </svg>
                  </div>
                  <div className="history-main">
                    <strong>
                      {run.scope === "all"
                        ? "整张画布"
                        : run.scope === "downstream"
                          ? "运行下游"
                          : "运行当前节点"}
                    </strong>
                    <span className="task-model" title={nodes.map(node => node.request?.model).filter(Boolean).join(" · ")}>{nodes.map(node => node.request?.model).filter(Boolean).join(" · ") || "—"}</span>
                    <small>
                      {new Date(run.createdAt).toLocaleString("zh-CN")} ·{" "}
                      {completedNodes}
                      /{nodes.length} 节点完成
                    </small>
                    <small>
                      已用时{" "}
                      {resultElapsed(
                        run.createdAt,
                        [
                          "succeeded",
                          "failed",
                          "cancelled",
                          "needs_attention",
                        ].includes(run.status)
                          ? run.updatedAt
                          : new Date().toISOString(),
                      )}{" "}
                      · 最近更新{" "}
                      {run.updatedAt
                        ? new Date(run.updatedAt).toLocaleTimeString("zh-CN")
                        : "未记录"}
                    </small>
                    <TaskDetails title="查看任务进度" expanded={expanded.has(`${run.id}:progress`)} onExpanded={value => setDetailsExpanded(`${run.id}:progress`, value)}>
                      <ul className="history-error-list task-progress">
                        {nodes.map((node) => (
                          <li key={node.id}>
                            <strong>
                              {node.request?.model ?? node.nodeId}
                            </strong>
                            <span>
                              {taskOutcomeLabel(node.status, node.taskEvidence, node.recoveryAction) ?? statusLabels[node.status] ?? node.status}
                              {node.request?.submissionPhase &&
                              ![
                                "succeeded",
                                "failed",
                                "cancelled",
                                "needs_attention",
                              ].includes(node.status)
                                ? ` · ${phaseLabels[node.request.submissionPhase] ?? node.request.submissionPhase}`
                                : ""}
                            </span>
                            {node.request?.provider ? <TaskEvidence request={node.request} evidence={node.taskEvidence} /> : null}
                            {!node.errorJson && taskOutcomeNote(node.status, node.taskEvidence, node.recoveryAction) ? <small>{taskOutcomeNote(node.status, node.taskEvidence, node.recoveryAction)}</small> : null}
                            {node.request?.submissionTimeline?.map(
                              (entry, index) => (
                                <small key={index}>
                                  {new Date(entry.at).toLocaleTimeString(
                                    "zh-CN",
                                  )}{" "}
                                  · {phaseLabels[entry.phase] ?? entry.phase}
                                </small>
                              ),
                            )}
                            {node.updatedAt && (
                              <small>
                                更新于{" "}
                                {new Date(node.updatedAt).toLocaleString(
                                  "zh-CN",
                                )}
                              </small>
                            )}
                          </li>
                        ))}
                      </ul>
                    </TaskDetails>
                    <button
                      className="button ghost small"
                      type="button"
                      onClick={() => {
                        const diagnostic = {
                          exportedAt: new Date().toISOString(),
                          run,
                          nodes: nodes.map((node) => ({
                            id: node.id,
                            nodeId: node.nodeId,
                            status: node.status,
                            updatedAt: node.updatedAt,
                            outputAssetIds: node.outputAssetIds,
                            recoveryAction: node.recoveryAction,
                            error: localizeRunError(node.errorJson, { provider: node.request?.provider, supplier: node.request?.supplier, status: node.status, providerTaskStatus: node.taskEvidence?.status }),
                            model: node.request?.model,
                            supplier: node.request?.supplier,
                            connectionName: node.request?.connectionName,
                            modelGroup: node.request?.modelGroup,
                            taskEvidence: node.taskEvidence,
                            phase: node.request?.submissionPhase,
                            timeline: node.request?.submissionTimeline,
                          })),
                        };
                        downloadBlob(
                          new Blob([JSON.stringify(diagnostic, null, 2)], {
                            type: "application/json",
                          }),
                          `task-${run.id}.json`,
                        );
                      }}
                    >
                      <Download size={12} /> 导出诊断信息
                    </button>
                    {nodeErrors.length > 0 ? (
                      <TaskDetails className="task-failure" expanded={expanded.has(`${run.id}:failure`)} onExpanded={value => setDetailsExpanded(`${run.id}:failure`, value)} title={<><span className="task-error-summary" title={localizeRunError(nodeErrors[0]?.errorJson, { status: nodeErrors[0]?.status, provider: nodeErrors[0]?.request?.provider, supplier: nodeErrors[0]?.request?.supplier, providerTaskStatus: nodeErrors[0]?.taskEvidence?.status })?.message}>{localizeRunError(nodeErrors[0]?.errorJson, { status: nodeErrors[0]?.status, provider: nodeErrors[0]?.request?.provider, supplier: nodeErrors[0]?.request?.supplier, providerTaskStatus: nodeErrors[0]?.taskEvidence?.status })?.message ?? `${nodeErrors.length} 个节点需要处理`}</span><span>查看原因</span></>}>
                        <ul className="history-error-list">
                          {nodeErrors.map((node) => {
                            const localized = localizeRunError(node.errorJson, { provider: node.request?.provider, supplier: node.request?.supplier, status: node.status, providerTaskStatus: node.taskEvidence?.status });
                            return (
                              <li key={node.id}>
                                <strong>{node.nodeId}</strong>
                                <div className="history-error-detail">
                                  <FailureDiagnosis error={localized} rawError={node.errorJson} providerTaskId={node.taskEvidence?.taskId} status={node.status} providerTaskStatus={node.taskEvidence?.status} recoveryAction={node.recoveryAction} />
                                  {localized?.actionUrl ? (
                                    <a
                                      href={localized.actionUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <ExternalLink size={10} />
                                      {localized.actionLabel ?? "供应商官网"}
                                    </a>
                                  ) : null}
                                  <details>
                                    <summary>{runErrorTechnicalTitle(localized)}</summary>
                                    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(localized, null, 2)}</pre>
                                    <button type="button" className="button ghost small" onClick={(event) => {
                                      const button = event.currentTarget;
                                      void navigator.clipboard.writeText(JSON.stringify({ error: localized, runId: run.id, nodeId: node.nodeId, taskEvidence: node.taskEvidence }, null, 2))
                                        .then(() => { button.textContent = "已复制"; })
                                        .catch(() => { button.textContent = "复制失败，请手动选择"; });
                                    }}>复制错误详情</button>
                                  </details>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </TaskDetails>
                    ) : null}
                    {outputAssetIds.length > 0 ? (
                      <div className="history-output-actions">
                        {outputAssetIds.map((assetId, index) => (
                          <button
                            className="button ghost small"
                            type="button"
                            key={assetId}
                            onClick={() => {
                              onReuseAsset(assetId);
                              onClose();
                            }}
                            title="固定为画布素材输入"
                          >
                            <Pin size={11} /> 固定输出 {index + 1}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {run.canRecoverOutputs ? (
                      <div className="history-output-actions">
                        <button
                          className="button small"
                          type="button"
                          disabled={
                            busy || resumingId !== null || recoveringId !== null
                          }
                          title="取回供应商已返回的图片，不重新生成"
                          onClick={async () => {
                            setActionError(null);
                            setRecoveringId(run.id);
                            try {
                              await onRecoverOutputs(run.id);
                              await reload();
                            } catch (error) {
                              setActionError(
                                error instanceof Error
                                  ? error.message
                                  : "取回已有图片失败",
                              );
                            } finally {
                              setRecoveringId(null);
                            }
                          }}
                        >
                          <RefreshCw
                            className={recoveringId === run.id ? "spin" : ""}
                            size={11}
                          />
                          {recoveringId === run.id
                            ? "正在取回"
                            : "取回已有图片"}
                        </button>
                      </div>
                    ) : run.status === "failed" ||
                      run.status === "needs_attention" ? (
                      <div className="history-output-actions">
                        {run.canResume ? (
                          <button
                            className="button small"
                            type="button"
                            disabled={
                              busy ||
                              resumingId !== null ||
                              recoveringId !== null
                            }
                            onClick={async () => {
                              setActionError(null);
                              setResumingId(run.id);
                              try {
                                await onResumeRun(run.id);
                                await reload();
                              } catch (error) {
                                setActionError(
                                  error instanceof Error
                                    ? error.message
                                    : "任务恢复失败",
                                );
                              } finally {
                                setResumingId(null);
                              }
                            }}
                          >
                            <RefreshCw
                              className={resumingId === run.id ? "spin" : ""}
                              size={11}
                            />
                            {resumingId === run.id ? "恢复中" : "恢复任务"}
                          </button>
                        ) : (
                          <span className="history-resume-blocked">
                            无法自动恢复，请先核对供应商任务与扣费记录
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <span className={`status-label ${run.status}`}>
                    {statusLabels[run.status] ?? run.status}
                  </span>
                </article>
              );
            }} />
          ) : null}
        </div>
      </section>
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
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
import { taskOutcomeLabel, taskOutcomeNote } from "../lib/task-evidence";
import { TaskEvidence } from "./task-evidence";
import { FailureDiagnosis } from "./failure-diagnosis";
import { resultElapsed } from "../lib/result-provenance";
import { downloadBlob } from "../lib/blob-download";
import { useDialogFocus } from "./use-dialog-focus";
import type { RunSnapshot } from "./types";
import "./task-center.css";
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
  const requestSequence = useRef(0);
  const dialogRef = useDialogFocus(open, onClose);
  const reload = async () => {
    if (!canvasId) return;
    const sequence = ++requestSequence.current;
    setBusy(true);
    setLoadError(null);
    try {
      const items = await fetchRuns(canvasId);
      if (sequence === requestSequence.current) setRuns(items);
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
  const visibleRuns = runs.filter(
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
  );
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
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">生成记录</span>
            <h2>任务中心</h2>
          </div>
          <div className="modal-head-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => void reload()}
              aria-label="刷新"
            >
              <RefreshCw className={busy ? "spin" : ""} size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={onClose}
              aria-label="关闭"
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="library-filter-row">
          <label>
            任务状态{" "}
            <select
              aria-label="筛选任务状态"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">全部任务</option>
              <option value="active">正在进行</option>
              <option value="attention">需要处理</option>
              <option value="succeeded">已完成</option>
            </select>
          </label>
          <span>当前项目 · 每 4 秒更新</span>
        </div>
        <div className="history-list">
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
                onClick={() => setActionError(null)}
              >
                <X size={15} />
              </button>
            </div>
          ) : null}
          {visibleRuns.length === 0 && !loadError ? (
            <div className="empty-state">
              <Clock3 size={24} />
              <span>{runs.length ? "当前筛选没有任务" : "还没有运行记录"}</span>
            </div>
          ) : visibleRuns.length > 0 ? (
            visibleRuns.map(({ run, nodes }) => {
              const outputAssetIds = [
                ...new Set(nodes.flatMap((node) => node.outputAssetIds)),
              ];
              const nodeErrors = nodes.filter((node) =>
                Boolean(node.errorJson?.message) || ["failed", "needs_attention"].includes(node.status),
              );
              return (
                <article className="history-row" key={run.id}>
                  <span className={`history-status ${run.status}`} />
                  <div className="history-main">
                    <strong>
                      {run.scope === "all"
                        ? "整张画布"
                        : run.scope === "downstream"
                          ? "运行下游"
                          : "运行当前节点"}
                    </strong>
                    <small>
                      {new Date(run.createdAt).toLocaleString("zh-CN")} ·{" "}
                      {
                        nodes.filter((node) => node.status === "succeeded")
                          .length
                      }
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
                    <details className="history-errors">
                      <summary>查看任务进度</summary>
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
                    </details>
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
                      <details className="history-errors" open>
                        <summary className="history-error">
                          {nodeErrors.length} 个节点错误
                        </summary>
                        <ul className="history-error-list">
                          {nodeErrors.map((node) => {
                            const localized = localizeRunError(node.errorJson, { provider: node.request?.provider, supplier: node.request?.supplier, status: node.status, providerTaskStatus: node.taskEvidence?.status });
                            return (
                              <li key={node.id}>
                                <strong>{node.nodeId}</strong>
                                <div className="history-error-detail">
                                  <FailureDiagnosis error={localized} status={node.status} providerTaskStatus={node.taskEvidence?.status} recoveryAction={node.recoveryAction} />
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
                                    <summary>技术详情与上游原文</summary>
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
                      </details>
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
            })
          ) : null}
        </div>
      </section>
    </div>
  );
}

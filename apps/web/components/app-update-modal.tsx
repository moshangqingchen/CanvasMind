"use client";

import {
  Check,
  CircleAlert,
  Download,
  ExternalLink,
  RefreshCw,
  X,
} from "lucide-react";
import type { AppUpdateView } from "../lib/client-api";

interface AppUpdateModalProps {
  open: boolean;
  status: AppUpdateView | null;
  busy?: boolean;
  onClose: () => void;
  onCheck: () => void;
  onDownload: () => void;
  onApply: () => void;
  onDefer: () => void;
  reloadReady?: boolean;
  onReload?: () => void;
}

function phaseLabel(status: AppUpdateView): string {
  if (status.remoteUpdateAvailable) {
    if (status.remoteSyncState === "blocked_dirty")
      return "检测到远程提交，但本地有未提交改动，未自动同步";
    if (status.remoteSyncState === "blocked")
      return status.remoteSyncError || "检测到远程提交，但未能安全同步";
    return `检测到 ${status.remoteBranch || "main"} 新提交，正在同步…`;
  }
  switch (status.phase) {
    case "checking":
      return "正在检查远程提交…";
    case "downloading":
      return "正在后台下载更新包…";
    case "ready":
      return "更新包已校验，可以应用";
    case "waiting_for_idle":
      return "等待生成任务完成后切换…";
    case "applying":
      return "正在切换到新版本…";
    case "failed":
      return status.error || "更新暂时不可用";
    default:
      return "";
  }
}

function formatBytes(value?: number): string {
  if (!value || value <= 0) return "";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function AppUpdateModal({
  open,
  status,
  busy = false,
  onClose,
  onCheck,
  onDownload,
  onApply,
  onDefer,
  reloadReady = false,
  onReload,
}: AppUpdateModalProps) {
  if (!open || !status) return null;
  const latest = status.latest;
  const remoteCommit = status.remoteCommit?.slice(0, 8);
  const hasRemoteSourceUpdate = Boolean(
    status.remoteUpdateAvailable && status.remoteCommit,
  );
  const progress = status.progress;
  const progressPercent =
    progress?.totalBytes && progress.totalBytes > 0
      ? Math.min(
          100,
          Math.round((progress.downloadedBytes / progress.totalBytes) * 100),
        )
      : null;
  const canDownload = Boolean(
    latest &&
    (status.phase === "available" || status.phase === "idle") &&
    latest.version !== status.currentVersion &&
    status.managerAvailable,
  );
  const canApply = status.phase === "ready" && status.managerAvailable;
  const visibleNotes =
    latest?.notes ||
    (!latest && !hasRemoteSourceUpdate ? status.currentNotes : undefined);

  return (
    <div className="modal-backdrop app-update-backdrop" role="presentation">
      <section
        className="modal-window app-update-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
      >
        <header className="modal-head">
          <div>
            <span className="modal-eyebrow">应用版本</span>
            <h2 id="app-update-title">超级画布更新</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭更新窗口"
          >
            <X size={15} />
          </button>
        </header>

        <div className="app-update-body">
          <div className="app-update-version-row">
            <div>
              <span>当前版本</span>
              <strong>v{status.currentVersion}</strong>
            </div>
            <span className="app-update-arrow">→</span>
            <div>
              <span>最新版本</span>
              <strong>
                {latest
                  ? `v${latest.version}`
                  : hasRemoteSourceUpdate
                    ? `${status.remoteBranch || "main"} · ${remoteCommit}`
                    : "暂无"}
              </strong>
            </div>
          </div>

          {latest ? (
            <div className="app-update-meta">
              <span>
                {latest.publishedAt
                  ? new Date(latest.publishedAt).toLocaleString("zh-CN")
                  : "GitHub Release"}
              </span>
              {latest.commit ? <code>{latest.commit.slice(0, 8)}</code> : null}
              {latest.htmlUrl ? (
                <a href={latest.htmlUrl} target="_blank" rel="noreferrer">
                  查看 Release <ExternalLink size={12} />
                </a>
              ) : null}
            </div>
          ) : hasRemoteSourceUpdate ? (
            <div className="app-update-meta">
              <span>远程 Git 推送</span>
              <code>{remoteCommit}</code>
              {status.remoteCommitUrl ? (
                <a
                  href={status.remoteCommitUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看提交 <ExternalLink size={12} />
                </a>
              ) : null}
            </div>
          ) : null}

          {visibleNotes ? (
            <div className="app-update-notes">
              <div className="app-update-notes-title">
                {latest ? "更新说明" : "本版本更新"}
              </div>
              <pre>{visibleNotes}</pre>
            </div>
          ) : (
            <p className="app-update-empty">
              {hasRemoteSourceUpdate
                ? "检测到远程提交；源码服务会在工作区安全时自动同步并重建。"
                : "没有可显示的 Release 说明。"}
            </p>
          )}

          {status.phase === "downloading" && progress ? (
            <div className="app-update-progress" aria-label="下载进度">
              <div className="app-update-progress-head">
                <span>
                  {formatBytes(progress.downloadedBytes)}
                  {progress.totalBytes
                    ? ` / ${formatBytes(progress.totalBytes)}`
                    : ""}
                </span>
                {progressPercent !== null ? (
                  <strong>{progressPercent}%</strong>
                ) : null}
              </div>
              <div className="app-update-progress-track">
                <span style={{ width: `${progressPercent ?? 0}%` }} />
              </div>
            </div>
          ) : null}

          {phaseLabel(status) ? (
            <div
              className={`app-update-status app-update-status-${status.phase}`}
            >
              {status.phase === "failed" ? (
                <CircleAlert size={14} />
              ) : (
                <RefreshCw size={14} />
              )}
              <span>{phaseLabel(status)}</span>
            </div>
          ) : null}
          {!status.managerAvailable ? (
            <div className="app-update-status app-update-status-failed">
              <CircleAlert size={14} />
              <span>本地更新管理器未运行，请先启动本地服务。</span>
            </div>
          ) : null}
        </div>

        <footer className="modal-actions app-update-actions">
          <button
            className="button ghost small"
            type="button"
            onClick={onClose}
          >
            关闭
          </button>
          {latest &&
          (status.phase === "available" ||
            (status.phase === "idle" &&
              latest.version !== status.currentVersion)) ? (
            <>
              <button
                className="button ghost small"
                type="button"
                onClick={onDefer}
                disabled={busy}
              >
                稍后提醒
              </button>
              <button
                className="button primary small"
                type="button"
                onClick={onDownload}
                disabled={!canDownload || busy}
              >
                <Download size={13} /> 下载更新
              </button>
            </>
          ) : null}
          {status.phase === "ready" ? (
            <button
              className="button primary small"
              type="button"
              onClick={onApply}
              disabled={!canApply || busy}
            >
              <Check size={13} /> 应用更新
            </button>
          ) : null}
          {reloadReady && onReload ? (
            <button
              className="button primary small"
              type="button"
              onClick={onReload}
            >
              <RefreshCw size={13} /> 重新加载画布
            </button>
          ) : null}
          {status.phase === "failed" || !latest ? (
            <button
              className="button primary small"
              type="button"
              onClick={onCheck}
              disabled={busy}
            >
              <RefreshCw size={13} /> 立即检查
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

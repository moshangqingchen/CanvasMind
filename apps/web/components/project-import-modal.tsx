"use client";

import { AlertTriangle, Archive, FileJson, X } from "lucide-react";
import { useEffect, useRef } from "react";

import type { PreparedProjectImport } from "../lib/project-transfer";

export interface ProjectImportModalProps {
  prepared: PreparedProjectImport;
  busy: boolean;
  backupCurrent: boolean;
  progress?: { completed: number; total: number } | null;
  error?: string | null;
  onBackupCurrentChange: (checked: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ProjectImportModal({
  prepared,
  busy,
  backupCurrent,
  progress,
  error,
  onBackupCurrentChange,
  onCancel,
  onConfirm,
}: ProjectImportModalProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const packageIncomplete =
    prepared.source === "package" && prepared.missingAssetIds.length > 0;

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="modal-backdrop project-import-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && event.currentTarget === event.target) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="modal-window project-import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-import-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onCancel();
        }}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">导入预检</span>
            <h2 id="project-import-title">确认替换当前画布</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="关闭"
          >
            <X size={17} />
          </button>
        </header>

        <div className="project-import-body">
          <div className="project-import-source">
            <span className="project-import-source-icon" aria-hidden="true">
              {prepared.source === "package" ? (
                <Archive size={20} />
              ) : (
                <FileJson size={20} />
              )}
            </span>
            <div>
              <strong>{prepared.title}</strong>
              <span>
                {prepared.source === "package"
                  ? "完整项目包 · 会复制包内素材"
                  : "结构 JSON · 复用当前素材库中的同 ID 素材"}
              </span>
            </div>
          </div>

          <dl className="project-import-summary">
            <div>
              <dt>节点</dt>
              <dd>{prepared.graph.nodes.length}</dd>
            </div>
            <div>
              <dt>连线</dt>
              <dd>{prepared.graph.edges.length}</dd>
            </div>
            <div>
              <dt>涂鸦</dt>
              <dd>{prepared.graph.drawings?.length ?? 0}</dd>
            </div>
            <div>
              <dt>包内素材</dt>
              <dd>{prepared.packageAssets.length}</dd>
            </div>
          </dl>

          {prepared.missingAssetIds.length > 0 ? (
            <div
              className={`project-import-warning ${packageIncomplete ? "is-blocking" : ""}`}
              role="alert"
            >
              <AlertTriangle size={17} />
              <div>
                <strong>
                  {packageIncomplete
                    ? "项目包不完整，不能导入"
                    : `有 ${prepared.missingAssetIds.length} 个素材引用在当前素材库中不存在`}
                </strong>
                <span>
                  {packageIncomplete
                    ? "请重新从源项目导出完整项目包。"
                    : "结构仍可导入；相关节点会显示素材缺失，可随后重新选择素材。"}
                </span>
              </div>
            </div>
          ) : (
            <div className="project-import-ready">
              结构校验通过
              {prepared.source === "package"
                ? `，${prepared.packageAssets.length} 个素材已核对`
                : "，素材引用均可解析"}
              。
            </div>
          )}

          <label className="project-import-backup-option">
            <input
              type="checkbox"
              checked={backupCurrent}
              disabled={busy}
              onChange={(event) =>
                onBackupCurrentChange(event.currentTarget.checked)
              }
            />
            <span>
              <strong>替换前下载当前画布 JSON 备份</strong>
              <small>不包含素材文件；用于快速撤销误导入。</small>
            </span>
          </label>

          {progress && progress.total > 0 ? (
            <div className="project-import-progress" role="status">
              <span>
                正在导入素材 {progress.completed}/{progress.total}
              </span>
              <progress value={progress.completed} max={progress.total} />
            </div>
          ) : null}
          {error ? (
            <div className="project-import-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="project-import-actions">
          <button
            className="button ghost"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            取消
          </button>
          <button
            className="button primary"
            type="button"
            onClick={onConfirm}
            disabled={busy || packageIncomplete}
          >
            {busy ? "正在导入…" : backupCurrent ? "备份并替换" : "替换当前画布"}
          </button>
        </footer>
      </section>
    </div>
  );
}

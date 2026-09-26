"use client";

import { CircleAlert, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectSummaryView } from "../lib/client-api";

export type ProjectActionDialogState = {
  mode: "rename" | "delete" | "cleanup";
  project: ProjectSummaryView;
};

interface ProjectActionDialogProps {
  action: ProjectActionDialogState;
  onClose: () => void;
  onRename: (projectId: string, title: string) => Promise<void>;
  onDelete: (projectId: string) => Promise<void>;
  onCleanup: (projectId: string) => Promise<void>;
}

export function ProjectActionDialog({
  action,
  onClose,
  onRename,
  onDelete,
  onCleanup,
}: ProjectActionDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState(action.project.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
      if (action.mode === "rename") inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [action]);
  const isRename = action.mode === "rename";
  const isDelete = action.mode === "delete";
  const heading = isRename
    ? "重命名项目"
    : isDelete
      ? "删除项目"
      : "清理项目草稿";
  const confirmLabel = isRename
    ? "保存名称"
    : isDelete
      ? "永久删除"
      : "确认清理";
  const renameDisabled =
    isRename &&
    (!title.trim() || title.trim() === action.project.title || title.length > 160);

  const submit = async () => {
    if (busy || renameDisabled) return;
    setBusy(true);
    setError("");
    try {
      if (isRename) await onRename(action.project.id, title.trim());
      else if (isDelete) await onDelete(action.project.id);
      else await onCleanup(action.project.id);
      onClose();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : `${heading}失败`,
      );
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop project-action-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`modal-window project-action-dialog ${isDelete ? "is-danger" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-action-dialog-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="project-action-dialog-head">
          <div className={`project-action-dialog-icon ${isDelete ? "danger" : ""}`}>
            {isRename ? <Pencil size={18} /> : <Trash2 size={18} />}
          </div>
          <div>
            <span>{isRename ? "项目设置" : "需要确认"}</span>
            <h2 id="project-action-dialog-title">{heading}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={`关闭${heading}窗口`}
          >
            <X size={16} />
          </button>
        </header>

        <div className="project-action-dialog-body">
          {isRename ? (
            <label className="project-rename-field">
              <span>项目名称</span>
              <input
                ref={inputRef}
                value={title}
                maxLength={160}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
              <small>保存后，左侧项目名称和本地项目文件夹会同步更名。</small>
            </label>
          ) : (
            <>
              <div className={`project-action-warning ${isDelete ? "danger" : ""}`}>
                <CircleAlert size={18} aria-hidden="true" />
                <div>
                  <strong>
                    {isDelete
                      ? "此操作无法撤销"
                      : "只会清理草稿，不影响成品"}
                  </strong>
                  <p>
                    {isDelete
                      ? "项目画布、对话、运行记录以及草稿和成品文件夹都会被永久删除。"
                      : "草稿中的外界素材和画布生成文件会被清空，成品文件夹会完整保留。"}
                  </p>
                </div>
              </div>
              <div className="project-action-target">
                <span>当前项目</span>
                <strong title={action.project.title}>{action.project.title}</strong>
              </div>
            </>
          )}
          {error ? (
            <div className="project-action-error" role="alert">
              <CircleAlert size={14} /> {error}
            </div>
          ) : null}
        </div>

        <footer className="project-action-dialog-actions">
          <button
            className="button ghost"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <button
            className={`button ${isDelete ? "danger" : "primary"}`}
            type="button"
            onClick={() => void submit()}
            disabled={busy || renameDisabled}
          >
            {busy ? "正在处理…" : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

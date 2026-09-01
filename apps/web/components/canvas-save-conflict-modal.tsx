"use client";

import { AlertTriangle, Download, RefreshCw, X } from "lucide-react";
import { useEffect, useRef } from "react";

export interface CanvasSaveConflictModalProps {
  open: boolean;
  currentRevision: number;
  onClose: () => void;
  onExport: () => void;
  onReload: () => void;
}

export function CanvasSaveConflictModal({
  open,
  currentRevision,
  onClose,
  onExport,
  onReload,
}: CanvasSaveConflictModalProps) {
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) dialogRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop save-conflict-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal-window save-conflict-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-conflict-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">保存已暂停</span>
            <h2 id="save-conflict-title">画布已在其他窗口更新</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="稍后处理保存冲突"
          >
            <X size={17} />
          </button>
        </header>

        <div className="save-conflict-body">
          <div className="save-conflict-warning" role="alert">
            <AlertTriangle aria-hidden="true" size={20} />
            <div>
              <strong>为避免覆盖较新的内容，本页不会继续自动保存。</strong>
              <p>
                服务器当前版本为 {currentRevision}。你的本地编辑仍保留在当前页面，
                可以先导出副本，再载入服务器版本。
              </p>
            </div>
          </div>
          <p className="save-conflict-note">
            关闭此窗口不会丢弃本地内容；顶部“保存冲突”状态可重新打开处理。
          </p>
        </div>

        <footer className="save-conflict-actions">
          <button className="button ghost" type="button" onClick={onExport}>
            <Download size={15} /> 导出当前副本
          </button>
          <button className="button danger" type="button" onClick={onReload}>
            <RefreshCw size={15} /> 放弃本地改动并载入
          </button>
        </footer>
      </section>
    </div>
  );
}

"use client";

import { useId, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Download, LoaderCircle, X } from "lucide-react";
import {
  downloadAssetPreferLocal,
  type ImageDownloadFormat,
} from "../lib/asset-download";
import { useDialogFocus } from "./use-dialog-focus";
import styles from "./image-download-button.module.css";

const formatNotes: Record<ImageDownloadFormat, string> = {
  original: "保留原始格式、画质和文件内容。",
  png: "无损格式，保留透明背景和原始尺寸。",
  jpg: "高质量 JPG，保留原始尺寸；透明区域将填充为白色。",
  webp: "无损 WebP，保留透明背景和原始尺寸。",
};

function ImageDownloadDialog({
  assetId,
  filename,
  onClose,
}: {
  assetId: string;
  filename?: string;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ImageDownloadFormat>("original");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogFocus(true, () => {
    if (!busy) onClose();
  });
  const id = useId();

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await downloadAssetPreferLocal(assetId, filename, format);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "下载失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className={`modal-backdrop ${styles.backdrop} nodrag nopan nowheel`}
      role="presentation"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`modal-window ${styles.dialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={`${id}-title`}>下载图片</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭下载窗口"
            disabled={busy}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>
        <div className={styles.body}>
          {filename && <p className={styles.filename}>{filename}</p>}
          <label className={styles.field}>
            <span>下载格式</span>
            <select
              value={format}
              disabled={busy}
              aria-describedby={`${id}-note`}
              onChange={(event) => {
                setFormat(event.target.value as ImageDownloadFormat);
                setError(null);
              }}
            >
              <option value="original">原文件（保持原格式）</option>
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
              <option value="webp">WebP</option>
            </select>
          </label>
          <p id={`${id}-note`} className={styles.note}>
            {formatNotes[format]}
          </p>
          <p className={styles.note}>
            格式转换仅用于本次下载，画布中的原图会保留。
          </p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className={styles.footer}>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => void download()}
          >
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Download size={15} />
            )}
            {busy ? "正在准备下载…" : "下载"}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function ImageDownloadButton({
  assetId,
  filename,
  className,
  ariaLabel,
  label = "下载",
  onOpenChange,
}: {
  assetId: string;
  filename?: string;
  className?: string;
  ariaLabel?: string;
  label?: string;
  onOpenChange?: (leaseId: string, open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const leaseId = `image-download:${assetId}:${dialogId}`;
    onOpenChange?.(leaseId, true);
    return () => onOpenChange?.(leaseId, false);
  }, [assetId, dialogId, onOpenChange, open]);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="选择图片下载格式"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <Download size={13} />
        <span>{label}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <ImageDownloadDialog
          assetId={assetId}
          filename={filename}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

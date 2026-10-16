"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Layers3, LoaderCircle, Trash2, X } from "lucide-react";
import type { ProjectSummaryView } from "../lib/client-api";
import { projectCoverPalette } from "../lib/workspace-home-presentation";
import styles from "./neural-workspace.module.css";
export type ProjectDialog =
  | { kind: "create" }
  | { kind: "rename" | "delete"; project: ProjectSummaryView };
function DecorativeCover({ projectId }: { projectId: string }) {
  const palette = projectCoverPalette(projectId);
  return (
    <div
      className={styles.decorativeCover}
      data-project-cover="decoration"
      data-cover-palette={palette.name}
      style={
        {
          "--cover-from": palette.from,
          "--cover-to": palette.to,
          "--cover-glow": palette.glow,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <div className={styles.coverDotGrid} />
      <div className={styles.coverArc} />
      <span className={styles.coverSymbol}>
        <Layers3 size={32} strokeWidth={1.25} />
      </span>
    </div>
  );
}

export function ProjectCover({ project }: { project: ProjectSummaryView }) {
  const [failedId, setFailedId] = useState<string | null>(null);
  return project.previewAssetId && failedId !== project.previewAssetId ? (
    // The existing authenticated preview endpoint serves cached, resized images.
    <img
      className={styles.coverImage}
      data-project-cover="result"
      src={`/api/assets/${encodeURIComponent(project.previewAssetId)}/preview?size=640`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailedId(project.previewAssetId ?? null)}
    />
  ) : (
    <DecorativeCover projectId={project.id} />
  );
}

export function ProjectActionDialog({
  dialog,
  onClose,
  onSubmit,
}: {
  dialog: ProjectDialog;
  onClose: () => void;
  onSubmit: (title: string) => Promise<void>;
}) {
  const element = useRef<HTMLDialogElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(
    dialog.kind === "create" ? "" : dialog.project.title,
  );
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const deleting = dialog.kind === "delete";
  const heading = deleting
    ? "删除画布"
    : dialog.kind === "rename"
      ? "重命名画布"
      : "创建新画布";
  useEffect(() => {
    const modal = element.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    modal?.showModal();
    titleInput.current?.focus({ preventScroll: true });
    return () => {
      modal?.close();
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={element}
      className={styles.dialog}
      aria-labelledby="project-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.nativeEvent.isComposing || event.keyCode === 229)
          )
            event.preventDefault();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (submitting.current || (!deleting && !title.trim())) return;
          submitting.current = true;
          setBusy(true);
          setError(null);
          void onSubmit(title.trim()).catch((reason: unknown) => {
            setError(
              reason instanceof Error ? reason.message : "操作失败，请重试",
            );
            setBusy(false);
            submitting.current = false;
          });
        }}
      >
        <div className={styles.dialogHeading}>
          <span className={styles.dialogIcon}>
            {deleting ? <Trash2 size={22} /> : <Layers3 size={22} />}
          </span>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="关闭弹窗"
            title="关闭弹窗（Esc）"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="project-dialog-title">{heading}</h2>
        <p>
          {deleting
            ? `将删除「${dialog.project.title}」及其项目文件夹，此操作无法撤销。`
            : dialog.kind === "rename"
              ? "修改名称后，项目文件夹将同步更新。"
              : "输入画布名称，创建后即可添加节点。"}
        </p>
        {!deleting ? (
          <label className={styles.dialogLabel}>
            画布名称
            <input
              ref={titleInput}
              autoFocus
              value={title}
              maxLength={160}
              required
              placeholder="例如：秋日品牌视觉"
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        ) : null}
        {error ? (
          <p className={styles.dialogError} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.dialogFooter}>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className={deleting ? styles.dangerButton : styles.primaryButton}
            type="submit"
            disabled={busy || (!deleting && !title.trim())}
          >
            {busy ? (
              <LoaderCircle size={16} className={styles.spinning} />
            ) : null}
            {busy
              ? "正在处理…"
              : deleting
                ? "确认删除"
                : dialog.kind === "rename"
                  ? "保存名称"
                  : "创建并打开"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

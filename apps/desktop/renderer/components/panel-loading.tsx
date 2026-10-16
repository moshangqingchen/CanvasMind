"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useDialogFocus } from "./use-dialog-focus";
import styles from "./panel-loading.module.css";

type LoadingSurface = {
  open: boolean;
  title: string;
  dialogLabel?: string;
  onClose?: () => void;
  mode?: "dialog" | "panel";
};
const LoadingSurfaceContext = createContext<LoadingSurface | null>(null);
const ignoreClose = () => {};

/** Fetch a panel only on first use, then keep its drafts and local state alive. */
export function WarmPanelBoundary({ children, open, title, dialogLabel, onClose, mode }: LoadingSurface & { children: ReactNode }) {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  const value = useMemo(() => ({ open, title, dialogLabel, onClose, mode }), [open, title, dialogLabel, onClose, mode]);
  if (!open && !opened) return null;
  return <LoadingSurfaceContext.Provider value={value}>{children}</LoadingSurfaceContext.Provider>;
}

/** Static, small skeleton; no timers, image decode or decorative compositor layers. */
export function PanelBodySkeleton({ label = "正在打开面板" }: { label?: string }) {
  return <div className={styles.skeleton} role="status" aria-label={label} aria-busy="true" data-panel-loading="true">
    <span className={styles.longLine} aria-hidden="true" />
    <span className={styles.shortLine} aria-hidden="true" />
    <span className={styles.block} aria-hidden="true" />
    <span className={styles.longLine} aria-hidden="true" />
  </div>;
}

/** Keep close/Escape available while the on-demand JavaScript is downloading. */
export function DynamicPanelLoading() {
  const surface = useContext(LoadingSurfaceContext);
  const isDialog = Boolean(surface?.open && surface.mode !== "panel");
  const dialogRef = useDialogFocus(isDialog, surface?.onClose ?? ignoreClose);
  if (!surface?.open) return null;
  const content = <>
    <header className={styles.header}>
      <h2>{surface.title}</h2>
      {surface.onClose ? <button type="button" className={styles.close} aria-label={`关闭${surface.title}`} title={`关闭${surface.title}（Esc）`} onClick={surface.onClose}>
        <X size={18} aria-hidden="true" />
      </button> : null}
    </header>
    <PanelBodySkeleton label={`正在打开${surface.title}`} />
  </>;
  if (!isDialog) return <section className={styles.panel} aria-label={surface.dialogLabel ?? surface.title} data-panel-loading="true">{content}</section>;
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) surface.onClose?.();
  }}>
    <section className={styles.dialog} ref={dialogRef} role="dialog" aria-modal="true" aria-label={surface.dialogLabel ?? surface.title} tabIndex={-1} data-panel-loading="true">
      {content}
    </section>
  </div>;
}

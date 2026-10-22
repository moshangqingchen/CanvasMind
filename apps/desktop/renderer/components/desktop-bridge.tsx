"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { saveBeforeDesktopExit, type DesktopExitProgress } from "../lib/desktop-client";
import { exitProgressPresentation } from "../../src/exit-policy.mjs";
import { fetchAppUpdate, requestAppUpdate, type AppUpdateView } from "../lib/client-api";
import { AppUpdateModal } from "./app-update-modal";
import { CatalogCheckBridge } from "./catalog-check-bridge";
import feedbackStyles from "./blocking-feedback.module.css";

function DesktopErrorToast({ message, visible, onDismiss }: { message: string; visible: boolean; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 4000);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);
  if (!visible) return null;
  return <div role="alert" className={feedbackStyles.toast}>
    <div className={feedbackStyles.toastMessage} tabIndex={0} aria-label="完整错误信息">{message}</div>
    <button className={feedbackStyles.toastClose} type="button" aria-label="关闭错误提示" onClick={onDismiss}>
      <X size={14} aria-hidden="true" />
    </button>
  </div>;
}

export function DesktopBridge() {
  const [draining, setDraining] = useState(false);
  const [exitProgress, setExitProgress] = useState<DesktopExitProgress | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AppUpdateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toastError, setToastError] = useState<{ id: number; message: string } | null>(null);
  const toastSequence = useRef(0);
  const dismissToast = useCallback(() => setToastError(null), []);
  const noticedVersion = useRef("");
  useEffect(() => {
    const api = window.superCanvasDesktop;
    if (!api) return;
    const cleanups = [
      api.onPrepareExit((id) => { void saveBeforeDesktopExit().then(() => api.completePrepareExit(id), (failure: unknown) => api.completePrepareExit(id, failure instanceof Error ? failure.message : "画布未保存")); }),
      api.onDraining(value => { setDraining(value); setExitProgress(null); if (value) setError(""); }),
      api.onOpenUpdate(() => {
        if (location.pathname.startsWith("/canvas/")) return;
        setOpen(true); void fetchAppUpdate().then(setStatus).catch(() => {});
      }),
      api.onUpdate((next) => {
        setStatus(next);
        if (next.phase === "available" && next.latest?.version !== noticedVersion.current && !location.pathname.startsWith("/canvas/")) {
          noticedVersion.current = next.latest?.version ?? ""; setOpen(true);
        }
      }),
    ];
    if (api.onExitProgress) cleanups.push(api.onExitProgress(progress => {
      setExitProgress(progress);
      if (progress.error) {
        setError(progress.error);
        setToastError({ id: ++toastSequence.current, message: progress.error });
      }
    }));
    void fetchAppUpdate().then(next => {
      setStatus(next);
      if (next.phase === "available" && !location.pathname.startsWith("/canvas/")) {
        noticedVersion.current = next.latest?.version ?? ""; setOpen(true);
      }
    }).catch(() => {});
    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);
  const update = async (action: "check" | "download" | "apply" | "defer") => {
    setBusy(true); setError("");
    try { await requestAppUpdate(action); setStatus(await fetchAppUpdate()); if (action === "defer") setOpen(false); }
    catch (failure) {
      const message = failure instanceof Error ? failure.message : "更新失败";
      setError(message);
      setToastError({ id: ++toastSequence.current, message });
    }
    finally { setBusy(false); }
  };
  const exit = exitProgressPresentation(exitProgress);
  return <>
    <CatalogCheckBridge />
    <AppUpdateModal open={open} status={status} busy={busy} onClose={() => setOpen(false)}
      onCheck={() => void update("check")} onDownload={() => void update("download")}
      onApply={() => void update("apply")} onDefer={() => void update("defer")} />
    {toastError && <DesktopErrorToast key={toastError.id} message={toastError.message} visible={!draining} onDismiss={dismissToast} />}
    {draining ? <div role="dialog" aria-modal="true" aria-label={exit.label} className={feedbackStyles.overlay}>
      <div className={feedbackStyles.card}>
        <div className={feedbackStyles.progress} role="status">
          <span className={feedbackStyles.spinner} aria-hidden="true" />
          <h2 className={feedbackStyles.title}>{exit.title}</h2>
        </div>
        <p className={feedbackStyles.message}>{exit.message}</p>
        {exit.details.length > 0 && <p className={feedbackStyles.message} aria-live="polite">{exit.details.join("\n")}</p>}
        <button type="button" className="button primary" disabled={!exit.canCancel} onClick={() => void window.superCanvasDesktop?.cancelExit().catch((failure: Error) => setError(failure.message))}>返回软件</button>
        {error ? <p role="alert" className={feedbackStyles.error}>{error}</p> : null}
      </div>
    </div> : null}
  </>;
}

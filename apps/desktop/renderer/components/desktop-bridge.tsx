"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { saveBeforeDesktopExit } from "../lib/desktop-client";
import { fetchAppUpdate, requestAppUpdate, invalidateConnections, invalidateModelCache, type AppUpdateView } from "../lib/client-api";
import { AppUpdateModal } from "./app-update-modal";
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
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AppUpdateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toastError, setToastError] = useState<{ id: number; message: string } | null>(null);
  const toastSequence = useRef(0);
  const dismissToast = useCallback(() => setToastError(null), []);
  const noticedVersion = useRef("");
  useEffect(() => {
    if (!window.superCanvasDesktop) return;
    let cancelled = false;
    const publishedConnections = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (method: "GET" | "POST") => {
      try {
        const response = await fetch("/api/suppliers/catalog-upgrade", { method, cache: "no-store" });
        if (!response.ok || cancelled) return;
        const result = await response.json() as { phase?: string; updatedConnectionIds?: string[] };
        if (cancelled) return;
        const updated = (Array.isArray(result.updatedConnectionIds) ? result.updatedConnectionIds : [])
          .filter((id): id is string => typeof id === "string" && Boolean(id) && !publishedConnections.has(id));
        if (updated.length) {
          for (const id of updated) { invalidateModelCache(id); publishedConnections.add(id); }
          invalidateConnections();
          window.dispatchEvent(new CustomEvent("supplier-catalog-upgraded", { detail: { updatedConnectionIds: updated } }));
        }
        if (result.phase !== "complete") timer = setTimeout(() => { void read("GET"); }, 3000);
      } catch { /* Existing inventories remain usable; retry on the next launch. */ }
    };
    void read("POST");
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);
  useEffect(() => {
    const api = window.superCanvasDesktop;
    if (!api) return;
    const cleanups = [
      api.onPrepareExit((id) => { void saveBeforeDesktopExit().then(() => api.completePrepareExit(id), (failure: unknown) => api.completePrepareExit(id, failure instanceof Error ? failure.message : "画布未保存")); }),
      api.onDraining(setDraining),
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
  return <>
    <AppUpdateModal open={open} status={status} busy={busy} onClose={() => setOpen(false)}
      onCheck={() => void update("check")} onDownload={() => void update("download")}
      onApply={() => void update("apply")} onDefer={() => void update("defer")} />
    {toastError && <DesktopErrorToast key={toastError.id} message={toastError.message} visible={!draining} onDismiss={dismissToast} />}
    {draining ? <div role="dialog" aria-modal="true" aria-label="正在准备退出" className={feedbackStyles.overlay}>
      <div className={feedbackStyles.card}>
        <div className={feedbackStyles.progress} role="status">
          <span className={feedbackStyles.spinner} aria-hidden="true" />
          <h2 className={feedbackStyles.title}>正在保存并等待任务完成</h2>
        </div>
        <p className={feedbackStyles.message}>完成后会退出或安装已下载的更新。</p>
        <button type="button" className="button primary" onClick={() => void window.superCanvasDesktop?.cancelExit().catch((failure: Error) => setError(failure.message))}>返回软件</button>
        {error ? <p role="alert" className={feedbackStyles.error}>{error}</p> : null}
      </div>
    </div> : null}
  </>;
}

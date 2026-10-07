"use client";
import { useEffect, useRef, useState } from "react";
import { saveBeforeDesktopExit } from "../lib/desktop-client";
import { fetchAppUpdate, requestAppUpdate, invalidateModelCache, type AppUpdateView } from "../lib/client-api";
import { AppUpdateModal } from "./app-update-modal";
import feedbackStyles from "./blocking-feedback.module.css";

export function DesktopBridge() {
  const [draining, setDraining] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AppUpdateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const noticedVersion = useRef("");
  useEffect(() => {
    if (!window.superCanvasDesktop) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (method: "GET" | "POST") => {
      try {
        const response = await fetch("/api/suppliers/catalog-upgrade", { method, cache: "no-store" });
        if (!response.ok || cancelled) return;
        const result = await response.json() as { phase?: string; updatedConnectionIds?: string[] };
        if (cancelled) return;
        if (result.phase === "complete") {
          for (const id of result.updatedConnectionIds ?? []) invalidateModelCache(id);
          if (result.updatedConnectionIds?.length) window.dispatchEvent(new CustomEvent("supplier-catalog-upgraded"));
        } else timer = setTimeout(() => { void read("GET"); }, 3000);
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
    catch (failure) { setError(failure instanceof Error ? failure.message : "更新失败"); }
    finally { setBusy(false); }
  };
  return <>
    <AppUpdateModal open={open} status={status} busy={busy} onClose={() => setOpen(false)}
      onCheck={() => void update("check")} onDownload={() => void update("download")}
      onApply={() => void update("apply")} onDefer={() => void update("defer")} />
    {open && error && !draining ? <div role="alert" className={feedbackStyles.toast}>{error}</div> : null}
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

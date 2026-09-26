"use client";
import { useEffect, useRef, useState } from "react";
import { saveBeforeDesktopExit } from "../lib/desktop-client";
import { fetchAppUpdate, requestAppUpdate, type AppUpdateView } from "../lib/client-api";
import { AppUpdateModal } from "./app-update-modal";

export function DesktopBridge() {
  const [draining, setDraining] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AppUpdateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const noticedVersion = useRef("");
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
    {open && error ? <div role="alert" style={{ position: "fixed", bottom: 20, left: 20, zIndex: 10001, background: "white", padding: 16 }}>{error}</div> : null}
    {draining ? <div role="dialog" aria-modal="true" aria-label="正在准备退出" style={{ position: "fixed", inset: 0, zIndex: 10000, background: "#f6f6f4ed", display: "grid", placeItems: "center" }}>
      <div><h2>正在保存并等待任务完成</h2><p>完成后会退出或安装已下载的更新。</p>
        <button className="button primary" onClick={() => void window.superCanvasDesktop?.cancelExit().catch((failure: Error) => setError(failure.message))}>返回软件</button>
        {error ? <p role="alert">{error}</p> : null}</div>
    </div> : null}
  </>;
}

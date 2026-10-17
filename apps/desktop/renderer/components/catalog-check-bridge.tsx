"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { CATALOG_CHECK_ENDPOINT, CATALOG_POLICY_EVENT, catalogCheckNotice, nextCatalogCheckAction, readCatalogCheckStatus } from "../lib/client-catalog-check";
import { invalidateConnections, invalidateModelCache } from "../lib/client-api";
import type { CatalogUpgradeStatus } from "../lib/supplier-catalog-contracts";
import styles from "./catalog-check.module.css";

const ReviewSettings = dynamic(() => import("./settings-modal").then(module => module.SettingsModal), { ssr: false });
const NOTICE_STORAGE = "super-canvas:catalog-check-notice";

/** Own one low-priority timer, including when the app stays open past a day. */
export function CatalogCheckBridge() {
  const [notice, setNotice] = useState<{ id: string; message: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [surface, setSurface] = useState<"workspace" | "canvas">("workspace");
  const noticed = useRef("");
  useEffect(() => {
    if (!window.superCanvasDesktop) return;
    let cancelled = false, sequence = 0, lastRead = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const published = new Map<string, string>();
    try { noticed.current = localStorage.getItem(NOTICE_STORAGE) ?? ""; } catch { /* Session-only deduplication still works. */ }
    const read = async (method: "GET" | "POST") => {
      clearTimeout(timer);
      const request = ++sequence;
      controller?.abort();
      controller = new AbortController();
      try {
        const signal = controller.signal;
        const status = method === "GET" ? await readCatalogCheckStatus(signal, true) : await (async () => {
          const response = await fetch(CATALOG_CHECK_ENDPOINT, { method, cache: "no-store", signal });
          if (!response.ok) throw new Error("Catalog check could not start");
          return response.json() as Promise<CatalogUpgradeStatus>;
        })();
        if (cancelled || sequence !== request) return;
        lastRead = Date.now();
        const updated = status.updatedConnectionIds.filter(id => {
          const stamp = status.connections.find(connection => connection.connectionId === id)?.lastAttemptAt ?? status.noticeId ?? status.revision;
          if (published.get(id) === stamp) return false;
          published.set(id, stamp); return true;
        });
        if (updated.length) {
          updated.forEach(invalidateModelCache);
          invalidateConnections();
          window.dispatchEvent(new CustomEvent("supplier-catalog-upgraded", { detail: { updatedConnectionIds: updated } }));
        }
        const message = catalogCheckNotice(status);
        if (status.phase !== "running" && message && status.noticeId && noticed.current !== status.noticeId) {
          noticed.current = status.noticeId;
          try { localStorage.setItem(NOTICE_STORAGE, status.noticeId); } catch { /* No provider data is stored here. */ }
          setNotice({ id: status.noticeId, message });
        }
        const action = nextCatalogCheckAction(status, Date.now());
        if (action) timer = setTimeout(() => { void read(action.method); }, action.delay);
      } catch {
        // A local transport failure never directly restarts an upstream check.
        if (!cancelled && request === sequence) timer = setTimeout(() => { void read("GET"); }, 60_000);
      }
    };
    const policyChanged = () => { void read("GET"); };
    const visible = () => { if (!document.hidden && Date.now() - lastRead > 60_000) void read("GET"); };
    timer = setTimeout(() => { void read("GET"); }, 1000);
    window.addEventListener(CATALOG_POLICY_EVENT, policyChanged);
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true; sequence++; controller?.abort(); clearTimeout(timer);
      window.removeEventListener(CATALOG_POLICY_EVENT, policyChanged);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return <>
    {notice && <aside role="status" aria-label="供应商目录自动检查" className={styles.notice}>
      <span>{notice.message}</span>
      <button type="button" onClick={() => {
        setNotice(null);
        setSurface(location.pathname.startsWith("/canvas/") ? "canvas" : "workspace");
        setReviewOpen(true);
      }}>查看目录变化</button>
      <button type="button" className={styles.dismiss} aria-label="关闭目录提示" onClick={() => setNotice(null)}><X size={14} /></button>
    </aside>}
    {reviewOpen && <ReviewSettings open onClose={() => setReviewOpen(false)} initialTab="suppliers" surface={surface} catalogReview />}
  </>;
}

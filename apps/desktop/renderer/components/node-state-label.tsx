"use client";
import { memo, useEffect, useState } from "react";
import type { NodeVisualStatus } from "../lib/node-state-presentation";

export const NodeStateLabel = memo(function NodeStateLabel({ status, since, result = false }: {
  status: NodeVisualStatus; since?: string; result?: boolean;
}) {
  const [mountedAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => window.clearInterval(id);
  }, [status]);
  if (status === "idle") return null;
  const start = Date.parse(since ?? "");
  const elapsed = Math.max(0, Math.floor((now - (Number.isFinite(start) ? start : mountedAt)) / 1000));
  const label = status === "queued" ? "排队中" : status === "succeeded" ? "完成" : status === "failed" ? "失败"
    : `运行中 ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  return <span className={`node-status-label ${result ? "generated-result-status" : ""}`} role="status" aria-label={`状态：${label}`}>
    <span className={`node-status ${status}`} aria-hidden="true" />{label}
  </span>;
});

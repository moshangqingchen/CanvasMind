"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { getBezierPath, Position, useReactFlow, useStore, ViewportPortal } from "@xyflow/react";
import type { BatchConnectionSource } from "../lib/batch-connections";
import styles from "./canvas-batch-output.module.css";

export function CanvasBatchOutput({ sources, bounds, hidden, onStart, onEnd }: {
  sources: BatchConnectionSource[];
  bounds: { x: number; y: number; width: number; height: number };
  hidden: boolean;
  onStart: (source: BatchConnectionSource) => void;
  onEnd: (point: { x: number; y: number } | null, sources: BatchConnectionSource[]) => void;
}) {
  const flow = useReactFlow();
  const interacting = useStore(state => state.userSelectionActive || state.nodes.some(node => node.dragging));
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  if (hidden || interacting || sources.length < 2) return null;
  const start = { x: bounds.x + bounds.width + 26, y: bounds.y + bounds.height / 2 };
  const begin = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const batch = [...sources];
    setPointer(start);
    onStart(batch[0]!);
    const move = (event: globalThis.PointerEvent) => setPointer(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    const clean = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", keydown);
      cleanupRef.current = null;
    };
    const end = (point: { x: number; y: number } | null) => { clean(); setPointer(null); onEnd(point, batch); };
    const finish = (event: globalThis.PointerEvent) => {
      event.preventDefault(); event.stopPropagation();
      const suppressClick = (click: MouseEvent) => { click.preventDefault(); click.stopPropagation(); };
      window.addEventListener("click", suppressClick, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", suppressClick, true), 0);
      end({ x: event.clientX, y: event.clientY });
    };
    const cancel = () => end(null);
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); cancel(); } };
    cleanupRef.current = clean;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", keydown);
  };
  const kind = sources[0]!.kind.replace(/\[\]$/u, "");
  return <ViewportPortal>
    {pointer && <svg className={styles.preview} aria-hidden="true"><path d={getBezierPath({ sourceX: start.x, sourceY: start.y, targetX: pointer.x, targetY: pointer.y, sourcePosition: Position.Right, targetPosition: Position.Left })[0]} /></svg>}
    <button type="button" className={`${styles.output} nodrag nopan`} aria-label={`批量连接 ${sources.length} 个${kind === "image" ? "图片" : "素材"}`}
      title={`拖动连接 ${sources.length} 个素材`} onPointerDown={begin}
      style={{ left: start.x, top: start.y, "--batch-port-color": `var(--port-${kind}, var(--accent))` } as CSSProperties}>
      <span className={styles.badge}>×{sources.length}</span>
    </button>
  </ViewportPortal>;
}

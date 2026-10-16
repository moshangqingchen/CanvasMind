"use client";
import { startTransition, useEffect, useState, type ReactNode } from "react";
import { PanelBodySkeleton } from "./panel-loading";

/** Defer heavy bodies; preloaded parameter controls may join the first paint. */
export function DeferredPanelContent({ children, onReady, fallback, immediate = false }: { children?: ReactNode; onReady?: () => void; fallback?: ReactNode; immediate?: boolean }) {
  const [ready, setReady] = useState(immediate);
  useEffect(() => {
    if (immediate) return;
    let bodyTask = 0;
    const first = requestAnimationFrame(() => {
      // Yield a task after this rendering opportunity so the surface can paint,
      // without forcing the body to wait for another complete display interval.
      bodyTask = window.setTimeout(() => startTransition(() => setReady(true)), 0);
    });
    return () => { cancelAnimationFrame(first); window.clearTimeout(bodyTask); };
  }, [immediate]);
  const contentReady = ready || immediate;
  useEffect(() => { if (contentReady) onReady?.(); }, [contentReady, onReady]);
  return contentReady ? children : (fallback ?? <PanelBodySkeleton />);
}

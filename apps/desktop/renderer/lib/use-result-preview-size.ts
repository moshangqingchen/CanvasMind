"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useStore, type ReactFlowState } from "@xyflow/react";
import { canvasPreviewSize, type CanvasPreviewSize } from "./preview-resolution";

const pixelRatioListeners = new Set<() => void>();
let resolutionQuery: MediaQueryList | undefined;
const pixelRatio = () => window.devicePixelRatio || 1;
const serverPixelRatio = () => 1;
function refreshPixelRatio() {
  resolutionQuery?.removeEventListener("change", refreshPixelRatio);
  resolutionQuery = window.matchMedia(`(resolution: ${pixelRatio()}dppx)`);
  resolutionQuery.addEventListener("change", refreshPixelRatio);
  pixelRatioListeners.forEach((listener) => listener());
}
function subscribePixelRatio(listener: () => void) {
  pixelRatioListeners.add(listener);
  if (pixelRatioListeners.size === 1) {
    refreshPixelRatio();
    window.addEventListener("resize", refreshPixelRatio);
  }
  return () => {
    pixelRatioListeners.delete(listener);
    if (pixelRatioListeners.size === 0) {
      window.removeEventListener("resize", refreshPixelRatio);
      resolutionQuery?.removeEventListener("change", refreshPixelRatio);
      resolutionQuery = undefined;
    }
  };
}

export function useResultPreviewSize(id: string, enabled: boolean, mediaZoom = 1) {
  const ratio = useSyncExternalStore(subscribePixelRatio, pixelRatio, serverPixelRatio);
  const [size, setSize] = useState<CanvasPreviewSize>(160);
  // The store selector returns a tier, so ordinary pan/zoom frames do not render
  // the node. Selection never changes resolution; multi-select stays inexpensive.
  const selectSize = useCallback((state: ReactFlowState) => {
    if (!enabled) return 160;
    const node = state.nodeLookup.get(id);
    const longestSide = Math.max(node?.measured.width ?? node?.width ?? 320, node?.measured.height ?? node?.height ?? 240);
    return canvasPreviewSize(longestSide * state.transform[2] * ratio * mediaZoom, size);
  }, [enabled, id, mediaZoom, ratio, size]);
  const desired = useStore(selectSize);
  useEffect(() => {
    if (desired === size) return;
    // Wait for the zoom tier to settle instead of fetching every intermediate
    // resolution during a wheel gesture. Already displayed pixels remain visible.
    const timer = window.setTimeout(() => setSize(desired), 200);
    return () => window.clearTimeout(timer);
  }, [desired, size]);
  return size;
}

"use client";
import React, { memo, useMemo } from "react";
import type { CanvasEdge } from "./types";
import type { StudioEdgeState } from "../lib/canvas-edge-presentation";
import { EDGE_FEATHER_ID, EDGE_TERMINAL_ID, edgeLightEnabled } from "../lib/canvas-edge-palette";

/** Focused connections and active result transfers share two feather paints. */
export const CanvasEdgePalette = memo(function CanvasEdgePalette({ edges }: { edges: readonly CanvasEdge[] }) {
  const visible = useMemo(() => edges.some(edge => edgeLightEnabled(edge.selected,
    edge.data?.studio as StudioEdgeState | undefined)), [edges]);
  if (!visible) return null;
  return <svg width="0" height="0" className="canvas-edge-palette" aria-hidden="true" focusable="false" style={{ position: "absolute", pointerEvents: "none" }}>
    <defs>
      <radialGradient id={EDGE_FEATHER_ID} cx="50%" cy="50%" r="50%" fx="68%" fy="50%">
        <stop stopColor="var(--edge-light, #9cf5ff)" stopOpacity=".96" />
        <stop offset=".2" stopColor="var(--edge-light, #9cf5ff)" stopOpacity=".82" />
        <stop offset=".46" stopColor="var(--edge-light, #9cf5ff)" stopOpacity=".38" />
        <stop offset=".74" stopColor="var(--edge-light, #9cf5ff)" stopOpacity=".09" />
        <stop offset="1" stopColor="var(--edge-light, #9cf5ff)" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={EDGE_TERMINAL_ID}>
        <stop stopColor="var(--edge-terminal, #8aebff)" stopOpacity=".35" />
        <stop offset=".38" stopColor="var(--edge-terminal, #8aebff)" stopOpacity=".16" />
        <stop offset="1" stopColor="var(--edge-terminal, #8aebff)" stopOpacity="0" />
      </radialGradient>
    </defs>
  </svg>;
});

"use client";
import React, { memo, useMemo } from "react";
import type { CanvasEdge } from "./types";
import { collectEdgePalettePairs, edgePaletteId } from "../lib/canvas-edge-palette";
export { edgePaletteId, type EdgeColorKind } from "../lib/canvas-edge-palette";

/** Only used color pairs get shared definitions; stable edges skip geometry frames. */
export const CanvasEdgePalette = memo(function CanvasEdgePalette({ edges }: { edges: readonly CanvasEdge[] }) {
  const pairs = useMemo(() => collectEdgePalettePairs(edges), [edges]);
  if (!pairs.length) return null;
  return <svg width="0" height="0" className="canvas-edge-palette" aria-hidden="true" focusable="false" style={{ position: "absolute", pointerEvents: "none" }}>
    <defs>{pairs.flatMap(({ source, target }) => [false, true].map(reversed =>
      <linearGradient key={edgePaletteId(source, target, reversed)} id={edgePaletteId(source, target, reversed)} x1={reversed ? "100%" : "0%"} y1="0%" x2={reversed ? "0%" : "100%"} y2="0%">
        <stop offset="0%" stopColor={`var(--edge-port-${source})`} /><stop offset="100%" stopColor={`var(--edge-port-${target})`} />
      </linearGradient>))}</defs>
  </svg>;
});

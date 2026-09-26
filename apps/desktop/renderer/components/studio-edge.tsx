"use client";

import { memo, useId } from "react";
import { BaseEdge, getBezierPath, useStore, type EdgeProps } from "@xyflow/react";
import type { StudioEdgeState } from "../lib/canvas-edge-presentation";

/** Selection-only light, drawn with a continuous vector mask instead of stepped dashes. */
export const StudioEdge = memo(function StudioEdge({
  id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  selected, data, style, markerStart, markerEnd,
}: EdgeProps) {
  const gradientId = `edge-gradient-${useId().replace(/:/g, "")}`;
  const maskId = `${gradientId}-mask`;
  const featherId = `${gradientId}-feather`;
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: .3 });
  const state = data?.studio as StudioEdgeState | undefined;
  const focused = Boolean(selected || state?.related);
  const illuminated = focused && !state?.preview && !state?.failed;
  const zoom = useStore((state) => illuminated ? state.transform[2] : 1);
  const start = state?.failed ? "#ee8e9e" : "#1684dd";
  const end = state?.failed ? "#ee8e9e" : "#55dff3";
  // User-space bounds also cover horizontal, vertical and backwards Bézier curves.
  // The Bézier control hull bounds the whole curve, even when it points backwards.
  // A constant screen-space feather avoids giant square GPU surfaces for long edges.
  const coordinates = (path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number);
  const xs = coordinates.filter((_,i) => i % 2 === 0), ys = coordinates.filter((_,i) => i % 2 === 1);
  const margin = 10 / zoom;
  const bounds = {x: Math.min(...xs)-margin, y: Math.min(...ys)-margin,
    width: Math.max(...xs)-Math.min(...xs)+margin*2, height: Math.max(...ys)-Math.min(...ys)+margin*2};
  return (
    <g className={`studio-edge ${focused ? "is-focused" : ""} ${state?.failed ? "is-error" : ""} ${state?.dimmed && !selected ? "is-dimmed" : ""} ${state?.preview ? "is-preview" : ""}`}>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop stopColor={start} />
          <stop offset="1" stopColor={end} />
        </linearGradient>
        {illuminated && <>
          <radialGradient id={featherId} cx="50%" cy="50%" r="50%" fx="72%" fy="50%">
            <stop stopColor="white" stopOpacity="1" />
            <stop offset=".18" stopColor="white" stopOpacity=".88" />
            <stop offset=".42" stopColor="white" stopOpacity=".48" />
            <stop offset=".7" stopColor="white" stopOpacity=".12" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" {...bounds} style={{ maskType: "alpha" }}>
            <g className="studio-edge-light" style={{ offsetPath: `path("${path}")` }}>
              <ellipse cx={-35 / zoom} cy="0" rx={70 / zoom} ry={18 / zoom} fill={`url(#${featherId})`} />
            </g>
          </mask>

        </>}
      </defs>
      <BaseEdge id={id} path={path} interactionWidth={24} markerStart={markerStart} markerEnd={markerEnd}
        style={{ ...style, stroke: focused || state?.failed ? `url(#${gradientId})` : undefined }} />
      {illuminated && <g className="studio-edge-beam" mask={`url(#${maskId})`} aria-hidden="true">
        <path className="studio-edge-glow" d={path} fill="none" style={{ strokeWidth: 7, opacity: .12 }} />
        <path className="studio-edge-glow" d={path} fill="none" style={{ strokeWidth: 4, opacity: .22 }} />
        <path className="studio-edge-signal" d={path} fill="none" />
      </g>}
      {illuminated && <g className="studio-edge-terminals" aria-hidden="true">
        <circle className="studio-edge-terminal-halo" cx={sourceX} cy={sourceY} r={6 / zoom} />
        <circle className="studio-edge-terminal-halo" cx={targetX} cy={targetY} r={6 / zoom} />
        <circle className="studio-edge-terminal" cx={sourceX} cy={sourceY} r={2.4 / zoom} />
        <circle className="studio-edge-terminal" cx={targetX} cy={targetY} r={2.4 / zoom} />
      </g>}
    </g>
  );
});

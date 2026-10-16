"use client";

import { memo, useMemo, type CSSProperties } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { StudioEdgeState } from "../lib/canvas-edge-presentation";
import { edgeMotionBounds } from "../lib/edge-motion-bounds";
import { edgePaletteId } from "./canvas-edge-palette";

// A group drag translates both endpoints equally. Keep the curve and its SVG
// descendants in local coordinates so group movement reuses the same curve.
export const StudioEdge = memo(function StudioEdge(props: EdgeProps) {
  const targetX = Math.round((props.targetX - props.sourceX) * 1000) / 1000;
  const targetY = Math.round((props.targetY - props.sourceY) * 1000) / 1000;
  const geometry = useMemo(() => ({ sourceX: 0, sourceY: 0, targetX, targetY,
    sourcePosition: props.sourcePosition, targetPosition: props.targetPosition, curvature: .3 }),
    [targetX, targetY, props.sourcePosition, props.targetPosition]);
  const [path] = useMemo(() => getBezierPath(geometry), [geometry]);
  const bounds = useMemo(() => edgeMotionBounds(geometry), [geometry]);
  const state = props.data?.studio as StudioEdgeState | undefined;
  const focused = Boolean(props.selected || state?.related);
  const running = state?.running === true;
  const flowing = (focused || running) && !state?.preview && !state?.failed;
  const kind = state?.kind ?? "text";
  return <>
    <g transform={`translate(${props.sourceX} ${props.sourceY})`}>
      <StudioEdgeContent {...props} sourceX={0} sourceY={0} targetX={targetX} targetY={targetY} path={path} />
    </g>
    {flowing && <EdgeLabelRenderer>
      <div className={`studio-edge-motion is-flowing ${focused ? "is-focused" : ""} ${running ? "is-running" : ""}`}
        data-edge-id={props.id} aria-hidden="true" style={{
          width: bounds.width, height: bounds.height,
          transform: `translate(${props.sourceX + bounds.x}px, ${props.sourceY + bounds.y}px)`,
          "--edge-color": `var(--edge-port-${kind})`,
        } as CSSProperties}>
        <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}>
          <path d={path} className="studio-edge-dash" />
        </svg>
      </div>
    </EdgeLabelRenderer>}
  </>;
});

/** The main SVG stays static; only a bounded, separately painted overlay moves. */
const StudioEdgeContent = memo(function StudioEdgeContent({
  id, path, targetX, targetY,
  selected, data, style, markerStart, markerEnd,
}: EdgeProps & { path: string }) {
  const state = data?.studio as StudioEdgeState | undefined;
  const focused = Boolean(selected || state?.related);
  const running = state?.running === true;
  const flowing = (focused || running) && !state?.preview && !state?.failed;
  const kind = state?.kind ?? "text";
  const targetKind = state?.targetKind ?? kind;
  // SVG objectBoundingBox paint servers are undefined for a zero-height path.
  // Keep exact straight chains visible with their data color; never nudge ports.
  const paint = kind !== targetKind && Math.abs(targetY) > .01 && Math.abs(targetX) > .01
    ? `url(#${edgePaletteId(kind, targetKind, targetX < 0)})` : `var(--edge-port-${kind})`;
  return (
    <g className={`studio-edge ${focused ? "is-focused" : ""} ${selected ? "is-selected" : ""} ${running ? "is-running" : ""} ${flowing ? "is-flowing" : ""} ${state?.failed ? "is-error" : ""} ${state?.preview ? "is-preview" : ""}`}
      data-port-kind={kind} data-target-port-kind={targetKind} style={{ "--edge-color": `var(--edge-port-${kind})`, "--edge-paint": paint } as CSSProperties}>
      {focused && <path className="studio-edge-glow" d={path} aria-hidden="true" />}
      <BaseEdge id={id} path={path} interactionWidth={24} markerStart={markerStart} markerEnd={markerEnd}
        style={{ ...style, stroke: "var(--edge-paint)" }} />
    </g>
  );
});

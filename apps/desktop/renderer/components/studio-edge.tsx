"use client";

import React, { memo, useId, useMemo, type CSSProperties } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { StudioEdgeState } from "../lib/canvas-edge-presentation";
import { edgeMotionBounds } from "../lib/edge-motion-bounds";
import { EDGE_FEATHER_ID, EDGE_TERMINAL_ID, edgeLightEnabled } from "../lib/canvas-edge-palette";
import styles from "./studio-edge.module.css";

// A group drag translates both endpoints equally. Local coordinates let its
// memoized curve, gradient and small light layer reuse their existing geometry.
export const StudioEdge = memo(function StudioEdge(props: EdgeProps) {
  const targetX = Math.round((props.targetX - props.sourceX) * 1000) / 1000;
  const targetY = Math.round((props.targetY - props.sourceY) * 1000) / 1000;
  const geometry = useMemo(() => ({ sourceX: 0, sourceY: 0, targetX, targetY,
    sourcePosition: props.sourcePosition, targetPosition: props.targetPosition, curvature: .3 }),
    [targetX, targetY, props.sourcePosition, props.targetPosition]);
  const [path] = useMemo(() => getBezierPath(geometry), [geometry]);
  // The tail reaches 52px behind its center and shared zoom compensation is
  // capped at 2.5. This margin contains its complete feather, including turns.
  const bounds = useMemo(() => edgeMotionBounds(geometry, 132), [geometry]);
  const state = props.data?.studio as StudioEdgeState | undefined;
  const flowing = edgeLightEnabled(props.selected, state);
  return <>
    <g transform={`translate(${props.sourceX} ${props.sourceY})`}>
      <StudioEdgeContent {...props} sourceX={0} sourceY={0} targetX={targetX} targetY={targetY} path={path} />
    </g>
    {flowing && <EdgeLabelRenderer>
      <div className={`studio-edge-motion is-flowing is-focused ${styles.motion}`}
        data-edge-id={props.id} aria-hidden="true" style={{
          width: bounds.width, height: bounds.height,
          transform: `translate(${props.sourceX + bounds.x}px, ${props.sourceY + bounds.y}px)`,
        } as CSSProperties}>
        <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}>
          <g className={`studio-edge-beam ${styles.beam}`}>
            <g className={`studio-edge-light ${styles.light}`} style={{ offsetPath: `path("${path}")` }}>
              <g className={styles.effectScale}>
                <ellipse cx="-17" cy="0" rx="35" ry="7" fill={`url(#${EDGE_FEATHER_ID})`} opacity=".5" />
                <ellipse cx="-8" cy="0" rx="21" ry="2.1" fill={`url(#${EDGE_FEATHER_ID})`} />
              </g>
            </g>
          </g>
          <g className="studio-edge-terminals">
            {[[0, 0], [targetX, targetY]].map(([x, y], index) => <g key={index} transform={`translate(${x} ${y})`}>
              <g className={styles.effectScale}>
                <circle className="studio-edge-terminal-halo" r="6" fill={`url(#${EDGE_TERMINAL_ID})`} />
                <circle className="studio-edge-terminal" r="2.1" fill="var(--edge-terminal, #8aebff)" opacity=".85" />
              </g>
            </g>)}
          </g>
        </svg>
      </div>
    </EdgeLabelRenderer>}
  </>;
});

/** The main SVG stays static. The feather moves in its own bounded paint layer. */
const StudioEdgeContent = memo(function StudioEdgeContent({
  id, path, targetX, targetY,
  selected, data, style, markerStart, markerEnd,
}: EdgeProps & { path: string }) {
  const gradientId = `edge-focus-${useId().replace(/:/gu, "")}`;
  const state = data?.studio as StudioEdgeState | undefined;
  const focused = Boolean(selected || state?.related);
  const flowing = edgeLightEnabled(selected, state);
  const kind = state?.kind ?? "text";
  const targetKind = state?.targetKind ?? kind;
  // User-space coordinates remain defined for horizontal and vertical paths,
  // and preserve source-to-target color order when the connection bends back.
  const paint = focused && !state?.failed ? `url(#${gradientId})` : "var(--edge-idle, #62656d)";
  return (
    <g className={`studio-edge ${focused ? "is-focused" : ""} ${selected ? "is-selected" : ""} ${state?.running ? "is-running" : ""} ${flowing ? "is-flowing" : ""} ${state?.failed ? "is-error" : ""} ${state?.preview ? "is-preview" : ""}`}
      data-port-kind={kind} data-target-port-kind={targetKind} style={{ "--edge-paint": paint } as CSSProperties}>
      {focused && !state?.failed && <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={targetX} y2={targetY}>
          <stop stopColor="var(--edge-focus-start, #1684dd)" />
          <stop offset="1" stopColor="var(--edge-focus-end, #55dff3)" />
        </linearGradient>
      </defs>}
      <BaseEdge id={id} path={path} interactionWidth={24} markerStart={markerStart} markerEnd={markerEnd}
        style={{ ...style, stroke: "var(--edge-paint)" }} />
    </g>
  );
});

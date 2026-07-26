"use client";

import { ViewportPortal } from "@xyflow/react";
import { drawingStrokeBounds, normalizeDrawingRect } from "../lib/drawing";
import type { CanvasDrawingPoint, CanvasDrawingStroke } from "./types";

function localPath(
  points: readonly CanvasDrawingPoint[],
  offsetX: number,
  offsetY: number,
): string {
  if (points.length === 0) return "";
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x - offsetX} ${point.y - offsetY}`,
    )
    .join(" ");
}

function DrawingStrokeView({
  stroke,
  selected = false,
  active = false,
}: {
  stroke: CanvasDrawingStroke;
  selected?: boolean;
  active?: boolean;
}) {
  const bounds = drawingStrokeBounds(stroke, selected ? 7 : 3);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const point = stroke.points[0];
  return (
    <svg
      className={`canvas-drawing-stroke ${selected ? "selected" : ""} ${active ? "active" : ""}`}
      style={{
        left: bounds.minX,
        top: bounds.minY,
        width,
        height,
      }}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {selected && point ? (
        stroke.points.length === 1 ? (
          <circle
            className="canvas-drawing-selection-outline"
            cx={point.x - bounds.minX}
            cy={point.y - bounds.minY}
            r={stroke.width / 2 + 4}
          />
        ) : (
          <path
            className="canvas-drawing-selection-outline"
            d={localPath(stroke.points, bounds.minX, bounds.minY)}
            strokeWidth={stroke.width + 7}
          />
        )
      ) : null}
      {point ? (
        stroke.points.length === 1 ? (
          <circle
            cx={point.x - bounds.minX}
            cy={point.y - bounds.minY}
            r={stroke.width / 2}
            fill={stroke.color}
          />
        ) : (
          <path
            d={localPath(stroke.points, bounds.minX, bounds.minY)}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
          />
        )
      ) : null}
    </svg>
  );
}

export function DrawingLayer({
  drawings,
  activeStroke,
  selectedIds,
  selectionStart,
  selectionEnd,
}: {
  drawings: readonly CanvasDrawingStroke[];
  activeStroke: CanvasDrawingStroke | null;
  selectedIds: ReadonlySet<string>;
  selectionStart: CanvasDrawingPoint | null;
  selectionEnd: CanvasDrawingPoint | null;
}) {
  const selectionRect =
    selectionStart && selectionEnd
      ? normalizeDrawingRect(selectionStart, selectionEnd)
      : null;
  return (
    <ViewportPortal>
      <div className="canvas-drawing-viewport" aria-hidden="true">
        {drawings.map((stroke) => (
          <DrawingStrokeView
            key={stroke.id}
            stroke={stroke}
            selected={selectedIds.has(stroke.id)}
          />
        ))}
        {activeStroke ? (
          <DrawingStrokeView stroke={activeStroke} active />
        ) : null}
        {selectionRect ? (
          <div
            className="canvas-drawing-selection-box"
            style={{
              left: selectionRect.minX,
              top: selectionRect.minY,
              width: Math.max(1, selectionRect.maxX - selectionRect.minX),
              height: Math.max(1, selectionRect.maxY - selectionRect.minY),
            }}
          />
        ) : null}
      </div>
    </ViewportPortal>
  );
}

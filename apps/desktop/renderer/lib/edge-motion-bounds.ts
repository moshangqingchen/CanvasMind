import { Position } from "@xyflow/react";

export interface EdgeMotionGeometry {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  curvature?: number;
}

function controlOffset(distance: number, curvature: number): number {
  return distance >= 0 ? distance * .5 : curvature * 25 * Math.sqrt(-distance);
}

// Match @xyflow/system's getControlWithCurvature, used by getBezierPath.
function controlPoint(position: Position, x: number, y: number, otherX: number, otherY: number, curvature: number): [number, number] {
  switch (position) {
    case Position.Left: return [x - controlOffset(x - otherX, curvature), y];
    case Position.Right: return [x + controlOffset(otherX - x, curvature), y];
    case Position.Top: return [x, y - controlOffset(y - otherY, curvature)];
    case Position.Bottom: return [x, y + controlOffset(otherY - y, curvature)];
  }
}

/** A cubic lies inside its control-point hull; keep stroke/dash paint local. */
export function edgeMotionBounds({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature = .3 }: EdgeMotionGeometry): {
  x: number; y: number; width: number; height: number;
} {
  const [sourceControlX, sourceControlY] = controlPoint(sourcePosition, sourceX, sourceY, targetX, targetY, curvature);
  const [targetControlX, targetControlY] = controlPoint(targetPosition, targetX, targetY, sourceX, sourceY, curvature);
  const left = Math.min(sourceX, sourceControlX, targetControlX, targetX);
  const top = Math.min(sourceY, sourceControlY, targetControlY, targetY);
  const right = Math.max(sourceX, sourceControlX, targetControlX, targetX);
  const bottom = Math.max(sourceY, sourceControlY, targetControlY, targetY);
  // At min zoom .02, a 2.5px non-scaling stroke has a 62.5 world-pixel
  // half-width. A fixed margin covers it without a per-edge zoom subscription.
  return { x: left - 64, y: top - 64, width: right - left + 128, height: bottom - top + 128 };
}

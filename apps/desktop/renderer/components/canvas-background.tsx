"use client";

import { memo, useLayoutEffect, useRef } from "react";
import { useStoreApi } from "@xyflow/react";

type GridViewport = { getTransform: () => readonly number[]; subscribe: (listener: () => void) => () => void };
type GridDiagnosticWindow = Window & {
  /** Installed by the A/B test only; the legacy SVG renderer lives in test code. */
  __canvasPerfLegacyGridRenderer?: (surface: HTMLDivElement, viewport: GridViewport) => () => void;
};

/** Pan updates one compositor transform; only zoom changes the dot raster. */
export const CanvasDotGrid = memo(function CanvasDotGrid() {
  const flow = useStoreApi();
  const surfaceRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const legacyRenderer = (window as GridDiagnosticWindow).__canvasPerfLegacyGridRenderer;
    if (legacyRenderer) return legacyRenderer(surface, { getTransform: () => flow.getState().transform, subscribe: flow.subscribe });
    let previousX = NaN, previousY = NaN, previousZoom = NaN, gap = 20;
    const update = () => {
      const [x, y, zoom] = flow.getState().transform;
      if (x === previousX && y === previousY && zoom === previousZoom) return;
      if (zoom !== previousZoom) {
        gap = 20 * zoom;
        surface.style.backgroundSize = `${gap}px ${gap}px`;
        surface.style.setProperty("--canvas-dot-radius", `${.4 * zoom}px`);
        surface.style.setProperty("--canvas-dot-center", `${gap / 2 - 1 + .4 * zoom}px`);
        surface.style.width = `calc(100% + ${2 * gap}px)`;
        surface.style.height = `calc(100% + ${2 * gap}px)`;
        surface.style.opacity = String(Math.max(0, Math.min(1, (zoom - .15) / .55)));
      }
      // Negative remainders need two extra cells to keep both edges covered.
      surface.style.transform = `translate3d(${x % gap - gap}px, ${y % gap - gap}px, 0)`;
      previousX = x; previousY = y; previousZoom = zoom;
    };
    update();
    return flow.subscribe(update);
  }, [flow]);

  return <div ref={surfaceRef} className="react-flow__background canvas-dot-grid" data-testid="rf__background" aria-hidden="true"
    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: 0, willChange: "transform" }} />;
});

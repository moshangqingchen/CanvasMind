import { describe, expect, it } from "vitest";

import {
  drawingBounds,
  drawingShapePoints,
  drawingStrokeIntersectsRect,
  hitTestDrawingStrokes,
  normalizeDrawingRect,
  translateDrawingStrokes,
  zoomViewportAtPoint,
} from "./drawing";
import type { CanvasDrawingStroke } from "../components/types";

const stroke: CanvasDrawingStroke = {
  id: "stroke",
  color: "#ffffff",
  width: 10,
  points: [
    { x: 10, y: 10 },
    { x: 110, y: 10 },
  ],
};

describe("canvas drawing helpers", () => {
  it("normalizes selection rectangles in every drag direction", () => {
    expect(normalizeDrawingRect({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
      minX: 10,
      minY: 20,
      maxX: 50,
      maxY: 80,
    });
  });

  it("hit tests brush strokes using their visible width", () => {
    expect(hitTestDrawingStrokes([stroke], { x: 60, y: 14 }, 0)?.id).toBe(
      "stroke",
    );
    expect(hitTestDrawingStrokes([stroke], { x: 60, y: 30 }, 2)).toBeNull();
  });

  it("computes merge bounds and rectangle selection intersections", () => {
    expect(drawingBounds([stroke])).toEqual({
      minX: 5,
      minY: 5,
      maxX: 115,
      maxY: 15,
    });
    expect(
      drawingStrokeIntersectsRect(stroke, {
        minX: 40,
        minY: 0,
        maxX: 70,
        maxY: 20,
      }),
    ).toBe(true);
    expect(
      drawingStrokeIntersectsRect(stroke, {
        minX: 200,
        minY: 200,
        maxX: 240,
        maxY: 240,
      }),
    ).toBe(false);
  });

  it("moves every selected stroke as one group", () => {
    const untouched = { ...stroke, id: "untouched" };
    const moved = translateDrawingStrokes(
      [stroke, untouched],
      new Set([stroke.id]),
      25,
      -5,
    );
    expect(moved[0]!.points).toEqual([
      { x: 35, y: 5 },
      { x: 135, y: 5 },
    ]);
    expect(moved[1]).toBe(untouched);
  });

  it("creates closed rectangle and ellipse paths", () => {
    const rectangle = drawingShapePoints(
      "rectangle",
      { x: 10, y: 20 },
      { x: 90, y: 70 },
    );
    expect(rectangle).toEqual([
      { x: 10, y: 20 },
      { x: 90, y: 20 },
      { x: 90, y: 70 },
      { x: 10, y: 70 },
      { x: 10, y: 20 },
    ]);
    const ellipse = drawingShapePoints(
      "ellipse",
      { x: 0, y: 0 },
      { x: 100, y: 60 },
    );
    expect(ellipse).toHaveLength(49);
    expect(ellipse[0]).toEqual(ellipse.at(-1));
  });

  it("creates selectable line and arrow paths", () => {
    expect(
      drawingShapePoints("line", { x: 0, y: 0 }, { x: 100, y: 0 }),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    const arrow = drawingShapePoints("arrow", { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(arrow).toHaveLength(5);
    expect(arrow[0]).toEqual({ x: 0, y: 0 });
    expect(arrow[1]).toEqual({ x: 100, y: 0 });
    expect(arrow[3]).toEqual({ x: 100, y: 0 });
  });

  it("zooms around the cursor without moving the pointed canvas position", () => {
    const point = { x: 320, y: 180 };
    const current = { x: 80, y: 30, zoom: 1 };
    const next = zoomViewportAtPoint(current, point, 1.5);
    expect(next).toEqual({ x: -40, y: -45, zoom: 1.5 });
    expect((point.x - next.x) / next.zoom).toBe(
      (point.x - current.x) / current.zoom,
    );
    expect((point.y - next.y) / next.zoom).toBe(
      (point.y - current.y) / current.zoom,
    );
    expect(zoomViewportAtPoint(current, point, 99).zoom).toBe(8);
    expect(zoomViewportAtPoint(current, point, 0.001).zoom).toBe(0.02);
  });
});

import { describe, expect, it } from "vitest";

import {
  drawingBounds,
  drawingStrokeIntersectsRect,
  hitTestDrawingStrokes,
  normalizeDrawingRect,
  translateDrawingStrokes,
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
});

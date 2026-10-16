import { describe, expect, it } from "vitest";
import { getBezierPath, Position } from "@xyflow/react";
import { edgeMotionBounds, type EdgeMotionGeometry } from "./edge-motion-bounds";

const geometry = (sourceX: number, sourceY: number, targetX: number, targetY: number, sourcePosition = Position.Right, targetPosition = Position.Left, curvature?: number): EdgeMotionGeometry =>
  ({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, ...(curvature === undefined ? {} : { curvature }) });

// Test the installed renderer's actual single-cubic path, rather than reusing
// the bounds helper's control-point formula to construct expected coordinates.
function actualCubic(input: EdgeMotionGeometry) {
  const [path] = getBezierPath({ ...input, curvature: input.curvature ?? .3 });
  const coordinates = path.slice(1).replace(" C", ",").replaceAll(" ", ",").split(",").map(Number);
  expect(coordinates).toHaveLength(8);
  expect(coordinates.every(Number.isFinite)).toBe(true);
  return Array.from({ length: 4 }, (_, index) => ({ x: coordinates[index * 2]!, y: coordinates[index * 2 + 1]! }));
}

describe("bounded edge motion paint", () => {
  it.each([
    ["forward LR", geometry(0, 0, 600, 180)],
    ["reversed LR", geometry(600, 180, 0, 0)],
    ["overlapping columns", geometry(100, -80, 105, 420)],
    ["vertical down", geometry(10, 20, 10, 800, Position.Bottom, Position.Top)],
    ["vertical reversed", geometry(-40, 700, 160, -100, Position.Bottom, Position.Top)],
    ["zero length", geometry(24, -36, 24, -36)],
    ["negative coordinates", geometry(-1500, -2200, -3000, -2800)],
    ["large coordinates", geometry(-1_000_000, 2_000_000, 3_000_000, -4_000_000)],
    ["left pointing handles", geometry(100, 80, 400, 320, Position.Left, Position.Left)],
    ["mixed directions", geometry(-100, 300, 450, -80, Position.Top, Position.Right)],
    ["high reverse curvature", geometry(500, 80, -300, 20, Position.Right, Position.Left, 1.4)],
    ["straight curvature", geometry(500, 80, -300, 20, Position.Right, Position.Left, 0)],
  ] as const)("covers actual control points and curve samples with a 64px stroke margin: %s", (_, input) => {
    const bounds = edgeMotionBounds(input), points = actualCubic(input);
    const right = bounds.x + bounds.width, bottom = bounds.y + bounds.height;
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(bounds.x + 64 - 1e-8);
      expect(point.x).toBeLessThanOrEqual(right - 64 + 1e-8);
      expect(point.y).toBeGreaterThanOrEqual(bounds.y + 64 - 1e-8);
      expect(point.y).toBeLessThanOrEqual(bottom - 64 + 1e-8);
    }
    for (let step = 0; step <= 200; step++) {
      const t = step / 200, u = 1 - t, weights = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
      const x = points.reduce((sum, point, index) => sum + point.x * weights[index]!, 0);
      const y = points.reduce((sum, point, index) => sum + point.y * weights[index]!, 0);
      // Floating arithmetic on million-pixel fixtures can differ by subpixels.
      expect(x).toBeGreaterThanOrEqual(bounds.x + 64 - 1e-8);
      expect(x).toBeLessThanOrEqual(right - 64 + 1e-8);
      expect(y).toBeGreaterThanOrEqual(bounds.y + 64 - 1e-8);
      expect(y).toBeLessThanOrEqual(bottom - 64 + 1e-8);
    }
    expect(bounds.x).toBeCloseTo(Math.min(...points.map(point => point.x)) - 64, 8);
    expect(bounds.y).toBeCloseTo(Math.min(...points.map(point => point.y)) - 64, 8);
    expect(bounds.width).toBeCloseTo(Math.max(...points.map(point => point.x)) - bounds.x + 64, 8);
    expect(bounds.height).toBeCloseTo(Math.max(...points.map(point => point.y)) - bounds.y + 64, 8);
  });

  it("keeps a zero-length edge finite and translates bounds without inflating their size", () => {
    expect(edgeMotionBounds(geometry(24, -36, 24, -36))).toEqual({ x: -40, y: -100, width: 128, height: 128 });
    const input = geometry(540, -90, -120, 310), original = structuredClone(input);
    const bounds = edgeMotionBounds(input), moved = edgeMotionBounds({ ...input, sourceX: input.sourceX + 1200, sourceY: input.sourceY - 700, targetX: input.targetX + 1200, targetY: input.targetY - 700 });
    expect(moved).toEqual({ ...bounds, x: bounds.x + 1200, y: bounds.y - 700 });
    expect(input).toEqual(original);
  });

  it("retains half the focused non-scaling stroke even at the minimum canvas zoom", () => {
    const input = geometry(0, 0, 0, 0), bounds = edgeMotionBounds(input);
    const worldMargin = Math.min(-bounds.x, -bounds.y, bounds.x + bounds.width, bounds.y + bounds.height);
    expect(worldMargin).toBe(64);
    expect(worldMargin * .02).toBeGreaterThanOrEqual(2.5 / 2);
  });

  it("keeps each of a thousand edges local to its chord and reverse-control extension", () => {
    const directions = [Position.Left, Position.Right, Position.Top, Position.Bottom];
    for (let index = 0; index < 1000; index++) {
      const input = geometry(index * 91 - 40_000, index * 13 - 6000, index * 83 - 38_000, index * 29 - 8000, directions[index % 4]!, directions[Math.floor(index / 4) % 4]!);
      const bounds = edgeMotionBounds(input), dx = Math.abs(input.targetX - input.sourceX), dy = Math.abs(input.targetY - input.sourceY);
      expect(Object.values(bounds).every(Number.isFinite)).toBe(true);
      expect(bounds.width).toBeLessThanOrEqual(dx + 15 * Math.sqrt(dx) + 128 + 1e-8);
      expect(bounds.height).toBeLessThanOrEqual(dy + 15 * Math.sqrt(dy) + 128 + 1e-8);
    }
  });
});

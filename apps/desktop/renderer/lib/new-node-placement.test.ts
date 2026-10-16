import { describe, expect, it } from "vitest";
import type { PositionedCanvasRect } from "./graph-ui";
import { newNodePlacement, type NewNodeViewport } from "./new-node-placement";

const size = { width: 360, height: 210 };
const view = { x: 0, y: 0, width: 1600, height: 900 };
const rect = (id: string, x: number, y: number, width = 360, height = 210): PositionedCanvasRect => ({ id, position: { x, y }, width, height });

function clear(position: { x: number; y: number }, occupied: readonly PositionedCanvasRect[]) {
  for (const node of occupied) expect(
    position.x + size.width + 24 <= node.position.x || position.x >= node.position.x + node.width + 24 ||
    position.y + size.height + 24 <= node.position.y || position.y >= node.position.y + node.height + 24,
  ).toBe(true);
}

describe("new node placement", () => {
  it("centers within the current projected viewport after large pan and zoom", () => {
    const moved = { x: -5500, y: 3300, width: 1300, height: 700 };
    const result = newNodePlacement(size, moved, []);
    expect(Math.abs(result.position.x + size.width / 2 - (moved.x + moved.width / 2))).toBeLessThanOrEqual(4);
    expect(Math.abs(result.position.y + size.height / 2 - (moved.y + moved.height / 2))).toBeLessThanOrEqual(4);
    expect(Math.abs(result.position.x % 8)).toBe(0);
    expect(Math.abs(result.position.y % 8)).toBe(0);
    expect(result.requiresReveal).toBe(false);
  });

  it("uses the measured selected card's right edge when that position is visible", () => {
    const selected = rect("selected", 120, 176, 503, 380);
    const result = newNodePlacement(size, view, [selected], selected.id);
    expect(result.position).toEqual({ x: 648, y: 176 });
    clear(result.position, [selected]);
    expect(result.requiresReveal).toBe(false);
  });

  it("ignores a distant selected node and keeps a new card in the current view", () => {
    const distant = rect("selected", 20_000, -20_000);
    expect(newNodePlacement(size, view, [distant], distant.id)).toEqual(newNodePlacement(size, view, []));
  });

  it("avoids large measured cards and prefers an available visible gap", () => {
    const occupied = [rect("center", 400, 190, 760, 430), rect("right", 1200, 150, 380, 430)];
    const result = newNodePlacement(size, view, occupied, "center");
    clear(result.position, occupied);
    expect(result.requiresReveal).toBe(false);
  });

  it("keeps repeated additions apart and is independent of obstacle iteration order", () => {
    const occupied = [rect("anchor", 120, 176)];
    for (let index = 0; index < 6; index++) {
      const selectedId = occupied.at(-1)!.id;
      const result = newNodePlacement(size, view, occupied, selectedId);
      expect(result).toEqual(newNodePlacement(size, view, [...occupied].reverse(), selectedId));
      clear(result.position, occupied);
      expect(Math.abs(result.position.x % 8)).toBe(0);
      expect(Math.abs(result.position.y % 8)).toBe(0);
      occupied.push(rect(`added-${index}`, result.position.x, result.position.y));
    }
  });

  it("requests reveal only when a full viewport has no available visible gap", () => {
    const occupied = [rect("cover", -20, -20, 1640, 940)];
    const result = newNodePlacement(size, view, occupied);
    clear(result.position, occupied);
    expect(result.requiresReveal).toBe(true);
  });

  it("keeps grid snapping from crossing a fractional measured obstacle edge", () => {
    const fractional = rect("anchor", -200.75, 104.2, 401.25, 230.75);
    const viewport: NewNodeViewport = { x: -400.2, y: 0.3, width: 1600.4, height: 900.1 };
    const result = newNodePlacement(size, viewport, [fractional], fractional.id);
    clear(result.position, [fractional]);
    expect(result.position.x).toBe(232);
    expect(result.requiresReveal).toBe(false);
  });
});

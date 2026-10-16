import { describe, expect, it } from "vitest";
import { shouldCullCanvasNodes } from "./canvas-render-policy";

describe("canvas visibility policy", () => {
  it("keeps canvases through 500 nodes mounted and culls graphs above that boundary", () => {
    for (const count of [0, 1, 120, 200, 201, 300, 499, 500]) expect(shouldCullCanvasNodes(count, 0)).toBe(false);
    for (const count of [501, 502, 1000]) expect(shouldCullCanvasNodes(count, 0)).toBe(true);
  });
  it("preserves open parameter and download owners on large graphs", () => {
    expect(shouldCullCanvasNodes(1000, 1)).toBe(false);
    expect(shouldCullCanvasNodes(1000, 2)).toBe(false);
    expect(shouldCullCanvasNodes(501, 1)).toBe(false);
  });
  it("can reproduce the previous culling policy without changing builds", () => {
    expect(shouldCullCanvasNodes(120, 0, true)).toBe(true);
    expect(shouldCullCanvasNodes(120, 1, true)).toBe(false);
    expect(shouldCullCanvasNodes(500, 0, true)).toBe(true);
    expect(shouldCullCanvasNodes(500, 1, true)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { nodeConfigPosition } from "./node-config-position";

describe("nodeConfigPosition", () => {
  const viewport = { left: 0, top: 76, right: 900, bottom: 700 };

  it("keeps a normal inspector below the node", () => {
    expect(nodeConfigPosition({ left: 120, top: 140, right: 520, bottom: 300 }, viewport)).toEqual({
      left: 120,
      top: 310,
      width: 420,
      height: 390,
    });
  });

  it("opens above a node near the bottom edge", () => {
    const result = nodeConfigPosition({ left: 120, top: 570, right: 520, bottom: 660 }, viewport);
    expect(result).toEqual({ left: 120, top: 76, width: 420, height: 484 });
    expect(result.top).toBeGreaterThanOrEqual(viewport.top);
    expect(result.top + result.height).toBeLessThanOrEqual(viewport.bottom);
  });

  it("does not stretch the inspector with a wide node", () => {
    expect(nodeConfigPosition({ left: -80, top: 120, right: 1100, bottom: 240 }, viewport)).toMatchObject({
      left: 0,
      width: 420,
    });
  });

  it.each([0.25, 0.5, 1, 2])("keeps readable screen-space sizing at %sx canvas zoom", (zoom) => {
    const result = nodeConfigPosition({ left: 100, top: 100, right: 100 + 420 * zoom, bottom: 100 + 180 * zoom }, viewport);
    expect(result.width).toBe(420);
    expect(result.left).toBeGreaterThanOrEqual(viewport.left);
    expect(result.left + result.width).toBeLessThanOrEqual(viewport.right);
    expect(result.top).toBeGreaterThanOrEqual(viewport.top);
    expect(result.top + result.height).toBeLessThanOrEqual(viewport.bottom);
  });

  it("only shrinks to the available width on a narrow viewport", () => {
    const narrow = { left: 12, top: 76, right: 378, bottom: 640 };
    const result = nodeConfigPosition({ left: 300, top: 120, right: 405, bottom: 165 }, narrow);
    expect(result).toMatchObject({ left: 12, width: 366 });
    expect(result.top + result.height).toBeLessThanOrEqual(narrow.bottom);
  });

  it("keeps an offscreen anchor inside a short viewport", () => {
    const short = { left: 12, top: 76, right: 968, bottom: 230 };
    const result = nodeConfigPosition({ left: 1400, top: 900, right: 1505, bottom: 945 }, short);
    expect(result).toEqual({ left: 548, top: 76, width: 420, height: 154 });
  });
});

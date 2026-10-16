import { describe, expect, it } from "vitest";
import { placeCanvasBatch, repairCanvasBatch } from "./canvas-placement";
import type { PositionedCanvasRect } from "./graph-ui";

const rect = (id: string, x: number, y: number, width = 300, height = 230): PositionedCanvasRect => ({ id, position: { x, y }, width, height });
const items = Array.from({ length: 10 }, (_, index) => ({ id: String(index), width: index === 2 ? 340 : 300, height: index === 0 ? 600 : 230 }));
function clear(nodes: PositionedCanvasRect[]) {
  nodes.forEach((a, index) => nodes.slice(index + 1).forEach(b => expect(
    a.position.x + a.width + 24 <= b.position.x || b.position.x + b.width + 24 <= a.position.x ||
    a.position.y + a.height + 24 <= b.position.y || b.position.y + b.height + 24 <= a.position.y,
  ).toBe(true)));
}

describe("canvas batch placement", () => {
  it("fills four columns before the next row and respects each row's tallest card", () => {
    const result = placeCanvasBatch(items, { x: 100, y: 200 }, []);
    expect(result.get("0")).toEqual({ x: 100, y: 200 });
    expect(result.get("3")).toEqual({ x: 1192, y: 200 });
    expect(result.get("4")).toEqual({ x: 100, y: 824 });
    clear(items.map(item => ({ ...item, position: result.get(item.id)! })));
  });

  it("moves the whole block to the closest free boundary without changing internal offsets", () => {
    const anchor = { x: 0, y: 0 }, occupied = [rect("obstacle", -20, -20, 600, 400)];
    const direct = placeCanvasBatch(items, anchor, []), shifted = placeCanvasBatch(items, anchor, occupied);
    const delta = { x: shifted.get("0")!.x, y: shifted.get("0")!.y };
    for (const item of items) expect(shifted.get(item.id)).toEqual({ x: direct.get(item.id)!.x + delta.x, y: direct.get(item.id)!.y + delta.y });
    clear([...occupied, ...items.map(item => ({ ...item, position: shifted.get(item.id)! }))]);
    expect(shifted).toEqual(placeCanvasBatch(items, anchor, [...occupied].reverse()));
  });

  it("uses the supplied import order and handles an empty batch", () => {
    expect(placeCanvasBatch([], { x: 0, y: 0 }, [])).toEqual(new Map());
    const result = placeCanvasBatch([...items].reverse(), { x: 0, y: 0 }, []);
    expect(result.get("9")).toEqual({ x: 0, y: 0 });
  });

  it("chooses the nearest clear side and skips a side blocked by another card", () => {
    const item = [{ id: "new", width: 300, height: 230 }], anchor = { x: 0, y: 0 };
    const cover = rect("cover", -50, -100, 400, 400);
    expect(placeCanvasBatch(item, anchor, [cover]).get("new")).toEqual({ x: 0, y: 324 });
    expect(placeCanvasBatch(item, anchor, [cover, rect("below", 0, 320)]).get("new")).toEqual({ x: 0, y: -354 });
  });

  it("moves affected rows down when an image becomes taller, retaining row order", () => {
    const original = [rect("a", 0, 0), rect("b", 324, 0), rect("c", 0, 254), rect("d", 324, 254)];
    const expected = new Map(original.map(item => [item.id, item.position]));
    const resized = original.map(item => item.id === "a" ? { ...item, height: 650 } : item);
    const result = repairCanvasBatch(resized, expected, []);
    expect(result.get("a")).toEqual(original[0]!.position);
    expect(result.get("c")).toEqual({ x: 0, y: 674 });
    expect(result.get("d")).toEqual({ x: 324, y: 674 });
    clear(resized.map(item => ({ ...item, position: result.get(item.id)! })));
  });

  it("preserves manually moved cards and treats them as obstacles for the remaining rows", () => {
    const expected = new Map([["a", { x: 0, y: 0 }], ["b", { x: 0, y: 254 }]]);
    const moved = [rect("a", 12, 20, 300, 600), rect("b", 0, 254)];
    const result = repairCanvasBatch(moved, expected, []);
    expect(result.get("a")).toEqual({ x: 12, y: 20 });
    clear(moved.map(item => ({ ...item, position: result.get(item.id)! })));
  });
});

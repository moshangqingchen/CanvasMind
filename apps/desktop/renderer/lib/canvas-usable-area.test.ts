import { describe, expect, it } from "vitest";
import { canvasUsableArea } from "./canvas-usable-area";
describe("floating chrome usable canvas", () => {
  const canvas = { left: 0, top: 0, right: 1366, bottom: 768 };
  it("reserves top islands, left dock, bottom tools and the floating inspector", () => {
    expect(canvasUsableArea(canvas, [
      { left: 12, top: 12, right: 300, bottom: 60 },
      { left: 12, top: 96, right: 68, bottom: 680 },
      { left: 500, top: 708, right: 840, bottom: 756 },
      { left: 974, top: 72, right: 1354, bottom: 756 },
    ])).toEqual({ x: 84, y: 76, width: 874, height: 616 });
  });
  it("ignores hidden and offscreen panels", () => {
    expect(canvasUsableArea(canvas, [{ left: 0, top: 0, right: 0, bottom: 0 }, { left: 1400, top: 0, right: 1800, bottom: 760 }]))
      .toEqual({ x: 24, y: 24, width: 1318, height: 720 });
  });
  it("reserves adjacent parameter cards beside an open Agent", () => {
    expect(canvasUsableArea(canvas, [
      { left: 582, top: 72, right: 962, bottom: 756 },
      { left: 974, top: 72, right: 1354, bottom: 756 },
    ])).toEqual({ x: 24, y: 24, width: 542, height: 720 });
  });
  it("uses local offsets for a canvas embedded below another surface", () => {
    expect(canvasUsableArea({ left: 100, top: 80, right: 1100, bottom: 880 }, [
      { left: 708, top: 152, right: 1088, bottom: 868 },
    ])).toEqual({ x: 24, y: 24, width: 568, height: 752 });
  });
});

import { describe, expect, it } from "vitest";
import { virtualWindow } from "./virtual-window";

describe("virtualWindow", () => {
  it("keeps a thousand-row list bounded at the top, middle and bottom", () => {
    const offsets = Array.from({ length: 1001 }, (_, index) => index * 160);
    for (const scroll of [0, 64000, 159400]) {
      const range = virtualWindow(offsets, scroll, 600);
      expect(range.end - range.start).toBeLessThanOrEqual(9);
      expect(range.top + (range.end - range.start) * 160 + range.bottom).toBe(160000);
    }
  });
  it("uses measured expanded rows and handles empty or shortened results", () => {
    expect(virtualWindow([0, 100, 900, 1000], 450, 200, 0)).toEqual({ start: 1, end: 2, top: 100, bottom: 100 });
    expect(virtualWindow([0], 3000, 600)).toEqual({ start: 0, end: 0, top: 0, bottom: 0 });
    expect(virtualWindow([0, 100], 3000, 600)).toEqual({ start: 0, end: 1, top: 0, bottom: 0 });
  });
});

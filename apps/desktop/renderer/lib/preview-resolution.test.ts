import { describe, expect, it } from "vitest";
import { canvasPreviewSize } from "./preview-resolution";

describe("canvas preview resolution", () => {
  it("uses small previews for an overview and enough pixels for high-DPI close inspection", () => {
    expect(canvasPreviewSize(320 * 0.2 * 2)).toBe(160);
    expect(canvasPreviewSize(320 * 1 * 2)).toBe(640);
    expect(canvasPreviewSize(1200 * 1.5 * 2)).toBe(3840);
    expect(canvasPreviewSize(10000)).toBe(3840);
  });

  it("does not switch repeatedly when zoom crosses a tier boundary", () => {
    expect(canvasPreviewSize(650, 640)).toBe(640);
    expect(canvasPreviewSize(730, 640)).toBe(1200);
    expect(canvasPreviewSize(620, 1200)).toBe(1200);
    expect(canvasPreviewSize(510, 1200)).toBe(640);
    expect(canvasPreviewSize(150, 640)).toBe(640);
    expect(canvasPreviewSize(120, 640)).toBe(160);
  });

  it("handles absent measurements without requesting an original", () => {
    expect(canvasPreviewSize(Number.NaN)).toBe(640);
    expect(canvasPreviewSize(0)).toBe(160);
  });
});

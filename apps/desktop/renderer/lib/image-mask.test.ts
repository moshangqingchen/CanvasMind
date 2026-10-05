import { describe, expect, it } from "vitest";
import { imageMaskFileName, imageMaskFitScale, imageMaskPointFromClient, maskPixelsToSelection, MAX_IMAGE_MASK_PIXELS, selectionPixelsHaveEdits, selectionPixelsToMask, validateImageMaskSize } from "./image-mask";

describe("image mask geometry", () => {
  it("fits long portraits without treating the empty margins as image pixels", () => {
    const image = { width: 1000, height: 8000 };
    const scale = imageMaskFitScale(image, { width: 1048, height: 848 });
    expect(scale).toBe(0.1);
    expect(imageMaskPointFromClient({ x: 524, y: 224 }, { left: 474, top: 24, width: 100, height: 800 }, image)).toEqual({ x: 500, y: 2000 });
  });

  it("maps scrolled and zoomed canvas bounds to the original resolution", () => {
    expect(imageMaskPointFromClient({ x: 300, y: 200 }, { left: -300, top: -100, width: 1200, height: 800 }, { width: 2400, height: 1600 })).toEqual({ x: 1200, y: 600 });
    expect(imageMaskPointFromClient({ x: -25, y: 125 }, { left: 0, top: 0, width: 100, height: 100 }, { width: 1000, height: 1000 })).toEqual({ x: -250, y: 1250 });
  });

  it("rejects invalid geometry and limits allocations before drawing", () => {
    expect(imageMaskPointFromClient({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 1 }, { width: 100, height: 100 })).toBeNull();
    expect(() => validateImageMaskSize({ width: 4096, height: 4096 })).not.toThrow();
    expect(MAX_IMAGE_MASK_PIXELS).toBe(4096 * 4096);
    for (const size of [{ width: 0, height: 1 }, { width: Infinity, height: 1 }, { width: 1.5, height: 1 }, { width: 8193, height: 1 }, { width: 8192, height: 4096 }]) {
      expect(() => validateImageMaskSize(size)).toThrow();
    }
  });
});

describe("image mask alpha contract", () => {
  it("exports transparent edit pixels and opaque protected pixels, with binary antialiasing", () => {
    const pixels = new Uint8ClampedArray([12, 0, 0, 0, 255, 0, 0, 127, 0, 0, 0, 128, 0, 100, 0, 255]);
    expect(selectionPixelsToMask(pixels)).toBe(true);
    expect([...pixels]).toEqual([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 0]);
  });

  it("imports an alpha mask as a visible colored selection, ignoring its RGB values", () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 0, 8, 9, 10, 127, 0, 0, 0, 128]);
    expect(maskPixelsToSelection(pixels)).toBe(true);
    expect([...pixels].filter((_, index) => index % 4 === 3)).toEqual([0, 255, 255, 0]);
    expect([...pixels.slice(4, 7)]).toEqual([168, 116, 255]);
    selectionPixelsToMask(pixels);
    expect([...pixels].filter((_, index) => index % 4 === 3)).toEqual([255, 0, 0, 255]);
  });

  it("does not treat protected or fully erased masks as edits", () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 0, 1, 2, 3, 127]);
    expect(selectionPixelsHaveEdits(pixels)).toBe(false);
    expect(selectionPixelsToMask(pixels)).toBe(false);
    expect(maskPixelsToSelection(pixels)).toBe(false);
    expect(selectionPixelsHaveEdits(pixels)).toBe(false);
  });

  it("names mask exports independently of the source format and path characters", () => {
    expect(imageMaskFileName("海报.jpg")).toBe("海报-mask.png");
    expect(imageMaskFileName("a/b:cover.webp")).toBe("a_b_cover-mask.png");
    expect(imageMaskFileName("")).toBe("image-mask.png");
  });
});

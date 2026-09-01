import { describe, expect, it } from "vitest";
import { normalizePreviewSize } from "./asset-preview";

describe("asset preview sizes", () => {
  it("keeps lightweight thumbnails and exposes high-resolution selected previews", () => {
    expect(normalizePreviewSize("640")).toBe(640);
    expect(normalizePreviewSize("1200")).toBe(1200);
    expect(normalizePreviewSize("1201")).toBe(2400);
    expect(normalizePreviewSize("2401")).toBe(3840);
    expect(normalizePreviewSize("9999")).toBe(3840);
  });
});

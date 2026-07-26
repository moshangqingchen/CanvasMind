import { describe, expect, it } from "vitest";

import { normalizeDraggedMediaFile } from "./dropped-media";

describe("cross-application media drops", () => {
  it("infers a PNG MIME type when a native Electron drag leaves it empty", () => {
    const source = new File([new Uint8Array([1, 2, 3])], "参考图.PNG", {
      type: "",
      lastModified: 123,
    });
    const normalized = normalizeDraggedMediaFile(source);
    expect(normalized).not.toBeNull();
    expect(normalized?.type).toBe("image/png");
    expect(normalized?.name).toBe(source.name);
    expect(normalized?.lastModified).toBe(source.lastModified);
  });

  it("keeps already supported browser files unchanged", () => {
    const source = new File([new Uint8Array([1])], "clip.mp4", {
      type: "video/mp4",
    });
    expect(normalizeDraggedMediaFile(source)).toBe(source);
  });

  it("rejects unsupported native files", () => {
    const source = new File([new Uint8Array([1])], "notes.txt", { type: "" });
    expect(normalizeDraggedMediaFile(source)).toBeNull();
  });
});

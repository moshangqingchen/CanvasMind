import { describe, expect, it } from "vitest";

import {
  arePortKindsCompatible,
  getPortCompatibility,
  normalizePortCollection,
} from "../src/index.js";

describe("port compatibility", () => {
  it("accepts exact kinds and promotes single media into arrays", () => {
    expect(arePortKindsCompatible("text", "text")).toBe(true);
    expect(arePortKindsCompatible("image", "image[]")).toBe(true);
    expect(arePortKindsCompatible("video", "video[]")).toBe(true);
    expect(arePortKindsCompatible("audio", "audio[]")).toBe(true);
    expect(getPortCompatibility("image", "image[]").coercion).toBe(
      "single_to_array",
    );
  });

  it("rejects lossy and cross-media connections", () => {
    expect(arePortKindsCompatible("image[]", "image")).toBe(false);
    expect(arePortKindsCompatible("image", "video")).toBe(false);
    expect(arePortKindsCompatible("audio", "video")).toBe(false);
    expect(arePortKindsCompatible("text", "image")).toBe(false);
  });

  it("normalizes and deterministically orders map-shaped ports", () => {
    expect(
      normalizePortCollection({
        z: { kind: "video" },
        a: { id: "custom", kind: "image" },
      }),
    ).toEqual([
      { id: "custom", kind: "image" },
      { id: "z", kind: "video" },
    ]);
  });
});

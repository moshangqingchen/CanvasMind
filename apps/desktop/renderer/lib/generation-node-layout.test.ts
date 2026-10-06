import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../components/types";
import { ensureMaskNodeSize, hasImageMask } from "./generation-node-layout";

const old: CanvasNode = { id: "edit", type: "workflow", position: { x: 10, y: 20 },
  style: { width: 420, height: 210 }, width: 420, height: 210, measured: { width: 420, height: 210 },
  data: { nodeType: "image-generation", label: "局部重绘", parameters: { maskAssetId: "mask", maskSourceAssetId: "original" } } };

describe("saved mask node geometry", () => {
  it("restores the old compact node and its measured Flow bounds without changing content or placement", () => {
    const restored = ensureMaskNodeSize(old);
    expect(restored.style).toEqual({ width: 420, height: 330 });
    expect(restored.measured).toEqual({ width: 420, height: 330 });
    expect(restored.height).toBe(330);
    expect(restored.position).toBe(old.position);
    expect(restored.data).toBe(old.data);
    expect(old.style?.height).toBe(210);
    expect(ensureMaskNodeSize(restored)).toBe(restored);
  });
  it("preserves larger custom sizes, ordinary nodes and empty masks", () => {
    const large = { ...old, height: 600, measured: { width: 420, height: 600 }, style: { width: 420, height: 600 } };
    expect(ensureMaskNodeSize(large)).toBe(large);
    const ordinary = { ...old, data: { ...old.data, parameters: {} } };
    expect(ensureMaskNodeSize(ordinary)).toBe(ordinary);
    expect(hasImageMask({ maskAssetId: " ", mask: "" })).toBe(false);
    expect(hasImageMask({ mask: "https://example.invalid/mask.png" })).toBe(true);
  });
});

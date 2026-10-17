import { describe, expect, it, vi } from "vitest";
import { createCanvasPortalTarget } from "./canvas-portal-target";

describe("canvas portal target", () => {
  it("resolves a shared host once across 500 edges and 60 graph updates", () => {
    const target = { isConnected: true } as Element;
    const root = { querySelector: vi.fn(() => target) } as unknown as Element;
    const resolve = createCanvasPortalTarget(".react-flow__edgelabel-renderer");
    for (let frame = 0; frame < 60; frame++) for (let edge = 0; edge < 500; edge++) expect(resolve(root)).toBe(target);
    expect(root.querySelector).toHaveBeenCalledTimes(1);
  });

  it("rechecks absent or detached hosts and keeps each canvas separate", () => {
    const first = { isConnected: true } as Element;
    const replacement = { isConnected: true } as Element;
    const querySelector = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(first).mockReturnValue(replacement);
    const root = { querySelector } as unknown as Element;
    const other = { querySelector: vi.fn(() => replacement) } as unknown as Element;
    const resolve = createCanvasPortalTarget(".react-flow__edgelabel-renderer");
    expect(resolve(null)).toBeNull(); expect(resolve(root)).toBeNull(); expect(resolve(root)).toBe(first);
    Object.defineProperty(first, "isConnected", { value: false });
    expect(resolve(root)).toBe(replacement); expect(resolve(other)).toBe(replacement);
    expect(querySelector).toHaveBeenCalledTimes(3); expect(other.querySelector).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../components/types";
import { createNodePresentationCache } from "./stable-node-content";

function node(id: string): CanvasNode {
  return { id, type: "workflow", position: { x: 0, y: 0 }, data: { label: id } };
}

describe("canvas node presentation cache", () => {
  it("keeps untouched nodes stable while preserving the dragged node's latest geometry", () => {
    const present = createNodePresentationCache();
    const a = node("a"), b = node("b");
    const data = new Map([[a.id, { ...a.data, status: "running" as const }]]);
    const before = present([a, b], data);
    const moved = { ...a, position: { x: 80, y: 120 }, dragging: true };
    const after = present([moved, b], data);

    expect(after[0]?.position).toEqual({ x: 80, y: 120 });
    expect(after[0]?.dragging).toBe(true);
    expect(after[0]?.data).toBe(before[0]?.data);
    expect(after[1]).toBe(before[1]);
    expect(a.position).toEqual({ x: 0, y: 0 });
    expect(a.data.status).toBeUndefined();
  });

  it("refreshes callbacks and result state even when source geometry is unchanged", () => {
    const present = createNodePresentationCache();
    const source = node("a");
    const running = { ...source.data, status: "running" as const };
    const ready = { ...source.data, status: "succeeded" as const, assetId: "result-1" };
    const before = present([source], new Map([[source.id, running]]));
    const after = present([source], new Map([[source.id, ready]]));

    expect(after[0]).not.toBe(before[0]);
    expect(after[0]?.data).toBe(ready);
    expect(present([source], new Map([[source.id, ready]]))[0]).toBe(after[0]);
    expect(present([source], new Map())[0]?.data).toBe(source.data);
  });
});

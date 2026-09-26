import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../components/types";
import { createNodePortLayoutCache } from "./node-port-layout-cache";

function node(id: string): CanvasNode {
  return {
    id, type: "workflow", position: { x: 0, y: 0 }, width: 320, height: 240,
    data: {
      label: id,
      inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
      outputs: [{ id: "image", kind: "image", label: "图片" }],
    },
  };
}

describe("node port layout cache", () => {
  it("keeps the same map without reading port values again during dragging or selection", () => {
    const layout = createNodePortLayoutCache();
    const source = node("a");
    let reads = 0;
    source.data.inputs = [{ get id() { reads++; return "prompt"; }, kind: "text", label: "提示词" }];
    const before = layout([source]);
    const initialReads = reads;
    for (let index = 0; index < 100; index++) {
      expect(layout([{ ...source, selected: index % 2 === 0, dragging: true,
        position: { x: index, y: index }, data: { ...source.data, label: `renamed-${index}` },
      }])).toBe(before);
    }
    expect(reads).toBe(initialReads);
  });

  it("keeps the same map for reordered nodes and equivalent rebuilt port arrays", () => {
    const layout = createNodePortLayoutCache();
    const a = node("a"), b = node("b");
    const before = layout([a, b]);
    expect(layout([b, { ...a, data: { ...a.data,
      inputs: a.data.inputs!.map(port => ({ ...port, label: "New label" })),
      outputs: a.data.outputs!.map(port => ({ ...port })),
    } }])).toBe(before);
  });

  it.each(["width", "height"] as const)("updates %s changes without mutating the previously returned map", (dimension) => {
    const layout = createNodePortLayoutCache();
    const a = node("a"), b = node("b");
    const before = layout([a, b]);
    const oldSignature = before.get("a");
    const changed = { ...a, [dimension]: a[dimension]! + 20 };
    const after = layout([changed, b]);
    expect(after).not.toBe(before);
    expect(after.get("a")).not.toBe(oldSignature);
    expect(after.get("b")).toBe(before.get("b"));
    expect(before.get("a")).toBe(oldSignature);
    expect(layout([changed, b])).toBe(after);
  });

  it("detects port identifiers, kinds, order, additions and removals", () => {
    const layout = createNodePortLayoutCache();
    const a = node("a");
    let before = layout([a]);
    const revisions = [
      [{ id: "other", kind: "text", label: "Other" }],
      [{ id: "other", kind: "image", label: "Other" }],
      [{ id: "other", kind: "image", label: "Other" }, { id: "second", kind: "text", label: "Second" }],
      [{ id: "second", kind: "text", label: "Second" }, { id: "other", kind: "image", label: "Other" }],
      [],
    ];
    for (const inputs of revisions) {
      const after = layout([{ ...a, data: { ...a.data, inputs } }]);
      expect(after).not.toBe(before);
      expect(after.get("a")).not.toBe(before.get("a"));
      before = after;
    }
  });

  it("removes deleted nodes and measures new nodes even when the node count is unchanged", () => {
    const layout = createNodePortLayoutCache();
    const a = node("a"), b = node("b");
    const initial = layout([a]);
    const replaced = layout([b]);
    expect([...replaced.keys()]).toEqual(["b"]);
    expect(initial.has("a")).toBe(true);
    const empty = layout([]);
    expect(empty.size).toBe(0);
    expect(layout([])).toBe(empty);
    const restored = layout([a, b]);
    expect([...restored.keys()]).toEqual(["a", "b"]);
    expect(restored).not.toBe(initial);
  });
});

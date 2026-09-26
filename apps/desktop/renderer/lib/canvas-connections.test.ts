import { describe, expect, it } from "vitest";
import {
  filterEdgesToKnownPorts,
  hasEdgeForNodePair,
  keepLatestEdgePerNodePair,
} from "./canvas-connections";

interface TestEdge {
  id: string;
  source: string;
  target: string;
  targetHandle: string;
}

const edge = (
  id: string,
  source: string,
  target: string,
  targetHandle: string,
): TestEdge => ({ id, source, target, targetHandle });

describe("canvas connections", () => {
  it("keeps only the newest connection between the same two nodes", () => {
    const edges = [
      edge("first", "image-1", "video-1", "firstFrame"),
      edge("other-target", "image-1", "video-2", "referenceImages"),
      edge("replacement", "image-1", "video-1", "referenceImages"),
      edge("other-source", "image-2", "video-1", "referenceImages"),
    ];

    expect(keepLatestEdgePerNodePair(edges).map((item) => item.id)).toEqual([
      "other-target",
      "replacement",
      "other-source",
    ]);
  });

  it("returns the original array when every node pair is already unique", () => {
    const edges = [
      edge("one", "image-1", "video-1", "firstFrame"),
      edge("two", "image-2", "video-1", "referenceImages"),
    ];

    expect(keepLatestEdgePerNodePair(edges)).toBe(edges);
  });

  it("detects a connection even when the two handles are different", () => {
    const edges = [edge("old", "image-1", "video-1", "firstFrame")];

    expect(hasEdgeForNodePair(edges, "image-1", "video-1")).toBe(true);
    expect(hasEdgeForNodePair(edges, "image-1", "video-2")).toBe(false);
  });

  it("drops edges that target a port removed by a model change", () => {
    const nodes = [
      { id: "asset", data: { outputs: [{ id: "asset" }] } },
      { id: "image", data: { inputs: [{ id: "prompt" }] } },
    ];
    const edges = [
      {
        id: "valid",
        source: "asset",
        sourceHandle: "asset",
        target: "image",
        targetHandle: "prompt",
      },
      {
        id: "stale",
        source: "asset",
        sourceHandle: "asset",
        target: "image",
        targetHandle: "references",
      },
    ];

    expect(filterEdgesToKnownPorts(nodes, edges).map((item) => item.id)).toEqual([
      "valid",
    ]);
  });

  it("preserves the original edge array when every edge remains valid", () => {
    const nodes = [
      { id: "asset", data: { outputs: [{ id: "asset" }] } },
      { id: "image", data: { inputs: [{ id: "prompt" }] } },
    ];
    const edges = [
      edge("valid", "asset", "image", "prompt"),
    ];

    expect(filterEdgesToKnownPorts(nodes, edges)).toBe(edges);
  });
});

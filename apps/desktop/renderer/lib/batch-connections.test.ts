import { describe, expect, it, vi } from "vitest";
import type { CanvasEdge, CanvasNode } from "../components/types";
import { batchOutputPresentation, batchOutputSources, planBatchConnections, readingOrderCanvasNodes, type BatchConnectionSource } from "./batch-connections";

function node(id: string, x = 0, y = 0, kind = "image"): CanvasNode {
  return { id, type: "workflow", position: { x, y }, style: { width: 200, height: 200 }, data: { label: id,
    assetId: `${id}-asset`, outputs: [{ id: "out", label: "输出", kind }], inputs: [{ id: "in", label: "参考图", kind: "image[]", multiple: true }] } };
}
const source = (nodeId: string, kind: BatchConnectionSource["kind"] = "image"): BatchConnectionSource => ({ nodeId, handleId: "out", kind });
const edge = (source: string, target: string): CanvasEdge => ({ id: `${source}-${target}`, source, target, sourceHandle: "out", targetHandle: "in" });

describe("batch connections", () => {
  it("does not sort, inspect positions or measure a hidden batch handle while dragging", () => {
    const nodes = Array.from({ length: 500 }, (_, i) => {
      const value = node(String(i));
      Object.defineProperty(value, "position", { get: () => { throw new Error("drag must skip bounds and reading order"); } });
      return value;
    });
    const dimensions = vi.fn(() => ({ width: 200, height: 200 }));
    expect(batchOutputPresentation(nodes, true, dimensions)).toEqual({ sources: [], bounds: { x: 0, y: 0, width: 0, height: 0 } });
    expect(dimensions).not.toHaveBeenCalled();
  });

  it("recomputes real source order and final bounds after release", () => {
    const nodes = [node("b", 230, 20), node("a", 0, 50)];
    const result = batchOutputPresentation(nodes, false, () => ({ width: 200, height: 200 }));
    expect(result.sources.map(source => source.nodeId)).toEqual(["a", "b"]);
    expect(result.bounds).toEqual({ x: 0, y: 20, width: 430, height: 230 });
    expect(batchOutputPresentation([], false, () => { throw new Error("empty selection"); }).bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
  it("reads rows left to right with half-height tolerance and deterministic ties", () => {
    const nodes = [node("d", 230, 300), node("b", 230, 20), node("c", 0, 320), node("a", 0, 50)];
    expect(readingOrderCanvasNodes(nodes).map(node => node.id)).toEqual(["a", "b", "c", "d"]);
    expect(batchOutputSources([...nodes, node("audio", 0, 700, "audio")]).map(item => item.nodeId)).toEqual(["a", "b", "c", "d"]);
    expect(batchOutputSources([node("a"), node("b", 0, 0, "audio")])).toEqual([]);
  });

  it("plans visual order, retaining old edges and allowing up to the model image limit", () => {
    const nodes = [node("a"), node("b", 220), node("c", 0, 300), node("d", 220, 300), node("target", 800)];
    const old = [edge("d", "target")];
    const plan = planBatchConnections({ nodes, edges: old, sources: [source("c"), source("b"), source("d"), source("a")], targetId: "target", targetHandle: "in", maxInputImages: 3 });
    expect(plan.edges.map(edge => edge.source)).toEqual(["a", "b"]);
    expect(plan.skipped.map(skip => [skip.source.nodeId, skip.reason])).toEqual([["c", "limit"], ["d", "duplicate"]]);
    expect(old).toEqual([edge("d", "target")]);
  });

  it("skips cycles, duplicates and incompatible source ports individually", () => {
    const nodes = [node("a"), node("b", 220), node("audio", 440, 0, "audio"), node("target", 800)];
    const plan = planBatchConnections({ nodes, edges: [edge("target", "a"), edge("b", "target")], sources: [source("a"), source("b"), source("audio", "audio")], targetId: "target", targetHandle: "in" });
    expect(plan.edges).toEqual([]);
    expect(plan.skipped.map(skip => skip.reason)).toEqual(["cycle", "duplicate", "incompatible"]);
  });

  it("runs occupancy checks against the progressively planned graph", () => {
    const target = node("target", 800);
    target.data.inputs![0]!.multiple = false;
    const plan = planBatchConnections({ nodes: [node("a"), node("b", 220), target], edges: [], sources: [source("b"), source("a")], targetId: "target", targetHandle: "in" });
    expect(plan.edges.map(edge => edge.source)).toEqual(["a"]);
    expect(plan.skipped.map(skip => skip.reason)).toEqual(["occupied"]);
  });

  it("counts all image assets from an upstream output and does not spend cap on shared assets", () => {
    const a = node("a"), b = node("b", 220), c = node("c", 440), target = node("target", 800);
    a.data.lastOutputAssetIds = ["second"];
    b.data.assetId = a.data.assetId;
    const plan = planBatchConnections({ nodes: [a, b, c, target], edges: [], sources: [source("c"), source("b"), source("a")], targetId: "target", targetHandle: "in", maxInputImages: 2 });
    expect(plan.edges.map(edge => edge.source)).toEqual(["a", "b"]);
    expect(plan.skipped.map(skip => skip.reason)).toEqual(["limit"]);
  });

  it("does not apply an existing image overage to a different output kind", () => {
    const old = node("old"), multi = node("multi"), target = node("target");
    multi.data.outputs!.push({ id: "text", kind: "text", label: "文本" });
    target.data.inputs!.push({ id: "prompt", kind: "text", label: "提示词", multiple: true });
    const plan = planBatchConnections({ nodes: [old, multi, target], edges: [edge("old", "target")], sources: [{ nodeId: "multi", handleId: "text", kind: "text" }], targetId: "target", targetHandle: "prompt", maxInputImages: 0 });
    expect(plan.edges).toHaveLength(1); expect(plan.skipped).toEqual([]);
  });
});

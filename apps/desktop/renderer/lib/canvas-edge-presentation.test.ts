import { describe, expect, it } from "vitest";
import { presentCanvasEdges } from "./canvas-edge-presentation";
import type { CanvasEdge, CanvasNode } from "../components/types";

const node = (id: string, selected = false, extra = {}): CanvasNode => ({ id, type: "workflow", position: { x: 0, y: 0 }, selected, data: { label: id, ...extra } });
const edges: CanvasEdge[] = [
  { id: "ab", source: "a", target: "b", type: "smoothstep", data: { retained: true } },
  { id: "cd", source: "c", target: "d", type: "smoothstep" },
];

describe("canvas edge presentation", () => {
  it("emphasizes selected paths without changing saved edge data", () => {
    const before = structuredClone(edges);
    const result = presentCanvasEdges(edges, [node("a", true), node("b"), node("c"), node("d")], new Map());
    expect(result[0].data).toMatchObject({ retained: true, studio: { related: true, dimmed: false } });
    expect(result[1].data?.studio).toMatchObject({ related: false, dimmed: true });
    expect(edges).toEqual(before);
  });
  it("tracks running and failed work independently from selection", () => {
    const nodes = [node("a"), node("b")];
    expect(presentCanvasEdges(edges, nodes, new Map([["b", "running"]]))[0].data?.studio).toMatchObject({ running: true });
    expect(presentCanvasEdges(edges, nodes, new Map([["b", "succeeded"]]))[0].data?.studio).toMatchObject({ running: false });
    expect(presentCanvasEdges(edges, nodes, new Map([["a", "running"], ["b", "failed"]]))[0].data?.studio).toMatchObject({ running: false, failed: true });
  });
  it("dims other links when a single edge is selected", () => {
    const result = presentCanvasEdges([{ ...edges[0], selected: true }, edges[1]], [node("a"), node("b"), node("c"), node("d")], new Map());
    expect(result[0].selected).toBe(true);
    expect(result[0].data?.studio).toMatchObject({ related: false, dimmed: false });
    expect(result[1].data?.studio).toMatchObject({ related: false, dimmed: true });
  });
  it("never presents unapproved director previews as running jobs", () => {
    expect(presentCanvasEdges(edges, [node("a"), node("b", false, { directorDraft: true })], new Map([["b", "running"]]))[0].data?.studio).toMatchObject({ preview: true, running: false });
  });
  it("uses generated result status when no live run snapshot exists", () => {
    expect(presentCanvasEdges(edges, [node("a"), node("b", false, { generatedStatus: "running" })], new Map())[0].data?.studio).toMatchObject({ running: true });
  });
});

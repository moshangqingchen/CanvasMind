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
    expect(result[0].data).toMatchObject({ retained: true, studio: { related: true } });
    expect(result[1].data?.studio).toMatchObject({ related: false });
    expect(result[1].data?.studio).not.toHaveProperty("dimmed");
    expect(edges).toEqual(before);
  });
  it("tracks running and failed work independently from selection", () => {
    const nodes = [node("a"), node("b")];
    expect(presentCanvasEdges(edges, nodes, new Map([["b", "running"]]))[0].data?.studio).toMatchObject({ running: true });
    expect(presentCanvasEdges(edges, nodes, new Map([["b", "succeeded"]]))[0].data?.studio).toMatchObject({ running: false });
    expect(presentCanvasEdges(edges, nodes, new Map([["a", "running"], ["b", "failed"]]))[0].data?.studio).toMatchObject({ running: false, failed: true });
  });
  it("keeps unrelated links unchanged when a single edge is selected", () => {
    const result = presentCanvasEdges([{ ...edges[0], selected: true }, edges[1]], [node("a"), node("b"), node("c"), node("d")], new Map());
    expect(result[0].selected).toBe(true);
    expect(result[0].data?.studio).toMatchObject({ related: false });
    expect(result[1].data?.studio).toEqual(presentCanvasEdges(edges, [node("a"), node("b"), node("c"), node("d")], new Map())[1].data?.studio);
  });
  it("never presents unapproved director previews as running jobs", () => {
    expect(presentCanvasEdges(edges, [node("a"), node("b", false, { directorDraft: true })], new Map([["b", "running"]]))[0].data?.studio).toMatchObject({ preview: true, running: false });
  });
  it("uses generated result status when no live run snapshot exists", () => {
    expect(presentCanvasEdges(edges, [node("a"), node("b", false, { generatedStatus: "running" })], new Map())[0].data?.studio).toMatchObject({ running: true });
  });
  it("animates only incoming active work, never queued or outgoing idle work", () => {
    const nodes = [node("a"), node("b")];
    for (const statuses of [new Map([["a", "running"]]), new Map([["b", "queued"]])]) {
      expect(presentCanvasEdges(edges, nodes, statuses)[0].data?.studio).toMatchObject({ running: false });
    }
  });
  it("uses the exact data port kind for color and retains array-media meaning", () => {
    const nodes = [node("a", false, { outputs: [{ id: "out", kind: "video[]", label: "视频" }] }), node("b")];
    expect(presentCanvasEdges([{ ...edges[0], sourceHandle: "out" }], nodes, new Map())[0].data?.studio).toMatchObject({ kind: "video" });
  });
  it("colors legacy edges from the same first media port that React Flow uses for an omitted handle", () => {
    for (const sourceHandle of [undefined, null]) {
      const legacy: CanvasEdge = { ...edges[0], sourceHandle };
      const original = structuredClone(legacy);
      const nodes = [node("a", false, { outputs: [{ id: "images", kind: "image[]", label: "图片" }, { id: "video", kind: "video", label: "视频" }] }), node("b")];
      const [presented] = presentCanvasEdges([legacy], nodes, new Map());
      expect(presented.data?.studio).toMatchObject({ kind: "image" });
      expect(presented.sourceHandle).toBe(sourceHandle);
      expect(legacy).toEqual(original);
      expect(presentCanvasEdges([{ ...legacy, sourceHandle: "video" }], nodes, new Map())[0].data?.studio).toMatchObject({ kind: "video" });
    }
  });
  it("uses the first target port only for an omitted target handle when source metadata has no port", () => {
    const nodes = [node("a"), node("b", false, { inputs: [{ id: "audio", kind: "audio[]", label: "声音" }, { id: "image", kind: "image", label: "图片" }] })];
    for (const targetHandle of [undefined, null]) {
      expect(presentCanvasEdges([{ ...edges[0], targetHandle }], nodes, new Map())[0].data?.studio).toMatchObject({ kind: "audio" });
    }
    expect(presentCanvasEdges([{ ...edges[0], targetHandle: "image" }], nodes, new Map())[0].data?.studio).toMatchObject({ kind: "image" });
  });
  it("does not assign the first port's media kind to an explicit unknown or empty handle ID", () => {
    for (const handle of ["removed-port", ""]) {
      const sourceNodes = [node("a", false, { outputs: [{ id: "image", kind: "image", label: "图片" }] }), node("b")];
      expect(presentCanvasEdges([{ ...edges[0], sourceHandle: handle }], sourceNodes, new Map())[0].data?.studio).toMatchObject({ kind: "text" });
      const targetNodes = [node("a"), node("b", false, { inputs: [{ id: "video", kind: "video", label: "视频" }] })];
      expect(presentCanvasEdges([{ ...edges[0], targetHandle: handle }], targetNodes, new Map())[0].data?.studio).toMatchObject({ kind: "text" });
    }
  });
});

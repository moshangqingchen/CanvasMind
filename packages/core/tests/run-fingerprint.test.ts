import { describe, expect, it } from "vitest";
import { runFingerprint, type RunFingerprintScope, type WorkflowGraph, type WorkflowNode } from "../src/index.js";

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode => ({
  id, type, position: { x: 0, y: 0 }, data,
});

function fixture(): WorkflowGraph {
  return {
    nodes: [
      node("prompt", "prompt", { parts: [{ type: "text", text: "P1" }] }),
      node("asset", "asset-input", { assetId: "original", assetKind: "image" }),
      node("image", "image-generation", {
        provider: "fake", connectionId: "one", model: "model-p1",
        parameters: { quality: "high", maskAssetId: "mask", maskSourceAssetId: "original" },
      }),
      node("video", "video-generation", { model: "video-p1", parts: [{ type: "text", text: "V1" }] }),
      node("other", "image-generation", { model: "other-p1", lastOutputAssetIds: ["old"] }),
      node("result", "asset-input", {
        generatedResult: true, generatedFromNodeId: "image", generatedStatus: "succeeded", assetId: "output-1",
      }),
    ],
    edges: [
      { id: "prompt-image", source: "prompt", target: "image", targetHandle: "prompt" },
      { id: "asset-image", source: "asset", target: "image", targetHandle: "references" },
      { id: "image-video", source: "image", target: "video", targetHandle: "firstFrame" },
      { id: "display-feedback", source: "image", target: "result", targetHandle: "generated" },
    ],
  };
}

function changeData(graph: WorkflowGraph, id: string, patch: Record<string, unknown>): WorkflowGraph {
  return { ...graph, nodes: graph.nodes.map((item) => item.id === id
    ? { ...item, data: { ...item.data, ...patch } } : item) };
}

const runImage: RunFingerprintScope = { scope: "node", nodeId: "image" };
const downstream: RunFingerprintScope = { scope: "downstream", nodeId: "image" };

describe("runFingerprint", () => {
  it("ignores graph presentation and known React Flow UI fields", () => {
    const graph = fixture();
    const moved = {
      ...graph,
      viewport: { x: 200, y: -50, zoom: 0.4 },
      drawings: [{ points: [{ x: 3, y: 4 }] }],
      nodes: graph.nodes.map((item) => ({
        ...item, position: { x: 800, y: 900 }, positionAbsolute: { x: 20, y: 50 },
        selected: true, dragging: true, width: 600, height: 300, measured: { width: 600 },
        style: { width: 600, height: 300 },
      })),
      edges: graph.edges.map((edge) => ({
        ...edge, selected: true, animated: true, style: { color: "red" }, label: "UI label",
      })),
    };
    for (const selection of [runImage, downstream, { scope: "all" } as const]) {
      expect(runFingerprint(moved, selection)).toBe(runFingerprint(graph, selection));
    }
  });

  it("ignores unrelated edits and generated result writebacks for node and downstream runs", () => {
    const graph = fixture();
    let changed = changeData(graph, "other", {
      model: "other-p2", lastOutputAssetIds: ["new"], lastOutputRunId: "other-run",
    });
    changed = changeData(changed, "result", { generatedStatus: "running", assetId: "output-2" });
    changed = {
      ...changed,
      nodes: [...changed.nodes, node("other-result", "asset-input", {
        generatedResult: true, generatedFromNodeId: "other", assetId: "other-output",
      })],
      edges: [...changed.edges, { id: "other-feedback", source: "other", target: "other-result" }],
    };
    for (const selection of [runImage, downstream]) {
      expect(runFingerprint(changed, selection)).toBe(runFingerprint(graph, selection));
    }
  });

  it.each([
    ["model", { model: "model-p2" }],
    ["provider", { provider: "rest" }],
    ["connection", { connectionId: "two" }],
    ["quality", { parameters: { quality: "max", maskAssetId: "mask", maskSourceAssetId: "original" } }],
    ["mask", { parameters: { quality: "high", maskAssetId: "other-mask", maskSourceAssetId: "original" } }],
    ["prompt", { parts: [{ type: "text", text: "P2" }] }],
    ["prompt asset role", { parts: [{ type: "asset", assetId: "original", role: "firstFrame" }] }],
    ["unknown data", { futureRequestField: { value: "must-be-preserved" } }],
    ["data fields named like UI fields", { position: { requestValue: true }, width: 123 }],
  ])("includes changed %s on the executing node", (_label, patch) => {
    const graph = fixture();
    expect(runFingerprint(changeData(graph, "image", patch), runImage)).not.toBe(runFingerprint(graph, runImage));
  });

  it("includes the node type, semantic type, port declarations and unknown top-level fields", () => {
    const graph = fixture();
    for (const patch of [
      { type: "music-generation" },
      { kind: "music-generation" },
      { inputs: [{ id: "prompt", kind: "text" as const, required: true }] },
      { futureExecutionField: "conservative" },
    ]) {
      const changed = { ...graph, nodes: graph.nodes.map((item) => item.id === "image" ? { ...item, ...patch } : item) };
      expect(runFingerprint(changed, runImage)).not.toBe(runFingerprint(graph, runImage));
    }
    expect(runFingerprint(changeData(graph, "image", { nodeType: "music-generation" }), runImage))
      .not.toBe(runFingerprint(graph, runImage));
  });

  it("includes all transitive upstream data and linked material identities", () => {
    const graph = fixture();
    for (const [id, patch] of [
      ["prompt", { parts: [{ type: "text", text: "P2" }] }],
      ["asset", { assetId: "replacement" }],
    ] as const) {
      expect(runFingerprint(changeData(graph, id, patch), { scope: "node", nodeId: "video" }))
        .not.toBe(runFingerprint(graph, { scope: "node", nodeId: "video" }));
    }
  });

  it("captures the runtime first-match media ratio even on a node outside the dependency closure", () => {
    const graph = fixture();
    const withContext = {
      ...graph,
      nodes: [node("outside-reference", "asset-input", { assetId: "original", mediaAspectRatio: 1.5 }), ...graph.nodes],
    };
    expect(runFingerprint(changeData(withContext, "outside-reference", { mediaAspectRatio: 2 }), runImage))
      .not.toBe(runFingerprint(withContext, runImage));

    // References can also be nested in prompt parts, masks, arrays or unknown
    // future fields, rather than connected through an asset-input node.
    const promptOnly = changeData(graph, "image", { futureRequestField: { assets: ["unconnected-asset"] } });
    const nestedContext = {
      ...promptOnly,
      nodes: [...promptOnly.nodes, node("nested-reference", "asset-input", { assetId: "unconnected-asset", mediaAspectRatio: 1.5 })],
    };
    expect(runFingerprint(changeData(nestedContext, "nested-reference", { mediaAspectRatio: 2 }), runImage))
      .not.toBe(runFingerprint(nestedContext, runImage));
  });

  it("does not include unrelated data from a node supplying the first-match media ratio", () => {
    const graph = fixture();
    const withContext = {
      ...graph,
      nodes: [node("outside-reference", "asset-input", { assetId: "original", mediaAspectRatio: 1.5 }), ...graph.nodes],
    };
    const changed = changeData(withContext, "outside-reference", {
      model: "other-model", generatedStatus: "succeeded", generatedError: "", lastOutputAssetIds: ["new-other-output"],
    });
    expect(runFingerprint(changed, runImage)).toBe(runFingerprint(withContext, runImage));
  });

  it("tracks additions, removals and order changes that change the first matching media ratio", () => {
    const graph = fixture();
    const first = node("outside-first", "asset-input", { assetId: "original", mediaAspectRatio: 1.5 });
    const second = node("outside-second", "asset-input", { assetId: "original", mediaAspectRatio: 2 });
    const withFirst = { ...graph, nodes: [first, ...graph.nodes] };
    const variants = [
      { ...graph, nodes: [second, first, ...graph.nodes] },
      graph,
      { ...graph, nodes: [second, ...graph.nodes, first] },
    ];
    for (const changed of variants) {
      expect(runFingerprint(changed, runImage)).not.toBe(runFingerprint(withFirst, runImage));
    }
    // A later duplicate is ignored by runtime's first-match lookup too.
    expect(runFingerprint({ ...graph, nodes: [first, second, ...graph.nodes] }, runImage))
      .toBe(runFingerprint(withFirst, runImage));
  });

  it("includes added, removed and retargeted incoming edges", () => {
    const graph = fixture();
    const variants: WorkflowGraph[] = [
      { ...graph, edges: graph.edges.filter((edge) => edge.id !== "prompt-image") },
      { ...graph, edges: [...graph.edges, { id: "other-image", source: "other", target: "image" }] },
      { ...graph, edges: graph.edges.map((edge) => edge.id === "asset-image" ? { ...edge, targetHandle: "lastFrame" } : edge) },
      { ...graph, edges: graph.edges.map((edge) => edge.id === "asset-image" ? { ...edge, futureRequestField: "new" } : edge) },
    ];
    for (const changed of variants) {
      expect(runFingerprint(changed, runImage)).not.toBe(runFingerprint(graph, runImage));
    }
  });

  it("preserves incoming edge and prompt-part order", () => {
    const graph = fixture();
    const reorderedEdges = { ...graph, edges: [...graph.edges].reverse() };
    expect(runFingerprint(reorderedEdges, runImage)).not.toBe(runFingerprint(graph, runImage));
    const parts = [{ type: "text", text: "first" }, { type: "text", text: "second" }];
    expect(runFingerprint(changeData(graph, "image", { parts }), runImage))
      .not.toBe(runFingerprint(changeData(graph, "image", { parts: [...parts].reverse() }), runImage));
  });

  it("includes a generated result used as input but excludes its display feedback edge", () => {
    const graph = fixture();
    const reused = { ...graph, edges: [...graph.edges, { id: "reuse", source: "result", target: "image", targetHandle: "references" }] };
    const withoutFeedback = { ...reused, edges: reused.edges.filter((edge) => edge.id !== "display-feedback") };
    expect(runFingerprint(withoutFeedback, runImage)).toBe(runFingerprint(reused, runImage));
    expect(runFingerprint(changeData(reused, "result", { assetId: "replacement" }), runImage))
      .not.toBe(runFingerprint(reused, runImage));
  });

  it("tracks downstream execution nodes as well as their ancestors", () => {
    const graph = fixture();
    const changed = changeData(graph, "video", { model: "video-p2" });
    expect(runFingerprint(changed, downstream)).not.toBe(runFingerprint(graph, downstream));
    expect(runFingerprint(changed, runImage)).toBe(runFingerprint(graph, runImage));
    expect(runFingerprint(changeData(graph, "prompt", { parts: [{ type: "text", text: "P2" }] }), downstream))
      .not.toBe(runFingerprint(graph, downstream));
  });

  it("uses every runtime-selected node for all scope", () => {
    const graph = fixture();
    expect(runFingerprint(changeData(graph, "other", { model: "other-p2" }), { scope: "all" }))
      .not.toBe(runFingerprint(graph, { scope: "all" }));
    expect(runFingerprint(changeData(graph, "result", { assetId: "other-output" }), { scope: "all" }))
      .not.toBe(runFingerprint(graph, { scope: "all" }));
  });

  it("uses selection scope and includes ancestors without including unselected descendants", () => {
    const graph = fixture();
    const selection: RunFingerprintScope = { scope: "selection", nodeIds: ["image", "other"] };
    expect(runFingerprint(changeData(graph, "video", { model: "video-p2" }), selection)).toBe(runFingerprint(graph, selection));
    expect(runFingerprint(changeData(graph, "other", { model: "other-p2" }), selection)).not.toBe(runFingerprint(graph, selection));
    expect(runFingerprint(changeData(graph, "prompt", { text: "new upstream" }), selection)).not.toBe(runFingerprint(graph, selection));
    expect(runFingerprint(graph, { scope: "selection", nodeIds: ["other", "image"] })).toBe(runFingerprint(graph, selection));
  });

  it("canonicalizes object keys and matches the JSON save representation of undefined", () => {
    const graph = fixture();
    const withUndefined = changeData(graph, "image", {
      optional: undefined, parameters: { b: 2, a: 1, optional: undefined, array: [undefined, 1] },
    });
    const saved = JSON.parse(JSON.stringify(withUndefined)) as WorkflowGraph;
    const differentKeys = changeData(saved, "image", { parameters: { array: [null, 1], a: 1, b: 2 } });
    expect(runFingerprint(withUndefined, runImage)).toBe(runFingerprint(saved, runImage));
    expect(runFingerprint(differentKeys, runImage)).toBe(runFingerprint(saved, runImage));
  });

  it("fails closed for invalid selection, missing upstream nodes, duplicate ids and non-JSON data", () => {
    const graph = fixture();
    expect(() => runFingerprint(graph, { scope: "node", nodeId: "missing" })).toThrow();
    expect(() => runFingerprint(graph, { scope: "selection", nodeIds: [] })).toThrow();
    expect(() => runFingerprint({ ...graph, edges: [...graph.edges, { id: "missing", source: "missing", target: "image" }] }, runImage)).toThrow();
    expect(() => runFingerprint({ ...graph, nodes: [...graph.nodes, graph.nodes[0]!] }, runImage)).toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    for (const value of [cyclic, Number.POSITIVE_INFINITY, () => undefined, new Date(), 1n]) {
      expect(() => runFingerprint(changeData(graph, "image", { futureField: value }), runImage)).toThrow(TypeError);
    }
  });
});

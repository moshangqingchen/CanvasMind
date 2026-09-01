import { describe, expect, it } from "vitest";

import {
  GraphCycleError,
  findCycles,
  selectRunNodeIds,
  selectRunSubgraph,
  topologicalLayers,
  topologicalSort,
  validateGraph,
  wouldCreateCycle,
  type WorkflowGraph,
} from "../src/index.js";

const dag: WorkflowGraph = {
  nodes: [
    { id: "render", type: "preview" },
    { id: "image", type: "image-generation" },
    { id: "prompt", type: "prompt" },
    { id: "asset", type: "asset-input" },
    { id: "video", type: "video-generation" },
  ],
  edges: [
    { id: "e4", source: "video", target: "render" },
    { id: "e2", source: "asset", target: "image" },
    { id: "e1", source: "prompt", target: "image" },
    { id: "e3", source: "image", target: "video" },
  ],
};

describe("DAG algorithms", () => {
  it("returns deterministic layers and order", () => {
    expect(topologicalLayers(dag)).toEqual([
      ["asset", "prompt"],
      ["image"],
      ["video"],
      ["render"],
    ]);
    expect(topologicalSort(dag)).toEqual([
      "asset",
      "prompt",
      "image",
      "video",
      "render",
    ]);
  });

  it("finds cycles and refuses to schedule them", () => {
    const cyclic: WorkflowGraph = {
      nodes: [
        { id: "c", type: "prompt" },
        { id: "a", type: "prompt" },
        { id: "b", type: "prompt" },
      ],
      edges: [
        { id: "ab", source: "a", target: "b" },
        { id: "bc", source: "b", target: "c" },
        { id: "ca", source: "c", target: "a" },
      ],
    };

    expect(findCycles(cyclic)).toEqual([["a", "b", "c", "a"]]);
    expect(() => topologicalSort(cyclic)).toThrow(GraphCycleError);
    expect(validateGraph(cyclic).errors.map((error) => error.code)).toContain(
      "cycle",
    );
  });

  it("selects node, downstream and all scopes", () => {
    expect(selectRunNodeIds(dag, "node", "image")).toEqual(["image"]);
    expect(selectRunNodeIds(dag, "downstream", "image")).toEqual([
      "image",
      "video",
      "render",
    ]);
    expect(selectRunNodeIds(dag, "all")).toEqual(topologicalSort(dag));

    const subgraph = selectRunSubgraph(dag, "downstream", "video");
    expect(subgraph.nodeIds).toEqual(["video", "render"]);
    expect(subgraph.edgeIds).toEqual(["e4"]);
  });

  it("predicts whether a prospective edge introduces a cycle", () => {
    expect(wouldCreateCycle(dag, "render", "asset")).toBe(true);
    expect(wouldCreateCycle(dag, "asset", "render")).toBe(false);
    expect(wouldCreateCycle(dag, "asset", "asset")).toBe(true);
  });

  it("does not treat generated result feedback links as workflow cycles", () => {
    const graph: WorkflowGraph = {
      nodes: [
        {
          id: "source",
          type: "image-generation",
          inputs: [
            { id: "prompt", kind: "text" },
            { id: "references", kind: "image[]", multiple: true },
          ],
          outputs: [{ id: "images", kind: "image" }],
        },
        {
          id: "result",
          type: "asset-input",
          data: {
            generatedResult: true,
            generatedFromNodeId: "source",
          },
          inputs: [{ id: "generated", kind: "image" }],
          outputs: [{ id: "asset", kind: "image" }],
        },
        {
          id: "downstream",
          type: "image-generation",
          inputs: [{ id: "references", kind: "image[]", multiple: true }],
        },
      ],
      edges: [
        {
          id: "source-result",
          source: "source",
          sourceHandle: "images",
          target: "result",
          targetHandle: "generated",
        },
        {
          id: "result-downstream",
          source: "result",
          sourceHandle: "asset",
          target: "downstream",
          targetHandle: "references",
        },
      ],
    };

    expect(findCycles(graph)).toEqual([]);
    expect(wouldCreateCycle(graph, "result", "downstream")).toBe(false);
    expect(validateGraph(graph).valid).toBe(true);
  });
});

describe("graph validation", () => {
  it("validates typed handles, required inputs and connection counts", () => {
    const graph: WorkflowGraph = {
      nodes: [
        {
          id: "source",
          type: "asset-input",
          outputs: [{ id: "media", kind: "video" }],
        },
        {
          id: "target",
          type: "image-generation",
          inputs: [
            { id: "reference", kind: "image", required: true },
            { id: "prompt", kind: "text", required: true },
          ],
        },
      ],
      edges: [
        {
          id: "wrong-kind",
          source: "source",
          sourceHandle: "media",
          target: "target",
          targetHandle: "reference",
        },
      ],
    };

    const codes = validateGraph(graph).errors.map((error) => error.code);
    expect(codes).toContain("incompatible_ports");
    expect(codes).toContain("missing_required_input");
  });

  it("reports structural errors without throwing", () => {
    const result = validateGraph({
      nodes: [
        { id: "same", type: "prompt" },
        { id: "same", type: "prompt" },
      ],
      edges: [
        { id: "edge", source: "missing", target: "same" },
        { id: "edge", source: "same", target: "same" },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        "duplicate_node_id",
        "duplicate_edge_id",
        "dangling_source",
        "self_loop",
        "cycle",
      ]),
    );
  });
});

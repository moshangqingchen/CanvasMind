import { describe, expect, it } from "vitest";
import type { PreparedRun } from "@super-canvas/runtime";
import type { ModelDescriptor } from "@super-canvas/providers";
import { preparedNodeRequirements } from "./agent-preflight";
const model: ModelDescriptor = {
  id: "video",
  name: "Video",
  operations: ["video.generate", "video.image-to-video"],
  inputKinds: ["text", "image"],
  outputKinds: ["video"],
};
const prepared = (): PreparedRun => ({
  canvasId: "c",
  canvasRevision: 2,
  scope: "selection",
  nodeIds: ["v"],
  revisionGraph: {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "v",
        type: "workflow",
        data: {
          nodeType: "video-generation",
          parameters: {
            duration: 12,
            aspect_ratio: "9:16",
            resolution: "1080p",
          },
        },
      },
    ],
    edges: [],
    __preparedHistoricalInputs: {
      v: { source: { value: { kind: "image", assetIds: ["original"] } } },
    },
  },
});
describe("actual execution quote requirements", () => {
  it("uses edited duration, resolution and references from the runtime snapshot", () => {
    expect(preparedNodeRequirements(prepared(), "v", model)).toMatchObject({
      operation: "video.image-to-video",
      durationSeconds: 12,
      aspectRatio: "9:16",
      resolution: "1080p",
      count: 1,
      inputCounts: { image: 1 },
    });
  });
  it("does not claim an old reference or duration after removal", () => {
    const p = prepared();
    p.revisionGraph.__preparedHistoricalInputs = {};
    p.revisionGraph.nodes = [
      {
        id: "v",
        type: "workflow",
        data: { nodeType: "video-generation", parameters: {} },
      },
    ];
    const result = preparedNodeRequirements(p, "v", model);
    expect(result.operation).toBe("video.generate");
    expect(result.durationSeconds).toBeUndefined();
    expect(result.inputKinds).toEqual([]);
  });
  it("counts an image dependency planned within the same generation batch", () => {
    const p = prepared();
    p.nodeIds = ["image", "v"];
    p.revisionGraph.nodes = [
      ...(p.revisionGraph.nodes as object[]),
      {
        id: "image",
        type: "workflow",
        data: { nodeType: "image-generation", parameters: { n: 2 } },
      },
    ];
    p.revisionGraph.edges = [
      {
        id: "ref",
        source: "image",
        target: "v",
        sourceHandle: "images",
        targetHandle: "firstFrame",
      },
    ];
    expect(preparedNodeRequirements(p, "v", model).inputCounts?.image).toBe(3);
  });
});

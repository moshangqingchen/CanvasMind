import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../components/types";
import { removeUnreturnedGeneratedResults } from "./generated-result-sync";

function resultNode(
  outputIndex: number,
  options: Partial<CanvasNode["data"]> = {},
): CanvasNode {
  return {
    id: `result-${outputIndex}`,
    type: "workflow",
    position: { x: 0, y: 0 },
    data: {
      label: `生成图片 ${outputIndex + 1}`,
      generatedResult: true,
      generatedFromNodeId: "source",
      generatedFromRunId: "run",
      generatedOutputIndex: outputIndex,
      ...options,
    },
  };
}

describe("generated result synchronization", () => {
  it("removes empty slots when a successful provider returns fewer outputs", () => {
    const result = removeUnreturnedGeneratedResults(
      [
        resultNode(0, { assetId: "asset-1" }),
        resultNode(1, { generatedStatus: "failed" }),
        resultNode(2, { generatedStatus: "failed" }),
        resultNode(0, { generatedFromNodeId: "other-source" }),
      ],
      [resultNode(3, { generatedStatus: "failed" })],
      "source",
      "run",
      undefined,
      1,
    );

    expect(result.nodes.map((node) => node.id)).toEqual([
      "result-0",
      "result-0",
    ]);
    expect(result.additions).toEqual([]);
  });

  it("preserves an existing asset beyond the returned count", () => {
    const existing = resultNode(2, { assetId: "already-archived" });
    const result = removeUnreturnedGeneratedResults(
      [existing],
      [],
      "source",
      "run",
      undefined,
      1,
    );

    expect(result.nodes).toEqual([existing]);
  });
});

import { describe, expect, it } from "vitest";
import type { CanvasEdge, CanvasNode } from "../components/types";
import {
  intersectingSelectionIds,
  removeDeletedAssetsFromGraph,
  selectionRectBetween,
} from "./generation-history";

describe("generation history helpers", () => {
  it("normalizes a reverse drag and selects every intersecting card", () => {
    const selection = selectionRectBetween(
      { x: 230, y: 180 },
      { x: 80, y: 40 },
    );
    expect(selection).toEqual({ left: 80, top: 40, right: 230, bottom: 180 });
    expect(
      intersectingSelectionIds(selection, [
        { id: "one", rect: { left: 20, top: 20, right: 90, bottom: 90 } },
        { id: "two", rect: { left: 120, top: 70, right: 200, bottom: 150 } },
        { id: "three", rect: { left: 260, top: 70, right: 340, bottom: 150 } },
      ]),
    ).toEqual(["one", "two"]);
  });

  it("removes deleted image nodes, connected edges, and stale references", () => {
    const nodes = [
      {
        id: "generator",
        position: { x: 0, y: 0 },
        data: {
          label: "生成器",
          lastOutputAssetIds: ["delete-me", "keep-me"],
          materializedOutputAssetIds: ["delete-me", "keep-me"],
          parts: [
            {
              type: "asset" as const,
              assetId: "delete-me",
              role: "reference" as const,
            },
            { type: "text" as const, text: "保留" },
          ],
        },
      },
      {
        id: "deleted-result",
        position: { x: 100, y: 0 },
        data: { label: "旧图片", assetId: "delete-me", generatedResult: true },
      },
      {
        id: "kept-result",
        position: { x: 200, y: 0 },
        data: { label: "保留图片", assetId: "keep-me", generatedResult: true },
      },
    ] satisfies CanvasNode[];
    const edges = [
      { id: "deleted-edge", source: "generator", target: "deleted-result" },
      { id: "kept-edge", source: "generator", target: "kept-result" },
    ] satisfies CanvasEdge[];

    const result = removeDeletedAssetsFromGraph(
      nodes,
      edges,
      new Set(["delete-me"]),
    );

    expect(result.nodes.map((node) => node.id)).toEqual([
      "generator",
      "kept-result",
    ]);
    expect(result.edges.map((edge) => edge.id)).toEqual(["kept-edge"]);
    expect(result.nodes[0]?.data.lastOutputAssetIds).toEqual(["keep-me"]);
    expect(result.nodes[0]?.data.materializedOutputAssetIds).toEqual([
      "keep-me",
    ]);
    expect(result.nodes[0]?.data.parts).toEqual([
      { type: "text", text: "保留" },
    ]);
  });
});

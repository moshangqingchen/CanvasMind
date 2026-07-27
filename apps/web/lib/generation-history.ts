import type { CanvasEdge, CanvasNode } from "../components/types";

export interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function selectionRectBetween(
  start: { x: number; y: number },
  end: { x: number; y: number },
): SelectionRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

export function selectionRectsIntersect(
  first: SelectionRect,
  second: SelectionRect,
): boolean {
  return !(
    first.right < second.left ||
    first.left > second.right ||
    first.bottom < second.top ||
    first.top > second.bottom
  );
}

export function intersectingSelectionIds(
  selection: SelectionRect,
  items: ReadonlyArray<{ id: string; rect: SelectionRect }>,
): string[] {
  return items
    .filter((item) => selectionRectsIntersect(selection, item.rect))
    .map((item) => item.id);
}

export function removeDeletedAssetsFromGraph(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  deletedAssetIds: ReadonlySet<string>,
): {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  removedNodeIds: Set<string>;
} {
  const removedNodeIds = new Set(
    nodes
      .filter(
        (node) =>
          typeof node.data.assetId === "string" &&
          deletedAssetIds.has(node.data.assetId),
      )
      .map((node) => node.id),
  );

  const nextNodes = nodes
    .filter((node) => !removedNodeIds.has(node.id))
    .map((node) => {
      const lastOutputAssetIds = node.data.lastOutputAssetIds?.filter(
        (assetId) => !deletedAssetIds.has(assetId),
      );
      const materializedOutputAssetIds =
        node.data.materializedOutputAssetIds?.filter(
          (assetId) => !deletedAssetIds.has(assetId),
        );
      const parts = node.data.parts?.filter(
        (part) => part.type !== "asset" || !deletedAssetIds.has(part.assetId),
      );
      const generatedPromptParts = node.data.generatedPromptParts?.filter(
        (part) => part.type !== "asset" || !deletedAssetIds.has(part.assetId),
      );
      const unchanged =
        lastOutputAssetIds?.length === node.data.lastOutputAssetIds?.length &&
        materializedOutputAssetIds?.length ===
          node.data.materializedOutputAssetIds?.length &&
        parts?.length === node.data.parts?.length &&
        generatedPromptParts?.length === node.data.generatedPromptParts?.length;

      if (unchanged) return node;
      return {
        ...node,
        data: {
          ...node.data,
          ...(lastOutputAssetIds ? { lastOutputAssetIds } : {}),
          ...(materializedOutputAssetIds ? { materializedOutputAssetIds } : {}),
          ...(parts ? { parts } : {}),
          ...(generatedPromptParts ? { generatedPromptParts } : {}),
        },
      };
    });

  return {
    nodes: nextNodes,
    edges: edges.filter(
      (edge) =>
        !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
    ),
    removedNodeIds,
  };
}

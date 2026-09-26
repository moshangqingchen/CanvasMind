import type { CanvasNode } from "../components/types";

/**
 * A provider may accept a requested batch size but return fewer usable
 * artifacts. Remove only the empty result slots that belong to that completed
 * run; an existing asset is preserved so a refresh can never discard data.
 */
export function removeUnreturnedGeneratedResults(
  nodes: readonly CanvasNode[],
  additions: readonly CanvasNode[],
  sourceId: string,
  runId: string,
  pendingRequestId: string | undefined,
  returnedCount: number,
): { nodes: CanvasNode[]; additions: CanvasNode[] } {
  const shouldRemove = (node: CanvasNode): boolean => {
    if (node.data.generatedResult !== true || node.data.assetId) return false;
    if (node.data.generatedFromNodeId !== sourceId) return false;
    if (typeof node.data.generatedOutputIndex !== "number") return false;
    if (node.data.generatedOutputIndex < returnedCount) return false;
    const belongsToRun =
      node.data.generatedFromRunId === runId ||
      (pendingRequestId !== undefined &&
        node.data.generatedPendingRequestId === pendingRequestId);
    return belongsToRun;
  };

  return {
    nodes: nodes.filter((node) => !shouldRemove(node)),
    additions: additions.filter((node) => !shouldRemove(node)),
  };
}

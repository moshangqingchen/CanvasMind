import type { CanvasDocument, CanvasNode } from "../components/types";

const transient = (node: CanvasNode) => node.data.pendingImport === true || node.data.directorDraft === true;

/** In-flight UI work is independent of persisted undo snapshots. Never revive a deleted placeholder. */
export function restoreHistoryWithTransientNodes(snapshot: CanvasDocument, current: Pick<CanvasDocument, "nodes" | "edges">) {
  const pending = current.nodes.filter(transient);
  const pendingIds = new Set(pending.map(node => node.id));
  const nodes = [...snapshot.nodes.filter(node => !transient(node) && !pendingIds.has(node.id)), ...pending];
  const edges = new Map(snapshot.edges.map(edge => [edge.id, edge]));
  for (const edge of current.edges) {
    if (pendingIds.has(edge.source) || pendingIds.has(edge.target)) edges.set(edge.id, edge);
  }
  return { nodes, edges: [...edges.values()] };
}

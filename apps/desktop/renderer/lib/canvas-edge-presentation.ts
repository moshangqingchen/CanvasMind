import type { CanvasEdge, CanvasNode } from "../components/types";

export interface StudioEdgeState {
  related: boolean;
  dimmed: boolean;
  running: boolean;
  failed: boolean;
  preview: boolean;
}

const runningStates = new Set(["queued", "submitting", "running", "polling", "downloading", "archiving"]);
const failedStates = new Set(["failed", "blocked", "needs_attention"]);

/** Presentation is derived, never persisted into the saved graph or undo history. */
export function presentCanvasEdges(edges: CanvasEdge[], nodes: CanvasNode[], statuses: ReadonlyMap<string, string>): CanvasEdge[] {
  const selectedIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
  const hasSelection = selectedIds.size > 0 || edges.some((edge) => edge.selected);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const sourceStatus = statuses.get(edge.source) ?? source?.data.generatedStatus ?? source?.data.status ?? "";
    const targetStatus = statuses.get(edge.target) ?? target?.data.generatedStatus ?? target?.data.status ?? "";
    const related = selectedIds.has(edge.source) || selectedIds.has(edge.target);
    const failed = failedStates.has(targetStatus);
    const preview = Boolean(source?.data.directorDraft || target?.data.directorDraft);
    const studio: StudioEdgeState = {
      related,
      dimmed: hasSelection && !related && !edge.selected,
      running: !preview && !failed && (runningStates.has(sourceStatus) || runningStates.has(targetStatus)),
      failed,
      preview,
    };
    return { ...edge, type: "studio", animated: false, data: { ...edge.data, studio },
      className: [edge.className, related && "edge-connected-to-selection"].filter(Boolean).join(" ") };
  });
}

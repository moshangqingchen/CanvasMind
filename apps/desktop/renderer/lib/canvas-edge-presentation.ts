import type { CanvasEdge, CanvasNode } from "../components/types";

export interface StudioEdgeState {
  related: boolean;
  kind: "text" | "image" | "video" | "audio" | "asset" | "result";
  targetKind?: StudioEdgeState["kind"];
  running: boolean;
  failed: boolean;
  preview: boolean;
}

const runningStates = new Set(["submitting", "running", "polling", "downloading", "archiving"]);
const failedStates = new Set(["failed", "needs_attention"]);

/** Presentation is derived, never persisted into the saved graph or undo history. */
export function presentCanvasEdges(edges: CanvasEdge[], nodes: CanvasNode[], statuses: ReadonlyMap<string, string>): CanvasEdge[] {
  const selectedIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const targetStatus = statuses.get(edge.target) ?? target?.data.generatedStatus ?? target?.data.status ?? "";
    const related = selectedIds.has(edge.source) || selectedIds.has(edge.target);
    const failed = failedStates.has(targetStatus);
    const preview = Boolean(source?.data.directorDraft || target?.data.directorDraft);
    // React Flow uses the first port when an old edge omits its handle ID.
    // An explicit, unknown ID must not borrow another port's media color.
    const sourcePort = edge.sourceHandle == null ? source?.data.outputs?.[0]
      : source?.data.outputs?.find(port => port.id === edge.sourceHandle);
    const targetPort = edge.targetHandle == null ? target?.data.inputs?.[0]
      : target?.data.inputs?.find(port => port.id === edge.targetHandle);
    const portKind = (sourcePort?.kind ?? targetPort?.kind ?? "text").replace(/\[\]$/u, "");
    const targetKind = (targetPort?.kind ?? sourcePort?.kind ?? "text").replace(/\[\]$/u, "");
    const studio: StudioEdgeState = {
      related,
      kind: ["image", "video", "audio", "asset", "result"].includes(portKind) ? portKind as StudioEdgeState["kind"] : "text",
      targetKind: ["image", "video", "audio", "asset", "result"].includes(targetKind) ? targetKind as StudioEdgeState["kind"] : "text",
      running: !preview && !failed && runningStates.has(targetStatus),
      failed,
      preview,
    };
    return { ...edge, type: "studio", animated: false, data: { ...edge.data, studio },
      className: [edge.className, related && "edge-connected-to-selection"].filter(Boolean).join(" ") };
  });
}

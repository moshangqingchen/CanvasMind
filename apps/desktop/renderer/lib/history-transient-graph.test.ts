import { describe, expect, it } from "vitest";
import type { CanvasDocument, CanvasNode } from "../components/types";
import { restoreHistoryWithTransientNodes } from "./history-transient-graph";

const node = (id: string, data: Partial<CanvasNode["data"]> = {}): CanvasNode => ({
  id, type: "workflow", position: { x: 80, y: 160 }, data: { label: id, nodeType: "asset-input", ...data },
});
const graph = (nodes: CanvasNode[], edges: CanvasDocument["edges"] = []): CanvasDocument => ({ schemaVersion: 1, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } });

describe("undo snapshots and asynchronous UI work", () => {
  it("restores regular edits while retaining the live import identity, position and preview", () => {
    const pending = node("upload", { pendingImport: true, pendingPreviewUrl: "blob:live" });
    const restored = restoreHistoryWithTransientNodes(graph([node("before")]), graph([node("after"), pending]));
    expect(restored.nodes.map(item => item.id)).toEqual(["before", "upload"]);
    expect(restored.nodes[1]).toBe(pending);
  });
  it("retains live agent drafts and their edges for later validation", () => {
    const draft = node("draft", { directorDraft: true });
    const edge = { id: "draft-edge", source: "before", target: "draft" };
    const restored = restoreHistoryWithTransientNodes(graph([node("before")]), graph([draft], [edge]));
    expect(restored.nodes[1]).toBe(draft);
    expect(restored.edges).toEqual([edge]);
  });
  it("never resurrects a deleted placeholder or an expired preview from an old snapshot", () => {
    expect(restoreHistoryWithTransientNodes(graph([node("deleted", { pendingImport: true })]), graph([])).nodes).toEqual([]);
  });
  it("ordinary completed imports remain undoable and redoable", () => {
    expect(restoreHistoryWithTransientNodes(graph([]), graph([node("completed", { assetId: "asset" })])).nodes).toEqual([]);
    expect(restoreHistoryWithTransientNodes(graph([node("completed", { assetId: "asset" })]), graph([])).nodes[0]?.data.assetId).toBe("asset");
  });
});

import { describe, expect, it } from "vitest";
import { canvasDraftRecovery, draftAfterAcknowledgement, type CanvasDraft } from "./canvas-drafts";

const graph = { schemaVersion: 1, nodes: [], edges: [] };
const draft: CanvasDraft = { canvasId: "a", title: "草稿", graph, baseRevision: 4, version: 2 };

describe("canvas draft recovery", () => {
  it("recovers an unsaved draft only against the same server revision", () => {
    expect(canvasDraftRecovery(draft, { title: "原稿", graph, revision: 4 })).toBe("recover");
    expect(canvasDraftRecovery(draft, { title: "原稿", graph, revision: 5 })).toBe("conflict");
  });
  it("recognizes a successful save whose response was lost", () => {
    expect(canvasDraftRecovery(draft, { title: draft.title, graph, revision: 5 })).toBe("already-saved");
  });
  it("ignores object key order changed by server validation, including nested objects", () => {
    const local = { schemaVersion: 1, nodes: [], edges: [], viewport: { x: 1, y: 2, zoom: 0.85 } };
    const server = { viewport: { zoom: 0.85, y: 2, x: 1 }, edges: [], nodes: [], schemaVersion: 1 };
    expect(canvasDraftRecovery({ ...draft, graph: local }, { title: draft.title, graph: server, revision: 5 })).toBe("already-saved");
  });
  it("preserves array order when comparing graph values", () => {
    const drawing = { id: "stroke", color: "#ffffff", width: 2, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
    const local = { ...graph, drawings: [drawing] };
    const server = { ...graph, drawings: [{ ...drawing, points: [...drawing.points].reverse() }] };
    expect(canvasDraftRecovery({ ...draft, graph: local }, { title: draft.title, graph: server, revision: 5 })).toBe("conflict");
  });
  it("treats omitted optional object fields as their JSON representation", () => {
    expect(canvasDraftRecovery({ ...draft, graph: { ...graph, viewport: undefined } }, { title: draft.title, graph, revision: 5 })).toBe("already-saved");
  });
  it("preserves edits made during an in-flight save and advances their base revision", () => {
    expect(draftAfterAcknowledgement(draft, 1, 5)).toEqual({ ...draft, baseRevision: 5 });
    expect(draftAfterAcknowledgement(draft, 2, 5)).toBeUndefined();
    expect(draft.baseRevision).toBe(4);
  });
});

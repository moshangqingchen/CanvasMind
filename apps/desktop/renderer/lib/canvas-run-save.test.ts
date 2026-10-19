import { describe, expect, it, vi } from "vitest";
import { runFingerprint, type WorkflowGraph } from "@super-canvas/core";
import { canvasChangedBeforeRunMessage, isUnacceptedRunResult, saveCanvasForRun } from "./canvas-run-save";
import { LatestTaskQueue } from "./latest-task-queue";

const selection = { scope: "node", nodeId: "generate" } as const;
const graph = (prompt: string): WorkflowGraph => ({
  nodes: [{ id: "generate", type: "workflow", data: { nodeType: "image-generation", parts: [{ type: "text", text: prompt }] } }], edges: [],
});
interface Saved { revision: number; graph: WorkflowGraph }

describe("the saved canvas used for a run", () => {
  it("keeps provisional result cards out of all-run saves without losing accepted or uncertain results", () => {
    const p1 = graph("P1");
    const pending = { id: "pending-click", type: "workflow", data: {
      nodeType: "asset-input", generatedResult: true, generatedStatus: "queued", generatedPendingRequestId: "click",
      generatedFromNodeId: "generate",
    } };
    expect(isUnacceptedRunResult(pending)).toBe(true);
    const store = { ...p1, nodes: [...p1.nodes, pending] };
    const persisted = { ...store, nodes: store.nodes.filter(node => !isUnacceptedRunResult(node)) };
    expect(runFingerprint(persisted, { scope: "all" })).toBe(runFingerprint(p1, { scope: "all" }));
    for (const patch of [{ generatedFromRunId: "accepted" }, { assetId: "original" }, { generatedStatus: "needs_attention" }]) {
      expect(isUnacceptedRunResult({ ...pending, data: { ...pending.data, ...patch } })).toBe(false);
    }
  });

  it("does not submit when a newer queued save replaces the click's request content", async () => {
    let releasePrevious!: () => void;
    const previousGate = new Promise<void>(resolve => { releasePrevious = resolve; });
    let revision = 1;
    const savedGraphs: WorkflowGraph[] = [];
    const queue = new LatestTaskQueue<WorkflowGraph, Saved>(async value => {
      if (savedGraphs.length === 0) await previousGate;
      savedGraphs.push(value);
      return { revision: ++revision, graph: value };
    });
    const submit = vi.fn();
    const p1 = graph("P1"), p2 = graph("P2");
    const previous = queue.enqueue(graph("previous"));
    const run = saveCanvasForRun(() => queue.enqueue(p1), selection, runFingerprint(p1, selection)).then(submit);
    const later = queue.enqueue(p2);
    const rejection = expect(run).rejects.toThrow(canvasChangedBeforeRunMessage);
    releasePrevious();
    await Promise.all([previous, later, rejection]);
    expect(savedGraphs).toEqual([graph("previous"), p2]);
    expect(submit).not.toHaveBeenCalled();
  });

  it("accepts a coalesced save that only changed presentation and returns that actual revision", async () => {
    let releasePrevious!: () => void;
    const gate = new Promise<void>(resolve => { releasePrevious = resolve; });
    let revision = 1;
    const queue = new LatestTaskQueue<WorkflowGraph, Saved>(async value => {
      if (revision === 1) await gate;
      return { revision: ++revision, graph: value };
    });
    const p1 = graph("P1");
    const moved = { ...p1, viewport: { x: 300, y: 200, zoom: 0.5 },
      nodes: p1.nodes.map(node => ({ ...node, position: { x: 600, y: 800 }, selected: true })) };
    const previous = queue.enqueue(graph("previous"));
    const run = saveCanvasForRun(() => queue.enqueue(p1), selection, runFingerprint(p1, selection));
    const later = queue.enqueue(moved);
    releasePrevious();
    const [, expectedRevision, saved] = await Promise.all([previous, run, later]);
    expect(expectedRevision).toBe(saved.revision);
    expect(saved.graph).toEqual(moved);
    expect(expectedRevision).toBe(3);
  });

  it("keeps P1's own result even after P2 advances the shared revision", async () => {
    let releaseClick!: () => void;
    const gate = new Promise<void>(resolve => { releaseClick = resolve; });
    let sharedRevision = 7;
    const p1 = graph("P1");
    const queue = new LatestTaskQueue<WorkflowGraph, Saved>(async value => {
      if (value === p1) await gate;
      return { revision: ++sharedRevision, graph: value };
    });
    const clicked = saveCanvasForRun(() => queue.enqueue(p1), selection, runFingerprint(p1, selection));
    const later = queue.enqueue(graph("P2"));
    releaseClick();
    const [expectedRevision] = await Promise.all([clicked, later]);
    expect(sharedRevision).toBe(9);
    expect(expectedRevision).toBe(8);
  });

  it("fails closed if saving was suspended or returned an invalid graph", async () => {
    for (const saved of [undefined, { revision: 4, graph: {} }]) {
      await expect(saveCanvasForRun(async () => saved, selection, runFingerprint(graph("P1"), selection)))
        .rejects.toThrow(canvasChangedBeforeRunMessage);
    }
  });
});

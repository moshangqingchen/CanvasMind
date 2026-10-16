import { describe, expect, it } from "vitest";
import type { CanvasNode, RunSnapshot } from "../components/types";
import { collectIslandTasks, islandCanvasBounds, islandElapsed, islandTaskTransition, type IslandTask } from "./dynamic-island";
import { canvasUsableArea } from "./canvas-usable-area";

function node(id: string, data: Partial<CanvasNode["data"]> = {}): CanvasNode {
  return { id, type: "workflow", position: { x: 0, y: 0 }, data: { label: id, ...data } };
}
const since = "2026-10-15T12:00:00.000Z";
const task = (status: string, id = "one"): IslandTask => ({ id, nodeId: id, title: id, status, startedAt: since });

describe("dynamic island task presentation", () => {
  it("keeps the same fit area when transient task feedback expands and ignores hidden islands", () => {
    const canvas = { left: 0, right: 1366, top: 0, bottom: 768 };
    const collapsed = { left: 558, right: 808, top: 12, bottom: 56 };
    const expanded = { left: 503, right: 863, top: 12, bottom: 240 };
    expect(canvasUsableArea(canvas, [islandCanvasBounds(expanded)])).toEqual(canvasUsableArea(canvas, [islandCanvasBounds(collapsed)]));
    expect(islandCanvasBounds({ left: 0, right: 0, top: 0, bottom: 0 })).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
  it("groups multiple result cards from the same run and source into one real task", () => {
    const nodes = [node("source", { label: "主视觉" }), node("output-a", { generatedResult: true, generatedFromNodeId: "source", generatedFromRunId: "run-a", generatedStatus: "succeeded", generatedCreatedAt: since }), node("output-b", { generatedResult: true, generatedFromNodeId: "source", generatedFromRunId: "run-a", generatedStatus: "archiving", generatedCreatedAt: since })];
    const tasks = collectIslandTasks(nodes, new Map([["source", "archiving"]]), new Map([["source", { startedAt: since }]]), new Map());
    expect(tasks).toEqual([{ id: "run-a:source", nodeId: "output-b", title: "主视觉", status: "archiving", startedAt: since }]);
    expect(tasks[0]).not.toHaveProperty("progress");
  });

  it("uses the reconciled task status without retaining its request or response", () => {
    const snapshot: RunSnapshot = { run: { id: "run-a", status: "failed", canvasId: "canvas", scope: "node", createdAt: since }, nodes: [{ id: "run-node", nodeId: "source", status: "failed", outputAssetIds: [], request: { model: "private-model" }, errorJson: { message: "测试错误" } }] };
    const tasks = collectIslandTasks([node("output", { generatedResult: true, generatedFromNodeId: "source", generatedFromRunId: "run-a", generatedStatus: "running" })], new Map(), new Map(), new Map([["run-a", snapshot]]));
    expect(tasks[0]?.status).toBe("failed");
    expect(JSON.stringify(tasks)).not.toContain("private-model");
    expect(JSON.stringify(tasks)).not.toContain("测试错误");
  });

  it("includes a new source submission beside an older completed output and ignores hidden outputs", () => {
    const old = "2026-10-14T12:00:00.000Z";
    const hidden = { ...node("hidden", { generatedResult: true, generatedStatus: "failed" }), hidden: true };
    const tasks = collectIslandTasks([node("source", { nodeType: "image-generation" }), node("old", { generatedResult: true, generatedFromNodeId: "source", generatedFromRunId: "old-run", generatedStatus: "succeeded", generatedCreatedAt: old }), hidden], new Map([["source", "submitting"]]), new Map([["source", { startedAt: since }]]), new Map());
    expect(tasks.map(item => item.status)).toEqual(["succeeded", "submitting"]);
    expect(tasks.map(item => item.nodeId)).not.toContain("hidden");
  });

  it("does not surface unrelated historical snapshots that have no nodes in this canvas", () => {
    const unrelated: RunSnapshot = { run: { id: "historical", status: "failed", canvasId: "canvas", scope: "all", createdAt: since }, nodes: [] };
    expect(collectIslandTasks([], new Map(), new Map(), new Map([["historical", unrelated]]))).toEqual([]);
  });

  it("detects real start and completion transitions and does not announce historical success as a completion", () => {
    expect(islandTaskTransition([], [task("succeeded")])).toEqual({ started: false, completed: false });
    expect(islandTaskTransition([], [task("queued")])).toEqual({ started: true, completed: false });
    expect(islandTaskTransition([task("queued")], [task("running")])).toEqual({ started: false, completed: false });
    expect(islandTaskTransition([task("running")], [task("succeeded")])).toEqual({ started: false, completed: true });
    expect(islandTaskTransition([task("running")], [task("failed")])).toEqual({ started: false, completed: false });
  });

  it("times only active real tasks, clamps clock skew, and leaves missing timestamps blank", () => {
    expect(islandElapsed([task("running"), { ...task("failed", "old"), startedAt: "2020-01-01" }], Date.parse(since) + 42000)).toBe("0:42");
    expect(islandElapsed([task("queued")], Date.parse(since) - 1000)).toBe("0:00");
    expect(islandElapsed([{ ...task("running"), startedAt: "invalid" }], Date.now())).toBeUndefined();
    expect(islandElapsed([task("succeeded")], Date.now())).toBeUndefined();
  });
});

import { describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { RunService } from "../src/service.js";
const graph = (prompt: string) => ({
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    {
      id: "prompt",
      type: "workflow",
      data: {
        nodeType: "prompt",
        parts: [{ type: "text", text: prompt }],
        outputs: [{ id: "prompt", kind: "text" }],
      },
    },
    {
      id: "generate",
      type: "workflow",
      data: {
        nodeType: "image-generation",
        provider: "fake",
        connectionId: "fake-default",
        inputs: [{ id: "prompt", kind: "text", required: true }],
        outputs: [{ id: "images", kind: "image" }],
      },
    },
  ],
  edges: [
    {
      id: "p-g",
      source: "prompt",
      sourceHandle: "prompt",
      target: "generate",
      targetHandle: "prompt",
    },
  ],
});
async function fixture() {
  const repository = new MemoryRepository();
  await repository.saveCanvas({
    id: "canvas",
    title: "Snapshot",
    graph: graph("approved prompt"),
  });
  const enqueue = vi.fn(async () => {});
  const service = new RunService({
    repository,
    storage: { put: async () => {}, get: async () => null },
    executionMode: "queue",
    enqueueRun: enqueue,
  });
  return { repository, service, enqueue };
}
describe("prepared execution snapshots", () => {
  it("rejects missing upstream results before any run is created", async () => {
    const { repository, service, enqueue } = await fixture();
    const missing = graph("unused");
    missing.nodes[0].data = { ...missing.nodes[0].data, nodeType: "image-generation" };
    await repository.saveCanvas({ id: "canvas", title: "Missing", graph: missing });
    await expect(service.prepareRun({ canvasId: "canvas", scope: "selection", nodeIds: ["generate"] })).rejects.toThrow("没有可用成果");
    expect(enqueue).not.toHaveBeenCalled();
    expect(await repository.listRuns("canvas")).toHaveLength(0);
  });
  it("prepares without creating or enqueueing a run", async () => {
    const { service, repository, enqueue } = await fixture();
    const p = await service.prepareRun({
      canvasId: "canvas",
      scope: "selection",
      nodeIds: ["generate"],
    });
    expect(p.nodeIds).toEqual(["generate"]);
    expect(await repository.listRuns("canvas")).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(
      JSON.stringify(p.revisionGraph.__preparedHistoricalInputs),
    ).toContain("approved prompt");
  });
  it("executes the exact prepared graph and upstream prompt without re-reading the canvas", async () => {
    const { service, repository } = await fixture();
    const p = await service.prepareRun({
      canvasId: "canvas",
      scope: "selection",
      nodeIds: ["generate"],
    });
    await repository.saveCanvas({
      id: "canvas",
      title: "Modified",
      graph: graph("unapproved prompt"),
    });
    const read = vi.spyOn(repository, "getCanvas");
    const run = await service.createRunFromPrepared(p, "approval-one");
    expect(read).not.toHaveBeenCalled();
    expect(JSON.stringify(run.revisionGraph)).toContain("approved prompt");
    const nodes = await repository.listNodeRuns(run.id);
    expect(JSON.stringify(nodes[0].inputJson.historicalInputs)).toContain(
      "approved prompt",
    );
    expect(JSON.stringify(nodes[0].inputJson.historicalInputs)).not.toContain(
      "unapproved prompt",
    );
  });
  it("recovers missing node runs using saved historical inputs and remains idempotent", async () => {
    const { service, repository } = await fixture();
    const p = await service.prepareRun({
      canvasId: "canvas",
      scope: "selection",
      nodeIds: ["generate"],
    });
    await repository.createRun({
      id: "interrupted",
      canvasId: "canvas",
      clientRequestId: "approval-two",
      scope: "selection",
      nodeIds: p.nodeIds,
      status: "queued",
      revisionGraph: p.revisionGraph,
    });
    await repository.saveCanvas({
      id: "canvas",
      title: "New",
      graph: graph("new prompt"),
    });
    const first = await service.createRunFromPrepared(p, "approval-two");
    const second = await service.createRunFromPrepared(p, "approval-two");
    expect(first.id).toBe(second.id);
    expect(await repository.listRuns("canvas")).toHaveLength(1);
    const nodes = await repository.listNodeRuns(first.id);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].inputJson.paidRetryPolicy).toBe("approval-required");
    expect(JSON.stringify(nodes[0].inputJson.historicalInputs)).toContain(
      "approved prompt",
    );
  });
});

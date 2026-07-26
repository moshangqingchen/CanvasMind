import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/memory.js";

describe("MemoryRepository", () => {
  it("stores immutable canvas revisions", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const graph = { schemaVersion: 1, nodes: [{ id: "prompt-1" }], edges: [] };

    const saved = await repository.saveCanvas({
      id: canvas.id,
      graph,
      reason: "run",
    });
    graph.nodes[0]!.id = "mutated-after-save";

    expect(saved.revision).toBe(1);
    expect((saved.graph.nodes as Array<{ id: string }>)[0]?.id).toBe(
      "prompt-1",
    );
    const revisions = await repository.listRevisions(canvas.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.reason).toBe("run");
  });

  it("looks up idempotent runs by canvas and client request id", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.createRun({
      id: "run-1",
      canvasId: canvas.id,
      clientRequestId: "request-1",
      scope: "all",
      status: "queued",
      revisionGraph: {},
    });

    await expect(
      repository.getRunByClientRequest(canvas.id, "request-1"),
    ).resolves.toMatchObject({ id: "run-1", status: "queued" });
    await expect(
      repository.getRunByClientRequest("another-canvas", "request-1"),
    ).resolves.toBeNull();
  });

  it("creates runs and node runs idempotently under their unique keys", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const first = await repository.createRun({
      id: "run-first",
      canvasId: canvas.id,
      clientRequestId: "same-request",
      scope: "all",
      status: "queued",
      revisionGraph: { version: "first" },
    });
    const duplicate = await repository.createRun({
      id: "run-second",
      canvasId: canvas.id,
      clientRequestId: "same-request",
      scope: "node",
      nodeId: "different-node",
      status: "queued",
      revisionGraph: { version: "second" },
    });
    expect(duplicate).toEqual(first);

    const firstNode = await repository.createNodeRun({
      id: "node-first",
      workflowRunId: first.id,
      nodeId: "image",
      status: "queued",
      attempt: 0,
      providerTaskId: null,
      inputJson: {},
      outputAssetIds: [],
      errorJson: null,
    });
    const duplicateNode = await repository.createNodeRun({
      ...firstNode,
      id: "node-second",
      status: "running",
      attempt: 2,
    });
    expect(duplicateNode).toEqual(firstNode);
    await expect(repository.listNodeRuns(first.id)).resolves.toHaveLength(1);
  });

  it("transitions runs conditionally and finds the latest successful node output", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    for (const [runId, assetId] of [
      ["older-run", "older-asset"],
      ["newer-run", "newer-asset"],
    ] as const) {
      await repository.createRun({
        id: runId,
        canvasId: canvas.id,
        clientRequestId: runId,
        scope: "node",
        nodeId: "image",
        status: "running",
        revisionGraph: {},
      });
      const nodeRun = await repository.createNodeRun({
        id: `${runId}-node`,
        workflowRunId: runId,
        nodeId: "image",
        status: "succeeded",
        attempt: 1,
        providerTaskId: null,
        inputJson: {},
        outputAssetIds: [assetId],
        errorJson: null,
      });
      await repository.updateNodeRun(nodeRun.id, { status: "succeeded" });
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    await expect(
      repository.findLatestSucceededNodeRun(canvas.id, "image"),
    ).resolves.toMatchObject({ outputAssetIds: ["newer-asset"] });
    await expect(
      repository.transitionRunStatus("newer-run", ["queued"], "cancelled"),
    ).resolves.toBeNull();
    await expect(
      repository.transitionRunStatus("newer-run", ["running"], "cancelled"),
    ).resolves.toMatchObject({ status: "cancelled" });
    await expect(
      repository.updateRun("newer-run", { status: "succeeded" }),
    ).resolves.toMatchObject({ status: "cancelled" });
  });

  it("deduplicates provider webhook events", async () => {
    const repository = new MemoryRepository();
    const event = {
      id: "event-1",
      provider: "runway",
      externalId: "task-1:succeeded",
      payload: { status: "SUCCEEDED" },
      createdAt: new Date().toISOString(),
    };

    await expect(repository.saveWebhookEvent(event)).resolves.toBe(true);
    await expect(
      repository.saveWebhookEvent({ ...event, id: "event-2" }),
    ).resolves.toBe(false);
    await expect(
      repository.saveWebhookEvent({
        ...event,
        id: "event-3",
        connectionId: "connection-b",
      }),
    ).resolves.toBe(true);
  });

  it("guards node-run updates with optimistic status checks", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const run = await repository.createRun({
      id: "cas-run",
      canvasId: canvas.id,
      clientRequestId: "cas-request",
      scope: "node",
      nodeId: "image",
      status: "running",
      revisionGraph: {},
    });
    const node = await repository.createNodeRun({
      id: "cas-node",
      workflowRunId: run.id,
      nodeId: "image",
      status: "running",
      attempt: 1,
      providerTaskId: "provider-task",
      inputJson: { connectionId: "connection-a" },
      outputAssetIds: [],
      errorJson: null,
    });
    await expect(
      repository.updateNodeRun(
        node.id,
        { status: "succeeded", outputAssetIds: ["asset-a"] },
        { expectedStatus: "queued" },
      ),
    ).resolves.toBeNull();
    await expect(repository.getNodeRun(node.id)).resolves.toMatchObject({
      status: "running",
      outputAssetIds: [],
    });
    await expect(
      repository.updateNodeRun(
        node.id,
        { status: "succeeded", outputAssetIds: ["asset-a"] },
        { expectedStatus: "running" },
      ),
    ).resolves.toMatchObject({ status: "succeeded" });
  });

  it("does not let late provider updates revive a cancellation request", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const run = await repository.createRun({
      id: "cancel-cas-run",
      canvasId: canvas.id,
      clientRequestId: "cancel-cas-request",
      scope: "node",
      nodeId: "image",
      status: "cancelled",
      revisionGraph: {},
    });
    const node = await repository.createNodeRun({
      id: "cancel-cas-node",
      workflowRunId: run.id,
      nodeId: "image",
      status: "cancel_requested",
      attempt: 1,
      providerTaskId: "provider-task",
      inputJson: {},
      outputAssetIds: [],
      errorJson: null,
    });

    await expect(
      repository.updateNodeRun(
        node.id,
        { status: "running", inputJson: { late: true } },
        { expectedStatus: "running" },
      ),
    ).resolves.toBeNull();
    await expect(
      repository.updateNodeRun(node.id, { status: "succeeded" }),
    ).resolves.toBeNull();
    await expect(repository.getNodeRun(node.id)).resolves.toMatchObject({
      status: "cancel_requested",
      inputJson: {},
    });
    await expect(
      repository.updateNodeRun(
        node.id,
        { status: "cancelled" },
        { expectedStatus: "cancel_requested" },
      ),
    ).resolves.toMatchObject({ status: "cancelled" });
  });

  it("scopes provider task lookup to a connection when requested", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const run = await repository.createRun({
      id: "task-scope-run",
      canvasId: canvas.id,
      clientRequestId: "task-scope-request",
      scope: "all",
      status: "running",
      revisionGraph: {},
    });
    for (const [id, connectionId] of [
      ["task-node-a", "connection-a"],
      ["task-node-b", "connection-b"],
    ] as const) {
      await repository.createNodeRun({
        id,
        workflowRunId: run.id,
        nodeId: id,
        status: "running",
        attempt: 1,
        providerTaskId: "same-task-id",
        inputJson: { connectionId },
        outputAssetIds: [],
        errorJson: null,
      });
    }
    await expect(
      repository.findNodeRunByProviderTaskId("same-task-id", "connection-b"),
    ).resolves.toMatchObject({ id: "task-node-b" });
  });
});

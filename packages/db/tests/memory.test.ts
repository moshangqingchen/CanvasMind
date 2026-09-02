import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/memory.js";
import { CanvasRevisionConflictError } from "../src/types.js";

describe("MemoryRepository", () => {
  it("deletes a canvas and all canvas-scoped records", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: { saved: true } });
    await repository.createDirectorSession({
      id: "session-delete",
      canvasId: canvas.id,
      profileId: null,
      title: "待删除对话",
      metadata: {},
    });
    await repository.createDirectorMessage({
      id: "message-delete",
      sessionId: "session-delete",
      role: "user",
      content: "删除",
      metadata: {},
    });
    await repository.createRun({
      id: "run-delete",
      canvasId: canvas.id,
      clientRequestId: "request-delete",
      scope: "all",
      status: "succeeded",
      revisionGraph: {},
    });
    await repository.createNodeRun({
      id: "node-run-delete",
      workflowRunId: "run-delete",
      nodeId: "node-delete",
      status: "succeeded",
      attempt: 1,
      providerTaskId: null,
      inputJson: {},
      outputAssetIds: [],
      errorJson: null,
    });

    await repository.deleteCanvas(canvas.id);

    await expect(repository.getCanvas(canvas.id)).resolves.toBeNull();
    await expect(repository.listRevisions(canvas.id)).resolves.toEqual([]);
    await expect(repository.getDirectorSession("session-delete")).resolves.toBeNull();
    await expect(repository.getDirectorMessage("message-delete")).resolves.toBeNull();
    await expect(repository.getRun("run-delete")).resolves.toBeNull();
    await expect(repository.getNodeRun("node-run-delete")).resolves.toBeNull();
  });

  it("atomically rejects a stale canvas revision without changing state", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();

    const attempts = await Promise.allSettled([
      repository.saveCanvas({
        id: canvas.id,
        graph: { version: "first" },
        expectedRevision: canvas.revision,
      }),
      repository.saveCanvas({
        id: canvas.id,
        graph: { version: "stale" },
        expectedRevision: canvas.revision,
      }),
    ]);

    expect(attempts.map((attempt) => attempt.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(attempts[1]).toMatchObject({
      reason: expect.any(CanvasRevisionConflictError),
    });
    const conflict = (attempts[1] as PromiseRejectedResult).reason;
    expect(conflict).toMatchObject({
      code: "CANVAS_REVISION_CONFLICT",
      expectedRevision: 0,
      currentRevision: 1,
    });
    await expect(repository.getCanvas(canvas.id)).resolves.toMatchObject({
      revision: 1,
      graph: { version: "first" },
    });
    await expect(repository.listRevisions(canvas.id)).resolves.toHaveLength(1);
  });

  it("keeps legacy unguarded canvas saves compatible", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();

    await repository.saveCanvas({ id: canvas.id, graph: { version: 1 } });
    await expect(
      repository.saveCanvas({ id: canvas.id, graph: { version: 2 } }),
    ).resolves.toMatchObject({ revision: 2, graph: { version: 2 } });
  });

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

  it("persists director conversations and guards proposal transitions", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveConnection({
      id: "brain-connection",
      name: "Director brain",
      provider: "openai",
      encryptedSecret: "encrypted",
      config: {},
    });
    await repository.saveDirectorProfile({
      id: "default",
      brainConnectionId: "brain-connection",
      brainModelId: "gpt-director",
      researchConnectionId: null,
      config: { maxSearchCalls: 3 },
    });
    await repository.createDirectorSession({
      id: "session-1",
      canvasId: canvas.id,
      profileId: "default",
      title: "Launch film",
      metadata: {},
    });
    const message = await repository.createDirectorMessage({
      id: "message-1",
      sessionId: "session-1",
      role: "user",
      content: "Create a launch film",
      metadata: { attachments: [] },
    });
    const proposal = await repository.createDirectorProposal({
      id: "proposal-1",
      sessionId: "session-1",
      canvasId: canvas.id,
      version: 1,
      status: "awaiting_approval",
      baseCanvasRevision: canvas.revision,
      plan: { nodes: ["image"] },
      quote: { currency: "CNY", maximum: 2 },
      knowledgeVersion: "knowledge-1",
      catalogFingerprint: "catalog-1",
      expiresAt: "2026-08-30T12:15:00.000Z",
      workflowRunId: null,
    });

    message.metadata.attachments = ["mutated"];
    proposal.plan.nodes = ["mutated"];
    await expect(repository.listDirectorMessages("session-1")).resolves.toEqual(
      [
        expect.objectContaining({
          id: "message-1",
          metadata: { attachments: [] },
        }),
      ],
    );
    await expect(
      repository.getDirectorProposal("proposal-1"),
    ).resolves.toMatchObject({
      plan: { nodes: ["image"] },
    });
    await expect(
      repository.updateDirectorProposal(
        "proposal-1",
        { status: "approved" },
        { expectedVersion: 2, expectedStatuses: ["awaiting_approval"] },
      ),
    ).resolves.toBeNull();
    await expect(
      repository.updateDirectorProposal(
        "proposal-1",
        { status: "approved" },
        { expectedVersion: 1, expectedStatuses: ["awaiting_approval"] },
      ),
    ).resolves.toMatchObject({ status: "approved", version: 1 });

    await repository.deleteDirectorSession("session-1");
    await expect(
      repository.getDirectorMessage("message-1"),
    ).resolves.toBeNull();
    await expect(
      repository.getDirectorProposal("proposal-1"),
    ).resolves.toBeNull();
  });

  it("upgrades version 1 snapshots and preserves selection node ids", async () => {
    const repository = new MemoryRepository({
      version: 1,
      canvases: [],
      revisions: [],
      assets: [],
      connections: [],
      runs: [],
      nodeRuns: [],
      webhookKeys: [],
    });
    const canvas = await repository.ensureDefaultCanvas();
    const run = await repository.createRun({
      id: "selection-run",
      canvasId: canvas.id,
      clientRequestId: "selection-request",
      scope: "selection",
      nodeIds: ["image-b", "image-a"],
      status: "queued",
      revisionGraph: {},
    });
    run.nodeIds?.push("mutated");

    expect(repository.exportSnapshot()).toMatchObject({
      version: 2,
      directorProfiles: [],
      directorSessions: [],
      directorMessages: [],
      directorProposals: [],
    });
    await expect(repository.getRun("selection-run")).resolves.toMatchObject({
      scope: "selection",
      nodeIds: ["image-b", "image-a"],
    });
  });
});

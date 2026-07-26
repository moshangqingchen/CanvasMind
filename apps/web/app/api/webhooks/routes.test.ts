import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const repository = {
    getConnection: vi.fn(),
    saveWebhookEvent: vi.fn(),
    findNodeRunByProviderTaskId: vi.fn(),
    getRun: vi.fn(),
    updateNodeRun: vi.fn(),
    transitionRunStatus: vi.fn(),
  };
  const verifyWebhook = vi.fn();
  const runService = {
    adapters: vi.fn(() => new Map([["rest", { verifyWebhook }]])),
    reconcileCancellation: vi.fn(),
    resumeRun: vi.fn(),
  };
  return { repository, runService, verifyWebhook };
});

vi.mock("../../../lib/server", () => ({
  repository: mocks.repository,
  runService: mocks.runService,
  jsonError(message: string, status = 400) {
    return Response.json({ error: message }, { status });
  },
}));

import { POST } from "./[provider]/[connectionId]/route";

const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;

function request() {
  return new Request("http://localhost/api/webhooks/rest/connection-1", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-id": "event-1",
    },
    body: JSON.stringify({ id: "task-1", status: "succeeded" }),
  });
}

const context = {
  params: Promise.resolve({ provider: "rest", connectionId: "connection-1" }),
};

const nodeRun = {
  id: "node-run-1",
  workflowRunId: "run-1",
  nodeId: "image-1",
  status: "running",
  attempt: 1,
  providerTaskId: "task-1",
  inputJson: { connectionId: "connection-1" },
  outputAssetIds: [],
  errorJson: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PUBLIC_BASE_URL = "https://canvas.example.test";
  mocks.repository.getConnection.mockResolvedValue({
    id: "connection-1",
    provider: "rest",
  });
  mocks.repository.saveWebhookEvent.mockResolvedValue(true);
  mocks.repository.findNodeRunByProviderTaskId.mockResolvedValue(nodeRun);
  mocks.repository.getRun.mockResolvedValue({ id: "run-1", status: "running" });
  mocks.verifyWebhook.mockResolvedValue({
    providerTaskId: "task-1",
    status: "succeeded",
  });
  mocks.repository.updateNodeRun.mockImplementation(
    async (_id: string, patch: Record<string, unknown>) => ({
      ...nodeRun,
      ...patch,
    }),
  );
  mocks.repository.transitionRunStatus.mockResolvedValue({
    id: "run-1",
    status: "running",
  });
  mocks.runService.reconcileCancellation.mockResolvedValue(undefined);
  mocks.runService.resumeRun.mockResolvedValue(undefined);
});

afterAll(() => {
  if (originalPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
});

describe("provider webhook route", () => {
  it("ignores a late success after cancellation and schedules reconciliation", async () => {
    mocks.repository.findNodeRunByProviderTaskId.mockResolvedValue({
      ...nodeRun,
      status: "cancel_requested",
    });
    mocks.repository.getRun.mockResolvedValue({
      id: "run-1",
      status: "cancelled",
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      ignored: true,
    });
    expect(mocks.repository.updateNodeRun).not.toHaveBeenCalled();
    expect(mocks.runService.reconcileCancellation).toHaveBeenCalledWith(
      "run-1",
    );
  });

  it("uses optimistic concurrency before resuming a successful task", async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.repository.updateNodeRun).toHaveBeenCalledWith(
      nodeRun.id,
      expect.objectContaining({
        status: "archiving",
        providerTaskId: "task-1",
      }),
      { expectedUpdatedAt: nodeRun.updatedAt },
    );
    expect(mocks.repository.transitionRunStatus).toHaveBeenCalledWith(
      "run-1",
      ["queued", "running", "needs_attention"],
      "running",
    );
    expect(mocks.runService.resumeRun).toHaveBeenCalledWith("run-1");
  });

  it("does not resume when another executor wins the node update", async () => {
    mocks.repository.updateNodeRun.mockResolvedValue(null);

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.repository.transitionRunStatus).not.toHaveBeenCalled();
    expect(mocks.runService.resumeRun).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    saveCanvas: vi.fn(),
    listConnections: vi.fn(),
  },
  runService: {
    repository: {
      listRuns: vi.fn(),
      listNodeRuns: vi.fn(),
    },
    createRun: vi.fn(),
    getRun: vi.fn(),
  },
  saveProviderConnection: vi.fn(),
}));

vi.mock("../../lib/server", () => ({
  repository: mocks.repository,
  runService: mocks.runService,
  saveProviderConnection: mocks.saveProviderConnection,
  maskConnection: vi.fn((value: unknown) => value),
  safeJsonObject: vi.fn((value: unknown) => value),
  jsonError(message: string, status = 400) {
    return Response.json({ error: message }, { status });
  },
}));

import { POST as createCanvas } from "./canvas/route";
import { POST as saveProvider } from "./providers/route";
import { GET as listRuns, POST as createRun } from "./runs/route";

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function graph(): {
  schemaVersion: number;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  viewport: { x: number; y: number; zoom: number };
} {
  return {
    schemaVersion: 1,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("API route input validation", () => {
  it("returns 400 for an incomplete canvas document before persistence", async () => {
    const response = await createCanvas(
      jsonRequest("/api/canvas", {
        graph: { schemaVersion: 1, nodes: [], edges: [] },
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.repository.saveCanvas).not.toHaveBeenCalled();
  });

  it("returns 422 for a cyclic graph before persistence", async () => {
    const cyclic = graph();
    cyclic.nodes = [
      { id: "one", type: "workflow" },
      { id: "two", type: "workflow" },
    ];
    cyclic.edges = [
      { id: "forward", source: "one", target: "two" },
      { id: "back", source: "two", target: "one" },
    ];

    const response = await createCanvas(
      jsonRequest("/api/canvas", { graph: cyclic }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "画布图包含无效连接",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "cycle" }),
      ]),
    });
    expect(mocks.repository.saveCanvas).not.toHaveBeenCalled();
  });

  it("rejects extra run fields before scheduling work", async () => {
    const response = await createRun(
      jsonRequest("/api/runs", {
        canvasId: "canvas",
        clientRequestId: "request",
        scope: "all",
        retryPaidRequest: true,
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.runService.createRun).not.toHaveBeenCalled();
  });

  it("rejects duplicate run query parameters", async () => {
    const response = await listRuns(
      new Request("http://localhost/api/runs?canvasId=one&canvasId=two"),
    );

    expect(response.status).toBe(400);
    expect(mocks.runService.repository.listRuns).not.toHaveBeenCalled();
  });

  it("rejects plaintext credential headers before saving a connection", async () => {
    const response = await saveProvider(
      jsonRequest("/api/providers", {
        name: "Unsafe REST",
        provider: "rest",
        config: {
          connector: {
            submit: {
              headers: { Authorization: "Bearer plaintext" },
            },
          },
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.saveProviderConnection).not.toHaveBeenCalled();
  });
});

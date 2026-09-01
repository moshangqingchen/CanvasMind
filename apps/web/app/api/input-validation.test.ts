import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalLocalAppData = process.env.LOCALAPPDATA;

const mocks = vi.hoisted(() => ({
  repository: {
    saveCanvas: vi.fn(),
    listConnections: vi.fn(),
  },
  runService: {
    repository: {
      listRuns: vi.fn(),
      listNodeRuns: vi.fn(),
      getRun: vi.fn(),
      getRunByClientRequest: vi.fn(),
    },
    createRun: vi.fn(),
    getRun: vi.fn(),
  },
  saveProviderConnection: vi.fn(),
  publicRunSnapshot: vi.fn((value: unknown) => value),
}));

vi.mock("../../lib/server", () => ({
  repository: mocks.repository,
  runService: mocks.runService,
  saveProviderConnection: mocks.saveProviderConnection,
  maskConnection: vi.fn((value: unknown) => value),
  safeJsonObject: vi.fn((value: unknown) => value),
  publicRunSnapshot: mocks.publicRunSnapshot,
  jsonError(message: string, status = 400) {
    return Response.json({ error: message }, { status });
  },
}));

import { POST as createCanvas } from "./canvas/route";
import { GET as listProviders, POST as saveProvider } from "./providers/route";
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
  // The production hot-update manager may legitimately have a drain flag
  // while this suite runs. Keep ordinary route validation tests isolated from
  // that machine-wide state; the dedicated drain test sets its own temp path.
  delete process.env.LOCALAPPDATA;
});

afterEach(() => {
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = originalLocalAppData;
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

  it("lists saved connections without waiting for unrelated supplier sync", async () => {
    mocks.repository.listConnections.mockResolvedValue([]);

    const response = await listProviders();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
    expect(mocks.repository.listConnections).toHaveBeenCalledOnce();
  });

  it("creates a run without contacting unrelated supplier catalogs", async () => {
    mocks.runService.createRun.mockResolvedValue({ id: "run-1" });
    mocks.runService.getRun.mockResolvedValue({
      run: { id: "run-1", status: "queued" },
      nodes: [],
    });

    const response = await createRun(
      jsonRequest("/api/runs", {
        canvasId: "canvas",
        clientRequestId: "request",
        nodeId: "weai-node",
        scope: "node",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.runService.createRun).toHaveBeenCalledWith({
      canvasId: "canvas",
      clientRequestId: "request",
      nodeId: "weai-node",
      scope: "node",
    });
  });

  it("rejects new paid runs while the live service is draining", async () => {
    const localAppData = await mkdtemp(join(tmpdir(), "super-canvas-drain-"));
    const drainDirectory = join(localAppData, "SuperCanvas", "logs");
    await mkdir(drainDirectory, { recursive: true });
    await writeFile(join(drainDirectory, "web-3210-draining"), "draining");
    process.env.LOCALAPPDATA = localAppData;

    try {
      const response = await createRun(
        jsonRequest("/api/runs", {
          canvasId: "canvas",
          clientRequestId: "request",
          scope: "all",
        }),
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("5");
      expect(mocks.runService.createRun).not.toHaveBeenCalled();
    } finally {
      await rm(localAppData, { recursive: true, force: true });
    }
  });

  it("rejects duplicate run query parameters", async () => {
    const response = await listRuns(
      new Request("http://localhost/api/runs?canvasId=one&canvasId=two"),
    );

    expect(response.status).toBe(400);
    expect(mocks.runService.repository.listRuns).not.toHaveBeenCalled();
  });

  it("reads only visible runs during canvas status reconciliation", async () => {
    const run = {
      id: "visible-run",
      canvasId: "canvas",
      clientRequestId: "visible-request",
      status: "running",
    };
    mocks.runService.repository.getRun.mockResolvedValue(run);
    mocks.runService.repository.getRunByClientRequest.mockResolvedValue(run);
    mocks.runService.repository.listNodeRuns.mockResolvedValue([]);

    const response = await listRuns(
      new Request(
        "http://localhost/api/runs?canvasId=canvas&runIds=visible-run&clientRequestIds=visible-request",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.runService.repository.listRuns).not.toHaveBeenCalled();
    expect(mocks.runService.repository.getRun).toHaveBeenCalledWith(
      "visible-run",
    );
    expect(
      mocks.runService.repository.getRunByClientRequest,
    ).toHaveBeenCalledWith("canvas", "visible-request");
    expect(mocks.runService.repository.listNodeRuns).toHaveBeenCalledOnce();
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

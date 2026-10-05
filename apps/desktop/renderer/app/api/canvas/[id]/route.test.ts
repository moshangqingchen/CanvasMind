import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasRevisionConflictError } from "@super-canvas/db";

const mocks = vi.hoisted(() => ({
  repository: {
    getCanvas: vi.fn(),
    saveCanvas: vi.fn(),
    flush: vi.fn(),
  },
}));

vi.mock("../../../../lib/server", () => ({
  repository: mocks.repository,
  jsonError(message: string, status = 400) {
    return Response.json({ error: message }, { status });
  },
  safeJsonObject(value: unknown) {
    return value as Record<string, unknown>;
  },
}));

import { PUT } from "./route";

const graph = {
  schemaVersion: 1,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

function request(expectedRevision?: number) {
  return new Request("http://localhost/api/canvas/canvas-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ graph, expectedRevision }),
  });
}

const context = { params: Promise.resolve({ id: "canvas-1" }) };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PUT /api/canvas/[id]", () => {
  it("acknowledges a repeated save after its first response was lost without incrementing revision", async () => {
    const saved = { id: "canvas-1", title: "Canvas", graph: {
      viewport: { zoom: 1, y: 0, x: 0 }, edges: [], nodes: [], schemaVersion: 1,
    }, revision: 8 };
    mocks.repository.saveCanvas.mockRejectedValue(new CanvasRevisionConflictError(7, 8));
    mocks.repository.getCanvas.mockResolvedValue(saved);
    mocks.repository.flush.mockResolvedValue(undefined);

    const response = await PUT(request(7), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(saved);
    expect(mocks.repository.flush).toHaveBeenCalledOnce();
    expect(mocks.repository.saveCanvas).toHaveBeenCalledOnce();
  });

  it("never acknowledges a matching in-memory graph when the durability check fails", async () => {
    mocks.repository.saveCanvas.mockRejectedValue(new CanvasRevisionConflictError(7, 8));
    mocks.repository.getCanvas.mockResolvedValue({ id: "canvas-1", title: "Canvas", graph, revision: 8 });
    mocks.repository.flush.mockRejectedValue(new Error("disk full"));
    expect((await PUT(request(7), context)).status).toBe(500);
  });

  it("preserves a genuine conflict if the graph changes during the durability check", async () => {
    mocks.repository.saveCanvas.mockRejectedValue(new CanvasRevisionConflictError(7, 8));
    mocks.repository.getCanvas
      .mockResolvedValueOnce({ id: "canvas-1", title: "Canvas", graph, revision: 8 })
      .mockResolvedValueOnce({ id: "canvas-1", title: "Canvas", graph: { ...graph, viewport: { x: 20, y: 0, zoom: 1 } }, revision: 9 });
    const response = await PUT(request(7), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ currentRevision: 9 });
  });

  it("does not acknowledge a different title or a future expected revision", async () => {
    mocks.repository.saveCanvas.mockRejectedValue(new CanvasRevisionConflictError(7, 8));
    mocks.repository.getCanvas.mockResolvedValue({ id: "canvas-1", title: "Renamed elsewhere", graph, revision: 8 });
    const renamed = new Request("http://localhost/api/canvas/canvas-1", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ graph, expectedRevision: 7, title: "Original title" }),
    });
    expect((await PUT(renamed, context)).status).toBe(409);
    expect((await PUT(request(9), context)).status).toBe(409);
    expect(mocks.repository.flush).not.toHaveBeenCalled();
  });

  it("forwards an optional expected revision to the repository", async () => {
    mocks.repository.saveCanvas.mockResolvedValue({
      id: "canvas-1",
      title: "Canvas",
      graph,
      revision: 8,
    });

    const response = await PUT(request(7), context);

    expect(response.status).toBe(200);
    expect(mocks.repository.saveCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "canvas-1",
        expectedRevision: 7,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({ revision: 8 });
  });

  it("returns a typed 409 response for a stale revision", async () => {
    mocks.repository.saveCanvas.mockRejectedValue(
      new CanvasRevisionConflictError(3, 5),
    );

    const response = await PUT(request(3), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "画布已在其他位置更新，请先处理版本冲突",
      code: "CANVAS_REVISION_CONFLICT",
      currentRevision: 5,
    });
  });

  it("keeps unguarded saves backward compatible", async () => {
    mocks.repository.saveCanvas.mockResolvedValue({
      id: "canvas-1",
      title: "Canvas",
      graph,
      revision: 2,
    });

    const response = await PUT(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.repository.saveCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: undefined }),
    );
  });

  it("recognizes a conflict from a repository surviving a module reload", async () => {
    mocks.repository.saveCanvas.mockRejectedValue(Object.assign(new Error("conflict"), {
      code: "CANVAS_REVISION_CONFLICT", expectedRevision: 3, currentRevision: 5,
    }));
    const response = await PUT(request(3), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ currentRevision: 5 });
  });

  it("does not mistake malformed errors for version conflicts", async () => {
    mocks.repository.saveCanvas.mockRejectedValue(Object.assign(new Error("failure"), {
      code: "CANVAS_REVISION_CONFLICT", expectedRevision: "3", currentRevision: null,
    }));
    expect((await PUT(request(3), context)).status).toBe(500);
  });
});

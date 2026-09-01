import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasRevisionConflictError } from "@super-canvas/db";

const mocks = vi.hoisted(() => ({
  repository: {
    getCanvas: vi.fn(),
    saveCanvas: vi.fn(),
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
  vi.clearAllMocks();
});

describe("PUT /api/canvas/[id]", () => {
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
});

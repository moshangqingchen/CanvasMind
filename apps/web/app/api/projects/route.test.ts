import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    listCanvases: vi.fn(),
    ensureDefaultCanvas: vi.fn(),
    saveCanvas: vi.fn(),
  },
  ensureProjectDirectory: vi.fn(),
}));

vi.mock("../../../lib/server", () => ({
  repository: mocks.repository,
  jsonError(message: string, status = 400) {
    return Response.json({ error: message }, { status });
  },
  safeJsonObject(value: unknown) {
    return value as Record<string, unknown>;
  },
}));

vi.mock("../../../lib/project-service", () => ({
  ensureProjectDirectory: mocks.ensureProjectDirectory,
  normalizedProjectTitle: (value: string) => value.trim().replace(/[<>:"/\\|?*]/gu, "_"),
  projectSummary: (canvas: typeof canvasFixture) => ({
    id: canvas.id,
    title: canvas.title,
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
  }),
}));

import { GET, POST } from "./route";

const canvasFixture = {
  id: "canvas-1",
  title: "测试项目",
  graph: {},
  revision: 0,
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.repository.listCanvases.mockResolvedValue([canvasFixture]);
  mocks.ensureProjectDirectory.mockResolvedValue(undefined);
});

describe("/api/projects", () => {
  it("lists canvases as project summaries and prepares directories", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      projects: [
        {
          id: canvasFixture.id,
          title: canvasFixture.title,
          createdAt: canvasFixture.createdAt,
          updatedAt: canvasFixture.updatedAt,
        },
      ],
    });
    expect(mocks.ensureProjectDirectory).toHaveBeenCalledWith(canvasFixture);
  });

  it("rejects duplicate names after normalization", async () => {
    const response = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "  测试项目  " }),
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.repository.saveCanvas).not.toHaveBeenCalled();
  });

  it("creates an empty canvas for a new project", async () => {
    mocks.repository.listCanvases.mockResolvedValue([]);
    mocks.repository.saveCanvas.mockResolvedValue(canvasFixture);

    const response = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "测试项目" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.repository.saveCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "测试项目",
        reason: "manual",
        graph: expect.objectContaining({ nodes: [], edges: [] }),
      }),
    );
    expect(mocks.ensureProjectDirectory).toHaveBeenCalledWith(canvasFixture);
  });
});

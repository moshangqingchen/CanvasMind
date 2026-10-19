import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    listCanvases: vi.fn(),
    listCanvasTitles: vi.fn(),
    getCanvas: vi.fn(),
    ensureDefaultCanvas: vi.fn(),
    saveCanvas: vi.fn(),
  },
  ensureProjectDirectory: vi.fn(),
  ensureProject: vi.fn(),
}));

vi.mock("@super-canvas/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("@super-canvas/storage")>(),
  getProjectFileStore: () => ({ root: "D:/__supercanvas-unit-project-create-unused", ensureProject: mocks.ensureProject }),
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
    nodeCount: 0,
  }),
  projectCardSummary: async (canvas: typeof canvasFixture) => ({
    id: canvas.id,
    title: canvas.title,
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
    nodeCount: 0,
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
  mocks.repository.listCanvasTitles.mockImplementation(async () => (await mocks.repository.listCanvases()).map(({ id, title }: { id: string; title: string }) => ({ id, title })));
  mocks.repository.getCanvas.mockResolvedValue(null);
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
          nodeCount: 0,
        },
      ],
    });
    expect(mocks.ensureProjectDirectory).toHaveBeenCalledWith(canvasFixture);
  });

  it("returns an empty workspace without creating a default canvas", async () => {
    mocks.repository.listCanvases.mockResolvedValue([]);
    const response = await GET();
    await expect(response.json()).resolves.toEqual({ projects: [] });
    expect(mocks.repository.ensureDefaultCanvas).not.toHaveBeenCalled();
    expect(mocks.repository.saveCanvas).not.toHaveBeenCalled();
    expect(mocks.ensureProjectDirectory).not.toHaveBeenCalled();
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
    expect(mocks.ensureProject).toHaveBeenCalledWith(canvasFixture.title);
  });

  it("returns 201 and 409 for two concurrent creates of the same name", async () => {
    const saved: typeof canvasFixture[] = [];
    mocks.repository.listCanvases.mockImplementation(async () => [...saved]);
    mocks.repository.saveCanvas.mockImplementation(async input => {
      const canvas = { ...canvasFixture, ...input };
      saved.push(canvas);
      return canvas;
    });
    const create = () => POST(new Request("http://localhost/api/projects", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "并发项目" }),
    }));
    const responses = await Promise.all([create(), create()]);
    expect(responses.map(response => response.status)).toEqual([201, 409]);
    expect(saved).toHaveLength(1);
    expect(mocks.ensureProject).toHaveBeenCalledOnce();
  });
});

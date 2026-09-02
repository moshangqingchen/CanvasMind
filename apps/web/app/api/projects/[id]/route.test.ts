import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    getCanvas: vi.fn(),
    listCanvases: vi.fn(),
    listRuns: vi.fn(),
    deleteCanvas: vi.fn(),
    saveCanvas: vi.fn(),
  },
  deleteProject: vi.fn(),
  renameProject: vi.fn(),
}));

vi.mock("../../../../lib/server", () => ({
  repository: mocks.repository,
  jsonError(message: string, status = 400) {
    return Response.json({ error: message }, { status });
  },
  safeJsonObject: (value: unknown) => value,
}));

vi.mock("../../../../lib/project-service", () => ({
  normalizedProjectTitle: (title: string) => title.trim().toLocaleLowerCase(),
  projectSummary: (canvas: typeof target) => ({
    id: canvas.id,
    title: canvas.title,
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
  }),
}));

vi.mock("@super-canvas/storage", () => ({
  getProjectFileStore: () => ({
    deleteProject: mocks.deleteProject,
    renameProject: mocks.renameProject,
  }),
}));

import { DELETE, PATCH } from "./route";

const target = {
  id: "canvas-delete",
  title: "待删除项目",
  graph: { nodes: [] },
  revision: 3,
  createdAt: "2026-09-01T02:00:00.000Z",
  updatedAt: "2026-09-02T02:00:00.000Z",
};
const remaining = {
  id: "canvas-remaining",
  title: "保留项目",
  graph: { nodes: [] },
  revision: 2,
  createdAt: "2026-09-01T03:00:00.000Z",
  updatedAt: "2026-09-02T03:00:00.000Z",
};
const request = new Request("http://localhost/api/projects/canvas-delete", {
  method: "DELETE",
});
const context = { params: Promise.resolve({ id: target.id }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.repository.getCanvas.mockResolvedValue(target);
  mocks.repository.listRuns.mockResolvedValue([]);
  mocks.repository.deleteCanvas.mockResolvedValue(undefined);
  mocks.repository.saveCanvas.mockImplementation(async (input) => ({
    ...target,
    title: input.title,
    revision: target.revision + 1,
    updatedAt: "2026-09-02T04:00:00.000Z",
  }));
  mocks.deleteProject.mockResolvedValue(true);
  mocks.renameProject.mockResolvedValue(true);
});

describe("PATCH /api/projects/[id]", () => {
  it("renames the folder and project with revision protection", async () => {
    mocks.repository.listCanvases.mockResolvedValue([target, remaining]);
    const response = await PATCH(
      new Request(request.url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "新项目名称" }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      project: { id: target.id, title: "新项目名称" },
      revision: 4,
      folderRenamed: true,
    });
    expect(mocks.renameProject).toHaveBeenCalledWith(
      target.title,
      "新项目名称",
    );
    expect(mocks.repository.saveCanvas).toHaveBeenCalledWith({
      id: target.id,
      title: "新项目名称",
      graph: target.graph,
      reason: "rename",
      expectedRevision: target.revision,
    });
  });

  it("rejects a name already used by another project", async () => {
    mocks.repository.listCanvases.mockResolvedValue([target, remaining]);
    const response = await PATCH(
      new Request(request.url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: remaining.title }),
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(mocks.renameProject).not.toHaveBeenCalled();
    expect(mocks.repository.saveCanvas).not.toHaveBeenCalled();
  });

  it("restores the folder name when saving the renamed project fails", async () => {
    mocks.repository.listCanvases.mockResolvedValue([target, remaining]);
    mocks.repository.saveCanvas.mockRejectedValue(new Error("database failed"));
    const response = await PATCH(
      new Request(request.url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "新项目名称" }),
      }),
      context,
    );

    expect(response.status).toBe(500);
    expect(mocks.renameProject).toHaveBeenNthCalledWith(
      1,
      target.title,
      "新项目名称",
    );
    expect(mocks.renameProject).toHaveBeenNthCalledWith(
      2,
      "新项目名称",
      target.title,
    );
  });
});

describe("DELETE /api/projects/[id]", () => {
  it("deletes the project records and its unshared folder", async () => {
    mocks.repository.listCanvases
      .mockResolvedValueOnce([target, remaining])
      .mockResolvedValueOnce([remaining]);

    const response = await DELETE(request, context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: true,
      nextProjectId: remaining.id,
      folderDeleted: true,
    });
    expect(mocks.repository.deleteCanvas).toHaveBeenCalledWith(target.id);
    expect(mocks.deleteProject).toHaveBeenCalledWith(target.title);
  });

  it("refuses to delete the final project", async () => {
    mocks.repository.listCanvases.mockResolvedValue([target]);

    const response = await DELETE(request, context);

    expect(response.status).toBe(409);
    expect(mocks.repository.deleteCanvas).not.toHaveBeenCalled();
    expect(mocks.deleteProject).not.toHaveBeenCalled();
  });

  it("refuses deletion while a generation run is active", async () => {
    mocks.repository.listCanvases.mockResolvedValue([target, remaining]);
    mocks.repository.listRuns.mockResolvedValue([{ status: "running" }]);

    const response = await DELETE(request, context);

    expect(response.status).toBe(409);
    expect(mocks.repository.deleteCanvas).not.toHaveBeenCalled();
  });

  it("keeps a legacy folder shared by another project with the same title", async () => {
    const duplicate = {
      ...remaining,
      id: "canvas-duplicate",
      title: ` ${target.title} `,
    };
    mocks.repository.listCanvases
      .mockResolvedValueOnce([target, duplicate, remaining])
      .mockResolvedValueOnce([duplicate, remaining]);

    const response = await DELETE(request, context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deleted: true,
      folderDeleted: false,
    });
    expect(mocks.deleteProject).not.toHaveBeenCalled();
  });
});

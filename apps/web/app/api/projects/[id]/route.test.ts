import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    getCanvas: vi.fn(),
    listCanvases: vi.fn(),
    listRuns: vi.fn(),
    deleteCanvas: vi.fn(),
  },
  deleteProject: vi.fn(),
}));

vi.mock("../../../../lib/server", () => ({
  repository: mocks.repository,
  jsonError(message: string, status = 400) {
    return Response.json({ error: message }, { status });
  },
}));

vi.mock("../../../../lib/project-service", () => ({
  normalizedProjectTitle: (title: string) => title.trim().toLocaleLowerCase(),
}));

vi.mock("@super-canvas/storage", () => ({
  getProjectFileStore: () => ({ deleteProject: mocks.deleteProject }),
}));

import { DELETE } from "./route";

const target = {
  id: "canvas-delete",
  title: "待删除项目",
  updatedAt: "2026-09-02T02:00:00.000Z",
};
const remaining = {
  id: "canvas-remaining",
  title: "保留项目",
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
  mocks.deleteProject.mockResolvedValue(true);
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

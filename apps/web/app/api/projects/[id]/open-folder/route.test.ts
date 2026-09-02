import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: { getCanvas: vi.fn() },
  ensureProjectDirectory: vi.fn(),
  projectDirectory: vi.fn(),
  spawn: vi.fn(),
  unref: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

vi.mock("../../../../../lib/server", () => ({
  repository: mocks.repository,
  jsonError(message: string, status = 400) {
    return Response.json({ error: message }, { status });
  },
}));

vi.mock("../../../../../lib/project-service", () => ({
  ensureProjectDirectory: mocks.ensureProjectDirectory,
}));

vi.mock("@super-canvas/storage", () => ({
  getProjectFileStore: () => ({ projectDirectory: mocks.projectDirectory }),
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "canvas-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.repository.getCanvas.mockResolvedValue({
    id: "canvas-1",
    title: "测试项目",
  });
  mocks.ensureProjectDirectory.mockResolvedValue(undefined);
  mocks.projectDirectory.mockReturnValue("D:\\超级画布\\项目\\测试项目");
  mocks.spawn.mockReturnValue({ unref: mocks.unref });
});

describe("/api/projects/[id]/open-folder", () => {
  it("opens the normalized project directory in Windows Explorer", async () => {
    const response = await POST(
      new Request("http://localhost/api/projects/canvas-1/open-folder", {
        method: "POST",
      }),
      context,
    );

    expect(response.status).toBe(200);
    if (process.platform !== "win32") {
      await expect(response.json()).resolves.toEqual({
        opened: false,
        error: "当前环境不支持自动打开项目文件夹",
      });
      expect(mocks.spawn).not.toHaveBeenCalled();
      return;
    }
    await expect(response.json()).resolves.toEqual({ opened: true });
    expect(mocks.ensureProjectDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ title: "测试项目" }),
    );
    expect(mocks.spawn).toHaveBeenCalledWith(
      "explorer.exe",
      ["D:\\超级画布\\项目\\测试项目"],
      expect.objectContaining({ detached: true, stdio: "ignore" }),
    );
    expect(mocks.unref).toHaveBeenCalledOnce();
  });

  it("returns 404 without opening anything for an unknown project", async () => {
    mocks.repository.getCanvas.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/projects/missing/open-folder", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});

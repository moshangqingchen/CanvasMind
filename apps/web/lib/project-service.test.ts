import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    getCanvas: vi.fn(),
    listDirectorSessions: vi.fn(),
    getDirectorSession: vi.fn(),
    updateDirectorSession: vi.fn(),
    createDirectorSession: vi.fn(),
    listDirectorMessages: vi.fn(),
    deleteDirectorSession: vi.fn(),
    createDirectorMessage: vi.fn(),
    getAsset: vi.fn(),
    getRun: vi.fn(),
  },
  storage: { get: vi.fn() },
  store: {
    ensureProject: vi.fn(),
    archiveDraft: vi.fn(),
    archiveFinished: vi.fn(),
    clearDraft: vi.fn(),
  },
}));

vi.mock("./server", () => ({
  repository: mocks.repository,
  storage: mocks.storage,
}));

vi.mock("@super-canvas/storage", () => ({
  getProjectFileStore: () => mocks.store,
  normalizeProjectName: (value: string) => value.trim(),
}));

import {
  appendProjectChatTurn,
  clearProjectChat,
  listProjectChatMessages,
} from "./project-service";

const canvas = {
  id: "canvas-1",
  title: "项目一",
  graph: {},
  revision: 0,
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

function session(id: string, metadata: Record<string, unknown> = {}) {
  return {
    id,
    canvasId: canvas.id,
    title: id,
    profileId: null,
    metadata,
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.repository.getCanvas.mockResolvedValue(canvas);
  mocks.repository.updateDirectorSession.mockImplementation(async (id, patch) => ({
    ...session(id),
    ...patch,
  }));
  mocks.repository.createDirectorSession.mockImplementation(async (input) => ({
    ...input,
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  }));
  mocks.repository.createDirectorMessage.mockResolvedValue({});
});

describe("project chat persistence", () => {
  it("isolates messages by canvas and includes legacy sessions", async () => {
    mocks.repository.listDirectorSessions.mockResolvedValue([
      session("legacy"),
      session("project", { conversationType: "project-chat" }),
      session("other", { conversationType: "other" }),
    ]);
    mocks.repository.listDirectorMessages.mockImplementation(async (id: string) =>
      id === "legacy"
        ? [
            {
              id: "legacy-user",
              role: "user",
              content: "旧消息",
              metadata: {},
              createdAt: "2026-09-02T00:00:01.000Z",
            },
          ]
        : id === "project"
          ? [
              {
                id: "status",
                role: "assistant",
                content: "内部状态",
                metadata: { kind: "status" },
                createdAt: "2026-09-02T00:00:02.000Z",
              },
              {
                id: "project-assistant",
                role: "assistant",
                content: "项目回复",
                metadata: {},
                createdAt: "2026-09-02T00:00:03.000Z",
              },
            ]
          : [],
    );

    await expect(listProjectChatMessages(canvas.id)).resolves.toEqual([
      expect.objectContaining({ id: "legacy-user", content: "旧消息" }),
      expect.objectContaining({ id: "project-assistant", content: "项目回复" }),
    ]);
    expect(mocks.repository.listDirectorMessages).toHaveBeenCalledTimes(2);
  });

  it("clears all project-scoped sessions without touching other conversations", async () => {
    mocks.repository.listDirectorSessions.mockResolvedValue([
      session("legacy"),
      session("project", { conversationType: "project-chat" }),
      session("other", { conversationType: "other" }),
    ]);

    await clearProjectChat(canvas.id);

    expect(mocks.repository.deleteDirectorSession).toHaveBeenCalledTimes(2);
    expect(mocks.repository.deleteDirectorSession).toHaveBeenCalledWith("legacy");
    expect(mocks.repository.deleteDirectorSession).toHaveBeenCalledWith("project");
    expect(mocks.repository.deleteDirectorSession).not.toHaveBeenCalledWith("other");
  });

  it("stores a user and assistant turn in a project chat session", async () => {
    mocks.repository.listDirectorSessions.mockResolvedValue([]);
    mocks.repository.getDirectorSession.mockResolvedValue(null);

    await appendProjectChatTurn(canvas.id, "你好", "你好！");

    expect(mocks.repository.createDirectorSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `project-chat-${canvas.id}`,
        metadata: { conversationType: "project-chat" },
      }),
    );
    expect(mocks.repository.createDirectorMessage).toHaveBeenCalledTimes(2);
    expect(mocks.repository.createDirectorMessage.mock.calls[0]?.[0]).toMatchObject({
      role: "user",
      content: "你好",
    });
    expect(mocks.repository.createDirectorMessage.mock.calls[1]?.[0]).toMatchObject({
      role: "assistant",
      content: "你好！",
    });
  });
});

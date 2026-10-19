import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

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
    listCanvases: vi.fn(),
    listCanvasTitles: vi.fn(),
    listRuns: vi.fn(),
    listAssets: vi.fn(),
    saveAsset: vi.fn(),
  },
  storage: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
  store: {
    root: "D:/__supercanvas-unit-project-service-unused",
    ensureProject: vi.fn(),
    archiveDraft: vi.fn(),
    archiveFinished: vi.fn(),
    clearDraft: vi.fn(),
    listFiles: vi.fn(),
    readFile: vi.fn(),
    fileMetadata: vi.fn(),
    deleteFiles: vi.fn(),
    projectDirectory: vi.fn(),
  },
}));

vi.mock("./server", () => ({
  repository: mocks.repository,
  storage: mocks.storage,
}));

vi.mock("@super-canvas/storage", async importOriginal => ({
  ...await importOriginal<typeof import("@super-canvas/storage")>(),
  getProjectFileStore: () => mocks.store,
  normalizeProjectName: (value: string) => value.trim(),
}));

import {
  appendProjectChatTurn,
  clearProjectChat,
  listProjectChatMessages,
  projectCardSummary,
  listProjectFiles,
  importProjectFiles,
  deleteProjectFiles,
  archiveExternalAssetsForProject,
  projectFileMetadata,
  readProjectFile,
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
  mocks.repository.listCanvases.mockResolvedValue([canvas]);
  mocks.repository.listCanvasTitles.mockImplementation(async () => (await mocks.repository.listCanvases()).map(({ id, title }: { id: string; title: string }) => ({ id, title })));
  mocks.repository.listRuns.mockResolvedValue([]);
  mocks.repository.listAssets.mockResolvedValue([]);
  mocks.store.projectDirectory.mockReturnValue("isolated-project-folder");
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

describe("scoped project files", () => {
  const file = { fileId: "a".repeat(64), name: "Picture--image.png", kind: "image", mimeType: "image/png", size: 4,
    modifiedAt: "2026-10-05T00:00:00.000Z", section: "finished", subfolder: "图片", relativePath: "成品/图片/Picture--image.png" };
  it("checks project-file names without listing full canvas graphs", async () => {
    mocks.repository.listCanvases.mockRejectedValue(new Error("Full canvas listing forbidden"));
    mocks.repository.listCanvasTitles.mockResolvedValue([{ id: canvas.id, title: canvas.title }]);
    mocks.store.fileMetadata.mockResolvedValue(file);
    expect(await projectFileMetadata(canvas.id, file.fileId)).toMatchObject({ fileId: file.fileId });
    expect(mocks.repository.listCanvasTitles).toHaveBeenCalledOnce();
    expect(mocks.repository.listCanvases).not.toHaveBeenCalled();
  });
  it("returns only directory media with scoped URLs and no raw file paths", async () => {
    mocks.store.listFiles.mockResolvedValue({ files: [file], ignoredFiles: 1 });
    mocks.repository.listAssets.mockResolvedValue([{ id: "image", name: "Picture", kind: "image", metadata: { canvasId: canvas.id } },
      { id: "foreign", name: "Other project", metadata: { canvasId: "other" } }]);
    const result = await listProjectFiles(canvas.id);
    expect(result.files[0]).toMatchObject({ fileId: file.fileId, name: "Picture", assetId: "image", canDelete: true,
      previewUrl: `/api/projects/${canvas.id}/files/content?fileId=${file.fileId}&preview=640` });
    expect(result.files[0]).not.toHaveProperty("relativePath");
    expect(mocks.store.listFiles).toHaveBeenCalledWith(canvas.title);
  });
  it("blocks legacy shared directories rather than exposing another project's files", async () => {
    mocks.repository.listCanvases.mockResolvedValue([canvas, { ...canvas, id: "other" }]);
    await expect(listProjectFiles(canvas.id)).rejects.toMatchObject({ status: 409 });
    expect(mocks.store.listFiles).not.toHaveBeenCalled();
  });
  it("deletes only physical copies and preserves the asset library", async () => {
    mocks.store.deleteFiles.mockResolvedValue({ deletedIds: [file.fileId], failed: [{ fileId: "stale", message: "refresh" }] });
    expect(await deleteProjectFiles(canvas.id, [file.fileId, "stale"])).toMatchObject({ deletedIds: [file.fileId], failed: [{ fileId: "stale" }] });
    expect(mocks.store.deleteFiles).toHaveBeenCalledWith(canvas.title, [file.fileId, "stale"]);
    expect(mocks.storage.delete).not.toHaveBeenCalled();
    expect(mocks.repository.saveAsset).not.toHaveBeenCalled();
  });
  it("reuses identical archived assets and imports manual media once without extra archive copies", async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "white" } }).png().toBuffer();
    const original = { id: "image", name: "Picture", kind: "image", mimeType: "image/png", storageKey: "original.png", metadata: { canvasId: canvas.id } };
    mocks.repository.listAssets.mockResolvedValue([original]);
    mocks.storage.get.mockResolvedValue({ bytes });
    mocks.store.readFile.mockImplementation(async (_title, id) => {
      if (id === "bad") throw new Error("文件已变化");
      return { file: id === file.fileId ? file : { ...file, fileId: id, name: "Manual.png" }, bytes };
    });
    mocks.repository.saveAsset.mockImplementation(async value => value);
    const result = await importProjectFiles(canvas.id, [file.fileId, "manual", "bad"]);
    expect(result.assets[0]).toBe(original);
    expect(result.assets[1]).toMatchObject({ name: "Manual.png", metadata: { canvasId: canvas.id, projectFile: { fileId: "manual" } } });
    expect(result.failed).toEqual([{ fileId: "bad", error: "文件已变化" }]);
    expect(mocks.storage.put).toHaveBeenCalledOnce();
    expect(mocks.store.archiveDraft).not.toHaveBeenCalled();
    mocks.repository.getAsset.mockResolvedValue(result.assets[1]);
    await archiveExternalAssetsForProject(canvas.id, [result.assets[1]!.id]);
    expect(mocks.store.archiveDraft).not.toHaveBeenCalled();
  });

  it("keeps audio/webm consistent through listing, metadata, content reads and reimport", async () => {
    const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
      0x18, 0x53, 0x80, 0x67, 0x8a, 0x16, 0x54, 0xae, 0x6b, 0x85, 0xae, 0x83, 0x83, 0x81, 2]);
    const audio = { ...file, name: "voice--voice.webm", kind: "audio", mimeType: "audio/webm", size: bytes.length };
    const original = { id: "voice", name: "原始音频", kind: "audio", mimeType: "audio/webm;codecs=opus", storageKey: "voice.webm", metadata: { canvasId: canvas.id } };
    mocks.repository.listAssets.mockResolvedValue([original]);
    mocks.store.listFiles.mockResolvedValue({ files: [audio], ignoredFiles: 0 });
    mocks.store.fileMetadata.mockResolvedValue(audio);
    mocks.store.readFile.mockResolvedValue({ file: audio, bytes });
    expect((await listProjectFiles(canvas.id)).files[0]).toMatchObject({ name: original.name, assetId: "voice", kind: "audio", mimeType: original.mimeType });
    expect(await projectFileMetadata(canvas.id, audio.fileId)).toMatchObject({ kind: "audio", mimeType: original.mimeType });
    expect((await readProjectFile(canvas.id, audio.fileId)).file).toMatchObject({ kind: "audio", mimeType: original.mimeType });
    // With no remaining original object, import the unchanged project copy.
    mocks.storage.get.mockResolvedValue(null);
    mocks.repository.saveAsset.mockImplementation(async value => value);
    const imported = await importProjectFiles(canvas.id, [audio.fileId]);
    expect(imported.failed).toEqual([]);
    expect(imported.assets[0]).toMatchObject({ kind: "audio", mimeType: original.mimeType });
    expect(mocks.storage.put).toHaveBeenCalledWith(expect.stringMatching(/original\.webm$/u), bytes, original.mimeType);
  });

  it("does not reuse stale audio metadata for a replacement containing a video track", async () => {
    const video = { ...file, name: "replacement--voice.webm", kind: "video", mimeType: "video/webm" };
    mocks.repository.listAssets.mockResolvedValue([{ id: "voice", name: "Old voice", kind: "audio", mimeType: "audio/webm", metadata: { canvasId: canvas.id } }]);
    mocks.store.listFiles.mockResolvedValue({ files: [video], ignoredFiles: 0 });
    expect((await listProjectFiles(canvas.id)).files[0]).toMatchObject({ kind: "video", mimeType: "video/webm" });
  });
});

describe("project card summaries", () => {
  it("does not turn hidden mask parameters into a project cover", async () => {
    const result = await projectCardSummary({ ...canvas, graph: { nodes: [{ data: {
      parameters: { maskAssetId: "mask", maskSourceAssetId: "source" },
      generatedParameters: { maskAssetId: "old-mask", maskSourceAssetId: "old-source" },
    } }] } });
    expect(result.previewAssetId).toBeUndefined();
    expect(mocks.repository.getAsset).not.toHaveBeenCalled();
  });
  it("returns a compact empty summary for legacy graphs without nodes", async () => {
    await expect(projectCardSummary(canvas)).resolves.toEqual({
      id: canvas.id, title: canvas.title, createdAt: canvas.createdAt,
      updatedAt: canvas.updatedAt, nodeCount: 0,
    });
    expect(mocks.repository.getAsset).not.toHaveBeenCalled();
  });

  it("only chooses an existing image and never exposes graph or remote source data", async () => {
    mocks.repository.getAsset.mockImplementation(async (id: string) => {
      if (id === "valid-image") return { id, kind: "image", deleted: false };
      if (id === "deleted-image") return { id, kind: "image", deleted: true };
      if (id === "video") return { id, kind: "video", deleted: false };
      return null;
    });
    const result = await projectCardSummary({ ...canvas, graph: { nodes: [
      { data: { parts: [{ type: "asset", assetId: "valid-image" }] } },
      { data: { assetId: "deleted-image", lastOutputAssetIds: ["missing", "video"], url: "https://example.com/private-image" } },
    ] } });
    expect(result).toEqual({ id: canvas.id, title: canvas.title, createdAt: canvas.createdAt,
      updatedAt: canvas.updatedAt, nodeCount: 2, previewAssetId: "valid-image" });
    expect(mocks.repository.getAsset).toHaveBeenCalledWith("missing");
    expect(result).not.toHaveProperty("graph");
  });
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

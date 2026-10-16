import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: { getAsset: vi.fn() },
  storage: { head: vi.fn(), get: vi.fn() },
}));
vi.mock("./server", () => mocks);
import { loadDirectorAttachments } from "./agent-attachments";

const asset = {
  id: "reference", kind: "image", name: "reference.png", mimeType: "image/png",
  size: 4, storageKey: "references/original", deleted: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.repository.getAsset.mockResolvedValue(asset);
  mocks.storage.head.mockResolvedValue({ size: asset.size });
  mocks.storage.get.mockResolvedValue({ bytes: Uint8Array.from([0, 127, 128, 255]) });
});

describe("agent attachment loading", () => {
  it("passes original media bytes and metadata to the model adapter", async () => {
    expect(await loadDirectorAttachments([asset.id])).toEqual([{
      kind: "image", name: asset.name, mimeType: asset.mimeType,
      url: "data:image/png;base64,AH+A/w==",
    }]);
    expect(mocks.storage.get).toHaveBeenCalledWith(asset.storageKey);
  });

  it("rejects changed stored bytes before passing them to the model", async () => {
    mocks.storage.get.mockResolvedValue({ bytes: Uint8Array.from([0]) });
    await expect(loadDirectorAttachments([asset.id])).rejects.toMatchObject({
      code: "ATTACHMENT_UNAVAILABLE", status: 409,
    });
  });

  it("rejects deleted assets without reading their files", async () => {
    mocks.repository.getAsset.mockResolvedValue({ ...asset, deleted: true });
    await expect(loadDirectorAttachments([asset.id])).rejects.toMatchObject({
      code: "ATTACHMENT_NOT_FOUND", status: 404,
    });
    expect(mocks.storage.get).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type AssetRecord } from "@super-canvas/db";

const mocks = vi.hoisted(() => ({ updateImageDesignReview: vi.fn() }));
vi.mock("../../../../../lib/server", () => ({
  repository: mocks,
  jsonError: (error: string, status = 400) =>
    Response.json({ error }, { status }),
  publicAsset: (asset: AssetRecord) => ({
    ...asset,
    url: `/api/assets/${asset.id}/content`,
  }),
}));

import { PATCH } from "./route";

let repository: MemoryRepository;
const original: AssetRecord = {
  id: "image-1",
  name: "海报.png",
  kind: "image",
  mimeType: "image/png",
  size: 100,
  storageKey: "assets/image-1/original.png",
  deleted: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  metadata: {
    sourceNodeId: "node-1",
    prompt: "原始文案",
    referenceAssetIds: ["ref-1"],
  },
};
const valid = {
  status: "candidate",
  note: "标题需要放大",
  expectedRevision: 0,
};
function patch(body: unknown, id = original.id) {
  return PATCH(
    new Request(`http://localhost/api/assets/${id}/design-review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  repository = new MemoryRepository();
  await repository.saveAsset(original);
  mocks.updateImageDesignReview.mockImplementation(
    repository.updateImageDesignReview.bind(repository),
  );
});

describe("PATCH image design review", () => {
  it("returns the full public asset and preserves generation provenance", async () => {
    const response = await patch(valid);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...original,
      url: "/api/assets/image-1/content",
      metadata: {
        ...original.metadata,
        imageDesignReview: {
          status: "candidate",
          note: valid.note,
          revision: 1,
          updatedAt: expect.any(String),
        },
      },
    });
  });

  it("returns the latest public asset on a stale revision without overwriting it", async () => {
    await patch(valid);
    const response = await patch({ ...valid, status: "rejected" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.any(String),
      asset: {
        id: original.id,
        url: "/api/assets/image-1/content",
        metadata: { imageDesignReview: { status: "candidate", revision: 1 } },
      },
    });
  });

  it.each([
    null,
    { ...valid, status: "final" },
    { ...valid, note: "字".repeat(2001) },
    { ...valid, note: 1 },
    { ...valid, expectedRevision: -1 },
    { ...valid, expectedRevision: undefined },
    { ...valid, metadata: { prompt: "overwrite" } },
  ])("rejects malformed input before any mutation: %j", async (input) => {
    expect((await patch(input)).status).toBe(400);
    expect(mocks.updateImageDesignReview).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/assets/image-1/design-review", {
        method: "PATCH",
        body: "{",
      }),
      { params: Promise.resolve({ id: original.id }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.updateImageDesignReview).not.toHaveBeenCalled();
  });

  it("allows notes at the limit and clearing a review", async () => {
    expect((await patch({ ...valid, note: "字".repeat(2000) })).status).toBe(
      200,
    );
    const response = await patch({
      status: "unreviewed",
      note: "",
      expectedRevision: 1,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).metadata.imageDesignReview).toMatchObject({
      status: "unreviewed",
      note: "",
      revision: 2,
    });
  });

  it("returns 404 for missing and deleted assets and rejects video assets", async () => {
    expect((await patch(valid, "missing")).status).toBe(404);
    await repository.deleteAsset(original.id);
    expect((await patch(valid)).status).toBe(404);
    expect(await repository.getAsset(original.id)).toBeNull();
    await repository.saveAsset({ ...original, kind: "video" });
    expect((await patch(valid)).status).toBe(400);
  });
});

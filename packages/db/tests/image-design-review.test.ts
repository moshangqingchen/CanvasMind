import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/memory.js";
import { FileRepository } from "../src/file.js";
import {
  ImageDesignReviewConflictError,
  ImageDesignReviewValidationError,
  type AssetRecord,
} from "../src/types.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

const original: AssetRecord = {
  id: "image-1",
  name: "海报.png",
  kind: "image",
  mimeType: "image/png",
  size: 123,
  storageKey: "assets/image-1/original.png",
  deleted: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  metadata: {
    sourceNodeId: "source-node",
    sourceRunId: "run-1",
    prompt: "原始提示词",
    generation: { model: "image-model", referenceAssetIds: ["ref-1"] },
    width: 1024,
    height: 1536,
  },
};
const candidate = {
  status: "candidate" as const,
  note: "调整标题层级",
  expectedRevision: 0,
};

async function createRepository(kind: "memory" | "file") {
  if (kind === "memory") return { repository: new MemoryRepository() };
  const directory = await mkdtemp(join(tmpdir(), "super-canvas-review-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "state.json");
  return { repository: new FileRepository(path), path };
}

describe.each(["memory", "file"] as const)(
  "%s image design review persistence",
  (kind) => {
    it("preserves saved reviews when output archival retries upsert the same asset", async () => {
      const { repository, path } = await createRepository(kind);
      await repository.saveAsset(original);
      const reviewed = await repository.updateImageDesignReview(original.id, {
        status: "approved",
        note: "客户确认，保留这个版本",
        expectedRevision: 0,
      });
      const review = reviewed!.metadata.imageDesignReview;
      // A recovery download writes the original generation metadata again.
      const archived = await repository.saveAsset({
        ...original,
        metadata: { ...original.metadata, recovered: true },
      });
      expect(archived.metadata).toEqual({
        ...original.metadata,
        recovered: true,
        imageDesignReview: review,
      });
      // Generic metadata updates also cannot replace the protected review.
      await repository.saveAsset({
        ...original,
        metadata: { imageDesignReview: { status: "rejected", revision: 0 } },
      });
      const restored = path ? new FileRepository(path) : repository;
      expect(
        (await restored.getAsset(original.id))?.metadata.imageDesignReview,
      ).toEqual(review);
      await expect(
        restored.updateImageDesignReview(original.id, {
          status: "candidate",
          note: "专用接口可以继续更新",
          expectedRevision: 1,
        }),
      ).resolves.toMatchObject({
        metadata: { imageDesignReview: { status: "candidate", revision: 2 } },
      });
    });

    it("keeps the latest review during concurrent review and archive saves", async () => {
      const { repository, path } = await createRepository(kind);
      await repository.saveAsset(original);
      await repository.updateImageDesignReview(original.id, candidate);
      await Promise.all([
        repository.updateImageDesignReview(original.id, {
          status: "approved",
          note: "新的定稿备注",
          expectedRevision: 1,
        }),
        repository.saveAsset(original),
      ]);
      const restored = path ? new FileRepository(path) : repository;
      expect(
        (await restored.getAsset(original.id))?.metadata.imageDesignReview,
      ).toMatchObject({
        status: "approved",
        note: "新的定稿备注",
        revision: 2,
      });
    });

    it("keeps the source, storage, creation time and unrelated metadata intact", async () => {
      const { repository, path } = await createRepository(kind);
      await repository.saveAsset(original);
      const result = await repository.updateImageDesignReview(
        original.id,
        candidate,
      );
      expect(result).toEqual({
        ...original,
        metadata: {
          ...original.metadata,
          imageDesignReview: {
            status: "candidate",
            note: candidate.note,
            revision: 1,
            updatedAt: expect.any(String),
          },
        },
      });
      const restored = path
        ? new FileRepository(path)
        : new MemoryRepository(repository.exportSnapshot());
      expect(await restored.getAsset(original.id)).toEqual(result);
      await restored.updateImageDesignReview(original.id, {
        status: "approved",
        note: "定稿",
        expectedRevision: 1,
      });
      expect(
        (await restored.getAsset(original.id))?.metadata.imageDesignReview,
      ).toMatchObject({ status: "approved", revision: 2 });
    });

    it("allows only one simultaneous update to the same revision and returns the winning asset", async () => {
      const { repository, path } = await createRepository(kind);
      await repository.saveAsset(original);
      const results = await Promise.allSettled([
        repository.updateImageDesignReview(original.id, candidate),
        repository.updateImageDesignReview(original.id, {
          ...candidate,
          status: "rejected",
          note: "stale",
        }),
      ]);
      expect(results[0]?.status).toBe("fulfilled");
      expect(results[1]?.status).toBe("rejected");
      if (results[1]?.status === "rejected") {
        expect(results[1].reason).toBeInstanceOf(
          ImageDesignReviewConflictError,
        );
        expect(
          results[1].reason.asset.metadata.imageDesignReview,
        ).toMatchObject({ status: "candidate", revision: 1 });
      }
      const restored = path ? new FileRepository(path) : repository;
      expect(
        (await restored.getAsset(original.id))?.metadata.imageDesignReview,
      ).toMatchObject({ status: "candidate", revision: 1 });
    });

    it("does not create missing assets or revive deleted assets", async () => {
      const { repository, path } = await createRepository(kind);
      expect(
        await repository.updateImageDesignReview("missing", candidate),
      ).toBeNull();
      await repository.saveAsset(original);
      await repository.deleteAsset(original.id);
      expect(
        await repository.updateImageDesignReview(original.id, candidate),
      ).toBeNull();
      const restored = path ? new FileRepository(path) : repository;
      expect(await restored.getAsset(original.id)).toBeNull();
      expect(restored.exportSnapshot().assets[0]?.deleted).toBe(true);
    });

    it("rejects non-images and invalid inputs without changing the asset", async () => {
      const { repository } = await createRepository(kind);
      await repository.saveAsset({ ...original, kind: "video" });
      await expect(
        repository.updateImageDesignReview(original.id, candidate),
      ).rejects.toBeInstanceOf(ImageDesignReviewValidationError);
      await repository.saveAsset(original);
      for (const input of [
        { ...candidate, note: "x".repeat(2001) },
        { ...candidate, expectedRevision: -1 },
      ]) {
        await expect(
          repository.updateImageDesignReview(original.id, input),
        ).rejects.toBeInstanceOf(ImageDesignReviewValidationError);
      }
      expect(await repository.getAsset(original.id)).toEqual(original);
    });
  },
);

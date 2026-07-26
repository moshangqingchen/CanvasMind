import { mkdtemp, rm } from "node:fs/promises";
import { rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileRepository } from "../src/file.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("FileRepository", () => {
  it("restores canvases and assets after creating a new instance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const first = new FileRepository(path);
    const canvas = await first.ensureDefaultCanvas();
    await first.saveCanvas({
      id: canvas.id,
      title: "持久画布",
      graph: {
        schemaVersion: 1,
        nodes: [{ id: "image-1" }],
        edges: [],
      },
    });
    await first.saveAsset({
      id: "asset-1",
      name: "result.png",
      kind: "image",
      mimeType: "image/png",
      size: 123,
      storageKey: "assets/asset-1/original.png",
      metadata: {},
    });

    const restored = new FileRepository(path);
    await expect(restored.ensureDefaultCanvas()).resolves.toMatchObject({
      id: canvas.id,
      title: "持久画布",
      revision: 1,
    });
    await expect(restored.listAssets()).resolves.toEqual([
      expect.objectContaining({ id: "asset-1", name: "result.png" }),
    ]);
  });

  it("continues saving after one persistence failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    let failNextRename = true;
    const replaceFile: typeof rename = async (oldPath, newPath) => {
      if (!failNextRename) return rename(oldPath, newPath);
      failNextRename = false;
      const error = new Error(
        "simulated persistence failure",
      ) as NodeJS.ErrnoException;
      error.code = "EIO";
      throw error;
    };

    const repository = new FileRepository(path, replaceFile);
    await expect(repository.ensureDefaultCanvas()).rejects.toThrow(
      "simulated persistence failure",
    );
    const canvas = await repository.ensureDefaultCanvas();
    await expect(repository.saveCanvas({
      id: canvas.id,
      graph: { schemaVersion: 1, nodes: [], edges: [] },
    })).resolves.toMatchObject({ revision: 1 });
  });
});

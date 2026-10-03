import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalObjectStorage, getObjectStorage } from "./index.js";

const storageReadMock = vi.hoisted(() => ({
  maxReadBytes: Infinity,
  positions: [] as number[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (Number.isFinite(storageReadMock.maxReadBytes)) {
        const originalRead = handle.read.bind(handle);
        handle.read = (async (
          buffer: Uint8Array,
          offset: number,
          length: number,
          position: number,
        ) => {
          storageReadMock.positions.push(position);
          return originalRead(
            buffer,
            offset,
            Math.min(length, storageReadMock.maxReadBytes),
            position,
          );
        }) as typeof handle.read;
      }
      return handle;
    },
  };
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  storageReadMock.maxReadBytes = Infinity;
  storageReadMock.positions = [];
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createStorage(): Promise<LocalObjectStorage> {
  const root = await mkdtemp(join(tmpdir(), "super-canvas-storage-"));
  temporaryDirectories.push(root);
  return new LocalObjectStorage(root);
}

describe("LocalObjectStorage", () => {
  it("streams through a temporary file and publishes complete bytes with a checksum", async () => {
    const storage = await createStorage();
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = storage.putStream(
      "stream.bin",
      (async function* () {
        yield Uint8Array.of(1, 2);
        started();
        await wait;
        yield Uint8Array.of(3, 4);
      })(),
      "video/mp4",
    );
    await ready;
    let readCompleted = false;
    const read = storage.head("stream.bin").then((value) => {
      readCompleted = true;
      return value;
    });
    await Promise.resolve();
    expect(readCompleted).toBe(false);
    release();
    const result = await pending;
    expect(await read).toMatchObject({ size: 4, contentType: "video/mp4" });
    expect(result).toMatchObject({
      size: 4,
      etag: createHash("sha256")
        .update(Uint8Array.of(1, 2, 3, 4))
        .digest("hex"),
    });
    expect(await storage.head("stream.bin")).toMatchObject(result);
    const chunks: Uint8Array[] = [];
    for await (const chunk of storage.stream("stream.bin")) chunks.push(chunk);
    expect([...Buffer.concat(chunks)]).toEqual([1, 2, 3, 4]);
  });

  it("preserves the previous object and removes temporary files after a broken stream", async () => {
    const root = await mkdtemp(join(tmpdir(), "super-canvas-storage-"));
    temporaryDirectories.push(root);
    const storage = new LocalObjectStorage(root);
    await storage.put("original.bin", Uint8Array.of(7), "image/png");
    const before = await storage.head("original.bin");
    await expect(
      storage.putStream(
        "original.bin",
        (async function* () {
          yield Uint8Array.of(8, 9);
          throw new Error("source interrupted");
        })(),
        "video/mp4",
      ),
    ).rejects.toThrow("source interrupted");
    expect(await storage.head("original.bin")).toEqual(before);
    expect([...(await storage.get("original.bin"))!.bytes]).toEqual([7]);
    expect((await readdir(root)).sort()).toEqual([
      "original.bin",
      "original.bin.metadata.json",
    ]);
  });

  it("serializes replacement streams and never trusts stale metadata after external mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "super-canvas-storage-"));
    temporaryDirectories.push(root);
    const storage = new LocalObjectStorage(root);
    await Promise.all([
      storage.put("same.bin", Uint8Array.of(1, 2), "image/png"),
      storage.put("same.bin", Uint8Array.of(3), "video/mp4"),
    ]);
    expect(await storage.head("same.bin")).toMatchObject({
      size: 1,
      contentType: "video/mp4",
    });
    expect([...(await storage.get("same.bin"))!.bytes]).toEqual([3]);
    await writeFile(join(root, "same.bin"), Uint8Array.of(4, 5, 6));
    expect((await storage.head("same.bin"))?.etag).toBeUndefined();
  });

  it("does not hide metadata deletion failures when the object is already missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "super-canvas-storage-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "missing.bin.metadata.json"));
    const storage = new LocalObjectStorage(root);
    await expect(storage.delete("missing.bin")).rejects.toThrow();
  });

  it("stores and returns object metadata without changing get compatibility", async () => {
    const storage = await createStorage();
    const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5]);
    await storage.put("assets/example/original.bin", bytes, "video/mp4");

    await expect(
      storage.head("assets/example/original.bin"),
    ).resolves.toMatchObject({
      size: 6,
      contentType: "video/mp4",
    });
    const stored = await storage.get("assets/example/original.bin");
    expect(stored?.contentType).toBe("video/mp4");
    expect(Array.from(stored?.bytes ?? [])).toEqual(Array.from(bytes));
  });

  it("reads only an inclusive byte range", async () => {
    const storage = await createStorage();
    await storage.put(
      "assets/example/original.bin",
      Uint8Array.from([10, 11, 12, 13, 14, 15]),
      "video/webm",
    );

    const result = await storage.getRange("assets/example/original.bin", 2, 4);
    expect(result).toEqual({
      bytes: Uint8Array.from([12, 13, 14]),
      contentType: "video/webm",
    });
  });

  it("fills a requested media range when the filesystem returns short reads", async () => {
    const storage = await createStorage();
    await storage.put(
      "range.bin",
      Uint8Array.of(10, 11, 12, 13, 14, 15, 16, 17),
      "video/mp4",
    );
    storageReadMock.maxReadBytes = 2;

    await expect(storage.getRange("range.bin", 2, 6)).resolves.toEqual({
      bytes: Uint8Array.of(12, 13, 14, 15, 16),
      contentType: "video/mp4",
    });
    expect(storageReadMock.positions).toEqual([2, 4, 6]);
  });

  it("returns null for missing objects and rejects invalid ranges", async () => {
    const storage = await createStorage();
    await expect(storage.head("missing.bin")).resolves.toBeNull();
    await expect(storage.getRange("missing.bin", 0, 1)).resolves.toBeNull();
    await expect(storage.getRange("missing.bin", 3, 2)).rejects.toThrow(
      RangeError,
    );
  });
});

describe("getObjectStorage", () => {
  afterEach(() => {
    delete (globalThis as { __superCanvasObjectStorage?: unknown })
      .__superCanvasObjectStorage;
  });
  it("uses the local desktop store", () => {
    expect(getObjectStorage()).toBeInstanceOf(LocalObjectStorage);
  });
});

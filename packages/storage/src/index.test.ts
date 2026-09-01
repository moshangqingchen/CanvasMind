import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalObjectStorage,
  S3ObjectStorage,
  getObjectStorage,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("S3ObjectStorage", () => {
  it("includes the expected content length in the signed PUT headers", async () => {
    const storage = new S3ObjectStorage("test-bucket", {
      endpoint: "https://storage.example.test",
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
      },
    });
    Object.assign(storage, { ensured: Promise.resolve() });

    const signedUrl = await storage.presignPut(
      "assets/id/original.png",
      "image/png",
      123,
      600,
    );
    expect(new URL(signedUrl).searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-length",
    );
  });
});

async function createStorage(): Promise<LocalObjectStorage> {
  const root = await mkdtemp(join(tmpdir(), "super-canvas-storage-"));
  temporaryDirectories.push(root);
  return new LocalObjectStorage(root);
}

describe("LocalObjectStorage", () => {
  it("stores and returns object metadata without changing get compatibility", async () => {
    const storage = await createStorage();
    const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5]);
    await storage.put("assets/example/original.bin", bytes, "video/mp4");

    await expect(storage.head("assets/example/original.bin")).resolves.toMatchObject(
      {
        size: 6,
        contentType: "video/mp4",
      },
    );
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
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
    S3_SECRET_KEY: process.env.S3_SECRET_KEY,
    S3_BUCKET: process.env.S3_BUCKET,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete (globalThis as { __superCanvasObjectStorage?: unknown })
      .__superCanvasObjectStorage;
  });

  it("rejects missing S3 credentials in production", () => {
    process.env.NODE_ENV = "production";
    process.env.S3_ENDPOINT = "https://storage.example.test";
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;

    expect(() => getObjectStorage()).toThrow(
      "S3_ACCESS_KEY and S3_SECRET_KEY are required in production",
    );
  });

  it("keeps the development fallback when both S3 credentials are absent", () => {
    process.env.NODE_ENV = "development";
    process.env.S3_ENDPOINT = "https://storage.example.test";
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;

    expect(getObjectStorage()).toBeInstanceOf(S3ObjectStorage);
  });

  it("rejects partially configured S3 credentials in development", () => {
    process.env.NODE_ENV = "development";
    process.env.S3_ENDPOINT = "https://storage.example.test";
    process.env.S3_ACCESS_KEY = "configured-access-key";
    delete process.env.S3_SECRET_KEY;

    expect(() => getObjectStorage()).toThrow(
      "S3_ACCESS_KEY and S3_SECRET_KEY must be configured together",
    );
  });
});

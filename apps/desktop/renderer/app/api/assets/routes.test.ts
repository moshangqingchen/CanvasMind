import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { StoredObject } from "@super-canvas/storage";
import { createJpegWithExifThumbnailFixture } from "./jpeg-test-fixture";
import { getOrCreateAssetPreview } from "../../../lib/asset-preview";

const mocks = vi.hoisted(() => {
  const repository = {
    getAsset: vi.fn(),
    listAssets: vi.fn(),
    deleteAssets: vi.fn(),
    saveAsset: vi.fn(async (input: Record<string, unknown>) => ({
      ...input,
      createdAt: "2026-01-01T00:00:00.000Z",
      deleted: false,
    })),
  };
  const storage = {
    get: vi.fn(),
    getRange: vi.fn(),
    head: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  return { repository, storage, archiveGeneratedAssetForFinished: vi.fn() };
});

vi.mock("../../../lib/project-service", () => ({
  archiveGeneratedAssetForFinished: mocks.archiveGeneratedAssetForFinished,
}));

vi.mock("../../../lib/server", () => ({
  repository: mocks.repository,
  storage: mocks.storage,
  publicAsset: (asset: unknown) => asset,
  jsonError(message: string, status = 400) {
    return Response.json({ error: message }, { status });
  },
}));

import { GET as getAssetContent, HEAD as headAssetContent } from "./[id]/content/route";
import { GET as listVisibleAssets } from "./route";
import { POST as bulkDeleteAssets } from "./bulk-delete/route";
import {
  POST as proxyUpload,
} from "./upload/route";

const asset = {
  id: "asset-1",
  name: "clip.mp4",
  kind: "video",
  mimeType: "video/mp4",
  size: 10,
  storageKey: "assets/asset-1/original.mp4",
  metadata: {},
  deleted: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

it("keeps verification assets out of the normal material library without deleting them", async () => {
  mocks.repository.listAssets.mockResolvedValue([asset, {...asset,id:"verification-image",metadata:{purpose:"supplier-verification"}}]);
  expect(await (await listVisibleAssets()).json()).toEqual([asset]);
  expect(mocks.repository.deleteAssets).not.toHaveBeenCalled();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage.put.mockResolvedValue(undefined);
  mocks.repository.getAsset.mockResolvedValue(asset);
  mocks.repository.listAssets.mockResolvedValue([]);
  mocks.repository.deleteAssets.mockResolvedValue(undefined);
  mocks.storage.head.mockResolvedValue({ size: 10, contentType: "video/mp4" });
  mocks.storage.get.mockResolvedValue({
    bytes: Uint8Array.from({ length: 10 }, (_, index) => index),
    contentType: "video/mp4",
  });
  mocks.storage.getRange.mockImplementation(
    async (_key: string, start: number, end: number) => ({
      bytes: Uint8Array.from(
        { length: end - start + 1 },
        (_, index) => index + start,
      ),
      contentType: "video/mp4",
    }),
  );
  mocks.storage.delete.mockResolvedValue(undefined);
});

describe("bulk asset deletion route", () => {
  it("persists once and limits storage cleanup concurrency", async () => {
    const assets = Array.from({ length: 23 }, (_, index) => ({
      ...asset,
      id: `asset-${index}`,
      storageKey: `assets/asset-${index}/original.png`,
    }));
    mocks.repository.listAssets.mockResolvedValue(assets);
    let activeDeletes = 0;
    let peakDeletes = 0;
    mocks.storage.delete.mockImplementation(async () => {
      activeDeletes += 1;
      peakDeletes = Math.max(peakDeletes, activeDeletes);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeDeletes -= 1;
    });

    const requestedIds = [
      ...assets.map((item) => item.id),
      "already-missing",
      assets[0]!.id,
    ];
    const response = await bulkDeleteAssets(
      new Request("http://localhost/api/assets/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds: requestedIds }),
      }),
    );
    const payload = (await response.json()) as {
      deletedIds: string[];
      failedIds: string[];
    };

    expect(response.status).toBe(200);
    expect(mocks.repository.deleteAssets).toHaveBeenCalledOnce();
    expect(mocks.repository.deleteAssets).toHaveBeenCalledWith(
      assets.map((item) => item.id),
    );
    expect(mocks.storage.delete).toHaveBeenCalledTimes(assets.length);
    expect(peakDeletes).toBe(4);
    expect(payload.deletedIds).toEqual([
      ...assets.map((item) => item.id),
      "already-missing",
    ]);
    expect(payload.failedIds).toEqual([]);
  });

  it("rejects oversized batches before touching the repository", async () => {
    const response = await bulkDeleteAssets(
      new Request("http://localhost/api/assets/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetIds: Array.from({ length: 501 }, (_, index) => `asset-${index}`),
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.repository.listAssets).not.toHaveBeenCalled();
    expect(mocks.repository.deleteAssets).not.toHaveBeenCalled();
  });
});

describe("asset content route", () => {
  it("answers HEAD from metadata without reading or archiving the media", async () => {
    const response = await headAssetContent(
      new Request("http://localhost/api/assets/asset-1/content?download=1", {
        method: "HEAD", headers: { range: "bytes=-3" },
      }),
      { params: Promise.resolve({ id: "asset-1" }) },
    );
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-disposition")).toContain("clip.mp4");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.storage.head).toHaveBeenCalledWith(asset.storageKey);
    expect(mocks.storage.get).not.toHaveBeenCalled();
    expect(mocks.storage.getRange).not.toHaveBeenCalled();
    expect(mocks.archiveGeneratedAssetForFinished).not.toHaveBeenCalled();
  });

  it("returns a bodyless 404 when HEAD cannot find the stored media", async () => {
    mocks.storage.head.mockResolvedValueOnce(null);
    const response = await headAssetContent(
      new Request("http://localhost/api/assets/asset-1/content", { method: "HEAD" }),
      { params: Promise.resolve({ id: "asset-1" }) },
    );
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
    expect(mocks.storage.get).not.toHaveBeenCalled();
  });

  it("forces a named attachment for explicit downloads", async () => {
    mocks.repository.getAsset.mockResolvedValueOnce({
      ...asset,
      name: "测试/图片",
      kind: "image",
      mimeType: "image/png",
    });
    mocks.storage.head.mockResolvedValueOnce({
      size: 10,
      contentType: "image/png",
    });
    mocks.storage.get.mockResolvedValueOnce({
      bytes: Uint8Array.from({ length: 10 }, (_, index) => index),
      contentType: "image/png",
    });

    const response = await getAssetContent(
      new Request("http://localhost/api/assets/asset-1/content?download=1"),
      { params: Promise.resolve({ id: "asset-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-disposition")).toContain(
      encodeURIComponent("测试-图片.png"),
    );
  });

  it("preserves an existing compatible file extension", async () => {
    mocks.repository.getAsset.mockResolvedValueOnce({
      ...asset,
      name: "photo.JPEG",
      kind: "image",
      mimeType: "image/jpeg",
    });
    mocks.storage.head.mockResolvedValueOnce({
      size: 10,
      contentType: "image/jpeg",
    });
    mocks.storage.get.mockResolvedValueOnce({
      bytes: Uint8Array.from({ length: 10 }, (_, index) => index),
      contentType: "image/jpeg",
    });

    const response = await getAssetContent(
      new Request("http://localhost/api/assets/asset-1/content?download=1"),
      { params: Promise.resolve({ id: "asset-1" }) },
    );

    expect(response.headers.get("content-disposition")).toContain("photo.JPEG");
    expect(response.headers.get("content-disposition")).not.toContain(
      "photo.JPEG.jpg",
    );
  });

  it("serves a suffix range through storage.getRange without loading the object", async () => {
    const response = await getAssetContent(
      new Request("http://localhost/api/assets/asset-1/content", {
        headers: { range: "bytes=-3" },
      }),
      { params: Promise.resolve({ id: "asset-1" }) },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from([7, 8, 9]),
    );
    expect(mocks.storage.getRange).toHaveBeenCalledWith(asset.storageKey, 7, 9);
    expect(mocks.storage.get).not.toHaveBeenCalled();
  });

  it("returns 416 for malformed or unsatisfiable ranges", async () => {
    const response = await getAssetContent(
      new Request("http://localhost/api/assets/asset-1/content", {
        headers: { range: "bytes=10-" },
      }),
      { params: Promise.resolve({ id: "asset-1" }) },
    );

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
    expect(mocks.storage.getRange).not.toHaveBeenCalled();
    expect(mocks.storage.get).not.toHaveBeenCalled();
  });
});

describe("proxy upload route", () => {
  it("stores the complete JPEG past its EXIF thumbnail and generates a preview at the original dimensions", async () => {
    const fixture = await createJpegWithExifThumbnailFixture();
    const uploaded = Uint8Array.from([...fixture.bytes, 9, 8, 0xff, 0xd9]);
    const objects = new Map<string, StoredObject>();
    mocks.storage.get.mockImplementation(
      async (key: string) => objects.get(key) ?? null,
    );
    mocks.storage.put.mockImplementation(
      async (key: string, bytes: Uint8Array, contentType: string) => {
        objects.set(key, { bytes: new Uint8Array(bytes), contentType });
      },
    );
    const response = await proxyUpload(
      new Request(
        "http://localhost/api/assets/upload?name=customer-with-thumbnail.jpg",
        {
          method: "POST",
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(uploaded.byteLength),
          },
          body: uploaded,
        },
      ),
    );
    const saved = (await response.json()) as {
      id: string;
      kind: "image";
      storageKey: string;
      size: number;
      metadata: Record<string, unknown>;
    };
    expect(response.status).toBe(201);
    expect(saved.size).toBe(fixture.bytes.byteLength);
    expect(saved.metadata).toMatchObject({
      originalUploadSize: uploaded.byteLength,
      trimmedTrailingBytes: true,
      repaired: false,
    });
    const original = objects.get(saved.storageKey)!;
    expect(original.bytes).toEqual(fixture.bytes);
    expect(
      Buffer.from(original.bytes).indexOf(Buffer.from([0xff, 0xd9])),
    ).toBeLessThan(original.bytes.byteLength - 2);
    expect(
      await sharp(original.bytes, { failOn: "error" }).metadata(),
    ).toMatchObject({
      width: fixture.width,
      height: fixture.height,
      format: "jpeg",
    });
    const preview = await getOrCreateAssetPreview(mocks.storage, saved, 640);
    expect(preview).not.toBeNull();
    expect(await sharp(preview!, { failOn: "error" }).metadata()).toMatchObject(
      { width: fixture.width, height: fixture.height, format: "webp" },
    );
    // Drain the same two preview jobs scheduled by the route before mocks reset.
    await getOrCreateAssetPreview(mocks.storage, saved, 160);
  });

  it("refuses a header-only JPEG that cannot decode into an image", async () => {
    const response = await proxyUpload(
      new Request("http://localhost/api/assets/upload?name=broken.jpg", {
        method: "POST",
        headers: { "content-type": "image/jpeg" },
        body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.storage.put).not.toHaveBeenCalled();
    expect(mocks.repository.saveAsset).not.toHaveBeenCalled();
  });

  it("rejects an oversized multipart body before parsing it", async () => {
    const response = await proxyUpload(
      new Request("http://localhost/api/assets/upload", {
        method: "POST",
        headers: {
          "content-length": String(600 * 1024 * 1024),
          "content-type": "multipart/form-data; boundary=e2e",
        },
      }),
    );

    expect(response.status).toBe(413);
  });

  it("accepts a raw browser file body without multipart parsing", async () => {
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const response = await proxyUpload(
      new Request(
        "http://localhost/api/assets/upload?name=large-reference.png",
        {
          method: "POST",
          headers: {
            "content-length": String(bytes.byteLength),
            "content-type": "image/png",
          },
          body: bytes,
        },
      ),
    );

    expect(response.status).toBe(201);
    expect(mocks.storage.put).toHaveBeenCalledOnce();
    expect(mocks.repository.saveAsset).toHaveBeenCalledOnce();
  });

  it("strips WeChat bytes appended after a complete image", async () => {
    const completePng = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const wechatBytes = Uint8Array.from([...completePng, 9, 8, 7, 6]);
    const response = await proxyUpload(
      new Request(
        "http://localhost/api/assets/upload?name=wechat-reference.png",
        {
          method: "POST",
          headers: {
            "content-length": String(wechatBytes.byteLength),
            "content-type": "image/png",
          },
          body: wechatBytes,
        },
      ),
    );

    expect(response.status).toBe(201);
    expect(mocks.storage.put).toHaveBeenCalledWith(
      expect.any(String),
      completePng,
      "image/png",
    );
    expect(mocks.repository.saveAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        size: completePng.byteLength,
        metadata: expect.objectContaining({
          originalUploadSize: wechatBytes.byteLength,
          trimmedTrailingBytes: true,
          repaired: false,
        }),
      }),
    );
  });

  it("returns the first asset when the same upload is retried", async () => {
    const id = "d5916e5d-e4f8-4b14-8d71-7a976768c5e3";
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    mocks.repository.getAsset.mockResolvedValueOnce({
      ...asset,
      id,
      name: "wechat.png",
      kind: "image",
      mimeType: "image/png",
      size: bytes.byteLength,
      storageKey: `assets/${id}/original.png`,
    });

    const response = await proxyUpload(
      new Request(
        `http://localhost/api/assets/upload?name=wechat.png&id=${id}`,
        {
          method: "POST",
          headers: {
            "content-length": String(bytes.byteLength),
            "content-type": "image/png",
          },
          body: bytes,
        },
      ),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe(id);
    expect(mocks.storage.put).not.toHaveBeenCalled();
    expect(mocks.repository.saveAsset).not.toHaveBeenCalled();
  });

  it("rejects a raw upload truncated before the route handler", async () => {
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const response = await proxyUpload(
      new Request("http://localhost/api/assets/upload?name=truncated.png", {
        method: "POST",
        headers: {
          "content-length": String(bytes.byteLength + 100),
          "content-type": "image/png",
        },
        body: bytes,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Upload body was incomplete; please upload the file again",
    });
    expect(mocks.storage.put).not.toHaveBeenCalled();
    expect(mocks.repository.saveAsset).not.toHaveBeenCalled();
  });

  it("rejects oversized raw file bodies before reading them", async () => {
    const response = await proxyUpload(
      new Request("http://localhost/api/assets/upload?name=too-large.png", {
        method: "POST",
        headers: {
          "content-length": String(600 * 1024 * 1024),
          "content-type": "image/png",
        },
      }),
    );

    expect(response.status).toBe(413);
  });

  it("rejects MIME spoofing before writing to storage", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(
        [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        "fake.jpg",
        { type: "image/jpeg" },
      ),
    );
    const response = await proxyUpload(
      new Request("http://localhost/api/assets/upload", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.storage.put).not.toHaveBeenCalled();
    expect(mocks.repository.saveAsset).not.toHaveBeenCalled();
  });
});

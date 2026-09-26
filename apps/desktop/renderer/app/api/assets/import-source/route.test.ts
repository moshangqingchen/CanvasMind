import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import type { StoredObject } from "@super-canvas/storage";
import { createJpegWithExifThumbnailFixture } from "../jpeg-test-fixture";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  saveAsset: vi.fn(),
  put: vi.fn(),
  getOrCreateAssetPreview: vi.fn(async () => undefined),
}));

vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("../../../../lib/asset-preview", () => ({
  getOrCreateAssetPreview: mocks.getOrCreateAssetPreview,
}));
vi.mock("../../../../lib/server", () => ({
  repository: { saveAsset: mocks.saveAsset },
  storage: { put: mocks.put },
  jsonError(message: string, status = 400) {
    return Response.json({ error: message }, { status });
  },
}));

import { isPublicMediaAddress, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.put.mockResolvedValue(undefined);
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.saveAsset.mockImplementation(
    async (input: Record<string, unknown>) => ({
      ...input,
      createdAt: "2026-08-24T00:00:00.000Z",
      deleted: false,
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("dragged media source import", () => {
  it("blocks loopback, private, and documentation network addresses", () => {
    expect(isPublicMediaAddress("127.0.0.1")).toBe(false);
    expect(isPublicMediaAddress("10.1.2.3")).toBe(false);
    expect(isPublicMediaAddress("192.168.1.2")).toBe(false);
    expect(isPublicMediaAddress("::1")).toBe(false);
    expect(isPublicMediaAddress("2001:db8::1")).toBe(false);
    expect(isPublicMediaAddress("93.184.216.34")).toBe(true);
    expect(isPublicMediaAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("downloads a public image, detects its real type, and stores it", async () => {
    const { bytes } = await createJpegWithExifThumbnailFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(bytes, {
            status: 200,
            headers: {
              "content-type": "application/octet-stream",
              "content-disposition":
                "attachment; filename*=UTF-8''%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87.jpg",
            },
          }),
      ),
    );

    const response = await POST(
      new Request("http://127.0.0.1:3210/api/assets/import-source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: ["https://cdn.example.test/media/download?id=1"],
        }),
      }),
    );
    const body = (await response.json()) as {
      assets: Array<{ name: string; mimeType: string }>;
      failures: unknown[];
    };

    expect(response.status).toBe(201);
    expect(body.failures).toEqual([]);
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0]).toMatchObject({
      name: "微信图片.jpg",
      mimeType: "image/jpeg",
    });
    expect(mocks.put).toHaveBeenCalledWith(
      expect.stringMatching(/^assets\/.+\/original\.jpg$/u),
      expect.any(Uint8Array),
      "image/jpeg",
    );
    expect(mocks.saveAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "image",
        mimeType: "image/jpeg",
        metadata: {
          source: "remote-drop",
          sourceHost: "cdn.example.test",
        },
      }),
    );
  });

  it("refuses an SSRF target before issuing a download", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(
      new Request("http://127.0.0.1:3210/api/assets/import-source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: ["http://127.0.0.1/private.jpg"],
        }),
      }),
    );
    const body = (await response.json()) as {
      assets: unknown[];
      failures: Array<{ message: string }>;
    };

    expect(response.status).toBe(422);
    expect(body.assets).toEqual([]);
    expect(body.failures[0]?.message).toContain("内网");
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("rejects header-only JPEG downloads instead of storing an unusable picture", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
            headers: { "content-type": "image/jpeg" },
          }),
      ),
    );
    const response = await POST(
      new Request("http://127.0.0.1:3210/api/assets/import-source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: ["https://cdn.example.test/broken.jpg"],
        }),
      }),
    );
    expect(response.status).toBe(422);
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.saveAsset).not.toHaveBeenCalled();
  });

  it("reads a WeChat-style cache file only through the loopback bridge", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "super-canvas-wx-"));
    const sourcePath = path.join(folder, "微信拖入.jpg");
    const { bytes } = await createJpegWithExifThumbnailFixture();
    await writeFile(sourcePath, bytes);
    try {
      const response = await POST(
        new Request("http://127.0.0.1:3210/api/assets/import-source", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sources: [pathToFileURL(sourcePath).href],
          }),
        }),
      );
      const body = (await response.json()) as {
        assets: Array<{ name: string }>;
        failures: unknown[];
      };

      expect(response.status).toBe(201);
      expect(body.failures).toEqual([]);
      expect(body.assets[0]?.name).toBe("微信拖入.jpg");
      expect(mocks.saveAsset).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { source: "desktop-drop" } }),
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("keeps a real JPEG with an EXIF thumbnail intact and can build a full-size canvas preview", async () => {
    const fixture = await createJpegWithExifThumbnailFixture();
    const originals = new Map<string, StoredObject>();
    mocks.put.mockImplementation(
      async (key: string, bytes: Uint8Array, contentType: string) => {
        originals.set(key, { bytes: new Uint8Array(bytes), contentType });
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(fixture.bytes, {
            headers: { "content-type": "image/jpeg" },
          }),
      ),
    );
    const response = await POST(
      new Request("http://127.0.0.1:3210/api/assets/import-source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: ["https://cdn.example.test/customer-with-thumbnail.jpg"],
        }),
      }),
    );
    const body = (await response.json()) as {
      assets: Array<{
        id: string;
        kind: "image";
        storageKey: string;
        size: number;
      }>;
      failures: unknown[];
    };
    expect(response.status).toBe(201);
    expect(body.failures).toEqual([]);
    const saved = body.assets[0]!;
    const original = originals.get(saved.storageKey)!;
    expect(saved.size).toBe(fixture.bytes.byteLength);
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
    const { getOrCreateAssetPreview } = await vi.importActual<
      typeof import("../../../../lib/asset-preview")
    >("../../../../lib/asset-preview");
    const preview = await getOrCreateAssetPreview(
      {
        get: async (key) => originals.get(key) ?? null,
        put: async (key, bytes, contentType) => {
          originals.set(key, { bytes, contentType });
        },
      },
      saved,
      640,
    );
    expect(preview).not.toBeNull();
    expect(await sharp(preview!, { failOn: "error" }).metadata()).toMatchObject(
      { width: fixture.width, height: fixture.height, format: "webp" },
    );
  });
});

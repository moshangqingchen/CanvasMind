import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const repository = {
    getAsset: vi.fn(),
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
    presignPut: vi.fn(),
    put: vi.fn(),
  };
  return { repository, storage };
});

vi.mock("../../../lib/server", () => ({
  repository: mocks.repository,
  storage: mocks.storage,
  jsonError(message: string, status = 400) {
    return Response.json({ error: message }, { status });
  },
}));

import { GET as getAssetContent } from "./[id]/content/route";
import { POST as completeUpload } from "./complete/route";
import { POST as createPresignedUpload } from "./presign/route";
import { POST as proxyUpload } from "./upload/route";
import { createUploadToken } from "../../../lib/upload-token";

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

function uploadToken(input: {
  id: string;
  storageKey: string;
  size: number;
  mimeType: string;
}) {
  return createUploadToken(input);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.repository.getAsset.mockResolvedValue(asset);
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
});

describe("asset content route", () => {
  it("serves a suffix range through storage.getRange without loading the object", async () => {
    const response = await getAssetContent(
      new Request("http://localhost/api/assets/asset-1/content", {
        headers: { range: "bytes=-3" },
      }),
      { params: Promise.resolve({ id: "asset-1" }) },
    );

    expect(response.status).toBe(206);
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

describe("direct upload routes", () => {
  it("passes the expected content length to presignPut", async () => {
    mocks.storage.presignPut.mockResolvedValue("https://storage.test/upload");
    const response = await createPresignedUpload(
      new Request("http://localhost/api/assets/presign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "photo.png",
          mimeType: "image/png",
          size: 42,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.storage.presignPut).toHaveBeenCalledWith(
      expect.stringMatching(/^assets\/.+\/original\.png$/u),
      "image/png",
      42,
      600,
    );
  });

  it("does not register an object whose HEAD metadata disagrees", async () => {
    mocks.storage.head.mockResolvedValue({
      size: 41,
      contentType: "image/png",
    });
    const response = await completeUpload(
      new Request("http://localhost/api/assets/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "asset-2",
          storageKey: "assets/asset-2/original.png",
          name: "photo.png",
          mimeType: "image/png",
          size: 42,
          uploadToken: uploadToken({
            id: "asset-2",
            storageKey: "assets/asset-2/original.png",
            size: 42,
            mimeType: "image/png",
          }),
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.repository.saveAsset).not.toHaveBeenCalled();
  });

  it("registers an object only after successful HEAD validation", async () => {
    mocks.storage.head.mockResolvedValue({
      size: 42,
      contentType: "image/png",
    });
    mocks.storage.getRange.mockResolvedValueOnce({
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      contentType: "image/png",
    });
    const response = await completeUpload(
      new Request("http://localhost/api/assets/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "asset-2",
          storageKey: "assets/asset-2/original.png",
          name: "photo.png",
          mimeType: "image/png",
          size: 42,
          uploadToken: uploadToken({
            id: "asset-2",
            storageKey: "assets/asset-2/original.png",
            size: 42,
            mimeType: "image/png",
          }),
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.repository.saveAsset).toHaveBeenCalledOnce();
  });

  it("rejects a direct upload whose bytes do not match its MIME", async () => {
    mocks.storage.head.mockResolvedValue({
      size: 42,
      contentType: "image/png",
    });
    mocks.storage.getRange.mockResolvedValueOnce({
      bytes: Uint8Array.from([0, 1, 2, 3]),
      contentType: "image/png",
    });
    const response = await completeUpload(
      new Request("http://localhost/api/assets/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "asset-2",
          storageKey: "assets/asset-2/original.png",
          name: "photo.png",
          mimeType: "image/png",
          size: 42,
          uploadToken: uploadToken({
            id: "asset-2",
            storageKey: "assets/asset-2/original.png",
            size: 42,
            mimeType: "image/png",
          }),
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.repository.saveAsset).not.toHaveBeenCalled();
  });

  it("rejects active SVG MIME types before issuing a direct upload", async () => {
    const response = await createPresignedUpload(
      new Request("http://localhost/api/assets/presign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "image.svg",
          mimeType: "image/svg+xml",
          size: 42,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.storage.presignPut).not.toHaveBeenCalled();
  });
});

describe("proxy upload route", () => {
  it("rejects an oversized multipart body before parsing it", async () => {
    const response = await proxyUpload(
      new Request("http://localhost/api/assets/upload", {
        method: "POST",
        headers: { "content-length": String(600 * 1024 * 1024) },
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

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { detectMediaMimeType } from "../../media-utils";

const mocks = vi.hoisted(() => ({
  repository: { getAsset: vi.fn(), saveAsset: vi.fn() },
  storage: {
    get: vi.fn(),
    head: vi.fn(),
    getRange: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  archive: vi.fn(),
}));

vi.mock("../../../../../lib/server", () => ({
  repository: mocks.repository,
  storage: mocks.storage,
  jsonError: (message: string, status = 400) =>
    Response.json({ error: message }, { status }),
}));
vi.mock("../../../../../lib/project-service", () => ({
  archiveGeneratedAssetForFinished: mocks.archive,
}));

import { GET, HEAD } from "./route";

const width = 48;
const height = 24;
const pixels = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    pixels.set(
      x < 16 ? [255, 0, 0, 0] : x < 32 ? [255, 0, 0, 128] : [19, 87, 191, 255],
      (y * width + x) * 4,
    );
  }
}

const asset = {
  id: "generated-image",
  name: "生成/图片.PNG",
  kind: "image",
  mimeType: "image/png",
  storageKey: "assets/generated-image/original.png",
  metadata: { source: "generated" },
};
let original: Buffer;
let animation: Buffer;

function context() {
  return { params: Promise.resolve({ id: asset.id }) };
}

function download(format?: string, headers?: HeadersInit) {
  const query = new URLSearchParams({ download: "1" });
  if (format !== undefined) query.set("format", format);
  return GET(
    new Request(`http://localhost/api/assets/${asset.id}/content?${query}`, {
      headers,
    }),
    context(),
  );
}

function useStored(bytes: Uint8Array, contentType = "image/png") {
  mocks.storage.head.mockResolvedValue({ size: bytes.byteLength, contentType });
  mocks.storage.get.mockResolvedValue({ bytes, contentType });
}

beforeAll(async () => {
  original = await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const animationPixels = Buffer.alloc(12 * 24 * 3);
  for (let index = 0; index < 12 * 24; index += 1) {
    animationPixels.set(index < 12 * 12 ? [255, 0, 0] : [0, 0, 255], index * 3);
  }
  animation = await sharp(animationPixels, {
    raw: { width: 12, height: 24, pageHeight: 12, channels: 3 },
  })
    .gif({ delay: [100, 200], loop: 2 })
    .toBuffer();
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.repository.getAsset.mockResolvedValue(asset);
  mocks.archive.mockResolvedValue(undefined);
  useStored(original);
});

describe("explicit image download formats", () => {
  it("keeps imported audio/webm playable with its original MIME for HEAD, GET and Range", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    mocks.repository.getAsset.mockResolvedValue({ ...asset, kind: "audio", mimeType: "audio/webm", name: "voice.webm" });
    useStored(bytes, "audio/webm");
    const url = `http://localhost/api/assets/${asset.id}/content`;
    const head = await HEAD(new Request(url), context());
    expect(head.headers.get("content-type")).toBe("audio/webm");
    expect(head.headers.has("content-disposition")).toBe(false);
    const full = await GET(new Request(url), context());
    expect(full.headers.get("content-type")).toBe("audio/webm");
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);
    mocks.storage.getRange.mockResolvedValue({ bytes: bytes.slice(1, 3), contentType: "audio/webm" });
    const range = await GET(new Request(url, { headers: { range: "bytes=1-2" } }), context());
    expect(range.status).toBe(206);
    expect(range.headers.get("content-type")).toBe("audio/webm");
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(bytes.slice(1, 3));
  });
  it.each([
    ["png", "image/png"],
    ["webp", "image/webp"],
  ])("encodes %s at full dimensions and preserves alpha and visible pixels", async (format, mime) => {
    const response = await download(format);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(mime);
    expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(response.headers.get("content-disposition")).toContain(
      encodeURIComponent(`生成-图片.${format}`),
    );
    expect(detectMediaMimeType(bytes)).toBe(mime);
    expect(await sharp(bytes).metadata()).toMatchObject({
      width,
      height,
      hasAlpha: true,
      format,
    });
    const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();
    expect(decoded.filter((_, index) => index % 4 === 3)).toEqual(
      pixels.filter((_, index) => index % 4 === 3),
    );
    for (const x of [24, 40]) {
      expect(decoded.subarray(x * 4, x * 4 + 4)).toEqual(
        pixels.subarray(x * 4, x * 4 + 4),
      );
    }
    expect(mocks.storage.get).toHaveBeenCalledExactlyOnceWith(asset.storageKey);
    expect(mocks.archive).toHaveBeenCalledExactlyOnceWith(asset);
    expect(mocks.storage.put).not.toHaveBeenCalled();
    expect(mocks.storage.delete).not.toHaveBeenCalled();
    expect(mocks.repository.saveAsset).not.toHaveBeenCalled();
    await expect(mocks.storage.get.mock.results[0]!.value).resolves.toMatchObject({
      bytes: original,
    });
  });

  it.each(["jpg", "jpeg"])("encodes %s as a real JPEG with a white transparency background", async (format) => {
    const response = await download(format);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toContain(
      encodeURIComponent("生成-图片.jpg"),
    );
    expect(detectMediaMimeType(bytes)).toBe("image/jpeg");
    expect(await sharp(bytes).metadata()).toMatchObject({
      width,
      height,
      format: "jpeg",
      hasAlpha: false,
    });
    const decoded = await sharp(bytes).raw().toBuffer();
    const transparent = Array.from(decoded.subarray(8 * 3, 8 * 3 + 3));
    expect(transparent.every((value) => value >= 253)).toBe(true);
    const translucent = Array.from(decoded.subarray(24 * 3, 24 * 3 + 3));
    expect(translucent[0]).toBeGreaterThanOrEqual(252);
    expect(translucent[1]).toBeGreaterThanOrEqual(124);
    expect(translucent[1]).toBeLessThanOrEqual(130);
    expect(translucent[2]).toBeGreaterThanOrEqual(124);
    expect(translucent[2]).toBeLessThanOrEqual(130);
  });

  it.each([undefined, "original"])("preserves the complete original bytes for format=%s", async (format) => {
    const response = await download(format);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toContain(
      encodeURIComponent("生成-图片.PNG"),
    );
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(mocks.archive).toHaveBeenCalledExactlyOnceWith(asset);
    expect(mocks.storage.put).not.toHaveBeenCalled();
  });

  it("returns the complete converted representation when a source range is requested", async () => {
    const response = await download("jpg", { range: "bytes=0-7" });
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("none");
    expect(response.headers.get("content-range")).toBeNull();
    expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("x-download-options")).toBe("noopen");
    expect(await sharp(bytes).metadata()).toMatchObject({ width, height });
    expect(mocks.storage.getRange).not.toHaveBeenCalled();
  });

  it("answers converted HEAD without encoding, archiving, or advertising the original byte length", async () => {
    const response = await HEAD(
      new Request(`http://localhost/api/assets/${asset.id}/content?download=1&format=webp`, {
        method: "HEAD",
        headers: { range: "bytes=-3" },
      }),
      context(),
    );
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-disposition")).toContain(
      encodeURIComponent("生成-图片.webp"),
    );
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("content-range")).toBeNull();
    expect(response.headers.get("accept-ranges")).toBe("none");
    expect(mocks.storage.get).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("preserves the displayed EXIF orientation without reducing the image", async () => {
    const oriented = await sharp(original).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    useStored(oriented, "image/jpeg");
    const response = await download("png");
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect(metadata).toMatchObject({ width: height, height: width, format: "png" });
    expect(metadata.orientation).toBeUndefined();
  });

  it("keeps every animation frame, duration and loop when downloading WebP", async () => {
    useStored(animation, "image/gif");
    const response = await download("webp");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(await sharp(bytes, { animated: true }).metadata()).toMatchObject({
      format: "webp",
      width: 12,
      pageHeight: 12,
      pages: 2,
      delay: [100, 200],
      loop: 2,
    });
    const frames = await sharp(bytes, { animated: true }).removeAlpha().raw().toBuffer();
    expect(Array.from(frames.subarray(0, 3))).toEqual([255, 0, 0]);
    expect(Array.from(frames.subarray(12 * 12 * 3, 12 * 12 * 3 + 3))).toEqual([0, 0, 255]);
  });

  it.each(["png", "jpg"])("rejects animated %s conversion instead of discarding frames", async (format) => {
    useStored(animation, "image/gif");
    const response = await download(format);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("WebP");
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.storage.put).not.toHaveBeenCalled();
  });

  it.each(["png", "jpg", "webp"])("rejects APNG %s conversion even though the decoder does not report its animation", async (format) => {
    // Valid 1x1 RGBA APNG: red then green, 100 ms per frame, infinite loop.
    const apng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAABAAAAAQAAAAAAAAAAAAEACgAAWn8w0AAAAA1JREFUeJxj+M/A8B8ABQAB/4mZPR0AAAAaZmNUTAAAAAEAAAABAAAAAQAAAAAAAAAAAAEACgAAwQzaBAAAABFmZEFUAAAAAnicY2D4z/AfAAQBAf9i5+mcAAAAAElFTkSuQmCC",
      "base64",
    );
    expect(await sharp(apng).metadata()).toMatchObject({ width: 1, height: 1, format: "png" });
    useStored(apng);
    const response = await download(format);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("APNG");
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.storage.put).not.toHaveBeenCalled();
    const originalResponse = await download("original");
    expect(Buffer.from(await originalResponse.arrayBuffer())).toEqual(apng);
  });

  it.each(["gif", "svg", "", "../../png"])("rejects unsupported format %s before reading or archiving the original", async (format) => {
    const response = await download(format);
    expect(response.status).toBe(400);
    expect(mocks.storage.get).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("requires an explicit download before converting", async () => {
    const response = await GET(
      new Request(`http://localhost/api/assets/${asset.id}/content?format=png`),
      context(),
    );
    expect(response.status).toBe(400);
    expect(mocks.storage.get).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("rejects conversion of video assets without reading the file", async () => {
    mocks.repository.getAsset.mockResolvedValue({ ...asset, kind: "video", mimeType: "video/mp4" });
    const response = await download("jpg");
    expect(response.status).toBe(415);
    expect(mocks.storage.get).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("rejects non-raster bytes even when the stored MIME claims PNG", async () => {
    useStored(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'));
    const response = await download("png");
    expect(response.status).toBe(415);
    expect((await response.json()).error).toContain("原文件");
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("returns a useful conversion error for truncated image bytes", async () => {
    useStored(original.subarray(0, 40));
    const response = await download("webp");
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("原文件");
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("returns 404 when the original disappears between metadata and body reads", async () => {
    mocks.storage.get.mockResolvedValue(null);
    const response = await download("png");
    expect(response.status).toBe(404);
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("keeps downloads available when archiving the original fails", async () => {
    mocks.archive.mockRejectedValue(new Error("project directory unavailable"));
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await download("jpg");
      expect(response.status).toBe(200);
      expect(detectMediaMimeType(new Uint8Array(await response.arrayBuffer()))).toBe("image/jpeg");
      expect(logging).toHaveBeenCalledOnce();
    } finally {
      logging.mockRestore();
    }
  });
});

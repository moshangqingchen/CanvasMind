import { describe, expect, it, vi } from "vitest";

import {
  droppedMediaUrlsFromStrings,
  filesFromDroppedMediaUrls,
  mapWithConcurrency,
  normalizeClipboardImageFile,
  normalizeDraggedMediaFile,
  prepareImportableMediaFile,
  preferNamedClipboardImages,
  sniffImageMimeType,
} from "./dropped-media";

describe("cross-application media drops", () => {
  it("detects a HEIC hidden behind a JPG filename and converts it", async () => {
    const header = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
      0x00, 0x00, 0x00, 0x00,
    ]);
    expect(sniffImageMimeType(header)).toBe("image/heic");
    const source = new File([header], "微信照片.jpg", { type: "image/jpeg" });
    const converter = vi.fn(
      async () =>
        new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
          type: "image/jpeg",
        }),
    );

    const prepared = await prepareImportableMediaFile(source, converter);
    expect(converter).toHaveBeenCalledWith(source);
    expect(prepared).toMatchObject({
      name: "微信照片.jpg",
      type: "image/jpeg",
      size: 4,
    });
    expect(prepared).not.toBe(source);
  });

  it("keeps a HEIC clipboard file until the async converter can handle it", () => {
    const source = new File(
      [
        new Uint8Array([
          0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
        ]),
      ],
      "剪贴板图片.heic",
      { type: "image/heic" },
    );

    expect(normalizeClipboardImageFile(source, 0, 123)).toBe(source);
  });

  it("corrects a WebP mislabeled as JPG without re-encoding its bytes", async () => {
    const bytes = new Uint8Array(16);
    bytes.set(new TextEncoder().encode("RIFF"), 0);
    bytes.set(new TextEncoder().encode("WEBP"), 8);
    const source = new File([bytes], "错误扩展名.jpg", { type: "image/jpeg" });

    const prepared = await prepareImportableMediaFile(source);
    expect(prepared).toMatchObject({
      name: "错误扩展名.webp",
      type: "image/webp",
      size: bytes.byteLength,
    });
    expect(new Uint8Array(await prepared!.arrayBuffer())).toEqual(bytes);
  });

  it("converts AVIF and other browser-decodable images to PNG", async () => {
    const avifHeader = new Uint8Array([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
    ]);
    const source = new File([avifHeader], "参考图.avif", {
      type: "image/avif",
    });
    const converter = vi.fn(
      async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    );

    const prepared = await prepareImportableMediaFile(
      source,
      undefined,
      converter,
    );
    expect(converter).toHaveBeenCalledWith(source);
    expect(prepared).toMatchObject({
      name: "参考图.png",
      type: "image/png",
      size: 3,
    });
  });

  it("converts GIF references to a provider-safe PNG", async () => {
    const source = new File([new TextEncoder().encode("GIF89a")], "动图.gif", {
      type: "image/gif",
    });
    const converter = vi.fn(
      async () => new Blob([new Uint8Array([4, 5])], { type: "image/png" }),
    );

    const prepared = await prepareImportableMediaFile(
      source,
      undefined,
      converter,
    );
    expect(prepared).toMatchObject({
      name: "动图.png",
      type: "image/png",
      size: 2,
    });
  });

  it("extracts media sources from HTML, URI-list, and DownloadURL drags", () => {
    expect(
      droppedMediaUrlsFromStrings([
        {
          type: "text/html",
          data: '<div><img src="https://cdn.example.test/a.png?x=1&amp;y=2"></div>',
        },
        {
          type: "text/uri-list",
          data: "# comment\r\nhttps://cdn.example.test/b.jpg\r\n",
        },
        {
          type: "DownloadURL",
          data: "image/webp:wechat.webp:https://cdn.example.test/c.webp",
        },
      ]),
    ).toEqual([
      "https://cdn.example.test/a.png?x=1&y=2",
      "https://cdn.example.test/b.jpg",
      "https://cdn.example.test/c.webp",
    ]);
  });

  it("keeps WeChat file URLs and Windows cache paths for the local importer", () => {
    expect(
      droppedMediaUrlsFromStrings([
        {
          type: "text/html",
          data: '<img src="file:///C:/Users/Test/AppData/Local/Temp/wx/photo.jpg">',
        },
        {
          type: "text/plain",
          data: "C:\\Users\\Test\\Documents\\xwechat_files\\clip.mp4\0",
        },
      ]),
    ).toEqual([
      "file:///C:/Users/Test/AppData/Local/Temp/wx/photo.jpg",
      "C:\\Users\\Test\\Documents\\xwechat_files\\clip.mp4",
    ]);
  });

  it("extracts a media link when a desktop drag wraps it in an anchor", () => {
    expect(
      droppedMediaUrlsFromStrings([
        {
          type: "text/html",
          data: '<a href="https://cdn.example.test/wechat/video.mp4">video</a>',
        },
      ]),
    ).toEqual(["https://cdn.example.test/wechat/video.mp4"]);
  });

  it("turns a fetchable URL drag into an uploadable image File", async () => {
    const pngBytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const fetcher = vi.fn(
      async () =>
        new Response(pngBytes, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    ) as unknown as typeof fetch;

    const files = await filesFromDroppedMediaUrls(
      ["https://cdn.example.test/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87.png"],
      123,
      fetcher,
    );
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      name: "微信图片.png",
      type: "image/png",
      size: pngBytes.byteLength,
      lastModified: 123,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://cdn.example.test/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87.png",
      { credentials: "omit", referrerPolicy: "no-referrer" },
    );
  });

  it("infers a PNG MIME type when a native Electron drag leaves it empty", () => {
    const source = new File([new Uint8Array([1, 2, 3])], "参考图.PNG", {
      type: "",
      lastModified: 123,
    });
    const normalized = normalizeDraggedMediaFile(source);
    expect(normalized).not.toBeNull();
    expect(normalized?.type).toBe("image/png");
    expect(normalized?.name).toBe(source.name);
    expect(normalized?.lastModified).toBe(source.lastModified);
  });

  it("keeps already supported browser files unchanged", () => {
    const source = new File([new Uint8Array([1])], "clip.mp4", {
      type: "video/mp4",
    });
    expect(normalizeDraggedMediaFile(source)).toBe(source);
  });

  it("rejects unsupported native files", () => {
    const source = new File([new Uint8Array([1])], "notes.txt", { type: "" });
    expect(normalizeDraggedMediaFile(source)).toBeNull();
  });

  it("rejects empty virtual files so a WeChat URL/path fallback can run", () => {
    const source = new File([], "微信占位图.jpg", { type: "image/jpeg" });
    expect(normalizeDraggedMediaFile(source)).toBeNull();
  });

  it("rejects a non-empty WeChat image placeholder before upload", async () => {
    const source = new File([new Uint8Array([1, 2, 3])], "微信占位图.jpg", {
      type: "image/jpeg",
    });

    expect(await prepareImportableMediaFile(source)).toBeNull();
  });

  it("names a clipboard PNG that has no filename", () => {
    const source = new File([new Uint8Array([1, 2, 3])], "", {
      type: "image/png",
      lastModified: 0,
    });

    const normalized = normalizeClipboardImageFile(source, 1, 123);
    expect(normalized?.name).toBe("剪贴板图片-123-2.png");
    expect(normalized?.type).toBe("image/png");
    expect(normalized?.lastModified).toBe(123);
  });

  it("only accepts uploadable image formats from the clipboard", () => {
    expect(
      normalizeClipboardImageFile(
        new File([new Uint8Array([1])], "clip.mp4", { type: "video/mp4" }),
        0,
      ),
    ).toBeNull();
    expect(
      normalizeClipboardImageFile(
        new File(["<svg/>"], "clip.svg", { type: "image/svg+xml" }),
        0,
      ),
    ).toBeNull();
  });

  it("prefers an Explorer filename over a generic clipboard bitmap", () => {
    const generic = new File([new Uint8Array([1])], "clipboard.png", {
      type: "image/png",
    });
    const explorerFile = new File([new Uint8Array([2])], "333.png", {
      type: "image/png",
    });

    expect(preferNamedClipboardImages([generic, explorerFile])).toEqual([
      explorerFile,
    ]);
    expect(preferNamedClipboardImages([generic])).toEqual([generic]);
  });

  it("maps media in order without exceeding the upload concurrency", async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await mapWithConcurrency(
      [30, 5, 15, 1],
      2,
      async (delay) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, delay));
        active -= 1;
        return delay * 2;
      },
    );

    expect(results).toEqual([60, 10, 30, 2]);
    expect(maximumActive).toBe(2);
  });
});

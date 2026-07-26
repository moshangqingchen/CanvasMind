import { describe, expect, it } from "vitest";
import {
  MAX_DIRECT_UPLOAD_BYTES,
  detectMediaMimeType,
  mediaKindForMime,
  parseByteRange,
  sanitizedAssetExtension,
  validateCompletedUpload,
  validateMediaMagic,
} from "./media-utils";

const ascii = (value: string): number[] =>
  [...value].map((character) => character.charCodeAt(0));

describe("media magic validation", () => {
  it("keeps the direct-upload ceiling inside PostgreSQL int4", () => {
    expect(MAX_DIRECT_UPLOAD_BYTES).toBe(2_147_483_647);
  });

  it("only accepts passive media MIME types", () => {
    expect(mediaKindForMime("image/svg+xml")).toBeNull();
    expect(mediaKindForMime("image/png")).toBe("image");
    expect(mediaKindForMime("video/mp4")).toBe("video");
    expect(mediaKindForMime("audio/mpeg")).toBe("audio");
  });

  it.each([
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0]],
    ["image/gif", ascii("GIF89a")],
    ["image/webp", [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]],
    ["video/mp4", [0, 0, 0, 20, ...ascii("ftyp"), ...ascii("isom")]],
    ["video/quicktime", [0, 0, 0, 20, ...ascii("ftyp"), ...ascii("qt  ")]],
    ["video/webm", [0x1a, 0x45, 0xdf, 0xa3, 0, 0, ...ascii("webm")]],
    ["audio/mpeg", ascii("ID3")],
    ["audio/wav", [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")]],
    ["audio/mp4", [0, 0, 0, 20, ...ascii("ftyp"), ...ascii("M4A ")]],
  ])("detects %s", (mimeType, bytes) => {
    expect(detectMediaMimeType(Uint8Array.from(bytes))).toBe(mimeType);
    expect(validateMediaMagic(Uint8Array.from(bytes), mimeType)).toMatchObject({
      valid: true,
      detectedMimeType: mimeType,
    });
  });

  it("rejects a declared MIME type that disagrees with file bytes", () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(validateMediaMagic(png, "image/jpeg")).toMatchObject({
      valid: false,
      detectedMimeType: "image/png",
    });
  });

  it("uses canonical extensions and sanitizes unknown extensions", () => {
    expect(sanitizedAssetExtension("../../photo.exe", "image/png")).toBe("png");
    expect(
      sanitizedAssetExtension("clip.bad/../M@T!R%O$S#K^A", "video/custom"),
    ).toBe("mtroska");
  });
});

describe("completed direct upload validation", () => {
  it("accepts metadata only when size and MIME match", () => {
    expect(
      validateCompletedUpload(42, "image/jpg", {
        size: 42,
        contentType: "image/jpeg",
      }),
    ).toEqual({ valid: true, kind: "image", mimeType: "image/jpeg" });
  });

  it("rejects mismatched sizes before MIME validation", () => {
    expect(
      validateCompletedUpload(42, "image/png", {
        size: 41,
        contentType: "image/png",
      }),
    ).toEqual({ valid: false, reason: "size_mismatch" });
  });

  it("rejects non-media and incompatible stored Content-Types", () => {
    expect(
      validateCompletedUpload(42, "image/png", {
        size: 42,
        contentType: "application/octet-stream",
      }),
    ).toEqual({ valid: false, reason: "invalid_content_type" });
    expect(
      validateCompletedUpload(42, "image/png", {
        size: 42,
        contentType: "image/jpeg",
      }),
    ).toEqual({ valid: false, reason: "mime_mismatch" });
  });

  it("can require a bounded magic probe for direct uploads", () => {
    expect(
      validateCompletedUpload(
        42,
        "image/png",
        { size: 42, contentType: "image/png" },
        Uint8Array.from([0, 1, 2, 3]),
      ),
    ).toEqual({ valid: false, reason: "content_mismatch" });
  });
});

describe("parseByteRange", () => {
  it("parses closed, open-ended, and suffix ranges", () => {
    expect(parseByteRange("bytes=2-5", 10)).toEqual({
      valid: true,
      start: 2,
      end: 5,
    });
    expect(parseByteRange("bytes=7-", 10)).toEqual({
      valid: true,
      start: 7,
      end: 9,
    });
    expect(parseByteRange("bytes=-3", 10)).toEqual({
      valid: true,
      start: 7,
      end: 9,
    });
    expect(parseByteRange("bytes=-99", 10)).toEqual({
      valid: true,
      start: 0,
      end: 9,
    });
  });

  it.each([
    "items=0-1",
    "bytes=-",
    "bytes=10-",
    "bytes=5-3",
    "bytes=0-1,4-5",
    "bytes=-0",
    "bytes=9007199254740992-",
  ])("rejects an invalid or unsatisfiable range: %s", (header) => {
    expect(parseByteRange(header, 10)).toEqual({ valid: false });
  });
});

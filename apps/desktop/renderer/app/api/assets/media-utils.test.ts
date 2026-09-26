import { describe, expect, it } from "vitest";
import {
  completeMediaPayload,
  detectMediaMimeType,
  mediaKindForMime,
  parseByteRange,
  sanitizedAssetExtension,
  validateCompletedUpload,
  validateMediaCompleteness,
  validateMediaMagic,
} from "./media-utils";

const ascii = (value: string): number[] =>
  [...value].map((character) => character.charCodeAt(0));

// Marker framing fixtures intentionally avoid a pixel encoder: these tests
// verify byte boundaries, while upload/preview tests cover actual decoding.
const jpegSegment = (marker: number, payload: number[]): number[] => [
  0xff,
  marker,
  (payload.length + 2) >> 8,
  (payload.length + 2) & 0xff,
  ...payload,
];
const jpegFrame = (marker = 0xc0, height = 1): number[] =>
  jpegSegment(marker, [8, height >> 8, height & 0xff, 0, 1, 1, 1, 0x11, 0]);
const jpegScan = (entropy = [0x42]): number[] => [
  ...jpegSegment(0xda, [1, 1, 0, 0, 63, 0]),
  ...entropy,
];
const framedJpeg = (...segments: number[][]): Uint8Array =>
  Uint8Array.from([0xff, 0xd8, ...segments.flat(), 0xff, 0xd9]);

describe("media magic validation", () => {
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

  it("distinguishes HEIC and AVIF images from ordinary MP4 video", () => {
    expect(
      detectMediaMimeType(
        Uint8Array.from([0, 0, 0, 20, ...ascii("ftyp"), ...ascii("heic")]),
      ),
    ).toBe("image/heic");
    expect(
      detectMediaMimeType(
        Uint8Array.from([0, 0, 0, 20, ...ascii("ftyp"), ...ascii("avif")]),
      ),
    ).toBe("image/avif");
  });

  it("detects truncated image bodies after upload", () => {
    const pngEnd = [
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];
    expect(
      validateMediaCompleteness(
        Uint8Array.from([
          0x89,
          0x50,
          0x4e,
          0x47,
          0x0d,
          0x0a,
          0x1a,
          0x0a,
          ...pngEnd,
        ]),
        "image/png",
      ),
    ).toBe(true);
    expect(
      validateMediaCompleteness(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/png",
      ),
    ).toBe(false);
  });

  it("removes desktop-app bytes appended after an image end marker", () => {
    const original = framedJpeg(jpegFrame(), jpegScan());
    const jpeg = Uint8Array.from([...original, 9, 8, 7]);
    expect(completeMediaPayload(jpeg, "image/jpeg")).toEqual(original);

    const pngEnd = [
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];
    const png = Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...pngEnd,
      9,
      8,
      7,
    ]);
    expect(completeMediaPayload(png, "image/png")?.byteLength).toBe(20);
    expect(validateMediaCompleteness(png, "image/png")).toBe(true);
  });

  it("uses canonical extensions and sanitizes unknown extensions", () => {
    expect(sanitizedAssetExtension("../../photo.exe", "image/png")).toBe("png");
    expect(
      sanitizedAssetExtension("clip.bad/../M@T!R%O$S#K^A", "video/custom"),
    ).toBe("mtroska");
  });
});

describe("JPEG payload boundaries", () => {
  it("preserves the whole main image when EXIF contains a complete JPEG thumbnail", () => {
    const thumbnail = framedJpeg(jpegFrame(), jpegScan());
    const app = jpegSegment(0xe1, [
      ...ascii("Exif\0\0"),
      ...thumbnail,
      0x10,
      0x11,
    ]);
    const original = framedJpeg(
      app,
      jpegFrame(),
      jpegScan([0x13, 0xff, 0x00, 0x44]),
    );
    expect(original.indexOf(0xd9)).toBeLessThan(original.length - 1);
    expect(completeMediaPayload(original, "image/jpeg")).toEqual(original);
    // The former implementation saved precisely this truncated thumbnail end.
    const previouslyTruncated = original.slice(0, original.indexOf(0xd9) + 1);
    expect(completeMediaPayload(previouslyTruncated, "image/jpeg")).toBeNull();
    expect(validateMediaCompleteness(previouslyTruncated, "image/jpeg")).toBe(
      false,
    );
  });

  it("ignores EOI-shaped bytes inside length-delimited metadata/table segments", () => {
    for (const marker of [0xe0, 0xe2, 0xfe, 0xc4, 0xdb]) {
      const original = framedJpeg(
        jpegSegment(marker, [0x10, 0xff, 0xd9, 0x20]),
        jpegFrame(),
        jpegScan(),
      );
      expect(completeMediaPayload(original, "image/jpeg")).toEqual(original);
    }
  });

  it("finds the main EOI rather than a later fake marker or second JPEG in desktop trailing bytes", () => {
    const original = framedJpeg(jpegFrame(), jpegScan());
    const appended = Uint8Array.from([...original, 0, 0xff, 0xd9, ...original]);
    expect(completeMediaPayload(appended, "image/jpeg")).toEqual(original);
  });

  it("walks progressive scans with byte stuffing, restart markers, marker padding and inter-scan tables", () => {
    const original = framedJpeg(
      jpegFrame(0xc2),
      jpegScan([0x11, 0xff, 0x00, 0xd9, 0xff, 0xd0, 0x22, 0xff]),
      jpegSegment(0xc4, [0xff, 0xd9]),
      jpegScan([0x33, 0xff, 0xd7, 0x44]),
    );
    expect(completeMediaPayload(original, "image/jpeg")).toEqual(original);
    expect(validateMediaCompleteness(original.slice(0, -2), "image/jpeg")).toBe(
      false,
    );
  });

  it("handles DNL height declaration inside an entropy scan", () => {
    const original = framedJpeg(
      jpegFrame(0xc0, 0),
      jpegScan(),
      jpegSegment(0xdc, [0, 1]),
      [0x43],
    );
    expect(completeMediaPayload(original, "image/jpeg")).toEqual(original);
  });

  it.each([
    { label: "SOI and EOI only", bytes: [0xff, 0xd8, 0xff, 0xd9] },
    { label: "frame without a scan", bytes: [...framedJpeg(jpegFrame())] },
    { label: "scan without a frame", bytes: [...framedJpeg(jpegScan())] },
    {
      label: "empty entropy scan",
      bytes: [...framedJpeg(jpegFrame(), jpegScan([]))],
    },
    {
      label: "malformed segment length",
      bytes: [...framedJpeg([0xff, 0xe1, 0, 1], jpegFrame(), jpegScan())],
    },
    {
      label: "truncated segment with fake EOI",
      bytes: [0xff, 0xd8, 0xff, 0xe1, 0x10, 0, 0xff, 0xd9],
    },
    {
      label: "truncated scan header",
      bytes: [...framedJpeg(jpegFrame(), [0xff, 0xda, 0, 8, 1])],
    },
    {
      label: "duplicate frame",
      bytes: [...framedJpeg(jpegFrame(), jpegFrame(), jpegScan())],
    },
    {
      label: "unknown scan component",
      bytes: [
        ...framedJpeg(
          jpegFrame(),
          jpegSegment(0xda, [1, 2, 0, 0, 63, 0]),
          [0x42],
        ),
      ],
    },
    {
      label: "restart outside scan",
      bytes: [...framedJpeg([0xff, 0xd0], jpegFrame(), jpegScan())],
    },
    {
      label: "no real main EOI",
      bytes: [
        ...framedJpeg(jpegFrame(), jpegScan()).slice(0, -2),
        0xff,
        0x00,
        0xd9,
      ],
    },
    {
      label: "no main frame after embedded thumbnail",
      bytes: [
        ...framedJpeg(
          jpegSegment(0xe1, [...framedJpeg(jpegFrame(), jpegScan())]),
        ),
      ],
    },
  ])(
    "rejects $label instead of declaring the main image complete",
    ({ bytes }) => {
      expect(
        completeMediaPayload(Uint8Array.from(bytes), "image/jpeg"),
      ).toBeNull();
    },
  );
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

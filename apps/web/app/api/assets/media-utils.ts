export type MediaKind = "image" | "video" | "audio";

// PostgreSQL's legacy `asset.size` column is an int4. Keep the advertised
// two-gibibyte ceiling inside that column's signed range until the schema is
// migrated to bigint.
export const MAX_DIRECT_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 - 1;
export const MAX_PROXY_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MEDIA_MAGIC_PROBE_BYTES = 4 * 1024;

const MIME_ALIASES: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
  "video/x-quicktime": "video/quicktime",
  "audio/x-wav": "audio/wav",
  "audio/x-m4a": "audio/mp4",
};

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
};

// Keep the accepted set finite. In particular, SVG is intentionally excluded
// because it is an active document when served directly by a browser.
export const SUPPORTED_MEDIA_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
]);

export function normalizeMimeType(value: string): string {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return MIME_ALIASES[normalized] ?? normalized;
}

export function mediaKindForMime(value: string): MediaKind | null {
  const mimeType = normalizeMimeType(value);
  if (!SUPPORTED_MEDIA_MIME_TYPES.has(mimeType)) return null;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return null;
}

export function isSupportedMediaMimeType(value: string): boolean {
  return SUPPORTED_MEDIA_MIME_TYPES.has(normalizeMimeType(value));
}

export function areMimeTypesCompatible(
  declaredMimeType: string,
  storedMimeType: string,
): boolean {
  const declared = normalizeMimeType(declaredMimeType);
  const stored = normalizeMimeType(storedMimeType);
  return Boolean(
    declared &&
    stored &&
    mediaKindForMime(declared) &&
    mediaKindForMime(stored) &&
    declared === stored,
  );
}

export type CompletedUploadValidation =
  | { valid: true; kind: MediaKind; mimeType: string }
  | {
      valid: false;
      reason:
        | "size_mismatch"
        | "invalid_content_type"
        | "mime_mismatch"
        | "content_mismatch";
    };

export function validateCompletedUpload(
  declaredSize: number,
  declaredMimeType: string,
  metadata: { size: number; contentType?: string },
  probeBytes?: Uint8Array,
): CompletedUploadValidation {
  if (metadata.size !== declaredSize)
    return { valid: false, reason: "size_mismatch" };
  const storedMimeType = normalizeMimeType(metadata.contentType ?? "");
  const kind = mediaKindForMime(storedMimeType);
  if (!kind) return { valid: false, reason: "invalid_content_type" };
  if (!areMimeTypesCompatible(declaredMimeType, storedMimeType))
    return { valid: false, reason: "mime_mismatch" };
  if (probeBytes !== undefined) {
    const magic = validateMediaMagic(probeBytes, storedMimeType);
    if (!magic.valid) return { valid: false, reason: "content_mismatch" };
  }
  return { valid: true, kind, mimeType: storedMimeType };
}

export function sanitizedAssetExtension(
  name: string,
  mimeType: string,
): string {
  const canonical = EXTENSIONS[normalizeMimeType(mimeType)];
  if (canonical) return canonical;
  const candidate = name.includes(".")
    ? (name.split(".").pop() ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]/gu, "")
        .slice(0, 10)
    : "";
  const kind = mediaKindForMime(mimeType);
  return (
    candidate ||
    (kind === "video" ? "video" : kind === "audio" ? "audio" : "image")
  );
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset + value.length > bytes.byteLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function containsAscii(
  bytes: Uint8Array,
  value: string,
  limit: number,
): boolean {
  const end = Math.min(bytes.byteLength, limit) - value.length;
  for (let offset = 0; offset <= end; offset += 1) {
    if (asciiAt(bytes, offset, value)) return true;
  }
  return false;
}

export function detectMediaMimeType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a"))
    return "image/gif";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP"))
    return "image/webp";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE"))
    return "audio/wav";
  if (
    asciiAt(bytes, 0, "ID3") ||
    (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0)
  )
    return "audio/mpeg";
  if (asciiAt(bytes, 4, "ftyp"))
    return asciiAt(bytes, 8, "qt  ")
      ? "video/quicktime"
      : asciiAt(bytes, 8, "M4A ") || asciiAt(bytes, 8, "M4B ")
        ? "audio/mp4"
        : "video/mp4";
  if (
    startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) &&
    containsAscii(bytes, "webm", 4096)
  )
    return "video/webm";
  return null;
}

export interface MagicValidationResult {
  valid: boolean;
  declaredMimeType: string;
  detectedMimeType: string | null;
}

export function validateMediaMagic(
  bytes: Uint8Array,
  declaredMimeType: string,
): MagicValidationResult {
  const declared = normalizeMimeType(declaredMimeType);
  const detected = detectMediaMimeType(bytes);
  return {
    valid: detected !== null && areMimeTypesCompatible(declared, detected),
    declaredMimeType: declared,
    detectedMimeType: detected,
  };
}

export type ParsedByteRange =
  { valid: true; start: number; end: number } | { valid: false };

function parseRangeInteger(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseByteRange(
  header: string,
  totalSize: number,
): ParsedByteRange {
  if (!Number.isSafeInteger(totalSize) || totalSize <= 0)
    return { valid: false };
  const match = /^bytes=(\d*)-(\d*)$/iu.exec(header.trim());
  if (!match) return { valid: false };
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (!startText && !endText) return { valid: false };

  if (!startText) {
    const suffixLength = parseRangeInteger(endText);
    if (suffixLength === null || suffixLength <= 0) return { valid: false };
    return {
      valid: true,
      start: Math.max(totalSize - suffixLength, 0),
      end: totalSize - 1,
    };
  }

  const start = parseRangeInteger(startText);
  if (start === null || start >= totalSize) return { valid: false };
  if (!endText) return { valid: true, start, end: totalSize - 1 };
  const requestedEnd = parseRangeInteger(endText);
  if (requestedEnd === null || requestedEnd < start) return { valid: false };
  return { valid: true, start, end: Math.min(requestedEnd, totalSize - 1) };
}

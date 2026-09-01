const MEDIA_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  jp2: "image/jp2",
  ico: "image/x-icon",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

const SUPPORTED_MEDIA_MIME_TYPES = new Set(
  Object.values(MEDIA_MIME_BY_EXTENSION),
);

const IMAGE_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "png",
  "image/bmp": "png",
  "image/tiff": "png",
  "image/jp2": "png",
  "image/x-icon": "png",
};

const HEIF_IMAGE_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const MEDIA_EXTENSION_BY_MIME: Readonly<Record<string, string>> =
  Object.fromEntries([
    ...Object.entries(MEDIA_MIME_BY_EXTENSION).map(([extension, mimeType]) => [
      mimeType,
      extension === "jpeg" ? "jpg" : extension,
    ]),
    ["image/jpg", "jpg"],
    ["image/avif", "avif"],
    ["image/bmp", "bmp"],
    ["image/tiff", "tiff"],
    ["image/jp2", "jp2"],
    ["image/x-icon", "ico"],
  ]);

export interface DroppedStringPayload {
  type: string;
  data: string;
}

export type SniffedImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif"
  | "image/heic"
  | "image/avif";

export type HeicJpegConverter = (file: File) => Promise<Blob>;
export type RasterImageConverter = (file: File) => Promise<Blob>;

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset + value.length > bytes.byteLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

/** Detect the real image format instead of trusting WeChat's filename/MIME. */
export function sniffImageMimeType(
  bytes: Uint8Array,
): SniffedImageMimeType | null {
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    asciiAt(bytes, 1, "PNG\r\n\x1a\n")
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a"))
    return "image/gif";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP"))
    return "image/webp";
  if (asciiAt(bytes, 4, "ftyp")) {
    const brand = new TextDecoder("ascii").decode(bytes.slice(8, 12));
    if (
      new Set([
        "heic",
        "heix",
        "hevc",
        "hevx",
        "mif1",
        "msf1",
        "avif",
        "avis",
      ]).has(brand)
    )
      return brand === "avif" || brand === "avis" ? "image/avif" : "image/heic";
  }
  return null;
}

function fileNameForMime(name: string, mimeType: string): string {
  const extension = MEDIA_EXTENSION_BY_MIME[mimeType] ?? "jpg";
  const trimmed = name.trim() || "导入图片";
  const base = trimmed.replace(/\.[^.\\/]+$/u, "") || "导入图片";
  return `${base}.${extension}`;
}

async function convertHeicToJpeg(file: File): Promise<Blob> {
  const { heicTo } = await import("heic-to");
  return heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
}

/** Rasterize browser-decodable image formats into the upload-safe PNG format. */
async function convertImageToPng(file: File): Promise<Blob> {
  const maxPixels = 100_000_000;
  const drawToCanvas = async (
    source: CanvasImageSource,
    width: number,
    height: number,
  ): Promise<Blob> => {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height))
      throw new Error("图片尺寸无效");
    if (width <= 0 || height <= 0 || width * height > maxPixels)
      throw new Error("图片尺寸超过 1 亿像素，无法自动转换");

    const canvas =
      typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(width, height)
        : (() => {
            if (typeof document === "undefined")
              throw new Error("当前环境不支持图片转换");
            const element = document.createElement("canvas");
            element.width = width;
            element.height = height;
            return element;
          })();
    const context = canvas.getContext("2d");
    if (
      !context ||
      !("clearRect" in context) ||
      !("drawImage" in context)
    )
      throw new Error("当前环境不支持图片转换");
    context.clearRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    if ("convertToBlob" in canvas) {
      return canvas.convertToBlob({ type: "image/png" });
    }
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片转换失败"));
      }, "image/png");
    });
  };

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      return await drawToCanvas(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  }
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function")
    throw new Error("当前环境不支持图片转换");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    if (typeof image.decode === "function") await image.decode();
    else
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("图片解码失败"));
      });
    return await drawToCanvas(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Make a dropped/uploaded file acceptable to both browser previews and the
 * server. HEIC, AVIF, and GIF are decoded locally; mislabeled PNG/JPEG/WebP
 * files only need their MIME type and extension corrected, so their original
 * bytes stay lossless.
 */
export async function prepareImportableMediaFile(
  file: File,
  heicConverter: HeicJpegConverter = convertHeicToJpeg,
  imageConverter: RasterImageConverter = convertImageToPng,
): Promise<File | null> {
  const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const detectedImageType = sniffImageMimeType(header);
  if (detectedImageType === "image/heic") {
    if (file.size <= 0 || file.size > 100 * 1024 * 1024)
      throw new Error("HEIC 图片为空或超过 100 MB，无法自动转换");
    let converted: Blob;
    try {
      converted = await heicConverter(file);
    } catch {
      throw new Error(`HEIC 图片“${file.name}”自动转换失败`);
    }
    if (converted.size <= 0)
      throw new Error(`HEIC 图片“${file.name}”自动转换后为空`);
    return new File([converted], fileNameForMime(file.name, "image/jpeg"), {
      type: "image/jpeg",
      lastModified: file.lastModified || Date.now(),
    });
  }
  if (
    detectedImageType === "image/avif" ||
    detectedImageType === "image/gif"
  ) {
    if (file.size <= 0 || file.size > 100 * 1024 * 1024)
      throw new Error("图片为空或超过 100 MB，无法自动转换");
    try {
      const converted = await imageConverter(file);
      if (converted.size <= 0) return null;
      return new File([converted], fileNameForMime(file.name, "image/png"), {
        type: "image/png",
        lastModified: file.lastModified || Date.now(),
      });
    } catch {
      return null;
    }
  }
  if (detectedImageType) {
    const correctedName = fileNameForMime(file.name, detectedImageType);
    if (
      file.type.trim().toLowerCase() !== detectedImageType ||
      file.name !== correctedName
    )
      return new File([file], correctedName, {
        type: detectedImageType,
        lastModified: file.lastModified,
      });
    return file;
  }
  const declaredType = file.type.trim().toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const inferredType = MEDIA_MIME_BY_EXTENSION[extension];
  // WeChat can expose a non-empty placeholder File carrying only a familiar
  // filename. Do not upload those bytes as an image: returning null lets the
  // drop handler use the accompanying CDN URL or cache path instead.
  if (declaredType.startsWith("image/") || inferredType?.startsWith("image/")) {
    if (file.size > 100 * 1024 * 1024)
      throw new Error("图片超过 100 MB，无法自动转换");
    try {
      const converted = await imageConverter(file);
      if (converted.size <= 0) return null;
      return new File([converted], fileNameForMime(file.name, "image/png"), {
        type: "image/png",
        lastModified: file.lastModified || Date.now(),
      });
    } catch {
      return null;
    }
  }
  return normalizeDraggedMediaFile(file);
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
}

function normalizedDroppedMediaUrl(value: string): string | null {
  const candidate = decodeHtmlAttribute(value)
    .replace(/\0/gu, "")
    .trim()
    .replace(/^URL\s*=\s*/iu, "")
    .replace(/^['"]|['"]$/gu, "");
  // Windows desktop applications, including WeChat, may expose the resolved
  // cache file as text even when Chromium cannot materialize a File object.
  // The local import endpoint validates the resolved path against a small set
  // of user media/temp folders before it reads anything.
  if (/^[a-z]:[\\/]/iu.test(candidate)) return candidate;
  if (
    /^data:(?:image\/(?:png|jpe?g|webp|gif|avif|bmp|tiff|jp2|x-icon)|video\/(?:mp4|quicktime|webm)|audio\/(?:mpeg|wav|mp4));/iu.test(
      candidate,
    )
  )
    return candidate;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "file:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/** Extract media URLs exposed by desktop/web apps instead of actual Files. */
export function droppedMediaUrlsFromStrings(
  payloads: readonly DroppedStringPayload[],
): string[] {
  const candidates: string[] = [];
  for (const payload of payloads) {
    const type = payload.type.trim().toLowerCase();
    const data = payload.data.trim();
    if (!data) continue;

    if (type === "downloadurl") {
      const match = /^[^:]*:[^:]*:([\s\S]+)$/u.exec(data);
      if (match?.[1]) candidates.push(match[1]);
      continue;
    }
    if (type === "text/html") {
      const pattern =
        /<(?:img|video|audio|source)\b[^>]*\b(?:src|poster)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/giu;
      for (const match of data.matchAll(pattern)) {
        const source = match[1] ?? match[2] ?? match[3];
        if (source) candidates.push(source);
      }
      const linkPattern =
        /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/giu;
      for (const match of data.matchAll(linkPattern)) {
        const source = match[1] ?? match[2] ?? match[3];
        if (source) candidates.push(source);
      }
      continue;
    }
    if (type === "text/uri-list") {
      candidates.push(
        ...data
          .split(/\r?\n/gu)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#")),
      );
      continue;
    }
    if (type === "text/x-moz-url" || type === "text/x-moz-url-data") {
      const firstLine = data.split(/\r?\n/gu, 1)[0];
      if (firstLine) candidates.push(firstLine);
      continue;
    }
    if (
      type === "text/plain" ||
      type === "url" ||
      type === "uniformresourcelocator" ||
      type === "uniformresourcelocatorw"
    ) {
      const lines = data
        .split(/\r?\n/gu)
        .map((line) => line.trim())
        .filter(Boolean);
      candidates.push(...(lines.length > 0 ? lines : [data]));
    }
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const url = normalizedDroppedMediaUrl(candidate);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

function droppedMediaName(
  value: string,
  mimeType: string,
  index: number,
  timestamp: number,
): string {
  if (!value.startsWith("data:")) {
    try {
      const url = new URL(value);
      const queryName =
        url.searchParams.get("filename") ?? url.searchParams.get("name");
      const pathName = url.pathname.split("/").filter(Boolean).at(-1);
      const rawName = queryName || pathName;
      if (rawName) {
        try {
          const decoded = decodeURIComponent(rawName).replace(
            /[\\/:*?"<>|]/gu,
            "_",
          );
          if (decoded) return decoded.slice(0, 255);
        } catch {
          // Use the generated name below for malformed URL escapes.
        }
      }
    } catch {
      // The URL was already validated; keep a defensive fallback.
    }
  }
  const extension = MEDIA_EXTENSION_BY_MIME[mimeType] ?? "image";
  return `拖入素材-${timestamp}-${index + 1}.${extension}`;
}

/**
 * Resolve URL/HTML drag payloads without sending browser cookies or referrer
 * data to the source. CORS remains enforced by the browser.
 */
export async function filesFromDroppedMediaUrls(
  urls: readonly string[],
  timestamp = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<File[]> {
  const files = await mapWithConcurrency(urls, 3, async (url, index) => {
    try {
      if (!/^(?:https?:|data:)/iu.test(url)) return null;
      const response = await fetcher(url, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) return null;
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > 500 * 1024 * 1024)
        return null;
      const blob = await response.blob();
      if (blob.size <= 0 || blob.size > 500 * 1024 * 1024) return null;
      const declaredMimeType = blob.type.trim().toLowerCase();
      const extension = new URL(url).pathname
        .split(".")
        .pop()
        ?.toLowerCase();
      const mimeType =
        declaredMimeType || MEDIA_MIME_BY_EXTENSION[extension ?? ""] || "";
      const file = new File(
        [blob],
        droppedMediaName(url, mimeType, index, timestamp),
        { type: mimeType, lastModified: timestamp },
      );
      return prepareImportableMediaFile(file);
    } catch {
      return null;
    }
  });
  return files.filter((file): file is File => Boolean(file));
}

export function normalizeDraggedMediaFile(file: File): File | null {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return null;
  const declaredType = file.type.trim().toLowerCase();
  if (SUPPORTED_MEDIA_MIME_TYPES.has(declaredType)) return file;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const inferredType = MEDIA_MIME_BY_EXTENSION[extension];
  if (!inferredType) return null;
  return new File([file], file.name, {
    type: inferredType,
    lastModified: file.lastModified,
  });
}

export function normalizeClipboardImageFile(
  file: File,
  index: number,
  timestamp = Date.now(),
): File | null {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return null;
  const declaredType = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  // Keep HEIF files in the pipeline even though the browser's declared MIME
  // type is not one of the upload MIME types. prepareImportableMediaFile will
  // sniff and decode them to JPEG before upload.
  if (
    HEIF_IMAGE_MIME_TYPES.has(declaredType) ||
    extension === "heic" ||
    extension === "heif"
  )
    return file;
  const normalized = normalizeDraggedMediaFile(file);
  if (!normalized?.type.startsWith("image/")) return null;
  if (normalized.name.trim()) return normalized;

  const clipboardExtension = IMAGE_EXTENSION_BY_MIME[normalized.type];
  if (!clipboardExtension) return null;
  return new File(
    [normalized],
    `剪贴板图片-${timestamp}-${index + 1}.${clipboardExtension}`,
    {
      type: normalized.type,
      lastModified: normalized.lastModified || timestamp,
    },
  );
}

export function preferNamedClipboardImages(files: readonly File[]): File[] {
  const genericName =
    /^(?:clipboard|image|pasted image|截图|图片)(?:[-_\s.]|$)/iu;
  const named = files.filter((file) => !genericName.test(file.name.trim()));
  return named.length > 0 ? named : [...files];
}

/** Preserve input order while keeping expensive media uploads bounded. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.floor(concurrency)),
  );
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

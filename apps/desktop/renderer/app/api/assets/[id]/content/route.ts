import type { StoredObject } from "@super-canvas/storage";
import { jsonError, repository, storage } from "../../../../../lib/server";
import { archiveGeneratedAssetForFinished } from "../../../../../lib/project-service";
import {
  convertImageDownload,
  IMAGE_DOWNLOAD_CONTENT_TYPES,
  ImageDownloadConversionError,
  type ImageDownloadFormat,
} from "../../../../../lib/asset-download-conversion";
import {
  isSupportedMediaMimeType,
  mediaKindForMime,
  normalizeMimeType,
  parseByteRange,
  sanitizedAssetExtension,
} from "../../media-utils";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
  "cross-origin-resource-policy": "same-origin",
};

function contentTypeFor(
  assetKind: "image" | "video" | "audio" | "text",
  assetMimeType: string,
  storedMimeType: string | undefined,
): { contentType: string; downloadable: boolean } {
  const assetType = normalizeMimeType(assetMimeType);
  const storedType = normalizeMimeType(storedMimeType ?? "");
  const candidate =
    isSupportedMediaMimeType(storedType) &&
    mediaKindForMime(storedType) === assetKind
      ? storedType
      : assetType;
  if (
    isSupportedMediaMimeType(candidate) &&
    mediaKindForMime(candidate) === assetKind
  ) {
    return { contentType: candidate, downloadable: false };
  }
  return { contentType: "application/octet-stream", downloadable: true };
}

const ACCEPTED_DOWNLOAD_EXTENSIONS: Readonly<
  Record<string, readonly string[]>
> = {
  "image/jpeg": ["jpg", "jpeg"],
  "video/quicktime": ["mov", "qt"],
};

function filenameWithExtension(filename: string, contentType: string): string {
  const cleaned =
    filename
      .replace(/[\u0000-\u001f\u007f]/gu, "")
      .replace(/[<>:"/\\|?*]/gu, "-")
      .trim() || "download";
  const extension = sanitizedAssetExtension(cleaned, contentType);
  const existing = /\.([a-z0-9]{1,10})$/iu.exec(cleaned)?.[1]?.toLowerCase();
  const accepted = ACCEPTED_DOWNLOAD_EXTENSIONS[
    normalizeMimeType(contentType)
  ] ?? [extension];
  return existing && accepted.includes(existing)
    ? cleaned
    : `${cleaned}.${extension}`;
}

function downloadDisposition(filename: string, contentType: string): string {
  const encoded = encodeURIComponent(
    filenameWithExtension(filename, contentType),
  );
  return `attachment; filename="download"; filename*=UTF-8''${encoded}`;
}

function applySecurityHeaders(
  headers: Headers,
  downloadable = false,
  filename?: string,
  contentType?: string,
): Headers {
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    headers.set(name, value);
  if (downloadable) {
    headers.set(
      "content-disposition",
      filename && contentType
        ? downloadDisposition(filename, contentType)
        : "attachment",
    );
    headers.set("x-download-options", "noopen");
  }
  return headers;
}

function unsatisfiedRange(totalSize: number): Response {
  const headers = applySecurityHeaders(
    new Headers({
      "accept-ranges": "bytes",
      "content-range": `bytes */${totalSize}`,
      "cache-control": "no-store",
    }),
    true,
  );
  return new Response(null, {
    status: 416,
    headers,
  });
}

async function assetContent(
  request: Request,
  context: { params: Promise<{ id: string }> },
  headOnly = false,
) {
  const { id } = await context.params;
  const asset = await repository.getAsset(id);
  if (!asset) return jsonError("Asset does not exist", 404);
  const searchParams = new URL(request.url).searchParams;
  const forceDownload = searchParams.get("download") === "1";
  const requestedFormat = searchParams.get("format")?.trim().toLowerCase();
  let format: ImageDownloadFormat | null = null;
  if (requestedFormat !== undefined && requestedFormat !== "original") {
    if (
      requestedFormat !== "png" &&
      requestedFormat !== "jpg" &&
      requestedFormat !== "jpeg" &&
      requestedFormat !== "webp"
    ) {
      return jsonError("下载格式仅支持原文件、PNG、JPG 或 WebP。", 400);
    }
    if (!forceDownload) {
      return jsonError("格式转换仅用于显式下载，请设置 download=1。", 400);
    }
    if (asset.kind !== "image") {
      return jsonError("只有图片可以选择 PNG、JPG 或 WebP 下载格式。", 415);
    }
    format = requestedFormat === "jpeg" ? "jpg" : requestedFormat;
  }

  const archiveOriginal = async () => {
    try {
      // Explicit downloads of generated results are also copied into the
      // project's protected finished directory before the response is sent.
      await archiveGeneratedAssetForFinished(asset);
    } catch (error) {
      // Keep browser downloads available when the optional project filesystem
      // is temporarily unavailable; the asset remains in object storage.
      console.error(
        "[super-canvas] unable to archive finished asset",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  let loadedObject: StoredObject | null | undefined;
  const metadata = storage.head
    ? await storage.head(asset.storageKey)
    : await storage.get(asset.storageKey).then((object) => {
        loadedObject = object;
        return object
          ? {
              size: object.bytes.byteLength,
              contentType: object.contentType,
            }
          : null;
      });
  if (!metadata) return jsonError("Asset file does not exist", 404);

  if (format) {
    const contentType = IMAGE_DOWNLOAD_CONTENT_TYPES[format];
    const filename = `${asset.name.replace(/\.(?:png|jpe?g|webp|gif|avif|heic|heif|tiff?|bmp)$/iu, "")}.${format}`;
    const headers = applySecurityHeaders(
      new Headers({
        // The original byte offsets and size do not describe this encoding.
        // A converted GET always returns the complete new representation.
        "accept-ranges": "none",
        "cache-control": "private, no-store",
        "content-type": contentType,
      }),
      true,
      filename,
      contentType,
    );
    // Do not perform an expensive conversion or archive on metadata probes.
    // Omit the unknown encoded length instead of returning the original size.
    if (headOnly) return new Response(null, { headers });

    loadedObject ??= await storage.get(asset.storageKey);
    if (!loadedObject) return jsonError("Asset file does not exist", 404);
    try {
      const bytes = await convertImageDownload(loadedObject.bytes, format);
      await archiveOriginal();
      headers.set("content-length", String(bytes.byteLength));
      return new Response(bytes as BodyInit, { headers });
    } catch (error) {
      if (error instanceof ImageDownloadConversionError) {
        return jsonError(error.message, error.status);
      }
      throw error;
    }
  }

  if (forceDownload && !headOnly) await archiveOriginal();

  if (headOnly) {
    const media = contentTypeFor(asset.kind, asset.mimeType, metadata.contentType);
    // Range applies to GET. Metadata probes should neither load the media body
    // nor trigger the side effect of archiving an explicit download.
    return new Response(null, {
      headers: applySecurityHeaders(
        new Headers({
          "accept-ranges": "bytes",
          "cache-control": "private, no-store",
          "content-length": String(metadata.size),
          "content-type": media.contentType,
        }),
        media.downloadable || forceDownload,
        asset.name,
        media.contentType,
      ),
    });
  }

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, metadata.size);
    if (!range.valid) return unsatisfiedRange(metadata.size);

    let object: StoredObject | null;
    if (storage.getRange) {
      object = await storage.getRange(asset.storageKey, range.start, range.end);
    } else {
      loadedObject ??= await storage.get(asset.storageKey);
      object = loadedObject
        ? {
            ...loadedObject,
            bytes: loadedObject.bytes.slice(range.start, range.end + 1),
          }
        : null;
    }
    if (!object) return jsonError("Asset file does not exist", 404);
    const expectedLength = range.end - range.start + 1;
    if (object.bytes.byteLength !== expectedLength)
      return jsonError("Asset changed while the requested range was read", 409);

    const media = contentTypeFor(
      asset.kind,
      asset.mimeType,
      object.contentType ?? metadata.contentType,
    );
    const headers = applySecurityHeaders(
      new Headers({
        "accept-ranges": "bytes",
        // This endpoint is authenticated; never let a shared proxy cache a
        // private asset response and replay it to another requester.
        "cache-control": "private, no-store",
        "content-length": String(object.bytes.byteLength),
        "content-range": `bytes ${range.start}-${range.end}/${metadata.size}`,
        "content-type": media.contentType,
      }),
      media.downloadable || forceDownload,
      asset.name,
      media.contentType,
    );
    return new Response(object.bytes as BodyInit, { status: 206, headers });
  }

  loadedObject ??= await storage.get(asset.storageKey);
  if (!loadedObject) return jsonError("Asset file does not exist", 404);
  const media = contentTypeFor(
    asset.kind,
    asset.mimeType,
    loadedObject.contentType ?? metadata.contentType,
  );
  const headers = applySecurityHeaders(
    new Headers({
      "accept-ranges": "bytes",
      // This endpoint is authenticated; never let a shared proxy cache a
      // private asset response and replay it to another requester.
      "cache-control": "private, no-store",
      "content-length": String(loadedObject.bytes.byteLength),
      "content-type": media.contentType,
    }),
    media.downloadable || forceDownload,
    asset.name,
    media.contentType,
  );
  return new Response(loadedObject.bytes as BodyInit, { headers });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return assetContent(request, context);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const response = await assetContent(request, context, true);
  return new Response(null, { status: response.status, headers: response.headers });
}

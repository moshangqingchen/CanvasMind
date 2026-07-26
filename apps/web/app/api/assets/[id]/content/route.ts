import type { StoredObject } from "@super-canvas/storage";
import { jsonError, repository, storage } from "../../../../../lib/server";
import {
  isSupportedMediaMimeType,
  mediaKindForMime,
  normalizeMimeType,
  parseByteRange,
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

function applySecurityHeaders(headers: Headers, downloadable = false): Headers {
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    headers.set(name, value);
  if (downloadable) {
    headers.set("content-disposition", "attachment");
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

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const asset = await repository.getAsset(id);
  if (!asset) return jsonError("Asset does not exist", 404);

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
        "cache-control": "public, max-age=31536000, immutable",
        "content-length": String(object.bytes.byteLength),
        "content-range": `bytes ${range.start}-${range.end}/${metadata.size}`,
        "content-type": media.contentType,
      }),
      media.downloadable,
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
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(loadedObject.bytes.byteLength),
      "content-type": media.contentType,
    }),
    media.downloadable,
  );
  return new Response(loadedObject.bytes as BodyInit, { headers });
}

import { getOrCreateAssetPreview } from "../../../../lib/asset-preview";
import { jsonError, repository, storage } from "../../../../lib/server";
import {
  MEDIA_MAGIC_PROBE_BYTES,
  MAX_DIRECT_UPLOAD_BYTES,
  mediaKindForMime,
  normalizeMimeType,
  validateCompletedUpload,
} from "../media-utils";
import {
  MAX_SMALL_JSON_BODY_BYTES,
  readJsonBody,
} from "../../../../lib/api-validation";
import { verifyUploadToken } from "../../../../lib/upload-token";

async function readMagicProbe(
  storageKey: string,
  size: number,
): Promise<Uint8Array | null> {
  const end = Math.min(size, MEDIA_MAGIC_PROBE_BYTES) - 1;
  if (end < 0) return null;
  if (storage.getRange) {
    const object = await storage.getRange(storageKey, 0, end);
    return object?.bytes ?? null;
  }
  // Custom storage implementations predating getRange may still confirm tiny
  // uploads. Refuse large objects rather than loading them wholesale just to
  // inspect a header.
  if (size > MEDIA_MAGIC_PROBE_BYTES) return null;
  const object = await storage.get(storageKey);
  return object?.bytes ?? null;
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request, MAX_SMALL_JSON_BODY_BYTES);
  if (!parsed.success) return parsed.response;
  const body = (
    parsed.data &&
    typeof parsed.data === "object" &&
    !Array.isArray(parsed.data)
      ? parsed.data
      : {}
  ) as {
    id?: string;
    storageKey?: string;
    name?: string;
    mimeType?: string;
    size?: number;
    uploadToken?: string;
  };
  if (
    typeof body.id !== "string" ||
    !body.id ||
    body.id.length > 128 ||
    typeof body.storageKey !== "string" ||
    body.storageKey.length > 256 ||
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.length > 512 ||
    typeof body.mimeType !== "string" ||
    typeof body.size !== "number" ||
    typeof body.uploadToken !== "string"
  )
    return jsonError("Upload confirmation parameters are incomplete");

  const keyPrefix = `assets/${body.id}/`;
  const keySuffix = body.storageKey.slice(keyPrefix.length);
  if (
    !body.storageKey.startsWith(keyPrefix) ||
    !/^original\.[a-z0-9]{1,10}$/u.test(keySuffix)
  )
    return jsonError("Invalid storageKey");
  if (
    !Number.isSafeInteger(body.size) ||
    body.size <= 0 ||
    body.size > MAX_DIRECT_UPLOAD_BYTES
  )
    return jsonError("Invalid file size");

  const declaredMimeType = normalizeMimeType(body.mimeType);
  const kind = mediaKindForMime(declaredMimeType);
  if (!kind) return jsonError("Only image and video uploads are supported");
  if (
    !verifyUploadToken(body.uploadToken, {
      id: body.id,
      storageKey: body.storageKey,
      size: body.size,
      mimeType: declaredMimeType,
    })
  )
    return jsonError("Upload intent is invalid or expired", 403);

  let metadata: { size: number; contentType?: string } | null;
  try {
    metadata = storage.head
      ? await storage.head(body.storageKey)
      : await storage.get(body.storageKey).then((object) =>
          object
            ? {
                size: object.bytes.byteLength,
                contentType: object.contentType,
              }
            : null,
        );
  } catch {
    return jsonError("Unable to inspect uploaded object", 503);
  }
  if (!metadata) return jsonError("Uploaded object does not exist", 404);
  let probeBytes: Uint8Array | null;
  try {
    probeBytes = await readMagicProbe(body.storageKey, metadata.size);
  } catch {
    return jsonError("Unable to inspect uploaded object content", 503);
  }
  if (!probeBytes)
    return jsonError(
      "Storage cannot perform bounded media validation for this upload",
      503,
    );
  const validation = validateCompletedUpload(
    body.size,
    declaredMimeType,
    metadata,
    probeBytes,
  );
  if (!validation.valid) {
    if (validation.reason === "size_mismatch")
      return jsonError(
        "Uploaded object size does not match the declaration",
        409,
      );
    if (validation.reason === "invalid_content_type")
      return jsonError("Uploaded object has an invalid Content-Type", 409);
    if (validation.reason === "content_mismatch")
      return jsonError(
        "Uploaded object content does not match its declared media type",
        409,
      );
    return jsonError(
      "Uploaded object Content-Type does not match the declaration",
      409,
    );
  }

  const asset = await repository.saveAsset({
    id: body.id,
    name: body.name,
    kind: validation.kind,
    mimeType: validation.mimeType,
    size: metadata.size,
    storageKey: body.storageKey,
    metadata: { source: "direct-upload" },
  });
  if (asset.kind === "image") {
    void getOrCreateAssetPreview(storage, asset, 1200)
      .then(() => getOrCreateAssetPreview(storage, asset, 160))
      .catch(() => undefined);
  }
  return Response.json(
    { ...asset, url: `/api/assets/${encodeURIComponent(asset.id)}/content` },
    { status: 201 },
  );
}

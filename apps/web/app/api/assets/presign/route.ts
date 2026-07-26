import { randomUUID } from "node:crypto";
import {
  MAX_SMALL_JSON_BODY_BYTES,
  readJsonBody,
} from "../../../../lib/api-validation";
import { jsonError, storage } from "../../../../lib/server";
import { createUploadToken } from "../../../../lib/upload-token";
import {
  MAX_DIRECT_UPLOAD_BYTES,
  MAX_PROXY_UPLOAD_BYTES,
  mediaKindForMime,
  normalizeMimeType,
  sanitizedAssetExtension,
} from "../media-utils";

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
    name?: string;
    mimeType?: string;
    size?: number;
  };
  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    typeof body.mimeType !== "string" ||
    typeof body.size !== "number"
  )
    return jsonError("name, mimeType and size are required");

  const mimeType = normalizeMimeType(body.mimeType);
  if (!mediaKindForMime(mimeType))
    return jsonError("Only image and video uploads are supported");
  if (!Number.isSafeInteger(body.size) || body.size <= 0)
    return jsonError("File size must be a positive integer");

  const directUpload = Boolean(storage.presignPut);
  const maxBytes = directUpload
    ? MAX_DIRECT_UPLOAD_BYTES
    : MAX_PROXY_UPLOAD_BYTES;
  if (body.size > maxBytes)
    return jsonError(
      directUpload
        ? "File size cannot exceed 2 GB"
        : "File size cannot exceed 500 MB",
      413,
    );
  if (!storage.presignPut) return Response.json({ mode: "proxy" });

  const id = randomUUID();
  const extension = sanitizedAssetExtension(body.name, mimeType);
  const storageKey = `assets/${id}/original.${extension}`;
  const uploadUrl = await storage.presignPut(
    storageKey,
    mimeType,
    body.size,
    600,
  );
  return Response.json({
    mode: "direct",
    id,
    storageKey,
    uploadUrl,
    uploadToken: createUploadToken({
      id,
      storageKey,
      size: body.size,
      mimeType,
      expiresInSeconds: 600,
    }),
  });
}

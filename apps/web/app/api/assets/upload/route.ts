import { randomUUID } from "node:crypto";
import { getOrCreateAssetPreview } from "../../../../lib/asset-preview";
import { jsonError, repository, storage } from "../../../../lib/server";
import {
  MAX_PROXY_UPLOAD_BYTES,
  mediaKindForMime,
  normalizeMimeType,
  sanitizedAssetExtension,
  validateMediaMagic,
} from "../media-utils";

const MAX_MULTIPART_BODY_BYTES = MAX_PROXY_UPLOAD_BYTES + 2 * 1024 * 1024;

class UploadBodyTooLargeError extends Error {
  public override readonly name = "UploadBodyTooLargeError";
}

async function formDataWithLimit(request: Request): Promise<FormData> {
  if (!request.body) return request.formData();
  const reader = request.body.getReader();
  let total = 0;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };
  const limitedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          release();
          controller.close();
          return;
        }
        total += next.value.byteLength;
        if (total > MAX_MULTIPART_BODY_BYTES) {
          void reader.cancel();
          release();
          controller.error(new UploadBodyTooLargeError());
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    cancel(reason) {
      void reader.cancel(reason);
      release();
    },
  });
  const wrappedInit = {
    method: request.method,
    headers: request.headers,
    body: limitedBody,
    duplex: "half",
  } as RequestInit & { duplex: "half" };
  const wrapped = new Request(request.url, wrappedInit);
  try {
    return await wrapped.formData();
  } finally {
    release();
  }
}

export async function POST(request: Request) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      Number.isSafeInteger(parsedLength) &&
      parsedLength > MAX_MULTIPART_BODY_BYTES
    )
      return jsonError("Request body cannot exceed 502 MB", 413);
  }
  let form: FormData;
  try {
    form = await formDataWithLimit(request);
  } catch (error) {
    if (error instanceof UploadBodyTooLargeError)
      return jsonError("Request body cannot exceed 502 MB", 413);
    return jsonError("Invalid multipart upload", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File))
    return jsonError("Please select an image or video file");
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    return jsonError("File cannot be empty");
  if (file.size > MAX_PROXY_UPLOAD_BYTES)
    return jsonError("File size cannot exceed 500 MB", 413);

  const declaredMimeType = normalizeMimeType(file.type);
  if (!mediaKindForMime(declaredMimeType))
    return jsonError("Only image and video files are supported");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateMediaMagic(bytes, declaredMimeType);
  if (!validation.valid) {
    const detail = validation.detectedMimeType
      ? `; detected ${validation.detectedMimeType}`
      : "";
    return jsonError(
      `File content does not match its declared MIME type${detail}`,
    );
  }

  const mimeType = validation.detectedMimeType!;
  const kind = mediaKindForMime(mimeType)!;
  const id = randomUUID();
  const extension = sanitizedAssetExtension(file.name, mimeType);
  const storageKey = `assets/${id}/original.${extension}`;
  await storage.put(storageKey, bytes, mimeType);
  const asset = await repository.saveAsset({
    id,
    name: file.name,
    kind,
    mimeType,
    size: bytes.byteLength,
    storageKey,
    metadata: { source: "upload" },
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

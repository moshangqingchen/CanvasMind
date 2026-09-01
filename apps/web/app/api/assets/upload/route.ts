import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getOrCreateAssetPreview } from "../../../../lib/asset-preview";
import { jsonError, repository, storage } from "../../../../lib/server";
import {
  MAX_PROXY_UPLOAD_BYTES,
  completeMediaPayload,
  mediaKindForMime,
  normalizeMimeType,
  sanitizedAssetExtension,
  validateMediaMagic,
} from "../media-utils";

const MAX_MULTIPART_BODY_BYTES = MAX_PROXY_UPLOAD_BYTES + 2 * 1024 * 1024;

class UploadBodyTooLargeError extends Error {
  public override readonly name = "UploadBodyTooLargeError";
}

async function repairIncompleteImage(
  bytes: Uint8Array,
  mimeType: string,
): Promise<Uint8Array | null> {
  try {
    const image = sharp(bytes, {
      animated: mimeType === "image/gif",
      failOn: "none",
      limitInputPixels: 100_000_000,
    }).rotate();
    const encoded =
      mimeType === "image/jpeg"
        ? image.jpeg({ quality: 95 })
        : mimeType === "image/png"
          ? image.png()
          : mimeType === "image/webp"
            ? image.webp({ quality: 95 })
            : mimeType === "image/gif"
              ? image.gif()
              : null;
    if (!encoded) return null;
    const repaired = new Uint8Array(await encoded.toBuffer());
    return completeMediaPayload(repaired, mimeType);
  } catch {
    return null;
  }
}

function declaredBodyLength(request: Request): number | null {
  const value = request.headers.get("content-length")?.trim();
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
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

async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new UploadBodyTooLargeError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function localUploadAccessHeaders(request: Request): Headers {
  const headers = new Headers({
    vary: "Origin, Access-Control-Request-Private-Network",
  });
  const origin = request.headers.get("origin");
  let allowedOrigin: string | undefined;
  try {
    allowedOrigin = process.env.PUBLIC_BASE_URL
      ? new URL(process.env.PUBLIC_BASE_URL).origin
      : undefined;
  } catch {
    allowedOrigin = undefined;
  }
  if (!origin || origin !== allowedOrigin) return headers;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type");
  headers.set("access-control-max-age", "600");
  headers.set("cross-origin-resource-policy", "cross-origin");
  if (
    request.headers.get("access-control-request-private-network") === "true"
  ) {
    headers.set("access-control-allow-private-network", "true");
  }
  return headers;
}

function applyLocalUploadAccess(request: Request, response: Response) {
  for (const [name, value] of localUploadAccessHeaders(request)) {
    response.headers.set(name, value);
  }
  return response;
}

export function OPTIONS(request: Request) {
  const headers = localUploadAccessHeaders(request);
  return new Response(null, {
    status: headers.has("access-control-allow-origin") ? 204 : 403,
    headers,
  });
}

async function handleUpload(request: Request) {
  const requestedId = new URL(request.url).searchParams.get("id")?.trim();
  if (
    requestedId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      requestedId,
    )
  )
    return jsonError("Invalid upload id");
  const requestMimeType = normalizeMimeType(
    request.headers.get("content-type") ?? "",
  );
  const isMultipart = requestMimeType === "multipart/form-data";
  const declaredLength = declaredBodyLength(request);
  const requestLimit = isMultipart
    ? MAX_MULTIPART_BODY_BYTES
    : MAX_PROXY_UPLOAD_BYTES;
  if (declaredLength !== null && declaredLength > requestLimit)
    return jsonError(
      isMultipart
        ? "Request body cannot exceed 502 MB"
        : "File size cannot exceed 500 MB",
      413,
    );

  let name: string;
  let declaredMimeType: string;
  let bytes: Uint8Array;
  if (isMultipart) {
    let form: FormData;
    try {
      form =
        declaredLength === null
          ? await formDataWithLimit(request)
          : await request.formData();
    } catch (error) {
      if (error instanceof UploadBodyTooLargeError)
        return jsonError("Request body cannot exceed 502 MB", 413);
      return jsonError("Invalid multipart upload", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File))
      return jsonError("Please select an image, audio, or video file");
    name = file.name;
    declaredMimeType = normalizeMimeType(file.type);
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
    declaredMimeType = requestMimeType;
    try {
      bytes = await readBodyWithLimit(request, MAX_PROXY_UPLOAD_BYTES);
    } catch (error) {
      if (error instanceof UploadBodyTooLargeError)
        return jsonError("File size cannot exceed 500 MB", 413);
      return jsonError("Invalid upload body", 400);
    }
  }
  if (!name) return jsonError("Please select an image, audio, or video file");
  if (!Number.isSafeInteger(bytes.byteLength) || bytes.byteLength <= 0)
    return jsonError("File cannot be empty");
  if (
    !isMultipart &&
    declaredLength !== null &&
    bytes.byteLength !== declaredLength
  )
    return jsonError(
      "Upload body was incomplete; please upload the file again",
    );
  if (bytes.byteLength > MAX_PROXY_UPLOAD_BYTES)
    return jsonError("File size cannot exceed 500 MB", 413);

  if (!mediaKindForMime(declaredMimeType))
    return jsonError("Only image, audio, and video files are supported");

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
  const originalUploadSize = bytes.byteLength;
  let normalizedBytes = completeMediaPayload(bytes, mimeType);
  let repaired = false;
  if (!normalizedBytes && mimeType.startsWith("image/")) {
    normalizedBytes = await repairIncompleteImage(bytes, mimeType);
    repaired = normalizedBytes !== null;
  }
  if (!normalizedBytes)
    return jsonError("图片数据无法解码；请在微信中点开原图后再拖入");
  bytes = normalizedBytes;
  const kind = mediaKindForMime(mimeType)!;
  const id = requestedId ?? randomUUID();
  const existing = requestedId ? await repository.getAsset(requestedId) : null;
  if (existing) {
    const existingOriginalSize = Number(
      existing.metadata.originalUploadSize ?? existing.size,
    );
    if (
      existing.name !== name ||
      existing.mimeType !== mimeType ||
      existingOriginalSize !== originalUploadSize
    )
      return jsonError("Upload id has already been used", 409);
    return Response.json({
      ...existing,
      url: `/api/assets/${encodeURIComponent(existing.id)}/content`,
    });
  }
  const extension = sanitizedAssetExtension(name, mimeType);
  const storageKey = `assets/${id}/original.${extension}`;
  await storage.put(storageKey, bytes, mimeType);
  const asset = await repository.saveAsset({
    id,
    name,
    kind,
    mimeType,
    size: bytes.byteLength,
    storageKey,
    metadata: {
      source: "upload",
      originalUploadSize,
      trimmedTrailingBytes: bytes.byteLength < originalUploadSize,
      repaired,
    },
  });
  if (asset.kind === "image") {
    // Canvas cards request 640px first. Sharing this exact in-flight job avoids
    // decoding the original twice when the new optimistic node mounts.
    void getOrCreateAssetPreview(storage, asset, 640)
      .then(() => getOrCreateAssetPreview(storage, asset, 160))
      .catch(() => undefined);
  }
  return Response.json(
    { ...asset, url: `/api/assets/${encodeURIComponent(asset.id)}/content` },
    { status: 201 },
  );
}

export async function POST(request: Request) {
  return applyLocalUploadAccess(request, await handleUpload(request));
}

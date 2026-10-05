import sharp from "sharp";
import { ProjectFileAccessError } from "@super-canvas/storage";
import { parseRouteIdentifier } from "../../../../../../lib/api-validation";
import { jsonError } from "../../../../../../lib/server";
import { projectFileMetadata, readProjectFile } from "../../../../../../lib/project-service";
import { parseByteRange } from "../../../../assets/media-utils";

const secureHeaders = { "cache-control": "private, no-store", "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox", "cross-origin-resource-policy": "same-origin" };

const previewCache = new Map<string, Buffer>();
const pendingPreviews = new Map<string, Promise<Buffer>>();
const previewWaiters: Array<() => void> = [];
let activePreviews = 0;
let cachedBytes = 0;
async function imagePreview(projectId: string, fileId: string, size: number): Promise<Buffer> {
  const key = `${projectId}:${fileId}:${size}`;
  const cached = previewCache.get(key);
  if (cached) return cached;
  const pending = pendingPreviews.get(key);
  if (pending) return pending;
  const job = (async () => {
    if (activePreviews >= 3) await new Promise<void>(resolve => previewWaiters.push(resolve));
    else activePreviews++;
    try {
      const { bytes } = await readProjectFile(projectId, fileId, { maxBytes: 100 * 1024 * 1024 });
      const preview = await sharp(bytes, { limitInputPixels: 100_000_000, failOn: "error" }).rotate()
        .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      previewCache.set(key, preview); cachedBytes += preview.length;
      while (previewCache.size > 128 || cachedBytes > 48 * 1024 * 1024) {
        const oldest = previewCache.keys().next().value!;
        cachedBytes -= previewCache.get(oldest)!.length;
        previewCache.delete(oldest);
      }
      return preview;
    } finally {
      const next = previewWaiters.shift();
      if (next) next(); else activePreviews--;
    }
  })();
  pendingPreviews.set(key, job);
  try { return await job; } finally { pendingPreviews.delete(key); }
}

async function content(request: Request, context: { params: Promise<{ id: string }> }, head = false) {
  const id = parseRouteIdentifier((await context.params).id, "项目 ID");
  if (!id.success) return id.response;
  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId");
  if (!fileId || !/^[a-f0-9]{64}$/u.test(fileId)) return jsonError("项目文件 ID 无效", 400);
  try {
    const file = await projectFileMetadata(id.data, fileId);
    if (url.searchParams.has("preview") && file.kind === "image") {
      const size = Math.round(Math.max(160, Math.min(1200, Number(url.searchParams.get("preview")) || 640)));
      const preview = await imagePreview(id.data, fileId, size);
      return new Response(head ? null : preview as BodyInit, { headers: { ...secureHeaders, "content-type": "image/webp", "content-length": String(preview.length) } });
    }
    if (head) return new Response(null, { headers: { ...secureHeaders, "content-type": file.mimeType, "content-length": String(file.size), "accept-ranges": "bytes" } });
    const requestedRange = request.headers.get("range");
    if (requestedRange) {
      const range = parseByteRange(requestedRange, file.size);
      if (!range.valid) return new Response(null, { status: 416, headers: { ...secureHeaders, "content-range": `bytes */${file.size}` } });
      const end = Math.min(range.end, range.start + 8 * 1024 * 1024 - 1);
      const { bytes } = await readProjectFile(id.data, fileId, { start: range.start, end });
      return new Response(bytes as BodyInit, { status: 206, headers: { ...secureHeaders, "content-type": file.mimeType,
        "accept-ranges": "bytes", "content-range": `bytes ${range.start}-${end}/${file.size}`, "content-length": String(bytes.length) } });
    }
    const { bytes } = await readProjectFile(id.data, fileId);
    return new Response(bytes as BodyInit, { headers: { ...secureHeaders, "content-type": file.mimeType, "accept-ranges": "bytes", "content-length": String(bytes.length) } });
  } catch (error) { return jsonError(error instanceof ProjectFileAccessError ? error.message : "项目文件无法预览，请刷新或检查文件格式", error instanceof ProjectFileAccessError ? error.status : 500); }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return content(request, context); }
export async function HEAD(request: Request, context: { params: Promise<{ id: string }> }) { return content(request, context, true); }

import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  assetPreviewKey,
  getOrCreateAssetPreview,
} from "../../../../lib/asset-preview";
import {
  MAX_SMALL_JSON_BODY_BYTES,
  readJsonBody,
} from "../../../../lib/api-validation";
import { jsonError, repository, storage } from "../../../../lib/server";
import {
  MAX_PROXY_UPLOAD_BYTES,
  mediaKindForMime,
  normalizeMimeType,
  sanitizedAssetExtension,
  validateMediaMagic,
} from "../../assets/media-utils";

const MATERIAL_DROP_TTL_MS = 45_000;
const MAX_PENDING_DROPS = 64;

interface PendingMaterialDrop {
  id: string;
  filePath: string;
  previewPath?: string;
  name: string;
  mimeType: string;
  size: number;
  screenX: number;
  screenY: number;
  createdAt: number;
}

const pendingDrops = new Map<string, PendingMaterialDrop>();
const claimingDrops = new Set<string>();

function materialLibraryRoot(): string {
  const profile = process.env.USERPROFILE || process.env.HOME || "";
  return path.resolve(
    /* turbopackIgnore: true */ profile,
    "Documents",
    "素材管理库",
  );
}

function bridgeTokenPath(): string {
  return path.join(materialLibraryRoot(), ".super-canvas-bridge-token");
}

function cleanPendingDrops() {
  const cutoff = Date.now() - MATERIAL_DROP_TTL_MS;
  for (const [id, drop] of pendingDrops) {
    if (drop.createdAt < cutoff) {
      pendingDrops.delete(id);
      claimingDrops.delete(id);
    }
  }
  while (pendingDrops.size > MAX_PENDING_DROPS) {
    const oldest = pendingDrops.keys().next().value as string | undefined;
    if (!oldest) break;
    pendingDrops.delete(oldest);
  }
}

function constantTimeTokenEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

async function validateBridgeFile(
  filePath: string,
  allowedTopFolders: ReadonlySet<string> = new Set(["assets", "attachments"]),
): Promise<string | null> {
  try {
    const [root, target] = await Promise.all([
      realpath(materialLibraryRoot()),
      realpath(path.resolve(/* turbopackIgnore: true */ filePath)),
    ]);
    const relative = path.relative(root, target);
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      relative === ".." ||
      path.isAbsolute(relative)
    )
      return null;
    const topFolder = relative.split(path.sep, 1)[0]?.toLowerCase();
    if (!topFolder || !allowedTopFolders.has(topFolder)) return null;
    return target;
  } catch {
    return null;
  }
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
  ) as Record<string, unknown>;
  if (
    typeof body.token !== "string" ||
    typeof body.filePath !== "string" ||
    typeof body.name !== "string" ||
    typeof body.mimeType !== "string" ||
    typeof body.size !== "number" ||
    typeof body.screenX !== "number" ||
    typeof body.screenY !== "number" ||
    !Number.isFinite(body.screenX) ||
    !Number.isFinite(body.screenY)
  )
    return jsonError("Invalid material drop payload");

  let expectedToken: string;
  try {
    expectedToken = (await readFile(bridgeTokenPath(), "utf8")).trim();
  } catch {
    return jsonError("Material bridge is not initialized", 403);
  }
  if (!constantTimeTokenEqual(body.token.trim(), expectedToken))
    return jsonError("Invalid material bridge token", 403);

  const targetPath = await validateBridgeFile(body.filePath);
  if (!targetPath)
    return jsonError("Material file is outside the library", 403);
  const fileStat = await stat(targetPath).catch(() => null);
  if (
    !fileStat?.isFile() ||
    fileStat.size !== body.size ||
    fileStat.size <= 0 ||
    fileStat.size > MAX_PROXY_UPLOAD_BYTES
  )
    return jsonError("Material file is unavailable or too large");
  const mimeType = normalizeMimeType(body.mimeType);
  if (!mediaKindForMime(mimeType))
    return jsonError("Unsupported material media type");
  const previewPath =
    mediaKindForMime(mimeType) === "image" &&
    typeof body.previewPath === "string" &&
    body.previewPath
      ? await validateBridgeFile(body.previewPath, new Set(["thumbnails"]))
      : null;

  cleanPendingDrops();
  const drop: PendingMaterialDrop = {
    id: randomUUID(),
    filePath: targetPath,
    previewPath: previewPath ?? undefined,
    name: path.basename(body.name).slice(0, 255) || path.basename(targetPath),
    mimeType,
    size: fileStat.size,
    screenX: body.screenX,
    screenY: body.screenY,
    createdAt: Date.now(),
  };
  pendingDrops.set(drop.id, drop);
  cleanPendingDrops();
  return Response.json({ ok: true, id: drop.id }, { status: 202 });
}

export async function GET(request: Request) {
  cleanPendingDrops();
  const previewId = new URL(request.url).searchParams.get("preview");
  if (previewId) {
    const drop = pendingDrops.get(previewId);
    if (!drop?.previewPath || mediaKindForMime(drop.mimeType) !== "image")
      return jsonError("Material preview is unavailable", 404);
    const previewPath = await validateBridgeFile(
      drop.previewPath,
      new Set(["thumbnails"]),
    );
    const previewStat = previewPath
      ? await stat(previewPath).catch(() => null)
      : null;
    if (!previewPath || !previewStat?.isFile() || previewStat.size > 32_000_000)
      return jsonError("Material preview is unavailable", 404);
    const bytes = new Uint8Array(await readFile(previewPath));
    const validation = validateMediaMagic(bytes, "image/png");
    if (!validation.valid)
      return jsonError("Material preview is invalid", 415);
    return new Response(bytes as BodyInit, {
      headers: {
        "Cache-Control": "private, max-age=45",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": validation.detectedMimeType!,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return Response.json(
    Array.from(pendingDrops.values())
      .filter((drop) => !claimingDrops.has(drop.id))
      .map((drop) => ({
        id: drop.id,
        name: drop.name,
        mimeType: drop.mimeType,
        size: drop.size,
        screenX: drop.screenX,
        screenY: drop.screenY,
        previewAvailable: Boolean(drop.previewPath),
        createdAt: new Date(drop.createdAt).toISOString(),
      })),
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request: Request) {
  const parsed = await readJsonBody(request, MAX_SMALL_JSON_BODY_BYTES);
  if (!parsed.success) return parsed.response;
  const id =
    parsed.data &&
    typeof parsed.data === "object" &&
    !Array.isArray(parsed.data)
      ? (parsed.data as Record<string, unknown>).id
      : null;
  if (typeof id !== "string") return jsonError("Material drop id is required");
  pendingDrops.delete(id);
  return Response.json({ ok: true });
}

export async function PATCH(request: Request) {
  const parsed = await readJsonBody(request, MAX_SMALL_JSON_BODY_BYTES);
  if (!parsed.success) return parsed.response;
  const id =
    parsed.data &&
    typeof parsed.data === "object" &&
    !Array.isArray(parsed.data)
      ? (parsed.data as Record<string, unknown>).id
      : null;
  if (typeof id !== "string") return jsonError("Material drop id is required");
  cleanPendingDrops();
  const drop = pendingDrops.get(id);
  if (!drop) return jsonError("Material drop expired", 404);
  if (claimingDrops.has(id))
    return jsonError("Material drop is already being imported", 409);
  claimingDrops.add(id);

  try {
    return await materializePendingDrop(drop);
  } finally {
    claimingDrops.delete(id);
  }
}

async function materializePendingDrop(drop: PendingMaterialDrop) {
  const targetPath = await validateBridgeFile(drop.filePath);
  if (!targetPath) return jsonError("Material file is unavailable", 404);
  const bytes = new Uint8Array(await readFile(targetPath));
  if (bytes.byteLength !== drop.size)
    return jsonError("Material file changed before import", 409);
  const validation = validateMediaMagic(bytes, drop.mimeType);
  const detectedMimeType = validation.detectedMimeType;
  const declaredKind = mediaKindForMime(normalizeMimeType(drop.mimeType));
  const detectedKind = detectedMimeType
    ? mediaKindForMime(detectedMimeType)
    : null;
  // Material libraries sometimes contain JPEG/WebP files with a historical
  // `.png` filename. Trust the detected magic bytes when both sides are the
  // same media kind, while still rejecting image/video/audio cross-kind data.
  if (!detectedMimeType || !declaredKind || declaredKind !== detectedKind)
    return jsonError("Material content does not match its media type");
  const mimeType = detectedMimeType;
  const kind = mediaKindForMime(mimeType)!;
  const assetId = randomUUID();
  const extension = sanitizedAssetExtension(drop.name, mimeType);
  const storageKey = `assets/${assetId}/original.${extension}`;
  await storage.put(storageKey, bytes, mimeType);
  const asset = await repository.saveAsset({
    id: assetId,
    name: drop.name,
    kind,
    mimeType,
    size: bytes.byteLength,
    storageKey,
    metadata: { source: "material-manager-bridge" },
  });
  if (asset.kind === "image") {
    let seededPreview = false;
    if (drop.previewPath) {
      const previewPath = await validateBridgeFile(
        drop.previewPath,
        new Set(["thumbnails"]),
      );
      const previewStat = previewPath
        ? await stat(previewPath).catch(() => null)
        : null;
      if (previewPath && previewStat?.isFile() && previewStat.size <= 32_000_000) {
        try {
          const source = await readFile(previewPath);
          const preview = new Uint8Array(
            await sharp(source, { failOn: "none" })
              .rotate()
              .resize({
                width: 640,
                height: 640,
                fit: "inside",
                withoutEnlargement: true,
              })
              .webp({ quality: 80, effort: 1, smartSubsample: true })
              .toBuffer(),
          );
          await storage.put(
            assetPreviewKey(asset.id, 640),
            preview,
            "image/webp",
          );
          seededPreview = true;
        } catch {
          seededPreview = false;
        }
      }
    }
    if (seededPreview) {
      void getOrCreateAssetPreview(storage, asset, 160).catch(() => undefined);
    } else {
      void getOrCreateAssetPreview(storage, asset, 640)
        .then(() => getOrCreateAssetPreview(storage, asset, 160))
        .catch(() => undefined);
    }
  }
  pendingDrops.delete(drop.id);
  return Response.json(asset);
}

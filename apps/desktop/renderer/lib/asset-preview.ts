import type { ObjectStorage } from "@super-canvas/storage";
import sharp from "sharp";

// Keep ordinary canvas thumbnails light, but allow the selected result to load
// enough pixels for close inspection without downloading every original PNG.
export const ASSET_PREVIEW_SIZES = [160, 640, 1200, 2400, 3840] as const;
const globalKey = "__superCanvasPreviewJobs";

type PreviewAsset = {
  id: string;
  kind: "image" | "video" | "audio" | "text";
  storageKey: string;
};

type PreviewScope = typeof globalThis & {
  [globalKey]?: Map<string, Promise<Uint8Array>>;
};

function previewJobs() {
  const scope = globalThis as PreviewScope;
  scope[globalKey] ??= new Map<string, Promise<Uint8Array>>();
  return scope[globalKey];
}

export function normalizePreviewSize(value: string | null) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return 640;
  return (
    ASSET_PREVIEW_SIZES.find((size) => requested <= size) ??
    ASSET_PREVIEW_SIZES[ASSET_PREVIEW_SIZES.length - 1]
  );
}

export function assetPreviewKey(assetId: string, size: number) {
  return `previews/${assetId}/${size}.webp`;
}

export async function getOrCreateAssetPreview(
  storage: ObjectStorage,
  asset: PreviewAsset,
  size: number,
) {
  if (asset.kind !== "image") return null;

  const key = assetPreviewKey(asset.id, size);
  const cached = await storage.get(key);
  if (cached) return cached.bytes;

  const jobs = previewJobs();
  const activeJob = jobs.get(key);
  if (activeJob) return activeJob;

  const job = (async () => {
    let source: Awaited<ReturnType<ObjectStorage["get"]>> = null;
    for (const largerSize of ASSET_PREVIEW_SIZES) {
      if (largerSize <= size) continue;
      source = await storage.get(assetPreviewKey(asset.id, largerSize));
      if (source) break;
    }
    source ??= await storage.get(asset.storageKey);
    if (!source) throw new Error("Asset file does not exist");

    const preview = await sharp(source.bytes, {
      animated: true,
      failOn: "none",
    })
      .rotate()
      .resize({
        width: size,
        height: size,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({
        quality: size >= 2400 ? 92 : 80,
        effort: 4,
        smartSubsample: true,
      })
      .toBuffer();
    const bytes = new Uint8Array(preview);
    await storage.put(key, bytes, "image/webp");
    return bytes;
  })();

  jobs.set(key, job);
  try {
    return await job;
  } finally {
    jobs.delete(key);
  }
}

import { jsonError, repository, storage } from "../../../../../lib/server";
import {
  getOrCreateAssetPreview,
  normalizePreviewSize,
} from "../../../../../lib/asset-preview";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const asset = await repository.getAsset(id);
  if (!asset || asset.deleted) return jsonError("Asset does not exist", 404);
  if (asset.kind !== "image") {
    return jsonError("Preview is only available for image assets", 415);
  }

  const size = normalizePreviewSize(
    new URL(request.url).searchParams.get("size"),
  );

  try {
    const bytes = await getOrCreateAssetPreview(storage, asset, size);
    if (!bytes) return jsonError("Preview is not available", 415);

    return new Response(bytes as BodyInit, {
      headers: {
        "cache-control": "private, max-age=31536000, immutable",
        "content-length": String(bytes.byteLength),
        "content-type": "image/webp",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
      },
    });
  } catch {
    return jsonError("Unable to create asset preview", 500);
  }
}

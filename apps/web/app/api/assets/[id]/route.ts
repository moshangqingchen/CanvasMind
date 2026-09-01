import {
  repository,
  jsonError,
  publicAsset,
  storage,
} from "../../../../lib/server";
import { deleteStoredAssetObjects } from "../../../../lib/asset-cleanup";

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const asset = await repository.getAsset(id);
  return asset
    ? Response.json(publicAsset(asset))
    : jsonError("素材不存在", 404);
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const asset = await repository.getAsset(id);
  if (!asset) return jsonError("Asset does not exist", 404);
  await repository.deleteAsset(id);
  const cleanup = await deleteStoredAssetObjects(storage, asset);
  if (cleanup.failedKeys.length > 0)
    console.error(
      `[super-canvas] unable to remove ${cleanup.failedKeys.length} stored objects for deleted asset ${asset.id}`,
    );
  return Response.json({
    ok: true,
    storageCleanupFailed: cleanup.failedKeys.length > 0,
  });
}

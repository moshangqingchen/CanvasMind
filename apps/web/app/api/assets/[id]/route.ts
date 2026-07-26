import {
  repository,
  jsonError,
  publicAsset,
  storage,
} from "../../../../lib/server";

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
  await storage.delete?.(asset.storageKey);
  return Response.json({ ok: true });
}

import {
  repository,
  jsonError,
  publicAsset,
  storage,
  publicRunRequest,
  redactPublicText,
} from "../../../../lib/server";
import { deleteStoredAssetObjects } from "../../../../lib/asset-cleanup";
import sharp from "sharp";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const asset = await repository.getAsset(id);
  if (asset && !asset.deleted && asset.kind === "image" && new URL(request.url).searchParams.get("dimensions") === "1") {
    let actualDimensions: {width:number;height:number} | null = null;
    try {
      const original = await storage.get(asset.storageKey);
      if (original) {
        const metadata = await sharp(original.bytes, {failOn:"none"}).metadata();
        if (metadata.width && metadata.height) {
          const swap = [5,6,7,8].includes(metadata.orientation ?? 1);
          actualDimensions = {width:swap?metadata.height:metadata.width,height:swap?metadata.width:metadata.height};
        }
      }
    } catch { /* Unavailable/corrupt files still expose their recorded provenance. */ }
    let provenance: Record<string, unknown> = {};
    if (typeof asset.metadata.runId === "string") {
      const nodes = await repository.listNodeRuns(asset.metadata.runId);
      const original = nodes.find(node => node.nodeId === asset.metadata.nodeId && node.outputAssetIds.includes(asset.id));
      if (original) {
        const request = publicRunRequest(original.inputJson);
        const prompt = typeof original.inputJson.prompt === "string" ? redactPublicText(original.inputJson.prompt).slice(0, 16000) : undefined;
        provenance = { ...request, ...(prompt ? { prompt } : {}), group: request?.modelGroup };
      }
    }
    return Response.json({...publicAsset(asset), actualDimensions, provenance});
  }
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

import { z } from "zod";
import { jsonError, repository, storage } from "../../../../lib/server";

const requestSchema = z.object({
  assetIds: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
});

const STORAGE_DELETE_CONCURRENCY = 4;

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return jsonError("批量删除参数无效", 400);

  const requestedIds = Array.from(new Set(parsed.data.assetIds));
  const requestedIdSet = new Set(requestedIds);
  const assets = (await repository.listAssets()).filter((asset) =>
    requestedIdSet.has(asset.id),
  );

  try {
    await repository.deleteAssets(assets.map((asset) => asset.id));
  } catch (error) {
    console.error(
      "[super-canvas] unable to persist bulk asset deletion",
      error instanceof Error ? error.message : String(error),
    );
    return jsonError("批量删除保存失败，请重试", 500);
  }

  const storageCleanupFailedIds: string[] = [];
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(STORAGE_DELETE_CONCURRENCY, assets.length) },
    async () => {
      while (nextIndex < assets.length) {
        const asset = assets[nextIndex++]!;
        try {
          await storage.delete?.(asset.storageKey);
        } catch {
          storageCleanupFailedIds.push(asset.id);
        }
      }
    },
  );
  await Promise.all(workers);
  if (storageCleanupFailedIds.length > 0) {
    console.error(
      `[super-canvas] unable to remove ${storageCleanupFailedIds.length} deleted asset objects`,
    );
  }

  return Response.json({
    deletedIds: requestedIds,
    failedIds: [],
    storageCleanupFailedIds,
  });
}

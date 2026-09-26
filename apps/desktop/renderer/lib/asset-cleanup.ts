import type { AssetRecord } from "@super-canvas/db";
import type { ObjectStorage } from "@super-canvas/storage";
import { ASSET_PREVIEW_SIZES, assetPreviewKey } from "./asset-preview";

export interface AssetCleanupResult {
  attemptedKeys: string[];
  failedKeys: string[];
}

export async function deleteStoredAssetObjects(
  storage: ObjectStorage,
  asset: Pick<AssetRecord, "id" | "kind" | "storageKey">,
): Promise<AssetCleanupResult> {
  const attemptedKeys = [
    asset.storageKey,
    ...(asset.kind === "image"
      ? ASSET_PREVIEW_SIZES.map((size) => assetPreviewKey(asset.id, size))
      : []),
  ];
  if (!storage.delete) return { attemptedKeys: [], failedKeys: [] };

  const settled = await Promise.allSettled(
    attemptedKeys.map((key) => storage.delete!(key)),
  );
  return {
    attemptedKeys,
    failedKeys: attemptedKeys.filter(
      (_key, index) => settled[index]?.status === "rejected",
    ),
  };
}

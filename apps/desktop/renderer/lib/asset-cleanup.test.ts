import { describe, expect, it, vi } from "vitest";
import { ASSET_PREVIEW_SIZES, assetPreviewKey } from "./asset-preview";
import { deleteStoredAssetObjects } from "./asset-cleanup";

describe("deleteStoredAssetObjects", () => {
  it("deletes the original and every generated preview for images", async () => {
    const remove = vi.fn(async () => undefined);
    const result = await deleteStoredAssetObjects(
      { put: vi.fn(), get: vi.fn(), delete: remove },
      { id: "asset-1", kind: "image", storageKey: "assets/asset-1/original.png" },
    );

    expect(result.failedKeys).toEqual([]);
    expect(remove).toHaveBeenCalledTimes(1 + ASSET_PREVIEW_SIZES.length);
    expect(result.attemptedKeys).toEqual([
      "assets/asset-1/original.png",
      ...ASSET_PREVIEW_SIZES.map((size) => assetPreviewKey("asset-1", size)),
    ]);
  });

  it("reports failed keys without abandoning the remaining cleanup", async () => {
    const remove = vi.fn(async (key: string) => {
      if (key.endsWith("640.webp")) throw new Error("temporary failure");
    });
    const result = await deleteStoredAssetObjects(
      { put: vi.fn(), get: vi.fn(), delete: remove },
      { id: "asset-2", kind: "image", storageKey: "assets/asset-2/original.png" },
    );

    expect(result.failedKeys).toEqual([assetPreviewKey("asset-2", 640)]);
    expect(remove).toHaveBeenCalledTimes(1 + ASSET_PREVIEW_SIZES.length);
  });
});

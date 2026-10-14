import type { AssetView } from "../components/types";

/** Actual original-file metadata is distinct from requested resolution presets. */
export function imageOutputDimensionNotice(asset?: Pick<AssetView, "kind" | "metadata">): string | undefined {
  const notice = asset?.metadata.imageOutputDimensionNotice;
  return asset?.kind === "image" && typeof notice === "string" && notice.trim()
    ? notice.trim() : undefined;
}

export function imageOutputTransparencyLabel(asset?: Pick<AssetView, "kind" | "metadata">): string | undefined {
  if (asset?.kind !== "image" || asset.metadata.imageOutputVerified !== true) return undefined;
  if (asset.metadata.imageHasVisiblePixels === false) return "原图没有可见主体";
  if (asset.metadata.imageHasTransparentPixels === true)
    return asset.metadata.imageHasVisiblePixels === true ? "原图含真实透明像素" : "原图含透明像素（主体信息未记录）";
  if (asset.metadata.imageHasTransparentPixels === false || asset.metadata.imageHasAlpha === false) return "原图不透明";
  return undefined;
}

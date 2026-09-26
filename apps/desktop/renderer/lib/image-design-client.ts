import type { ImageDesignReviewInput } from "@super-canvas/core";
import type { AssetView } from "../components/types";

export class ImageReviewConflictError extends Error {
  constructor(
    readonly asset: AssetView,
    message: string,
  ) {
    super(message);
    this.name = "ImageReviewConflictError";
  }
}

export async function saveImageDesignReview(
  assetId: string,
  input: ImageDesignReviewInput,
): Promise<AssetView> {
  const response = await fetch(
    `/api/assets/${encodeURIComponent(assetId)}/design-review`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = await response.json().catch(() => null);
  if (response.status === 409 && payload?.asset?.id === assetId) {
    throw new ImageReviewConflictError(
      payload.asset,
      payload.error || "评审已在其他位置更新，请核对后重新保存",
    );
  }
  if (!response.ok || payload?.id !== assetId || payload?.kind !== "image")
    throw new Error(payload?.error || "图片评审保存失败，请重试");
  return payload as AssetView;
}

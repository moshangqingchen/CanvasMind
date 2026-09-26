import {
  ImageDesignReviewConflictError,
  ImageDesignReviewValidationError,
  type AssetImageDesignReviewInput,
  type AssetRecord,
} from "./types.js";

/** Called while the repository owns the current record's mutation lock. */
export function applyImageDesignReview(
  asset: AssetRecord,
  input: AssetImageDesignReviewInput,
): AssetRecord {
  if (asset.kind !== "image") {
    throw new ImageDesignReviewValidationError("只有图片素材可以标记设计评审");
  }
  if (
    !["unreviewed", "candidate", "approved", "rejected"].includes(
      input.status,
    ) ||
    typeof input.note !== "string" ||
    input.note.length > 2000 ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    input.expectedRevision >= Number.MAX_SAFE_INTEGER
  ) {
    throw new ImageDesignReviewValidationError("图片评审参数无效");
  }
  const stored = asset.metadata.imageDesignReview;
  const value =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>).revision
      : undefined;
  const revision =
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : 0;
  if (revision !== input.expectedRevision) {
    throw new ImageDesignReviewConflictError(structuredClone(asset));
  }
  return {
    ...asset,
    metadata: {
      ...asset.metadata,
      imageDesignReview: {
        status: input.status,
        note: input.note,
        revision: revision + 1,
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

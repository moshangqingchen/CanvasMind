import { z } from "zod";

export type ImageReviewStatus =
  "unreviewed" | "candidate" | "approved" | "rejected";

export interface ImageDesignReview {
  status: ImageReviewStatus;
  note: string;
  revision: number;
  updatedAt?: string;
}

export interface ImageDesignReviewInput {
  status: ImageReviewStatus;
  note: string;
  expectedRevision: number;
}

export const IMAGE_REVIEW_NOTE_LIMIT = 2000;

export const IMAGE_REVIEW_LABELS: Record<ImageReviewStatus, string> = {
  unreviewed: "未标记",
  candidate: "候选",
  approved: "定稿",
  rejected: "淘汰",
};

export const imageDesignReviewInputSchema = z
  .object({
    status: z.enum(["unreviewed", "candidate", "approved", "rejected"]),
    note: z.string().max(IMAGE_REVIEW_NOTE_LIMIT),
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict();

/** Old assets have no review; malformed imported values must not break the UI. */
export function readImageDesignReview(
  metadata: Record<string, unknown>,
): ImageDesignReview {
  const value = metadata["imageDesignReview"];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "unreviewed", note: "", revision: 0 };
  }
  const record = value as Record<string, unknown>;
  const status = record["status"];
  const note = record["note"];
  const revision = record["revision"];
  const updatedAt = record["updatedAt"];
  return {
    status:
      status === "candidate" || status === "approved" || status === "rejected"
        ? status
        : "unreviewed",
    note: typeof note === "string" ? note : "",
    revision:
      typeof revision === "number" &&
      Number.isSafeInteger(revision) &&
      revision >= 0
        ? revision
        : 0,
    ...(typeof updatedAt === "string" ? { updatedAt } : {}),
  };
}

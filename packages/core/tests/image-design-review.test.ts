import { describe, expect, it } from "vitest";
import {
  IMAGE_REVIEW_NOTE_LIMIT,
  imageDesignReviewInputSchema,
  readImageDesignReview,
} from "../src/image-design-review.js";

describe("image design review contract", () => {
  it("reads old assets as unreviewed without changing their metadata", () => {
    const metadata = { sourceNodeId: "node-1", prompt: "原始提示词" };
    expect(readImageDesignReview(metadata)).toEqual({
      status: "unreviewed",
      note: "",
      revision: 0,
    });
    expect(metadata).not.toHaveProperty("imageDesignReview");
  });

  it("reads stored reviews and tolerates malformed imports", () => {
    const review = {
      status: "approved",
      note: "客户已确认",
      revision: 2,
      updatedAt: "2026-09-20T00:00:00.000Z",
    };
    expect(readImageDesignReview({ imageDesignReview: review })).toEqual(
      review,
    );
    expect(readImageDesignReview({ imageDesignReview: [] })).toEqual({
      status: "unreviewed",
      note: "",
      revision: 0,
    });
    expect(
      readImageDesignReview({
        imageDesignReview: { status: "toString", note: null, revision: -1 },
      }),
    ).toEqual({ status: "unreviewed", note: "", revision: 0 });
  });

  it("validates status, note limits and a safe expected revision", () => {
    const valid = {
      status: "candidate",
      note: "字".repeat(IMAGE_REVIEW_NOTE_LIMIT),
      expectedRevision: 0,
    };
    expect(imageDesignReviewInputSchema.safeParse(valid).success).toBe(true);
    for (const invalid of [
      { ...valid, status: "final" },
      { ...valid, note: valid.note + "字" },
      { ...valid, expectedRevision: -1 },
      { ...valid, expectedRevision: 0.5 },
      { ...valid, expectedRevision: Number.MAX_SAFE_INTEGER },
      { ...valid, metadata: { sourceNodeId: "overwrite" } },
    ]) {
      expect(imageDesignReviewInputSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });
});

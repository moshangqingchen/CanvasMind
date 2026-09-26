import { afterEach, expect, it, vi } from "vitest";
import {
  ImageReviewConflictError,
  saveImageDesignReview,
} from "./image-design-client";

afterEach(() => vi.unstubAllGlobals());

it("surfaces a conflicting review with the latest asset so the caller can keep its draft", async () => {
  const asset = {
    id: "image-1",
    kind: "image",
    metadata: {
      imageDesignReview: { status: "approved", note: "新备注", revision: 3 },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: "版本冲突", asset }, { status: 409 }),
    ),
  );
  const error = await saveImageDesignReview("image-1", {
    status: "candidate",
    note: "我的草稿",
    expectedRevision: 2,
  }).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ImageReviewConflictError);
  expect((error as ImageReviewConflictError).asset).toEqual(asset);
});

it("rejects invalid success bodies and server failures rather than claiming a saved review", async () => {
  const input = { status: "approved" as const, note: "", expectedRevision: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ id: "other", kind: "image" })),
  );
  await expect(saveImageDesignReview("image-1", input)).rejects.toThrow(
    "保存失败",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: "磁盘写入失败" }, { status: 503 }),
    ),
  );
  await expect(saveImageDesignReview("image-1", input)).rejects.toThrow(
    "磁盘写入失败",
  );
});

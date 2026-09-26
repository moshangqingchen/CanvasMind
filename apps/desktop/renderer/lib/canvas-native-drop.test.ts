import React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

let helpers: Pick<
  typeof import("../components/canvas-app"),
  | "availablePendingNativeDrop"
  | "filesForNativeDrop"
  | "filesFromNativeDrop"
  | "nativeDropContentKey"
>;

describe("native canvas drop identity", () => {
  beforeAll(async () => {
    vi.stubGlobal("React", React);
    helpers = await import("../components/canvas-app");
  });

  it("preserves two distinct files even when all visible metadata matches", () => {
    const first = new File(["first"], "same.png", {
      type: "image/png",
      lastModified: 123,
    });
    const second = new File(["other"], "same.png", {
      type: "image/png",
      lastModified: 123,
    });

    expect(
      helpers.filesForNativeDrop([first, second], [first, second]),
    ).toEqual([first, second]);
  });

  it("falls back to item files when the canonical file list is empty", () => {
    const itemFile = new File(["item"], "item.png", { type: "image/png" });

    expect(helpers.filesForNativeDrop([], [itemFile])).toEqual([itemFile]);
  });

  it("reads a desktop-app file through a File System Access handle", async () => {
    const handledFile = new File(["wechat"], "微信图片.png", {
      type: "image/png",
    });
    const item = {
      kind: "file",
      getAsFile: () => null,
      getAsFileSystemHandle: () =>
        Promise.resolve({
          kind: "file",
          getFile: () => Promise.resolve(handledFile),
        }),
    } as unknown as DataTransferItem;

    await expect(helpers.filesFromNativeDrop([], [item])).resolves.toEqual([
      handledFile,
    ]);
  });

  it("falls back to Chromium's legacy FileEntry surface", async () => {
    const entryFile = new File(["legacy"], "旧版微信图片.jpg", {
      type: "image/jpeg",
    });
    const item = {
      kind: "file",
      getAsFile: () => null,
      getAsFileSystemHandle: () => Promise.reject(new Error("unavailable")),
      webkitGetAsEntry: () => ({
        isFile: true,
        file: (success: (file: File) => void) => success(entryFile),
      }),
    } as unknown as DataTransferItem;

    await expect(helpers.filesFromNativeDrop([], [item])).resolves.toEqual([
      entryFile,
    ]);
  });

  it("matches identical content keys to separate pending node occurrences", () => {
    const now = 10_000;
    const file = new File(["same"], "same.png", { type: "image/png" });
    const entries = [
      { nodeId: "pending-1", createdAt: now - 10 },
      { nodeId: "pending-2", createdAt: now - 10 },
    ];
    const first = helpers.availablePendingNativeDrop(entries, new Set(), now);
    const second = helpers.availablePendingNativeDrop(
      entries,
      new Set([first!.nodeId]),
      now,
    );

    expect(helpers.nativeDropContentKey(file)).toBe(
      helpers.nativeDropContentKey({ name: file.name, size: file.size }),
    );
    expect(first?.nodeId).toBe("pending-1");
    expect(second?.nodeId).toBe("pending-2");
  });
});

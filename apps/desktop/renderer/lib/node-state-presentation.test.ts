import { describe, expect, it } from "vitest";
import { assetHasKnownAlpha, nodeVisualStatus, reflectedPendingSourceStatus } from "./node-state-presentation";

describe("node state presentation", () => {
  it("keeps waiting distinct from active upstream work", () => {
    expect(nodeVisualStatus("queued")).toBe("queued");
    expect(nodeVisualStatus("blocked")).toBe("queued");
    expect(nodeVisualStatus("archiving")).toBe("running");
    expect(nodeVisualStatus("needs_attention")).toBe("failed");
    expect(nodeVisualStatus("succeeded")).toBe("succeeded");
    expect(nodeVisualStatus("cancelled")).toBe("idle");
  });
  it("uses actual image alpha facts and leaves unknown or non-image assets plain", () => {
    expect(assetHasKnownAlpha()).toBe(false);
    expect(assetHasKnownAlpha({ kind: "image", metadata: { format: "png", background: "transparent" } })).toBe(false);
    expect(assetHasKnownAlpha({ kind: "image", metadata: { imageHasAlpha: false } })).toBe(false);
    expect(assetHasKnownAlpha({ kind: "video", metadata: { imageHasAlpha: true } })).toBe(false);
    expect(assetHasKnownAlpha({ kind: "image", metadata: { imageHasAlpha: true } })).toBe(true);
    expect(assetHasKnownAlpha({ kind: "image", metadata: { imageHasTransparentPixels: true } })).toBe(true);
  });
  it("preserves queued truth and any concurrently running result", () => {
    expect(reflectedPendingSourceStatus("queued", "queued")).toBe("queued");
    expect(reflectedPendingSourceStatus(undefined, "blocked")).toBe("queued");
    expect(reflectedPendingSourceStatus("queued", "running")).toBe("running");
    expect(reflectedPendingSourceStatus("running", "queued")).toBe("running");
    expect(reflectedPendingSourceStatus("succeeded", "queued")).toBe("queued");
  });
});

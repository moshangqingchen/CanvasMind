import type { AssetView } from "../components/types";
import type { NodeRunStatus } from "@super-canvas/core";

export type NodeVisualStatus = "idle" | "queued" | "running" | "succeeded" | "failed";
export function nodeVisualStatus(status?: string): NodeVisualStatus {
  if (status === "queued" || status === "blocked") return "queued";
  if (["submitting", "running", "polling", "downloading", "archiving", "cancel_requested"].includes(status ?? "")) return "running";
  if (status === "succeeded") return "succeeded";
  if (status === "failed" || status === "needs_attention") return "failed";
  return "idle";
}

/** Concurrent pending results cannot turn a known queued source into running. */
export function reflectedPendingSourceStatus(current?: NodeRunStatus, pending?: NodeRunStatus): NodeRunStatus {
  return nodeVisualStatus(current) === "running" || nodeVisualStatus(pending) === "running" ? "running" : "queued";
}

/** File extensions, requests and the transparency menu are not alpha evidence. */
export function assetHasKnownAlpha(asset?: Pick<AssetView, "kind" | "metadata">): boolean {
  return asset?.kind === "image" && (asset.metadata.imageHasAlpha === true || asset.metadata.imageHasTransparentPixels === true);
}

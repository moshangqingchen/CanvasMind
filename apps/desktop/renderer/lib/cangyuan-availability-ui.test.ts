import { describe, expect, it } from "vitest";
import type { CangyuanAvailabilityView } from "./client-api";
import { cangyuanAvailabilityForModel, modelAvailabilityBadgeState } from "./cangyuan-availability-ui";

const items: CangyuanAvailabilityView[] = [
  {
    name: "gpt-image-2-4k",
    category: "image",
    latestStatus: "operational",
    availability: 99.8,
    averageLatencyMs: 812,
    timeline: [],
  },
  {
    name: "Nano Banana Pro 2K",
    category: "image",
    latestStatus: "degraded",
    availability: 96.4,
    averageLatencyMs: 1480,
    timeline: [],
  },
];

describe("availability badge freshness", () => {
  const checkedAt = "2026-09-22T00:00:00Z";
  const now = Date.parse(checkedAt);
  it("shows a failed refresh before the previous green status", () => {
    expect(modelAvailabilityBadgeState(items[0], "error", checkedAt, now)).toEqual({ tone: "error", label: "更新失败" });
    expect(modelAvailabilityBadgeState(undefined, "error", undefined, now).label).toBe("查询失败");
  });
  it("expires cached healthy readings, including a stalled refresh or missing timestamp", () => {
    expect(modelAvailabilityBadgeState(items[0], "ready", checkedAt, now + 30_000).tone).toBe("operational");
    expect(modelAvailabilityBadgeState(items[0], "loading", checkedAt, now + 91_000).tone).toBe("stale");
    expect(modelAvailabilityBadgeState(items[0], "ready", undefined, now).label).toBe("已过期");
    expect(modelAvailabilityBadgeState(items[0], "ready", "invalid", now).label).toBe("已过期");
  });
});

describe("cangyuanAvailabilityForModel", () => {
  it("prefers an exact model id match", () => {
    expect(
      cangyuanAvailabilityForModel(
        { id: "gpt-image-2-4k", name: "GPT Image 2 4K（¥0.095/张）" },
        items,
      ),
    ).toBe(items[0]);
  });

  it("matches a display name after removing its price suffix", () => {
    expect(
      cangyuanAvailabilityForModel(
        { id: "nano-banana-pro-2k", name: "Nano Banana Pro 2K（¥0.13/张）" },
        items,
      ),
    ).toBe(items[1]);
  });

  it("does not guess a status for an unlisted model", () => {
    expect(
      cangyuanAvailabilityForModel(
        { id: "missing-model", name: "Missing Model（¥1/张）" },
        items,
      ),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import type { CangyuanAvailabilityItem } from "./cangyuan-availability-types";
import { cangyuanAvailabilityForModel, cangyuanAvailabilityBuckets, cangyuanPaceLabel,
  modelAvailabilityBadgeState, receiveModelAvailabilitySnapshot } from "./cangyuan-availability-ui";

const items: CangyuanAvailabilityItem[] = [{
  name: "gpt-image-2", category: "image", latestStatus: "degraded", cause: "slow", timeline: null,
  routes: [
    { name: "gpt-image-2-4k", latestStatus: "available", pace: { kind: "generation", ms: 8120 }, timeline: null },
    { name: "gpt-image-2-2k", latestStatus: "degraded", cause: "slow", timeline: null },
  ],
}, { name: "gpt", category: "text", latestStatus: "unavailable", timeline: null, routes: [
  { name: "LLM-GPT-plus", latestStatus: "available", pace: { kind: "first_token", ms: 800 }, timeline: null },
] }];
const route = items[0].routes[0];

describe("availability badge freshness", () => {
  const checkedAt = "2026-09-22T00:00:00Z";
  const now = Date.parse(checkedAt);
  it("shows a failed refresh before the previous green status", () => {
    expect(modelAvailabilityBadgeState(route, "error", checkedAt, now)).toEqual({ tone: "error", label: "更新失败" });
    expect(modelAvailabilityBadgeState(undefined, "error", undefined, now).label).toBe("查询失败");
  });
  it("expires cached healthy readings, including a stalled refresh or missing timestamp", () => {
    expect(modelAvailabilityBadgeState(route, "ready", checkedAt, now + 60_000).tone).toBe("available");
    expect(modelAvailabilityBadgeState(route, "loading", checkedAt, now + 151_000).tone).toBe("stale");
    expect(modelAvailabilityBadgeState(route, "ready", undefined, now).label).toBe("已过期");
    expect(modelAvailabilityBadgeState(route, "ready", "invalid", now).label).toBe("已过期");
  });
  it("never presents preparing or disabled monitoring as current green status", () => {
    expect(modelAvailabilityBadgeState(route, "preparing", checkedAt, now).tone).toBe("preparing");
    expect(modelAvailabilityBadgeState(route, "disabled", checkedAt, now).tone).toBe("disabled");
  });
});

describe("cangyuanAvailabilityForModel", () => {
  it("uses the exact model route rather than the product's aggregate degradation", () => {
    expect(cangyuanAvailabilityForModel({ id: "gpt-image-2-4k", name: "GPT Image 2 4K（¥0.095/张）" }, items))
      .toMatchObject({ name: route.name, latestStatus: "available", pace: route.pace, productName: "gpt-image-2" });
    expect(cangyuanAvailabilityForModel({ id: "gpt-image-2-2k", name: "GPT Image 2" }, items)?.latestStatus).toBe("degraded");
  });

  it("matches text by the current group even when the model ID differs", () => {
    expect(cangyuanAvailabilityForModel({ id: "gpt-5.5", name: "GPT" }, items,
      { category: "text", group: "LLM-GPT-plus" })).toMatchObject({ name: "LLM-GPT-plus", latestStatus: "available" });
    expect(cangyuanAvailabilityForModel({ id: "LLM-GPT-plus", name: "GPT" }, items, { category: "text", group: "missing" })).toBeUndefined();
  });

  it("does not infer a model from its display name, a similar ID or its product name", () => {
    for (const id of ["missing-model", "gpt-image-2(4k)", "gptimage24k", "gpt-image-2"]) {
      expect(cangyuanAvailabilityForModel({ id, name: "gpt-image-2-4k" }, items)).toBeUndefined();
    }
    expect(cangyuanAvailabilityForModel({ id: route.name, name: route.name }, items, { category: "video" })).toBeUndefined();
  });
});

describe("readiness and prior observations", () => {
  const previous = { connectionId: "key-a", items, checkedAt: "2026-10-03T00:00:00Z", state: "ready" as const };
  const incoming = { checkedAt: "2026-10-03T00:05:00Z", enabled: true, ready: false, items: [] };
  it("retains the same connection's old data without renewing its timestamp", () => {
    expect(receiveModelAvailabilitySnapshot(previous, "key-a", incoming)).toEqual({ ...previous, state: "preparing" });
    expect(receiveModelAvailabilitySnapshot(previous, "key-b", incoming)).toEqual({ connectionId: "key-b", items: [], checkedAt: undefined, state: "preparing" });
  });
  it("shows server history on first open without renewing it or reusing another connection's history", () => {
    const backendHistory = { ...incoming, items, checkedAt: "2026-10-02T23:50:00Z" };
    expect(receiveModelAvailabilitySnapshot({ connectionId: "", items: [], state: "idle" }, "key-b", backendHistory))
      .toEqual({ connectionId: "key-b", items, checkedAt: backendHistory.checkedAt, state: "preparing" });
    expect(receiveModelAvailabilitySnapshot(previous, "key-b", { ...backendHistory, checkedAt: "invalid" }))
      .toEqual({ connectionId: "key-b", items: [], checkedAt: undefined, state: "preparing" });
  });
  it("clears old green observations on disable and marks stale server data as failed", () => {
    expect(receiveModelAvailabilitySnapshot(previous, "key-a", { ...incoming, enabled: false })).toMatchObject({ state: "disabled", items: [] });
    expect(receiveModelAvailabilitySnapshot(previous, "key-a", { ...incoming, ready: true, items, source: "stale" }).state).toBe("error");
  });
});

describe("time bucket boundaries", () => {
  it("aligns to the official clock boundary and clips partial first and last buckets", () => {
    expect(cangyuanAvailabilityBuckets({ startedAt: 650, endedAt: 1850, bucketSeconds: 600,
      statuses: ["available", "degraded", "unavailable", "available"] })).toEqual([
      { startedAt: 650, endedAt: 1200, status: "available" },
      { startedAt: 1200, endedAt: 1800, status: "degraded" },
      { startedAt: 1800, endedAt: 1850, status: "unavailable" },
    ]);
  });
  it("limits history to eight hours and 48 buckets without filling missing data", () => {
    const buckets = cangyuanAvailabilityBuckets({ startedAt: 0, endedAt: 60 * 600, bucketSeconds: 600,
      statuses: Array.from({ length: 60 }, (_, i) => i < 12 ? "unavailable" : "available") });
    expect(buckets).toHaveLength(48);
    expect(buckets[0]).toEqual({ startedAt: 12 * 600, endedAt: 13 * 600, status: "available" });
    expect(cangyuanAvailabilityBuckets({ startedAt: 0, endedAt: 1200, bucketSeconds: 600, statuses: ["available"] })).toHaveLength(1);
    expect(cangyuanAvailabilityBuckets(null)).toEqual([]);
    expect(cangyuanAvailabilityBuckets({ startedAt: 0, endedAt: 1, bucketSeconds: 0, statuses: ["available"] })).toEqual([]);
  });
});

it("labels supplied median pace without inventing a sample or computing success rate", () => {
  expect(cangyuanPaceLabel(route)).toBe("生成耗时中位数 8.1 秒");
  expect(cangyuanPaceLabel(items[1].routes[0])).toBe("首字时间中位数 800 毫秒");
  expect(cangyuanPaceLabel(items[0].routes[1])).toBe("本周期暂无耗时样本");
});

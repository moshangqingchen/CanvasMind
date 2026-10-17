import { describe, expect, it } from "vitest";
import { catalogCheckNotice, catalogFailureLabel, nextCatalogCheckAction } from "./client-catalog-check";

describe("catalog check client scheduling", () => {
  const now = Date.parse("2026-10-17T08:00:00Z");
  it("off never schedules a POST or polling request, including an old running status", () => {
    expect(nextCatalogCheckAction({ mode: "off", phase: "running", nextCheckAt: new Date(now - 1).toISOString() }, now)).toBeNull();
  });
  it("polls a running job without restarting it", () => {
    expect(nextCatalogCheckAction({ mode: "daily", phase: "running", nextCheckAt: new Date(now).toISOString() }, now)).toEqual({ method: "GET", delay: 3000 });
  });
  it("waits a full day without a premature provider request", () => {
    const next = new Date(now + 86_400_000).toISOString();
    expect(nextCatalogCheckAction({ mode: "daily", phase: "complete", nextCheckAt: next }, now)).toEqual({ method: "GET", delay: 86_400_000 });
    expect(nextCatalogCheckAction({ mode: "daily", phase: "complete", nextCheckAt: next }, now + 86_400_000)).toEqual({ method: "POST", delay: 5000 });
  });
  it("leaves a completed upgrade alone", () => {
    expect(nextCatalogCheckAction({ mode: "upgrade", phase: "complete", nextCheckAt: null }, now)).toBeNull();
  });
  it("rechecks only local state daily when all connections pause, so manual recovery can resume scheduling", () => {
    expect(nextCatalogCheckAction({ mode: "daily", phase: "complete", nextCheckAt: null }, now)).toEqual({ method: "GET", delay: 86_400_000 });
  });
  it("does not invent a due date from a malformed response", () => {
    expect(nextCatalogCheckAction({ mode: "daily", phase: "idle", nextCheckAt: "invalid" }, now)).toBeNull();
  });
});

describe("catalog check notices", () => {
  it("does not notify for a timestamp-only update", () => {
    expect(catalogCheckNotice({ noticeId: null, priceChangedSupplierIds: [], changedConnectionIds: [], manualConnectionIds: [] })).toBe("");
  });
  it("counts suppliers once and keeps manual attention visible", () => {
    expect(catalogCheckNotice({ noticeId: "change", priceChangedSupplierIds: ["a", "b", "a"], changedConnectionIds: ["c"], manualConnectionIds: ["d"] })).toBe("2 个供应商价格有变动 · 1 个连接需要手动刷新");
  });
  it("reports added or removed models without asserting a price change", () => {
    expect(catalogCheckNotice({ noticeId: "change", priceChangedSupplierIds: [], changedConnectionIds: ["c", "c"], manualConnectionIds: [] })).toBe("已更新 1 个连接的型号目录");
  });
  it("uses short reason classifications", () => {
    expect(catalogFailureLabel("authentication")).toBe("鉴权");
    expect(catalogFailureLabel("incomplete")).toBe("目录或价格未完整读取");
  });
});

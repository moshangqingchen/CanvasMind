import { afterEach, describe, expect, it, vi } from "vitest";
import { acknowledgeCatalogCheckNotice, catalogCheckNotice, catalogFailureLabel, confirmCatalogCandidate, nextCatalogCheckAction, readCatalogCheckStatus } from "./client-catalog-check";

afterEach(() => vi.unstubAllGlobals());

describe("catalog diagnostic actions", () => {
  it("only explicit confirmation sends the exact candidate version, never a refresh or client descriptors", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ noticeId: null })); vi.stubGlobal("fetch", fetcher);
    await readCatalogCheckStatus();
    expect(fetcher.mock.calls[0]).toEqual(["/api/suppliers/catalog-upgrade", { cache: "no-store", signal: undefined }]);
    const input = { connectionId: "connection-a", sourceKey: "source-a", candidateVersion: "exact-version", models: ["not-client-authority"] };
    await confirmCatalogCandidate(input);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ action: "confirm-candidate", connectionId: "connection-a", sourceKey: "source-a", candidateVersion: "exact-version" }) });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("returns a stale-candidate message without silently confirming a replacement version", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 409 })); vi.stubGlobal("fetch", fetcher);
    await expect(confirmCatalogCandidate({ connectionId: "a", sourceKey: "b", candidateVersion: "old" })).rejects.toThrow("候选目录已变化");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("acknowledges scoped cursors with a local PATCH, not a collection POST", async () => {
    const fetcher = vi.fn(async () => Response.json({})); vi.stubGlobal("fetch", fetcher);
    await acknowledgeCatalogCheckNotice({ "supplier-a/changes:a": 5, "supplier-b/changes:b": 1 });
    expect(fetcher).toHaveBeenCalledWith("/api/suppliers/catalog-upgrade", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ noticeCursors: { "supplier-a/changes:a": 5, "supplier-b/changes:b": 1 } }) }));
  });
});

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
    expect(catalogCheckNotice({ noticeId: null, priceChangedSupplierIds: [], changedConnectionIds: [], manualConnectionIds: [], retainedPriceModelCount: 32 })).toBe("");
  });
  it("counts suppliers once and keeps manual attention visible", () => {
    expect(catalogCheckNotice({ noticeId: "change", priceChangedSupplierIds: ["a", "b", "a"], changedConnectionIds: ["c"], manualConnectionIds: ["d"] })).toBe("2 个供应商价格有变动 · 1 个连接需要手动刷新");
  });
  it("reports added or removed models without asserting a price change", () => {
    expect(catalogCheckNotice({ noticeId: "change", priceChangedSupplierIds: [], changedConnectionIds: ["c", "c"], manualConnectionIds: [] })).toBe("已更新 1 个连接的型号目录");
  });
  it("attaches a retained-price count without describing it as a price change", () => {
    const status = { noticeId: "change", priceChangedSupplierIds: [], changedConnectionIds: ["c"], manualConnectionIds: [], retainedPriceModelCount: 32 };
    expect(catalogCheckNotice(status)).toBe("已更新 1 个连接的型号目录 · 部分型号沿用上次价格（32 个）");
    expect(catalogCheckNotice({ ...status, retainedPriceModelCount: 0 })).toBe("已更新 1 个连接的型号目录");
    expect(catalogCheckNotice({ ...status, priceChangedSupplierIds: ["s"] })).toBe("1 个供应商价格有变动 · 部分型号沿用上次价格（32 个）");
  });
  it("uses short reason classifications", () => {
    expect(catalogFailureLabel("authentication")).toBe("鉴权");
    expect(catalogFailureLabel("incomplete")).toBe("型号列表未完整读取");
  });
});

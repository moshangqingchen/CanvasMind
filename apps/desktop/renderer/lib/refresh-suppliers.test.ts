import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), connections: vi.fn(), scan: vi.fn(), invalidate: vi.fn(), billing: vi.fn(), seed: vi.fn() }));
vi.mock("./client-api", () => ({ fetchConnections: mocks.connections, invalidateModelCache: mocks.invalidate }));
vi.mock("./client-supplier-billing", () => ({ refreshSupplierAccount: mocks.billing, seedSupplierBilling: mocks.seed }));
vi.mock("./client-suppliers", () => ({ fetchSuppliers: mocks.fetch, scanSupplier: mocks.scan, supplierOwnsConnection: (s: { id: string }, c: { config: { supplierId: string } }) => s.id === c.config.supplierId }));
import { refreshAllSuppliers, refreshSupplier, subscribeSupplierRefresh, type SupplierRefreshProgress } from "./refresh-suppliers";
const supplier = (id: string) => ({ id, name: id, state: { revision: 2 }, catalog: { groups: [{ id: "old", label: "Old", source: "catalog", models: [] }] }, scanStatus: "live", scanComplete: true, scannedAt: "old-time" });
beforeEach(() => { vi.clearAllMocks(); mocks.connections.mockResolvedValue([]); });
describe("refresh all configured suppliers", () => {
  it("does not count a failed refresh of a previously confirmed empty Key as newly confirmed", async () => {
    mocks.fetch.mockResolvedValue([supplier("one")]);
    const before = { id: "key", apiKeySet: true, config: { supplierId: "one", modelScanStatus: "empty", modelScanCheckedAt: "old-time" } };
    mocks.connections.mockResolvedValueOnce([before]).mockResolvedValueOnce([{ ...before, config: {
      ...before.config, modelScanCheckedAt: "new-time", modelScanLastSuccessAt: "old-time", modelScanAttemptStatus: "failed",
    } }]);
    mocks.scan.mockResolvedValue({ ...supplier("one"), scannedAt: "new-time" });
    let state!: SupplierRefreshProgress;
    const unsubscribe = subscribeSupplierRefresh(s => { state = s; });
    await refreshAllSuppliers();
    expect(state.results[0]!.status).toBe("partial");
    expect(state.results[0]!.message).toContain("Key 已确认 0/1");
    unsubscribe();
  });
  it("reads the full connection list only twice and scans at most two suppliers concurrently", async () => {
    mocks.fetch.mockResolvedValue(Array.from({ length: 7 }, (_, i) => supplier(`supplier-${i}`)));
    let active = 0;
    let maximum = 0;
    mocks.scan.mockImplementation(async (id: string) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      return { ...supplier(id), scannedAt: "new-time" };
    });
    await refreshAllSuppliers();
    expect(maximum).toBe(2);
    expect(mocks.connections).toHaveBeenCalledTimes(2);
    expect(mocks.scan).toHaveBeenCalledTimes(7);
  });
  it("coalesces repeated clicks, excludes deleted entries, and continues after a supplier failure", async () => {
    mocks.fetch.mockResolvedValue([supplier("one"), supplier("two"), { ...supplier("deleted"), state: { visibility: "deleted" } }]);
    mocks.scan.mockRejectedValueOnce(new Error("secret-bearing upstream error"));
    mocks.scan.mockResolvedValueOnce({ ...supplier("two"), scannedAt: "new-time", catalog: { groups: [{ id: "new", label: "New", source: "catalog" }] } });
    let state!: SupplierRefreshProgress;
    const unsubscribe = subscribeSupplierRefresh(s => { state = s; });
    const first = refreshAllSuppliers();
    expect(refreshAllSuppliers()).toBe(first);
    await first;
    expect(mocks.scan).toHaveBeenCalledTimes(2);
    expect(mocks.scan).toHaveBeenCalledWith("two", undefined, 2, { verifyCapabilities: false });
    expect(state.completed).toBe(2);
    expect(state.running).toBe(false);
    expect(state.results.map(r => r.status)).toEqual(["failed", "partial"]);
    expect(state.results[1]!.message).toContain("分组新增 1、未再返回 1");
    expect(JSON.stringify(state)).not.toContain("secret-bearing");
    unsubscribe();
  });
  it("does not report an old successful Key snapshot as freshly confirmed", async () => {
    mocks.fetch.mockResolvedValue([supplier("one")]);
    mocks.connections.mockResolvedValue([{ id: "key", apiKeySet: true, config: { supplierId: "one", modelScanStatus: "live", modelScanCheckedAt: "old-time", modelAddedIds: ["cached"] } }]);
    mocks.scan.mockResolvedValue({ ...supplier("one"), scannedAt: "new-time" });
    let state!: SupplierRefreshProgress;
    const unsubscribe = subscribeSupplierRefresh(s => { state = s; });
    await refreshAllSuppliers();
    expect(state.results[0]!.status).toBe("partial");
    expect(state.results[0]!.message).toContain("Key 已确认 0/1");
    expect(state.results[0]!.message).toContain("模型新增 0");
    unsubscribe();
  });
  it("refreshes one supplier, coalesces repeated clicks, and preserves other reports", async () => {
    mocks.fetch.mockResolvedValue([supplier("one"), supplier("two")]);
    mocks.scan.mockImplementation(async (id: string) => ({ ...supplier(id), scannedAt: "new-time" }));
    let state!: SupplierRefreshProgress;
    const unsubscribe = subscribeSupplierRefresh(value => { state = value; });
    await refreshAllSuppliers();
    mocks.scan.mockClear();
    const first = refreshSupplier("two");
    expect(refreshSupplier("two")).toBe(first);
    await first;
    expect(mocks.scan).toHaveBeenCalledTimes(1);
    expect(mocks.scan).toHaveBeenCalledWith("two", undefined, 2, { verifyCapabilities: false });
    expect(state.results.some(result => result.id === "one")).toBe(true);
    expect(state.completed).toBe(1);
    expect(state.runningIds).toEqual([]);
    unsubscribe();
  });
  it("does not duplicate a single refresh requested while the whole batch is loading", async () => {
    let resolve!: (value: unknown[]) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    mocks.fetch.mockResolvedValue([supplier("one")]);
    mocks.scan.mockImplementation(async (id: string) => ({ ...supplier(id), scannedAt: "new-time" }));
    const task = refreshAllSuppliers();
    const single = refreshSupplier("one");
    resolve([supplier("one")]);
    await Promise.all([task, single]);
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });
  it("queues a different supplier and never overlaps the preceding single refresh", async () => {
    mocks.fetch.mockResolvedValue([supplier("one"), supplier("two")]);
    let active = 0;
    let maximum = 0;
    mocks.scan.mockImplementation(async (id: string) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(done => setTimeout(done, 2));
      active--;
      return { ...supplier(id), scannedAt: "new-time" };
    });
    const one = refreshSupplier("one");
    const two = refreshSupplier("two");
    expect(refreshSupplier("two")).toBe(two);
    await Promise.all([one, two]);
    expect(maximum).toBe(1);
    expect(mocks.scan.mock.calls.map(call => call[0])).toEqual(["one", "two"]);
  });
  it("refreshes a newly added supplier that was absent from the batch's captured list", async () => {
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    mocks.fetch.mockResolvedValueOnce([supplier("one")]).mockResolvedValue([supplier("one"), supplier("new")]);
    mocks.scan.mockImplementation(async (id: string) => {
      if (id === "one") await gate;
      return { ...supplier(id), scannedAt: "new-time" };
    });
    const all = refreshAllSuppliers();
    await vi.waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(1));
    const added = refreshSupplier("new");
    release();
    await Promise.all([all, added]);
    expect(mocks.scan.mock.calls.map(call => call[0])).toEqual(["one", "new"]);
  });
  it("includes partial account reads in the supplier outcome and rejects a different billing source", async () => {
    const before = { ...supplier("one"), state: { revision: 2, sourceId: "source" }, siteLogin: { configured: true } };
    mocks.fetch.mockResolvedValue([before]);
    mocks.scan.mockResolvedValue({ ...before, scannedAt: "new-time" });
    mocks.billing.mockResolvedValueOnce({ sourceId: "source", status: "partial", balance: 0, unit: "CNY", checkedAt: "new-time", sourceUrl: "https://example.invalid" });
    let state!: SupplierRefreshProgress;
    const unsubscribe = subscribeSupplierRefresh(value => { state = value; });
    await refreshSupplier("one");
    expect(state.results.find(result => result.id === "one")!.billing?.balance).toBe(0);
    expect(state.results.find(result => result.id === "one")!.message).toContain("账务部分未读取");
    mocks.billing.mockResolvedValueOnce({ sourceId: "source", status: "live", todayStatus: "failed", unit: "CNY" });
    await refreshSupplier("one");
    expect(state.results.find(result => result.id === "one")!.status).toBe("partial");
    expect(state.results.find(result => result.id === "one")!.message).toContain("今日消耗读取失败");
    mocks.billing.mockResolvedValueOnce({ sourceId: "other", status: "live", balance: 123, unit: "USD" });
    await refreshSupplier("one");
    expect(state.results.find(result => result.id === "one")!.billing).toBeUndefined();
    expect(state.results.find(result => result.id === "one")!.message).toContain("账务来源已改变");
    unsubscribe();
  });
  it("seeds the account overview from a fresh list instead of overwriting concurrent edits with the initial list", async () => {
    const edited = { ...supplier("two"), state: { revision: 9, sourceId: "replacement-source" } };
    mocks.fetch.mockResolvedValueOnce([supplier("one"), supplier("two")]).mockResolvedValueOnce([supplier("one"), edited]);
    mocks.scan.mockRejectedValueOnce(new Error("request unavailable"));
    await refreshSupplier("one");
    expect(mocks.seed).toHaveBeenLastCalledWith([supplier("one"), edited]);
    expect(mocks.seed.mock.calls[0]![0][1].state.sourceId).toBe("replacement-source");
  });
});

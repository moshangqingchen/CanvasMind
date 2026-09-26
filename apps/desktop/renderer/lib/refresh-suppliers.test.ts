import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), connections: vi.fn(), scan: vi.fn(), invalidate: vi.fn() }));
vi.mock("./client-api", () => ({ fetchConnections: mocks.connections, invalidateModelCache: mocks.invalidate }));
vi.mock("./client-suppliers", () => ({ fetchSuppliers: mocks.fetch, scanSupplier: mocks.scan, supplierOwnsConnection: (s: { id: string }, c: { config: { supplierId: string } }) => s.id === c.config.supplierId }));
import { refreshAllSuppliers, subscribeSupplierRefresh, type SupplierRefreshProgress } from "./refresh-suppliers";
const supplier = (id: string) => ({ id, name: id, state: { revision: 2 }, catalog: { groups: [{ id: "old", label: "Old", source: "catalog" }] }, scanStatus: "live", scannedAt: "old-time" });
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
    expect(mocks.scan).toHaveBeenCalledWith("two", undefined, 2);
    expect(state.completed).toBe(2);
    expect(state.running).toBe(false);
    expect(state.results.map(r => r.status)).toEqual(["failed", "updated"]);
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
});

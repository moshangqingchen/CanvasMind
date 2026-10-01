import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./client-suppliers", () => ({ fetchSuppliers: vi.fn(async () => []) }));
vi.mock("react", () => ({ useEffect: vi.fn(), useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));
import { refreshSupplierAccount, refreshSupplierAccountAfterRun, loadSupplierBilling, seedSupplierBilling, useSupplierBillingOverview } from "./client-supplier-billing";
import { fetchSuppliers, type SupplierRecord } from "./client-suppliers";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  const fetcher = vi.fn(async () => Response.json({ sourceId: "source", status: "live", balance: 1, used: 2, unit: "credits" }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
describe("account refresh after a run", () => {
  it("deduplicates manual refresh requests", async () => {
    const fetcher = setup();
    const a = refreshSupplierAccount("manual-account"), b = refreshSupplierAccount("manual-account");
    expect(a).toBe(b); await a; expect(fetcher).toHaveBeenCalledOnce();
  });
  it("coalesces completions, remembers run IDs and rereads the final completion during throttle", async () => {
    const fetcher = setup();
    refreshSupplierAccountAfterRun("a", "run1"); refreshSupplierAccountAfterRun("a", "run1");
    refreshSupplierAccountAfterRun("a", "run2");
    await vi.advanceTimersByTimeAsync(999); expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledOnce();
    refreshSupplierAccountAfterRun("a", "run1");
    await vi.advanceTimersByTimeAsync(15000); expect(fetcher).toHaveBeenCalledOnce();
    refreshSupplierAccountAfterRun("a", "run3");
    await vi.advanceTimersByTimeAsync(1000); expect(fetcher).toHaveBeenCalledTimes(2);
    refreshSupplierAccountAfterRun("a", "run4");
    await vi.advanceTimersByTimeAsync(14999); expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every(call => String((call as unknown[])[0]) === "/api/suppliers/a/billing")).toBe(true);
  });
  it("keeps suppliers independent and never submits generation", async () => {
    const fetcher = setup();
    refreshSupplierAccountAfterRun("supplier-b", "shared-run"); refreshSupplierAccountAfterRun("supplier-c", "shared-run");
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher.mock.calls.map(call => (call as unknown[])[0]).sort()).toEqual(["/api/suppliers/supplier-b/billing", "/api/suppliers/supplier-c/billing"]);
  });
  it("does not replace a newer explicit supplier seed with an older list response", async () => {
    setup();
    const supplier = (balance: number, revision: number) => ({ id: "seed-account", name: "Account", supplierKey: "account", siteLogin: { configured: true },
      state: { sourceId: "seed-source", revision, visibility: "visible", billing: { sourceId: "seed-source", status: "live", balance, unit: "USD" } } }) as unknown as SupplierRecord;
    seedSupplierBilling([supplier(10, 1)]);
    await vi.advanceTimersByTimeAsync(60_000);
    let release!: (suppliers: SupplierRecord[]) => void;
    vi.mocked(fetchSuppliers).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const loading = loadSupplierBilling();
    seedSupplierBilling([supplier(20, 2)]);
    release([supplier(10, 1)]);
    await loading;
    expect(useSupplierBillingOverview()).toMatchObject([{ revision: 2, billing: { balance: 20 } }]);
  });
  it("keeps a completed account refresh when an older list request resolves afterwards", async () => {
    const fetcher = setup();
    const supplier = { id: "refresh-account", name: "Account", supplierKey: "account", siteLogin: { configured: true },
      state: { sourceId: "refresh-source", revision: 1, visibility: "visible", billing: { sourceId: "refresh-source", status: "live", balance: 10, unit: "USD" } } } as unknown as SupplierRecord;
    seedSupplierBilling([supplier]);
    await vi.advanceTimersByTimeAsync(60_000);
    let release!: (suppliers: SupplierRecord[]) => void;
    vi.mocked(fetchSuppliers).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const loading = loadSupplierBilling();
    fetcher.mockResolvedValueOnce(Response.json({ sourceId: "refresh-source", status: "live", balance: 30, unit: "USD" }));
    await refreshSupplierAccount(supplier.id);
    release([supplier]);
    await loading;
    expect(useSupplierBillingOverview()).toMatchObject([{ billing: { balance: 30 } }]);
  });
});

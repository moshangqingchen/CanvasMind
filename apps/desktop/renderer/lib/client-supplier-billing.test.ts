import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./client-suppliers", () => ({ fetchSuppliers: vi.fn(async () => []) }));
import { refreshSupplierAccount, refreshSupplierAccountAfterRun } from "./client-supplier-billing";

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
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierBillingSnapshot, SupplierRecord } from "@super-canvas/db";

const mocks = vi.hoisted(() => ({ supplier: vi.fn(), refresh: vi.fn() }));
vi.mock("../../../../../lib/server", () => ({ jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("../../../../../lib/supplier-service", () => ({ getSupplierRecord: mocks.supplier, SupplierServiceError: class extends Error {} }));
vi.mock("../../../../../lib/supplier-billing", () => ({ refreshSupplierBilling: mocks.refresh }));
import { GET, POST } from "./route";

const snapshot: SupplierBillingSnapshot = { sourceId: "source", status: "live", unit: "USD", balance: 5, used: 1, todayUsed: .1,
  checkedAt: "2026-10-06T00:00:00Z", sourceUrl: "https://tk1688.com/api/user/self" };
const supplier = { id: "tk", siteUrl: "https://tk1688.com", apiUrl: "https://api.tk1688.com/v1",
  state: { sourceId: "source", visibility: "visible", billing: snapshot } } as SupplierRecord;
const context = { params: Promise.resolve({ id: "tk" }) };
const request = new Request("http://localhost/api/suppliers/tk/billing");

beforeEach(() => { mocks.supplier.mockReset().mockResolvedValue(supplier); mocks.refresh.mockReset(); });
describe("billing currency presentation", () => {
  it("does not return old USD money from the separate GET path or rewrite its snapshot", async () => {
    const result = await (await GET(request, context)).json();
    expect(result).toMatchObject({ unit: "CNY", status: "partial" });
    expect(result).not.toHaveProperty("balance");
    expect(JSON.stringify(result)).not.toContain("USD");
    expect(snapshot).toMatchObject({ unit: "USD", balance: 5, used: 1 });
  });
  it("does not restore USD into the page when a refresh returns the previous failed snapshot", async () => {
    mocks.refresh.mockResolvedValue({ ...snapshot, status: "failed", error: "读取失败；上次成功数据已保留" });
    const result = await (await POST(request, context)).json();
    expect(result).toMatchObject({ unit: "CNY", status: "failed" });
    expect(result).not.toHaveProperty("balance");
    expect(result).not.toHaveProperty("todayUsed");
    expect(JSON.stringify(result)).not.toContain("USD");
  });
  it("keeps a freshly read CNY snapshot and another supplier's declared currency", async () => {
    mocks.refresh.mockResolvedValue({ ...snapshot, unit: "CNY", balance: 34.448 });
    expect(await (await POST(request, context)).json()).toMatchObject({ unit: "CNY", balance: 34.448 });
    mocks.supplier.mockResolvedValue({ ...supplier, siteUrl: "https://other.example", apiUrl: "https://other.example/v1" });
    expect(await (await GET(request, context)).json()).toMatchObject({ unit: "USD", balance: 5 });
  });
});

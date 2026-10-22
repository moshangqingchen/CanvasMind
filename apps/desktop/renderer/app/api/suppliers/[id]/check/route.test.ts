import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ check: vi.fn(), readers: vi.fn(), getSupplier: vi.fn(), repository: { listConnections: vi.fn() } }));
vi.mock("../../../../../lib/server", () => ({ repository: mocks.repository,
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("../../../../../lib/catalog-pipeline-readers", () => ({ catalogPipelineReaders: mocks.readers }));
vi.mock("../../../../../lib/supplier-service", () => ({ getSupplierRecord: mocks.getSupplier }));
vi.mock("../../../../../lib/supplier-readonly-check", async original => ({
  ...await original<typeof import("../../../../../lib/supplier-readonly-check")>(), checkSupplierReadOnly: mocks.check,
}));
import { POST } from "./route";
import { SupplierReadOnlyCheckError } from "../../../../../lib/supplier-readonly-check";
beforeEach(() => vi.clearAllMocks());

describe("supplier read-only check endpoint", () => {
  it("returns a noncached preview using only the read service", async () => {
    mocks.check.mockResolvedValue({ readOnly: true, supplierId: "account-a" });
    const response = await POST(new Request("http://localhost/api/suppliers/account-a/check", { method: "POST" }), { params: Promise.resolve({ id: "account-a" }) });
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ readOnly: true, supplierId: "account-a" });
    expect(mocks.check).toHaveBeenCalledWith("account-a", expect.objectContaining({ repository: {
      getSupplier: mocks.getSupplier, listConnections: expect.any(Function),
    }, signal: expect.any(AbortSignal) }));
    await mocks.check.mock.calls[0]![1].repository.listConnections();
    expect(mocks.repository.listConnections).toHaveBeenCalledOnce();
  });
  it("keeps source-change conflicts distinct and never echoes arbitrary upstream errors", async () => {
    const request = () => POST(new Request("http://localhost/api/suppliers/account-a/check", { method: "POST" }), { params: Promise.resolve({ id: "account-a" }) });
    mocks.check.mockRejectedValue(new SupplierReadOnlyCheckError("供应商、账号或连接资料已变化，请重新检测", 409));
    expect((await request()).status).toBe(409);
    mocks.check.mockRejectedValue(new Error("Bearer private-key"));
    const failed = await request(); expect(failed.status).toBe(500); expect(await failed.text()).not.toContain("private-key");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn(), get: vi.fn(), full: vi.fn(), status: vi.fn() }));
vi.mock("../../../../../lib/server", () => ({ repository: { getSupplier: mocks.get,
  getSupplierVerification: mocks.full, getSupplierVerificationStatus: mocks.status },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("../../../../../lib/supplier-verification", () => ({ getSupplierVerificationService: () => ({ runQueuedCase: mocks.run }) }));
vi.mock("../../../../../lib/supplier-verification-service", () => ({ publicVerification: (record: unknown) => record }));
import { GET, POST } from "./route";

beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue({ id: "supplier" }); mocks.full.mockResolvedValue(null); mocks.status.mockResolvedValue(null); });
const start = () => POST(new Request("http://localhost/api/suppliers/supplier/verification", {
  method: "POST", body: JSON.stringify({ action: "run-case", caseId: "selected-case" }),
  headers: { "content-type": "application/json" },
}), { params: Promise.resolve({ id: "supplier" }) });
const read = (summary = false) => GET(new Request(`http://localhost/api/suppliers/supplier/verification${summary ? "?summary=1" : ""}`),
  { params: Promise.resolve({ id: "supplier" }) });

describe("verification reads", () => {
  it("reads only the verified state projection for revision polling", async () => {
    mocks.status.mockResolvedValue({ id: "supplier", revision: 7, cases: [] });
    const response = await read(true);
    expect(await response.json()).toEqual({ revision: 7 });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.status).toHaveBeenCalledExactlyOnceWith("supplier");
    expect(mocks.full).not.toHaveBeenCalled();
  });
  it("keeps a missing ledger as revision zero", async () => {
    expect(await (await read(true)).json()).toEqual({ revision: 0 });
    expect(mocks.full).not.toHaveBeenCalled();
  });
  it("reads the complete verified record for the evidence panel", async () => {
    const record = { id: "supplier", revision: 7, cases: [{ task: { result: { raw: "完整原响应" } } }], evidence: [{ excerpt: "原扣费" }] };
    mocks.full.mockResolvedValue(record);
    expect(await (await read()).json()).toEqual(record);
    expect(mocks.full).toHaveBeenCalledExactlyOnceWith("supplier");
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it.each([true, false])("does not turn an unreadable %s projection/full record into missing evidence", async summary => {
    const failure = new Error("Verification evidence integrity mismatch");
    (summary ? mocks.status : mocks.full).mockRejectedValue(failure);
    await expect(read(summary)).rejects.toBe(failure);
  });
});

describe("selected supplier verification", () => {
  it("returns a durable accepted case without waiting for image generation", async () => {
    mocks.run.mockResolvedValue({ id: "supplier", cases: [{ id: "selected-case", status: "queued" }] });
    const response = await start();
    expect(response.status).toBe(202);
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith("supplier", "selected-case", false);
  });
  it("reports a blocked or already-submitted case instead of falsely accepting it", async () => {
    mocks.run.mockRejectedValue(new Error("仅可执行尚未提交的核验任务"));
    expect((await start()).status).toBe(409);
  });
});

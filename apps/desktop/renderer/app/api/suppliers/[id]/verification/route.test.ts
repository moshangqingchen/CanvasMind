import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn(), get: vi.fn() }));
vi.mock("../../../../../lib/server", () => ({ repository: { getSupplier: mocks.get },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("../../../../../lib/supplier-verification", () => ({ getSupplierVerificationService: () => ({ runQueuedCase: mocks.run }) }));
vi.mock("../../../../../lib/supplier-verification-service", () => ({ publicVerification: (record: unknown) => record }));
import { POST } from "./route";

beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue({ id: "supplier" }); });
const start = () => POST(new Request("http://localhost/api/suppliers/supplier/verification", {
  method: "POST", body: JSON.stringify({ action: "run-case", caseId: "selected-case" }),
  headers: { "content-type": "application/json" },
}), { params: Promise.resolve({ id: "supplier" }) });

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

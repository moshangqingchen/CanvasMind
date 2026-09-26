import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ inventory: vi.fn(), schedule: vi.fn() }));
vi.mock("../../../../../lib/provider-model-inventory", () => ({ readProviderModelInventory: mocks.inventory }));
vi.mock("../../../../../lib/supplier-verification", () => ({ scheduleSupplierVerification: mocks.schedule }));
vi.mock("../../../../../lib/server", () => ({
  repository: { getConnection: vi.fn(async () => null) },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
import { POST } from "./route";

beforeEach(() => vi.clearAllMocks());
const testConnection = () => POST(new Request("http://localhost/api/providers/group/test", { method: "POST" }),
  { params: Promise.resolve({ id: "group" }) });

describe("connection directory test", () => {
  it("returns the one scan and its freshness without scheduling paid verification", async () => {
    const models = [{ id: "image", name: "Image", operations: ["image.generate"] }];
    mocks.inventory.mockResolvedValue(Response.json(models, { headers: {
      "X-Model-Scan-Status": "live", "X-Model-Scan-Source": "live",
      "X-Model-Scan-Checked-At": "2026-09-22T00:00:00Z", "X-Model-Scan-Last-Success-At": "2026-09-22T00:00:00Z",
    } }));
    const response = await testConnection();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ models, modelCount: 1, status: "live", source: "live",
      checkedAt: "2026-09-22T00:00:00Z", lastSuccessAt: "2026-09-22T00:00:00Z" });
    expect(mocks.inventory).toHaveBeenCalledOnce();
    expect(new URL(mocks.inventory.mock.calls[0]![0].url).searchParams.get("refresh")).toBe("1");
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it.each(["stale", "failed", "unauthorized"])("does not call a %s inventory a successful test", async status => {
    mocks.inventory.mockResolvedValue(Response.json([{ id: "old" }], { headers: { "X-Model-Scan-Status": status } }));
    expect((await testConnection()).status).toBe(502);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("rejects malformed successful responses instead of displaying an undefined count", async () => {
    mocks.inventory.mockResolvedValue(Response.json({ data: [] }));
    expect((await testConnection()).status).toBe(502);
  });
});

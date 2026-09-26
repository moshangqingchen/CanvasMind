import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recover: vi.fn(), getRun: vi.fn(), retry: vi.fn(),
  publicSnapshot: vi.fn((value: unknown) => value),
}));
vi.mock("../../../../../lib/server", () => ({
  runService: { recoverRunOutputs: mocks.recover, getRun: mocks.getRun, retryRun: mocks.retry },
  publicRunSnapshot: mocks.publicSnapshot,
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));

import { POST } from "./route";

const request = () => new Request("http://localhost/api/runs/run-1/recover-outputs", { method: "POST" });
const context = (id = "run-1") => ({ params: Promise.resolve({ id }) });
beforeEach(() => { vi.clearAllMocks(); });

describe("archive-only run output recovery", () => {
  it("calls only archive recovery and returns the public snapshot with cancellation preserved", async () => {
    mocks.recover.mockResolvedValue({ id: "run-1", status: "cancelled" });
    mocks.getRun.mockResolvedValue({ run: { id: "run-1", status: "cancelled" }, nodes: [] });
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ run: { status: "cancelled" } });
    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith("run-1");
    expect(mocks.publicSnapshot).toHaveBeenCalledOnce();
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("rejects invalid identifiers before recovery", async () => {
    expect((await POST(request(), context(""))).status).toBe(400);
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("reports missing runs and unavailable saved results without resubmitting", async () => {
    mocks.recover.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("没有保存的成功结果"));
    expect((await POST(request(), context())).status).toBe(404);
    const response = await POST(request(), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "没有保存的成功结果" });
    expect(mocks.retry).not.toHaveBeenCalled();
  });
});

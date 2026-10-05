import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: { getRunByClientRequest: vi.fn(), getCanvas: vi.fn(), getConnection: vi.fn() },
  createRun: vi.fn(), getRun: vi.fn(),
}));
vi.mock("../../../lib/server", () => ({
  repository: mocks.repository,
  runService: { repository: mocks.repository, createRun: mocks.createRun, getRun: mocks.getRun },
  publicRunSnapshot: (value: unknown) => value,
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock("../../../lib/supplier-service", () => ({ assertCurrentSupplierConnection: vi.fn() }));
import { POST } from "./route";
import { createRun } from "../../../lib/client-api";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
  vi.stubEnv("SUPERCANVAS_DRAIN_FILE", "");
  mocks.repository.getRunByClientRequest.mockResolvedValue(null);
  mocks.repository.getCanvas.mockResolvedValue(null);
  mocks.createRun.mockRejectedValue(new Error("queue response lost"));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const input = { canvasId: "canvas", clientRequestId: "same-request", nodeId: "image", scope: "node" as const };
const request = () => new Request("http://localhost/api/runs", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify(input) });

describe("submission recovery preserves uncertain paid work", () => {
  it("keeps an unreadable persistence check uncertain instead of declaring validation failure", async () => {
    mocks.repository.getRunByClientRequest.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("repository unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(await response.clone().json()).toMatchObject({ error: expect.stringContaining("核对原任务") });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(createRun(input)).rejects.toBeInstanceOf(TypeError);
    expect(mocks.createRun).toHaveBeenCalledOnce();
  });

  it("does not declare a persisted run absent when its snapshot is temporarily unavailable", async () => {
    mocks.repository.getRunByClientRequest.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "persisted-run" });
    mocks.getRun.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(503);
    expect(mocks.createRun).toHaveBeenCalledOnce();
  });

  it("retains successful creation evidence even if later lookup returns no record", async () => {
    mocks.createRun.mockResolvedValue({ id: "accepted-run" });
    mocks.getRun.mockRejectedValue(new Error("read failed after creation"));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.createRun).toHaveBeenCalledOnce();
  });

  it("does not return a successful null snapshot after creating a task", async () => {
    mocks.createRun.mockResolvedValue({ id: "accepted-run" });
    mocks.getRun.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(503);
    expect(mocks.createRun).toHaveBeenCalledOnce();
  });

  it("still returns the original task without resubmitting when recovery can read it", async () => {
    const snapshot = { run: { id: "persisted-run", status: "queued" }, nodes: [] };
    mocks.repository.getRunByClientRequest.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "persisted-run" });
    mocks.getRun.mockResolvedValue(snapshot);
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(snapshot);
    expect(mocks.createRun).toHaveBeenCalledOnce();
  });

  it("preserves validation failures when the repository confirms no task was created", async () => {
    mocks.createRun.mockRejectedValue(new Error("invalid graph"));
    expect((await POST(request())).status).toBe(422);
  });
});

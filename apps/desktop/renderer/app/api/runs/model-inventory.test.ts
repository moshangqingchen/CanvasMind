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
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
  vi.stubEnv("SUPERCANVAS_DRAIN_FILE", "");
  mocks.repository.getRunByClientRequest.mockResolvedValue(null);
  mocks.repository.getCanvas.mockResolvedValue({ graph: { schemaVersion: 1, edges: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [
    { id: "image", type: "workflow", data: { nodeType: "image-generation", provider: "openai", connectionId: "genimage-gemini", model: "gpt-image-2.5-sunburst" } },
  ] } });
  mocks.repository.getConnection.mockResolvedValue({ id: "genimage-gemini", provider: "openai", config: {
    baseUrl: "https://genimage.pro/v1", customGroup: true, modelGroup: "geminiResponseUrl",
    modelScanStatus: "live", modelCatalogModels: [{ id: "gemini-image", name: "Gemini", operations: ["image.generate"] }],
  } });
  mocks.createRun.mockResolvedValue({ id: "run" });
  mocks.getRun.mockResolvedValue({ run: { id: "run", status: "queued" }, nodes: [] });
});
afterEach(() => vi.unstubAllEnvs());
const request = () => new Request("http://localhost/api/runs", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ canvasId: "canvas", clientRequestId: "request", nodeId: "image", scope: "node" }) });
describe("saved model inventory before paid canvas runs", () => {
  it("rejects a video model kept in a saved image node before any paid submission", async () => {
    mocks.repository.getConnection.mockResolvedValue({ id: "genimage-gemini", provider: "rest", config: {
      customGroup: true, modelScanStatus: "live", modelCatalogModels: [{ id: "gpt-image-2.5-sunburst", name: "Misleading ID", operations: ["video.image-to-video"], outputKinds: ["video"] }],
    } });
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("不支持图片输出") });
    expect(mocks.createRun).not.toHaveBeenCalled();
  });
  it("blocks an old canvas model removed from its exact group before creating a run", async () => {
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("已不在当前分组") });
    expect(mocks.createRun).not.toHaveBeenCalled();
  });
  it("preserves idempotent access to a run submitted before the inventory changed", async () => {
    mocks.repository.getRunByClientRequest.mockResolvedValue({ id: "existing" });
    expect((await POST(request())).status).toBe(201);
    expect(mocks.createRun).toHaveBeenCalledOnce();
    expect(mocks.repository.getConnection).not.toHaveBeenCalled();
  });
  it("does not impose a catalog requirement on a legacy connection without a saved scan", async () => {
    mocks.repository.getConnection.mockResolvedValue({ id: "genimage-gemini", provider: "openai", config: {
      baseUrl: "https://genimage.pro/v1", customGroup: true, modelGroup: "geminiResponseUrl",
    } });
    expect((await POST(request())).status).toBe(201);
    expect(mocks.createRun).toHaveBeenCalledOnce();
  });
});

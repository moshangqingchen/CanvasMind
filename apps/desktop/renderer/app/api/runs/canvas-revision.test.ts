import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import { FakeProviderAdapter } from "@super-canvas/providers";
import { RunService } from "@super-canvas/runtime";

const state = vi.hoisted(() => ({
  repository: undefined as unknown as MemoryRepository,
  service: undefined as unknown as RunService,
  preflight: vi.fn(),
}));
vi.mock("../../../lib/server", () => ({
  get repository() { return state.repository; },
  get runService() { return state.service; },
  publicRunSnapshot: (value: unknown) => value,
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock("../../../lib/supplier-service", () => ({ assertCurrentSupplierConnection: state.preflight }));
vi.mock("../../../lib/supplier-template-source", () => ({ matchesSupplierTemplate: () => false }));
import { POST } from "./route";

function graph(version: "P1" | "P2"): JsonObject {
  return { schemaVersion: 1, nodes: [{ id: "image", type: "workflow", data: {
    nodeType: "image-generation", provider: "fake", connectionId: "preflight-fixture", model: "fake-image",
    parts: [{ type: "text", text: version }], parameters: { size: version === "P1" ? "1024x1024" : "2048x2048" },
    outputs: [{ id: "images", kind: "image" }],
  } }], edges: [] };
}

beforeEach(async () => {
  vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
  vi.stubEnv("SUPERCANVAS_DRAIN_FILE", "");
  state.repository = new MemoryRepository();
  await state.repository.saveConnection({ id: "preflight-fixture", name: "Mock", provider: "fake", encryptedSecret: null, config: {} });
  state.service = new RunService({ repository: state.repository,
    storage: { put: async () => {}, get: async () => null }, pollIntervalMs: 0 });
  state.preflight.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const request = (revision: number, scope: "node" | "downstream" | "all") => new Request("http://localhost/api/runs", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ canvasId: "canvas", clientRequestId: "click", expectedRevision: revision, scope,
    ...(scope !== "all" ? { nodeId: "image" } : {}) }),
});

describe("canvas identity across asynchronous run preflight", () => {
  it.each(["node", "downstream", "all"] as const)("rejects P2 saved during %s preflight before any provider submission", async scope => {
    const p1 = await state.repository.saveCanvas({ id: "canvas", graph: graph("P1") });
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    state.preflight.mockImplementation(() => { entered(); return new Promise<void>(resolve => { release = resolve; }); });
    const submit = vi.spyOn(FakeProviderAdapter.prototype, "submit");
    const response = POST(request(p1.revision, scope));
    await started;
    const p2 = await state.repository.saveCanvas({ id: "canvas", graph: graph("P2"), expectedRevision: p1.revision });
    release();
    const rejected = await response;
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ submissionPhase: "not_started", code: "CANVAS_REVISION_CONFLICT",
      expectedRevision: p1.revision, currentRevision: p2.revision, error: expect.stringContaining("本次未提交、未产生费用") });
    expect(submit).not.toHaveBeenCalled();
    expect(await state.repository.listRuns("canvas")).toHaveLength(0);
  });

  it("submits P1 normally when its revision still matches, and replays the original identity after later edits", async () => {
    const p1 = await state.repository.saveCanvas({ id: "canvas", graph: graph("P1") });
    state.preflight.mockResolvedValue(undefined);
    const submit = vi.spyOn(FakeProviderAdapter.prototype, "submit");
    const response = await POST(request(p1.revision, "all"));
    expect(response.status).toBe(201);
    const snapshot = await response.json();
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]![0]).toMatchObject({ model: "fake-image", parameters: expect.objectContaining({ size: "1024x1024" }) });
    expect(JSON.stringify(snapshot.run.revisionGraph)).toContain("P1");
    expect(JSON.stringify(snapshot.run.revisionGraph)).not.toContain("P2");
    await state.repository.saveCanvas({ id: "canvas", graph: graph("P2"), expectedRevision: p1.revision });
    const replay = await POST(request(p1.revision, "all"));
    expect(replay.status).toBe(201);
    expect((await replay.json()).run.id).toBe(snapshot.run.id);
    expect(submit).toHaveBeenCalledOnce();
    await vi.waitFor(async () => expect((await state.service.getRun(snapshot.run.id))?.run.status).toBe("succeeded"));
  });
});

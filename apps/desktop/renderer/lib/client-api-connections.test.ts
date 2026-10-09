import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("connection reads and mutation invalidation", () => {
  it("invalidates a recent model cache when the same server scan gains complete provenance", async () => {
    let complete = false;
    const models = [{ id: "native-video", name: "Native", operations: ["video.generate"] }];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes("/models?")
      ? Response.json(models, { headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": String(complete) } })
      : Response.json([{ id: "scan-provenance", provider: "rest", apiKeySet: true,
        config: { modelScanRequestId: "synthetic-scan", modelScanCheckedAt: "2001-01-01T00:00:00Z", modelScanStatus: "live", modelScanComplete: complete } }]));
    vi.stubGlobal("fetch", fetcher);
    const { fetchConnections, fetchModels, getCachedModels, getCachedModelInventoryStatus } = await import("./client-api");
    await fetchConnections();
    await fetchModels("scan-provenance");
    expect(getCachedModelInventoryStatus("scan-provenance")).toMatchObject({ complete: false });
    complete = true;
    await fetchConnections();
    expect(getCachedModels("scan-provenance")).toBeUndefined();
    await fetchModels("scan-provenance");
    expect(getCachedModelInventoryStatus("scan-provenance")).toEqual({ scanStatus: "live", complete: true });
    await fetchConnections();
    await fetchModels("scan-provenance");
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes("/models?"))).toHaveLength(2);
  });

  it("rejects a late old model response after a newer server scan without clearing its pending request", async () => {
    let version = "old";
    let finishOld!: (response: Response) => void;
    let finishFresh!: (response: Response) => void;
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (!String(input).includes("/models?")) return Promise.resolve(Response.json([{ id: "server-scan-race", provider: "rest", config: { modelScanRequestId: version } }]));
      reads++;
      return new Promise<Response>(resolve => { if (reads === 1) finishOld = resolve; else finishFresh = resolve; });
    }));
    const { fetchConnections, fetchModels, getCachedModels, getCachedModelInventoryStatus } = await import("./client-api");
    await fetchConnections();
    const old = fetchModels("server-scan-race");
    const rejected = expect(old).rejects.toThrow("连接已改变");
    version = "fresh";
    await fetchConnections();
    const fresh = fetchModels("server-scan-race");
    finishOld(Response.json([{ id: "old-model", operations: [] }], { headers: { "X-Model-Scan-Status": "stale", "X-Model-Scan-Complete": "false" } }));
    await rejected;
    const shared = fetchModels("server-scan-race");
    finishFresh(Response.json([{ id: "new-model", operations: [] }], { headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
    expect(await Promise.all([fresh, shared])).toEqual([[{ id: "new-model", operations: [] }], [{ id: "new-model", operations: [] }]]);
    expect(reads).toBe(2);
    expect(getCachedModels("server-scan-race")?.[0]?.id).toBe("new-model");
    expect(getCachedModelInventoryStatus("server-scan-race")).toEqual({ scanStatus: "live", complete: true });
  });

  it.each([401, 403])("drops cached permissions after the server changes Key scope and returns HTTP %i", async status => {
    let group = "default";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/models?")
      ? group === "default" ? Response.json([{ id: "native-image", operations: [] }]) : Response.json({ error: "current Key rejected" }, { status })
      : Response.json([{ id: "scope-change", provider: "rest", config: { baseUrl: "https://api.miaowuai.store", accountKeyGroup: group } }])));
    const { fetchConnections, fetchModels, getCachedModels } = await import("./client-api");
    await fetchConnections();
    await fetchModels("scope-change");
    group = "vip";
    await fetchConnections();
    expect(getCachedModels("scope-change")).toBeUndefined();
    await expect(fetchModels("scope-change")).rejects.toThrow("current Key rejected");
    expect(getCachedModels("scope-change")).toBeUndefined();
  });

  it("shares simultaneous connection reads and refreshes on the next request", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json([{ id: "connection" }]));
    vi.stubGlobal("fetch", fetcher);
    const { fetchConnections } = await import("./client-api");
    await Promise.all([fetchConnections(), fetchConnections(), fetchConnections()]);
    expect(fetcher).toHaveBeenCalledOnce();
    await fetchConnections();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("prevents an older list from restoring a deleted connection and invalidates its models", async () => {
    let resolveOld!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json([{ id: "model", name: "Model", operations: [] }]))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal("fetch", fetcher);
    const { fetchModels, getCachedModels, fetchConnections, deleteConnection } = await import("./client-api");
    await fetchModels("deleted");
    const oldList = fetchConnections();
    await deleteConnection("deleted");
    expect(getCachedModels("deleted")).toBeUndefined();
    resolveOld(Response.json([{ id: "deleted" }]));
    await expect(oldList).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("retains the model snapshot when deleting a connection fails", async () => {
    const models = [{ id: "model", name: "Model", operations: [] }];
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(models))
      .mockResolvedValueOnce(Response.json({ error: "busy" }, { status: 409 })));
    const { fetchModels, getCachedModels, deleteConnection } = await import("./client-api");
    await fetchModels("existing");
    await expect(deleteConnection("existing")).rejects.toThrow("删除供应商连接失败");
    expect(getCachedModels("existing")).toEqual(models);
  });

  it("does not mistake malformed connection responses for a valid list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ connections: [] })));
    const { fetchConnections } = await import("./client-api");
    await expect(fetchConnections()).rejects.toThrow("连接返回格式无效");
  });
});

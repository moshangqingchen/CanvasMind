import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("connection reads and mutation invalidation", () => {
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModels, invalidateModelCache, getCachedModels, getCachedModelInventoryStatus, refreshModels } from "./client-api";

describe("fetchModels cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reuses a recent authoritative model scan", async () => {
    const models = [{ id: "gpt-image-2", name: "GPT Image 2", operations: [] }];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return Response.json(models);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchModels("cached-connection")).resolves.toEqual(models);
    await expect(fetchModels("cached-connection")).resolves.toEqual(models);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getCachedModels("cached-connection")).toEqual(models);
  });

  it("deduplicates simultaneous scans and refreshes after cache expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T00:00:00.000Z"));
    const models = [{ id: "gpt-image-2-high", name: "HIGH", operations: [] }];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return Response.json(models);
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      fetchModels("refreshing-connection"),
      fetchModels("refreshing-connection"),
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.setSystemTime(new Date("2026-08-03T00:01:01.000Z"));
    await fetchModels("refreshing-connection");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("only asks the server for a live refresh after an explicit rescan", async () => {
    const models = [{ id: "gpt-image-2", name: "GPT Image 2", operations: [] }];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return Response.json(models);
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchModels("manual-refresh-connection");
    await refreshModels("manual-refresh-connection", {
      clearUnavailable: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("refresh=1");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("refresh=1");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "clearUnavailable=1",
    );
  });

  it("keeps the last successful list when a refresh hits a transient failure", async () => {
    const models = [{ id: "gpt-image-2", name: "GPT Image 2", operations: [] }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(models))
      .mockResolvedValueOnce(
        Response.json(
          { error: "供应商暂时不可达" },
          {
            status: 502,
            headers: { "X-Model-Scan-Status": "failed" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchModels("stale-refresh-connection")).resolves.toEqual(
      models,
    );
    await expect(
      refreshModels("stale-refresh-connection"),
    ).resolves.toEqual(models);
    expect(getCachedModels("stale-refresh-connection")).toEqual(models);
    expect(getCachedModelInventoryStatus("stale-refresh-connection")).toEqual({ scanStatus: "stale", complete: false });
  });

  it("keeps successful HTTP response provenance separate from the returned model array", async () => {
    const models = [{ id: "pending-video", name: "Pending", operations: [] }];
    for (const [status, complete] of [["live", "true"], ["empty", "true"], ["stale", "false"], ["failed", "false"], ["live", "false"]]) {
      const id = `provenance-${status}-${complete}`;
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(models, { headers: { "X-Model-Scan-Status": status!, "X-Model-Scan-Complete": complete! } })));
      expect(await fetchModels(id)).toEqual(models);
      expect(getCachedModelInventoryStatus(id)).toEqual({ scanStatus: status, complete: complete === "true" });
    }
  });

  it("never lets an old response or its finally replace a new scan's provenance or pending request", async () => {
    const id = "provenance-race";
    let finishOld!: (response: Response) => void;
    let finishFresh!: (response: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finishFresh = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const old = fetchModels(id);
    const rejected = expect(old).rejects.toThrow("连接已改变");
    const fresh = refreshModels(id);
    finishOld(Response.json([{ id: "old", operations: [] }], { headers: { "X-Model-Scan-Status": "stale" } }));
    await rejected;
    const shared = fetchModels(id);
    finishFresh(Response.json([{ id: "fresh", operations: [] }], { headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
    expect(await Promise.all([fresh, shared])).toEqual([[{ id: "fresh", operations: [] }], [{ id: "fresh", operations: [] }]]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getCachedModelInventoryStatus(id)).toEqual({ scanStatus: "live", complete: true });
    expect(getCachedModels(id)?.[0]?.id).toBe("fresh");
  });

  it.each([401, 403])("does not hide an authentication failure (%i) behind a stale model snapshot", async (status) => {
    const id = `revoked-connection-${status}`;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json([{ id: "old-model", name: "Old", operations: [] }]))
      .mockResolvedValueOnce(Response.json({ error: "凭证不可用" }, {
        status, headers: { "X-Model-Scan-Status": "failed" },
      })));
    await fetchModels(id);
    await expect(refreshModels(id)).rejects.toThrow("凭证不可用");
    expect(getCachedModels(id)).toBeUndefined();
  });
});

it("never repopulates the cache with a request invalidated by a connection change", async () => {
  let finish!: (r: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = fetchModels("late-connection");
  const rejected = expect(pending).rejects.toThrow("连接已改变");
  invalidateModelCache("late-connection");
  finish(Response.json([{ id: "old-model", name: "Old", operations: [] }]));
  await rejected;
  expect(getCachedModels("late-connection")).toBeUndefined();
  expect(getCachedModelInventoryStatus("late-connection")).toBeUndefined();
  vi.unstubAllGlobals();
});

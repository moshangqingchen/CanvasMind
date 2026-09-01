import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModels, getCachedModels, refreshModels } from "./client-api";

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
  });
});

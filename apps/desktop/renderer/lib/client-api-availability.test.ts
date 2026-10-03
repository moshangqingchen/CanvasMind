import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = () => ({
  checkedAt: "2026-10-03T08:10:00Z",
  enabled: true,
  ready: true,
  source: "live",
  items: [],
});
beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("shared node availability requests", () => {
  it("coalesces parallel requests, caches for 30 seconds and sends no window_days", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetcher = vi.fn().mockResolvedValue(Response.json(fixture()));
    vi.stubGlobal("fetch", fetcher);
    const { fetchCangyuanAvailability } = await import("./client-api");
    await Promise.all([
      fetchCangyuanAvailability("cangyuan-a"),
      fetchCangyuanAvailability("cangyuan-a"),
    ]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/providers/cangyuan-a/availability",
      { cache: "no-store" },
    );
    expect(await fetchCangyuanAvailability("cangyuan-a")).toMatchObject({
      source: "cache",
    });
    now += 30_001;
    fetcher.mockResolvedValueOnce(Response.json(fixture()));
    await fetchCangyuanAvailability("cangyuan-a");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("invalidates snapshots when connection credentials change and isolates connection IDs", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json(fixture())));
    vi.stubGlobal("fetch", fetcher);
    const { fetchCangyuanAvailability, invalidateModelCache } =
      await import("./client-api");
    await fetchCangyuanAvailability("first");
    await fetchCangyuanAvailability("second");
    invalidateModelCache("first");
    await fetchCangyuanAvailability("first");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("preserves stale readiness and rejects malformed success responses", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...fixture(), ready: false, source: "stale" }),
      )
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetcher);
    const { fetchCangyuanAvailability } = await import("./client-api");
    await fetchCangyuanAvailability("pending");
    expect(await fetchCangyuanAvailability("pending")).toMatchObject({
      ready: false,
      source: "stale",
    });
    await expect(fetchCangyuanAvailability("malformed")).rejects.toThrow(
      "返回格式不完整",
    );
  });
});

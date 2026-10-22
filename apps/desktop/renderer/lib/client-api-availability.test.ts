import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionView } from "./client-api";

const fixture = () => ({
  checkedAt: "2026-10-03T08:10:00Z",
  enabled: true,
  ready: true,
  source: "live",
  items: [],
});
const connection = (): ProviderConnectionView => ({ id: "channel", name: "Channel", provider: "rest", apiKey: "",
  apiKeySet: true, apiKeyUsable: true, credentialEpoch: "key-a", config: { supplierKey: "cangyuan", supplierId: "account-a",
    supplierSourceId: "source-a", baseUrl: "https://channel.invalid/v1", modelGroup: "IMAGE", protocol: "images" } });
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
  it("retains pending and cached availability through ordinary model invalidation and refresh", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn((input: RequestInfo | URL) => String(input).includes("/availability")
      ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(Response.json([])));
    vi.stubGlobal("fetch", fetcher);
    const { fetchCangyuanAvailability, invalidateModelCache, refreshModels } =
      await import("./client-api");
    const pending = fetchCangyuanAvailability("first");
    invalidateModelCache("first");
    await refreshModels("first");
    const shared = fetchCangyuanAvailability("first");
    finish(Response.json(fixture()));
    await expect(Promise.all([pending, shared])).resolves.toEqual([fixture(), fixture()]);
    invalidateModelCache("first");
    expect(await fetchCangyuanAvailability("first")).toMatchObject({ source: "cache" });
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes("/availability"))).toHaveLength(1);
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

  it("keeps availability when only the name or saved model scan provenance changes", async () => {
    const row = connection();
    let finish!: (response: Response) => void;
    const fetcher = vi.fn((input: RequestInfo | URL) => String(input).includes("/availability")
      ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(Response.json([row])));
    vi.stubGlobal("fetch", fetcher);
    const { fetchConnections, fetchCangyuanAvailability } = await import("./client-api");
    await fetchConnections();
    const pending = fetchCangyuanAvailability(row.id);
    row.name = "Renamed";
    Object.assign(row.config, { modelScanRequestId: "new-scan", modelScanCheckedAt: "2026-10-22T00:00:00Z",
      modelScanComplete: true, modelCatalogModels: [{ id: "new-model" }] });
    await fetchConnections();
    finish(Response.json(fixture()));
    await expect(pending).resolves.toEqual(fixture());
    await fetchCangyuanAvailability(row.id);
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes("/availability"))).toHaveLength(1);
  });

  const scopeChanges: [string, (row: ProviderConnectionView) => void][] = [
    ["credential", row => { row.credentialEpoch = "key-b"; }],
    ["provider", row => { row.provider = "openai"; }],
    ["removed Key", row => { row.apiKeySet = false; }],
    ["unusable Key", row => { row.apiKeyUsable = false; }],
    ...["baseUrl", "protocol", "directorProtocol", "preset", "supplierKey", "supplierId", "supplierSourceId",
      "supplierArchived", "accountKeyId", "accountKeyGroupId", "accountKeyGroup", "modelGroup", "usage"]
      .map(field => [field, (row: ProviderConnectionView) => { row.config[field] = "changed"; }] as [string, (row: ProviderConnectionView) => void]),
  ];
  it.each(scopeChanges)("rejects old availability after %s changes without disturbing the new pending read", async (_name, change) => {
    const row = connection();
    const finishes: ((response: Response) => void)[] = [];
    const fetcher = vi.fn((input: RequestInfo | URL) => String(input).includes("/availability")
      ? new Promise<Response>(resolve => { finishes.push(resolve); }) : Promise.resolve(Response.json([row])));
    vi.stubGlobal("fetch", fetcher);
    const { fetchConnections, fetchCangyuanAvailability } = await import("./client-api");
    await fetchConnections();
    const old = fetchCangyuanAvailability(row.id);
    const rejected = expect(old).rejects.toThrow("连接已改变");
    change(row);
    await fetchConnections();
    const fresh = fetchCangyuanAvailability(row.id);
    finishes[0](Response.json(fixture()));
    await rejected;
    const shared = fetchCangyuanAvailability(row.id);
    expect(finishes).toHaveLength(2);
    const current = { ...fixture(), ready: false };
    finishes[1](Response.json(current));
    await expect(Promise.all([fresh, shared])).resolves.toEqual([current, current]);
    expect(await fetchCangyuanAvailability(row.id)).toEqual(current);
    expect(finishes).toHaveLength(2);
  });

  it.each(["save", "delete", "removed-from-list"] as const)("invalidates an in-flight response immediately after %s", async action => {
    const row = connection();
    let present = true;
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/availability")) return new Promise<Response>(resolve => { finish = resolve; });
      if (init?.method === "POST") return Promise.resolve(Response.json({ ...row, credentialEpoch: "key-b" }));
      if (init?.method === "DELETE") return Promise.resolve(Response.json({ ok: true }));
      return Promise.resolve(Response.json(present ? [row] : []));
    }));
    const { fetchConnections, fetchCangyuanAvailability, saveConnection, deleteConnection } = await import("./client-api");
    await fetchConnections();
    const pending = fetchCangyuanAvailability(row.id);
    const rejected = expect(pending).rejects.toThrow("连接已改变");
    if (action === "save") await saveConnection({ ...row, apiKey: "replacement-synthetic-key" });
    else if (action === "delete") await deleteConnection(row.id);
    else { present = false; await fetchConnections(); }
    finish(Response.json(fixture()));
    await rejected;
  });

  it("retains cached availability on a name-only save and isolates another connection", async () => {
    const row = connection();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).includes("/availability")
      ? Response.json(fixture()) : init?.method === "POST" ? Response.json({ ...row, name: "Renamed" }) : Response.json([row]));
    vi.stubGlobal("fetch", fetcher);
    const { fetchConnections, fetchCangyuanAvailability, saveConnection } = await import("./client-api");
    await fetchConnections();
    await fetchCangyuanAvailability(row.id);
    await fetchCangyuanAvailability("other");
    await saveConnection({ ...row, name: "Renamed", apiKey: undefined });
    expect(await fetchCangyuanAvailability(row.id)).toMatchObject({ source: "cache" });
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes("/availability"))).toHaveLength(2);
  });
});

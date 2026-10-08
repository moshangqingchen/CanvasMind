import { describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { SupplierCatalogUpgrade, SUPPLIER_CATALOG_REVISION } from "./supplier-catalog-upgrade";

async function fixture() {
  const repository = new MemoryRepository();
  const save = (id: string, config: Record<string, unknown> = {}, provider = "openai") => repository.saveConnection({
    id, name: id, provider, encryptedSecret: "opaque-test-key", config: {
      baseUrl: "https://api.tk1688.com/v1", usage: "agent", modelGroup: "default",
      defaultModel: "gpt-5.5", modelCatalogModels: [{ id: "gpt-5.5", operations: [] }], ...config,
    },
  });
  const readModels = vi.fn(async (request: Request, context: { params: Promise<{ id: string }> }) => {
    expect(new URL(request.url).searchParams.get("refresh")).toBe("1");
    const { id } = await context.params;
    const connection = (await repository.getConnection(id))!;
    await repository.saveConnection({ ...connection, config: { ...connection.config,
      modelCatalogModels: [{ id: "gpt-5.5", operations: [] }, { id: "gpt-5.4", operations: [] }],
      modelScanStatus: "live", modelScanComplete: true,
    } }, { expected: connection });
    return Response.json([], { headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
  });
  let now = Date.parse("2026-10-07T04:00:00Z");
  const service = new SupplierCatalogUpgrade({ repository, readModels, now: () => now });
  return { repository, save, readModels, service, advance: (milliseconds: number) => { now += milliseconds; } };
}

describe("supplier catalog upgrade", () => {
  it("refreshes each supplier directory once before its connection models and includes both stages in completion", async () => {
    const f = await fixture();
    const supplier = await f.repository.saveSupplier({ id: "supplier", name: "test", supplierKey: "tk1688", siteUrl: "https://tk1688.com", apiUrl: "https://api.tk1688.com/v1", kind: "newapi", catalog: { groups: [] }, scanStatus: "unscanned",
      state: { version: 1, revision: 1, visibility: "visible", sourceId: "source", fingerprint: "fp", history: [] } });
    await f.save("one", { supplierId: supplier.id, supplierSourceId: "source" });
    await f.save("two", { supplierId: supplier.id, supplierSourceId: "source", modelGroup: "second" });
    const order: string[] = [];
    const refreshSupplierCatalog = vi.fn(async () => { order.push("catalog"); return true; });
    const service = new SupplierCatalogUpgrade({ repository: f.repository, refreshSupplierCatalog,
      readModels: async (...args) => { order.push("models"); return f.readModels(...args); } });
    service.start(); await service.settle();
    expect(refreshSupplierCatalog).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["catalog", "models", "models"]);
    expect(service.status()).toMatchObject({ refreshed: 2, failed: 0 });
    service.start(); await service.settle();
    expect(refreshSupplierCatalog).toHaveBeenCalledTimes(1);
  });
  it("does not mark a model-only success complete when the supplier price directory failed", async () => {
    const f = await fixture();
    const supplier = await f.repository.saveSupplier({ id: "supplier", name: "test", supplierKey: "tk1688", siteUrl: "https://tk1688.com", apiUrl: "https://api.tk1688.com/v1", kind: "newapi", catalog: { groups: [] }, scanStatus: "unscanned",
      state: { version: 1, revision: 1, visibility: "visible", sourceId: "source", fingerprint: "fp", history: [] } });
    await f.save("one", { supplierId: supplier.id, supplierSourceId: "source" });
    const service = new SupplierCatalogUpgrade({ repository: f.repository, readModels: f.readModels, refreshSupplierCatalog: async () => false });
    service.start(); await service.settle();
    expect(f.readModels).toHaveBeenCalledTimes(1);
    expect(service.status()).toMatchObject({ refreshed: 0, failed: 1 });
    expect((await f.repository.getConnection("one"))!.config.catalogUpgradeRevision).toBeUndefined();
  });
  it("rechecks ownership after an in-flight supplier directory refresh before reading a replacement connection", async () => {
    const f = await fixture();
    const supplier = await f.repository.saveSupplier({ id: "supplier", name: "test", supplierKey: "tk1688", siteUrl: "https://tk1688.com", apiUrl: "https://api.tk1688.com/v1", kind: "newapi", catalog: { groups: [] }, scanStatus: "unscanned",
      state: { version: 1, revision: 1, visibility: "visible", sourceId: "source", fingerprint: "fp", history: [] } });
    await f.save("one", { supplierId: supplier.id, supplierSourceId: "source" });
    const service = new SupplierCatalogUpgrade({ repository: f.repository, readModels: f.readModels, refreshSupplierCatalog: async () => {
      const existing = (await f.repository.getConnection("one"))!;
      await f.repository.saveConnection({ ...existing, encryptedSecret: "replacement-opaque-key" });
      return true;
    } });
    service.start(); await service.settle();
    expect(f.readModels).not.toHaveBeenCalled();
    expect((await f.repository.getConnection("one"))!.config.catalogUpgradeIdentity).toBeUndefined();
  });
  it("refreshes only documented active API connections and never probes CLI or arbitrary endpoints", async () => {
    const f = await fixture();
    await f.save("active");
    await f.save("disabled", { usage: "disabled" });
    await f.save("cli", {}, "cli");
    await f.save("fake", {}, "fake");
    await f.save("custom", { baseUrl: "https://custom.example/v1" });
    await f.save("spoofed", { baseUrl: "https://api.tk1688.com.evil.example/v1" });
    const stored = await f.repository.listConnections();
    vi.spyOn(f.repository, "listConnections").mockResolvedValue([...stored, {
      ...stored[0]!, id: "archived", config: { ...stored[0]!.config, supplierArchived: true },
    }]);
    f.service.start();
    await f.service.settle();
    expect(f.readModels).toHaveBeenCalledTimes(1);
    expect(f.service.status()).toMatchObject({ phase: "complete", total: 1, refreshed: 1, updatedConnectionIds: ["active"] });
    const current = (await f.repository.getConnection("active"))!;
    expect(current.encryptedSecret).toBe("opaque-test-key");
    expect(current.config.defaultModel).toBe("gpt-5.5");
    expect(current.config.modelCatalogModels).toEqual([{ id: "gpt-5.5", operations: [] }, { id: "gpt-5.4", operations: [] }]);
    expect(current.config.catalogUpgradeRevision).toBe(SUPPLIER_CATALOG_REVISION);
  });
  it.each(["2026-10-07-media", "2026-10-08-complete-catalog-pricing-v2"])("refreshes a recently completed %s catalog once for the current revision", async previousRevision => {
    const f = await fixture();
    await f.save("active");
    f.service.start(); await f.service.settle();
    const saved = (await f.repository.getConnection("active"))!;
    await f.repository.saveConnection({ ...saved, config: { ...saved.config,
      catalogUpgradeRevision: previousRevision, catalogUpgradeAttemptRevision: previousRevision,
    } });
    const upgraded = new SupplierCatalogUpgrade({ repository: f.repository, readModels: f.readModels,
      now: () => Date.parse("2026-10-07T04:00:00Z") });
    upgraded.start(); await upgraded.settle();
    expect(f.readModels).toHaveBeenCalledTimes(2);
    expect((await f.repository.getConnection("active"))!.config.catalogUpgradeRevision).toBe(SUPPLIER_CATALOG_REVISION);
    upgraded.start(); await upgraded.settle();
    expect(f.readModels).toHaveBeenCalledTimes(2);
  });
  it("persists completion across launches and scans again after a Key identity change", async () => {
    const f = await fixture();
    await f.save("active");
    f.service.start(); await f.service.settle();
    const next = new SupplierCatalogUpgrade({ repository: f.repository, readModels: f.readModels });
    next.start(); await next.settle();
    expect(f.readModels).toHaveBeenCalledTimes(1);
    const original = (await f.repository.getConnection("active"))!;
    await f.repository.saveConnection({ ...original, encryptedSecret: "replacement-opaque-key" });
    next.start(); await next.settle();
    expect(f.readModels).toHaveBeenCalledTimes(2);
  });
  it("records authentication failure without claiming completion or erasing the saved models", async () => {
    const f = await fixture();
    await f.save("active");
    f.readModels.mockImplementation(async () => Response.json({ error: "denied" }, { status: 401,
      headers: { "X-Model-Scan-Status": "unauthorized", "X-Model-Scan-Complete": "false" } }));
    f.service.start(); await f.service.settle();
    expect(f.service.status()).toMatchObject({ refreshed: 0, unavailable: 1 });
    const current = (await f.repository.getConnection("active"))!;
    expect(current.config.catalogUpgradeRevision).toBeUndefined();
    expect(current.config.modelCatalogModels).toEqual([{ id: "gpt-5.5", operations: [] }]);
    f.service.start(); await f.service.settle();
    expect(f.readModels).toHaveBeenCalledTimes(1);
    f.advance(24 * 60 * 60 * 1000);
    f.service.start(); await f.service.settle();
    expect(f.readModels).toHaveBeenCalledTimes(2);
  });
  it("does not trust a successful HTTP response containing a stale inventory", async () => {
    const f = await fixture();
    await f.save("active");
    f.readModels.mockImplementation(async () => Response.json([], { headers: {
      "X-Model-Scan-Status": "stale", "X-Model-Scan-Complete": "false",
    } }));
    f.service.start(); await f.service.settle();
    expect(f.service.status()).toMatchObject({ refreshed: 0, failed: 1 });
    expect((await f.repository.getConnection("active"))!.config.catalogUpgradeRevision).toBeUndefined();
  });
  it("leaves a concurrently replaced Key untouched and retries its new identity", async () => {
    const f = await fixture();
    await f.save("active");
    f.readModels.mockImplementationOnce(async () => {
      const current = (await f.repository.getConnection("active"))!;
      await f.repository.saveConnection({ ...current, encryptedSecret: "changed-in-flight" });
      return Response.json([], { headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
    });
    f.service.start(); await f.service.settle();
    expect((await f.repository.getConnection("active"))!.config.catalogUpgradeIdentity).toBeUndefined();
    expect(f.service.status().updatedConnectionIds).toEqual([]);
    f.service.start(); await f.service.settle();
    expect(f.readModels).toHaveBeenCalledTimes(2);
  });
  it("shares concurrent startup requests and protects the full background write lifetime", async () => {
    const f = await fixture();
    await f.save("active");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let leases = 0;
    const service = new SupplierCatalogUpgrade({ repository: f.repository, readModels: f.readModels,
      trackWrite: async work => { leases++; await gate; try { await work(); } finally { leases--; } } });
    service.start(); service.start();
    expect(leases).toBe(1);
    expect(service.status().phase).toBe("running");
    release(); await service.settle();
    expect(leases).toBe(0);
    expect(f.readModels).toHaveBeenCalledTimes(1);
  });
  it("stops launching new catalog requests while the desktop is draining", async () => {
    const f = await fixture();
    await f.save("active");
    const service = new SupplierCatalogUpgrade({ repository: f.repository, readModels: f.readModels, canContinue: () => false });
    service.start(); await service.settle();
    expect(f.readModels).not.toHaveBeenCalled();
    expect((await f.repository.getConnection("active"))!.config.catalogUpgradeRevision).toBeUndefined();
  });
  it("retries a failed replacement Key rather than inheriting the previous identity's completed revision", async () => {
    const f = await fixture();
    await f.save("active");
    f.service.start(); await f.service.settle();
    const completed = (await f.repository.getConnection("active"))!;
    await f.repository.saveConnection({ ...completed, encryptedSecret: "new-key-that-fails" });
    f.readModels.mockImplementationOnce(async () => new Response(null, { status: 502 }));
    f.service.start(); await f.service.settle();
    expect((await f.repository.getConnection("active"))!.config.catalogUpgradeRevision).toBeUndefined();
    f.service.start(); await f.service.settle();
    expect(f.readModels).toHaveBeenCalledTimes(2);
    f.advance(24 * 60 * 60 * 1000);
    f.service.start(); await f.service.settle();
    expect(f.readModels).toHaveBeenCalledTimes(3);
    expect((await f.repository.getConnection("active"))!.config.catalogUpgradeRevision).toBe(SUPPLIER_CATALOG_REVISION);
  });
  it("includes canonical account group and usage in the upgraded permission identity", async () => {
    const f = await fixture();
    await f.save("active");
    f.service.start(); await f.service.settle();
    const original = (await f.repository.getConnection("active"))!;
    await f.repository.saveConnection({ ...original, config: { ...original.config, accountKeyGroup: "replacement-group" } });
    f.service.start(); await f.service.settle();
    expect(f.readModels).toHaveBeenCalledTimes(2);
    const changed = (await f.repository.getConnection("active"))!;
    await f.repository.saveConnection({ ...changed, config: { ...changed.config, usage: "canvas" } });
    f.service.start(); await f.service.settle();
    expect(f.readModels).toHaveBeenCalledTimes(3);
  });
  it("does not mark an old supplier source as upgraded after the owner changes during its read", async () => {
    const f = await fixture();
    const supplier = await f.repository.saveSupplier({ id: "supplier", name: "test", supplierKey: "tk1688", siteUrl: "https://tk1688.com", apiUrl: "https://api.tk1688.com/v1", kind: "newapi", catalog: { groups: [] }, scanStatus: "unscanned",
      state: { version: 1, revision: 1, visibility: "visible", sourceId: "old-source", fingerprint: "old", history: [] } });
    await f.save("active", { supplierId: supplier.id, supplierSourceId: "old-source" });
    f.readModels.mockImplementationOnce(async () => {
      await f.repository.saveSupplier({ ...supplier, state: { ...supplier.state!, revision: 2, sourceId: "replacement-source" } });
      return Response.json([], { headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
    });
    f.service.start(); await f.service.settle();
    expect((await f.repository.getConnection("active"))!.config.catalogUpgradeIdentity).toBeUndefined();
    expect(f.service.status().updatedConnectionIds).toEqual([]);
    f.service.start(); await f.service.settle();
    expect(f.readModels).toHaveBeenCalledTimes(1);
  });
  it("rechecks draining after asynchronous connection reads before launching any new GET", async () => {
    const f = await fixture();
    await f.save("active");
    let draining = false;
    const originalGet = f.repository.getConnection.bind(f.repository);
    vi.spyOn(f.repository, "getConnection").mockImplementation(async id => { const value = await originalGet(id); draining = true; return value; });
    const service = new SupplierCatalogUpgrade({ repository: f.repository, readModels: f.readModels, canContinue: () => !draining });
    service.start(); await service.settle();
    expect(f.readModels).not.toHaveBeenCalled();
  });
});

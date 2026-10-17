import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type Repository } from "@super-canvas/db";
import { scopedCatalogRepository } from "../../../../lib/catalog-repository-scope";
import { catalogScopedMap } from "../../../../lib/catalog-scope-cache";
import type { SupplierCatalogUpgrade } from "../../../../lib/supplier-catalog-upgrade";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as Repository, scan: vi.fn(), models: vi.fn() }));
vi.mock("../../../../lib/server", () => ({ get repository() { return mocks.repository; } }));
vi.mock("../../../../lib/desktop-server", () => ({ trackDesktopBackgroundWrite: (work: () => Promise<void>) => work() }));
vi.mock("../../../../lib/supplier-service", () => ({ scanSupplierRecord: mocks.scan }));
vi.mock("../../../../lib/provider-model-inventory", () => ({ readProviderModelInventory: mocks.models }));
import { GET, PATCH, POST } from "./route";

const runtime = globalThis as typeof globalThis & { __supplierCatalogUpgrade?: SupplierCatalogUpgrade };
let live: MemoryRepository;
beforeEach(() => {
  live = new MemoryRepository(); mocks.repository = scopedCatalogRepository(live);
  mocks.scan.mockReset(); mocks.models.mockReset(); delete runtime.__supplierCatalogUpgrade;
  vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No upstream transport allowed in catalog route unit"); }));
});
afterEach(() => { delete runtime.__supplierCatalogUpgrade; vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = (method = "GET", body?: unknown) => new Request("http://localhost/api/suppliers/catalog-upgrade", {
  method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
async function fixture() {
  const supplier = await live.saveSupplier({ id: "supplier", name: "Fixture", supplierKey: "tk1688", siteUrl: "https://tk1688.com",
    apiUrl: "https://api.tk1688.com/v1", kind: "newapi", scanStatus: "live", scanComplete: true,
    scannedAt: "2026-10-15T00:00:00.000Z",
    catalog: { groups: [{ id: "default", label: "Default", models: [{ id: "full/image-id", capability: "image", priceLabel: "¥0.10/张 · 4K" }] }] } });
  const connection = await live.saveConnection({ id: "connection", name: "Fixture connection", provider: "openai", encryptedSecret: "opaque-fixture-key",
    config: { supplierId: supplier.id, baseUrl: supplier.apiUrl, modelGroup: "default", modelCatalogModels: [{ id: "full/image-id", operations: ["image.generate"], metadata: { priceLabel: "¥0.10/张 · 4K", priceCheckedAt: "2026-10-15T00:00:00.000Z" } }] } });
  return { supplier, connection };
}
describe("catalog schedule HTTP boundary", () => {
  it("GET and PATCH off remain read-only upstream; POST off does not scan", async () => {
    await fixture();
    expect(await (await GET(request())).json()).toMatchObject({ mode: "daily", nextCheckAt: expect.any(String) });
    expect(await (await PATCH(request("PATCH", { mode: "off" }))).json()).toMatchObject({ mode: "off", nextCheckAt: null });
    await POST(); await runtime.__supplierCatalogUpgrade!.settle();
    expect(mocks.scan).not.toHaveBeenCalled(); expect(mocks.models).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("validates mode and refuses non-desktop routes", async () => {
    expect((await PATCH(request("PATCH", { mode: "hourly" }))).status).toBe(400);
    vi.stubEnv("SUPERCANVAS_DESKTOP", "false");
    expect((await GET(request())).status).toBe(404); expect((await POST()).status).toBe(404);
    expect((await PATCH(request("PATCH", { mode: "off" }))).status).toBe(404);
  });
  it("both legacy scanners write only to staging until one complete atomic publication", async () => {
    const { supplier, connection } = await fixture();
    const commits = vi.spyOn(live, "commitCatalogSnapshot");
    mocks.scan.mockImplementation(async () => {
      const row = (await mocks.repository.getSupplier(supplier.id))!;
      const staged = await mocks.repository.saveSupplier({ ...row, catalog: { groups: [{ id: "default", label: "Default",
        models: [{ id: "full/image-id", capability: "image", priceLabel: "¥0.12/张 · 4K" }] }] } });
      expect((await live.getSupplier(supplier.id))?.catalog).toEqual(supplier.catalog);
      return staged;
    });
    mocks.models.mockImplementation(async () => {
      const row = (await mocks.repository.getConnection(connection.id))!;
      await mocks.repository.saveConnection({ ...row, config: { ...row.config,
        modelCatalogModels: [{ id: "full/image-id", operations: ["image.generate"], metadata: { priceLabel: "¥0.12/张 · 4K" } }] } });
      expect((await live.getConnection(connection.id))?.config.modelCatalogModels).toEqual(connection.config.modelCatalogModels);
      return Response.json([], { headers: { "X-Model-Scan-Complete": "true", "X-Model-Scan-Status": "live" } });
    });
    expect((await POST()).status).toBe(202); await runtime.__supplierCatalogUpgrade!.settle();
    expect(commits).toHaveBeenCalledTimes(1);
    const status = await (await GET(request())).json();
    expect(status).toMatchObject({ refreshed: 1, changedConnectionIds: [connection.id], priceChangedSupplierIds: [supplier.id], noticeId: expect.any(String) });
    expect(status.history[0].changes).toContainEqual(expect.objectContaining({ modelId: "full/image-id", before: "¥0.10/张 · 4K", after: "¥0.12/张 · 4K" }));
    expect(JSON.stringify(status)).not.toContain("opaque-fixture-key");
    const summary = await (await GET(new Request("http://localhost/api/suppliers/catalog-upgrade?summary=1"))).json();
    expect(summary.history).toEqual([]);
  });
  it("partial supplier stage preserves the live supplier and never begins a Key inventory read", async () => {
    const { supplier } = await fixture();
    mocks.scan.mockImplementation(async () => mocks.repository.saveSupplier({ ...supplier, scanStatus: "failed", scanComplete: false,
      scanErrorCode: "network", catalog: { groups: [] } }));
    await POST(); await runtime.__supplierCatalogUpgrade!.settle();
    expect(mocks.models).not.toHaveBeenCalled(); expect((await live.getSupplier(supplier.id))?.catalog).toEqual(supplier.catalog);
    expect(await (await GET(request())).json()).toMatchObject({ manualConnectionIds: ["connection"], connections: [expect.objectContaining({ pauseReason: "network" })] });
  });
  it("complete membership publishes despite failed supplementary documentation and prices", async () => {
    const { supplier, connection } = await fixture();
    const commits = vi.spyOn(live, "commitCatalogSnapshot");
    mocks.scan.mockImplementation(async () => mocks.repository.saveSupplier({ ...supplier, catalog: { groups: [
      { id: "default", label: "Default", models: [{ id: "full/image-id", capability: "image" }, { id: "full/new-id", capability: "image" }] },
    ] } }));
    mocks.models.mockImplementation(async () => {
      catalogScopedMap("supplier-document", "auxiliary").set("doc", { text: Promise.resolve(undefined) });
      catalogScopedMap("weai-pricing", "auxiliary").set("quote", { complete: false, status: "failed" });
      const row = (await mocks.repository.getConnection(connection.id))!;
      await mocks.repository.saveConnection({ ...row, config: { ...row.config, modelCatalogModels: [
        { id: "full/image-id", operations: ["image.generate"] }, { id: "full/new-id", operations: ["image.generate"] },
      ] } });
      return Response.json([], { headers: { "X-Model-Scan-Complete": "true", "X-Model-Scan-Status": "live" } });
    });
    await POST(); await runtime.__supplierCatalogUpgrade!.settle();
    expect(commits).toHaveBeenCalledTimes(1);
    const status = await (await GET(request())).json();
    expect(status).toMatchObject({ refreshed: 1, retainedPriceModelCount: 1 });
    expect(status.history[0].changes).toContainEqual(expect.objectContaining({ modelId: "full/new-id", kind: "model-added" }));
    expect(status.history[0].changes.some((change: { kind: string }) => change.kind === "price")).toBe(false);
    expect((await live.getConnection(connection.id))?.config.modelCatalogModels).toEqual([
      expect.objectContaining({ id: "full/image-id", metadata: expect.objectContaining({ priceLabel: "¥0.10/张 · 4K（上次价格）",
        priceStatus: "partial", priceCheckedAt: "2026-10-15T00:00:00.000Z" }) }),
      expect.objectContaining({ id: "full/new-id" }),
    ]);
    expect((await live.getSupplier(supplier.id))?.catalog.groups[0]?.models.map(model => model.id)).toEqual(["full/image-id", "full/new-id"]);
  });
  it("an unfinished Key inventory never publishes staged removals even when price errors are auxiliary", async () => {
    const { supplier, connection } = await fixture();
    const commits = vi.spyOn(live, "commitCatalogSnapshot");
    mocks.scan.mockResolvedValue(supplier);
    mocks.models.mockImplementation(async () => {
      catalogScopedMap("weai-pricing", "auxiliary").set("quote", { complete: false });
      const row = (await mocks.repository.getConnection(connection.id))!;
      await mocks.repository.saveConnection({ ...row, config: { ...row.config, modelCatalogModels: [] } });
      return Response.json([], { headers: { "X-Model-Scan-Complete": "false", "X-Model-Scan-Status": "live",
        "X-Model-Scan-Error-Code": "incomplete_directory" } });
    });
    await POST(); await runtime.__supplierCatalogUpgrade!.settle();
    expect(commits).not.toHaveBeenCalled();
    expect((await live.getConnection(connection.id))?.config.modelCatalogModels).toEqual(connection.config.modelCatalogModels);
    expect((await (await GET(request())).json()).history).toEqual([]);
  });
});

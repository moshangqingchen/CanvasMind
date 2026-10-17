import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, catalogPipelineSettingKey } from "@super-canvas/db";
const mock = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, scan: vi.fn(), inventory: vi.fn() }));
vi.mock("../../../../lib/server", () => ({ get repository() { return mock.repository; } }));
vi.mock("../../../../lib/desktop-server", () => ({ trackDesktopBackgroundWrite: (work: () => Promise<void>) => work() }));
vi.mock("../../../../lib/supplier-service", () => ({ scanSupplierRecord: mock.scan }));
vi.mock("../../../../lib/provider-model-inventory", () => ({ readProviderModelInventory: mock.inventory }));
import { GET, PATCH, POST } from "./route";
import type { createCatalogAutomaticCheck } from "../../../../lib/catalog-automatic-check";
const runtime = globalThis as typeof globalThis & { __supplierCatalogReadStop?: () => void;
  __supplierCatalogAutomaticCheck?: ReturnType<typeof createCatalogAutomaticCheck>; __supplierCatalogUpgrade?: unknown };
const request = (method = "GET", body?: unknown) => new Request("http://localhost/api/suppliers/catalog-upgrade", { method,
  ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2001, 0, 1));
  mock.repository = new MemoryRepository(); mock.scan.mockReset(); mock.inventory.mockReset();
  delete runtime.__supplierCatalogUpgrade;
  vi.stubEnv("SUPERCANVAS_DESKTOP", "true"); vi.stubEnv("SUPERCANVAS_CATALOG_LEGACY_CHECKER", "0");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No real upstream requests allowed"); }));
});
afterEach(() => { runtime.__supplierCatalogReadStop?.(); delete runtime.__supplierCatalogUpgrade; vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
async function fixture(extra: Record<string, unknown> = {}) {
  return mock.repository.saveConnection({ id: "fixture-key", name: "Fixture only", provider: "openai", encryptedSecret: "synthetic-ciphertext",
    config: { baseUrl: "https://api.tk1688.com/v1", catalogCheckAttemptedAt: new Date(Date.now() - 60_000).toISOString(), ...extra } });
}
describe("default catalog pipeline HTTP integration", () => {
  it("returns a safe stale confirmation response if the connection was removed", async () => {
    const response = await POST(request("POST", { action: "confirm-candidate", connectionId: "removed-fixture", sourceKey: "synthetic", candidateVersion: "stale" }));
    expect(response.status).toBe(409);
    expect(fetch).not.toHaveBeenCalled(); expect(mock.scan).not.toHaveBeenCalled();
  });
  it("GET only reads local data; startup adopts old due without invoking the legacy scanners or HTTP", async () => {
    await fixture();
    expect((await (await GET(request())).json()).pipeline).toBeDefined();
    expect(await mock.repository.getApplicationSetting(catalogPipelineSettingKey("connection:fixture-key"))).toBeUndefined();
    expect((await POST()).status).toBe(202); await runtime.__supplierCatalogAutomaticCheck!.settle();
    const state = await mock.repository.getApplicationSetting(catalogPipelineSettingKey("connection:fixture-key")) as { entries: Record<string, unknown> };
    expect(state.entries["legacy:connection:fixture-key"]).toMatchObject({ nextEligibleAt: new Date(Date.now() - 60_000 + 86_400_000).toISOString() });
    expect(mock.scan).not.toHaveBeenCalled(); expect(mock.inventory).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(runtime.__supplierCatalogUpgrade).toBeUndefined();
  });
  it("off preserves zero dispatch and candidate confirmation cannot accept an arbitrary token", async () => {
    await fixture({ catalogCheckPaused: true });
    expect((await PATCH(request("PATCH", { mode: "off" }))).status).toBe(200);
    await POST(); await runtime.__supplierCatalogAutomaticCheck!.settle();
    expect(await mock.repository.getApplicationSetting(catalogPipelineSettingKey("connection:fixture-key"))).toBeUndefined();
    const invalid = await POST(request("POST", { action: "confirm-candidate", connectionId: "fixture-key", sourceKey: "synthetic", candidateVersion: "stale" }));
    expect(invalid.status).toBe(409); expect(fetch).not.toHaveBeenCalled(); expect(mock.scan).not.toHaveBeenCalled();
  });
});

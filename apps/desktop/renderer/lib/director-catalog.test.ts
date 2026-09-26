import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";
const mocks = vi.hoisted(() => ({ listConnections: vi.fn(), inventory: vi.fn() }));
vi.mock("./server", () => ({ repository: { listConnections: mocks.listConnections } }));
vi.mock("./provider-model-inventory", () => ({ readProviderModelInventory: mocks.inventory }));
import { loadDirectorCatalog } from "./director-catalog";
function connection(id: string, config: Record<string, string> = {}): ProviderConnectionRecord {
  return { id, name: id, provider: "rest", encryptedSecret: "encrypted", config: { usage: "canvas", ...config }, createdAt: "2026-09-22", updatedAt: "2026-09-22" };
}
const model = { id: "image", name: "Image", operations: ["image.generate"] };
beforeEach(() => { vi.clearAllMocks(); });
describe("shared director inventory", () => {
  it("reads ready CLI catalogs without a key and leaves unknown pricing unknown", async () => {
    const cli = { ...connection("cli"), provider: "cli", encryptedSecret: null,
      config: { usage: "canvas", cli: { enabled: true }, cliStatus: { state: "ready" } } };
    mocks.listConnections.mockResolvedValue([cli, { ...cli, id: "disabled", config: { ...cli.config, cli: { enabled: false } } }]);
    mocks.inventory.mockResolvedValue(Response.json([model, { ...model, id: "mock", metadata: { cliMock: true } }], { headers: { "X-Model-Scan-Status": "live" } }));
    const catalog = await loadDirectorCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.pricing).toBeUndefined();
    expect(mocks.inventory).toHaveBeenCalledTimes(1);
  });
  it("uses the canvas service for both legacy and supplier-linked connections without requesting refresh", async () => {
    mocks.listConnections.mockResolvedValue([connection("legacy", { preset: "cyberafei-api" }), connection("current", { supplierId: "supplier" })]);
    mocks.inventory.mockImplementation(async (_request, context) => {
      const { id } = await context.params;
      return Response.json([{ ...model, id: `${id}-image` }], { headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Checked-At": "checked" } });
    });
    const catalog = await loadDirectorCatalog();
    expect(catalog.map(c => c.model.id)).toEqual(["legacy-image", "current-image"]);
    expect(catalog.every(c => c.authoritative && c.catalogCheckedAt === "checked")).toBe(true);
    expect(mocks.inventory.mock.calls.every(([request]) => !new URL(request.url).searchParams.has("refresh"))).toBe(true);
  });
  it("keeps stale candidates non-authoritative and excludes denied or non-runnable models", async () => {
    mocks.listConnections.mockResolvedValue([connection("stale"), connection("denied", { modelScanStatus: "unauthorized" }), connection("disabled", { usage: "disabled" })]);
    mocks.inventory.mockResolvedValue(Response.json([model, { ...model, id: "unverified", metadata: { canvasRunnable: false } }], { headers: { "X-Model-Scan-Status": "stale" } }));
    expect(await loadDirectorCatalog()).toMatchObject([{ connectionId: "stale", authoritative: false, model: { id: "image" } }]);
    expect(mocks.inventory).toHaveBeenCalledTimes(1);
  });
  it("bounds concurrent inventory reads and preserves connection order", async () => {
    mocks.listConnections.mockResolvedValue(Array.from({ length: 12 }, (_, i) => connection(`c${i}`)));
    let active = 0;
    let maximum = 0;
    mocks.inventory.mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      return Response.json([model], { headers: { "X-Model-Scan-Status": "live" } });
    });
    const catalog = await loadDirectorCatalog();
    expect(maximum).toBe(4);
    expect(catalog.map(c => c.connectionId)).toEqual(Array.from({ length: 12 }, (_, i) => `c${i}`));
  });
  it("does not start remaining inventory reads after cancellation", async () => {
    const abort = new AbortController();
    mocks.listConnections.mockResolvedValue(Array.from({ length: 12 }, (_, i) => connection(`c${i}`)));
    mocks.inventory.mockImplementation(async () => { abort.abort(); return Response.json([]); });
    await expect(loadDirectorCatalog(abort.signal)).rejects.toThrow();
    expect(mocks.inventory.mock.calls.length).toBeLessThanOrEqual(4);
  });
});

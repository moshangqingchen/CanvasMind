import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type Repository } from "@super-canvas/db";
import { discoverSupplierCatalog } from "../../../../packages/providers/src/supplier-catalog";
import { scopedCatalogRepository, withCatalogRepository } from "./catalog-repository-scope";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as Repository, discover: vi.fn(), keyRead: vi.fn(), inventory: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; } }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()),
  discoverSupplierCatalog: mocks.discover, readSupplierAccountKeys: mocks.keyRead }));
vi.mock("./provider-model-inventory", () => ({ readProviderModelInventory: mocks.inventory }));
import { createSupplierRecord, scanSupplierRecord } from "./supplier-service";
import { catalogChanges } from "./supplier-catalog-policy";

let live: MemoryRepository;
beforeEach(() => {
  live = new MemoryRepository(); mocks.repository = scopedCatalogRepository(live);
  mocks.discover.mockReset(); mocks.keyRead.mockReset(); mocks.inventory.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No upstream request allowed in isolated scanner test"); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled(); expect(mocks.keyRead).not.toHaveBeenCalled(); expect(mocks.inventory).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("automatic supplier scan membership evidence", () => {
  it.each(["missing-group-models", "unfinished-page", "price-only-failure", "confirmed-empty-group"] as const)(
    "runs the real discovery and scanner against staging for %s", async condition => {
      const created = await createSupplierRecord({ name: "Isolated directory", siteUrl: "https://scanner.example",
        apiUrl: "https://scanner.example/v1", kind: "sub2api" });
      const previous = await live.saveSupplier({ ...created, scanStatus: "live", scanComplete: true, catalog: { groups: [
        { id: "read", label: "read", supplierGroupId: "7", source: "catalog", models: [{ id: "full/old", capability: "image" }] },
        ...(["missing-group-models", "confirmed-empty-group"].includes(condition) ? [{ id: "account-only", label: "account-only", supplierGroupId: "8", source: "catalog" as const,
          models: [{ id: "full/must-not-retire", capability: "image" as const, priceLabel: "¥0.2/张" }] }] : []),
      ] } });
      const reads: string[] = [];
      mocks.discover.mockImplementation(input => discoverSupplierCatalog(input, async url => {
        const path = new URL(String(url)).pathname; reads.push(path);
        if (path === "/api/v1/model-plaza") return Response.json({ data: { groups: [{ id: 7, name: "read", models: ["full/new"] },
          ...(condition === "confirmed-empty-group" ? [{ id: 8, name: "account-only", models: [] }] : [])] },
          ...(condition === "unfinished-page" ? { has_more: true } : {}) });
        if (path === "/api/v1/groups/available") return Response.json({ code: 0, data: [{ id: 7, name: "read" },
          ...(["missing-group-models", "confirmed-empty-group"].includes(condition) ? [{ id: 8, name: "account-only" }] : [])] });
        if (path === "/api/v1/pricing/channels") return Response.json({}, { status: 503 });
        throw new Error("Unexpected scanner fixture read");
      }));
      const staging = new MemoryRepository(live.exportSnapshot());
      const result = await withCatalogRepository(staging, () => scanSupplierRecord(previous.id, undefined, previous.state!.revision,
        { catalogOnly: true, verifyCapabilities: false }));
      expect((await live.getSupplier(previous.id))?.catalog).toEqual(previous.catalog);
      expect(await live.listConnections()).toEqual([]);
      expect(result.scanComplete).toBe(["price-only-failure", "confirmed-empty-group"].includes(condition));
      if (condition === "missing-group-models")
        expect(result.catalog.groups.find(group => group.id === "account-only")?.models.map(model => model.id)).toContain("full/must-not-retire");
      if (condition === "price-only-failure")
        expect(result.catalog.groups[0]?.models.map(model => model.id)).toEqual(["full/new"]);
      if (condition === "confirmed-empty-group") {
        expect(result.catalog.groups.find(group => group.id === "account-only")?.models).toEqual([]);
        const connection = { id: "current-key", name: "Isolated current Key", provider: "openai", encryptedSecret: "opaque-offline",
          config: {}, createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z" };
        expect(catalogChanges(connection, connection, previous, result)).toContainEqual(expect.objectContaining({
          kind: "model-removed", groupId: "account-only", modelId: "full/must-not-retire",
        }));
      }
      expect(reads).toContain("/api/v1/pricing/channels");
    },
  );
});

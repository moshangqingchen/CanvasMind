import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { withCatalogRepository } from "./catalog-repository-scope";
import { catalogScopedMap, catalogScopedValue, catalogScopeReadsComplete } from "./catalog-scope-cache";

describe("automatic catalog process cache isolation", () => {
  it("failed/partial staging cannot poison a foreground quote cache or overwrite concurrent new data", async () => {
    const cache = catalogScopedMap<string, unknown>("unit-prices"), staging = new MemoryRepository();
    cache.set("price", "valid-old");
    let unblock!: () => void;
    const held = new Promise<void>(resolve => { unblock = resolve; });
    const automatic = withCatalogRepository(staging, async () => {
      expect(cache.has("price")).toBe(false);
      cache.set("price", { result: Promise.resolve({ complete: false, models: [] }) });
      await held;
      expect(cache.get("price")).not.toBe("foreground-new");
    });
    cache.set("price", "foreground-new"); unblock(); await automatic;
    expect(cache.get("price")).toBe("foreground-new");
    expect(await catalogScopeReadsComplete(staging)).toBe(false);
  });
  it("native singleton catalog snapshots are isolated and fallback/stale cannot establish success", async () => {
    const staged = new MemoryRepository();
    expect(catalogScopedValue("unit-catalog", () => ({ snapshot: { source: "live" } }))).toBeUndefined();
    await withCatalogRepository(staged, async () => {
      const local = catalogScopedValue("unit-catalog", () => ({ snapshot: { source: "stale" } }))!;
      expect(catalogScopedValue("unit-catalog", () => ({ snapshot: { source: "live" } }))).toBe(local);
    });
    expect(await catalogScopeReadsComplete(staged)).toBe(false);
    const other = new MemoryRepository();
    await withCatalogRepository(other, async () => { catalogScopedValue("unit-catalog", () => ({ snapshot: { source: "live" } })); });
    expect(await catalogScopeReadsComplete(other)).toBe(true);
  });
  it("rejected and missing documentation results remain incomplete without leaking into other scopes", async () => {
    const stage = new MemoryRepository(), docs = catalogScopedMap<string, { text: Promise<string | undefined> }>("unit-docs");
    docs.set("url", { text: Promise.resolve("foreground-valid") });
    await withCatalogRepository(stage, async () => { docs.set("url", { text: Promise.resolve(undefined) }); });
    expect(await catalogScopeReadsComplete(stage)).toBe(false);
    expect(await docs.get("url")!.text).toBe("foreground-valid");
  });
});

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, SupplierCatalogDiscovery } from "@super-canvas/providers";
const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./supplier-service", () => ({ getSupplierRecord: vi.fn(async () => null) }));
vi.mock("./server", () => ({ repository: { getSupplierVerification: vi.fn(async () => null) } }));
vi.mock("@super-canvas/providers", async original => ({
  ...await original<typeof import("@super-canvas/providers")>(),
  discoverSupplierCatalog: vi.fn(async () => { throw new Error("Unexpected upstream discovery"); }),
}));
import { getSupplierRecord } from "./supplier-service";
import { applySupplierCatalogPrices, enrichSupplierModelPrices } from "./supplier-model-pricing";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/mikoto-rest-auto-snapshot.json", import.meta.url), "utf8"));
const original = (): ModelDescriptor => structuredClone(fixture.original);
const current = (amount = .123): SupplierCatalogDiscovery => {
  const catalog: SupplierCatalogDiscovery = { ...structuredClone(fixture.catalogState), groups: [structuredClone(fixture.groupCatalog)] };
  const model = catalog.groups[0]!.models[0]!;
  model.priceLabel = `$${amount}/张`;
  const pricing = model.metadata!.officialCatalogPricing as NonNullable<ModelDescriptor["pricing"]>;
  pricing.unitAmount = amount;
  return catalog;
};
beforeEach(() => { network.fetch.mockReset().mockRejectedValue(new Error("Unexpected real network")); vi.stubGlobal("fetch", network.fetch); });
afterEach(() => { expect(network.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.mocked(getSupplierRecord).mockResolvedValue(null); });

describe("actual Mikoto group16 automatic snapshot replaced only by same-scope official available quote", () => {
  it("updates a changed exact account price instead of retaining the observed automatic .08 snapshot", () => {
    const old = original(), catalog = current();
    const result = applySupplierCatalogPrices([old], fixture.group, catalog, fixture.origin, { supplierGroupId: "16" })[0]!;
    expect(result.pricing).toEqual(catalog.groups[0]!.models[0]!.metadata!.officialCatalogPricing);
    expect(result.metadata).toMatchObject({ priceSource: "supplier-catalog", priceStatus: "available", supplierPriceGroupId: "16", priceLabel: "$0.123/张" });
    expect(result.parameters).toEqual(old.parameters);
    expect(result.operations).toEqual(old.operations);
  });
  it("limits the exact actual cached descriptor migration to known generated price fields", () => {
    const old = original(), result = applySupplierCatalogPrices([old], fixture.group, current(.08), fixture.origin, { supplierGroupId: "16" })[0]!;
    const different = (left: unknown, right: unknown) => JSON.stringify(left) !== JSON.stringify(right);
    const top = Object.keys({ ...old, ...result }).filter(key => different(old[key as keyof ModelDescriptor], result[key as keyof ModelDescriptor]));
    const metadata = Object.keys({ ...old.metadata, ...result.metadata }).filter(key => different(old.metadata?.[key], result.metadata?.[key]));
    expect(top.filter(key => !["pricing", "name", "metadata"].includes(key))).toEqual([]);
    expect(metadata.sort()).toEqual(["priceLabel", "priceSource", "priceStatus", "priceCheckedAt", "priceLastAttemptAt", "supplierPriceGroup", "supplierPriceGroupId"].sort());
    expect(result.name).toBe("GPT Image 2（原生4K）");
    const named = { ...old, name: "用户自定义标题 $0.08" };
    expect(applySupplierCatalogPrices([named], fixture.group, current(), fixture.origin, { supplierGroupId: "16" })[0]!.name).toBe(named.name);
  });
  it("uses its complete exact quote even while other supplier groups are absent", () => {
    const catalog = current(.09); expect(catalog.complete).toBe(false);
    expect(applySupplierCatalogPrices([original()], fixture.group, catalog, fixture.origin, { supplierGroupId: "16" })[0]!.pricing?.unitAmount).toBe(.09);
  });
  it.each(["manual", "generated-result"])("protects an explicit %s price", priceSource => {
    const old = original(); old.metadata = { ...old.metadata, priceSource };
    expect(applySupplierCatalogPrices([old], fixture.group, current(), fixture.origin, { supplierGroupId: "16" })[0]!.pricing).toEqual(old.pricing);
  });
  it.each(["stale-group", "stale-model", "group-id", "full-id", "price-origin", "unverified", "estimated", "token"])("preserves old price when exact current evidence is %s", kind => {
    const catalog = current(), row = catalog.groups[0]!, model = row.models[0]!;
    const price = model.metadata!.officialCatalogPricing as NonNullable<ModelDescriptor["pricing"]>;
    if (kind === "stale-group") row.details = { ...row.details, source: row.details?.source ?? "key-groups", stale: true };
    if (kind === "stale-model") model.metadata = { ...model.metadata, supplierCatalogModelStale: true };
    if (kind === "group-id") row.supplierGroupId = "39";
    if (kind === "full-id") model.id = "gpt-image-2.5-flare";
    if (kind === "price-origin") price.sourceUrl = "https://another.example/api/v1/channels/available";
    if (kind === "unverified") model.metadata = { ...model.metadata, officialCatalogPriceGroupVerified: false };
    if (kind === "estimated") price.confidence = "estimate";
    if (kind === "token") price.kind = "token";
    const old = original();
    expect(applySupplierCatalogPrices([old], fixture.group, catalog, fixture.origin, { supplierGroupId: "16" })[0]!.pricing).toEqual(old.pricing);
  });
  it("protects a user-authored or actual measured descriptor lacking a priceSource", () => {
    for (const metadata of [{ source: "manual" }, { protocolEvidence: "paid-test" }, { measuredPrice: { amount: .08 } }, { pricingCapturedAt: "custom" }]) {
      const old = original(); old.metadata = { ...old.metadata, ...metadata };
      expect(applySupplierCatalogPrices([old], fixture.group, current(), fixture.origin, { supplierGroupId: "16" })[0]!.pricing).toEqual(old.pricing);
    }
  });
  it("does not map another vendor's source onto the automatic snapshot", () => {
    const old = original();
    expect(applySupplierCatalogPrices([old], fixture.group, current(), "https://other.example", { supplierGroupId: "16" })[0]!.pricing).toEqual(old.pricing);
  });
  it("updates cached prices through source-bound saved catalog and remains idempotent", async () => {
    const catalog = current(.137), supplier = { id: fixture.supplierId, apiUrl: fixture.origin, siteUrl: fixture.origin,
      kind: "sub2api", state: { sourceId: fixture.sourceId }, catalog: { groups: catalog.groups }, scanStatus: "live", scanComplete: false,
      scannedAt: catalog.checkedAt, updatedAt: catalog.checkedAt };
    vi.mocked(getSupplierRecord).mockResolvedValue(supplier as never);
    const config = { supplierId: fixture.supplierId, supplierSourceId: fixture.sourceId, baseUrl: fixture.origin, accountKeyGroup: fixture.group, accountKeyGroupId: "16" };
    const result = await enrichSupplierModelPrices({ config }, [original()], false, false);
    expect(result[0]!.pricing?.unitAmount).toBe(.137);
    const again = await enrichSupplierModelPrices({ config }, result, false, false);
    expect(again).toEqual(result);
    const wrongSource = await enrichSupplierModelPrices({ config: { ...config, supplierSourceId: "different-source" } }, [original()], false, false);
    expect(wrongSource[0]!.pricing).toEqual(original().pricing);
  });
});

import { describe, expect, it } from "vitest";
import type { CatalogPipelineState, ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import { catalogConnectionScopes, catalogReadItem } from "./catalog-source-plan";
import { projectCatalogOffers } from "./catalog-offer-projection";
const at = "2001-01-01T00:00:00Z";
const supplier: SupplierRecord = { id: "supplier", name: "Fixture", supplierKey: "fixture", siteUrl: "https://fixture.invalid",
  apiUrl: "https://fixture.invalid/v1", kind: "newapi", scanStatus: "live", createdAt: at, updatedAt: at,
  state: { version: 1, revision: 1, visibility: "visible", sourceId: "source", fingerprint: "fixture", history: [] },
  catalog: { groups: [{ id: "a", label: "Old A", source: "catalog", models: [{ id: "old", capability: "image" }], details: {
    source: "model-plaza", ledgerPrices: [] } }] } };
const connection = { id: "key", name: "Fixture", provider: "openai", createdAt: at, updatedAt: at,
  config: { supplierId: supplier.id, supplierSourceId: "source", baseUrl: supplier.apiUrl, modelGroup: "a" } } as ProviderConnectionRecord;
const state = (): CatalogPipelineState => ({ schemaVersion: 1, supplierId: supplier.id, identityEpoch: "epoch", nextDispatchSeq: 2, sources: {}, entries: {} });
function observation(complete = true, optionsOnly = false): CatalogReadObservation {
  const scope = catalogConnectionScopes(connection, supplier);
  return { receipt: { spec: catalogReadItem("public-pricing", "https://fixture.invalid/api/pricing", "catalog-offer", scope.anonymous, scope.apply),
    context: { identityEpoch: "epoch", runId: "run", dispatchSeq: 1, observationCycleId: "daily-1" }, freshness: "live", checkedAt: at,
    complete, status: "succeeded", coverage: { domain: optionsOnly ? "group-options" : "offers", exhaustive: complete, modelIds: ["new"] } },
    facts: { models: [], supplierGroups: [{ id: "a", label: "New A", source: "catalog", models: [{ id: "new", capability: "image" }],
      details: { source: "model-plaza", description: "Updated declaration" } }] } };
}
describe("independent public offer projection", () => {
  it("records an actual published group price change without treating a sample timestamp as a change", () => {
    const before = structuredClone(supplier);
    before.catalog.groups[0]!.details!.rateMultiplier = 1;
    const fact = observation(true, true);
    fact.facts.supplierGroups![0]!.label = "Old A";
    fact.facts.supplierGroups![0]!.details!.rateMultiplier = 0.8;
    const projected = projectCatalogOffers(state(), before, fact, "daily", at);
    expect(projected.changes).toContainEqual(expect.objectContaining({ kind: "price", groupId: "name:a" }));
    before.catalog.groups[0]!.details!.rateMultiplier = 0.8;
    fact.receipt.checkedAt = "2001-01-02T00:00:00Z";
    expect(projectCatalogOffers(state(), before, fact, "daily", fact.receipt.checkedAt).changes).toEqual([]);
  });
  it("records unpriced public model additions but not an unchanged sample", () => {
    const first = observation();
    first.facts.supplierGroups![0]!.label = "Old A";
    first.facts.supplierGroups![0]!.models.unshift({ id: "old", capability: "image" });
    const projected = projectCatalogOffers(state(), supplier, first, "daily", at);
    expect(projected.changes).toContainEqual(expect.objectContaining({ kind: "model-added", groupId: "name:a", modelId: "new" }));
    const patch = projected.groups.find(row => row.kind === "fields");
    expect(patch?.kind).toBe("fields");
    const updated = structuredClone(supplier);
    if (patch?.kind === "fields") Object.assign(updated.catalog.groups[0]!, patch.fields?.set);
    const pipeline = state();
    for (const entry of projected.state) pipeline.entries[entry.key] = entry.value;
    const second = structuredClone(first);
    second.receipt.checkedAt = "2001-01-02T00:00:00Z";
    second.receipt.context.dispatchSeq = 2;
    second.receipt.context.observationCycleId = "daily-2";
    expect(projectCatalogOffers(pipeline, updated, second, "daily", second.receipt.checkedAt).changes).toEqual([]);
  });
  it("publishes exact group/model declarations as owned patches and preserves ledger fields", () => {
    const before = structuredClone(supplier);
    const projected = projectCatalogOffers(state(), supplier, observation(), "daily", at);
    expect(projected.groups).toHaveLength(1);
    expect(projected.groups[0]).toMatchObject({ kind: "fields", groupId: "name:a", fields: { expected: { label: "Old A" },
      set: { label: "New A", models: [expect.objectContaining({ id: "new" })] } }, details: { set: { description: "Updated declaration" } } });
    expect(JSON.stringify(projected.groups)).not.toContain("ledgerPrices");
    expect(supplier).toEqual(before); expect(projected).not.toHaveProperty("connections");
    expect(projected.state.some(row => row.key.startsWith("offers:"))).toBe(true);
  });
  it("never publishes partial retractions or clears models from group-options-only reads", () => {
    expect(projectCatalogOffers(state(), supplier, observation(false), "daily", at).groups).toEqual([]);
    const projected = projectCatalogOffers(state(), supplier, observation(true, true), "daily", at);
    expect(projected.groups[0]).toMatchObject({ fields: { set: { models: [expect.objectContaining({ id: "old" })] } } });
    expect(projected.state.some(row => row.key.startsWith("offer-prices:"))).toBe(false);
  });
  it("leaves manual groups alone and retains another source's exact model contribution", () => {
    const manual = { ...supplier, catalog: { groups: supplier.catalog.groups.map(group => ({ ...group, source: "manual" as const })) } };
    expect(projectCatalogOffers(state(), manual, observation(), "daily", at).groups).toEqual([]);
    const pipeline = state(); pipeline.entries["offers:other-source"] = { schemaVersion: 1, lastDispatchSeq: 2, groups: { "name:a": ["old"] } };
    const projected = projectCatalogOffers(pipeline, supplier, observation(), "daily", at);
    expect(projected.groups[0]).toMatchObject({ fields: { set: { models: [expect.objectContaining({ id: "new" }), expect.objectContaining({ id: "old" })] } } });
  });
});

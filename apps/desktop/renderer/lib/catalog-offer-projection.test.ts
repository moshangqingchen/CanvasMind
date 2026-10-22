import { describe, expect, it } from "vitest";
import { MemoryRepository, catalogObservationIdentity, catalogPipelineSettingKey, type CatalogPipelineState, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
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
  it.each([false, true])("publishes to the unique current stable-ID group and retains its missing alias, reversed=%s", async reverse => {
    const repository = new MemoryRepository();
    const historical = { ...structuredClone(supplier.catalog.groups[0]!), id: "adobe中质量生图", label: "adobe中质量生图", supplierGroupId: "99", status: "missing" as const,
      models: [{ id: "historical-only", capability: "image" as const }], details: { source: "model-plaza" as const, stale: true, description: "Historical declaration", ledgerPrices: [] } };
    const current = { ...structuredClone(supplier.catalog.groups[0]!), id: "ad中质量生图", label: "ad中质量生图", supplierGroupId: "99", source: "catalog" as const, status: "available" as const };
    const saved = await repository.saveSupplier({ ...supplier, catalog: { groups: reverse ? [current, historical] : [historical, current] } });
    const selected = await repository.saveConnection({ ...connection, config: { ...connection.config, accountKeyGroupId: "99", modelGroup: current.id } });
    const fact = observation();fact.facts.supplierGroups = [{ ...current, models: [{ id: "current-new", capability: "image" }], details: { source: "model-plaza", description: "Current declaration" } }];
    const reservation = await repository.reserveCatalogObservation({ identity: catalogObservationIdentity(saved, [selected]), expectedMode: "daily",
      sourceKey: fact.receipt.spec.sourceKey, observationCycleId: "daily-1" });
    fact.receipt.context.identityEpoch = reservation.identityEpoch;fact.receipt.context.dispatchSeq = reservation.dispatchSeq;
    const pipeline = await repository.getApplicationSetting(catalogPipelineSettingKey(saved.id)) as unknown as CatalogPipelineState;
    const projected = projectCatalogOffers(pipeline, saved, fact, "daily", at);
    expect(projected.groups).toHaveLength(1);
    expect(projected.groups[0]).toMatchObject({ kind: "fields", groupId: "site-id:99", fields: { expected: { label: current.label, status: "available" },
      set: { status: "available", models: [expect.objectContaining({ id: "current-new" })] } } });
    await repository.commitCatalogObservation({ reservation, groups: projected.groups, state: projected.state });
    const after = (await repository.getSupplier(saved.id))!.catalog.groups;
    expect(after.find(group => group.id === historical.id)).toEqual(historical);
    expect(after.find(group => group.id === current.id)).toMatchObject({ supplierGroupId: "99", status: "available", models: [expect.objectContaining({ id: "current-new" })],
      details: { description: "Current declaration" } });
    expect((await repository.getConnection(selected.id))!.config).toEqual(selected.config);
  });
  it.each(["available", "missing"] as const)("rejects two %s aliases of one stable ID instead of choosing by order", status => {
    const row = { ...structuredClone(supplier.catalog.groups[0]!), supplierGroupId: "99", status };
    const before = { ...supplier, catalog: { groups: [{ ...row, id: "old-alias", details: { ...row.details!, stale: true } }, { ...row, id: "new-alias" }] } };
    const fact = observation();fact.facts.supplierGroups![0]!.supplierGroupId = "99";
    for (const groups of [before.catalog.groups, [...before.catalog.groups].reverse()])
      expect(() => projectCatalogOffers(state(), { ...before, catalog: { groups } }, fact, "daily", at)).toThrow("分组身份不唯一");
  });
  it("withdraws only the unique current stable-ID row while retaining its missing historical alias", () => {
    const row = { ...structuredClone(supplier.catalog.groups[0]!), supplierGroupId: "99" };
    const historical = { ...row, id: "old-alias", status: "missing" as const }, current = { ...row, id: "current-alias", status: "available" as const };
    const before = { ...supplier, catalog: { groups: [historical, current] } }, fact = observation();fact.facts.supplierGroups = [];
    const pipeline = state();pipeline.entries[`offers:${fact.receipt.spec.sourceKey}`] = { schemaVersion: 1, lastDispatchSeq: 0, groups: { "site-id:99": ["old"] } };
    expect(projectCatalogOffers(pipeline, before, fact, "daily", at).groups).toEqual([{ kind: "fields", groupId: "site-id:99",
      fields: { expected: { status: "available" }, set: { status: "missing" } } }]);
    expect(before.catalog.groups).toEqual([historical, current]);
  });
  it("keeps exact existing media declarations when a generic price-only row arrives", () => {
    const before = structuredClone(supplier);
    before.catalog.groups[0]!.models = [{ id: "same", capability: "image", protocol: "openai-images", outputKinds: ["image"],
      limits: { maxOutputImages: 1 }, metadata: { tk1688Catalog: true, tk1688SupportedResolutions: ["1K", "2K", "4K"],
        tk1688Parameters: [{ key: "quality", options: [{ value: "medium" }] }], priceLabel: "old label",
        billingIncludesInputDuration: true, referenceVideoPricingUnpublished: true, priceContractWarning: "Declared reference billing", priceSourceUrl: "https://old.example" } }];
    const fact = observation();
    fact.receipt.spec.entryId = "supplier:pricing:site-account";
    fact.facts.supplierGroups![0]!.models = [{ id: "same", capability: "image", protocol: "unknown",
      metadata: { outputKindsSource: "inferred", priceLabel: "new label" } }];
    const patch = projectCatalogOffers(state(), before, fact, "daily", at).groups[0];
    expect(patch?.kind === "fields" && patch.fields?.set.models?.[0]).toMatchObject({ id: "same", protocol: "openai-images",
      outputKinds: ["image"], limits: { maxOutputImages: 1 }, metadata: { tk1688Catalog: true,
        tk1688SupportedResolutions: ["1K", "2K", "4K"], tk1688Parameters: [{ key: "quality" }], priceLabel: "new label",
        billingIncludesInputDuration: true, referenceVideoPricingUnpublished: true, priceContractWarning: "Declared reference billing" } });
    fact.facts.supplierGroups![0]!.models[0]!.limits = { maxOutputImages: 2 };
    const updated = projectCatalogOffers(state(), before, fact, "daily", at).groups[0];
    expect(updated?.kind === "fields" && updated.fields?.set.models?.[0]?.limits).toEqual({ maxOutputImages: 2 });
    fact.facts.supplierGroups![0]!.models[0] = { id: "same", capability: "other", outputKinds: [], metadata: { outputKindsSource: "declared" } };
    const declared = projectCatalogOffers(state(), before, fact, "daily", at).groups[0];
    expect(declared?.kind === "fields" && declared.fields?.set.models?.[0]).toMatchObject({ capability: "other", outputKinds: [] });
    fact.facts.supplierGroups![0]!.models[0]!.metadata = { outputKindsSource: "inferred" };
    const inferred = projectCatalogOffers(state(), before, fact, "daily", at).groups[0];
    expect(inferred?.kind === "fields" && inferred.fields?.set.models?.[0]).toMatchObject({ capability: "image", outputKinds: ["image"] });
  });
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

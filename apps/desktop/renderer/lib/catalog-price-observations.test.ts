import { describe, expect, it } from "vitest";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor, StructuredModelPricing } from "@super-canvas/providers";
import { selectModelQuote } from "@super-canvas/providers/media-billing";
import { modelPickerPriceData } from "./model-picker-data";
import { canMergeDiscreteCatalogPrices, reduceCatalogPrices, type CatalogPriceState } from "./catalog-price-observations";
import { catalogConnectionScopes, catalogReadItem } from "./catalog-source-plan";
import type { CatalogReadObservation } from "./catalog-read-contracts";

const at = (day: number) => new Date(Date.UTC(2026, 9, 1 + day)).toISOString();
const price = (amount: number, day = 0): StructuredModelPricing => ({ kind: "per-image", currency: "CNY", unitAmount: amount,
  checkedAt: at(day), sourceUrl: "https://fixture.invalid/api/pricing", confidence: "exact" });
const model = (pricing?: StructuredModelPricing): ModelDescriptor => ({ id: "image-full-id", name: "Image", operations: ["image.generate"], ...(pricing ? { pricing } : {}) });
const connection = (models: ModelDescriptor[]): ProviderConnectionRecord => ({ id: "fixture-key", name: "Fixture", provider: "rest",
  config: { baseUrl: "https://fixture.invalid", accountKeyGroupId: "1", accountKeyGroup: "default", modelCatalogModels: models as never }, createdAt: at(0), updatedAt: at(0) });
function observation(day: number, models: ModelDescriptor[], extra: Partial<CatalogReadObservation["receipt"]> = {}): CatalogReadObservation {
  const conn = connection([]), scopes = catalogConnectionScopes(conn);
  return { receipt: { spec: catalogReadItem("pricing", "https://fixture.invalid/api/pricing", "price", scopes.anonymous, scopes.apply),
    context: { runId: `run-${day}`, observationCycleId: `cycle-${day}`, identityEpoch: "epoch", dispatchSeq: day + 1 },
    checkedAt: at(day), status: "succeeded", complete: true, freshness: "live",
    coverage: { domain: "price-fragment", modelIds: ["image-full-id"], groupIdentities: ["site-id:1"], exhaustive: true }, ...extra }, facts: { models } };
}
function reduce(conn: ProviderConnectionRecord, observations: CatalogReadObservation[], previous?: CatalogPriceState) {
  return reduceCatalogPrices(previous, { connection: conn, models: (conn.config.modelCatalogModels as unknown as ModelDescriptor[]),
    observations, identityEpoch: "epoch", mode: "daily", observedAt: observations.at(-1)?.receipt.checkedAt ?? at(0) });
}
const unpublished = (day: number) => observation(day, [{ ...model(), metadata: { catalogPricePresence: "explicit-unpublished" } }]);
const tiered = (tiers: StructuredModelPricing["tiers"], day = 0): StructuredModelPricing => ({ kind: "tiered", currency: "CNY", billingUnit: "image", tiers,
  checkedAt: at(day), confidence: "exact" });

describe("catalog price observations", () => {
  it("publishes a newly discovered model's exact price without a previous cache", () => {
    const result = reduce(connection([model()]), [observation(0, [model(price(.2))])]);
    expect(result.models[0]?.pricing?.unitAmount).toBe(.2);
    expect(result.changes).toMatchObject([{ kind: "price", modelId: "image-full-id", before: "—" }]);
  });
  it("does not mistake a manually declared model protocol for a manually saved quote", () => {
    const declared = { ...model(price(9)), metadata: { source: "manual" } };
    const result = reduce(connection([declared]), [observation(1, [model(price(.2, 1))])]);
    expect(result.models[0]?.pricing?.unitAmount).toBe(.2);
  });
  it("merges only disjoint equality branches and labels each retained sample", () => {
    const old = tiered([{ id: "2", label: "2K", dimension: "resolution", value: "2K", price: 1 }, { id: "4", label: "4K", dimension: "resolution", value: "4K", price: 2 }]);
    const next = tiered([{ id: "4", label: "4K", dimension: "resolution", value: "4K", price: 3 }], 1);
    const result = reduce(connection([model(old)]), [observation(1, [model(next)])]);
    expect(result.models[0]?.pricing?.tiers?.map(tier => [tier.price, tier.evidence?.status, tier.evidence?.checkedAt])).toEqual([[1, "retained", at(0)], [3, "published", at(1)]]);
    expect(selectModelQuote(result.models[0]!, { resolution: "2K" }).estimatePricing).toBeUndefined();
    expect(selectModelQuote(result.models[0]!, { resolution: "4K" }).amount).toBe(3);
  });
  it("never splices otherwise, intersecting, any, contains or mismatched unit/currency tariffs", () => {
    const a = tiered([{ id: "q", label: "q", price: 1, conditions: [{ parameter: "quality", operator: "equals", value: "high" }], conditionMode: "all" }]);
    for (const b of [tiered([{ id: "r", label: "r", price: 2, conditions: [{ parameter: "resolution", operator: "equals", value: "4K" }], conditionMode: "all" }]),
      tiered([{ id: "fallback", label: "fallback", price: 2, otherwise: true }]),
      { ...a, currency: "USD" }, { ...a, billingUnit: "second" as const },
      tiered([{ id: "any", label: "any", price: 1, conditions: [{ parameter: "quality", operator: "contains", value: "high" }], conditionMode: "any" }])])
      expect(canMergeDiscreteCatalogPrices(a, b)).toBe(false);
  });
  it("retains a whole ordered tariff after partial reading and never estimates it", () => {
    const old = tiered([{ id: "first", label: "first", price: 1, otherwise: true }]);
    const next = tiered([{ id: "new", label: "new", price: 10, otherwise: true }], 1);
    const result = reduce(connection([model(old)]), [observation(1, [model(next)], { complete: false })]);
    expect(result.models[0]?.pricing?.tiers?.[0]?.price).toBe(1);
    expect(selectModelQuote(result.models[0]!).estimatePricing).toBeUndefined();
    expect(result.changes).toEqual([]);
  });
  it("only clears after three independent complete explicit cycles separated by 24h", () => {
    let conn = connection([model(price(.1))]); let state: CatalogPriceState | undefined;
    for (const day of [0, 1, 2]) {
      const result = reduce(conn, [unpublished(day)], state); state = result.state;
      expect(result.models[0]?.pricing?.unitAmount).toBe(day === 2 ? undefined : .1);
      expect(result.changes).toHaveLength(day === 2 ? 1 : 0);
      conn = connection(result.models);
    }
    expect(Object.values(state!.entries)[0]?.history[0]?.pricing?.unitAmount).toBe(.1);
  });
  it("does not count repeated runs, close-together cycles, unknown or incomplete evidence", () => {
    let conn = connection([model(price(.1))]);
    const first = reduce(conn, [unpublished(0)]), state = first.state; conn = connection(first.models);
    const same = unpublished(0); same.receipt.context.dispatchSeq = 2;
    let result = reduce(conn, [same], state);
    expect(Object.values(result.state.entries)[0]?.unpublishedCycles).toBe(1);
    const soon = unpublished(1); soon.receipt.checkedAt = new Date(Date.parse(at(0)) + 3_600_000).toISOString();
    result = reduce(conn, [soon], result.state); expect(Object.values(result.state.entries)[0]?.unpublishedCycles).toBe(1);
    const unknown = observation(2, [], { complete: false, status: "failed" });
    result = reduce(conn, [unknown], result.state); expect(Object.values(result.state.entries)[0]?.unpublishedCycles).toBe(0);
    expect(result.models[0]?.pricing?.unitAmount).toBe(.1); expect(result.changes).toEqual([]);
  });
  it("does not turn a missing row or default unavailable label into explicit unpublished", () => {
    for (const models of [[], [{ ...model(), metadata: { priceLabel: "价格未公布" } }]]) {
      const result = reduce(connection([model(price(.1))]), [observation(3, models)]);
      expect(result.models[0]?.pricing?.unitAmount).toBe(.1);
      expect(Object.values(result.state.entries)[0]?.unpublishedCycles).toBe(0);
    }
  });
  it("keeps a never-priced model unpriced and preserves billed/manual evidence exactly", () => {
    const none = reduce(connection([model()]), [unpublished(0)]);
    expect(none.models[0]?.pricing).toBeUndefined(); expect(none.changes).toEqual([]);
    const measured = { requestId: "request", amount: .31, currency: "CNY", parameters: { quality: "max" }, checkedAt: at(0) };
    const measuredModel = { ...model(price(.31)), metadata: { priceSource: "generated-result", measuredPrice: measured } };
    const result = reduce(connection([measuredModel]), [observation(1, [model(price(.2, 1))])]);
    expect(result.models[0]?.pricing?.unitAmount).toBe(.2);
    expect(result.models[0]?.metadata?.measuredPrice).toEqual(measured);
    const manual = { ...model(price(9)), metadata: { priceSource: "manual" } };
    expect(reduce(connection([manual]), [observation(1, [model(price(.2, 1))])]).models[0]?.pricing).toEqual(manual.pricing);
  });
  it("rejects another group, another connection and an obsolete identity epoch", () => {
    for (const alter of [(row: CatalogReadObservation) => { row.receipt.spec.applyScope.groupIdentity = "site-id:2"; },
      (row: CatalogReadObservation) => { row.receipt.spec.authScope.kind = "connection-key"; row.receipt.spec.authScope.principalRef = "another"; },
      (row: CatalogReadObservation) => { row.receipt.context.identityEpoch = "old"; }]) {
      const row = observation(0, [model(price(100))]); alter(row);
      expect(reduce(connection([model(price(.1))]), [row]).models[0]?.pricing?.unitAmount).toBe(.1);
    }
  });
  it("withdraws only the explicitly covered disjoint condition after three cycles", () => {
    const old = tiered([{ id: "2", label: "2K", dimension: "resolution", value: "2K", price: 1 },
      { id: "4", label: "4K", dimension: "resolution", value: "4K", price: 2 }]);
    let conn = connection([model(old)]), state: CatalogPriceState | undefined;
    for (const day of [0, 1, 2]) {
      const row = observation(day, []);
      Object.assign(row.facts, { priceStates: [{ modelId: "image-full-id", state: "explicit-unpublished",
        conditions: [{ parameter: "resolution", operator: "equals", value: "4K" }] }] });
      const result = reduce(conn, [row], state); state = result.state; conn = connection(result.models);
      expect(result.models[0]?.pricing?.tiers?.map(tier => tier.price)).toEqual(day === 2 ? [1] : [1, 2]);
      expect(result.changes).toHaveLength(day === 2 ? 1 : 0);
    }
    expect(Object.values(state!.entries)[0]?.history.at(-1)?.pricing?.tiers?.[0]?.value).toBe("4K");
  });
  it("does not merge a new multiplier or FX dependency with old condition rates", () => {
    const old = tiered([{ id: "2", label: "2K", dimension: "resolution", value: "2K", price: 1 }]);
    const fresh = tiered([{ id: "4", label: "4K", dimension: "resolution", value: "4K", price: 2 }], 1);
    const original = { ...model(old), metadata: { tk1688FxRate: 7 } };
    const current = { ...model(fresh), metadata: { tk1688FxRate: 8 } };
    expect(reduce(connection([original]), [observation(1, [current])]).models[0]?.pricing?.tiers?.map(tier => tier.value)).toEqual(["4K"]);
  });
  it("preserves unparsed supplier prose without turning it into a numeric quote", () => {
    const result = reduce(connection([model()]), [observation(0, [{ ...model(), metadata: { priceLabel: "4K ¥2/张 · 高质量 ¥3/张" } }])]);
    expect(result.models[0]?.metadata?.priceLabel).toContain("¥2/张");
    expect(result.models[0]?.pricing).toBeUndefined();
    expect(selectModelQuote(result.models[0]!).estimatePricing).toBeUndefined();
    expect(result.changes).toHaveLength(1);
  });
  it("projects one exact whole-group public read across groups without borrowing a sibling quote", () => {
    const supplier: SupplierRecord = { id: "supplier", supplierKey: "fixture", name: "Fixture", siteUrl: "https://fixture.invalid",
      apiUrl: "https://fixture.invalid", kind: "newapi", scanStatus: "live", catalog: { groups: [] }, createdAt: at(0), updatedAt: at(0) };
    const first = { ...connection([model()]), config: { ...connection([]).config, supplierId: supplier.id, accountKeyGroupId: "1" } };
    const target = { ...connection([model()]), id: "target-key", config: { ...connection([model()]).config, supplierId: supplier.id, accountKeyGroupId: "2" } };
    const scopes = catalogConnectionScopes(first, supplier), row = observation(0, []);
    row.receipt.spec = catalogReadItem("pricing", "https://fixture.invalid/api/pricing", "price", scopes.anonymous, scopes.apply);
    row.facts.supplierGroups = [{ id: "one", supplierGroupId: "1", label: "One", source: "catalog", models: [{ id: "image-full-id", capability: "image", metadata: { officialCatalogPricing: price(1) } }] },
      { id: "two", supplierGroupId: "2", label: "Two", source: "catalog", models: [{ id: "image-full-id", capability: "image", metadata: { officialCatalogPricing: price(2) } }] }];
    const input = { connection: target, supplier, models: [model()], observations: [row], identityEpoch: "epoch", mode: "daily", observedAt: at(0) };
    expect(reduceCatalogPrices(undefined, input).models[0]?.pricing?.unitAmount).toBe(2);
    row.receipt.spec.authScope.credentialEpoch = "another-account-epoch";
    expect(reduceCatalogPrices(undefined, input).models[0]?.pricing).toBeUndefined();
    row.receipt.spec.authScope = scopes.account; row.receipt.spec.authScope.principalRef = "another-account";
    expect(reduceCatalogPrices(undefined, input).models[0]?.pricing).toBeUndefined();
  });
  it("joins delayed FX only to the same fresh marketplace cycle without another price read", () => {
    const conn = { ...connection([model()]), config: { ...connection([model()]).config, baseUrl: "https://api.tk1688.com" } };
    const scopes = catalogConnectionScopes(conn), raw = { ...price(.1), currency: "USD" };
    const market = observation(0, []);
    market.receipt.spec = catalogReadItem("tk1688-marketplace", "https://tk1688.com/api/marketplace/listings", "catalog-offer", scopes.anonymous, scopes.apply);
    market.facts.sourceFacts = { kind: "tk1688", value: { source: "marketplace", sourceUrl: "https://tk1688.com/api/marketplace/listings", checkedAt: at(0), complete: true,
      models: [{ ...model(), metadata: { tk1688Catalog: true, tk1688OriginalPricing: raw, tk1688OriginalPriceLabel: "$0.1/次" } }],
      catalogOffers: [{ modelId: "image-full-id", baseModelId: "image", active: true }], excludedModelIds: [] } };
    const first = reduceCatalogPrices(undefined, { connection: conn, models: [model()], observations: [market], identityEpoch: "epoch", mode: "daily", observedAt: at(0) });
    expect(first.models[0]?.pricing).toBeUndefined();
    const status = observation(0, []);
    status.receipt.spec = catalogReadItem("tk1688-status", "https://tk1688.com/api/status", "price", scopes.anonymous, scopes.apply);
    status.receipt.context.dispatchSeq = 2;
    status.facts.sourceFacts = { kind: "tk1688", value: { source: "status", sourceUrl: "https://tk1688.com/api/status", checkedAt: at(0), complete: true,
      paymentFxRateCnyPerUsd: 7, platformMarkupPercent: 10 } };
    const next = reduceCatalogPrices(first.state, { connection: conn, models: [model()], observations: [market, status], identityEpoch: "epoch", mode: "daily", observedAt: at(0) });
    expect(next.models[0]?.pricing).toMatchObject({ currency: "CNY", unitAmount: .7 });
    status.receipt.context.observationCycleId = "a-new-cycle";
    const isolated = reduceCatalogPrices(undefined, { connection: conn, models: [model()], observations: [market, status], identityEpoch: "epoch", mode: "daily", observedAt: at(1) });
    expect(isolated.models[0]?.pricing).toBeUndefined();
  });
  it("keeps sampling-only updates out of change records and never invents a zero quote", () => {
    expect(reduce(connection([model(price(.1))]), [observation(1, [model(price(.1, 1))])]).changes).toEqual([]);
    let conn = connection([model()]), state: CatalogPriceState | undefined;
    for (const day of [0, 1, 2]) {
      const result = reduce(conn, [unpublished(day)], state); state = result.state; conn = connection(result.models);
      expect(result.changes).toEqual([]); expect(result.models[0]?.pricing).toBeUndefined();
    }
    expect(reduce(connection([model()]), [observation(0, [model(price(0))])]).models[0]?.pricing?.unitAmount).toBe(0);
  });
  it("projects billing dependencies with the price rather than underquoting input-plus-output video", () => {
    const next = { ...model({ ...price(.3), kind: "per-second" as const }), metadata: { billingIncludesInputDuration: true } };
    const result = reduce(connection([model(price(.1))]), [observation(1, [next])]);
    expect(result.models[0]?.metadata?.billingIncludesInputDuration).toBe(true);
    expect(result.models[0]?.pricing?.evidence?.dependencies).toMatchObject({ billingIncludesInputDuration: true });
  });
  it("stores an explicit operation in its own slot and never lends it to the sibling operation", () => {
    const both: ModelDescriptor = { ...model(), operations: ["image.generate", "image.edit"] };
    const quote = { ...both, pricing: price(.1), metadata: { catalogPriceOperation: "image.generate" } };
    const result = reduce(connection([both]), [observation(0, [quote])]);
    expect(Object.values(result.state.entries)).toMatchObject([{ operation: "image.generate" }]);
    expect(Object.keys(result.state.entries)[0]).toContain("image.generate");
    expect(selectModelQuote(result.models[0]!, {}, { operation: "image.generate" }).amount).toBe(.1);
    expect(selectModelQuote(result.models[0]!, {}, { operation: "image.edit" }).amount).toBeUndefined();
    expect(selectModelQuote(result.models[0]!).amount).toBeUndefined();
    expect(modelPickerPriceData(result.models[0])).toContain("图片生成");
  });
  it("keeps same-ID generation/editing rows distinct and conservatively blocks ambiguous primary prices", () => {
    const both: ModelDescriptor = { ...model(), operations: ["image.generate", "image.edit"] };
    const rows = [{ ...both, pricing: price(.1), metadata: { catalogPriceOperation: "image.generate" } },
      { ...both, pricing: price(.2), metadata: { catalogPriceOperation: "image.edit" } }];
    const before = structuredClone(rows), result = reduce(connection([both]), [observation(0, rows)]);
    expect(Object.values(result.state.entries).map(entry => [entry.operation, entry.pricing?.unitAmount])).toEqual([["image.generate", .1], ["image.edit", .2]]);
    expect(result.models[0]?.metadata?.supplierPriceConflict).toBe(true); expect(result.models[0]?.pricing).toBeUndefined();
    for (const operation of both.operations) expect(selectModelQuote(result.models[0]!, {}, { operation }).amount).toBeUndefined();
    expect(rows).toEqual(before);
  });
  it("does not overwrite a previous operation slot or accept duplicate conflicting frameworks", () => {
    const both: ModelDescriptor = { ...model(), operations: ["image.generate", "image.edit"] };
    const first = reduce(connection([both]), [observation(0, [{ ...both, pricing: price(.1), metadata: { catalogPriceOperation: "image.generate" } }])]);
    const second = reduce(connection(first.models), [observation(1, [{ ...both, pricing: price(.2, 1), metadata: { catalogPriceOperation: "image.edit" } }])], first.state);
    expect(Object.values(second.state.entries).map(entry => entry.operation).sort()).toEqual(["image.edit", "image.generate"]);
    expect(second.models[0]?.metadata?.supplierPriceConflict).toBe(true);
    const duplicate = reduce(connection([both]), [observation(0, [{ ...both, pricing: price(.1), metadata: { catalogPriceOperation: "image.generate" } },
      { ...both, pricing: { ...price(.2), currency: "USD" }, metadata: { catalogPriceOperation: "image.generate" } }])]);
    expect(Object.values(duplicate.state.entries)[0]?.conflict).toBe(true);
    expect(duplicate.models[0]?.pricing).toBeUndefined();
  });
});

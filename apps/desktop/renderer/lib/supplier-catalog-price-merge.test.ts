import { describe, expect, it } from "vitest";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { catalogChanges } from "./supplier-catalog-policy";
import { catalogHasPrice, mergeCatalogSnapshotPrices } from "./supplier-catalog-price-merge";
import { modelPickerPriceData } from "./model-picker-data";

const oldAt = "2026-10-11T02:03:04Z", now = "2026-10-17T04:00:00Z";
const priced = (id = "full/id") => ({ id, name: id, operations: ["image.generate"],
  pricing: { currency: "CNY", kind: "per-image", billingUnit: "image", checkedAt: oldAt,
    tiers: [{ dimension: "resolution", value: "4K", price: 0.1, conditions: [{ parameter: "quality", operator: "eq", value: "high" }] }] },
  metadata: { priceLabel: "¥0.1/张 · 4K high", priceSource: "supplier-catalog", priceCheckedAt: oldAt, supplierPriceGroupId: "7" } });
const connection = (values: unknown[], config: Record<string, unknown> = {}): ProviderConnectionRecord => ({ id: "key", name: "Fixture", provider: "rest", encryptedSecret: "opaque",
  createdAt: oldAt, updatedAt: oldAt, config: { accountKeyGroup: "Group", accountKeyGroupId: "7", modelCatalogModels: values, ...config } as ProviderConnectionRecord["config"] });
const supplier = (): SupplierRecord => ({ id: "supplier", name: "Fixture", supplierKey: "fixture", kind: "newapi", siteUrl: "https://fixture.invalid", apiUrl: "https://fixture.invalid/v1",
  createdAt: oldAt, updatedAt: oldAt, scannedAt: oldAt, scanStatus: "live", scanComplete: true,
  catalog: { groups: [{ id: "Group", supplierGroupId: "7", label: "Group", models: [{ id: "full/id", capability: "image", priceLabel: "¥0.1/张 · 4K high",
    metadata: { ...priced().metadata, officialCatalogPricing: priced().pricing } }] }] } });

describe("automatic catalog per-model price merge", () => {
  it("retains the exact old tariff and sample while accepting new model facts, without mutating snapshots", () => {
    const previous = connection([priced()]), next = connection([{ id: "full/id", name: "New name", operations: ["image.generate"], parameters: [{ key: "quality", default: "max" }] }]);
    const original = structuredClone(previous), staged = structuredClone(next);
    const result = mergeCatalogSnapshotPrices(previous, next, undefined, undefined, now), model = (result.connection.config.modelCatalogModels as unknown as ReturnType<typeof priced>[])[0]!;
    expect(model.pricing).toEqual(priced().pricing);
    expect(model.metadata).toMatchObject({ priceStatus: "partial", priceCheckedAt: oldAt, priceLastAttemptAt: now, priceLabel: "¥0.1/张 · 4K high（上次价格）" });
    expect(model).toMatchObject({ name: "New name", parameters: [{ key: "quality", default: "max" }] });
    expect(result.retainedPriceModelCount).toBe(1);
    expect(previous).toEqual(original); expect(next).toEqual(staged);
    expect(catalogChanges(previous, result.connection).map(change => change.kind)).toEqual(["model-changed"]);
  });
  it("unknown new models remain unpriced and are not filled from a similar full model ID", () => {
    const result = mergeCatalogSnapshotPrices(connection([priced()]), connection([{ id: "full/id-new", operations: [] }]), undefined, undefined, now);
    expect(result.retainedPriceModelCount).toBe(0);
    expect(modelPickerPriceData((result.connection.config.modelCatalogModels as never[])[0])).toBe("—");
    expect(catalogChanges(connection([priced()]), result.connection).map(change => change.kind)).toEqual(["model-added", "model-removed"]);
  });
  it("zero rates are valid fresh prices, and actual rate changes are recorded", () => {
    const next = priced(); next.pricing.tiers[0]!.price = 0; next.pricing.checkedAt = now;
    const previous = connection([priced()]);
    const result = mergeCatalogSnapshotPrices(previous, connection([next]), undefined, undefined, now);
    expect(result.retainedPriceModelCount).toBe(0);
    expect(catalogHasPrice(next, true)).toBe(true);
    expect(catalogChanges(previous, result.connection)).toEqual([expect.objectContaining({ kind: "price", modelId: "full/id" })]);
  });
  it("partial failed price enrichment cannot label an old tariff as fresh", () => {
    const next = priced(); Object.assign(next.metadata, { priceStatus: "partial", priceCheckedAt: now });
    const result = mergeCatalogSnapshotPrices(connection([priced()]), connection([next]), undefined, undefined, now);
    expect(result.retainedPriceModelCount).toBe(1);
    expect(result.connection.config.modelCatalogModels).toMatchObject([{ metadata: { priceCheckedAt: oldAt, priceStatus: "partial" } }]);
  });
  it("retains label-only quotes and repeated retention never advances the sample or duplicates suffixes", () => {
    const old = { id: "full/id", operations: [], metadata: { priceLabel: "¥3/请求", priceCheckedAt: oldAt } };
    const first = mergeCatalogSnapshotPrices(connection([old]), connection([{ id: "full/id", operations: [] }]), undefined, undefined, now);
    const second = mergeCatalogSnapshotPrices(first.connection, connection([{ id: "full/id", operations: [] }]), undefined, undefined, "2026-10-18T00:00:00Z");
    expect(second.connection.config.modelCatalogModels).toMatchObject([{ metadata: { priceLabel: "¥3/请求（上次价格）", priceCheckedAt: oldAt } }]);
    expect(catalogChanges(first.connection, second.connection)).toEqual([]);
  });
  it("never borrows explicit price ownership from another stable group", () => {
    const old = priced(); old.metadata.supplierPriceGroupId = "8";
    const result = mergeCatalogSnapshotPrices(connection([old]), connection([{ id: "full/id", operations: [] }]), undefined, undefined, now);
    expect(result.retainedPriceModelCount).toBe(0);
    expect(result.connection.config.modelCatalogModels).toEqual([{ id: "full/id", operations: [] }]);
  });
  it("does not transplant rates to new conditions: a valid fresh tariff replaces the whole advertised tariff", () => {
    const next = priced(); next.pricing.tiers[0]!.conditions[0]!.value = "max"; next.pricing.tiers[0]!.value = "2K";
    const result = mergeCatalogSnapshotPrices(connection([priced()]), connection([next]), undefined, undefined, now);
    expect(result.retainedPriceModelCount).toBe(0);
    expect(result.connection.config.modelCatalogModels).toMatchObject([{ pricing: { tiers: [{ value: "2K", conditions: [{ value: "max" }] }] } }]);
    expect(JSON.stringify(result.connection.config.modelCatalogModels)).not.toContain('"value":"4K"');
  });
  it("generated-result evidence and exact measured parameters survive a valid new advertised rate untouched", () => {
    const old = { ...priced(), metadata: { ...priced().metadata, priceSource: "generated-result", priceLabel: "¥0.23/请求",
      measuredPrice: { amount: 0.23, checkedAt: oldAt, parameters: { resolution: "4K", quality: "high", n: 1 } } } };
    const next = priced(); next.pricing.tiers[0]!.price = 0.05;
    const previous = connection([old]), result = mergeCatalogSnapshotPrices(previous, connection([next]), undefined, undefined, now);
    expect(result.connection.config.modelCatalogModels).toEqual([old]);
    expect(result.retainedPriceModelCount).toBe(0);
    expect(catalogChanges(previous, result.connection)).toEqual([]);
  });
  it.each(["connector", "modelProtocolTemplate"])("preserves %s-only measured evidence without mixing it with the primary advertised quote", measuredCache => {
    const measured = { ...priced(), metadata: { ...priced().metadata, priceSource: "generated-result", priceLabel: "¥0.23/请求",
      measuredPrice: { amount: 0.23, checkedAt: oldAt, parameters: { resolution: "4K", quality: "high", n: 1 } } } };
    const current = priced(); current.pricing.tiers[0]!.price = 0.2; current.pricing.checkedAt = now; current.metadata.priceCheckedAt = now;
    const otherCache = measuredCache === "connector" ? "modelProtocolTemplate" : "connector";
    const before = connection([priced()], { [measuredCache]: { models: [measured] }, [otherCache]: { models: [priced()] } });
    const next = connection([current], { [measuredCache]: { models: [{ ...current, name: "New contract name" }] }, [otherCache]: { models: [current] } });
    const result = mergeCatalogSnapshotPrices(before, next, undefined, undefined, now);
    expect(result.connection.config.modelCatalogModels).toEqual([current]);
    expect(result.connection.config[measuredCache]).toMatchObject({ models: [{ ...measured, name: "New contract name" }] });
    expect(result.connection.config[otherCache]).toMatchObject({ models: [current] });
    expect(JSON.stringify(result.connection.config.modelCatalogModels)).not.toContain("measuredPrice");
    expect(JSON.stringify(result.connection.config[otherCache])).not.toContain("measuredPrice");
    expect(result.retainedPriceModelCount).toBe(0);
    expect(catalogChanges(before, result.connection)).toEqual([expect.objectContaining({ kind: "price", modelId: "full/id" })]);
  });
  it("keeps distinct measured conditions in each cache and does not count them as conflicting advertised prices", () => {
    const charge = (resolution: string, amount: number) => ({ ...priced(), metadata: { ...priced().metadata, priceSource: "generated-result", priceLabel: `¥${amount}/请求`,
      measuredPrice: { amount, checkedAt: oldAt, parameters: { resolution, quality: "high", n: 1 } } } });
    const primary = charge("4K", 0.3), connector = charge("2K", 0.2), template = charge("1K", 0.1);
    const before = connection([primary], { connector: { models: [connector] }, modelProtocolTemplate: { models: [template] } });
    const after = connection([priced()], { connector: { models: [priced()] }, modelProtocolTemplate: { models: [priced()] } });
    const result = mergeCatalogSnapshotPrices(before, after, undefined, undefined, now);
    expect(result.connection.config.modelCatalogModels).toEqual([primary]);
    expect(result.connection.config.connector).toEqual({ models: [connector] });
    expect(result.connection.config.modelProtocolTemplate).toEqual({ models: [template] });
    expect(result.retainedPriceModelCount).toBe(0);
  });
  it("synchronizes primary, connector and protocol-template prices without copying unrelated metadata", () => {
    const old = connection([priced()], { connector: { models: [priced()] }, modelProtocolTemplate: { models: [priced()] } });
    const unpriced = { id: "full/id", operations: [], metadata: { newInterface: true } };
    const next = connection([unpriced], { connector: { models: [{ ...unpriced, name: "Connector" }] }, modelProtocolTemplate: { models: [{ ...unpriced, name: "Template" }] } });
    const result = mergeCatalogSnapshotPrices(old, next, undefined, undefined, now);
    expect(result.retainedPriceModelCount).toBe(1);
    for (const key of ["connector", "modelProtocolTemplate"]) expect(result.connection.config[key]).toMatchObject({ models: [{ pricing: priced().pricing,
      metadata: { priceStatus: "partial", priceCheckedAt: oldAt, newInterface: true } }] });
  });
  it("uses a valid new connector quote before considering fallback, and synchronizes all caches", () => {
    const current = priced(); current.pricing.tiers[0]!.price = 0.25; current.pricing.checkedAt = now; current.metadata.priceCheckedAt = now;
    const previous = connection([priced()], { connector: { models: [priced()] }, modelProtocolTemplate: { models: [priced()] } });
    const next = connection([{ id: "full/id", operations: [] }], { connector: { models: [current] }, modelProtocolTemplate: { models: [priced()] } });
    const result = mergeCatalogSnapshotPrices(previous, next, undefined, undefined, now);
    expect(result.retainedPriceModelCount).toBe(0);
    expect(result.connection.config.modelCatalogModels).toMatchObject([{ pricing: current.pricing }]);
    for (const key of ["connector", "modelProtocolTemplate"]) expect(result.connection.config[key]).toMatchObject({ models: [{ pricing: current.pricing }] });
  });
  it("conflicting current cache quotes do not choose one arbitrarily", () => {
    const first = priced(), second = priced(); first.pricing.tiers[0]!.price = 0.2; second.pricing.tiers[0]!.price = 0.3;
    const previous = connection([priced()]);
    const next = connection([{ id: "full/id", operations: [] }], { connector: { models: [first] }, modelProtocolTemplate: { models: [second] } });
    const result = mergeCatalogSnapshotPrices(previous, next, undefined, undefined, now);
    expect(result.retainedPriceModelCount).toBe(1);
    expect(result.connection.config.modelCatalogModels).toMatchObject([{ pricing: priced().pricing, metadata: { priceStatus: "partial" } }]);
    expect(catalogChanges(previous, result.connection).some(change => change.kind === "price")).toBe(false);
  });
  it("retains the original marketplace FX evidence with a historical USD tariff", () => {
    const old = { id: "fixture@merchant", operations: [], pricing: { currency: "USD", billingUnit: "image", kind: "per-image", unitAmount: 0.1, checkedAt: oldAt },
      metadata: { tk1688Catalog: true, tk1688FxRate: 7, tk1688FxRateCheckedAt: oldAt, priceLabel: "$0.1/张", priceCheckedAt: oldAt } };
    const next = { id: old.id, operations: [], metadata: { tk1688Catalog: true, tk1688FxRate: 8, tk1688FxRateCheckedAt: now } };
    const result = mergeCatalogSnapshotPrices(connection([old]), connection([next]), undefined, undefined, now);
    expect(result.connection.config.modelCatalogModels).toMatchObject([{ metadata: { tk1688FxRate: 7, tk1688FxRateCheckedAt: oldAt } }]);
    expect(modelPickerPriceData((result.connection.config.modelCatalogModels as never[])[0])).toContain("0.7 CNY");
    expect(catalogChanges(connection([old]), result.connection)).toEqual([]);
  });
  it("uses stable supplier groups across a display rename and does not resurrect removed models", () => {
    const previous = supplier(), next = supplier();
    next.catalog.groups[0] = { id: "Renamed", supplierGroupId: "7", label: "Renamed", models: [{ id: "full/id", capability: "image" }, { id: "new/id", capability: "image" }] };
    const result = mergeCatalogSnapshotPrices(connection([]), connection([]), previous, next, now);
    expect(result.supplier?.catalog.groups[0]?.models).toMatchObject([{ id: "full/id", priceLabel: "¥0.1/张 · 4K high（上次价格）", metadata: { priceStatus: "partial", priceCheckedAt: oldAt } }, { id: "new/id" }]);
    expect(catalogChanges(connection([]), connection([]), previous, result.supplier).some(change => change.kind === "price")).toBe(false);
    next.catalog.groups[0]!.models = [];
    expect(mergeCatalogSnapshotPrices(connection([]), connection([]), previous, next, now).supplier?.catalog.groups[0]?.models).toEqual([]);
  });
  it("a same-ID model in a different supplier group gets no old quote", () => {
    const previous = supplier(), next = supplier();
    next.catalog.groups[0] = { id: "Different", supplierGroupId: "8", label: "Different", models: [{ id: "full/id", capability: "image" }] };
    const result = mergeCatalogSnapshotPrices(connection([]), connection([]), previous, next, now);
    expect(result.supplier?.catalog.groups[0]?.models[0]).toEqual({ id: "full/id", capability: "image" });
  });
  it.each(["name-to-official", "official-to-name"])("keeps numeric group names separate from official IDs: %s", direction => {
    const previous = supplier(), next = supplier();
    const named = { id: "7", label: "Named 7", models: [{ id: "full/id", capability: "image" as const, priceLabel: "¥0.7/张", metadata: { priceCheckedAt: oldAt } }] };
    const official = { id: "Different", supplierGroupId: "7", label: "Official 7", models: [{ id: "full/id", capability: "image" as const }] };
    previous.catalog.groups = [direction === "name-to-official" ? named : { ...official, models: named.models }];
    next.catalog.groups = [direction === "name-to-official" ? official : { ...named, models: official.models }];
    const result = mergeCatalogSnapshotPrices(connection([]), connection([]), previous, next, now);
    expect(result.supplier?.catalog.groups[0]?.models[0]).toEqual({ id: "full/id", capability: "image" });
    expect(catalogChanges(connection([]), connection([]), previous, result.supplier).map(change => change.kind)).toEqual(["group-added", "group-removed"]);
  });
  it("retains quotes for the exact same unnumbered group key even when the key looks numeric", () => {
    const previous = supplier(), next = supplier();
    previous.catalog.groups = [{ id: "7", label: "Group 7", models: [{ id: "full/id", capability: "image", priceLabel: "¥0.7/张", metadata: { priceCheckedAt: oldAt } }] }];
    next.catalog.groups = [{ id: "7", label: "Group 7", models: [{ id: "full/id", capability: "image" }] }];
    const result = mergeCatalogSnapshotPrices(connection([]), connection([]), previous, next, now);
    expect(result.supplier?.catalog.groups[0]?.models[0]).toMatchObject({ priceLabel: "¥0.7/张（上次价格）", metadata: { priceStatus: "partial", priceCheckedAt: oldAt } });
    expect(catalogChanges(connection([]), connection([]), previous, result.supplier)).toEqual([]);
  });
  it("supplier ledger observations remain separate from advertised prices", () => {
    const previous = supplier(), next = supplier();
    const ledger = { amount: 0.2, currency: "CNY", unit: "image" as const, checkedAt: oldAt, observedAt: oldAt, sourceUrl: "https://fixture.invalid/log", supplierGroupId: "7", modelId: "full/id", resolution: "4K", parameters: { n: 1, resolution: "4K" }, sample: true as const, billingMode: "observed" };
    previous.catalog.groups[0]!.details = { source: "key-groups", ledgerPrices: [ledger] };
    const result = mergeCatalogSnapshotPrices(connection([]), connection([]), previous, next, now);
    expect(result.supplier?.catalog.groups[0]?.details?.ledgerPrices).toEqual([ledger]);
  });
  it("does not persist missing old group quotes where they could price a brand new model", () => {
    const previous = supplier(), next = supplier();
    previous.catalog.groups[0]!.details = { source: "key-groups", referencePrice: "¥0.1/张", imagePrices: [{ resolution: "4K", amount: 0.1 }], rateMultiplier: 2 };
    next.catalog.groups[0]!.models.push({ id: "new/id", capability: "image" });
    const result = mergeCatalogSnapshotPrices(connection([]), connection([]), previous, next, now);
    expect(result.supplier?.catalog.groups[0]?.details?.referencePrice).toBeUndefined();
    expect(result.supplier?.catalog.groups[0]?.details?.imagePrices).toBeUndefined();
    expect(catalogChanges(connection([]), connection([]), previous, result.supplier)).toEqual([expect.objectContaining({ kind: "model-added", modelId: "new/id" })]);
  });
  it("does not relabel a failed attempt time as the old quote sample", () => {
    const old = { id: "full/id", operations: [], metadata: { priceLabel: "¥0.1/张" } };
    const result = mergeCatalogSnapshotPrices(connection([old], { modelScanStatus: "failed", modelScanCheckedAt: oldAt }),
      connection([{ id: "full/id", operations: [] }]), undefined, undefined, now);
    expect(result.connection.config.modelCatalogModels).toMatchObject([{ metadata: { priceStatus: "partial", priceLastAttemptAt: now } }]);
    expect((result.connection.config.modelCatalogModels as unknown as Array<{ metadata: Record<string, unknown> }>)[0]!.metadata.priceCheckedAt).toBeUndefined();
  });
  it("ambiguous duplicate cached identities and explicit conflicting prices are not reused", () => {
    const conflicting = priced(); Object.assign(conflicting.metadata, { supplierPriceConflict: true });
    const result = mergeCatalogSnapshotPrices(connection([priced(), priced(), priced(), { ...conflicting, id: "conflict/id" }]),
      connection([{ id: "full/id", operations: [] }, { id: "conflict/id", operations: [] }]), undefined, undefined, now);
    expect(result.retainedPriceModelCount).toBe(0);
    expect(result.connection.config.modelCatalogModels).toEqual([{ id: "full/id", operations: [] }, { id: "conflict/id", operations: [] }]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { getRepository, MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import { SupplierCatalogUpgrade, SUPPLIER_CATALOG_REVISION, supportedCatalogConnection } from "./supplier-catalog-upgrade";
import { CATALOG_CHECK_INTERVAL_MS, CATALOG_MODE_SETTING, catalogChanges, catalogPricesComplete, clearCatalogManualMarker } from "./supplier-catalog-policy";
import { scopedCatalogRepository, withCatalogRepository } from "./catalog-repository-scope";

const model = (id = "full-model-id", priceLabel = "¥0.10/张 · 4K / high") => ({ id, operations: ["image.generate"], metadata: { priceLabel } });
async function fixture() {
  const repository = new MemoryRepository();
  const save = (id = "active", config: Record<string, unknown> = {}, provider = "openai") => repository.saveConnection({ id, name: id, provider,
    encryptedSecret: "opaque-unit-key", config: { baseUrl: "https://api.tk1688.com/v1", usage: "canvas", modelGroup: "default", defaultModel: "full-model-id",
      modelCatalogModels: [model()], ...config } });
  let now = Date.parse("2026-10-16T04:00:00Z");
  const refreshCatalog = vi.fn(async (connection: ProviderConnectionRecord, _supplier: SupplierRecord | undefined, staging: MemoryRepository) => {
    const current = (await staging.getConnection(connection.id))!;
    await staging.saveConnection({ ...current, config: { ...current.config, modelCatalogModels: [model("full-model-id", "¥0.12/张 · 4K / high")], modelScanStatus: "live", modelScanComplete: true } });
    return { complete: true } as { complete: boolean; status?: number; code?: string };
  });
  const service = new SupplierCatalogUpgrade({ repository, refreshCatalog, now: () => now });
  return { repository, save, refreshCatalog, service, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe("supplier automatic catalog policy", () => {
  it("defaults daily, reserves the period before network and never duplicates a cycle", async () => {
    const f = await fixture(); await f.save();
    f.refreshCatalog.mockImplementationOnce(async connection => {
      expect((await f.repository.getConnection(connection.id))?.config.catalogCheckAttemptedAt).toBe(new Date(f.now()).toISOString());
      return { complete: false, code: "network" };
    });
    f.service.start(); f.service.start(); await f.service.settle();
    f.service.start(); await f.service.settle();
    expect(f.refreshCatalog).toHaveBeenCalledTimes(1);
    expect(await f.service.status()).toMatchObject({ mode: "daily", manualConnectionIds: ["active"] });
    f.advance(CATALOG_CHECK_INTERVAL_MS - 1); f.service.start(); await f.service.settle();
    expect(f.refreshCatalog).toHaveBeenCalledTimes(1);
    f.advance(1); f.service.start(); await f.service.settle();
    expect(f.refreshCatalog).toHaveBeenCalledTimes(2);
  });
  it.each([true, false])("upgrade tries once even after %s success/failure, restart or Key change", async complete => {
    const f = await fixture(); await f.save(); await f.service.setMode("upgrade");
    f.refreshCatalog.mockImplementation(async () => ({ complete, code: "network" }));
    f.service.start(); await f.service.settle();
    f.advance(7 * CATALOG_CHECK_INTERVAL_MS);
    const saved = (await f.repository.getConnection("active"))!;
    await f.repository.saveConnection({ ...saved, encryptedSecret: "changed-unit-key", config: { ...saved.config, modelGroup: "edited" } });
    const restarted = new SupplierCatalogUpgrade({ repository: f.repository, refreshCatalog: f.refreshCatalog, now: f.now });
    restarted.start(); await restarted.settle();
    expect(f.refreshCatalog).toHaveBeenCalledTimes(1);
  });
  it("new catalog revision creates one upgrade attempt", async () => {
    const f = await fixture(); await f.save("active", { catalogCheckAttemptRevision: "old-rules", catalogCheckAttemptedAt: new Date(f.now()).toISOString() });
    await f.service.setMode("upgrade"); f.service.start(); await f.service.settle();
    expect(f.refreshCatalog).toHaveBeenCalledTimes(1);
    expect((await f.repository.getConnection("active"))?.config.catalogCheckAttemptRevision).toBe(SUPPLIER_CATALOG_REVISION);
  });
  it.each(["authentication", "insufficient_balance", "unsupported_platform"])("pauses after three consecutive %s failures", async code => {
    const f = await fixture(); await f.save(); f.refreshCatalog.mockImplementation(async () => ({ complete: false, code }));
    for (let cycle = 0; cycle < 4; cycle++) { f.service.start(); await f.service.settle(); f.advance(CATALOG_CHECK_INTERVAL_MS); }
    expect(f.refreshCatalog).toHaveBeenCalledTimes(3);
    expect(await f.service.status()).toMatchObject({ manualConnectionIds: ["active"], nextCheckAt: null, connections: [expect.objectContaining({ paused: true })] });
  });
  it.each(["network", "directory_unavailable"])("temporary %s errors keep retrying next day and reset terminal streak", async code => {
    const f = await fixture(); await f.save("active", { catalogCheckFailureStreak: 2 });
    f.refreshCatalog.mockImplementation(async () => ({ complete: false, code }));
    for (let cycle = 0; cycle < 4; cycle++) { f.service.start(); await f.service.settle(); f.advance(CATALOG_CHECK_INTERVAL_MS); }
    expect(f.refreshCatalog).toHaveBeenCalledTimes(4);
    expect((await f.repository.getConnection("active"))?.config).toMatchObject({ catalogCheckPaused: false, catalogCheckFailureStreak: 0 });
  });
  it("off and GET status dispatch zero requests; pending connections can refresh manually", async () => {
    const f = await fixture(); await f.save(); await f.service.setMode("off");
    f.service.start(); await f.service.settle();
    expect(await f.service.status()).toMatchObject({ mode: "off", nextCheckAt: null, manualConnectionIds: ["active"] });
    expect(f.refreshCatalog).not.toHaveBeenCalled();
    expect(f.repository.exportSnapshot().applicationSettings?.[CATALOG_MODE_SETTING]).toBe("off");
  });
  it("stops after switching off during an in-flight read without publishing staged prices", async () => {
    const f = await fixture(); const original = await f.save(); await f.save("second");
    f.refreshCatalog.mockImplementation(async (_row, _supplier, staging) => {
      const row = (await staging.getConnection("active"))!;
      await staging.saveConnection({ ...row, config: { ...row.config, modelCatalogModels: [model("new")] } });
      await f.service.setMode("off"); return { complete: true };
    });
    f.service.start(); await f.service.settle();
    expect(f.refreshCatalog).toHaveBeenCalledTimes(1);
    expect((await f.repository.getConnection("active"))?.config.modelCatalogModels).toEqual(original.config.modelCatalogModels);
  });
  it.each(["missing-price", "partial", "throw"])("%s preserves old directory, parameters, price and supplier state", async failure => {
    const f = await fixture(); const original = await f.save();
    f.refreshCatalog.mockImplementation(async (row, _supplier, staging) => {
      await staging.saveConnection({ ...row, config: { ...row.config, modelCatalogModels: [{ id: "new", operations: [] }], connector: { changed: true } } });
      if (failure === "throw") throw new Error("network");
      return { complete: failure === "missing-price", code: "incomplete" };
    });
    f.service.start(); await f.service.settle();
    const actual = (await f.repository.getConnection("active"))!;
    expect(actual.config.modelCatalogModels).toEqual(original.config.modelCatalogModels);
    expect(actual.config.connector).toBeUndefined();
    expect(actual.encryptedSecret).toBe(original.encryptedSecret);
    expect(actual.config.catalogCheckManualRequired).toBe(true);
  });
  it("concurrent user changes reject the complete staged snapshot", async () => {
    const f = await fixture(); await f.save();
    f.refreshCatalog.mockImplementation(async row => {
      await f.repository.saveConnection({ ...row, config: { ...row.config, userChoice: "newer" } }); return { complete: true };
    });
    f.service.start(); await f.service.settle();
    expect((await f.repository.getConnection("active"))?.config).toMatchObject({ userChoice: "newer" });
    expect((await f.repository.getConnection("active"))?.config.catalogCheckFailureReason).toBeUndefined();
  });
  it("records complete full-ID price changes, no secrets, and retains at least thirty days", async () => {
    const f = await fixture(); await f.save(); f.service.start(); await f.service.settle();
    const status = await f.service.status();
    expect(status.changedConnectionIds).toEqual(["active"]);
    expect(status.noticeId).toBeTruthy();
    expect(status.history[0]?.changes).toEqual([{ kind: "price", modelId: "full-model-id", groupId: undefined, before: "¥0.10/张 · 4K / high", after: "¥0.12/张 · 4K / high" }]);
    expect(JSON.stringify(status)).not.toContain("opaque-unit-key");
    f.advance(30 * CATALOG_CHECK_INTERVAL_MS); expect((await f.service.status()).history).toHaveLength(1);
    f.advance(1); expect((await f.service.status()).history).toHaveLength(0);
    expect((await f.service.status(true)).history).toEqual([]);
  });
  it("sample time only is quiet, and manual success clears failure/pause markers", async () => {
    const f = await fixture(); await f.save("active", { catalogCheckPaused: true, catalogCheckManualRequired: true, catalogCheckFailureStreak: 3 });
    const saved = (await f.repository.getConnection("active"))!;
    await f.repository.saveConnection({ ...saved, config: clearCatalogManualMarker(saved.config) });
    f.refreshCatalog.mockImplementation(async (row, _supplier, staging) => {
      await staging.saveConnection({ ...row, config: { ...row.config, modelCatalogModels: [{ ...model(), metadata: { ...model().metadata, priceCheckedAt: "new-time" } }] } }); return { complete: true };
    });
    f.service.start(); await f.service.settle();
    expect(await f.service.status()).toMatchObject({ manualConnectionIds: [], changedConnectionIds: [], history: [], noticeId: null });
  });
  it("same network failure on later days stays quiet; legacy groups count one supplier", async () => {
    const f = await fixture(); await f.save(); await f.save("other-group", { modelGroup: "other" });
    f.service.start(); await f.service.settle();
    expect((await f.service.status()).priceChangedSupplierIds).toHaveLength(1);
    f.advance(CATALOG_CHECK_INTERVAL_MS); f.refreshCatalog.mockImplementation(async () => ({ complete: false, code: "network" }));
    f.service.start(); await f.service.settle(); expect((await f.service.status()).noticeId).toBeTruthy();
    f.advance(CATALOG_CHECK_INTERVAL_MS); f.service.start(); await f.service.settle();
    expect((await f.service.status()).noticeId).toBeNull();
  });
  it("staged Key creation or sibling routing migrations are rejected, never published", async () => {
    const f = await fixture(), original = await f.save();
    f.refreshCatalog.mockImplementation(async (_row, _supplier, staging) => {
      await staging.saveConnection({ ...original, id: "extra-key" }); return { complete: true };
    });
    f.service.start(); await f.service.settle();
    expect(await f.repository.getConnection("extra-key")).toBeNull();
    expect((await f.repository.getConnection("active"))?.config.modelCatalogModels).toEqual(original.config.modelCatalogModels);
    expect((await f.repository.getConnection("active"))?.config.catalogCheckFailureReason).toBe("conflict");
  });
  it("only documented active current-source HTTPS connections are supported", async () => {
    const f = await fixture(); await f.save(); await f.save("cli", {}, "cli"); await f.save("fake", {}, "fake");
    await f.save("off", { usage: "disabled" });
    const active = (await f.repository.getConnection("active"))!;
    expect(supportedCatalogConnection({ ...active, config: { ...active.config, supplierArchived: true } })).toBe(false);
    await f.save("spoof", { baseUrl: "https://api.tk1688.com.evil.example/v1" }); await f.save("arbitrary", { baseUrl: "https://custom.example/v1" });
    await f.save("old-source", { supplierId: "deleted", supplierSourceId: "old" });
    f.service.start(); await f.service.settle(); expect(f.refreshCatalog).toHaveBeenCalledTimes(1);
  });
});

describe("catalog snapshot and diff invariants", () => {
  it("AsyncLocalStorage staging is isolated from concurrent foreground callers", async () => {
    const live = new MemoryRepository(), stage = new MemoryRepository(), proxy = scopedCatalogRepository(live);
    await Promise.all([withCatalogRepository(stage, async () => { expect(getRepository()).toBe(stage); await proxy.setApplicationSetting("scope", "staged"); expect(await proxy.getApplicationSetting("scope")).toBe("staged"); }),
      proxy.setApplicationSetting("scope", "foreground")]);
    expect(await live.getApplicationSetting("scope")).toBe("foreground"); expect(await stage.getApplicationSetting("scope")).toBe("staged");
  });
  it("atomic commit validates every source row before changing any record", async () => {
    const f = await fixture(), first = await f.save("first"), second = await f.save("second");
    await f.repository.saveConnection({ ...second, name: "edited" });
    await expect(f.repository.commitCatalogSnapshot({ expectedConnections: [first, second], connections: [{ ...first, name: "must-not-write" }] })).rejects.toThrow();
    expect((await f.repository.getConnection("first"))?.name).toBe("first");
  });
  it("zero price is valid; missing price and stale groups are incomplete", async () => {
    const f = await fixture(), row = await f.save();
    expect(catalogPricesComplete(undefined, { ...row, config: { modelCatalogModels: [{ id: "zero", pricing: { unitAmount: 0, unit: "image", currency: "CNY" } }] } })).toBe(true);
    expect(catalogPricesComplete(undefined, { ...row, config: { modelCatalogModels: [{ id: "missing" }] } })).toBe(false);
  });
  it("identifies added/removed full IDs without changes from timestamps/key order", async () => {
    const f = await fixture(), row = await f.save();
    const next = { ...row, config: { modelCatalogModels: [model("brand/new-full-id")] } };
    expect(catalogChanges(row, next).map(change => [change.kind, change.modelId])).toEqual([["model-added", "brand/new-full-id"], ["model-removed", "full-model-id"]]);
  });
  it("same-ID declared name, operations, parameters and asset limits produce model-changed without inventing a price change", async () => {
    const f = await fixture(), row = await f.save();
    const original = { ...model(), name: "原名称", inputKinds: ["text"], outputKinds: ["image"], limits: { maxInputImages: 1 },
      parameters: [{ key: "resolution", label: "分辨率", control: "select", default: "2K", options: [{ value: "2K", label: "2K" }] }] };
    const current = { ...structuredClone(original), name: "供应商新名称", operations: ["image.generate", "image.edit"], inputKinds: ["text", "image"],
      limits: { maxInputImages: 4 }, parameters: [{ key: "resolution", label: "分辨率", control: "select", default: "4K", options: [{ value: "2K", label: "2K" }, { value: "4K", label: "4K" }] }] };
    const before = { ...row, config: { modelCatalogModels: [original] } }, after = { ...row, config: { modelCatalogModels: [current] } };
    const diff = catalogChanges(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ kind: "model-changed", modelId: "full-model-id" });
    expect(diff[0]!.before).toContain("原名称"); expect(diff[0]!.after).toContain("供应商新名称");
    expect(diff[0]!.after).toContain("image.edit"); expect(diff[0]!.after).toContain("4K");
    expect(diff[0]!.before).toContain("maxInputImages：1"); expect(diff[0]!.after).toContain("maxInputImages：4");
    expect(diff[0]!.after).not.toContain("价格");
  });
  it("same-ID supplier catalog classification and protocol changes are recorded with their exact group", async () => {
    const f = await fixture(), row = await f.save();
    const supplier: SupplierRecord = { id: "supplier", name: "Fixture", supplierKey: "fixture", siteUrl: "https://fixture.invalid", apiUrl: "https://fixture.invalid/v1",
      kind: "newapi", scanStatus: "live", createdAt: "", updatedAt: "", catalog: { groups: [{ id: "exact-group", label: "Group", models: [
        { id: "same/full-id", capability: "image", protocol: "openai-images", priceLabel: "¥0.1/次" },
      ] }] } };
    const next = structuredClone(supplier);
    next.catalog.groups[0]!.models[0]!.capability = "video";
    next.catalog.groups[0]!.models[0]!.protocol = "openai-videos";
    const changes = catalogChanges(row, row, supplier, next);
    expect(changes).toHaveLength(1); expect(changes[0]).toMatchObject({ kind: "model-changed", modelId: "same/full-id", groupId: "exact-group" });
    expect(changes[0]!.before).toContain("目录分类：image"); expect(changes[0]!.after).toContain("目录分类：video");
    expect(changes[0]!.after).toContain("接口协议：openai-videos");
    expect(changes[0]!.after).not.toContain("video.generate");
  });
  it("model specification comparison ignores source sampling, key order and set order", async () => {
    const f = await fixture(), row = await f.save();
    const declared = { ...model(), name: "Full model", operations: ["image.edit", "image.generate"], inputKinds: ["text", "image"], limits: { maxInputImages: 2, maxPromptCharacters: 8000 },
      parameters: [{ key: "seed", label: "种子", control: "number", min: 0, max: 10 }, { key: "quality", label: "质量", control: "select", options: [{ value: "high", label: "high" }] }] };
    const resampled = { ...declared, operations: [...declared.operations].reverse(), inputKinds: [...declared.inputKinds].reverse(),
      limits: { maxPromptCharacters: 8000, maxInputImages: 2 }, parameters: [...declared.parameters].reverse(),
      metadata: { ...declared.metadata, priceCheckedAt: "new", supplierCatalogPriceCheckedAt: "new", sourceUrl: "https://fixture.invalid/new", factsSource: { checkedAt: "new" } } };
    expect(catalogChanges({ ...row, config: { modelCatalogModels: [declared] } }, { ...row, config: { modelCatalogModels: [resampled] } })).toEqual([]);
  });
  it("same-ID conditional parameter rules and explicitly stored eligibility changes are reported", async () => {
    const f = await fixture(), row = await f.save();
    const original = { ...model(), metadata: { ...model().metadata, canvasRunnable: true, agentCapabilities: { imageInput: true } },
      parameters: [{ key: "quality", label: "质量", control: "select", options: [{ value: "high", label: "high" }],
        constraints: [{ when: [{ parameter: "resolution", values: ["4K"] }], required: true }] }] };
    const current = structuredClone(original);
    current.parameters[0]!.constraints[0]!.when[0]!.values = ["2K", "4K"];
    current.metadata.canvasRunnable = false;
    const changes = catalogChanges({ ...row, config: { modelCatalogModels: [original] } }, { ...row, config: { modelCatalogModels: [current] } });
    expect(changes).toHaveLength(1); expect(changes[0]).toMatchObject({ kind: "model-changed" });
    expect(changes[0]!.after).toContain("条件限制"); expect(changes[0]!.after).toContain("2K");
    expect(changes[0]!.before).toContain("可用于画布：是"); expect(changes[0]!.after).toContain("可用于画布：否");
  });
  it("missing declared capabilities and flags stay unknown in specification history", async () => {
    const f = await fixture(), row = await f.save();
    const before = { ...row, config: { modelCatalogModels: [model()] } };
    const after = { ...row, config: { modelCatalogModels: [{ ...model(), capabilities: ["image.generate"], isDefault: true,
      metadata: { ...model().metadata, canvasRunnable: false } }] } };
    const change = catalogChanges(before, after).find(entry => entry.kind === "model-changed")!;
    expect(change.before).toContain("能力：—");
    expect(change.before).toContain("目录默认型号：—");
    expect(change.before).toContain("可用于画布：—");
    expect(change.after).toContain("能力：image.generate");
    expect(change.after).toContain("可用于画布：否");
  });
  it("nested pricing source/sample timestamps never trigger a price change, conditions do", async () => {
    const f = await fixture(), row = await f.save();
    const pricing = { kind: "tiered", currency: "CNY", billingUnit: "image", sourceUrl: "https://fixture.invalid/pricing", checkedAt: "old",
      tiers: [{ dimension: "resolution", value: "4K", price: 0.1, conditions: [{ parameter: "quality", operator: "eq", value: "high" }] }] };
    const before = { ...row, config: { modelCatalogModels: [{ ...model(), pricing, metadata: { ...model().metadata, priceSource: { checkedAt: "old", sampledAt: "old" } } }] } };
    const after = { ...row, config: { modelCatalogModels: [{ ...model(), pricing: { ...structuredClone(pricing), checkedAt: "new", sourceUrl: "https://fixture.invalid/new" }, metadata: { ...model().metadata, priceSource: { checkedAt: "new" } } }] } };
    expect(catalogChanges(before, after)).toEqual([]);
    after.config.modelCatalogModels[0]!.pricing.tiers[0]!.conditions[0]!.value = "max";
    expect(catalogChanges(before, after)[0]).toMatchObject({ kind: "price", modelId: "full-model-id" });
  });
  it("group price changes retain existing backend units, resolution conditions and multipliers", async () => {
    const f = await fixture(), row = await f.save();
    const supplier: SupplierRecord = { id: "supplier", name: "Fixture", supplierKey: "fixture", siteUrl: "https://fixture.invalid", apiUrl: "https://fixture.invalid/v1",
      kind: "newapi", scanStatus: "live", createdAt: "", updatedAt: "", catalog: { groups: [{ id: "full-group-id", label: "Fixture group", models: [],
        details: { source: "key-groups", referencePrice: "4K / high：¥0.10/张", imagePrices: [{ resolution: "4K", amount: 0.1 }], rateMultiplier: 1 } }] } };
    const next = structuredClone(supplier);
    next.catalog.groups[0]!.details!.imagePrices![0]!.amount = 0.12;
    next.catalog.groups[0]!.details!.rateMultiplier = 1.2;
    const price = catalogChanges(row, row, supplier, next).find(change => change.kind === "price")!;
    expect(price.before).toContain("4K / high：¥0.10/张"); expect(price.before).toContain("4K 0.1（分组后台额度/张）");
    expect(price.after).toContain("4K 0.12（分组后台额度/张）"); expect(price.after).toContain("后台倍率：1.2×");
    expect(price.before).not.toContain("{");
  });
});

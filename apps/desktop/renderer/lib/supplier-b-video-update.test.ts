import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("./supplier-service", () => ({ getSupplierRecord: vi.fn(async () => null) }));
vi.mock("./server", () => ({ repository: { getSupplierVerification: vi.fn(async () => null) } }));
import { parseSupplierCatalog, type ModelDescriptor, type SupplierCatalogDiscovery } from "@super-canvas/providers";
import { chentuCatalogFromPricing, resolveChentuScannedGroup } from "./chentu-catalog";
import { cangyuanCatalogFromPricing } from "./cangyuan-catalog";
import { applySupplierCatalogPrices } from "./supplier-model-pricing";
import { modelPriceSummary, modelEstimatedCost } from "./model-display";

const fixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/supplier-b-video-20261013.json", import.meta.url), "utf8"));
const site = fixture.sourceUrls.chentu.replace("/api/pricing", "");
const checkedAt = fixture.sampledAt.chentu;
const catalog: SupplierCatalogDiscovery = { ...parseSupplierCatalog(fixture.chentu, { supplierSiteUrl: site, currency: "CNY", checkedAt }), kind: "newapi", status: "live", complete: true, checkedAt };
const id = "wan3.0-video-prime", group = "wan系列视频";
const automatic: ModelDescriptor = { id, name: `${id} · ￥ 0.205 / 请求`, operations: ["video.generate"],
  pricing: { kind: "per-request", unitAmount: .205, currency: "CNY", checkedAt: "2026-10-12T00:00:00Z", confidence: "exact" },
  metadata: { priceLabel: "￥ 0.205 / 请求", officialCatalogPricing: { unitAmount: .205 }, userParameter: "preserve" } };

describe("Chentu current catalog and quote refresh", () => {
  it("keeps new empty vip and all four exact WAN IDs visible without inventing a generation contract", () => {
    const current = chentuCatalogFromPricing(fixture.chentu);
    expect(current.marketplaceGroups.find(g => g.id === "vip")?.models).toEqual([]);
    const wan = current.marketplaceGroups.find(g => g.id === group)!;
    expect(wan.models.map(m => m.id).sort()).toEqual(["wan3.0-video-prime", "wan3.0-image-prime", "wan3.0-video", "wan3.0-image"].sort());
    const resolved = resolveChentuScannedGroup(current, group, wan.models.map(m => m.id));
    expect(resolved.canvasModels).toEqual([]);
    expect(resolved.canvasDisplayModels).toHaveLength(4);
    for (const model of resolved.canvasDisplayModels) {
      expect(model.pricing).toBeUndefined();
      expect(model.parameters).toBeUndefined();
      expect(model.metadata).toMatchObject({ canvasRunnable: false, chentuCurrencyConflict: true, chentuPriceCheckedAt: current.checkedAt });
      expect(model.metadata?.priceLabel).toContain("$");
      expect(model.operations).toContain("video.generate");
      expect(model.metadata?.catalogCapability).toBe("video");
    }
  });
  it("replaces only the obsolete automatic CNY estimate while retaining raw rates, time and selected parameters", () => {
    const refreshed = applySupplierCatalogPrices([automatic], group, catalog, site)[0]!;
    expect(refreshed.pricing).toBeUndefined();
    expect(refreshed.name).toBe(id);
    expect(refreshed.metadata).toMatchObject({ priceStatus: "conflict", priceCheckedAt: checkedAt, chentuPriceCheckedAt: checkedAt, userParameter: "preserve" });
    expect(refreshed.metadata?.officialCatalogPricing).toBeUndefined();
    expect(refreshed.metadata?.priceLabel).toContain("480P $0.205/s");
    expect(refreshed.metadata?.chentuVideoUnitPrices).toBeDefined();
    expect(automatic.pricing?.unitAmount).toBe(.205);
    expect(automatic.name).toContain("￥");
    expect(modelEstimatedCost(refreshed, { duration: 5, resolution: "720P" })).toBeUndefined();
  });
  it.each(["manual", "generated-result"])("retains same-identity %s numeric evidence", priceSource => {
    const original = { ...automatic, metadata: { ...automatic.metadata, priceSource } };
    expect(applySupplierCatalogPrices([original], group, catalog, site)[0]).toBe(original);
  });
  it("retains manual text and real-charge metadata evidence and ignores older conflict reads", () => {
    for (const model of [
      { ...automatic, pricing: undefined, metadata: { priceSource: "manual", priceLabel: "manual valid quote" } },
      { ...automatic, pricing: undefined, metadata: { priceSource: "generated-result", measuredPrice: { actualCost: .2 } } },
      { ...automatic, metadata: { ...automatic.metadata, priceCheckedAt: "2026-10-15T00:00:00Z" } },
    ]) expect(applySupplierCatalogPrices([model], group, catalog, site)[0]).toBe(model);
  });
  it("does not widen known MiniMax resolution controls from the pricing usage schema", () => {
    const current = chentuCatalogFromPricing(fixture.chentu), resolved = resolveChentuScannedGroup(current, "minimax系列视频", ["MiniMaxH3-768p"]);
    const model = resolved.canvasModels[0]!;
    expect(model.pricing).toMatchObject({ kind: "per-second", currency: "CNY", unitAmount: .051 });
    const resolution = model.parameters?.find(p => p.key === "resolution");
    expect(resolution?.options?.some(o => o.value === "2k")).not.toBe(true);
  });
});

describe("Cangyuan current catalog integration", () => {
  it("includes all eleven exact contracts in both current groups and honors SD16 tier prices over model_price", () => {
    const current = cangyuanCatalogFromPricing(fixture.cangyuan);
    const expected = fixture.cangyuan.data.map((r: {model_name: string}) => r.model_name).sort();
    for (const group of ["VIDEO", "全模型-无claude/gpt"]) {
      expect(current.groups[group as keyof typeof current.groups]?.map(m => m.id).sort()).toEqual(expected);
      for (const model of current.groups[group as keyof typeof current.groups] ?? []) {
        expect(model.operations).toContain("video.generate");
        expect(model.parameters?.some(p => p.key === "duration")).toBe(true);
      }
    }
    const model = current.groups.VIDEO.find(m => m.id === "sd16-seedance-2.0")!;
    expect(modelPriceSummary(model, { resolution: "480p", duration: 5 })).toBe("4.8 CNY / 次");
    expect(modelPriceSummary(model, { resolution: "4K", duration: 15 })).toBe("29 CNY / 次");
    expect(model.pricing?.unitAmount).toBeUndefined();
  });
});

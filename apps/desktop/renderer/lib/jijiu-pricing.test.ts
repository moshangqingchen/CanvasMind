import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSupplierCatalog, scanProviderModelCatalog, type ModelDescriptor, type SupplierCatalogDiscovery } from "@super-canvas/providers";
import { modelEstimatedCost, modelPriceSummary } from "./model-display";
import { applyDocumentedModelPrice, applySupplierCatalogPrices } from "./supplier-model-pricing";

vi.mock("./supplier-service", () => ({ getSupplierRecord: vi.fn(async () => null) }));
vi.mock("./server", () => ({ repository: { getSupplierVerification: vi.fn(async () => null) } }));
const frozen = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/jijiu-billing-20261010.json", import.meta.url), "utf8")) as {
  data: Record<string, unknown>[]; group_ratio: Record<string, number>;
};
const source = "https://newapi.jijiucanvas.com";
const checkedAt = "2026-10-10T00:00:00Z";
const network = vi.fn(async () => { throw new Error("No network allowed in Jijiu pricing regression"); });
beforeEach(() => { network.mockClear(); vi.stubGlobal("fetch", network); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T04:00:00Z")); });
afterEach(() => { try { expect(network).not.toHaveBeenCalled(); } finally { vi.useRealTimers(); vi.unstubAllGlobals(); } });
const row = (id: string) => frozen.data.find(value => value.model_name === id)!;
function catalog(id: string, patch: Record<string, unknown> = {}, at = checkedAt): SupplierCatalogDiscovery {
  return { ...parseSupplierCatalog({ ...frozen, data: [{ ...row(id), ...patch }] }, { supplierSiteUrl: source, checkedAt: at }), kind: "newapi", status: "live", complete: true, checkedAt: at };
}
function descriptor(id: string): ModelDescriptor {
  // /v1/models confirms availability; billing comes from /api/pricing separately.
  return scanProviderModelCatalog({ data: [{ id, tags: row(id).tags, supported_endpoint_types: row(id).supported_endpoint_types }] }, { baseUrl: `${source}/v1`, modelGroup: (row(id).enable_groups as string[])[0] }).models[0]!;
}
function current(id: string): ModelDescriptor {
  const group = (row(id).enable_groups as string[])[0]!;
  return applySupplierCatalogPrices([descriptor(id)], group, catalog(id), source)[0]!;
}

describe("Jijiu catalog to current request estimate (offline)", () => {
  it("keeps actual image request prices and fixed video requests independent of duration", () => {
    expect(current("gpt-image-2").pricing).toMatchObject({ currency: "CNY", billingUnit: "request" });
    expect(modelEstimatedCost(current("gpt-image-2"), {})).toBe("0.06 CNY");
    const special = current("MinimaxH3特价版");
    expect(modelEstimatedCost(special, { duration: 5 })).toBe("0.8 CNY");
    expect(modelEstimatedCost(special, { duration: 15 })).toBe("0.8 CNY");
    expect(modelEstimatedCost(special, { duration: 16 })).toBeUndefined();
    expect(modelEstimatedCost(current("满血seedance-2.5全参A"), { duration: 10, resolution: "720p" })).toBe("16 CNY");
    expect(modelEstimatedCost(current("满血seedance-2.5全参B"), { duration: 10, resolution: "720p" })).toBe("7 CNY");
  });

  it("applies the current Shanghai discount to the current parameter combination", () => {
    const model = current("MinimaxH3");
    expect(modelEstimatedCost(model, { duration: 5, resolution: "768p" })).toBe("0.45 CNY（上海当前时段价，以提交时刻为准）");
    vi.setSystemTime(new Date("2026-10-10T14:30:00Z"));
    expect(modelPriceSummary(model, { duration: 5, resolution: "768p" })).toBe("0.063 CNY / 秒（上海当前时段价，以提交时刻为准）");
    expect(modelEstimatedCost(model, { seconds: 5, resolution: "768p" })).toBe("0.315 CNY（上海当前时段价，以提交时刻为准）");
    expect(modelEstimatedCost(model, { duration: 5, resolution: "999p" })).toBeUndefined();
    expect(modelEstimatedCost(model, { duration: 5, seconds: 6, resolution: "768p" })).toBeUndefined();
  });

  it.each(["wan3.0-video", "wan3.0-video-prime", "稳定seedance-2.5全参E"])("does not underquote %s by omitting billable input-video time", id => {
    const model = current(id);
    expect(model.metadata?.billingIncludesInputDuration).toBe(true);
    expect(modelPriceSummary(model, { duration: 10, resolution: "720p" })).toMatch(/CNY \/ 秒/u);
    expect(modelEstimatedCost(model, { duration: 10, resolution: "720p" })).toBeUndefined();
  });

  it("retains the same source/group's prior valid quote when a new expression is unknown, without estimating from it", () => {
    const id = "gpt-image-2", old = current(id);
    const refreshed = applySupplierCatalogPrices([old], "default", catalog(id, { billing_expr: 'tier("new", u("unverified")*1)' }, "2026-10-11T00:00:00Z"), source)[0]!;
    expect(refreshed.pricing).toEqual(old.pricing);
    expect(refreshed.metadata).toMatchObject({ priceStatus: "partial", jijiuCatalogPricingIncomplete: true, priceCheckedAt: checkedAt, priceLastAttemptAt: "2026-10-11T00:00:00Z" });
    expect(refreshed.metadata?.priceLabel).toContain("（上次价格）");
    expect(modelEstimatedCost(refreshed, {})).toBeUndefined();
    const recovered = applySupplierCatalogPrices([refreshed], "default", catalog(id, { billing_expr: 'tier("standard", fixed(0.08))' }, "2026-10-12T00:00:00Z"), source)[0]!;
    expect(recovered.metadata?.jijiuCatalogPricingIncomplete).toBeUndefined();
    expect(recovered.metadata?.priceUnavailableReason).toBeUndefined();
    expect(recovered.metadata?.priceStatus).toBe("available");
    expect(modelEstimatedCost(recovered, {})).toBe("0.08 CNY");
  });

  it("does not borrow a quote from another group/source or parse old docs after an unknown live expression", () => {
    const id = "gpt-image-2", bad = catalog(id, { billing_expr: 'tier("new", u("unverified")*1)' });
    const old = current(id);
    for (const candidate of [descriptor(id), { ...old, metadata: { ...old.metadata, supplierPriceGroup: "another" } },
      { ...old, pricing: { ...old.pricing!, sourceUrl: "https://another.example/api/pricing" } }]) {
      const next = applySupplierCatalogPrices([candidate], "default", bad, source)[0]!;
      expect(next.pricing).toBeUndefined();
      expect(next.metadata?.priceStatus).toBe("unconfirmed");
      expect(applyDocumentedModelPrice(next, `${id}: ¥0.01/次`, `${source}/docs/api-docs.md`)).toEqual(next);
    }
    const groups = bad.groups.map(group => ({ ...group, supplierGroupId: "2" }));
    expect(applySupplierCatalogPrices([{ ...old, metadata: { ...old.metadata, supplierPriceGroupId: "1" } }], "default", { ...bad, groups }, source, { supplierGroupId: "2" })[0]?.pricing).toBeUndefined();
    const manual = { ...old, metadata: { ...old.metadata, priceSource: "manual" } };
    expect(applySupplierCatalogPrices([manual], "default", bad, source)[0]).toEqual(manual);
  });
});

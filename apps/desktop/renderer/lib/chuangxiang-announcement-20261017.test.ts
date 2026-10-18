import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, SupplierCatalogDiscovery } from "@super-canvas/providers";
import { chuangxiangRejectedRequestFeeNotice } from "@super-canvas/providers";
vi.mock("./supplier-service", () => ({ getSupplierRecord: vi.fn(async () => null) }));
vi.mock("./server", () => ({ repository: { getSupplierVerification: vi.fn(async () => null) } }));
import { applySupplierCatalogPrices } from "./supplier-model-pricing";
import { modelEstimatedCost } from "./model-display";
import { modelPickerPriceData } from "./model-picker-data";
import { ModelPriceDetails } from "../components/model-price-details";
import { failureDiagnosis } from "./failure-diagnosis";
import { localizeRunError } from "./error-localization";
afterEach(() => vi.unstubAllGlobals());
const site = "https://vapi.chuangxiangai.asia";
const catalog: SupplierCatalogDiscovery = { kind: "sub2api", status: "live", complete: true,
  checkedAt: "2026-10-17T14:57:32.294Z", groups: [] };
const model: ModelDescriptor = { id: "grok-imagine-video", name: "grok-imagine-video", operations: ["video.generate"],
  pricing: { kind: "per-request", currency: "CNY", unitAmount: .2, billingUnit: "request", confidence: "exact", checkedAt: "2026-10-17T13:00:00Z" },
  metadata: { catalogPriceEvidence: { schemaVersion: 1 }, measuredPrice: { amount: .18, currency: "CNY", unit: "request", requestId: "original",
    actualCharge: { amount: .18, currency: "CNY", unit: "request", requestId: "original" } } } };

describe("announced Chuangxiang rejection fee in price details", () => {
  it("survives accepted pipeline-price early returns without changing success estimates, menus or original charges", () => {
    const before = JSON.stringify(model);
    const next = applySupplierCatalogPrices([model], "视频", catalog, site)[0]!;
    expect(next.metadata?.chuangxiangRejectedRequestFeeNotice).toEqual(chuangxiangRejectedRequestFeeNotice(site, model.id));
    expect(next.pricing).toBe(model.pricing);
    expect(next.metadata?.measuredPrice).toBe(model.metadata?.measuredPrice);
    expect(modelEstimatedCost(next, {})).toBe(modelEstimatedCost(model, {}));
    expect(modelPickerPriceData(next)).toBe(modelPickerPriceData(model));
    expect(JSON.stringify(model)).toBe(before);
    expect(failureDiagnosis(localizeRunError({ message: "upstream security policy rejected", statusCode: 403 }))).toMatchObject({ chargeStatus: "unknown" });
  });
  it.each(["manual", "generated-result"])("keeps the protected %s price and its original evidence", priceSource => {
    const original: ModelDescriptor = { ...model, metadata: { ...model.metadata, catalogPriceEvidence: undefined, priceSource } };
    const next = applySupplierCatalogPrices([original], "视频", catalog, site)[0]!;
    expect(next.pricing).toBe(original.pricing);
    expect(next.metadata?.priceSource).toBe(priceSource);
    expect(next.metadata?.measuredPrice).toBe(original.metadata?.measuredPrice);
    expect(next.metadata?.chuangxiangRejectedRequestFeeNotice).toBeDefined();
  });
  it("shows the separate condition, publication, sample and original announcement link in the detail disclosure", () => {
    vi.stubGlobal("React", React);
    const next = applySupplierCatalogPrices([model], "视频", catalog, site)[0]!;
    const markup = renderToStaticMarkup(React.createElement(ModelPriceDetails, { model: next, parameters: {} }));
    expect(markup).toContain("供应商条件收费公告");
    expect(markup).toContain("触发上游安全策略被拒绝");
    expect(markup).toContain("¥0.05/次");
    expect(markup).toContain("未计入本次成功请求报价");
    expect(markup).toContain("2026-10-17T20:57:41.883805+08:00");
    expect(markup).toContain("2026-10-17T14:57:32.294Z");
    expect(markup).toContain('href="https://vapi.chuangxiangai.asia/api/v1/announcements"');
  });
  it("removes an inherited notice on another supplier or a different model", () => {
    const announced = applySupplierCatalogPrices([model], "视频", catalog, site)[0]!;
    for (const [nextModel, nextSite] of [[announced, "https://api.hangzhale.com"], [{ ...announced, id: "gpt-image-2" }, site]] as const) {
      const clean = applySupplierCatalogPrices([nextModel], "视频", catalog, nextSite)[0]!;
      expect(clean.metadata?.chuangxiangRejectedRequestFeeNotice).toBeUndefined();
    }
  });
});

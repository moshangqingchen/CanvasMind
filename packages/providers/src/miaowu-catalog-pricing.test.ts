import { describe, expect, it } from "vitest";
import { miaowuCatalogMediaKind, miaowuCatalogMediaPricing } from "./miaowu-catalog-pricing.js";
import { discoverSupplierCatalog, parseSupplierCatalog } from "./supplier-catalog.js";
import { modelGenerationMediaKinds } from "./model-media.js";

const options = { supplierSiteUrl: "https://api.miaowuai.store", currency: "CNY", multiplier: 7, checkedAt: "2026-10-08T22:37:14Z" };
const nativeVideo = (id = "dola-seedance-2.0-fast") => ({ model_name: id, quota_type: 0, model_price: 0,
  model_ratio: 37.5, completion_ratio: 1, enable_groups: ["default"],
  video_api: { pricing: { unit: "per_call", rules: [{ size: "720p", price: .125 }] } } });

describe("official Miaowu native catalog billing", () => {
  it("declares both Dola IDs and Jimeng video from native output schemas and replaces chat/token placeholders", () => {
    const rows = ["dola-seedance-2.0-fast", "dola-seedance-2.5", "jimeng-seedance-2.5"].map(id => nativeVideo(id));
    const models = parseSupplierCatalog({ group_ratio: { default: 1 }, data: rows }, options).groups[0]!.models;
    expect(models.map(model => [model.id, model.capability, model.outputKinds, model.protocol])).toEqual(rows.map(row => [row.model_name, "video", ["video"], "openai-videos"]));
    for (const model of models) {
      expect(modelGenerationMediaKinds({ ...model, operations: [] })).toEqual(["video"]);
      expect(model.priceLabel).toBe("720p ¥0.875/次");
      expect(model.metadata?.miaowuCatalogPricing).toMatchObject({ kind: "per-request", currency: "CNY", billingUnit: "request", checkedAt: options.checkedAt,
        tiers: [{ value: "720p", price: .875 }] });
      expect(model.priceLabel).not.toContain("/1M");
      expect(model.metadata?.canvasRunnable).toBeUndefined();
    }
  });

  it("uses resolution rules before headline amounts and applies each exact group multiplier once", () => {
    const row = { ...nativeVideo("seedance-2.0-mini-deal"), quota_type: 1, model_price: .04285714285714286,
      enable_groups: ["default", "discount"], video_api: { pricing: { unit: "per_call", rules: [{ size: "480p", seconds_max: 15, price: .05714285714285715 }, { size: "720p", seconds_max: 12, price: .05714285714285715 }] } } };
    const groups = parseSupplierCatalog({ group_ratio: { default: 1, discount: .5 }, data: [row] }, options).groups;
    expect(groups.map(group => [group.id, group.models[0]!.priceLabel])).toEqual([["default", "480p ¥0.4/次 · 720p ¥0.4/次"], ["discount", "480p ¥0.2/次 · 720p ¥0.2/次"]]);
    expect((groups[0]!.models[0]!.metadata?.miaowuCatalogPricing as Record<string, unknown>).unitAmount).toBeUndefined();
  });

  it("retains per-second billing and image output while ignoring incompatible headline/token fields", () => {
    const seconds = miaowuCatalogMediaPricing({ ...nativeVideo("jimeng-seedance-2.5"), video_api: { pricing: { unit: "per_second", rules: [{ size: "480p", seconds_max: 30, price: .08928571428571429 }, { size: "720p", seconds_max: 30, price: .10714285714285714 }] } } }, options)!;
    expect(seconds.pricing).toMatchObject({ kind: "per-second", billingUnit: "second", tiers: [{ price: .625 }, { price: .75 }] });
    expect(seconds.priceLabel).toBe("480p ¥0.625/秒 · 720p ¥0.75/秒");
    const image = { model_name: "gpt-image-2.5-flare", quota_type: 0, model_ratio: 37.5, enable_groups: ["default"], image_api: { pricing: { unit: "per_call", rules: [{ size: "1080p", price: .005714285714285714 }, { size: "2K", price: .011428571428571429 }, { size: "4K", price: .02857142857142857 }] } } };
    const parsed = parseSupplierCatalog({ data: [image] }, options).groups[0]!.models[0]!;
    expect(parsed).toMatchObject({ capability: "image", outputKinds: ["image"], metadata: { miaowuCatalogPricing: { kind: "per-request", tiers: [{ price: .04 }, { price: .08 }, { price: .2 }] } } });
  });

  it("uses the same model's explicit per-call headline only when no resolution rules exist", () => {
    const row = { ...nativeVideo("minimax-h3-max"), quota_type: 1, model_price: 2 / 7, video_api: { pricing: { unit: "per_call" } } };
    expect(miaowuCatalogMediaPricing(row, options)).toMatchObject({ priceLabel: "¥2/次", pricing: { unitAmount: 2 } });
    expect(miaowuCatalogMediaPricing(row, options)?.pricing.tiers).toBeUndefined();
    expect(miaowuCatalogMediaPricing({ ...row, quota_type: 0, model_price: 0 }, options)).toBeUndefined();
  });

  it.each(["https://unrelated.invalid", "https://api.miaowuai.store.evil.invalid", "https://user@api.miaowuai.store", "https://api.miaowuai.store/?token=hidden"])("does not reuse Miaowu classification or rules for %s", supplierSiteUrl => {
    expect(miaowuCatalogMediaKind(nativeVideo(), supplierSiteUrl)).toBeUndefined();
    expect(miaowuCatalogMediaPricing(nativeVideo(), { ...options, supplierSiteUrl })).toBeUndefined();
  });

  it("keeps unknown native pricing conditions pending instead of falling back to a chat/token or flat quote", () => {
    for (const raw of [{ unit: "token", rules: [{ size: "720p", price: .125 }] },
      { unit: "per_call", rules: [{ size: "720p", price: .125, has_reference_video: true }] },
      { unit: "per_call", rules: [{ size: "720p", price: .125 }, { size: "720p", price: .25 }] }]) {
      const row = { ...nativeVideo(), video_api: { pricing: raw } };
      const model = parseSupplierCatalog({ data: [row] }, options).groups[0]!.models[0]!;
      expect(model).toMatchObject({ capability: "video", outputKinds: ["video"], priceLabel: "价格条件待确认", metadata: { miaowuCatalogPricingIncomplete: true } });
      expect(model.metadata?.miaowuCatalogPricing).toBeUndefined();
    }
    const ambiguous = { ...nativeVideo(), image_api: {} };
    expect(miaowuCatalogMediaKind(ambiguous, options.supplierSiteUrl)).toBeUndefined();
    expect(parseSupplierCatalog({ data: [ambiguous] }, options).groups[0]!.models[0]).toMatchObject({ priceLabel: "价格条件待确认", metadata: { miaowuCatalogPricingIncomplete: true } });
  });

  it("preserves explicit quote currencies without applying the site's display exchange again", () => {
    const row = { ...nativeVideo(), video_api: { pricing: { unit: "per_call", currency: "CNY", rules: [{ size: "720p", price: .875 }] } } };
    const parsed = parseSupplierCatalog({ data: [row], group_ratio: { default: .5 } }, options).groups[0]!.models[0]!;
    expect(parsed).toMatchObject({ priceLabel: "720p ¥0.4375/次", metadata: { miaowuCatalogPricing: { currency: "CNY", tiers: [{ price: .4375 }] } } });
    const usd = { ...row, video_api: { pricing: { ...row.video_api.pricing, currency: "USD", rules: [{ size: "720p", price: .125 }] } } };
    expect(miaowuCatalogMediaPricing(usd, options)).toBeUndefined();
    const explicit = parseSupplierCatalog({ data: [usd], group_ratio: { default: .5 } }, options).groups[0]!.models[0]!;
    expect(explicit).toMatchObject({ priceLabel: "720p $0.0625/次", metadata: { miaowuCatalogPricing: { currency: "USD", tiers: [{ price: .0625 }] } } });
  });

  it("preserves exact official scope through discovery's initial parse and display-currency reparse", async () => {
    const result = await discoverSupplierCatalog({ siteUrl: options.supplierSiteUrl, apiUrl: options.supplierSiteUrl, kind: "newapi" }, async url => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/pricing") return Response.json({ data: [nativeVideo()], group_ratio: { default: 1 } });
      if (path === "/api/status") return Response.json({ data: { quota_display_type: "CNY", usd_exchange_rate: 7 } });
      if (path === "/api/user/self/groups") return Response.json({ data: { default: { ratio: 1 } } });
      throw new Error(`Unexpected fixture path ${path}`);
    });
    expect(result.status).toBe("live");
    expect(result.complete).not.toBe(false);
    expect(result.groups[0]!.models[0]).toMatchObject({ capability: "video", priceLabel: "720p ¥0.875/次", metadata: { miaowuCatalogPricing: { currency: "CNY", tiers: [{ price: .875 }] } } });
  });
});

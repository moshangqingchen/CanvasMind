import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { miaowuCatalogMediaPricing } from "./miaowu-catalog-pricing.js";
import { jiasuCatalogMediaPricing, jiasuCatalogRecord } from "./jiasu-catalog-pricing.js";
import { jiasuVideoModel } from "./jiasu-video-contract.js";
import { jijiuCatalogMediaPricing } from "./jijiu-catalog-pricing.js";
import { modelPriceAmount } from "./media-billing.js";
import { parseSupplierCatalog } from "./supplier-catalog.js";

type Snapshot = { sourceUrl: string; checkedAt: string; group_ratio: Record<string, number>; data: Record<string, unknown>[] };
const snapshots = JSON.parse(readFileSync(new URL("./fixtures/supplier-a-pricing-20261013.json", import.meta.url), "utf8")) as Record<"miaowu" | "jiasu" | "jijiu", Snapshot>;
const row = (supplier: keyof typeof snapshots, id: string) => snapshots[supplier].data.find(value => value.model_name === id)!;

describe("October 13 supplier A current public price samples", () => {
  it.each([
    ["seedance-2.0", "second", { "480p": .5, "720p": 1 }],
    ["seedance-2.0-fast", "second", { "480p": .2, "720p": .4 }],
    ["seedance-2.0-pro", "second", { "480p": .25, "720p": .35 }],
    ["doubao-seedance-2.0-mini", "request", { "720p": 1 }],
    ["seedance-2.5-pro", "second", { "480p": .3, "720p": .4 }],
    ["seedance-2.5-deal", "request", { "480p": 4, "720p": 6 }],
  ] as const)("reads Miaowu %s's current native unit and exact default-group tiers", (id, unit, rates) => {
    const pricing = miaowuCatalogMediaPricing(row("miaowu", id), { supplierSiteUrl: "https://api.miaowuai.store", currency: "CNY", multiplier: 7,
      checkedAt: snapshots.miaowu.checkedAt })!.pricing;
    expect(pricing.billingUnit).toBe(unit);
    for (const [resolution, rate] of Object.entries(rates)) expect(modelPriceAmount(pricing, { resolution })).toBe(rate);
    expect(modelPriceAmount(pricing, { resolution: "1080p" })).toBeUndefined();
  });

  it("uses Jiasu's new final 720p-only quote while keeping 480p capability separate", () => {
    const raw = row("jiasu", "sd-2.0-mini-J1");
    const pricing = jiasuCatalogMediaPricing(raw, { supplierSiteUrl: "https://ai.jiasuapi.com", currency: "CNY", group: "vip", groupMultiplier: .5,
      checkedAt: snapshots.jiasu.checkedAt })!.pricing;
    expect(pricing.billingUnit).toBe("request");
    expect(modelPriceAmount(pricing, { resolution: "720p" })).toBe(1);
    expect(modelPriceAmount(pricing, { resolution: "480p" })).toBeUndefined();
    const model = jiasuVideoModel("sd-2.0-mini-J1", { id: "sd-2.0-mini-J1", name: "sd-2.0-mini-J1", operations: [], metadata: { jiasuCatalogRecord: jiasuCatalogRecord(raw) } }, "vip");
    expect(model?.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toContain("480p");
  });

  it("retains Jiasu's complete new ID as video without inventing a zero quote or 15-second contract", () => {
    const id = "ov-Seedance 2.0-720p-nsp-gz-15s", raw = row("jiasu", id);
    expect(jiasuCatalogMediaPricing(raw, { supplierSiteUrl: "https://ai.jiasuapi.com", currency: "CNY", group: "vip", groupMultiplier: 1 })).toBeUndefined();
    const models = parseSupplierCatalog(snapshots.jiasu, { supplierSiteUrl: "https://ai.jiasuapi.com", currency: "CNY" }).groups[0]!.models;
    expect(models.find(model => model.id === id)?.capability).toBe("video");
    const model = jiasuVideoModel(id, { id, name: id, operations: [], metadata: { jiasuCatalogRecord: jiasuCatalogRecord(raw) } }, "vip")!;
    expect(model.parameters?.find(parameter => parameter.key === "duration")?.options).toBeUndefined();
  });

  it.each([
    ["wan3.0-video-S", { "480p": .12, "720p": .23, "1080p": .45 }],
    ["wan3.0-video-prime-S", { "480p": .22, "720p": .43, "1080p": .85 }],
  ] as const)("decodes the exact Jijiu %s tier expression", (id, rates) => {
    const pricing = jijiuCatalogMediaPricing(row("jijiu", id), { supplierSiteUrl: "https://newapi.jijiucanvas.com", group: "视频WAN3", groupMultiplier: 1 })!.pricing;
    expect(pricing).toMatchObject({ currency: "CNY", billingUnit: "second" });
    for (const [resolution, rate] of Object.entries(rates)) expect(modelPriceAmount(pricing, { resolution })).toBe(rate);
  });

  it.each([
    ["SD2.5特价30-10-10-线路二", 4.5], ["SD2.5特价30-10线路一", 1.5],
    ["SD2.5特价900线路一", 1.2], ["SD2.5特价30-10线路二", 1.5],
  ] as const)("uses Jijiu %s's current numeric price despite outdated descriptive prose", (id, rate) => {
    const pricing = jijiuCatalogMediaPricing(row("jijiu", id), { supplierSiteUrl: "https://newapi.jijiucanvas.com", group: "视频SD2.5", groupMultiplier: 1 })!.pricing;
    expect(pricing.billingUnit).toBe("request");
    expect(modelPriceAmount(pricing, { resolution: "720p" })).toBe(rate);
  });
});

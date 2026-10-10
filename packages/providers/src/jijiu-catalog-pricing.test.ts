import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isJijiuCatalogSource, jijiuCatalogMediaPricing, JIJIU_PRICING_URL } from "./jijiu-catalog-pricing.js";
import { modelPriceAmount } from "./media-billing.js";
import { parseSupplierCatalog } from "./supplier-catalog.js";
import type { StructuredModelPricing } from "./contracts.js";

const frozen = JSON.parse(readFileSync(new URL("./fixtures/jijiu-billing-20261010.json", import.meta.url), "utf8")) as {
  data: Record<string, unknown>[]; group_ratio: Record<string, number>;
};
const source = "https://newapi.jijiucanvas.com";
const row = (id: string) => frozen.data.find(value => value.model_name === id)!;
const quote = (id: string, multiplier = 1) => jijiuCatalogMediaPricing(row(id), {
  supplierSiteUrl: source, group: (row(id).enable_groups as string[])[0]!, groupMultiplier: multiplier, checkedAt: "2026-10-10T00:00:00Z",
});
const day = new Date("2026-10-10T04:00:00Z");

describe("Jijiu official billing grammar and exact group identity", () => {
  it("keeps the independent current rate of all 25 complete media IDs", () => {
    const expected: Record<string, { unit: "request" | "second"; prices: number | Record<string, number> }> = {
      "gemini-3.1-flash-image": { unit: "request", prices: .1 }, "gemini-nano-banana-2.1": { unit: "request", prices: .07 },
      "gemini-3-pro-image": { unit: "request", prices: .1 }, "gpt-image-2": { unit: "request", prices: .06 },
      "gpt-image-2.5": { unit: "request", prices: .06 }, "gpt-image-2.5-sunburst": { unit: "request", prices: .06 },
      "gpt-image-2-2K/4K": { unit: "request", prices: .1 }, "MinimaxH3特价版": { unit: "request", prices: .8 },
      "SD2.5特价30-10线路一": { unit: "request", prices: 1.5 }, "SD2.5特价30-10-10-线路一": { unit: "request", prices: 6 },
      "SD2.5特价30-10-10-线路二": { unit: "request", prices: 6 }, "SD2.0mini稳定900B": { unit: "request", prices: 1.5 },
      "SD2.0mini稳定903C": { unit: "request", prices: .6 }, "SD2.0满血稳定933-线路一": { unit: "request", prices: 2.6 },
      "SD2.0fast稳定903A": { unit: "request", prices: 1 }, "满血seedance-2.5全参A": { unit: "request", prices: { "480p": 12, "720p": 16, "1080p": 22 } },
      "wan3.0-video": { unit: "second", prices: { "480p": .2, "720p": .25, "1080p": .3 } },
      "wan3.0-video-prime": { unit: "second", prices: { "480p": .24, "720p": .29, "1080p": .34 } },
      "MinimaxH3": { unit: "second", prices: { "480p": .05, "768p": .09, "1080p": .14, "2k-upscale": .14, "4k-upscale": .17 } },
      "Minimax漫剧优化版": { unit: "second", prices: { "480p": .05, "768p": .15, "1080p": .15, "2k-upscale": .22, "4k-upscale": .25 } },
      "满血seedance-2.5全参B": { unit: "second", prices: { "480p": .5, "720p": .7 } },
      "稳定seedance-2.5全参E": { unit: "second", prices: { "480p": .25, "720p": .45 } },
      "稳定seedance-2.5全参D": { unit: "second", prices: .4 }, "稳定seedance-2.5参图参音F": { unit: "second", prices: .4 },
      "SD2.0满血稳定933-线路二": { unit: "second", prices: .19 },
    };
    expect(Object.keys(expected)).toHaveLength(25);
    for (const [id, value] of Object.entries(expected)) {
      const pricing = quote(id)!.pricing;
      expect(pricing.billingUnit, id).toBe(value.unit);
      const tiers = typeof value.prices === "number" ? { "": value.prices } : value.prices;
      for (const [resolution, price] of Object.entries(tiers)) expect(modelPriceAmount(pricing, { resolution }, day), `${id} ${resolution}`).toBe(price);
    }
  });
  it("parses every official media row without token placeholders or currency conversion", () => {
    const media = frozen.data.filter(value => (value.tags as string)?.includes("视频模型") || (value.tags as string)?.includes("图片模型"));
    expect(media).toHaveLength(25);
    for (const value of media) {
      for (const group of value.enable_groups as string[]) {
        const result = jijiuCatalogMediaPricing(value, { supplierSiteUrl: source, group, groupMultiplier: Number(frozen.group_ratio[group]) });
        if (group === "vip") { expect(result).toBeUndefined(); continue; }
        expect(result, `${String(value.model_name)} / ${group}`).toBeDefined();
        expect(result?.pricing).toMatchObject({ currency: "CNY", confidence: "exact", sourceUrl: JIJIU_PRICING_URL });
        expect(result?.priceLabel).not.toMatch(/Token|输入|输出|USD/iu);
      }
    }
    const catalog = parseSupplierCatalog(frozen, { supplierSiteUrl: source, checkedAt: "2026-10-10", currency: "USD", multiplier: 7 });
    for (const group of catalog.groups) for (const model of group.models.filter(model => ["image", "video"].includes(model.capability ?? ""))) {
      if (group.id === "vip") expect(model.metadata?.jijiuCatalogPricingIncomplete).toBe(true);
      else expect(model.metadata?.officialCatalogPricing).toMatchObject({ currency: "CNY", sourceUrl: JIJIU_PRICING_URL });
    }
    expect(quote("gpt-image-2", .5)?.pricing.tiers?.[0]?.price).toBe(.03);
  });

  it("keeps fixed requests distinct from output seconds, including the current 0.8-yuan special price", () => {
    expect(quote("MinimaxH3特价版")?.pricing).toMatchObject({ kind: "per-request", billingUnit: "request", unitAmount: .8 });
    expect(quote("SD2.5特价30-10-10-线路一", .5)?.pricing).toMatchObject({ billingUnit: "request", unitAmount: 3 });
    const task = quote("满血seedance-2.5全参A")!.pricing;
    expect(task.billingUnit).toBe("request");
    expect(modelPriceAmount(task, { resolution: "720p", seconds: 10 }, day)).toBe(16);
    const seconds = quote("满血seedance-2.5全参B", .5)!.pricing;
    expect(seconds.billingUnit).toBe("second");
    expect(modelPriceAmount(seconds, { resolution: "720p" }, day)).toBe(.35);
    expect(quote("稳定seedance-2.5参图参音F")?.pricing).toMatchObject({ billingUnit: "second", tiers: [{ price: .4 }] });
  });

  it("requires a declared resolution and never assigns the final else rate to an invalid value", () => {
    const pricing = quote("wan3.0-video")!.pricing;
    expect(modelPriceAmount(pricing, { resolution: "480p" }, day)).toBe(.2);
    expect(modelPriceAmount(pricing, { resolution: "720p" }, day)).toBe(.25);
    expect(modelPriceAmount(pricing, { resolution: "1080p" }, day)).toBe(.3);
    expect(modelPriceAmount(pricing, {}, day)).toBeUndefined();
    expect(modelPriceAmount(pricing, { resolution: "9999p" }, day)).toBeUndefined();
    const raw = row("wan3.0-video"), options = { supplierSiteUrl: source, group: "视频WAN3", groupMultiplier: 1 };
    expect(jijiuCatalogMediaPricing({ ...raw, billing_usage_schema: {} }, options)).toBeUndefined();
    expect(jijiuCatalogMediaPricing({ ...raw, billing_usage_schema: { resolution: { enum: ["480p", "720p", "1080p", "4k"] } } }, options)).toBeUndefined();
    expect(jijiuCatalogMediaPricing({ ...raw, billing_usage_schema: { resolution: { enum: ["480p", "720p", "720p", "1080p"] } } }, options)).toBeUndefined();
  });

  it.each([
    ["09:59:59", 1], ["10:00:00", .9], ["13:59:59", .9], ["14:00:00", .7], ["15:59:59", .7], ["16:00:00", 1],
  ])("applies documented Shanghai boundary %s using the clock only", (utc, multiplier) => {
    const pricing = quote("MinimaxH3")!.pricing;
    expect(modelPriceAmount(pricing, { resolution: "768p", hour: 12, timeZone: "UTC" }, new Date(`2026-10-10T${utc}Z`))).toBe(Number((.09 * Number(multiplier)).toPrecision(12)));
  });

  it("matches the official 22:30 example and the separate animation discount", () => {
    const at = new Date("2026-10-10T14:30:00Z");
    expect(Number((modelPriceAmount(quote("MinimaxH3")!.pricing, { resolution: "768p" }, at)! * 5).toPrecision(12))).toBe(.315);
    expect(modelPriceAmount(quote("Minimax漫剧优化版")!.pricing, { resolution: "768p" }, at)).toBe(.09);
    expect(quote("MinimaxH3")?.priceLabel).toContain("以提交时刻为准");
    expect(modelPriceAmount(quote("MinimaxH3")!.pricing, { resolution: "768p" }, new Date("invalid"))).toBeUndefined();
  });

  it("rejects malformed schedules rather than silently quoting the undiscounted amount", () => {
    const pricing = quote("MinimaxH3")!.pricing;
    for (const invalid of [{ startHour: 22, endHour: 18 }, { multiplier: NaN }, { timeZone: "UTC" }]) {
      const next = { ...pricing, timeMultipliers: [{ ...pricing.timeMultipliers![0], ...invalid }] } as StructuredModelPricing;
      expect(modelPriceAmount(next, { resolution: "768p" }, day)).toBeUndefined();
    }
    for (const schedule of [null, [null], "Shanghai"]) expect(modelPriceAmount({ ...pricing, timeMultipliers: schedule } as unknown as StructuredModelPricing, { resolution: "768p" }, day)).toBeUndefined();
  });

  it("rejects unknown expressions without eval or a misleading model_price fallback", () => {
    const raw = row("gpt-image-2"), options = { supplierSiteUrl: source, group: "default", groupMultiplier: 1 };
    for (const expression of ['globalThis.process.exit(1)', 'tier("base", fixed(1)); alert(1)', 'tier("base", fixed(-1))',
      'tier("base", u("tokens")*0.1)', 'tier("base", fixed(1)) * 2', 'tier("base", fixed(1e99))', 'x'.repeat(4097)]) {
      expect(jijiuCatalogMediaPricing({ ...raw, quota_type: 1, model_price: 100, billing_mode: "tiered_expr", billing_expr: expression }, options)).toBeUndefined();
    }
    const timed = row("MinimaxH3");
    expect(jijiuCatalogMediaPricing({ ...timed, model_name: "another-alias" }, { ...options, group: "视频-MnimaxH3" })).toBeUndefined();
  });

  it("requires the exact supplier and actual group ratio, and never treats chat expressions as media", () => {
    expect(isJijiuCatalogSource(`${source}/v1/`)).toBe(true);
    for (const site of ["http://newapi.jijiucanvas.com", `${source}.example`, `${source}/proxy`, `${source}?key=x`, "https://x@newapi.jijiucanvas.com"]) {
      expect(isJijiuCatalogSource(site)).toBe(false);
      expect(jijiuCatalogMediaPricing(row("gpt-image-2"), { supplierSiteUrl: site, group: "default", groupMultiplier: 1 })).toBeUndefined();
    }
    for (const groupMultiplier of [NaN, Infinity, -1]) expect(quote("gpt-image-2", groupMultiplier)).toBeUndefined();
    expect(jijiuCatalogMediaPricing(row("gpt-image-2"), { supplierSiteUrl: source, group: "other", groupMultiplier: 1 })).toBeUndefined();
    for (const value of frozen.data.filter(value => !(value.tags as string)?.includes("图片模型") && !(value.tags as string)?.includes("视频模型"))) {
      expect(jijiuCatalogMediaPricing(value, { supplierSiteUrl: source, group: (value.enable_groups as string[])[0]!, groupMultiplier: 1 })).toBeUndefined();
    }
  });
});

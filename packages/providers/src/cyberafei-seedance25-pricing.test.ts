import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scopedCatalogMediaPricing } from "./catalog-pricing.js";
import { parseSupplierCatalog } from "./supplier-catalog.js";
import { modelPriceAmount } from "./media-billing.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/cyberafei-seedance25-two-group-pricing-source.json", import.meta.url), "utf8"));
const origin = "https://api.3365api.cn";
const checkedAt = fixture.source.checkedAt as string;
const groups = ["图片视频模型综合分组", "特价seedance2.0"];

describe("Cyberafei seedance2.5 own official two-group second pricing", () => {
  it.each(groups)("keeps %s own resolution rates and source timestamp", group => {
    const parsed = parseSupplierCatalog({ data: [fixture.row], group_ratio: fixture.group_ratio, usable_group: fixture.usable_group },
      { supplierSiteUrl: origin, currency: "USD", checkedAt });
    const model = parsed.groups.find(row => row.id === group)!.models.find(row => row.id === "seedance2.5")!;
    const pricing = model.metadata!.officialCatalogPricing as NonNullable<import("./contracts.js").ModelDescriptor["pricing"]>;
    expect(pricing).toEqual({ kind: "tiered", currency: "USD", billingUnit: "second", checkedAt,
      sourceUrl: `${origin}/api/pricing`, confidence: "exact", tiers: [
        { id: "480p", label: "480p", dimension: "resolution", value: "480p", price: 2.625 },
        { id: "720p", label: "720p", dimension: "resolution", value: "720p", price: 4.725 },
      ] });
    expect(model.priceLabel).toBe("480p $2.625/秒 · 720p $4.725/秒");
    expect(modelPriceAmount(pricing, { resolution: "480p" })).toBe(2.625);
    expect(modelPriceAmount(pricing, { resolution: "720p" })).toBe(4.725);
    expect(modelPriceAmount(pricing, { resolution: "1080p" })).toBeUndefined();
    expect(modelPriceAmount(pricing, {})).toBeUndefined();
    // The generic group description is an independent statement, not this
    // exact full model's numeric rate or a currency conversion formula.
    expect(parsed.groups.find(row => row.id === "特价seedance2.0")?.label).toContain("0.3一秒");
  });

  it("applies each current group multiplier to that exact row independently", () => {
    const parsed = parseSupplierCatalog({ data: [fixture.row], group_ratio: { [groups[0]!]: .5, [groups[1]!]: 2 }, usable_group: fixture.usable_group },
      { supplierSiteUrl: origin, currency: "USD", checkedAt });
    for (const [group, multiplier] of [[groups[0], .5], [groups[1], 2]] as const) {
      const price = parsed.groups.find(row => row.id === group)!.models[0]!.metadata!.officialCatalogPricing as NonNullable<import("./contracts.js").ModelDescriptor["pricing"]>;
      expect(price.tiers?.map(tier => tier.price)).toEqual([2.625 * multiplier, 4.725 * multiplier]);
    }
  });

  it.each([
    { name: "different host", origin: "https://other.example" },
    { name: "wrong host suffix", origin: "https://api.3365api.cn.other.example" },
    { name: "unapproved path", origin: `${origin}/gateway` },
    { name: "another group", group: "other", row: { ...fixture.row, enable_groups: ["other"] } },
    { name: "same name without membership", row: { ...fixture.row, enable_groups: [groups[0]] } },
    { name: "no row memberships", row: { ...fixture.row, enable_groups: undefined } },
    { name: "different full ID", row: { ...fixture.row, model_name: "seedance2.5-A" } },
    { name: "another family model", row: { ...fixture.row, model_name: "seedance2.0" } },
    { name: "description request units", row: { ...fixture.row, description: fixture.row.description.replaceAll("/秒", "/次") } },
    { name: "unparsed extra condition", row: { ...fixture.row, description: `${fixture.row.description}另加参考音频费` } },
  ])("does not inherit the two-group rule for $name", change => {
    expect(scopedCatalogMediaPricing(change.row ?? fixture.row, {
      supplierSiteUrl: change.origin ?? origin, group: change.group ?? groups[1]!, multiplier: 1, currency: "USD", checkedAt,
    })).toBeUndefined();
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])("does not fabricate rates for multiplier %s", multiplier => {
    expect(scopedCatalogMediaPricing(fixture.row, { supplierSiteUrl: origin, group: groups[1]!, multiplier, checkedAt })).toBeUndefined();
  });
});

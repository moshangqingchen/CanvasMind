import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cangyuanCatalogFromPricing } from "./cangyuan-catalog";
import { modelPriceAmount } from "@super-canvas/providers/media-billing";

const fixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/cangyuan-image-size-20261018.json", import.meta.url), "utf8")) as {
  pricingSource: { checkedAt: string };
  prices: { id: string; customDimensions: Record<string, number | boolean>; record: Record<string, unknown> }[];
};
describe("Cangyuan current account UI bounds stay exact-fullID evidence through catalog projection", () => {
  it.each(fixture.prices)("reads $id's own structured fields, preserves its current per-request tariff and roundtrips", row => {
    const catalog = cangyuanCatalogFromPricing({ data: [row.record], group_ratio: { IMAGE: 1 } }, fixture.pricingSource.checkedAt);
    const model = catalog.groups.IMAGE.find(m => m.id === row.id)!;
    const evidence = model.metadata?.cangyuanCatalogDimensionEvidence as Record<string, unknown>;
    expect(evidence).toMatchObject({ modelId: row.id, sourceUrl: "https://ai.cangyuansuanli.cn/api/pricing", checkedAt: fixture.pricingSource.checkedAt,
      status: "matches-exact-schema", conflictKeys: [] });
    expect(evidence.normalizedBounds).toEqual(model.metadata?.imageCustomDimensionRules);
    expect(model.pricing).toBeDefined();
    expect(modelPriceAmount(model.pricing!, { n: 1, quality: "high" })).toBe(row.record.model_price);
    expect(modelPriceAmount(model.pricing!, { n: 1, quality: "max" })).toBe(Number(row.record.model_price) * (row.record.billing_mode === "tiered_expr" ? 2 : 1));
    expect(JSON.parse(JSON.stringify(model)).metadata.cangyuanCatalogDimensionEvidence).toEqual(evidence);
  });
  it("keeps an explicit source conflict instead of granting a different UI bound or transferring it to another ID", () => {
    const row = fixture.prices.find(q => q.id === "gpt-image-2-4k")!;
    const changed = structuredClone(row.record);
    const ui = changed.image_ui_params as { params: { customDimensions: { maxEdge: number } } };
    ui.params.customDimensions.maxEdge = 9999;
    const model = cangyuanCatalogFromPricing({ data: [changed], group_ratio: { IMAGE: 1 } }, fixture.pricingSource.checkedAt).groups.IMAGE.find(m => m.id === row.id)!;
    expect(model.metadata?.cangyuanCatalogDimensionEvidence).toMatchObject({ status: "conflicts-with-exact-schema", conflictKeys: ["maximumEdge"] });
    expect(model.parameters?.find(p => p.key === "size")?.max).toBe(3840);
    expect(model.metadata?.imageCustomDimensionRules).toMatchObject({ maximumEdge: 3840 });
  });
});

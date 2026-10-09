import { describe, expect, it } from "vitest";
import { parseHangChatPrices } from "./hang-catalog-pricing.js";
import { modelPriceAmount } from "./media-billing.js";

const origin = "https://api.hangzhale.com", checkedAt = "2026-10-09T05:46:00Z";
const row = { group_name: "GPT 稳定", model_name: "gpt-5.5", enabled: true, input_price: 1.25, output_price: 7.5,
  cache_input_price: .125, cache_create_price: 0, cache_create_price_1h: .5, group_multiplier: .25,
  original_input_price: 5, original_output_price: 30, note: null };
const payload = (...models: unknown[]) => ({ success: true, data: { currency: "CNY", price_unit: "per_1m_tokens", models } });
describe("Hang independent official chat board", () => {
  it("joins exact group/fullID and preserves effective cache rates without multiplying originals again", () => {
    const result = parseHangChatPrices(payload(row, { ...row, group_name: "GPT 快速", input_price: .95, output_price: 5.7 }), origin, checkedAt);
    expect(result.complete).toBe(true);
    expect(result.rows.map(r => [r.group, r.modelId])).toEqual([["GPT 稳定", "gpt-5.5"], ["GPT 快速", "gpt-5.5"]]);
    expect(result.rows[0]!.pricing.tiers?.map(t => t.price)).toEqual([1.25, 7.5, .125, 0, .5]);
    expect(result.rows[1]!.pricing.tiers?.map(t => t.price)).toEqual([.95, 5.7, .125, 0, .5]);
    expect(result.rows[0]!.pricing.inputPerMillion).toBeUndefined();
    expect(modelPriceAmount(result.rows[0]!.pricing, {})).toBeUndefined();
    expect(result.rows[0]!.pricing.sourceUrl).toBe("https://price.hangzhale.com/api/provider/pricing");
  });
  it("keeps ambiguous media rows untouched and rejects conflicting duplicate or unknown currency/rates", () => {
    expect(parseHangChatPrices(payload({ ...row, model_name: "gpt-image-2" }), origin, checkedAt).rows).toEqual([]);
    const conflict = parseHangChatPrices(payload(row, { ...row, input_price: 2 }, row), origin, checkedAt);
    expect(conflict).toEqual({ complete: false, rows: [] });
    for (const bad of [{ ...row, input_price: "1.25" }, { ...row, note: "conditional peak rate" }, { ...row, cache_input_price: -1 }])
      expect(parseHangChatPrices(payload(bad), origin, checkedAt)).toEqual({ complete: false, rows: [] });
    for (const supplierSiteUrl of ["https://other.example", "https://user@api.hangzhale.com", "http://api.hangzhale.com", "https://api.hangzhale.com/gateway"])
      expect(parseHangChatPrices(payload(row), supplierSiteUrl, checkedAt).rows).toEqual([]);
    expect(parseHangChatPrices({ data: { currency: "USD", price_unit: "per_1m_tokens", models: [row] } }, origin, checkedAt).rows).toEqual([]);
  });
});

import type { StructuredModelPricing } from "./contracts.js";
import { tokenComponentPricing } from "./media-billing.js";

export const HANG_PRICE_URL = "https://price.hangzhale.com/api/provider/pricing";
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export function isHangCatalogSource(siteUrl: string | undefined): boolean {
  try {
    const url = new URL(siteUrl ?? "");
    return url.origin === "https://api.hangzhale.com" && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

/** The independent official board publishes effective CNY/1M rates. Its
 * multiplier/original_* fields are evidence, not additional price factors.
 * Image rows have contradictory UI/account units and must remain untouched.
 */
export function parseHangChatPrices(payload: unknown, supplierSiteUrl: string, checkedAt: string): {
  complete: boolean; rows: { group: string; modelId: string; pricing: StructuredModelPricing; priceLabel: string }[];
} {
  const root = record(payload), data = record(root?.data);
  const empty = { complete: false, rows: [] };
  if (!isHangCatalogSource(supplierSiteUrl) || root?.success === false || root?.error ||
    data?.currency !== "CNY" || data.price_unit !== "per_1m_tokens" || !Array.isArray(data.models)) return empty;
  const rows = new Map<string, { group: string; modelId: string; pricing: StructuredModelPricing; priceLabel: string }>();
  const conflicts = new Set<string>();
  let complete = true;
  for (const value of data.models) {
    const raw = record(value);
    if (!raw || typeof raw.model_name !== "string" || typeof raw.group_name !== "string" || !raw.model_name.trim() || !raw.group_name.trim()) { complete = false; continue; }
    if (raw.enabled !== true || /image|video|seedance|veo|wan|music|suno/iu.test(raw.model_name)) continue;
    // A note may introduce a condition this unit decoder does not understand.
    if (raw.note !== undefined && raw.note !== null && raw.note !== "") { complete = false; continue; }
    const rates = [];
    let valid = true;
    for (const [field, label, tokenKind] of [["input_price", "输入", "input"], ["output_price", "输出", "output"],
      ["cache_input_price", "缓存读取", "cache_read"], ["cache_create_price", "缓存写入", "cache_write"],
      ["cache_create_price_1h", "缓存写入 1h", "cache_write_1h"]] as const) {
      if (raw[field] === undefined || raw[field] === null) continue;
      const price = raw[field];
      if (typeof price !== "number" || !Number.isFinite(price) || price < 0) { valid = false; break; }
      rates.push({ id: field, label, tokenKind, price });
    }
    const priced = valid ? tokenComponentPricing(rates, { currency: "CNY", checkedAt, confidence: "exact", sourceUrl: HANG_PRICE_URL }) : undefined;
    if (!priced) { complete = false; continue; }
    const key = JSON.stringify([raw.group_name, raw.model_name]), current = rows.get(key);
    if (conflicts.has(key)) continue;
    if (current && JSON.stringify(current.pricing) !== JSON.stringify(priced.pricing)) { complete = false; rows.delete(key); conflicts.add(key); continue; }
    rows.set(key, { group: raw.group_name, modelId: raw.model_name, ...priced });
  }
  return { complete, rows: [...rows.values()] };
}

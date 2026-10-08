import type { StructuredModelPricing, StructuredPriceTier } from "./contracts.js";
import { mediaPricingLabel } from "./media-billing.js";

const sites = new Set(["https://api.eaheng.com", "https://ai.whyshy.cn"]);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const amount = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const present = (value: unknown) => value !== undefined && value !== null;

function officialSource(siteUrl?: string): string | undefined {
  try {
    const url = new URL(siteUrl ?? "");
    return sites.has(url.origin) && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash ? url.origin : undefined;
  } catch { return undefined; }
}

export function isSub2apiPlazaPricingSource(siteUrl?: string): boolean {
  return officialSource(siteUrl) !== undefined;
}

function hasTimePrices(value: unknown): boolean {
  if (!present(value)) return false;
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const periods = record(value).periods;
  return present(periods) && (!Array.isArray(periods) || periods.length > 0);
}

/** These two official model plazas display USD account-ledger rates with their
 * imported dollar formatter. Payment currency and recharge discounts are separate:
 * never divide a model rate using a description's advertised cash price.
 * The table uses user_rate_multiplier ?? rate_multiplier, or the independent
 * image multiplier for image rows. Apply that one selected multiplier once.
 * https://api.eaheng.com/model-plaza · https://ai.whyshy.cn/model-plaza
 * Unknown time/peak/volume conditions remain unpriced rather than become flat.
 */
export function sub2apiPlazaPricing(value: unknown, groupValue: unknown, options: {
  supplierSiteUrl?: string; checkedAt?: string;
}): { pricing: StructuredModelPricing; priceLabel: string } | undefined {
  const origin = officialSource(options.supplierSiteUrl);
  if (!origin) return undefined;
  const row = record(value), raw = record(row.pricing), group = record(groupValue);
  const id = row.id ?? row.model_name ?? row.model ?? row.name;
  if (typeof id !== "string" || !id.trim()) return undefined;
  for (const currency of [row.currency, raw.currency, group.currency]) if (present(currency) && currency !== "USD") return undefined;
  for (const flag of [group.image_rate_independent, group.peak_rate_enabled]) if (present(flag) && typeof flag !== "boolean") return undefined;
  if (group.peak_rate_enabled === true || hasTimePrices(row.time_pricing) || hasTimePrices(raw.time_pricing)) return undefined;
  const mode = raw.billing_mode;
  if (mode !== "image" && mode !== "per_request" && mode !== "token") return undefined;
  const multiplier = amount(mode === "image" && group.image_rate_independent === true
    ? group.image_rate_multiplier ?? 1 : group.user_rate_multiplier ?? group.rate_multiplier);
  if (multiplier === undefined) return undefined;
  const scaled = (value: unknown, unit = 1) => {
    const n = amount(value);
    const result = n === undefined ? undefined : Number((n * unit * multiplier).toPrecision(10));
    return result !== undefined && Number.isFinite(result) ? result : undefined;
  };
  const base = { currency: "USD", checkedAt: options.checkedAt ?? "", confidence: "exact" as const,
    sourceUrl: `${origin}/api/v1/model-plaza` };
  if (present(raw.intervals) && !Array.isArray(raw.intervals)) return undefined;
  const intervals = Array.isArray(raw.intervals) ? raw.intervals : [];
  if (mode === "token") {
    const reasoning = raw.reasoning_effort_multipliers;
    if (intervals.length || (present(reasoning) && (!reasoning || typeof reasoning !== "object" || Array.isArray(reasoning) || Object.keys(reasoning).length))) return undefined;
    const rates: [string, string, number][] = [];
    for (const [field, label] of [["input_price", "输入"], ["output_price", "输出"], ["cache_write_price", "缓存写入"],
      ["cache_write_1h_price", "缓存写入 1h"], ["cache_read_price", "缓存读取"]] as const) {
      if (!present(raw[field])) continue;
      const price = scaled(raw[field], 1_000_000);
      if (price === undefined) return undefined;
      rates.push([field, label, price]);
    }
    if (!rates.length) return undefined;
    const conditional = rates.some(([field]) => field.startsWith("cache_"));
    const tiers: StructuredPriceTier[] = rates.map(([field, label, price]) => ({ id: field, label, price, conditionMode: "all",
      conditions: [{ parameter: "token_kind", operator: "equals", value: field.replace(/_price$/u, "") }] }));
    const inputPerMillion = rates.find(([field]) => field === "input_price")?.[2];
    const outputPerMillion = rates.find(([field]) => field === "output_price")?.[2];
    return { pricing: { ...base, kind: "token", ...(conditional ? { tiers }
      : { ...(inputPerMillion === undefined ? {} : { inputPerMillion }), ...(outputPerMillion === undefined ? {} : { outputPerMillion }) }) },
      priceLabel: rates.map(([, label, price]) => `${label} $${price}/1M tokens`).join(" · ") };
  }
  const billingUnit = mode === "image" ? "image" as const : "request" as const;
  const tiers: StructuredPriceTier[] = [];
  for (const value of intervals) {
    const tier = record(value), label = typeof tier.tier_label === "string" ? tier.tier_label.trim().toUpperCase() : "";
    if (mode !== "image" || !/^(?:1K|2K|4K)$/u.test(label) ||
      (tier.min_tokens !== undefined && tier.min_tokens !== 0) || (tier.max_tokens !== undefined && tier.max_tokens !== null)) return undefined;
    const price = scaled(tier.per_request_price);
    if (price === undefined) return undefined;
    const duplicate = tiers.find(t => t.id === label);
    if (duplicate && duplicate.price !== price) return undefined;
    if (!duplicate) tiers.push({ id: label, label, dimension: "resolution", value: label, price });
  }
  if (tiers.length) {
    // Even equal resolution rates retain their scope: an undeclared resolution
    // cannot silently receive a quote or become a supported generation parameter.
    const pricing: StructuredModelPricing = { ...base, kind: "tiered", billingUnit, tiers };
    return { pricing, priceLabel: mediaPricingLabel(pricing) };
  }
  const unitAmount = scaled(raw.per_request_price);
  if (unitAmount === undefined) return undefined;
  const pricing: StructuredModelPricing = { ...base, kind: mode === "image" ? "per-image" : "per-request", billingUnit, unitAmount };
  return { pricing, priceLabel: `$${unitAmount}/${mode === "image" ? "张" : "请求"}` };
}

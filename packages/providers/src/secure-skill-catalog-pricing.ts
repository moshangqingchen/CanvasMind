import type { StructuredModelPricing, StructuredPriceTier } from "./contracts.js";

const site = "https://token.secure-skill.com";
const models = new Set([
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
  "doubao-seedance-2-5-260628",
]);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const amount = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Secure Skill's own price page converts these fields from CNY/token to CNY/1M
 * tokens, then applies the group multiplier once. Its USD conversion is only
 * an original-price hint, not another multiplier on the current charge.
 * https://token.secure-skill.com/pricing
 * Preserve reference-video/resolution conditions; never substitute official
 * list prices for an unconfigured field or turn token rates into a task quote.
 */
export function secureSkillCatalogPricing(value: unknown, options: {
  supplierSiteUrl?: string; multiplier?: number; checkedAt?: string;
}): { pricing: StructuredModelPricing; priceLabel: string } | undefined {
  try {
    const url = new URL(options.supplierSiteUrl ?? "");
    if (url.origin !== site || url.pathname !== "/" || url.username || url.password || url.search || url.hash) return undefined;
  } catch { return undefined; }
  const row = record(value), raw = record(row.pricing);
  const id = row.id ?? row.model_name ?? row.model ?? row.name;
  if (typeof id !== "string" || !models.has(id) || raw.billing_mode !== "token") return undefined;
  // A new token-volume tier schema needs its own contract; flat rates cannot
  // override an additional interval that this decoder cannot yet represent.
  if (raw.intervals !== undefined && raw.intervals !== null && (!Array.isArray(raw.intervals) || raw.intervals.length)) return undefined;
  for (const currency of [raw.currency, row.currency]) if (currency !== undefined && currency !== null && currency !== "CNY" && currency !== "RMB") return undefined;
  const multiplier = options.multiplier ?? 1;
  if (!Number.isFinite(multiplier) || multiplier < 0) return undefined;
  const scaled = (value: unknown) => {
    const price = amount(value);
    if (price === undefined) return undefined;
    const result = Number((price * 1_000_000 * multiplier).toPrecision(12));
    return Number.isFinite(result) ? result : undefined;
  };
  const tiers: StructuredPriceTier[] = [];
  const add = (field: string, label: string, resolution?: string, referenceVideo?: boolean) => {
    const price = scaled(raw[field]);
    if (price === undefined) return;
    tiers.push({ id: field, label, price, conditionMode: "all", conditions: [
      { parameter: "token_kind", operator: "equals", value: field === "input_price" ? "input" : "output" },
      ...(resolution ? [{ parameter: "resolution", operator: "equals" as const, value: resolution }] : []),
      ...(referenceVideo !== undefined ? [{ parameter: "has_reference_video", operator: "equals" as const, value: String(referenceVideo) }] : []),
    ] });
  };
  add("input_price", "输入");
  for (const [resolution, suffix] of [["480p", "_480p"], ["720p", ""], ["1080p", "_1080p"], ["4K", "_4k"]] as const) {
    add(`output_price${suffix}`, `${resolution} · 不含参考视频`, resolution, false);
    add(`reference_video_output_price${suffix}`, `${resolution} · 含参考视频`, resolution, true);
  }
  if (!tiers.length) return undefined;
  return {
    // Token tiers are CNY/1M output/input tokens, not media request prices.
    // Do not populate a flat output rate: it would lose the reference and
    // resolution conditions in consumers that only understand fixed tokens.
    pricing: { kind: "token", currency: "CNY", tiers,
      checkedAt: options.checkedAt ?? "", sourceUrl: `${site}/api/v1/pricing/channels`, confidence: "exact" },
    priceLabel: tiers.map(tier => `${tier.label} ¥${tier.price}/1M tokens`).join("；"),
  };
}

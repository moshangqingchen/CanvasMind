import type { StructuredModelPricing, StructuredPriceTier } from "./contracts.js";
import { mediaPricingLabel, tokenComponentPricing } from "./media-billing.js";

const site = "https://token.secure-skill.com";
const models = new Set([
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
  "doubao-seedance-2-5-260628",
]);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const amount = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
function officialSource(supplierSiteUrl?: string): boolean {
  try {
    const url = new URL(supplierSiteUrl ?? "");
    return url.origin === site && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

/** Exact video-directory declarations from the official price page. This is
 * an output fact only; it supplies no generation endpoint or Key permission.
 */
export function secureSkillCatalogVideoDeclaration(modelId: unknown, platform: unknown, supplierSiteUrl?: string): boolean {
  return officialSource(supplierSiteUrl) && (platform === "flow2" && modelId === "omni" ||
    platform === "newtoken-sd" && (modelId === "video-2.0-fast" || modelId === "video-2.0-pro"));
}

/** Secure Skill's own price page converts these fields from CNY/token to CNY/1M
 * tokens, then applies the group multiplier once. Its USD conversion is only
 * an original-price hint, not another multiplier on the current charge.
 * https://token.secure-skill.com/pricing
 * Preserve reference-video/resolution conditions; never substitute official
 * list prices for an unconfigured field or turn token rates into a task quote.
 */
export function secureSkillCatalogPricing(value: unknown, options: {
  supplierSiteUrl?: string; multiplier?: number; checkedAt?: string; group?: unknown;
}): { pricing: StructuredModelPricing; priceLabel: string } | undefined {
  if (!officialSource(options.supplierSiteUrl)) return undefined;
  const row = record(value), raw = record(row.pricing);
  const id = row.id ?? row.model_name ?? row.model ?? row.name;
  if (typeof id !== "string" || !id.trim()) return undefined;
  for (const currency of [raw.currency, row.currency]) if (currency !== undefined && currency !== null && currency !== "CNY" && currency !== "RMB") return undefined;
  const multiplier = options.multiplier ?? 1;
  if (!Number.isFinite(multiplier) || multiplier < 0) return undefined;
  if (["image", "per_request", "per_second"].includes(String(raw.billing_mode))) {
    return mediaPricing(raw, options, multiplier);
  }
  if (raw.billing_mode !== "token") return undefined;
  // A new token-volume tier schema needs its own contract; flat rates cannot
  // override an additional interval that this decoder cannot yet represent.
  if (raw.intervals !== undefined && raw.intervals !== null && (!Array.isArray(raw.intervals) || raw.intervals.length)) return undefined;
  const scaled = (value: unknown) => {
    const price = amount(value);
    if (price === undefined) return undefined;
    const result = Number((price * 1_000_000 * multiplier).toPrecision(12));
    return Number.isFinite(result) ? result : undefined;
  };
  if (!models.has(id)) {
    // Current official chat IDs, not image/video token rows or approximate
    // aliases. Unknown modes and volume tiers above remain fail closed.
    if (!/^(?:gpt-(?:5|6)(?:[.-]|$)[\w.-]*|grok-4\.[567])$/u.test(id)) return undefined;
    const rates = [];
    for (const [field, label, tokenKind] of [["input_price", "输入", "input"], ["output_price", "输出", "output"],
      ["cache_read_price", "缓存读取", "cache_read"], ["cache_write_price", "缓存写入", "cache_write"]] as const) {
      if (raw[field] === undefined || raw[field] === null) continue;
      const price = scaled(raw[field]);
      if (price === undefined) return undefined;
      rates.push({ id: field, label, price, tokenKind });
    }
    return tokenComponentPricing(rates, { currency: "CNY", checkedAt: options.checkedAt ?? "", confidence: "exact",
      sourceUrl: `${site}/api/v1/pricing/channels` });
  }
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

/** The same official page displays media intervals in their declared unit.
 * Resolution labels do not describe token-volume intervals. Group image_price_*
 * fields are final CNY prices in the page, already independent of its multiplier.
 */
function mediaPricing(raw: Record<string, unknown>, options: {
  checkedAt?: string; group?: unknown;
}, multiplier: number): { pricing: StructuredModelPricing; priceLabel: string } | undefined {
  const billingUnit = raw.billing_mode === "image" ? "image" : raw.billing_mode === "per_second" ? "second" : "request";
  const base: Omit<StructuredModelPricing, "kind"> = { currency: "CNY", billingUnit, checkedAt: options.checkedAt ?? "",
    sourceUrl: `${site}/api/v1/pricing/channels`, confidence: "exact" as const };
  const tiers: StructuredPriceTier[] = [];
  const price = (value: unknown, scale = multiplier) => {
    const n = amount(value);
    const scaled = n === undefined ? undefined : Number((n * scale).toPrecision(12));
    return scaled !== undefined && Number.isFinite(scaled) ? scaled : undefined;
  };
  const add = (resolution: string, value: unknown, scale?: number) => {
    const n = price(value, scale);
    if (n === undefined) return false;
    const duplicate = tiers.find(tier => tier.id === resolution);
    if (duplicate) return duplicate.price === n;
    tiers.push({ id: resolution, label: resolution, dimension: "resolution", value: resolution, price: n });
    return true;
  };
  if (billingUnit === "image") {
    const group = record(options.group);
    for (const resolution of ["1K", "2K", "4K"]) {
      const configured = group[`image_price_${resolution.toLowerCase()}`];
      if (configured !== undefined && configured !== null && !add(resolution, configured, 1)) return undefined;
    }
  }
  // Configured group image rates take precedence in the official page. It does
  // not display model intervals or multiply these final rates a second time.
  if (!tiers.length) {
    if (raw.intervals !== undefined && raw.intervals !== null && !Array.isArray(raw.intervals)) return undefined;
    for (const interval of Array.isArray(raw.intervals) ? raw.intervals : []) {
      const tier = record(interval);
      const label = typeof tier.tier_label === "string" ? tier.tier_label.trim() : "";
      const resolution = /^(?:480p|720p|1080p|2160p)$/iu.test(label) ? label.toLowerCase()
        : /^(?:1k|2k|4k)$/iu.test(label) ? label.toUpperCase() : undefined;
      if (!resolution || (tier.min_tokens !== undefined && tier.min_tokens !== 0) ||
        (tier.max_tokens !== undefined && tier.max_tokens !== null) || !add(resolution, tier.per_request_price)) return undefined;
    }
  }
  if (tiers.length) {
    const pricing: StructuredModelPricing = { ...base, kind: "tiered", tiers };
    return { pricing, priceLabel: mediaPricingLabel(pricing) };
  }
  const unitAmount = price(raw.per_request_price);
  if (unitAmount === undefined) return undefined;
  const pricing: StructuredModelPricing = { ...base,
    kind: billingUnit === "image" ? "per-image" : billingUnit === "second" ? "per-second" : "per-request", unitAmount };
  return { pricing, priceLabel: `¥${unitAmount}/${billingUnit === "image" ? "张" : billingUnit === "second" ? "秒" : "请求"}` };
}

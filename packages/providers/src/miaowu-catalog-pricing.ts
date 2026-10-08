import type { StructuredModelPricing, StructuredPriceTier } from "./contracts.js";

const ORIGIN = "https://api.miaowuai.store";
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const amount = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const display = (value: number) => String(Number(value.toPrecision(12)));

export function isMiaowuCatalogSource(siteUrl: string | undefined): boolean {
  try {
    const url = new URL(siteUrl ?? "");
    return url.origin === ORIGIN && !url.username && !url.password && !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname);
  } catch { return false; }
}

/** Only this official catalog's explicit native output schema establishes media
 * classification. Similar model names and reference media inputs are insufficient. */
export function miaowuCatalogMediaKind(value: unknown, siteUrl: string | undefined): "image" | "video" | undefined {
  if (!isMiaowuCatalogSource(siteUrl)) return undefined;
  const row = record(value);
  const image = record(row?.image_api), video = record(row?.video_api);
  if (Boolean(image) === Boolean(video)) return undefined;
  return image ? "image" : "video";
}

/** Native rule prices override NewAPI's chat/token placeholders and headline
 * model_price. The caller has already resolved display currency and the exact
 * group's multiplier; apply that combined multiplier exactly once here. */
export function miaowuCatalogMediaPricing(value: unknown, options: {
  supplierSiteUrl?: string; currency?: string; multiplier?: number; checkedAt?: string;
}): { pricing: StructuredModelPricing; priceLabel: string } | undefined {
  const kind = miaowuCatalogMediaKind(value, options.supplierSiteUrl);
  const row = record(value);
  if (!kind || !row) return undefined;
  const native = record(row[kind === "image" ? "image_api" : "video_api"]);
  const raw = record(native?.pricing);
  if (!raw || Object.keys(raw).some(key => !["unit", "rules", "currency"].includes(key))) return undefined;
  const currency = String(raw.currency ?? record(row.pricing)?.currency ?? row.currency ?? options.currency ?? "USD").toUpperCase();
  if (!["USD", "CNY", "RMB"].includes(currency)) return undefined;
  const declaredCurrency = raw.currency ?? record(row.pricing)?.currency ?? row.currency;
  if (declaredCurrency !== undefined && typeof declaredCurrency !== "string") return undefined;
  // An explicit quote keeps its declared unit. A combined conversion factor
  // cannot be used while labeling the result with another declared currency.
  const canonical = (value: string) => value.toUpperCase() === "RMB" ? "CNY" : value.toUpperCase();
  if (declaredCurrency !== undefined && options.currency !== undefined && canonical(String(declaredCurrency)) !== canonical(options.currency)) return undefined;
  const multiplier = amount(options.multiplier ?? 1);
  if (multiplier === undefined) return undefined;
  const scaled = (value: unknown) => { const price = amount(value); return price !== undefined && Number.isFinite(price * multiplier) ? Number((price * multiplier).toPrecision(12)) : undefined; };
  const perSecond = raw.unit === "per_second";
  if ((raw.unit !== "per_call" && !perSecond) || (kind === "image" && perSecond)) return undefined;
  if (raw.rules !== undefined && !Array.isArray(raw.rules)) return undefined;
  const tiers: StructuredPriceTier[] = [];
  for (const value of (raw.rules as unknown[] | undefined) ?? []) {
    const rule = record(value);
    if (!rule || Object.keys(rule).some(key => !["size", "price", "seconds_max"].includes(key))) return undefined;
    const resolution = typeof rule.size === "string" ? rule.size.trim() : "";
    const price = scaled(rule.price);
    // seconds_max limits the documented output duration; it is not a different
    // price tier or a reason to turn a per-call rate into a per-second rate.
    if (!/^(?:\d+p|[1248]K)$/iu.test(resolution) || price === undefined ||
        rule.seconds_max !== undefined && (amount(rule.seconds_max) === undefined || rule.seconds_max === 0)) return undefined;
    const old = tiers.find(tier => String(tier.value).toLowerCase() === resolution.toLowerCase());
    if (old && old.price !== price) return undefined;
    if (!old) tiers.push({ id: resolution, label: resolution, dimension: "resolution", value: resolution, price });
  }
  const unitAmount = tiers.length ? undefined : row.quota_type === 1 || row.quota_type === "1" ? scaled(row.model_price) : undefined;
  if (!tiers.length && unitAmount === undefined) return undefined;
  const pricing: StructuredModelPricing = { kind: perSecond ? "per-second" : "per-request", billingUnit: perSecond ? "second" : "request",
    currency: currency === "RMB" ? "CNY" : currency, checkedAt: options.checkedAt ?? "", confidence: "exact", sourceUrl: `${ORIGIN}/api/pricing`,
    ...(tiers.length ? { tiers } : { unitAmount: unitAmount! }) };
  const symbol = pricing.currency === "CNY" ? "¥" : "$", unit = perSecond ? "秒" : "次";
  const priceLabel = tiers.length ? tiers.map(tier => `${tier.label} ${symbol}${display(tier.price)}/${unit}`).join(" · ") : `${symbol}${display(unitAmount!)}/${unit}`;
  return { pricing, priceLabel };
}

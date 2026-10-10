import type { StructuredModelPricing, StructuredPriceTier } from "./contracts.js";
import { mediaPricingLabel } from "./media-billing.js";

export const JIASU_PRICING_URL = "https://ai.jiasuapi.com/api/pricing";
type Row = Record<string, unknown>;
const record = (value: unknown): Row | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;
const text = (value: unknown): string => typeof value === "string" ? value.trim().slice(0, 512) : "";
const amount = (value: unknown): number | undefined => {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(value.trim()))) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

export function isJiasuCatalogSource(siteUrl: string | undefined): boolean {
  try {
    const url = new URL(siteUrl ?? "");
    return url.origin === "https://ai.jiasuapi.com" && /^(?:\/v1)?\/?$/u.test(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

/** The exact endpoint declaration distinguishes H3/WAN/sd aliases from agents. */
export function jiasuCatalogMediaKind(value: unknown, siteUrl: string | undefined): "image" | "video" | undefined {
  if (!isJiasuCatalogSource(siteUrl)) return undefined;
  const row = record(value), endpoints = row?.supported_endpoint_types;
  if (!Array.isArray(endpoints)) return undefined;
  const image = endpoints.includes("image-generation"), video = endpoints.includes("openai-video");
  return image !== video ? image ? "image" : "video" : undefined;
}

/** Retain the public schema, never account/session fields, for dynamic contracts. */
export function jiasuCatalogRecord(value: unknown): {
  apiParameters: Row[]; description: string; supportedEndpointTypes: string[]; billingUsageSchema?: Row;
} {
  const row = record(value);
  let parameters: unknown = row?.api_parameters;
  if (typeof parameters === "string" && parameters.length <= 65_536) {
    try { parameters = JSON.parse(parameters); } catch { parameters = []; }
  }
  const apiParameters = Array.isArray(parameters) ? parameters.slice(0, 64).flatMap(value => {
    const parameter = record(value);
    if (!parameter || !text(parameter.name)) return [];
    return [Object.fromEntries(Object.entries(parameter).filter(([key, value]) =>
      ["name", "type", "required", "default", "range", "description"].includes(key) &&
      ["string", "number", "boolean"].includes(typeof value)))];
  }) : [];
  return { apiParameters, description: typeof row?.description === "string" ? row.description.slice(0, 8192) : "",
    supportedEndpointTypes: Array.isArray(row?.supported_endpoint_types) ? row.supported_endpoint_types.map(text).filter(Boolean).slice(0, 16) : [],
    ...(record(row?.billing_usage_schema) ? { billingUsageSchema: record(row?.billing_usage_schema)! } : {}) };
}

export function jiasuCatalogMediaPricing(value: unknown, options: {
  supplierSiteUrl?: string | undefined; group: string; groupMultiplier: number;
  currency?: string | undefined; currencyMultiplier?: number | undefined; checkedAt?: string | undefined;
}): { pricing: StructuredModelPricing; priceLabel: string; evidence: "video-final" | "video-billing" | "model-price" } | undefined {
  const kind = jiasuCatalogMediaKind(value, options.supplierSiteUrl), row = record(value);
  if (!kind || !row || !Array.isArray(row.enable_groups) || !row.enable_groups.includes(options.group)) return undefined;
  const native = record(row.video_pricing), legacy = record(row.video_billing);
  const explicitCurrency = text(native?.currency ?? legacy?.currency ?? row.currency);
  const currency = (explicitCurrency || options.currency || "USD").toUpperCase();
  const conversion = explicitCurrency ? 1 : options.currencyMultiplier ?? 1;
  if (!["CNY", "RMB", "USD"].includes(currency) || !Number.isFinite(conversion) || conversion <= 0 ||
    !Number.isFinite(options.groupMultiplier) || options.groupMultiplier < 0) return undefined;
  const base = { currency, checkedAt: options.checkedAt ?? "", confidence: "exact" as const, sourceUrl: JIASU_PRICING_URL };
  const make = (tiers: StructuredPriceTier[], unit: "request" | "second", multiplier: number,
    evidence: "video-final" | "video-billing"): ReturnType<typeof jiasuCatalogMediaPricing> => {
    const adjusted = tiers.map(tier => ({ ...tier, price: Number((tier.price * multiplier).toPrecision(12)) }));
    if (!adjusted.length || adjusted.some(tier => !Number.isFinite(tier.price)) || new Set(adjusted.map(tier => tier.id)).size !== adjusted.length) return undefined;
    const pricing: StructuredModelPricing = { ...base, kind: "tiered", billingUnit: unit, tiers: adjusted };
    return { pricing, priceLabel: mediaPricingLabel(pricing), evidence };
  };
  if (kind === "video" && native?.enabled === true) {
    if (native.final_price !== true || native.mode !== native.unit || !["per_second", "per_request", "per_million_tokens"].includes(String(native.unit))) return undefined;
    // Official final prices already include the group rate. A wildcard is an
    // explicit default; a named group's price must never fall back to VIP.
    const groups = record(native.by_group), selected = record(groups?.[options.group] ?? groups?.["*"]);
    if (!selected || !Array.isArray(selected.tiers)) return undefined;
    if (selected.tiers.length) {
      if (native.unit === "per_million_tokens") return undefined; // Requires the upstream usage contract.
      const tiers: StructuredPriceTier[] = [];
      for (const value of selected.tiers) {
        const tier = record(value), resolution = text(tier?.resolution), price = amount(tier?.price);
        if (!tier || !resolution || price === undefined || Object.keys(tier).some(key => !["resolution", "price", "duration_seconds"].includes(key))) return undefined;
        const duration = tier.duration_seconds === undefined || tier.duration_seconds === 0 ? undefined : amount(tier.duration_seconds);
        if (tier.duration_seconds !== undefined && tier.duration_seconds !== 0 && (!duration || !Number.isInteger(duration))) return undefined;
        tiers.push(duration === undefined ? { id: resolution, label: resolution, dimension: "resolution", value: resolution, price } : {
          id: `${resolution}-${duration}`, label: `${resolution} ${duration}s`, price, conditionMode: "all", conditions: [
            { parameter: "resolution", operator: "equals", value: resolution }, { parameter: "duration", operator: "equals", value: String(duration) },
          ],
        });
      }
      return make(tiers, native.unit === "per_second" ? "second" : "request", conversion, "video-final");
    }
    // An empty per-request override is a documented fallback to this model's
    // own request price. Empty per-second/Token tiers cannot use that fallback.
    if (native.unit !== "per_request") return undefined;
  } else if (kind === "video" && legacy?.enabled === true) {
    if (!["per_second", "per_item"].includes(String(legacy.unit)) || !Array.isArray(legacy.tiers)) return undefined;
    const tiers: StructuredPriceTier[] = [];
    for (const value of legacy.tiers) {
      const tier = record(value), resolution = text(tier?.key);
      const price = amount(tier?.[legacy.unit === "per_item" ? "price_per_item" : "price_per_second"]);
      if (!tier || !resolution || price === undefined || Object.keys(tier).some(key => !["key", "price_per_second", "price_per_item"].includes(key))) return undefined;
      tiers.push({ id: resolution, label: resolution, dimension: "resolution", value: resolution, price });
    }
    return make(tiers, legacy.unit === "per_second" ? "second" : "request", options.groupMultiplier * conversion, "video-billing");
  }
  // A published usage schema explicitly makes price depend on resolution and
  // references. Neither model_ratio nor an empty model_price encodes that matrix.
  if (record(row.billing_usage_schema) && Object.keys(record(row.billing_usage_schema)!).length || row.billing_mode === "tiered_expr") return undefined;
  if (row.quota_type !== 1 && row.quota_type !== "1") return undefined;
  const price = amount(row.model_price);
  if (price === undefined) return undefined;
  const unitAmount = Number((price * options.groupMultiplier * conversion).toPrecision(12));
  if (!Number.isFinite(unitAmount)) return undefined;
  const pricing: StructuredModelPricing = { ...base, kind: "per-request", billingUnit: "request", unitAmount };
  const symbol = currency === "USD" ? "$" : "¥";
  return { pricing, priceLabel: `${symbol}${unitAmount}/请求`, evidence: "model-price" };
}

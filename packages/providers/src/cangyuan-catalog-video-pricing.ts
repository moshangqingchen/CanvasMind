import type { StructuredModelPricing } from "./contracts.js";
import { mediaExpressionPricing, mediaPricingLabel } from "./media-billing.js";

const currentExpressionIds = new Set([
  "sd16-seedance-2.5-2", "sd17-seedance-2.0-4", "sd17-seedance-2.5-4",
  "sd11-seedance-2.0", "sd11-seedance-2.0-fast", "sd11-seedance-2.0-mini", "sd11-seedance-2.5",
  "mm2-minimax-h3", "mm2-minimax-h3-max", "wan4-wan3.0", "kl1-kling-3.0",
]);

const changedIds = new Set([
  "gv4-grok-imagine-video-1.5", "mm4-minimax-h3-2k",
  "sd16-seedance-2.0", "sd16-seedance-2.0-fast", "sd16-seedance-2.0-mini",
  "sd17-seedance-2.0", "sd17-seedance-2.0-2", "sd17-seedance-2.0-3",
  "sd17-seedance-2.5", "sd17-seedance-2.5-2", "sd17-seedance-2.5-3",
  "sd10-seedance-2.5", "sd8-seedance-2.5-s",
]);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Keep today's per-request video rates distinct from seconds and unresolved
 * SD16 image-shaped expressions. Caller supplies the exact account multiplier.
 */
export function cangyuanCatalogVideoPricing(value: unknown, options: {
  supplierSiteUrl?: string | undefined; group: string; multiplier: number; currency?: string | undefined; checkedAt?: string | undefined;
}): { pricing?: StructuredModelPricing; priceLabel: string; metadata: Record<string, unknown> } | undefined {
  try {
    const url = new URL(options.supplierSiteUrl ?? "");
    if (url.origin !== "https://ai.cangyuansuanli.cn" || url.username || url.password || url.search || url.hash || !/^(?:\/v1)?\/?$/u.test(url.pathname)) return undefined;
  } catch { return undefined; }
  const row = record(value), id = String(row.model_name ?? "");
  if ((!changedIds.has(id) && !currentExpressionIds.has(id)) || !Array.isArray(row.enable_groups) || !row.enable_groups.includes(options.group) ||
    !Number.isFinite(options.multiplier) || options.multiplier < 0) return undefined;
  const metadata: Record<string, unknown> = { cangyuanVideoPricingSource: "https://ai.cangyuansuanli.cn/api/pricing",
    cangyuanVideoPricingCheckedAt: options.checkedAt ?? "", cangyuanVideoPricingGroup: options.group,
    cangyuanRawVideoPricing: { model_price: row.model_price, billing_mode: row.billing_mode,
      billing_expr: row.billing_expr, billing_capability: row.billing_capability, request_unit: row.request_unit },
    ...(row.video_ui_params ? { cangyuanVideoUiParams: row.video_ui_params } : {}),
  };
  const currency = String(row.currency ?? options.currency ?? "CNY").toUpperCase();
  if (!["CNY", "RMB", "USD"].includes(currency)) return undefined;
  if (currentExpressionIds.has(id) && row.billing_mode === "tiered_expr") {
    // The exact current video rows declare their capability. n counts requests;
    // vs measures output seconds. Neither quota_type nor a model's name decides it.
    const second = row.request_unit === "second";
    const expression = typeof row.billing_expr === "string" ? row.billing_expr : "";
    if (row.billing_capability !== "video" ||
      second !== /\bvs\b/u.test(expression) ||
      row.request_unit !== undefined && !["second", "request", "call"].includes(String(row.request_unit))) return undefined;
    const pricing = mediaExpressionPricing(expression, { currency, multiplier: options.multiplier,
      checkedAt: options.checkedAt ?? "", sourceUrl: "https://ai.cangyuansuanli.cn/api/pricing", unit: second ? "second" : "request" });
    return pricing ? { pricing, priceLabel: mediaPricingLabel(pricing), metadata } : undefined;
  }
  if (id.startsWith("sd16-") && row.billing_mode === "tiered_expr") {
    return { priceLabel: "—", metadata: { ...metadata, supplierPriceConflict: true,
      priceContractWarning: "同一型号目录金额与 billing_expr 基档金额不同，且 billing_capability 标为 image；保留原始证据，确认计价单位前不推算总额。" } };
  }
  const raw = row.model_price;
  if (row.billing_mode !== "per_request" || typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || !Number.isFinite(raw * options.multiplier)) return undefined;
  const amount = Number((raw * options.multiplier).toPrecision(12));
  return { pricing: { kind: "per-request", billingUnit: "request", unitAmount: amount, currency,
    checkedAt: options.checkedAt ?? "", sourceUrl: "https://ai.cangyuansuanli.cn/api/pricing", confidence: "exact" },
    priceLabel: `${currency === "USD" ? "$" : "¥"}${amount}/次`, metadata };
}

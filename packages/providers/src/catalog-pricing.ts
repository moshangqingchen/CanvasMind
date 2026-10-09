import { mediaExpressionPricing, mediaPricingLabel } from "./media-billing.js";
import type { StructuredModelPricing } from "./contracts.js";
type Row = Record<string, unknown>;
const record = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
const amount = (v: unknown): number | undefined => {
  if (typeof v !== "number" && (typeof v !== "string" || !v.trim()))
    return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 256) : undefined;
const display = (n: number) => String(Number(n.toPrecision(10)));

/** Exact official catalog conventions which cannot be inferred from quota_type. */
export function scopedCatalogMediaPricing(value: unknown, options: {
  supplierSiteUrl?: string | undefined; group: string; multiplier: number; currency?: string | undefined; checkedAt?: string | undefined;
}): { pricing: StructuredModelPricing; priceLabel: string } | undefined {
  let origin: string;
  try {
    const url = new URL(options.supplierSiteUrl ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !/^(?:\/v1)?\/?$/u.test(url.pathname)) return undefined;
    origin = url.origin;
  } catch { return undefined; }
  const row = record(value), id = text(row.model_name ?? row.id ?? row.name);
  if (!id || !Number.isFinite(options.multiplier) || options.multiplier < 0) return undefined;
  const currency = (text(row.currency ?? options.currency) ?? "USD").toUpperCase();
  if (!["USD", "CNY", "RMB"].includes(currency)) return undefined;
  const base = { currency, checkedAt: options.checkedAt ?? "", confidence: "exact" as const, sourceUrl: `${origin}/api/pricing` };
  if (origin === "https://platform.frimodel.com" && (row.quota_type === 1 || row.quota_type === "1") && !row.billing_mode && !row.billing_expr) {
    const raw = amount(row.model_price);
    if (raw === undefined || !Number.isFinite(raw * options.multiplier)) return undefined;
    const unit = text(row.request_unit);
    if (unit && !["request", "image", "per_request", "per_image"].includes(unit)) return undefined;
    const image = unit === "image" || unit === "per_image";
    const pricing: StructuredModelPricing = { ...base, kind: image ? "per-image" : "per-request", billingUnit: image ? "image" : "request",
      unitAmount: Number((raw * options.multiplier).toPrecision(12)) };
    const symbol = currency === "USD" ? "$" : "¥";
    return { pricing, priceLabel: `${symbol}${display(pricing.unitAmount!)}/${image ? "张" : "请求"}` };
  }
  if (origin !== "https://api.3365api.cn" || options.group !== "图片视频模型综合分组" ||
    !["minimax-h3", "seedance2.0", "seedance2.5"].includes(id) || row.quota_type !== 1 ||
    typeof row.tags !== "string" || !row.tags.split(",").includes("按秒计费") || typeof row.description !== "string" ||
    !row.description.includes("按时长计费。") || !row.description.endsWith("额度/秒。")) return undefined;
  const quote = row.description.split("按时长计费。")[1]!.slice(0, -1);
  const entries = [...quote.matchAll(/(480p|720p|768p|1080p|2K|4K)\s+(\d+(?:\.\d+)?)(?:额度\/秒)?/gu)];
  if (!entries.length || quote.replace(/(480p|720p|768p|1080p|2K|4K)\s+(\d+(?:\.\d+)?)(?:额度\/秒)?/gu, "").replace(/[、，,\s]/gu, "") ||
    new Set(entries.map(entry => entry[1])).size !== entries.length) return undefined;
  const tiers = entries.map(entry => ({ id: entry[1]!, label: entry[1]!, dimension: "resolution" as const, value: entry[1]!,
    price: Number((Number(entry[2]) * options.multiplier).toPrecision(12)) }));
  if (tiers.some(tier => !Number.isFinite(tier.price))) return undefined;
  const pricing: StructuredModelPricing = { ...base, kind: "tiered", billingUnit: "second", tiers };
  return { pricing, priceLabel: mediaPricingLabel(pricing) };
}

/** Preserve explicit labels; decode numeric prices only with their declared billing mode.
 * New API's documented units: ModelPrice is USD; token input is ModelRatio * $2/1M.
 * https://doc.newapi.pro/api/fei-public-info/
 */
export function catalogPriceLabel(
  value: unknown,
  options: { newApi?: boolean; multiplier?: number; currency?: string } = {},
): string | undefined {
  const row = record(value),
    pricing = record(row.pricing ?? row.billing);
  const explicit =
    text(
      row.price_label ?? row.priceLabel ?? pricing.label ?? pricing.priceLabel,
    ) ??
    (typeof row.price === "string" && amount(row.price) === undefined
      ? text(row.price)
      : undefined);
  if (explicit) return explicit;
  const multiplier = options.multiplier ?? 1;
  if (!Number.isFinite(multiplier) || multiplier < 0) return undefined;
  const currency = (
    text(pricing.currency ?? row.currency ?? options.currency) ??
    (options.newApi ? "USD" : undefined))?.toUpperCase();
  const symbol =
    currency === "CNY" || currency === "RMB"
      ? "¥"
      : currency === "USD"
        ? "$"
        : currency
          ? `${currency} `
          : "";
  const suffix = currency ? "" : "（币种未注明）";
  const money = (v: number) => Number.isFinite(v * multiplier) ? `${symbol}${display(v * multiplier)}` : undefined;
  const videoPricing = record(record(row.video_api).pricing);
  const unit = text(
    videoPricing.unit ?? row.request_unit ?? pricing.unit ?? pricing.kind ?? pricing.billing_mode ?? row.billing_mode,
  )?.toLowerCase().replace(/[\s-]+/gu, "_");
  if (row.billing_mode === "tiered_expr") {
    const media = mediaExpressionPricing(row.billing_expr, {
      currency: currency ?? "币种未注明", multiplier, checkedAt: "",
      unit: unit === "image" || unit === "per_image" ? "image" : unit === "second" || unit === "per_second" ? "second" : "request",
    });
    return media ? mediaPricingLabel(media) : "按条件/用量计费，详见供应商规则";
  }
  const quotaType = row.quota_type === 0 || row.quota_type === "0" ? 0 : row.quota_type === 1 || row.quota_type === "1" ? 1 : undefined;
  if (options.newApi && quotaType === 0) {
    const input = amount(row.model_ratio),
      completion = amount(row.completion_ratio);
    if (input !== undefined) {
      const inputPrice = money(input * 2), outputPrice = completion === undefined ? undefined : money(input * 2 * completion);
      return inputPrice && (completion === undefined || outputPrice) ? `输入 ${inputPrice}/1M${outputPrice ? ` · 输出 ${outputPrice}/1M` : ""}${suffix}` : undefined;
    }
  }
  const input = amount(
    pricing.inputPerMillion ??
      pricing.input_per_million ??
      row.input_price_per_million,
  );
  const output = amount(
    pricing.outputPerMillion ??
      pricing.output_per_million ??
      row.output_price_per_million,
  );
  if (input !== undefined || output !== undefined) {
    if ((input !== undefined && !money(input)) || (output !== undefined && !money(output))) return undefined;
    return (
      [
        input === undefined ? "" : `输入 ${money(input)}/1M`,
        output === undefined ? "" : `输出 ${money(output)}/1M`,
      ]
        .filter(Boolean)
        .join(" · ") + suffix
    );
  }
  // A token-mode placeholder model_price=0 is not a free per-request price.
  if (options.newApi && quotaType === 0) return undefined;
  const raw = amount(
    pricing.unitAmount ?? pricing.unit_price ?? pricing.per_request_price ?? row.model_price ?? row.price,
  );
  const label =
    unit &&
    (
      {
        image: "张",
        per_image: "张",
        second: "秒",
        seconds: "秒",
        per_second: "秒",
        request: "请求",
        requests: "请求",
        call: "请求",
        per_call: "请求",
        generation: "请求",
        per_request: "请求",
      } as Record<string, string>
    )[unit];
  if (
    raw !== undefined &&
    (label || (options.newApi && quotaType === 1))
  )
    return money(raw) ? `${money(raw)}/${label ?? "请求"}${suffix}` : undefined;
  const tiers = Array.isArray(pricing.tiers) ? pricing.tiers : [];
  const tierLabels = tiers.flatMap((v) => {
    const tier = record(v),
      price = amount(tier.price);
    const name = text(tier.label ?? tier.id);
    return price !== undefined && name && money(price) ? [`${name} ${money(price)}`] : [];
  });
  return tierLabels.length ? tierLabels.join(" · ") + suffix : undefined;
}

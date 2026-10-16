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

/** The current Chentu plaza supplies video rates separately from model_price.
 * Billing resolution labels are price conditions, not generation capabilities.
 * Dollar-denominated prose must not silently become a CNY numeric estimate.
 */
export function chentuCatalogVideoPricing(value: unknown, options: {
  supplierSiteUrl?: string | undefined; group: string; multiplier: number; currency?: string | undefined; checkedAt?: string | undefined;
}): { pricing?: StructuredModelPricing; priceLabel: string; billingLabel: string; metadata: Record<string, unknown> } | undefined {
  try {
    const url = new URL(options.supplierSiteUrl ?? "");
    if (url.origin !== "https://tu.988236.xyz" || url.username || url.password || url.search || url.hash || !/^(?:\/v1)?\/?$/u.test(url.pathname)) return undefined;
  } catch { return undefined; }
  const row = record(value), units = record(row.video_unit_prices);
  if (!Object.keys(units).length || !Array.isArray(row.enable_groups) || !row.enable_groups.includes(options.group) ||
    !Number.isFinite(options.multiplier) || options.multiplier < 0 || !["per_second", "per_request"].includes(String(row.billing_mode))) return undefined;
  const mode = String(row.billing_mode), second = mode === "per_second", rates = record(units[mode]);
  const resolutionRates = record(rates.resolutions), entries = Object.entries(resolutionRates);
  const base = amount(rates.base), sourceUrl = "https://tu.988236.xyz/api/pricing", checkedAt = options.checkedAt ?? "";
  const description = typeof row.description === "string" ? row.description.trim() : "";
  const currency = String(row.currency ?? options.currency ?? "CNY").toUpperCase();
  const dollarProse = /\$\s*\d+(?:\.\d+)?\s*\/s\b/u.test(description) || /按秒\s*\$\s*\d+(?:\.\d+)?/u.test(description);
  const conflict = dollarProse && currency !== "USD";
  const includesInput = second && /输出\s*\+\s*参考视频/u.test(description);
  const metadata: Record<string, unknown> = {
    chentuVideoUnitPrices: units, chentuBillingUsageSchema: record(row.billing_usage_schema),
    chentuPricingDescription: description, chentuPriceSourceUrl: sourceUrl, chentuPriceCheckedAt: checkedAt,
    ...(includesInput ? { billingIncludesInputDuration: true } : {}),
  };
  const valid = ["USD", "CNY", "RMB"].includes(currency) &&
    (entries.length ? entries.every(([resolution, price]) => /^[\w.-]{1,30}$/u.test(resolution) && amount(price) !== undefined && Number.isFinite(amount(price)! * options.multiplier)) : base !== undefined && Number.isFinite(base * options.multiplier));
  if (!valid) return { priceLabel: description, billingLabel: second ? "按秒计费" : "按次计费",
    metadata: { ...metadata, chentuVideoPricingIncomplete: true, priceUnavailableReason: "当前视频分档报价未完整读取" } };
  if (conflict) {
    const rawQuotes = description.match(/\d+[pPkK]\s*\$\s*\d+(?:\.\d+)?\s*\/s\b/gu);
    return { priceLabel: rawQuotes?.join(" · ") || description, billingLabel: includesInput ? "输出与参考视频按秒计费，音频不计" : "仅输出时长按秒计费",
      metadata: { ...metadata, chentuCurrencyConflict: true, supplierPriceConflict: true,
        priceContractWarning: "供应商型号说明使用美元，站点金额显示使用人民币；保留说明原价，暂不换算或计算总价。" } };
  }
  const pricing: StructuredModelPricing = { kind: entries.length ? "tiered" : second ? "per-second" : "per-request",
    currency, billingUnit: second ? "second" : "request", sourceUrl, checkedAt, confidence: "exact",
    ...(entries.length ? { tiers: entries.map(([resolution, price]) => ({ id: resolution, label: resolution,
      dimension: "resolution" as const, value: resolution, price: Number((amount(price)! * options.multiplier).toPrecision(12)) })) }
      : { unitAmount: Number((base! * options.multiplier).toPrecision(12)) }) };
  const symbol = currency === "USD" ? "$" : "¥", unit = second ? "秒" : "请求";
  return { pricing, priceLabel: entries.length ? mediaPricingLabel(pricing) : `${symbol}${display(pricing.unitAmount!)}/${unit}`,
    billingLabel: includesInput ? "输出与参考视频按秒计费，音频不计" : second ? "按秒计费" : "按次计费", metadata };
}

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
  const cyberSeconds = ["minimax-h3", "seedance2.0", "seedance2.5"].includes(id);
  const cyberRequests = ["nano-banana-pro", "nano-banana2", "veo3.1", "veo3.1-fast", "veo3.1-lite"].includes(id);
  // This exact public row lists both groups and states its own resolution/second
  // rates. Do not turn its quota_type=1 placeholder into a per-request rate in
  // the special group, or borrow the membership/rates of another model row.
  const cyberGroup = id === "seedance2.5"
    ? ["图片视频模型综合分组", "特价seedance2.0"].includes(options.group) &&
      Array.isArray(row.enable_groups) && row.enable_groups.includes(options.group)
    : options.group === "图片视频模型综合分组";
  if (origin !== "https://api.3365api.cn" || !cyberGroup ||
    (!cyberSeconds && !cyberRequests) || row.quota_type !== 1 || typeof row.description !== "string") return undefined;
  const quote = row.description.trim().split(/[。；;]/u).filter(Boolean).at(-1)?.trim();
  const unit = /额度\/(秒|次)$/u.exec(quote ?? "")?.[1];
  if (!quote || unit !== (cyberSeconds ? "秒" : "次")) return undefined;
  const expression = /((?:480p|720p|768p|1080p|1K|2K|4K)(?:\/(?:480p|720p|768p|1080p|1K|2K|4K))*)\s+(\d+(?:\.\d+)?)(?:额度\/(秒|次))?/gu;
  const entries = [...quote.matchAll(expression)];
  if (!entries.length || quote.replace(expression, "").replace(/[、，,\s]/gu, "") ||
    entries.some(entry => entry[3] && entry[3] !== unit)) return undefined;
  const tiers = entries.flatMap(entry => entry[1]!.split("/").map(resolution => ({ id: resolution, label: resolution,
    dimension: "resolution" as const, value: resolution, price: Number((Number(entry[2]) * options.multiplier).toPrecision(12)) })));
  if (new Set(tiers.map(tier => tier.id)).size !== tiers.length) return undefined;
  if (tiers.some(tier => !Number.isFinite(tier.price))) return undefined;
  const pricing: StructuredModelPricing = { ...base, kind: "tiered", billingUnit: cyberSeconds ? "second" : "request", tiers };
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

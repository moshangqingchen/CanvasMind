import type { StructuredModelPricing, StructuredPriceTier } from "./contracts.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const amount = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const display = (value: number) => String(Number(value.toPrecision(10)));

export function isChuangxiangCatalogSource(siteUrl: string | undefined): boolean {
  try { return new URL(siteUrl ?? "").origin === "https://vapi.chuangxiangai.asia"; } catch { return false; }
}

/** The public plaza supplies raw CNY prices and each model's final effective multiplier.
 * Do not multiply the group's displayed multiplier again. Unknown modes stay unknown.
 */
export function chuangxiangCatalogPricing(value: unknown, checkedAt = ""): { pricing: StructuredModelPricing; priceLabel: string; resolutions?: string[] } | undefined {
  const row = record(value), raw = record(row.pricing), video = record(row.video_pricing);
  const multiplier = amount(row.effective_rate_multiplier);
  if (multiplier === undefined) return undefined;
  const money = (value: number) => Number(value * multiplier).toPrecision(12);
  const scaled = (value: unknown) => { const n = amount(value); return n === undefined || !Number.isFinite(n * multiplier) ? undefined : Number(money(n)); };
  const base = { currency: "CNY", checkedAt, confidence: "snapshot" as const, sourceUrl: "https://vapi.chuangxiangai.asia/model-plaza" };
  if (raw.billing_mode === "token") {
    const input = scaled(raw.input_price), output = scaled(raw.output_price);
    if (input === undefined && output === undefined) return undefined;
    const inputPerMillion = input === undefined ? undefined : Number((input * 1e6).toPrecision(12));
    const outputPerMillion = output === undefined ? undefined : Number((output * 1e6).toPrecision(12));
    if ((inputPerMillion !== undefined && !Number.isFinite(inputPerMillion)) || (outputPerMillion !== undefined && !Number.isFinite(outputPerMillion))) return undefined;
    return { pricing: { ...base, kind: "token", ...(inputPerMillion === undefined ? {} : { inputPerMillion }), ...(outputPerMillion === undefined ? {} : { outputPerMillion }) },
      priceLabel: [inputPerMillion === undefined ? "" : `输入 ¥${display(inputPerMillion)}/1M`, outputPerMillion === undefined ? "" : `输出 ¥${display(outputPerMillion)}/1M`].filter(Boolean).join(" · ") };
  }
  const videoMode = video.billing_mode;
  if (videoMode === "per_request" || videoMode === "per_second") {
    const tiers: StructuredPriceTier[] = Object.entries(record(video.prices)).flatMap(([resolution, value]) => {
      const price = scaled(value);
      return price === undefined || !resolution ? [] : [{ id: resolution, label: resolution, dimension: "resolution" as const, value: resolution, price }];
    });
    if (!tiers.length) return undefined;
    const perSecond = videoMode === "per_second";
    return { pricing: { ...base, kind: perSecond ? "per-second" : "per-request", billingUnit: perSecond ? "second" : "request", tiers },
      priceLabel: tiers.map(t => `${t.label} ¥${display(t.price)}/${perSecond ? "秒" : "次"}`).join(" · "), resolutions: tiers.map(t => t.id) };
  }
  if (raw.billing_mode !== "image" && raw.billing_mode !== "per_request") return undefined;
  const unitAmount = scaled(raw.per_request_price);
  const image = raw.billing_mode === "image";
  const tiers: StructuredPriceTier[] = (Array.isArray(raw.intervals) ? raw.intervals : []).flatMap(value => {
    const interval = record(value), price = scaled(interval.per_request_price), label = typeof interval.tier_label === "string" ? interval.tier_label.trim() : "";
    return price === undefined || !label ? [] : [{ id: label, label, price, ...(image && /^(?:1|2|4)k$/iu.test(label) ? { dimension: "resolution" as const, value: label } : {}) }];
  });
  if (unitAmount === undefined && !tiers.length) return undefined;
  const unit = image ? "张" : "请求";
  return { pricing: { ...base, kind: image ? "per-image" : "per-request", billingUnit: image ? "image" : "request", ...(unitAmount === undefined ? {} : { unitAmount }), ...(tiers.length ? { tiers } : {}) },
    priceLabel: tiers.length ? tiers.map(t => `${t.label} ¥${display(t.price)}/${unit}`).join(" · ") : `¥${display(unitAmount!)}/${unit}` };
}

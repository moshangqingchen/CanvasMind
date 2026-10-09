import type { StructuredModelPricing, StructuredPriceTier } from "./contracts.js";
import { tokenComponentPricing } from "./media-billing.js";

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
    if (raw.intervals !== undefined && raw.intervals !== null && !Array.isArray(raw.intervals)) return undefined;
    const components = (source: Record<string, unknown>) => {
    const rates = [];
    for (const [field, label, tokenKind] of [["input_price", "输入", "input"], ["output_price", "输出", "output"],
      ["cache_read_price", "缓存读取", "cache_read"], ["cache_write_price", "缓存写入 5m", "cache_write"],
      ["cache_write_1h_price", "缓存写入 1h", "cache_write_1h"]] as const) {
      if (source[field] === undefined || source[field] === null) continue;
      const price = scaled(source[field]);
      if (price === undefined) return undefined;
      const perMillion = Number((price * 1e6).toPrecision(12));
      if (!Number.isFinite(perMillion)) return undefined;
      rates.push({ id: field, label, tokenKind, price: perMillion });
    }
    return rates;
    };
    if (Array.isArray(raw.intervals) && raw.intervals.length) {
      const tiers: StructuredPriceTier[] = [], labels: string[] = [], seen = new Set<string>();
      for (const value of raw.intervals) {
        const interval = record(value), label = typeof interval.tier_label === "string" ? interval.tier_label.trim() : "";
        // Preserve the supplier's named context conditions. Do not infer a
        // boundary from overlapping min/max values or choose a cheaper tier.
        if (!label || label.length > 80 || seen.has(label) || amount(interval.min_tokens) === undefined ||
          interval.max_tokens !== null && (amount(interval.max_tokens) === undefined || Number(interval.max_tokens) < Number(interval.min_tokens))) return undefined;
        const rates = components(interval);
        const priced = rates && tokenComponentPricing(rates, base);
        if (!priced) return undefined;
        seen.add(label); labels.push(`${label}：${priced.priceLabel}`);
        for (const rate of rates!) tiers.push({ id: `${label}:${rate.id}`, label: `${label} · ${rate.label}`, price: rate.price,
          conditionMode: "all", conditions: [{ parameter: "token_kind", operator: "equals", value: rate.tokenKind },
            { parameter: "token_context_tier", operator: "equals", value: label }] });
      }
      return { pricing: { ...base, kind: "token", tiers }, priceLabel: labels.join("；") };
    }
    const rates = components(raw);
    if (!rates) return undefined;
    return tokenComponentPricing(rates, base);
  }
  const videoMode = video.billing_mode;
  if (videoMode === "per_request" || videoMode === "per_second") {
    const prices = record(video.prices);
    const fixed = videoMode === "per_request" ? scaled(prices.per_request) : undefined;
    const tiers: StructuredPriceTier[] = Object.entries(prices).flatMap(([resolution, value]) => {
      // SD8 has one flat per-task price. This reserved billing key is not a
      // supported output resolution and must not become a resolution selector.
      if (resolution === "per_request") return [];
      const price = scaled(value);
      return price === undefined || !resolution ? [] : [{ id: resolution, label: resolution, dimension: "resolution" as const, value: resolution, price }];
    });
    if (!tiers.length && fixed === undefined) return undefined;
    const perSecond = videoMode === "per_second";
    return { pricing: { ...base, kind: perSecond ? "per-second" : "per-request", billingUnit: perSecond ? "second" : "request", ...(fixed === undefined ? {} : { unitAmount: fixed }), ...(tiers.length ? { tiers } : {}) },
      priceLabel: tiers.length ? tiers.map(t => `${t.label} ¥${display(t.price)}/${perSecond ? "秒" : "次"}`).join(" · ") : `¥${display(fixed!)}/次`,
      ...(tiers.length ? { resolutions: tiers.map(t => t.id) } : {}) };
  }
  if (raw.billing_mode !== "image" && raw.billing_mode !== "per_request") return undefined;
  if (raw.billing_mode === "per_request" && ["midjourney-1k", "midjourney-2k"].includes(String(row.name ?? row.id ?? "")) &&
    Array.isArray(raw.intervals) && raw.intervals.length) {
    const tiers: StructuredPriceTier[] = [], seen = new Set<string>();
    for (const value of raw.intervals) {
      const interval = record(value), speed = typeof interval.tier_label === "string" ? interval.tier_label.trim() : "";
      const price = scaled(interval.per_request_price);
      if (!["relax", "fast"].includes(speed) || seen.has(speed) || price === undefined) return undefined;
      seen.add(speed);
      tiers.push({ id: speed, label: speed, price, conditionMode: "all",
        conditions: [{ parameter: "speed", operator: "equals", value: speed }] });
    }
    if (!seen.has("relax") || !seen.has("fast")) return undefined;
    return { pricing: { ...base, kind: "per-request", billingUnit: "request", tiers },
      priceLabel: tiers.map(t => `${t.label} ¥${display(t.price)}/请求`).join(" · ") };
  }
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

import type { StructuredModelPricing, StructuredPriceTier } from "./contracts.js";
import { tokenComponentPricing } from "./media-billing.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const amount = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const display = (value: number) => String(Number(value.toPrecision(10)));

/** Only the documented whole-hour Shanghai windows are decoded. An unknown
 * schedule must not silently become an unconditional base quote. */
function timeMultipliers(value: unknown): StructuredModelPricing["timeMultipliers"] | false {
  if (value === undefined || value === null) return undefined;
  const time = record(value);
  if (time.timezone !== "Asia/Shanghai" || typeof time.weekdays_only !== "boolean" || !Array.isArray(time.periods) || time.periods.length > 8) return false;
  const windows: NonNullable<StructuredModelPricing["timeMultipliers"]>[number][] = [];
  for (const value of time.periods) {
    const period = record(value), start = /^(\d{2}):00:00$/u.exec(String(period.start_time)), end = /^(\d{2}):00:00$/u.exec(String(period.end_time));
    const multiplier = amount(period.multiplier);
    if (!start || !end || multiplier === undefined) return false;
    const startHour = Number(start[1]), endHour = Number(end[1]);
    if (startHour < 0 || startHour >= endHour || endHour > 24 || windows.some(window => startHour < window.endHour && endHour > window.startHour)) return false;
    windows.push({ timeZone: "Asia/Shanghai", startHour, endHour, multiplier, weekdaysOnly: time.weekdays_only });
  }
  return windows.length ? windows : undefined;
}

export function isChuangxiangCatalogSource(siteUrl: string | undefined): boolean {
  try { return new URL(siteUrl ?? "").origin === "https://vapi.chuangxiangai.asia"; } catch { return false; }
}

const announcedGrokModelIds = new Set([
  "grok-4.5", "grok-4.6", "grok-4.7", "grok-imagine-video", "grok-imagine-video-1.5", "gv3-grok-video-1.5",
]);
/** Announcement 38 is a conditional rejected-request fee, never a success
 * tariff or evidence that a particular request was charged. */
export function chuangxiangRejectedRequestFeeNotice(sourceUrl: string | undefined, modelId: string) {
  try {
    const url = new URL(sourceUrl ?? "");
    if (url.origin !== "https://vapi.chuangxiangai.asia" || url.username || url.password || url.search || url.hash ||
      !/^(?:\/v1)?\/?$/u.test(url.pathname) || !announcedGrokModelIds.has(modelId)) return undefined;
  } catch { return undefined; }
  return {
    supplierSiteUrl: "https://vapi.chuangxiangai.asia",
    announcementId: 38,
    condition: "upstream-security-policy-rejection",
    amount: 0.05,
    currency: "CNY",
    unit: "request",
    text: "供应商公告：Grok 请求因触发上游安全策略被拒绝时，固定收费 ¥0.05/次。此项仅适用于该拒绝条件，未计入本次成功请求报价；具体请求实扣须核对账单。",
    sourceUrl: "https://vapi.chuangxiangai.asia/api/v1/announcements",
    publishedAt: "2026-10-17T20:57:41.883805+08:00",
    sampledAt: "2026-10-17T14:57:32.294Z",
  } as const;
}

/** The public plaza supplies raw CNY prices and each model's final effective multiplier.
 * Do not multiply the group's displayed multiplier again. Unknown modes stay unknown.
 */
export function chuangxiangCatalogPricing(value: unknown, checkedAt = ""): { pricing: StructuredModelPricing; priceLabel: string; resolutions?: string[] } | undefined {
  const row = record(value), raw = record(row.pricing), video = record(row.video_pricing);
  const multiplier = amount(row.effective_rate_multiplier);
  if (multiplier === undefined) return undefined;
  const schedule = timeMultipliers(row.time_pricing);
  if (schedule === false || schedule && raw.billing_mode !== "token") return undefined;
  const timed = (priced: { pricing: StructuredModelPricing; priceLabel: string } | undefined) => priced && ({
    ...priced, pricing: { ...priced.pricing, ...(schedule ? { timeMultipliers: schedule } : {}) },
    priceLabel: priced.priceLabel + (schedule ? `；上海时间${schedule[0]?.weekdaysOnly ? "周一至周五" : "每日"} ${schedule.map(window => `${window.startHour}:00–${window.endHour}:00 ×${window.multiplier}`).join("、")}` : ""),
  });
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
      return timed({ pricing: { ...base, kind: "token", tiers }, priceLabel: labels.join("；") });
    }
    const rates = components(raw);
    if (!rates) return undefined;
    return timed(tokenComponentPricing(rates, base));
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

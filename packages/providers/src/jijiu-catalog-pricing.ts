import type { StructuredModelPricing, StructuredPriceTier } from "./contracts.js";
import { mediaPricingLabel } from "./media-billing.js";

export const JIJIU_PRICING_URL = "https://newapi.jijiucanvas.com/api/pricing";
type Row = Record<string, unknown>;
const record = (value: unknown): Row | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;
const amount = (value: unknown): number | undefined => {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(value.trim()))) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

export function isJijiuCatalogSource(siteUrl: string | undefined): boolean {
  try {
    const url = new URL(siteUrl ?? "");
    return url.origin === "https://newapi.jijiucanvas.com" && /^(?:\/v1)?\/?$/u.test(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

function mediaKind(row: Row): "image" | "video" | undefined {
  const endpoints = Array.isArray(row.supported_endpoint_types) ? row.supported_endpoint_types : [];
  const tags = typeof row.tags === "string" ? row.tags.split(/[,，;；|]/u).map(tag => tag.trim()) : [];
  const image = endpoints.includes("image-generation") || tags.includes("图片模型"), video = endpoints.includes("openai-video") || tags.includes("视频模型");
  return image !== video ? image ? "image" : "video" : undefined;
}

type DecodedExpression = { tiers: StructuredPriceTier[]; unit: "request" | "second"; timeMultipliers?: StructuredModelPricing["timeMultipliers"] };
const numberSource = "(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
const leaf = new RegExp(`^tier\\("([^"\\\\]{1,80})",\\s*u\\("(seconds|videos)"\\)\\s*\\*\\s*(${numberSource})\\s*\\)`, "u");
const condition = /^u\("resolution"\)\s*==\s*"([^"\\]{1,80})"\s*\?\s*/u;
const fixed = new RegExp(`^tier\\("[^"\\\\]{1,80}",\\s*fixed\\(\\s*(${numberSource})\\s*\\)\\s*\\)$`, "u");
const timeSuffix = new RegExp(`\\s*\\*\\s*\\(hour\\("Asia/Shanghai"\\)\\s*>=\\s*18\\s*&&\\s*hour\\("Asia/Shanghai"\\)\\s*<\\s*22\\s*\\?\\s*(${numberSource})\\s*:\\s*1\\)\\s*\\*\\s*\\(hour\\("Asia/Shanghai"\\)\\s*>=\\s*22\\s*\\?\\s*(${numberSource})\\s*:\\s*1\\)\\s*$`, "u");

/** This is a finite documented grammar, not an expression evaluator. */
function decodeExpression(expression: string, row: Row): DecodedExpression | undefined {
  if (expression.length > 4096) return undefined;
  let source = expression.trim();
  let timeMultipliers: StructuredModelPricing["timeMultipliers"];
  const timed = timeSuffix.exec(source);
  if (timed) {
    if (!["MinimaxH3", "Minimax漫剧优化版"].includes(String(row.model_name))) return undefined;
    const evening = amount(timed[1]), late = amount(timed[2]);
    if (evening === undefined || late === undefined) return undefined;
    timeMultipliers = [{ timeZone: "Asia/Shanghai", startHour: 18, endHour: 22, multiplier: evening },
      { timeZone: "Asia/Shanghai", startHour: 22, endHour: 24, multiplier: late }];
    source = source.slice(0, timed.index).trim();
  }
  if (source.startsWith("(") && source.endsWith(")")) source = source.slice(1, -1).trim();
  const constant = fixed.exec(source);
  if (constant) {
    const price = amount(constant[1]);
    return price === undefined || timeMultipliers ? undefined : { unit: "request", tiers: [{ id: "fixed", label: "按次", dimension: "fixed", price }] };
  }
  const declaredResolutions = record(record(row.billing_usage_schema)?.resolution)?.enum;
  const resolutions = Array.isArray(declaredResolutions) && declaredResolutions.length <= 32 && declaredResolutions.every(value => typeof value === "string" && value.length <= 80)
    ? declaredResolutions as string[] : [];
  if (new Set(resolutions).size !== resolutions.length) return undefined;
  const tiers: StructuredPriceTier[] = [];
  let quantity: string | undefined;
  while (source && tiers.length < 32) {
    const predicate = condition.exec(source);
    if (predicate) source = source.slice(predicate[0].length);
    const term = leaf.exec(source);
    if (!term || quantity && quantity !== term[2]) return undefined;
    quantity = term[2];
    const price = amount(term[3]);
    if (price === undefined) return undefined;
    source = source.slice(term[0].length).trim();
    if (predicate) {
      const resolution = predicate[1]!;
      if (!resolutions.includes(resolution) || tiers.some(tier => tier.value === resolution) || !source.startsWith(":")) return undefined;
      tiers.push({ id: resolution, label: term[1]!, dimension: "resolution", value: resolution, price });
      source = source.slice(1).trim();
      continue;
    }
    if (source) return undefined;
    if (tiers.length) {
      // The supplier's final else denotes its one remaining published billing tier.
      // Invalid or missing resolution must not silently receive that price.
      const remaining = resolutions.filter(value => !tiers.some(tier => tier.value === value));
      if (remaining.length !== 1) return undefined;
      tiers.push({ id: remaining[0]!, label: term[1]!, dimension: "resolution", value: remaining[0]!, price });
    } else tiers.push({ id: "fixed", label: "基础", dimension: "fixed", price });
    return { tiers, unit: quantity === "seconds" ? "second" : "request", ...(timeMultipliers ? { timeMultipliers } : {}) };
  }
  return undefined;
}

/** Official docs define CNY expression results × the exact token-group ratio once. */
export function jijiuCatalogMediaPricing(value: unknown, options: {
  supplierSiteUrl?: string | undefined; group: string; groupMultiplier: number; checkedAt?: string | undefined; kind?: "image" | "video" | undefined;
}): { pricing: StructuredModelPricing; priceLabel: string; evidence: "documented-expression" | "model-price" } | undefined {
  const row = record(value);
  if (!isJijiuCatalogSource(options.supplierSiteUrl) || !row || !String(row.model_name ?? "").trim() ||
    !Array.isArray(row.enable_groups) || !row.enable_groups.includes(options.group) || !Number.isFinite(options.groupMultiplier) || options.groupMultiplier < 0) return undefined;
  const kind = options.kind ?? mediaKind(row);
  if (!kind) return undefined;
  const base = { currency: "CNY", checkedAt: options.checkedAt ?? "", confidence: "exact" as const, sourceUrl: JIJIU_PRICING_URL };
  const expression = row.billing_expr;
  if (row.billing_mode === "tiered_expr" || expression !== undefined && expression !== null && expression !== "") {
    if (row.billing_mode !== "tiered_expr" || typeof expression !== "string") return undefined;
    const decoded = decodeExpression(expression, row);
    if (!decoded || kind === "image" && decoded.unit === "second") return undefined;
    const tiers = decoded.tiers.map(tier => ({ ...tier, price: Number((tier.price * options.groupMultiplier).toPrecision(12)) }));
    if (tiers.some(tier => !Number.isFinite(tier.price))) return undefined;
    const pricing: StructuredModelPricing = { ...base, kind: "tiered", billingUnit: decoded.unit, tiers,
      ...(decoded.timeMultipliers ? { timeMultipliers: decoded.timeMultipliers } : {}) };
    const timing = decoded.timeMultipliers ? ` · 上海时间 18:00–22:00 ×${decoded.timeMultipliers[0]!.multiplier}；22:00–24:00 ×${decoded.timeMultipliers[1]!.multiplier}（其他时段 ×1，以提交时刻为准）` : "";
    return { pricing, priceLabel: `${mediaPricingLabel(pricing)}${timing}`, evidence: "documented-expression" };
  }
  if (row.quota_type !== 1 && row.quota_type !== "1") return undefined;
  const price = amount(row.model_price);
  if (price === undefined) return undefined;
  const unitAmount = Number((price * options.groupMultiplier).toPrecision(12));
  if (!Number.isFinite(unitAmount)) return undefined;
  return { pricing: { ...base, kind: "per-request", billingUnit: "request", unitAmount }, priceLabel: `¥${unitAmount}/请求`, evidence: "model-price" };
}

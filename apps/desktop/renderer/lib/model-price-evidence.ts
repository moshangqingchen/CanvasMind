import type { ModelDescriptor, StructuredModelPricing } from "@super-canvas/providers";
import { selectModelQuote } from "@super-canvas/providers/media-billing";
import type { CatalogModelPriceEvidence } from "./catalog-price-observations";
import { modelPickerPriceData } from "./model-picker-data";

export interface ModelPriceEvidenceRow {
  kind: "published" | "historical" | "measured";
  label: string;
  amount: string;
  checkedAt?: string;
  sourceUrl?: string;
  scope?: string;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function source(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try { const url = new URL(value); if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return `${url.origin}${url.pathname}`; } catch { /* Invalid evidence stays text-only. */ }
}
const instant = (value: unknown): string | undefined => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
function pricingLabel(pricing: StructuredModelPricing): string {
  const { evidence: _evidence, tiers, ...billing } = pricing; void _evidence;
  const clean: StructuredModelPricing = { ...billing, ...(tiers ? { tiers: tiers.map(({ evidence: _tierEvidence, ...tier }) => { void _tierEvidence; return tier; }) } : {}) };
  return modelPickerPriceData({ id: "evidence", name: "evidence", operations: [], pricing: clean });
}
function parameterScope(value: unknown): string {
  return Object.entries(object(value)).flatMap(([key, value]) => {
    if (/prompt|url|token|secret|password|cookie|authorization/iu.test(key)) return [];
    if (Array.isArray(value)) return [`${key} 数量=${value.length}`];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean" || typeof value === "string" && /^(?:https?:|data:)/iu.test(value)) return [];
    return [`${key}=${String(value).slice(0, 128)}`];
  }).join(" · ");
}

/** Evidence presentation only. Does not infer a unit, scope, FX rate or estimate. */
export function modelPriceEvidenceRows(model: ModelDescriptor | null | undefined): ModelPriceEvidenceRow[] {
  if (!model) return [];
  const rows: ModelPriceEvidenceRow[] = [], quote = selectModelQuote(model);
  const currentLabel = model.metadata?.customBilling === true ? "自定义计费" : model.metadata?.priceSource === "manual" || model.metadata?.source === "manual" ? "人工保存报价" : "公布价";
  if (quote.pricing) {
    const pricing = quote.pricing;
    if (pricing.tiers?.length) for (const tier of pricing.tiers) {
      const provenance = tier.evidence ?? pricing.evidence, historical = provenance?.status === "retained";
      rows.push({ kind: historical ? "historical" : "published", label: historical ? "上次价格" : currentLabel, amount: pricingLabel({ ...pricing,
        tiers: [tier], ...(pricing.kind !== "token" ? { unitAmount: undefined } : {}) }), checkedAt: instant(provenance?.checkedAt ?? pricing.checkedAt),
      sourceUrl: source(provenance?.sourceUrl ?? pricing.sourceUrl) });
    } else rows.push({ kind: quote.historical ? "historical" : "published", label: quote.historical ? "上次价格" : currentLabel, amount: pricingLabel(pricing),
      checkedAt: instant(pricing.evidence?.checkedAt ?? pricing.checkedAt), sourceUrl: source(pricing.evidence?.sourceUrl ?? pricing.sourceUrl) });
  }
  const evidence = model.metadata?.catalogPriceEvidence as CatalogModelPriceEvidence | undefined;
  if (evidence?.schemaVersion === 1) for (const entry of evidence.entries ?? []) {
    if (entry.status === "explicit-unpublished" && entry.unpublishedCycles >= 3) rows.push({ kind: "published", label: "价格不再公布", amount: "—",
      checkedAt: instant(entry.checkedAt), sourceUrl: source(entry.sourceUrl), ...(entry.operation ? { scope: entry.operation } : {}) });
    for (const item of entry.history) rows.push({ kind: "historical", label: "历史公布价", amount: item.pricing ? pricingLabel(item.pricing) : item.label ?? "—",
      checkedAt: instant(item.checkedAt), sourceUrl: source(item.sourceUrl), ...(entry.operation ? { scope: entry.operation } : {}) });
  }
  const seen = new Set<string>();
  for (const measured of quote.measured) {
    const signature = JSON.stringify(measured); if (seen.has(signature)) continue; seen.add(signature);
    const charge = object(measured.actualCharge), amount = measured.amount ?? charge.amount, currency = measured.currency ?? charge.currency,
      unit = measured.unit ?? charge.unit;
    const verified = measured.parameterScope === "exact" && (typeof measured.requestId === "string" && charge.requestId === measured.requestId ||
      typeof measured.providerTaskId === "string" && charge.taskId === measured.providerTaskId);
    rows.push({ kind: "measured", label: verified ? "账单实测 · 仅对应请求" : "历史扣费记录 · 仅原范围", amount:
      typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? `${amount}${typeof currency === "string" && currency ? " " + currency : " 账户计价单位"}${unit === "image" ? " / 张" : unit === "request" ? " / 次" : unit === "second" ? " / 秒" : ""}` : "—",
      checkedAt: instant(measured.checkedAt), sourceUrl: source(measured.sourceUrl ?? charge.sourceUrl), scope: parameterScope(measured.parameters) || "原请求参数未记录" });
  }
  return rows;
}

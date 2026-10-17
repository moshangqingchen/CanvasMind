import type { ModelDescriptor, ProviderOperation, StructuredModelPricing, StructuredPriceTier } from "./contracts.js";

/** Select the actual matching branch without reordering an ordered tariff. */
export function selectedModelPriceTier(pricing: StructuredModelPricing, parameters: Readonly<Record<string, unknown>>): StructuredPriceTier | undefined {
  if (pricing.tiers?.some(tier => tier.conditions || tier.otherwise)) return pricing.tiers.find(tier => {
    if (tier.otherwise) return true;
    const matches = (condition: NonNullable<StructuredPriceTier["conditions"]>[number]) => {
      const value = String(parameters[condition.parameter] ?? "");
      return condition.operator === "equals" ? value === condition.value : value.includes(condition.value);
    };
    const matched = tier.conditionMode === "all" ? tier.conditions?.every(matches) : tier.conditions?.some(matches);
    return !!tier.conditions && (tier.conditionMode === "none" ? !matched : !!matched);
  });
  const matches = pricing.tiers?.filter(tier => tier.dimension === "fixed" ||
    (tier.dimension && parameters[tier.dimension] !== undefined && String(tier.value).toLowerCase() === String(parameters[tier.dimension]).toLowerCase()));
  return matches?.length === 1 ? matches[0] : undefined;
}

export interface SelectedModelQuote {
  /** Current display may contain accurately labelled historical branches. */
  pricing?: StructuredModelPricing;
  /** Only this shape may enter arithmetic or a fee confirmation. */
  estimatePricing?: StructuredModelPricing;
  amount?: number;
  tier?: StructuredPriceTier;
  historical: boolean;
  measured: readonly Record<string, unknown>[];
}

/** Output capacity is a capability limit, never evidence of included billing units. */
export function catalogRequestBillingCount(model: Pick<ModelDescriptor, "metadata">,
  parameters: Readonly<Record<string, unknown>>, requestedOutputs = 1): number | undefined {
  const value = parameters.n ?? model.metadata?.fixedRequestCount;
  if (value === undefined) return requestedOutputs === 1 ? 1 : undefined;
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : undefined;
}

/** Shared by menus, request previews, batch totals and director preflight.
 * A billed sample is evidence about its original request, not a new fixed quote.
 */
export function selectModelQuote(model: Pick<ModelDescriptor, "pricing" | "metadata"> & Partial<Pick<ModelDescriptor, "operations">>,
  parameters: Readonly<Record<string, unknown>> = {}, options: { operation?: ProviderOperation; at?: Date } = {}): SelectedModelQuote {
  const metadata = model.metadata ?? {}, pricing = model.pricing;
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const measured = [metadata.measuredPrice, ...(Array.isArray(metadata.catalogMeasuredPrices) ? metadata.catalogMeasuredPrices : [])].filter(object);
  const tier = pricing && selectedModelPriceTier(pricing, parameters);
  const provenance = tier?.evidence ?? pricing?.evidence;
  const operation = options.operation ?? (model.operations?.length === 1 ? model.operations[0] : undefined);
  const managed = object(metadata.catalogPriceEvidence) && metadata.catalogPriceEvidence.schemaVersion === 1;
  const protectedPrice = metadata.priceSource === "manual" || !managed && metadata.source === "manual" || metadata.customBilling === true;
  const historical = provenance ? provenance.status === "retained" : metadata.priceStatus === "partial" ||
    typeof metadata.priceLabel === "string" && /（上次价格）$/u.test(metadata.priceLabel);
  const blocked = !pricing || !!provenance?.operations?.length && (!operation || !provenance.operations.includes(operation)) ||
    !protectedPrice && (historical || metadata.priceSource === "generated-result" ||
    ["conflict", "unconfirmed", "failed", "unavailable"].includes(String(metadata.priceStatus)) ||
    metadata.supplierPriceConflict === true ||
    !!operation && Array.isArray(metadata.catalogUnavailablePriceOperations) && metadata.catalogUnavailablePriceOperations.includes(operation) ||
    pricing.kind === "token" && !!pricing.tiers?.some(item => item.evidence?.status === "retained"));
  const amount = !blocked ? modelPriceAmount(pricing!, parameters, options.at) : undefined;
  return { ...(pricing ? { pricing } : {}), ...(!blocked && pricing ? { estimatePricing: pricing } : {}),
    ...(amount !== undefined ? { amount } : {}), ...(tier ? { tier } : {}), historical, measured };
}

/** Rates are already in the supplier's accounting currency per million tokens.
 * A cache quote requires measured usage by component; it must not become a
 * flat input/output estimate when that breakdown is unknown.
 */
export function tokenComponentPricing(rates: readonly { id: string; label: string; price: number; tokenKind: string }[],
  options: Pick<StructuredModelPricing, "currency" | "checkedAt" | "confidence" | "sourceUrl">): { pricing: StructuredModelPricing; priceLabel: string } | undefined {
  if (!rates.length || rates.some(rate => !Number.isFinite(rate.price) || rate.price < 0) || new Set(rates.map(rate => rate.tokenKind)).size !== rates.length) return undefined;
  const conditional = rates.some(rate => rate.tokenKind !== "input" && rate.tokenKind !== "output");
  const input = rates.find(rate => rate.tokenKind === "input"), output = rates.find(rate => rate.tokenKind === "output");
  const symbol = options.currency === "CNY" || options.currency === "RMB" ? "¥" : options.currency === "USD" ? "$" : `${options.currency} `;
  return { pricing: { ...options, kind: "token", ...(conditional ? { tiers: rates.map(rate => ({
    id: rate.id, label: rate.label, price: rate.price, conditionMode: "all" as const,
    conditions: [{ parameter: "token_kind", operator: "equals" as const, value: rate.tokenKind }],
  })) } : { ...(input ? { inputPerMillion: input.price } : {}), ...(output ? { outputPerMillion: output.price } : {}) }) },
  priceLabel: rates.map(rate => `${rate.label} ${symbol}${Number(rate.price.toPrecision(12))}/1M`).join(" · ") };
}

/** Only unconditional component rates can be summarized or aggregated. */
export function tokenComponentRate(pricing: StructuredModelPricing, tokenKind: string): number | undefined {
  if (pricing.kind !== "token" || pricing.timeMultipliers?.length) return undefined;
  const direct = tokenKind === "input" ? pricing.inputPerMillion : tokenKind === "output" ? pricing.outputPerMillion : undefined;
  if (direct !== undefined) return Number.isFinite(direct) && direct >= 0 ? direct : undefined;
  const rates = pricing.tiers?.filter(tier => tier.conditionMode === "all" && tier.conditions?.length === 1 &&
    tier.conditions[0]?.parameter === "token_kind" && tier.conditions[0].operator === "equals" && tier.conditions[0].value === tokenKind);
  return rates?.length === 1 && Number.isFinite(rates[0]!.price) && rates[0]!.price >= 0 ? rates[0]!.price : undefined;
}

// Parse the documented media subset as data. Never evaluate supplier code.
const branch = /^tier\("([^"\\]{1,80})",\s*(n|\(vs\s*==\s*0\s*\?\s*\d+(?:\.\d+)?\s*:\s*vs\))\s*\*\s*(\d+(?:\.\d+)?)\s*\)/u;
const predicate = /param\("(quality|resolution|speed|prompt)"\)\s*==\s*"([^"\\]{1,80})"|has\(param\("(quality|resolution|speed|prompt)"\),\s*"([^"\\]{1,80})"\)/gu;

export function mediaExpressionPricing(expression: unknown, options: {
  currency: string; multiplier?: number; checkedAt: string; sourceUrl?: string;
  unit: "image" | "request" | "second";
}): StructuredModelPricing | undefined {
  if (typeof expression !== "string" || expression.length > 4096) return undefined;
  const multiplier = options.multiplier ?? 1;
  if (!Number.isFinite(multiplier) || multiplier < 0) return undefined;
  let remaining = expression.trim();
  const tiers: StructuredPriceTier[] = [];
  let billingUnit = options.unit;
  let quantity: string | undefined;
  while (remaining && tiers.length < 20) {
    let conditions: StructuredPriceTier["conditions"];
    let conditionMode: StructuredPriceTier["conditionMode"];
    const fallback = remaining.startsWith('tier("');
    if (!fallback) {
      const question = remaining.indexOf("?");
      if (question < 0) return undefined;
      let condition = remaining.slice(0, question).trim();
      conditionMode = condition.startsWith("!") ? "none" : "any";
      if (conditionMode === "none") condition = condition.slice(1).trim();
      if (condition.startsWith("(") && condition.endsWith(")")) condition = condition.slice(1, -1).trim();
      const matches = [...condition.matchAll(predicate)];
      if (!matches.length || condition.replace(predicate, "P").replace(/\s/gu, "") !== matches.map(() => "P").join("||")) return undefined;
      conditions = matches.map(match => ({
        parameter: match[1] ?? match[3]!,
        operator: match[1] ? "equals" as const : "contains" as const,
        value: match[2] ?? match[4]!,
      }));
      remaining = remaining.slice(question + 1).trim();
    }
    const result = branch.exec(remaining);
    if (!result) return undefined;
    const branchQuantity = result[2] === "n" ? "count" : "seconds";
    if (quantity && quantity !== branchQuantity) return undefined;
    quantity = branchQuantity;
    if (quantity === "seconds") billingUnit = "second";
    const price = Number((Number(result[3]) * multiplier).toPrecision(12));
    if (!Number.isFinite(price)) return undefined;
    tiers.push({ id: result[1]!, label: result[1]!, price,
      ...(conditions ? { conditions, conditionMode: conditionMode! } : { otherwise: true }),
    });
    remaining = remaining.slice(result[0].length).trim();
    if (fallback) {
      if (remaining) return undefined;
      return { kind: "tiered", currency: options.currency, billingUnit, tiers,
        checkedAt: options.checkedAt, ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}), confidence: "exact" };
    }
    if (!remaining.startsWith(":")) return undefined;
    remaining = remaining.slice(1).trim();
  }
  return undefined;
}

function untimedModelPriceAmount(pricing: StructuredModelPricing, parameters: Readonly<Record<string, unknown>>): number | undefined {
  if (pricing.tiers?.some(tier => tier.conditions || tier.otherwise)) {
    for (const tier of pricing.tiers) {
      if (tier.otherwise) return tier.price;
      const match = (condition: NonNullable<StructuredPriceTier["conditions"]>[number]) => {
        const value = String(parameters[condition.parameter] ?? "");
        return condition.operator === "equals" ? value === condition.value : value.includes(condition.value);
      };
      const matched = tier.conditionMode === "all" ? tier.conditions?.every(match) : tier.conditions?.some(match);
      if (tier.conditions && (tier.conditionMode === "none" ? !matched : matched)) return tier.price;
    }
    return undefined;
  }
  const matches = pricing.tiers?.filter(tier => tier.dimension === "fixed" ||
    (tier.dimension && parameters[tier.dimension] !== undefined && String(tier.value).toLowerCase() === String(parameters[tier.dimension]).toLowerCase()));
  return matches?.length === 1 ? matches[0]!.price : pricing.unitAmount;
}

export function modelPriceAmount(pricing: StructuredModelPricing, parameters: Readonly<Record<string, unknown>>, at = new Date()): number | undefined {
  const amount = untimedModelPriceAmount(pricing, parameters);
  if (amount === undefined || pricing.timeMultipliers === undefined) return amount;
  if (!Array.isArray(pricing.timeMultipliers) || !Number.isFinite(at.getTime()) || pricing.timeMultipliers.length > 8) return undefined;
  // Asia/Shanghai uses UTC+8; the clock is supplied by the caller, never request parameters.
  const local = new Date(at.getTime() + 8 * 60 * 60 * 1000);
  const hour = local.getUTCHours(), weekday = local.getUTCDay();
  let multiplier = 1;
  for (const window of pricing.timeMultipliers) {
    if (!window || typeof window !== "object" || window.timeZone !== "Asia/Shanghai" || !Number.isInteger(window.startHour) || !Number.isInteger(window.endHour) ||
      window.startHour < 0 || window.startHour >= window.endHour || window.endHour > 24 ||
      !Number.isFinite(window.multiplier) || window.multiplier < 0 ||
      window.weekdaysOnly !== undefined && typeof window.weekdaysOnly !== "boolean") return undefined;
    if (hour >= window.startHour && hour < window.endHour && (!window.weekdaysOnly || weekday > 0 && weekday < 6)) multiplier *= window.multiplier;
  }
  const result = Number((amount * multiplier).toPrecision(12));
  return Number.isFinite(result) ? result : undefined;
}

export function mediaPricingLabel(pricing: StructuredModelPricing): string {
  const symbol = pricing.currency === "CNY" || pricing.currency === "RMB" ? "¥" : pricing.currency === "USD" ? "$" : `${pricing.currency} `;
  const unit = pricing.billingUnit === "second" ? "秒" : pricing.billingUnit === "request" ? "请求" : "张";
  return (pricing.tiers ?? []).map(tier => `${tier.label === "std" ? "普通质量" : tier.label === "xhigh" ? "xhigh/max" : tier.label} ${symbol}${tier.price}/${unit}`).join(" · ");
}

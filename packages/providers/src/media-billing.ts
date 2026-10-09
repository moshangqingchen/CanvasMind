import type { StructuredModelPricing, StructuredPriceTier } from "./contracts.js";

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
  if (pricing.kind !== "token") return undefined;
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

export function modelPriceAmount(pricing: StructuredModelPricing, parameters: Readonly<Record<string, unknown>>): number | undefined {
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

export function mediaPricingLabel(pricing: StructuredModelPricing): string {
  const symbol = pricing.currency === "CNY" || pricing.currency === "RMB" ? "¥" : pricing.currency === "USD" ? "$" : `${pricing.currency} `;
  const unit = pricing.billingUnit === "second" ? "秒" : pricing.billingUnit === "request" ? "请求" : "张";
  return (pricing.tiers ?? []).map(tier => `${tier.label === "std" ? "普通质量" : tier.label === "xhigh" ? "xhigh/max" : tier.label} ${symbol}${tier.price}/${unit}`).join(" · ");
}

import { modelPriceAmount } from "@super-canvas/providers/media-billing";
import { normalizeTk1688CnyModel } from "@super-canvas/providers/tk1688-catalog";
/** Keeps catalog names readable when they already contain their price label. */
export function appendPriceLabelOnce(
  name: string,
  priceLabel: unknown,
): string {
  if (typeof priceLabel !== "string" || !priceLabel.trim()) return name;
  const price = priceLabel.trim();
  const cleanName = name.replace(/[（(]价格以(?:平台|模型广场)为准(?:·快照)?[）)]/gu, "");
  return cleanName.includes(price) ? cleanName : `${cleanName}（${price}）`;
}

/** Prices belong in the price row; the original full name remains available in details. */
export function cleanModelDisplayName(name: string, priceLabel?: unknown): string {
  let result = name;
  if (typeof priceLabel === "string" && priceLabel.trim()) result = result.replace(`（${priceLabel}）`, "").replace(`(${priceLabel})`, "");
  // Catalogs may call the same unit 次 / 请求; their price row is authoritative.
  result = result.replace(/[（(]\s*[¥￥$]\s*\d+(?:\.\d+)?\s*\/\s*(?:次|请求|张|秒)(?:·快照)?\s*[）)]/gu, "");
  if (typeof priceLabel === "string" && priceLabel.trim()) result = result.replace(` · ${priceLabel.trim()}`, "");
  return result.replace(/[（(](?:价格以(?:平台|模型广场)为准|价格未公布|价格需登录查询)[^）)]*[）)]/gu, "").trim() || name;
}

export function modelPriceSummary(model: import("@super-canvas/providers").ModelDescriptor | undefined, parameters: Readonly<Record<string, unknown>>): string {
  if (!model) return "价格未知";
  model = normalizeTk1688CnyModel(model);
  const pricing = model.pricing;
  const tier = String(parameters.size_tier ?? parameters.resolution ?? parameters.image_size ?? "").toUpperCase()
    || model.parameters?.find(p => p.key === "size")?.options?.find(option => option.value === parameters.size)?.label.match(/\b[124]K\b/iu)?.[0]?.toUpperCase();
  const quality = parameters.quality ?? model.parameters?.find(p => p.key === "quality")?.default;
  const measured = model.metadata?.priceSource === "generated-result" && model.metadata.measuredPrice &&
    typeof model.metadata.measuredPrice === "object" && !Array.isArray(model.metadata.measuredPrice)
    ? model.metadata.measuredPrice as Record<string, unknown> : undefined;
  if (measured && typeof model.metadata?.priceLabel === "string") {
    const previousParameters = measured.parameters && typeof measured.parameters === "object" && !Array.isArray(measured.parameters)
      ? measured.parameters as Record<string, unknown> : {};
    const dimensionChanged = Boolean(tier && measured.resolution && tier !== String(measured.resolution).toUpperCase()) ||
      Boolean(parameters.size !== undefined && previousParameters.size !== undefined && parameters.size !== previousParameters.size);
    const qualityChanged = quality !== undefined && measured.quality !== undefined && String(quality) !== String(measured.quality);
    return `${dimensionChanged || qualityChanged ? "当前组合未测价；上次 " : ""}${model.metadata.priceLabel}`;
  }
  if (pricing) {
    const defaults = Object.fromEntries((model.parameters ?? []).filter(p => p.default !== undefined).map(p => [p.key, p.default]));
    const amount = modelPriceAmount(pricing, { ...defaults, ...parameters, resolution: parameters.resolution ?? (tier || defaults.resolution), quality });
    const unit = pricing.billingUnit === "second" || pricing.kind === "per-second" ? "秒" : pricing.billingUnit === "request" || pricing.kind === "per-request" ? "次" : "张";
    if (amount !== undefined && ["per-image", "per-request", "per-second", "tiered"].includes(pricing.kind)) return `${model.metadata?.tk1688Catalog === true && pricing.currency === "CNY" ? `¥${amount}` : `${amount} ${pricing.currency === "credits" ? "额度" : pricing.currency}`} / ${unit}${pricing.confidence === "exact" ? "" : "（参考）"}`;
    if (pricing.kind === "token") return "按实际用量计费，详见价格说明";
  }
  return typeof model.metadata?.priceLabel === "string" ? model.metadata.priceLabel : "价格未知";
}

/** Compare only the exact model and supported parameter combination in this connection. */
export function comparableModelPrice(models: readonly import("@super-canvas/providers").ModelDescriptor[], id: string | undefined, parameters: Readonly<Record<string, unknown>>): string {
  const model = models.find(item => item.id === id);
  if (!model) return id ? "当前分组无此型号" : "未选择型号";
  if (model.parameters?.some(parameter => parameter.options?.length && parameters[parameter.key] !== undefined &&
    !parameter.options.some(option => String(option.value) === String(parameters[parameter.key])))) return "当前参数不支持";
  const price = modelPriceSummary(model, parameters);
  return price === "价格未知" ? "同型号未报价" : `同型号 ${price}`;
}

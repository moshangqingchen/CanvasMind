import { modelPriceAmount, tokenComponentRate } from "@super-canvas/providers/media-billing";
import { normalizeTk1688CnyModel } from "@super-canvas/providers/tk1688-catalog";
import { getModelParameterDescriptor, validateModelParameters } from "@super-canvas/providers/cli-contracts";
import type { ModelDescriptor } from "@super-canvas/providers";

/** A missing local quote is not evidence that the supplier never published one. */
export function displayPriceLabel(label: unknown, status?: unknown): string {
  if (typeof label === "string" && label.trim() && label.trim() !== "价格未公布") return label;
  if (status === "unauthorized") return "价格需登录查询";
  if (status === "failed") return "价格查询失败";
  if (status === "partial") return "价格目录未完整读取";
  return "暂未取得报价";
}
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
  result = result.replace(/[（(](?:价格以(?:平台|模型广场)为准|价格未公布|价格需登录查询)[^）)]*[）)]/gu, "").trim() || name;
  const annotated = /^(.*?)(\s*(?:[（(]FriModel[）)]|·\s*商家.*))$/iu.exec(result);
  const base = annotated?.[1]?.trim() ?? result;
  const annotation = annotated?.[2] ?? "";
  const image = /^gpt-image-(\d+(?:\.\d+)?)(?:-(flare|sunburst|sunburs))?((?:-(?:[124]k|low|medium|high|xhigh|max|web|x))*)$/iu.exec(base);
  if (image) {
    const variant = image[2] ? (/^flare$/iu.test(image[2]) ? " Flare" : " Sunburst") : "";
    const suffix = image[3]?.split("-").filter(Boolean).map(value => /^[124]k$/iu.test(value) ? value.toUpperCase() : value[0]!.toUpperCase() + value.slice(1).toLowerCase()).join(" ");
    return `GPT Image ${image[1]}${variant}${suffix ? ` ${suffix}` : ""}${annotation}`;
  }
  const banana = /^(?:(N)\s+)?(?:image-)?nano-banana(?:-?(pro|2(?:\.\d+)?))?(?:-(lite))?(?:-([124]k))?$/iu.exec(base);
  if (banana) return `${banana[1] ? "N " : ""}Nano Banana${banana[2] ? banana[2].toLowerCase() === "pro" ? " Pro" : ` ${banana[2]}` : ""}${banana[3] ? " Lite" : ""}${banana[4] ? ` ${banana[4].toUpperCase()}` : ""}${annotation}`;
  const gemini = /^(?:(ad|leo)-)?gemini-(?:(\d+(?:\.\d+)?)-(pro|flash)-image|nano-banana-(2\.1))((?:-(?:preview|as|[124]k))*)$/iu.exec(base);
  if (gemini) {
    const channel = gemini[1] ? `${gemini[1].toUpperCase()} · ` : "";
    const name = gemini[4] ? `Gemini Nano Banana ${gemini[4]}` : `Gemini ${gemini[2]} ${gemini[3]!.toLowerCase() === "pro" ? "Pro" : "Flash"} Image`;
    const suffix = gemini[5]?.split("-").filter(Boolean).map(value => /^as$|^[124]k$/iu.test(value) ? value.toUpperCase() : "Preview").join(" ");
    return `${channel}${name}${suffix ? ` ${suffix}` : ""}${annotation}`;
  }
  return result;
}

function mediaPriceParameters(model: ModelDescriptor, parameters: Readonly<Record<string, unknown>>) {
  if (model.metadata?.sourceVideoPriceMode !== "edit") return { parameters, valid: true };
  const mode = parameters.mode ?? model.parameters?.find(parameter => parameter.key === "mode")?.default;
  const hasVideo = parameters.has_reference_video;
  if ((mode === "generate" && hasVideo === true) || (mode === "edit" && hasVideo === false)) return { parameters, valid: false };
  return { parameters: (mode === undefined || mode === "auto") && typeof hasVideo === "boolean"
    ? { ...parameters, mode: hasVideo ? "edit" : "generate" } : parameters, valid: true };
}

export function modelPriceSummary(model: import("@super-canvas/providers").ModelDescriptor | undefined, parameters: Readonly<Record<string, unknown>>): string {
  if (!model) return "价格未知";
  model = normalizeTk1688CnyModel(model);
  const media = mediaPriceParameters(model, parameters);
  if (!media.valid) return "当前模式与参考视频不匹配";
  parameters = media.parameters;
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
    const sampledResolution = String(measured.resolution ?? previousParameters.resolution ?? "").toUpperCase().replace("×", "X");
    const sampledSize = previousParameters.size ?? (/^\d+X\d+$/u.test(sampledResolution) ? sampledResolution : undefined);
    const dimensionChanged = Boolean(tier && tier !== sampledResolution) ||
      Boolean(parameters.size !== undefined && (sampledSize !== undefined
        ? String(parameters.size).toUpperCase().replace("×", "X") !== String(sampledSize).toUpperCase().replace("×", "X") : !tier));
    const qualityChanged = quality !== undefined && String(quality) !== String(measured.quality ?? previousParameters.quality);
    const billingParameterChanged = ["n", "duration", "seconds", "generate_audio", "mode", "has_reference_video"].some(key => {
      const current = parameters[key] ?? model.parameters?.find(parameter => parameter.key === key)?.default;
      return current !== undefined && String(current) !== String(previousParameters[key]);
    });
    return `${dimensionChanged || qualityChanged || billingParameterChanged ? "当前组合未测价；上次 " : ""}${model.metadata.priceLabel}`;
  }
  if (pricing) {
    const defaults = Object.fromEntries((model.parameters ?? []).filter(p => p.default !== undefined).map(p => [p.key, p.default]));
    const amount = modelPriceAmount(pricing, { ...defaults, ...parameters, resolution: parameters.resolution ?? (tier || defaults.resolution), quality });
    const unit = pricing.billingUnit === "second" || pricing.kind === "per-second" ? "秒" : pricing.billingUnit === "request" || pricing.kind === "per-request" ? "次" : "张";
    if (amount !== undefined && ["per-image", "per-request", "per-second", "tiered"].includes(pricing.kind)) return `${typeof model.metadata?.priceLabel === "string" && model.metadata.priceLabel.endsWith("（上次价格）") ? "上次 " : ""}${model.metadata?.tk1688Catalog === true && pricing.currency === "CNY" ? `¥${amount}` : `${amount} ${pricing.currency === "credits" ? "额度" : pricing.currency}`} / ${unit}${pricing.confidence === "exact" ? "" : "（参考）"}`;
    if (pricing.kind === "token") {
      if (pricing.sourceUrl === "https://token.secure-skill.com/api/v1/pricing/channels" &&
        pricing.tiers?.some(tier => tier.conditions?.some(condition => ["resolution", "has_reference_video"].includes(condition.parameter)))) {
        const resolution = String(parameters.resolution ?? defaults.resolution ?? "").toLowerCase();
        const reference = parameters.has_reference_video;
        // Connected media is not always present in parameter values. Only an
        // explicit reference-video fact can choose the cheaper/different tier.
        const hasReference = reference === true || reference === "true" ? "true" : reference === false || reference === "false" ? "false" : undefined;
        const output = pricing.tiers.filter(tier => Number.isFinite(tier.price) && tier.price >= 0 &&
          tier.conditions?.some(condition => condition.parameter === "token_kind" && condition.value === "output") &&
          (!resolution || tier.conditions?.some(condition => condition.parameter === "resolution" && condition.value.toLowerCase() === resolution)) &&
          (hasReference === undefined || tier.conditions?.some(condition => condition.parameter === "has_reference_video" && condition.value === hasReference)));
        if (!output.length) return "当前分辨率/参考视频组合未报价（按 token 计费）";
        const prices = output.map(tier => tier.price), minimum = Math.min(...prices), maximum = Math.max(...prices);
        const symbol = pricing.currency === "CNY" || pricing.currency === "RMB" ? "¥" : pricing.currency === "USD" ? "$" : `${pricing.currency} `;
        const rate = `${symbol}${minimum}${maximum === minimum ? "" : `–${maximum}`}/1M tokens`;
        const conditions = [!resolution ? "分辨率未确认" : "", hasReference === undefined ? "参考视频条件未确认" : ""].filter(Boolean);
        const previous = typeof model.metadata?.priceLabel === "string" && model.metadata.priceLabel.endsWith("（上次价格）");
        return `${previous ? "上次 " : ""}${resolution ? `${resolution === "4k" ? "4K" : resolution} · ` : ""}${hasReference === undefined ? "输出 " : hasReference === "true" ? "含参考视频 " : "不含参考视频 "}${rate}${conditions.length ? `（${conditions.join("，")}）` : ""}`;
      }
      // Media generation can additionally charge image/video token components;
      // a text input/output pair alone is not its complete quote.
      if (pricing.imageOutputPerMillion !== undefined || model.operations.some(operation =>
        operation.startsWith("image.") || operation.startsWith("video.") || operation === "music.generate"))
        return "按实际用量计费，详见价格说明";
      const input = tokenComponentRate(pricing, "input"), output = tokenComponentRate(pricing, "output");
      const symbol = pricing.currency === "CNY" || pricing.currency === "RMB" ? "¥" : pricing.currency === "USD" ? "$" : `${pricing.currency} `;
      const rates = [input === undefined ? "" : `输入 ${symbol}${input}/1M`, output === undefined ? "" : `输出 ${symbol}${output}/1M`].filter(Boolean);
      const previous = typeof model.metadata?.priceLabel === "string" && model.metadata.priceLabel.endsWith("（上次价格）") ? "上次 " : "";
      const conditions = pricing.tiers?.some(tier => tier.conditions?.some(condition => condition.parameter === "token_context_tier")) ? "上下文档位与用量" : "实际用量";
      return previous + (rates.length ? `${rates.join(" · ")}${pricing.tiers?.some(tier => tier.conditions?.some(condition => condition.parameter === "token_kind" && condition.value.startsWith("cache_"))) ? "（含缓存条件）" : ""}`
        : `按${conditions}计费，详见价格说明`);
    }
  }
  return typeof model.metadata?.priceLabel === "string" ? displayPriceLabel(model.metadata.priceLabel, model.metadata?.priceStatus) : "价格未知";
}

/** A preview of the selected request, separate from the supplier's unit price. */
export function modelEstimatedCost(model: ModelDescriptor | null | undefined, parameters: Readonly<Record<string, unknown>>): string | undefined {
  if (!model || model.metadata?.priceSource === "generated-result" || model.metadata?.priceStatus === "partial") return undefined;
  model = normalizeTk1688CnyModel(model);
  const media = mediaPriceParameters(model, parameters);
  if (!media.valid) return undefined;
  parameters = media.parameters;
  const pricing = model.pricing;
  if (!pricing || !["per-image", "per-request", "per-second", "tiered"].includes(pricing.kind)) return undefined;
  const values = { ...Object.fromEntries((model.parameters ?? []).filter(p => p.default !== undefined).map(p => [p.key, p.default])), ...parameters };
  const declaredValues = Object.fromEntries(Object.entries(values).filter(([key]) => getModelParameterDescriptor(model, key, values)));
  if (model.parameters?.length && !validateModelParameters(model, declaredValues).valid) return undefined;
  const resolution = values.size_tier ?? values.resolution ?? values.image_size;
  const amount = modelPriceAmount(pricing, { ...values, ...(resolution ? { resolution } : {}) });
  if (amount === undefined || !Number.isFinite(amount) || amount < 0) return undefined;
  const perTask = pricing.billingUnit === "request" || pricing.kind === "per-request" || pricing.billingUnit === "second" || pricing.kind === "per-second";
  const count = Number(values.n ?? (perTask ? model.metadata?.fixedRequestCount : model.metadata?.fixedOutputCount) ?? 1);
  if (!Number.isInteger(count) || count < 1) return undefined;
  const perSecond = pricing.billingUnit === "second" || pricing.kind === "per-second";
  const duration = Number(values.duration ?? values.duration_seconds ?? values.seconds);
  if (perSecond && (!Number.isFinite(duration) || duration <= 0 || model.metadata?.approximateVideoDurationSeconds || model.metadata?.billingIncludesInputDuration === true)) return undefined;
  const total = Number((amount * count * (perSecond ? duration : 1)).toPrecision(12));
  return `${total} ${pricing.currency === "credits" ? "额度" : pricing.currency}${pricing.confidence === "exact" ? "" : "（参考）"}`;
}

/** Compare only the exact model and supported parameter combination in this connection. */
export function comparableModelPrice(models: readonly import("@super-canvas/providers").ModelDescriptor[], id: string | undefined, parameters: Readonly<Record<string, unknown>>): string {
  const model = models.find(item => item.id === id);
  if (!model) return id ? "当前分组无此型号" : "未选择型号";
  if (model.parameters?.some(parameter => {
    const resolved = getModelParameterDescriptor(model, parameter.key, parameters);
    return parameters[parameter.key] !== undefined && (!resolved || resolved.options?.length && !resolved.options.some(option => String(option.value) === String(parameters[parameter.key])));
  })) return "当前参数不支持";
  const price = modelPriceSummary(model, parameters);
  return price === "价格未知" ? "同型号未报价" : `同型号 ${price}`;
}

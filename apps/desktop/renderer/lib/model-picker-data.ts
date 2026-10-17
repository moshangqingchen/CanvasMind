import type { ModelDescriptor, StructuredModelPricing, StructuredPriceTier } from "@super-canvas/providers";
import { normalizeTk1688CnyModel } from "@super-canvas/providers/tk1688-catalog";
import { applyUserImageSizePresets } from "@super-canvas/providers/image-size-presets";

const parameterNames: Record<string, string> = {
  duration: "时长", seconds: "时长", duration_seconds: "时长", resolution: "分辨率", size_tier: "档位", image_size: "档位",
  size: "尺寸", aspect_ratio: "比例", aspectRatio: "比例", ratio: "比例", quality: "质量", speed: "速度", mode: "模式",
  fps: "帧率", frame_rate: "帧率", generate_audio: "声音", generateAudio: "声音", audio: "声音", n: "数量",
  output_format: "输出格式", background: "背景", has_reference_video: "参考视频", has_reference_image: "参考图",
  has_reference_audio: "参考音频", token_kind: "Token 类型", token_context_tier: "上下文档位",
  video_input: "视频输入", reference_video_count: "参考视频数量", reference_video_duration_seconds: "参考视频总秒数",
};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const scalar = (value: unknown): string | undefined => typeof value === "string" || typeof value === "boolean" || finite(value) ? String(value) : undefined;

function priceCondition(tier: StructuredPriceTier): string {
  const conditions = tier.conditions?.map(condition => `${parameterNames[condition.parameter] ?? condition.parameter}${condition.operator === "contains" ? "包含" : "="}${condition.value}`);
  if (conditions?.length) return `${tier.conditionMode === "none" ? "除外：" : ""}${conditions.join(tier.conditionMode === "all" ? " 且 " : " 或 ")}`;
  if (tier.otherwise) return "其余条件";
  if (tier.dimension && tier.dimension !== "fixed" && tier.value !== undefined) return `${parameterNames[tier.dimension] ?? tier.dimension}=${String(tier.value)}`;
  return tier.label;
}
function priceUnit(pricing: StructuredModelPricing): string {
  return pricing.kind === "token" ? "1M tokens" : pricing.billingUnit === "second" || pricing.kind === "per-second" ? "秒"
    : pricing.billingUnit === "request" || pricing.kind === "per-request" ? "次" : "张";
}

/** The price sample is independent of the latest directory attempt. */
export function modelPickerPriceSampleAt(model: Pick<ModelDescriptor, "metadata" | "pricing"> | null | undefined): string | undefined {
  for (const value of [model?.metadata?.priceCheckedAt, model?.pricing?.checkedAt, model?.metadata?.supplierCatalogPriceCheckedAt])
    if (typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value))) return value.trim();
}

function historicalPricePrefix(model: ModelDescriptor, label: string): string {
  if (model.metadata?.priceStatus !== "partial" && !/（上次价格）$/u.test(label)) return "";
  // A measured charge remains a separate source, even if an older record is displayed.
  const name = model.metadata?.priceSource === "generated-result" ? "上次记录" : "上次价格";
  const checkedAt = modelPickerPriceSampleAt(model);
  return `${name}${checkedAt ? ` · 采样时间 ${checkedAt}` : name === "上次价格" ? " · 采样时间 —" : ""} · `;
}

/** All recorded prices keep their exact billing conditions and sample scope.
 * This is a directory display. Request validation and cost estimation remain separate.
 */
export function modelPickerPriceData(model: ModelDescriptor | null | undefined): string {
  if (!model) return "—";
  model = applyUserImageSizePresets(normalizeTk1688CnyModel(model));
  const metadata = model.metadata;
  const measured = metadata?.priceSource === "generated-result" ? record(metadata.measuredPrice) : undefined;
  const rawLabel = typeof metadata?.priceLabel === "string" ? metadata.priceLabel.trim() : "";
  const historical = historicalPricePrefix(model, rawLabel);
  const label = historical ? rawLabel.replace(/（上次价格）$/u, "") : rawLabel;
  if (measured && label) {
    const sample = record(measured.parameters);
    const scope = Object.entries(sample ?? {}).filter(([key, value]) => key !== "prompt" && scalar(value) !== undefined &&
      !(typeof value === "string" && /^(?:https?:|data:)/iu.test(value)))
      .map(([key, value]) => `${parameterNames[key] ?? key}=${String(value)}`);
    // Counts and durations are shown; reference URLs and raw prompts are not.
    for (const [key, value] of Object.entries(sample ?? {})) if (Array.isArray(value)) scope.push(`${parameterNames[key] ?? key}数量=${value.length}`);
    return `${historical}${label}${scope.length ? ` · 实测参数：${scope.join("，")}` : ` · 实测请求参数：${sample && Object.keys(sample).length === 0 ? "省略" : "—"}`}`;
  }
  const pricing = model.pricing;
  if (pricing) {
    const currency = pricing.currency === "credits" ? "额度" : pricing.currency;
    const unit = priceUnit(pricing);
    const rates: string[] = [];
    if (finite(pricing.unitAmount) && pricing.unitAmount >= 0) rates.push(`${pricing.unitAmount} ${currency} / ${unit}`);
    if (pricing.kind === "token") for (const [name, amount] of [["输入", pricing.inputPerMillion], ["输出", pricing.outputPerMillion], ["图片输出", pricing.imageOutputPerMillion]] as const)
      if (finite(amount) && amount >= 0) rates.push(`${name} ${amount} ${currency} / ${unit}`);
    for (const tier of pricing.tiers ?? []) if (finite(tier.price) && tier.price >= 0) rates.push(`${priceCondition(tier)} · ${tier.price} ${currency} / ${unit}`);
    const times = pricing.timeMultipliers?.map(window => `上海 ${window.weekdaysOnly ? "周一至周五 " : ""}${window.startHour}:00–${window.endHour}:00 ×${window.multiplier}`).join("；");
    if (rates.length) return `${historical}${rates.join("；")}${pricing.confidence === "estimate" ? "（参考）" : pricing.confidence === "snapshot" ? "（目录快照）" : ""}${times ? `；时段倍率：${times}` : ""}${metadata?.billingIncludesInputDuration === true ? "；计费时长：输入 + 输出视频" : ""}`;
  }
  // Some suppliers publish prose group prices without a structured tariff.
  // Preserve those facts, but never turn absence/status messages into a quote.
  const prose = modelPickerPriceLabelData(label);
  return prose === "—" ? prose : historical + prose;
}

export function modelPickerPriceCompact(model: ModelDescriptor | null | undefined): string {
  const detail = modelPickerPriceData(model);
  if (!model || detail === "—") return "—";
  model = applyUserImageSizePresets(normalizeTk1688CnyModel(model));
  if (model.metadata?.priceSource === "generated-result" && record(model.metadata.measuredPrice) &&
      typeof model.metadata.priceLabel === "string" && model.metadata.priceLabel.trim())
    return detail.replace(/\s*·\s*实测(?:请求)?参数：[\s\S]*$/u, "");
  const pricing = model.pricing;
  if (!pricing) return detail;
  const historical = historicalPricePrefix(model, typeof model.metadata?.priceLabel === "string" ? model.metadata.priceLabel.trim() : "");
  const confidence = pricing.confidence === "estimate" ? "（参考）" : pricing.confidence === "snapshot" ? "（目录快照）" : "";
  const times = pricing.timeMultipliers?.length ? " · 时段倍率" : "";
  if (pricing.kind === "token") return `${historical}Token 计价${confidence}${times}`;
  const tiers = (pricing.tiers ?? []).filter(tier => finite(tier.price) && tier.price >= 0);
  const amounts = tiers.map(tier => tier.price);
  if (finite(pricing.unitAmount) && pricing.unitAmount >= 0) amounts.unshift(pricing.unitAmount);
  if (!amounts.length) return detail;
  const minimum = Math.min(...amounts), maximum = Math.max(...amounts);
  const currency = pricing.currency === "credits" ? "额度" : pricing.currency;
  const scope = amounts.length > 1 ? ` · ${amounts.length} 档` : tiers[0] ? ` · ${priceCondition(tiers[0])}` : "";
  return `${historical}${minimum === maximum ? minimum : `${minimum}–${maximum}`} ${currency} / ${priceUnit(pricing)}${confidence}${scope}${times}${model.metadata?.billingIncludesInputDuration === true ? " · 输入+输出时长" : ""}`;
}

export function modelPickerPriceLabelData(label: unknown): string {
  if (typeof label !== "string" || !label.trim() || /未确认|待确认|待核验|待验证|未验证|不支持|不可运行|未知|未公布|查询失败|需登录|未取得/u.test(label)) return "—";
  return /按.*计费/u.test(label) || /\d/u.test(label) && /[¥￥$]|CNY|USD|RMB|credits|额度|积分|元|\/\s*(?:秒|次|张|1M)|每(?:秒|次|张|百万)|一(?:秒|次|张)/iu.test(label) ? label : "—";
}

export function modelPickerDirectoryFact(model: ModelDescriptor, keyConfirmed: boolean): string | undefined {
  if (model.metadata?.publicCatalogOnly !== true) return;
  return keyConfirmed ? "官网目录 · 当前 Key 返回：0" : "官网目录 · 本次 Key 目录：—";
}

export function modelPickerInventoryFact(model: ModelDescriptor, scanStatus: string, scanComplete?: boolean): { label: string; tone: string; detail: string } {
  const label = scanStatus === "live" ? scanComplete === false ? "Key 局部目录" : "Key 目录" : "上次目录记录";
  const endpoint = scalar(model.metadata?.endpointPath) ?? "—";
  const protocol = scalar(model.metadata?.protocol) ?? "—";
  const verifiedAt = scalar(model.metadata?.imageCapabilitiesVerifiedAt);
  return { label, tone: scanStatus === "live" ? "ok" : "unknown",
    detail: `扫描状态：${scanStatus}${scanComplete !== undefined ? ` · 完整目录：${scanComplete}` : ""} · 协议：${protocol} · 提交接口：${endpoint}${verifiedAt ? ` · 图片实测时间：${verifiedAt}` : ""}` };
}

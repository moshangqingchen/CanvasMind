import type { ModelDescriptor, ProviderOperation, StructuredModelPricing, StructuredPriceTier } from "@super-canvas/providers";
import { normalizeTk1688CnyModel } from "@super-canvas/providers/tk1688-catalog";
import { applyUserImageSizePresets } from "@super-canvas/providers/image-size-presets";
import { selectModelQuote } from "@super-canvas/providers/media-billing";

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
function operationScope(pricing: StructuredModelPricing): string {
  const names = { "image.generate": "图片生成", "image.edit": "图片编辑", "video.generate": "视频生成", "video.image-to-video": "图生视频", "music.generate": "音乐生成" };
  const operations = pricing.evidence?.operations;
  return operations?.length ? `${operations.map(operation => names[operation]).join(" / ")} · ` : "";
}

/** The price sample is independent of the latest directory attempt. */
export function modelPickerPriceSampleAt(model: Pick<ModelDescriptor, "metadata" | "pricing"> | null | undefined): string | undefined {
  for (const value of [model?.metadata?.priceCheckedAt, model?.pricing?.checkedAt, model?.metadata?.supplierCatalogPriceCheckedAt])
    if (typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value))) return value.trim();
}

function historicalPricePrefix(model: ModelDescriptor, label: string): string {
  if (model.pricing?.tiers?.some(tier => tier.evidence?.status === "published") && model.pricing.tiers.some(tier => tier.evidence?.status === "retained"))
    return "部分上次价格 · ";
  if (model.metadata?.priceStatus !== "partial" && !/（上次价格）$/u.test(label)) return "";
  // A measured charge remains a separate source, even if an older record is displayed.
  const name = model.metadata?.priceSource === "generated-result" ? "上次记录" : "上次价格";
  const checkedAt = modelPickerPriceSampleAt(model);
  return `${name}${checkedAt ? ` · 采样时间 ${checkedAt}` : name === "上次价格" ? " · 采样时间 —" : ""} · `;
}

export interface ModelPickerPriceCondition {
  parameter: string;
  label: string;
  operator: "equals" | "contains";
  value: string;
}

export interface ModelPickerPriceTier {
  id: string;
  /** Position in the original tariff, including any invalid-price branches. */
  sourceIndex: number;
  label: string;
  conditions: readonly ModelPickerPriceCondition[];
  conditionMode?: StructuredPriceTier["conditionMode"];
  otherwise: boolean;
  amount: number;
  historical: boolean;
  checkedAt?: string;
  operations: readonly { value: ProviderOperation; label: string }[];
  sourceUrl?: string;
  /** Dimension tariffs use unique, case-insensitive matching rather than first-match. */
  matching: "ordered" | "unique-dimension";
  legacyCondition: string;
  /** Old reports only mark an explicitly retained tier, even when a parent is retained. */
  legacyRetained: boolean;
  legacyCheckedAt?: string;
}

export interface ModelPickerMeasuredPrice {
  label?: string;
  amount?: number;
  currency?: string;
  unit?: string;
  checkedAt?: string;
  sourceUrl?: string;
  requestId?: string;
  providerTaskId?: string;
  parameters: readonly { parameter: string; label: string; value: string; legacyLabel: string }[];
  parametersState: "recorded" | "omitted" | "missing";
}

export interface ModelPickerStructuredPrice {
  kind?: StructuredModelPricing["kind"];
  currency?: string;
  displayCurrency?: string;
  unit?: string;
  fixedAmount?: number;
  tokenRates: readonly { label: string; amount: number }[];
  tiers: readonly ModelPickerPriceTier[];
  operations: readonly { value: ProviderOperation; label: string }[];
  confidence?: StructuredModelPricing["confidence"];
  checkedAt?: string;
  historical?: { label: "上次价格" | "上次记录" | "部分上次价格"; checkedAt?: string };
  timeMultipliers: NonNullable<StructuredModelPricing["timeMultipliers"]>;
  billingIncludesInputDuration: boolean;
  measuredPrices: readonly ModelPickerMeasuredPrice[];
  prose?: string;
}

const operationNames: Record<ProviderOperation, string> = {
  "image.generate": "图片生成", "image.edit": "图片编辑", "video.generate": "视频生成", "video.image-to-video": "图生视频", "music.generate": "音乐生成",
};
const operationsData = (values?: readonly ProviderOperation[]) => (values ?? []).map(value => ({ value, label: operationNames[value] }));
function parameterLabel(model: ModelDescriptor, key: string): string {
  return model.parameters?.find(parameter => parameter.key === key)?.label || parameterNames[key] || key;
}
const validAmount = (value: unknown): value is number => finite(value) && value >= 0;

function measuredPriceData(model: ModelDescriptor, measured: Record<string, unknown>, label?: string): ModelPickerMeasuredPrice {
  const sample = record(measured.parameters), charge = record(measured.actualCharge);
  const parameters: ModelPickerMeasuredPrice["parameters"][number][] = [];
  // Keep the same public scalar/count facts as before; source URLs and prompts stay private.
  for (const [key, value] of Object.entries(sample ?? {})) if (key !== "prompt" && scalar(value) !== undefined &&
    !(typeof value === "string" && /^(?:https?:|data:)/iu.test(value)))
    parameters.push({ parameter: key, label: parameterLabel(model, key), legacyLabel: parameterNames[key] ?? key, value: String(value) });
  for (const [key, value] of Object.entries(sample ?? {})) if (Array.isArray(value))
    parameters.push({ parameter: key, label: `${parameterLabel(model, key)}数量`, legacyLabel: `${parameterNames[key] ?? key}数量`, value: String(value.length) });
  const amount = measured.amount ?? charge?.amount;
  const unit = scalar(measured.unit ?? charge?.unit);
  return { ...(label ? { label } : {}), ...(validAmount(amount) ? { amount } : {}),
    currency: scalar(measured.currency ?? charge?.currency),
    unit: unit === "image" ? "张" : unit === "request" ? "次" : unit === "second" ? "秒" : unit,
    checkedAt: scalar(measured.checkedAt), sourceUrl: scalar(measured.sourceUrl ?? charge?.sourceUrl),
    requestId: scalar(measured.requestId), providerTaskId: scalar(measured.providerTaskId), parameters,
    parametersState: parameters.length ? "recorded" : sample && Object.keys(sample).length === 0 ? "omitted" : "missing" };
}

/** Parse once for visual tables and the unchanged report/comparison strings. */
function parseModelPrice(input: ModelDescriptor | null | undefined) {
  const empty: ModelPickerStructuredPrice = { tiers: [], tokenRates: [], operations: [], timeMultipliers: [], billingIncludesInputDuration: false, measuredPrices: [] };
  if (!input) return { data: empty, historical: "", label: "", measuredLabel: false, pricing: undefined };
  const model = applyUserImageSizePresets(normalizeTk1688CnyModel(input)), metadata = model.metadata;
  const rawLabel = typeof metadata?.priceLabel === "string" ? metadata.priceLabel.trim() : "";
  const historical = historicalPricePrefix(model, rawLabel);
  const label = historical ? rawLabel.replace(/（上次价格）$/u, "") : rawLabel;
  const quote = selectModelQuote(model), pricing = quote.pricing;
  const data: ModelPickerStructuredPrice = { ...empty,
    checkedAt: modelPickerPriceSampleAt(model), billingIncludesInputDuration: metadata?.billingIncludesInputDuration === true,
    ...(historical ? { historical: { label: historical.startsWith("部分") ? "部分上次价格" : historical.startsWith("上次记录") ? "上次记录" : "上次价格", checkedAt: modelPickerPriceSampleAt(model) } as ModelPickerStructuredPrice["historical"] } : {}) };
  const measured = metadata?.priceSource === "generated-result" ? record(metadata.measuredPrice) : undefined;
  // Preserve every distinct measured request as its own sample, never an unconditional quote.
  const seen = new Set<string>();
  data.measuredPrices = quote.measured.filter(item => {
    const signature = JSON.stringify(item); if (seen.has(signature)) return false; seen.add(signature); return true;
  }).map(item => measuredPriceData(model, item, item === measured && label ? label : undefined));
  if (pricing) {
    const ordered = !!pricing.tiers?.some(tier => tier.conditions || tier.otherwise);
    data.kind = pricing.kind; data.currency = pricing.currency;
    data.displayCurrency = pricing.currency === "credits" ? "额度" : pricing.currency;
    data.unit = priceUnit(pricing); data.confidence = pricing.confidence;
    data.operations = operationsData(pricing.evidence?.operations);
    data.timeMultipliers = pricing.timeMultipliers ?? [];
    if (validAmount(pricing.unitAmount)) data.fixedAmount = pricing.unitAmount;
    if (pricing.kind === "token") data.tokenRates = ([["输入", pricing.inputPerMillion], ["输出", pricing.outputPerMillion], ["图片输出", pricing.imageOutputPerMillion]] as const)
      .filter((entry): entry is readonly ["输入" | "输出" | "图片输出", number] => validAmount(entry[1])).map(([name, amount]) => ({ label: name, amount }));
    data.tiers = (pricing.tiers ?? []).flatMap((tier, sourceIndex) => {
      if (!validAmount(tier.price)) return [];
      const provenance = tier.evidence ?? pricing.evidence;
      const conditions = tier.conditions ?? (tier.dimension && tier.dimension !== "fixed" && tier.value !== undefined
        ? [{ parameter: tier.dimension, operator: "equals" as const, value: String(tier.value) }] : []);
      return [{ id: tier.id, sourceIndex, label: tier.label,
        conditions: conditions.map(condition => ({ ...condition, label: parameterLabel(model, condition.parameter) })),
        conditionMode: tier.conditionMode, otherwise: !!tier.otherwise, amount: tier.price,
        historical: provenance ? provenance.status === "retained" : !!historical,
        checkedAt: provenance?.checkedAt ?? data.checkedAt, operations: operationsData(provenance?.operations), sourceUrl: provenance?.sourceUrl ?? pricing.sourceUrl,
        matching: ordered ? "ordered" as const : "unique-dimension" as const,
        legacyCondition: priceCondition(tier), legacyRetained: tier.evidence?.status === "retained", legacyCheckedAt: tier.evidence?.checkedAt }];
    });
  }
  const prose = modelPickerPriceLabelData(label);
  if (prose !== "—") data.prose = prose;
  return { data, historical, label, measuredLabel: !!measured && !!label, pricing };
}

/** Every value belongs to this candidate model and its original tariff branch. */
export function modelPickerStructuredPrice(model: ModelDescriptor | null | undefined): ModelPickerStructuredPrice {
  return parseModelPrice(model).data;
}

export function modelPriceHasDetails(data: ModelPickerStructuredPrice): boolean {
  return !data.measuredPrices.some(sample => sample.label) &&
    (data.tiers.length + (data.fixedAmount !== undefined ? 1 : 0) > 1 || data.tokenRates.length > 1);
}

function priceDetailString(parsed: ReturnType<typeof parseModelPrice>): string {
  const { data, historical, label, pricing } = parsed;
  if (parsed.measuredLabel) {
    const measured = data.measuredPrices[0]!;
    const scope = measured.parameters.map(item => `${item.legacyLabel}=${item.value}`);
    return `${historical}${label}${scope.length ? ` · 实测参数：${scope.join("，")}` : ` · 实测请求参数：${measured.parametersState === "omitted" ? "省略" : "—"}`}`;
  }
  if (pricing) {
    const rates: string[] = [];
    if (data.fixedAmount !== undefined) rates.push(`${data.fixedAmount} ${data.displayCurrency} / ${data.unit}`);
    for (const rate of data.tokenRates) rates.push(`${rate.label} ${rate.amount} ${data.displayCurrency} / ${data.unit}`);
    for (const tier of data.tiers) rates.push(`${tier.legacyCondition} · ${tier.amount} ${data.displayCurrency} / ${data.unit}${tier.legacyRetained ? `（上次价格 · 采样时间 ${tier.legacyCheckedAt}）` : ""}`);
    const times = data.timeMultipliers.map(window => `上海 ${window.weekdaysOnly ? "周一至周五 " : ""}${window.startHour}:00–${window.endHour}:00 ×${window.multiplier}`).join("；");
    if (rates.length) return `${operationScope(pricing)}${historical}${rates.join("；")}${pricing.confidence === "estimate" ? "（参考）" : pricing.confidence === "snapshot" ? "（目录快照）" : ""}${times ? `；时段倍率：${times}` : ""}${data.billingIncludesInputDuration ? "；计费时长：输入 + 输出视频" : ""}`;
  }
  return data.prose ? historical + data.prose : "—";
}

/** Stable plain-text contract for reports, price comparison and evidence. */
export function modelPickerPriceData(model: ModelDescriptor | null | undefined): string {
  return priceDetailString(parseModelPrice(model));
}

export function modelPickerPriceCompact(model: ModelDescriptor | null | undefined): string {
  const parsed = parseModelPrice(model), detail = priceDetailString(parsed);
  const { data, historical, pricing } = parsed;
  if (!model || detail === "—") return "—";
  if (parsed.measuredLabel) return detail.replace(/\s*·\s*实测(?:请求)?参数：[\s\S]*$/u, "");
  if (!pricing) return detail;
  const confidence = pricing.confidence === "estimate" ? "（参考）" : pricing.confidence === "snapshot" ? "（目录快照）" : "";
  const times = data.timeMultipliers.length ? " · 时段倍率" : "";
  if (pricing.kind === "token") return `${operationScope(pricing)}${historical}Token 计价${confidence}${times}`;
  const amounts = data.tiers.map(tier => tier.amount);
  if (data.fixedAmount !== undefined) amounts.unshift(data.fixedAmount);
  if (!amounts.length) return detail;
  const minimum = Math.min(...amounts), maximum = Math.max(...amounts);
  const scope = amounts.length > 1 ? ` · ${amounts.length} 档` : data.tiers[0] ? ` · ${data.tiers[0].legacyCondition}` : "";
  return `${operationScope(pricing)}${historical}${minimum === maximum ? minimum : `${minimum}–${maximum}`} ${data.displayCurrency} / ${data.unit}${confidence}${scope}${times}${data.billingIncludesInputDuration ? " · 输入+输出时长" : ""}`;
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

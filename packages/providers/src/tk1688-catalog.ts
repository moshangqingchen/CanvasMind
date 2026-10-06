import type { ModelDescriptor, ModelParameterDescriptor, StructuredModelPricing } from "./contracts.js";
import { parseProviderModelFacts } from "./model-catalog.js";
import { isTk1688ApiUrl } from "./tk1688-model-policy.js";

export const TK1688_MARKETPLACE_URL = "https://tk1688.com/api/marketplace/listings";
export const TK1688_MARKET_URL = "https://tk1688.com/market";
export const TK1688_STATUS_URL = "https://tk1688.com/api/status";
type Row = Record<string, unknown>;
const record = (value: unknown): Row | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;
const text = (value: unknown, maximum = 8000) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const money = (value: number) => String(Number(value.toPrecision(10)));
const tiers = ["1K", "2K", "4K"] as const;
type Tier = typeof tiers[number];

type PricedModel = { pricing?: StructuredModelPricing; priceLabel?: string; metadata?: Record<string, unknown> };
const unavailableCnyPrice = "人民币价格暂不可用（汇率未读取）";

/** Use the marketplace's own positive FX rate. This also repairs saved USD
 * catalogs on read; original supplier prices remain evidence, never CNY input. */
export function normalizeTk1688CnyModel<T extends PricedModel>(model: T): T {
  if (model.metadata?.tk1688Catalog !== true) return model;
  const metadata = { ...model.metadata };
  const candidate = model.pricing ?? record(metadata.tk1688Pricing) as unknown as StructuredModelPricing | undefined;
  const fxValue = number(metadata.tk1688FxRate), fx = fxValue && fxValue > 0 ? fxValue : undefined;
  let pricing = candidate;
  if (candidate?.currency === "USD") {
    metadata.tk1688OriginalPricing ??= { ...candidate };
    const converted = (value: number | undefined) => value === undefined || !fx || !Number.isFinite(value * fx)
      ? undefined : Number((value * fx).toPrecision(10));
    const amounts = [candidate.unitAmount, candidate.inputPerMillion, candidate.outputPerMillion, candidate.imageOutputPerMillion,
      ...(candidate.tiers?.map(tier => tier.price) ?? [])];
    pricing = fx && amounts.every(value => value === undefined || converted(value) !== undefined) ? {
      ...candidate, currency: "CNY", ...(candidate.unitAmount !== undefined ? { unitAmount: converted(candidate.unitAmount)! } : {}),
      ...(candidate.inputPerMillion !== undefined ? { inputPerMillion: converted(candidate.inputPerMillion)! } : {}),
      ...(candidate.outputPerMillion !== undefined ? { outputPerMillion: converted(candidate.outputPerMillion)! } : {}),
      ...(candidate.imageOutputPerMillion !== undefined ? { imageOutputPerMillion: converted(candidate.imageOutputPerMillion)! } : {}),
      ...(candidate.tiers ? { tiers: candidate.tiers.map(tier => ({ ...tier, price: converted(tier.price)! })) } : {}),
    } : undefined;
  }
  const originalLabel = model.priceLabel ?? (typeof metadata.priceLabel === "string" ? metadata.priceLabel : undefined);
  let priceLabel = originalLabel;
  if (originalLabel?.includes("$")) {
    metadata.tk1688OriginalPriceLabel ??= originalLabel;
    priceLabel = fx ? originalLabel.replace(/（¥[^）]*）/gu, "")
      .replace(/\$(\d+(?:\.\d+)?(?:e[+-]?\d+)?)/giu, (_, value: string) => {
        const amount = Number(value) * fx;
        return Number.isFinite(amount) ? `¥${money(amount)}` : unavailableCnyPrice;
      }) : unavailableCnyPrice;
    if (priceLabel.includes("$") || priceLabel.includes(unavailableCnyPrice)) priceLabel = unavailableCnyPrice;
  }
  if (candidate?.currency === "USD" && !pricing) priceLabel = unavailableCnyPrice;
  if (metadata.tk1688Pricing !== undefined) metadata.tk1688Pricing = pricing;
  if (priceLabel !== undefined) metadata.priceLabel = priceLabel;
  metadata.tk1688PriceDisplayCurrency = "CNY";
  if (fx) {
    metadata.tk1688FxRateSourceUrl ??= TK1688_STATUS_URL;
    metadata.tk1688FxRateCheckedAt ??= metadata.tk1688CatalogCheckedAt ?? candidate?.checkedAt;
  }
  return { ...model, ...(model.pricing !== undefined || candidate ? { pricing } : {}),
    ...(model.priceLabel !== undefined ? { priceLabel } : {}), metadata };
}

export function isTk1688CatalogSource(siteUrl: string, apiUrl?: string): boolean {
  try {
    const site = new URL(siteUrl);
    return site.protocol === "https:" && site.host === "tk1688.com" && !site.username && !site.password &&
      (!apiUrl || isTk1688ApiUrl(apiUrl));
  } catch { return false; }
}

export function parseTk1688AccountModelIds(payload: unknown): string[] | undefined {
  const root = record(payload);
  if (!root || root.success === false || !Array.isArray(root.data)) return undefined;
  if (root.data.some(value => typeof value !== "string" || !value.trim() || value.length > 256)) return undefined;
  return [...new Set(root.data.map(value => value.trim()))];
}

/** Marketplace prose is model/channel evidence. An adjective or an unrelated
 * prompt sample never declares a capability for a different merchant. */
export function tk1688DescriptionFacts(description: string) {
  const supported = new Set<Tier>();
  for (const match of description.matchAll(/(?:^|[^\d])([124](?:\s*[/、,，]?\s*[124]){0,2})\s*k\b/giu)) {
    for (const digit of match[1]!.match(/[124]/gu) ?? []) supported.add(`${digit}K` as Tier);
  }
  for (const tier of tiers) {
    if (new RegExp(`(?:不支持|禁止|不含|无)\\s*${tier}`, "iu").test(description)) supported.delete(tier);
  }
  const dimensions = /\b(\d{3,5})\s*[x×*]\s*(\d{3,5})\b/iu.exec(description);
  const fixedSize = dimensions && /原生|固定|仅|限|支持/iu.test(description)
    ? `${Number(dimensions[1])}x${Number(dimensions[2])}` : undefined;
  const omitN = /(?:不支持|禁止|不接受|不传)\s*(?:参数\s*)?[`"']?n\b|(?:does not support|unsupported)\s+[`"']?n\b/iu.test(description);
  const qualityMatch = /(?:quality|质量)\s*(?:支持|档位|可选|为|[:：=])?\s*([a-z]+(?:(?:\s*[,，、/|]\s*)[a-z]+)+)/iu.exec(description);
  const quality = qualityMatch ? [...new Set(qualityMatch[1]!.toLowerCase().split(/\s*[,，、/|]\s*/u)
    .filter(value => ["auto", "low", "medium", "high", "max"].includes(value)))] : [];
  return { resolutions: tiers.filter(tier => supported.has(tier)), fixedSize, omitN, quality };
}

function parametersFor(facts: ReturnType<typeof tk1688DescriptionFacts>): ModelParameterDescriptor[] {
  const result: ModelParameterDescriptor[] = facts.fixedSize ? [{
    key: "size", label: "精确尺寸", control: "select", valueType: "string", default: facts.fixedSize,
    options: [{ label: `原生 ${facts.fixedSize.replace("x", " × ")}`, value: facts.fixedSize }],
    description: "此商家在模型广场明确声明的原生尺寸。",
  }] : [{
    key: "resolution", label: "分辨率", control: "select", valueType: "string", default: "auto",
    options: [{ label: "自动（由当前渠道决定）", value: "auto" }, ...facts.resolutions.map(value => ({ label: value, value }))],
    description: facts.resolutions.length ? "仅显示当前商家说明中明确支持的档位。" : "商家未公布分辨率档位，按渠道默认值生成。",
  }, {
    key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: "auto",
    options: [{ label: "自动", value: "auto" }, { label: "方形 1:1", value: "1:1" },
      { label: "横向 3:2", value: "3:2" }, { label: "竖向 2:3", value: "2:3" }],
    description: "词元生图中心公布的比例；自动模式使用提示词或参考图的比例。",
  }];
  const quality = facts.quality.length ? facts.quality : ["auto", "high", "medium", "low"];
  result.push({ key: "quality", label: "质量", control: "select", valueType: "string",
    default: quality.includes("auto") ? "auto" : quality[0]!, options: quality.map(value => ({ label: value, value })),
    description: facts.quality.length ? "当前商家明确声明的质量档位。" : "词元生图工作台通用控件；商家未单独声明质量档位。" });
  if (!facts.omitN) result.push({ key: "n", label: "数量", control: "number", valueType: "integer", default: 1, min: 1, max: 4, step: 1,
    description: "词元生图工作台提供 1–4 张；商家的明确限制优先。" });
  result.push({ key: "response_format", label: "返回格式", control: "select", valueType: "string", default: "url",
    options: [{ label: "图片链接", value: "url" }, { label: "Base64", value: "b64_json" }],
    description: "词元官方接口文档支持 url 和 b64_json。" });
  return result;
}

function skuModel(row: Row, checkedAt: string, status: Row | undefined): ModelDescriptor | undefined {
  const id = text(row.alias, 256), base = text(row.base_model, 256);
  if (!id || !base || !id.startsWith(`${base}@s`) || !/@s\d+c\d+$/u.test(id)) return undefined;
  const image = row.charge_type === "per_request";
  const description = text(row.description);
  const facts = tk1688DescriptionFacts(description);
  const input = number(row.input_price_usd), output = number(row.output_price_usd);
  const fx = number(status?.payment_fx_rate_cny_per_usd);
  const markup = number(status?.platform_markup_percent);
  const priceLabel = image && input !== undefined ? `$${money(input)}/次`
    : [input === undefined ? "" : `输入 $${money(input)}/1M`, output === undefined ? "" : `输出 $${money(output)}/1M`].filter(Boolean).join(" · ");
  const pricing: StructuredModelPricing | undefined = image && input !== undefined
    ? { kind: "per-request", currency: "USD", unitAmount: input, billingUnit: "request", sourceUrl: TK1688_MARKET_URL, checkedAt, confidence: "snapshot" }
    : input !== undefined || output !== undefined ? { kind: "token", currency: "USD", ...(input !== undefined ? { inputPerMillion: input } : {}),
      ...(output !== undefined ? { outputPerMillion: output } : {}), sourceUrl: TK1688_MARKET_URL, checkedAt, confidence: "snapshot" } : undefined;
  const modalities = Array.isArray(row.modalities) ? row.modalities.filter(value => ["text", "image", "audio", "video"].includes(String(value))) : undefined;
  const declared = parseProviderModelFacts({ ...row, ...(modalities ? { input_modalities: modalities } : {}), output_modalities: [image ? "image" : "text"] }, "supplier-catalog");
  return normalizeTk1688CnyModel<ModelDescriptor>({
    id, name: `${base} · 商家 ${id.split("@")[1]}`, description, operations: image ? ["image.generate", "image.edit"] : [],
    inputKinds: declared.inputKinds ?? ["text", ...(image ? ["image" as const] : [])], outputKinds: [image ? "image" : "text"],
    ...(image ? { parameters: parametersFor(facts) } : {}),
    limits: { ...declared.limits, ...(facts.omitN && image ? { maxOutputImages: 1 } : {}) },
    ...(pricing ? { pricing } : {}),
    metadata: { ...declared.metadata, tk1688Catalog: true, tk1688Routing: "merchant", tk1688BaseModel: base,
      tk1688SupportedResolutions: facts.resolutions, ...(facts.fixedSize ? { tk1688FixedSize: facts.fixedSize } : {}),
      ...(facts.omitN ? { tk1688OmitN: true, fixedOutputCount: 1 } : {}),
      tk1688QualityDeclared: facts.quality.length > 0, tk1688ListingId: row.id,
      tk1688QualitySource: facts.quality.length ? "merchant-description" : "official-image-station-common",
      tk1688CommonParameterSource: "https://tk1688.com/image-station/studio",
      tk1688MerchantId: row.supplier_id, tk1688Channel: row.channel_no,
      tk1688ContextTokens: number(row.context_tokens), tk1688MaxOutputTokens: number(row.max_output_tokens),
      tk1688CacheReadPriceUsd: number(row.cache_read_price_usd), tk1688CacheWritePriceUsd: number(row.cache_write_price_usd),
      ...(fx !== undefined ? { tk1688FxRate: fx } : {}), ...(markup !== undefined ? { tk1688PlatformMarkupPercent: markup } : {}),
      tk1688RetailPriceIncludesMarkup: true, tk1688CatalogCheckedAt: checkedAt, documentationUrl: TK1688_MARKET_URL,
      supplierChannelDescription: description, priceLabel, priceSource: "tk1688-marketplace", priceCheckedAt: checkedAt,
      protocol: image ? "openai-images" : "chat-completions", ...(image ? {} : { agentProtocol: "chat-completions" }),
      canvasRunnable: image, endpointTypes: [image ? "openai-images" : "chat-completions"],
    },
  });
}

function smartModel(base: string, skus: ModelDescriptor[], checkedAt: string): ModelDescriptor {
  const first = skus[0]!, image = first.operations.length > 0;
  const resolutions = tiers.filter(tier => skus.every(model => (model.metadata?.tk1688SupportedResolutions as string[]).includes(tier)));
  const omitN = skus.some(model => model.metadata?.tk1688OmitN === true);
  const fixedSizes = skus.flatMap(model => typeof model.metadata?.tk1688FixedSize === "string" ? [model.metadata.tk1688FixedSize] : []);
  const fixedSize = fixedSizes.length === skus.length && new Set(fixedSizes).size === 1 ? fixedSizes[0] : undefined;
  const inputKinds = first.inputKinds?.filter(kind => skus.every(model => model.inputKinds?.includes(kind)));
  const context = skus.map(model => number(model.metadata?.tk1688ContextTokens));
  const maxOutput = skus.map(model => number(model.metadata?.tk1688MaxOutputTokens));
  const priceValues = skus.map(model => model.pricing?.unitAmount).filter((value): value is number => value !== undefined);
  const tokenInputs = skus.map(model => model.pricing?.inputPerMillion).filter((value): value is number => value !== undefined);
  const tokenOutputs = skus.map(model => model.pricing?.outputPerMillion).filter((value): value is number => value !== undefined);
  const range = (values: number[]) => values.length ? `¥${money(Math.min(...values))}${Math.max(...values) === Math.min(...values) ? "" : `–¥${money(Math.max(...values))}`}` : "未公布";
  const unavailable = skus.some(model => model.metadata?.priceLabel === unavailableCnyPrice);
  const priceLabel = unavailable ? unavailableCnyPrice : image ? `${range(priceValues)}/次（自动路由，实际价格由商家决定）`
    : `输入 ${range(tokenInputs)}/1M · 输出 ${range(tokenOutputs)}/1M（自动路由）`;
  const metadata = { ...first.metadata };
  for (const key of ["tk1688ListingId", "tk1688MerchantId", "tk1688Channel", "tk1688FixedSize", "fixedOutputCount", "tk1688OmitN", "tk1688OriginalPricing", "tk1688OriginalPriceLabel"]) delete metadata[key];
  return { id: base, name: `${base} · 自动路由`, operations: first.operations,
    description: "自动选择商家。参数使用当前可选商家明确支持的交集；商家未公布或档位冲突时使用自动。",
    ...(inputKinds ? { inputKinds } : {}), ...(first.outputKinds ? { outputKinds: first.outputKinds } : {}),
    ...(image ? { parameters: parametersFor({ resolutions, fixedSize, omitN, quality: [] }) } : {}),
    limits: { ...(omitN && image ? { maxOutputImages: 1 } : {}) },
    metadata: { ...metadata, tk1688Routing: "smart", tk1688EligibleMerchantAliases: skus.map(model => model.id),
      tk1688SupportedResolutions: resolutions, ...(fixedSize ? { tk1688FixedSize: fixedSize } : {}),
      ...(omitN ? { tk1688OmitN: true, fixedOutputCount: 1 } : {}), tk1688QualityDeclared: false,
      tk1688ContextTokens: context.every(value => value !== undefined) ? Math.min(...context as number[]) : undefined,
      tk1688MaxOutputTokens: maxOutput.every(value => value !== undefined) ? Math.min(...maxOutput as number[]) : undefined,
      priceLabel, priceCheckedAt: checkedAt, supplierChannelDescription: skus.map(model => `${model.id}：${model.description}`).join("\n").slice(0, 8000),
      ...(image ? {} : { inputKindsSource: skus.every(model => model.metadata?.inputKindsSource === "declared") ? "declared" : "inferred",
        agentCapabilities: { imageInput: inputKinds?.includes("image") === true, audioInput: inputKinds?.includes("audio") === true, videoInput: inputKinds?.includes("video") === true } }),
    } };
}

/** Key inventory + authenticated account aliases + active marketplace entries
 * constrain merchant additions. Public catalogs alone never grant Key access. */
export function parseTk1688Marketplace(payload: unknown, statusPayload?: unknown,
  options: { checkedAt?: string; accountModelIds?: readonly string[]; keyModelIds?: readonly string[] } = {}) {
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const root = record(payload), data = record(root?.data), items = data?.items;
  if (!root || root.success === false || !Array.isArray(items)) return { models: [] as ModelDescriptor[], excludedModelIds: [] as string[], complete: false, checkedAt };
  const statusRoot = record(statusPayload), status = statusRoot?.success === false ? undefined : record(statusRoot?.data);
  const account = options.accountModelIds ? new Set(options.accountModelIds) : undefined;
  const keys = options.keyModelIds ? new Set(options.keyModelIds) : undefined;
  const skus = items.flatMap(value => {
    const row = record(value);
    if (!row || row.status !== "active" || row.channel_alive === false || !["per_request", "per_token"].includes(String(row.charge_type))) return [];
    const model = skuModel(row, checkedAt, status);
    if (!model) return [];
    if (keys && !keys.has(model.id) && !(account?.has(model.id) && keys.has(String(model.metadata?.tk1688BaseModel)))) return [];
    if (account && !account.has(model.id) && !keys?.has(model.id)) return [];
    return [model];
  });
  const families = new Map<string, ModelDescriptor[]>();
  for (const model of skus) { const base = String(model.metadata?.tk1688BaseModel); families.set(base, [...families.get(base) ?? [], model]); }
  const smart = [...families].filter(([base]) => !keys || keys.has(base)).map(([base, models]) => smartModel(base, models, checkedAt));
  const excludedModelIds = items.flatMap(value => {
    const row = record(value);
    return row && (row.status !== "active" || row.channel_alive === false) && text(row.alias, 256) ? [text(row.alias, 256)] : [];
  });
  return { models: [...smart, ...skus], excludedModelIds, complete: number(data?.total) === undefined || Number(data?.total) === items.length, checkedAt };
}

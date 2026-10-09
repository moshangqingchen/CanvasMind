import type { ModelDescriptor, ModelParameterDescriptor, StructuredModelPricing } from "@super-canvas/providers";

export interface MiaowuImageSchemaContract {
  modes: ("text-to-image" | "image-to-image")[];
  resolutions: string[];
  ratios: string[];
  maxInputImages: number;
  maxPromptCharacters?: number;
  /** Display amounts already include the supplier's exchange rate and group ratio. */
  pricingDisplay?: {
    currency: "CNY" | "USD";
    groups: Record<string, { rules: { resolution: string; price: number }[] }>;
  };
}

export interface MiaowuImageSchemaReceipt {
  id: string;
  sourceUrl: string;
  checkedAt: string;
  status: "live" | "unsupported" | "unauthorized" | "failed";
  httpStatus?: number;
  error?: string;
  normalizedSchemaSha256?: string;
  contract?: MiaowuImageSchemaContract;
  stale?: boolean;
  lastSuccessfulCheckedAt?: string;
}

const origin = "https://api.miaowuai.store";
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const positive = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
const maximum = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const enumStrings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.length && value.every(item => typeof item === "string" && item.trim()) ? [...new Set(value)] as string[] : undefined;
const resolutionLabel = (value: string) => value === "1080p" ? "标准" : value;

function displayPricing(payload: Record<string, unknown>, resolutions: string[]): MiaowuImageSchemaContract["pricingDisplay"] {
  const display = object(payload.pricing_display), groups = object(display?.groups);
  if (!groups || !["CNY", "USD"].includes(String(display?.currency))) return undefined;
  const prices: Record<string, { rules: { resolution: string; price: number }[] }> = Object.create(null);
  for (const [group, value] of Object.entries(groups)) {
    const quote = object(value);
    if (!quote || quote.unit !== "per_call" || !Array.isArray(quote.rules) || !quote.rules.length ||
        Object.keys(quote).some(key => !["unit", "rules"].includes(key))) continue;
    const rules: { resolution: string; price: number }[] = [];
    let invalid = false;
    for (const value of quote.rules) {
      const rule = object(value);
      if (!rule || Object.keys(rule).some(key => !["size", "price"].includes(key)) ||
          typeof rule.size !== "string" || !resolutions.includes(rule.size) ||
          typeof rule.price !== "number" || !Number.isFinite(rule.price) || rule.price < 0 ||
          rules.some(row => row.resolution === rule.size)) { invalid = true; break; }
      rules.push({ resolution: rule.size, price: rule.price });
    }
    // Do not turn a partial display tariff into a price for the unquoted sizes.
    if (!invalid && resolutions.every(resolution => rules.some(rule => rule.resolution === resolution))) prices[group] = { rules };
  }
  return Object.keys(prices).length ? { currency: display!.currency as "CNY" | "USD", groups: prices } : undefined;
}

/** Exact-model schema data drives the documented /v1/images compatibility API. */
export function parseMiaowuImageSchema(id: string, payload: unknown): MiaowuImageSchemaContract {
  const response = object(payload), root = object(response?.request_schema);
  const params = object(object(root?.properties)?.params), fields = object(params?.properties);
  if (response?.id !== id || response.type !== "image" || !fields) throw new Error("免费 schema 未返回同一完整图片型号的参数合同");
  if ([root, params, ...Object.values(fields)].some(schema => schema && typeof schema === "object" &&
      ["allOf", "anyOf", "oneOf", "not", "if", "then", "else", "$ref"].some(key => Object.hasOwn(schema, key)))) {
    throw new Error("免费图片 schema 含尚未接入的联合参数约束");
  }
  const known = ["mode", "prompt", "size", "ratio", "image_urls", "video_urls", "audio_urls"];
  if (Object.keys(fields).some(key => !known.includes(key))) throw new Error("免费图片 schema 含尚未接入的参数");
  const mode = object(fields.mode), prompt = object(fields.prompt), size = object(fields.size), ratio = object(fields.ratio);
  const modes = enumStrings(mode?.enum), resolutions = enumStrings(size?.enum), ratios = enumStrings(ratio?.enum);
  if (mode?.type !== "string" || prompt?.type !== "string" || size?.type !== "string" || ratio?.type !== "string" ||
      !modes || modes.some(value => !["text-to-image", "image-to-image"].includes(value)) || !resolutions || !ratios) {
    throw new Error("免费 schema 缺少明确的图片模式、分辨率或比例定义");
  }
  const counts = ["image_urls", "video_urls", "audio_urls"].map(field => {
    const schema = object(fields[field]), items = object(schema?.items), count = maximum(schema?.maxItems);
    if (schema?.type !== "array" || items?.type !== "string" || count === undefined || schema.minItems !== 0) {
      throw new Error("免费图片 schema 的素材范围暂无法完整接入");
    }
    return count;
  });
  if (counts[1] !== 0 || counts[2] !== 0 || modes.includes("image-to-image") && counts[0] === 0) {
    throw new Error("免费图片 schema 的媒体模式与兼容图片接口不一致");
  }
  const maxPromptCharacters = prompt.maxLength === undefined ? undefined : positive(prompt.maxLength);
  if (prompt.maxLength !== undefined && maxPromptCharacters === undefined) throw new Error("免费图片 schema 提示词长度上限无效");
  const pricingDisplay = displayPricing(response, resolutions);
  return { modes: modes as MiaowuImageSchemaContract["modes"], resolutions, ratios, maxInputImages: modes.includes("image-to-image") ? counts[0]! : 0,
    ...(maxPromptCharacters === undefined ? {} : { maxPromptCharacters }), ...(pricingDisplay ? { pricingDisplay } : {}) };
}

/** The caller already resolved same-Key/source/group inventory; schema cannot grant access. */
export function applyMiaowuImageSchema(model: ModelDescriptor, receipt: MiaowuImageSchemaReceipt | undefined): ModelDescriptor {
  if (!receipt || receipt.id !== model.id || !model.outputKinds?.includes("image") ||
      receipt.sourceUrl !== `${origin}/v1/dream/model_schema?model=${encodeURIComponent(model.id)}`) return model;
  if (model.metadata?.source === "manual" || model.metadata?.protocolEvidence === "paid-test" ||
      /401|403|权限|未开通|拒绝|下架|停用|unauthorized|forbidden/iu.test(String(model.metadata?.canvasUnavailableReason ?? ""))) return model;
  const evidence = { imageSchemaStatus: receipt.status, imageSchemaCheckedAt: receipt.checkedAt, imageSchemaSourceUrl: receipt.sourceUrl,
    imageSchemaError: receipt.error ?? null, imageSchemaStale: receipt.stale === true,
    ...(receipt.lastSuccessfulCheckedAt ? { imageSchemaLastSuccessfulCheckedAt: receipt.lastSuccessfulCheckedAt } : {}),
    ...(receipt.normalizedSchemaSha256 ? { imageSchemaNormalizedSha256: receipt.normalizedSchemaSha256 } : {}) };
  if (!receipt.contract || receipt.status !== "live" && !(receipt.stale && ["failed", "unsupported"].includes(receipt.status))) {
    return { ...model, metadata: { ...model.metadata, ...evidence } };
  }
  const c = receipt.contract;
  const existing = (key: string) => model.parameters?.find(row => row.key === key);
  const select = (key: string, label: string, values: string[]): ModelParameterDescriptor => ({ key, label, control: "select", valueType: "string", required: true,
    default: values.includes(String(existing(key)?.default)) ? existing(key)!.default : key === "resolution" ? values.at(-1)! : values[0]!,
    options: values.map(value => ({ label: key === "resolution" ? resolutionLabel(value) : value, value })) });
  const operations = [
    ...(c.modes.includes("text-to-image") ? ["image.generate" as const] : []),
    ...(c.modes.includes("image-to-image") ? ["image.edit" as const] : []),
  ];
  const metadata: Record<string, unknown> = { ...model.metadata, ...evidence,
    parameterSource: "dream.image_schema", remoteMediaUrlsOnly: true, canvasRunnable: true,
    parameterControlsUnavailable: false, imageNativeResolutionOptions: true, imageNativeRatioOptions: true,
    imageNativeResolutionParameter: "resolution", fixedOutputCount: 1, qualitySupport: "provider-decided",
    operationsSource: "declared", outputKindsSource: "declared", catalogCapability: "image",
    imageSupportedModes: c.modes, imageWireFields: ["model", "prompt", "resolution", "ratio", ...(c.maxInputImages ? ["image_urls"] : [])],
    imageContractCheckedAt: receipt.lastSuccessfulCheckedAt ?? receipt.checkedAt };
  delete metadata.canvasUnavailableReason;
  const limits = { ...model.limits, maxInputImages: c.maxInputImages, maxInputVideos: 0, maxInputAudios: 0, maxOutputImages: 1 };
  delete limits.maxPromptCharacters;
  delete limits.requiresInputImage;
  if (c.maxPromptCharacters !== undefined) limits.maxPromptCharacters = c.maxPromptCharacters;
  if (!c.modes.includes("text-to-image")) limits.requiresInputImage = true;
  const group = model.metadata?.marketplaceGroup;
  const display = typeof group === "string" ? c.pricingDisplay?.groups[group] : undefined;
  let pricing: StructuredModelPricing | undefined = model.pricing;
  let name = model.name;
  if (display && c.pricingDisplay) {
    const amount = Math.max(...display.rules.map(row => row.price));
    const currency = c.pricingDisplay.currency;
    pricing = { kind: "per-request", currency, billingUnit: "request", unitAmount: amount,
      tiers: display.rules.map(row => ({ id: row.resolution, label: resolutionLabel(row.resolution), dimension: "resolution", value: row.resolution, price: row.price })),
      sourceUrl: receipt.sourceUrl, checkedAt: receipt.lastSuccessfulCheckedAt ?? receipt.checkedAt, confidence: "exact" };
    const amounts = [...new Set(display.rules.map(row => row.price))].sort((a, b) => a - b);
    const numberLabel = (value: number) => String(Number(value.toPrecision(12)));
    const range = amounts.length === 1 ? numberLabel(amounts[0]!) : `${numberLabel(amounts[0]!)}–${numberLabel(amounts.at(-1)!)}`;
    metadata.priceLabel = `${currency === "CNY" ? "¥" : "$"}${range}/次`;
    metadata.billingLabel = "按次计费";
    metadata.pricingCheckedAt = pricing.checkedAt;
    metadata.pricingSource = "dream.image_schema.pricing_display";
    const baseName = name.replace(/（(?:价格以平台为准|[¥$][\d.]+(?:–[\d.]+)?\/次)）$/u, "");
    name = `${baseName}（${metadata.priceLabel}）`;
  }
  return { ...model, name, operations, inputKinds: ["text", ...(c.maxInputImages ? ["image" as const, "image[]" as const] : [])], outputKinds: ["image"],
    parameters: [select("resolution", "分辨率", c.resolutions), select("aspect_ratio", "画面比例", c.ratios)], limits, metadata,
    ...(pricing ? { pricing } : {}) };
}

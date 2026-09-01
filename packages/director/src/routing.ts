import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterValue,
  StructuredModelPricing,
  StructuredPriceTier,
} from "@super-canvas/providers";

import type {
  DirectorCallDraft,
  DirectorCatalogCandidate,
  DirectorQuote,
  DirectorQuoteBreakdown,
  DirectorRoutingOptions,
  ExchangeRateTable,
  GenerationRequirements,
  RoutedDirectorCall,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_PRICING_MAX_AGE_MS = 30 * DAY_MS;
export const DEFAULT_CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

const PARAMETER_ALIASES = {
  aspectRatio: ["aspect_ratio", "aspectRatio", "ratio"],
  resolution: ["size", "resolution", "image_size", "video_size"],
  quality: ["quality", "quality_tier"],
  duration: ["duration", "duration_seconds", "seconds"],
  count: ["n", "count", "num_outputs", "number_of_outputs"],
} as const;

function parameterFor(
  parameters: readonly ModelParameterDescriptor[] | undefined,
  keys: readonly string[],
): ModelParameterDescriptor | undefined {
  return parameters?.find((parameter) => keys.includes(parameter.key));
}

function compact(value: string | number | boolean): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[×*]/gu, "x")
    .replace(/\s+/gu, "");
}

function ratio(value: string | number | boolean): string | undefined {
  const match = /^(\d+(?:\.\d+)?)[x:]([0-9]+(?:\.\d+)?)$/u.exec(compact(value));
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) return undefined;
  return (width / height).toFixed(6);
}

function valuesEqual(
  expected: string | number | boolean,
  actual: string | number | boolean,
): boolean {
  return compact(expected) === compact(actual);
}

function aspectRatiosEqual(
  expected: string | number | boolean,
  actual: string | number | boolean,
): boolean {
  const expectedRatio = ratio(expected);
  const actualRatio = ratio(actual);
  return expectedRatio && actualRatio
    ? expectedRatio === actualRatio
    : valuesEqual(expected, actual);
}

function optionSupports(
  parameter: ModelParameterDescriptor | undefined,
  value: string | number | undefined,
  equals: (
    expected: string | number | boolean,
    actual: string | number | boolean,
  ) => boolean = valuesEqual,
): boolean {
  if (value === undefined) return true;
  if (!parameter) return false;
  if (parameter.options && parameter.options.length > 0) {
    return parameter.options.some(
      (option) => equals(value, option.value) || equals(value, option.label),
    );
  }
  if (typeof value === "number") {
    return !(
      (parameter.min !== undefined && value < parameter.min) ||
      (parameter.max !== undefined && value > parameter.max)
    );
  }
  return parameter.control === "text" || parameter.control === "dimensions";
}

function hasInputKind(
  model: ModelDescriptor,
  kind: "image" | "video" | "audio",
): boolean {
  return (model.inputKinds ?? []).some(
    (candidate) => candidate === kind || candidate === `${kind}[]`,
  );
}

function declaredBoolean(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): boolean {
  return metadata?.[key] === true;
}

function isFresh(
  checkedAt: string | undefined,
  validUntil: string | undefined,
  nowMs: number,
  maximumAgeMs: number,
): boolean {
  const checked = checkedAt ? Date.parse(checkedAt) : Number.NaN;
  if (!Number.isFinite(checked) || checked > nowMs + 5 * 60 * 1_000)
    return false;
  const expires = validUntil ? Date.parse(validUntil) : checked + maximumAgeMs;
  return Number.isFinite(expires) && expires > nowMs;
}

function isFreshExchangeRateTable(
  rates: ExchangeRateTable | undefined,
  nowMs: number,
): rates is ExchangeRateTable {
  if (!rates) return false;
  const checkedAt = Date.parse(rates.checkedAt);
  const validUntil = Date.parse(rates.validUntil);
  return (
    Number.isFinite(checkedAt) &&
    Number.isFinite(validUntil) &&
    checkedAt <= nowMs + 5 * 60 * 1_000 &&
    nowMs - checkedAt <= 72 * 60 * 60 * 1_000 &&
    validUntil > nowMs
  );
}

export function candidateExclusionReasons(
  candidate: DirectorCatalogCandidate,
  requirements: GenerationRequirements,
  options: DirectorRoutingOptions = {},
): string[] {
  const model = candidate.model;
  const reasons: string[] = [];
  const nowMs = (options.now ?? new Date()).getTime();
  const catalogMaxAgeMs = options.catalogMaxAgeMs ?? DEFAULT_CATALOG_MAX_AGE_MS;

  if (candidate.connectionActive === false) reasons.push("供应商连接未启用");
  if (candidate.credentialUsable === false) reasons.push("供应商凭证不可用");
  if (!candidate.authoritative) {
    reasons.push("模型目录不是当前连接的权威扫描结果");
  }
  if (
    candidate.catalogCheckedAt &&
    !isFresh(candidate.catalogCheckedAt, undefined, nowMs, catalogMaxAgeMs)
  ) {
    reasons.push("模型目录扫描结果已过期");
  }
  if (!model.operations.includes(requirements.operation)) {
    reasons.push(`不支持 ${requirements.operation}`);
  }

  for (const kind of requirements.inputKinds ?? []) {
    if (!hasInputKind(model, kind)) reasons.push(`不支持${kind}输入`);
  }

  const limits = model.limits;
  const inputCounts = requirements.inputCounts ?? {};
  const countLimits = {
    image: limits?.maxInputImages,
    video: limits?.maxInputVideos,
    audio: limits?.maxInputAudios,
  } as const;
  for (const kind of ["image", "video", "audio"] as const) {
    const count = inputCounts[kind];
    const maximum = countLimits[kind];
    if (count !== undefined && maximum !== undefined && count > maximum) {
      reasons.push(`${kind}输入最多支持 ${maximum} 个`);
    }
  }
  const totalInputs = Object.values(inputCounts).reduce(
    (sum, count) => sum + (count ?? 0),
    0,
  );
  if (
    limits?.maxInputAssets !== undefined &&
    totalInputs > limits.maxInputAssets
  ) {
    reasons.push(`输入素材总数最多支持 ${limits.maxInputAssets} 个`);
  }
  if (
    limits?.requiresInputImage &&
    !(requirements.inputKinds ?? []).includes("image")
  ) {
    reasons.push("模型要求提供图片输入");
  }
  if (
    limits?.requiresInputVideo &&
    !(requirements.inputKinds ?? []).includes("video")
  ) {
    reasons.push("模型要求提供视频输入");
  }
  if (
    requirements.requiresAudio &&
    !declaredBoolean(model.metadata, "supportsAudioOutput")
  ) {
    reasons.push("未声明生成音频能力");
  }
  if (
    requirements.requiresTextRendering &&
    !declaredBoolean(model.metadata, "supportsTextRendering")
  ) {
    reasons.push("未声明可靠文字渲染能力");
  }
  const parameters = model.parameters;
  const countParameter = parameterFor(parameters, PARAMETER_ALIASES.count);
  if (
    !optionSupports(
      parameterFor(parameters, PARAMETER_ALIASES.aspectRatio),
      requirements.aspectRatio,
      aspectRatiosEqual,
    )
  ) {
    reasons.push(`不支持画面比例 ${requirements.aspectRatio}`);
  }
  if (
    !optionSupports(
      parameterFor(parameters, PARAMETER_ALIASES.resolution),
      requirements.resolution,
    )
  ) {
    reasons.push(`不支持分辨率 ${requirements.resolution}`);
  }
  if (
    !optionSupports(
      parameterFor(parameters, PARAMETER_ALIASES.quality),
      requirements.quality,
    )
  ) {
    reasons.push(`不支持质量档 ${requirements.quality}`);
  }
  if (
    !optionSupports(
      parameterFor(parameters, PARAMETER_ALIASES.duration),
      requirements.durationSeconds,
    )
  ) {
    reasons.push(`不支持 ${requirements.durationSeconds} 秒时长`);
  }
  if (
    model.limits?.maxOutputImages !== undefined &&
    requirements.operation.startsWith("image.") &&
    requirements.count > model.limits.maxOutputImages
  ) {
    reasons.push(`单次最多输出 ${model.limits.maxOutputImages} 张`);
  } else if (
    requirements.operation.startsWith("image.") &&
    requirements.count > 1 &&
    model.limits?.maxOutputImages === undefined &&
    countParameter === undefined
  ) {
    reasons.push("未声明单次批量图片输出能力");
  } else if (
    requirements.operation.startsWith("image.") &&
    requirements.count > 1 &&
    countParameter?.max !== undefined &&
    requirements.count > countParameter.max
  ) {
    reasons.push(`单次最多输出 ${countParameter.max} 张`);
  }
  return reasons;
}

function requestedTierValue(
  tier: StructuredPriceTier,
  requirements: GenerationRequirements,
): string | number | undefined {
  switch (tier.dimension) {
    case "quality":
      return requirements.quality;
    case "resolution":
      return requirements.resolution;
    case "duration":
      return requirements.durationSeconds;
    case "fixed":
    case undefined:
      return undefined;
  }
}

function selectTier(
  tiers: readonly StructuredPriceTier[] | undefined,
  requirements: GenerationRequirements,
): StructuredPriceTier | undefined {
  if (!tiers || tiers.length === 0) return undefined;
  const exact = tiers.find((tier) => {
    const requested = requestedTierValue(tier, requirements);
    if (requested === undefined) return false;
    return (
      valuesEqual(requested, tier.value ?? tier.id) ||
      valuesEqual(requested, tier.label)
    );
  });
  return (
    exact ??
    tiers.reduce((maximum, tier) =>
      tier.price > maximum.price ? tier : maximum,
    )
  );
}

interface CostEstimate {
  readonly maximum: number;
  readonly breakdown: DirectorQuoteBreakdown;
}

function tokenCost(
  pricing: StructuredModelPricing,
  requirements: GenerationRequirements,
): CostEstimate | undefined {
  const components = [
    [pricing.inputPerMillion, requirements.maximumInputTokens],
    [pricing.outputPerMillion, requirements.maximumOutputTokens],
    [pricing.imageOutputPerMillion, requirements.maximumImageOutputTokens],
  ] as const;
  let maximum = 0;
  let present = false;
  for (const [rate, tokens] of components) {
    if (rate === undefined) continue;
    present = true;
    if (tokens === undefined) return undefined;
    maximum += (tokens / 1_000_000) * rate;
  }
  if (!present || !Number.isFinite(maximum)) return undefined;
  return {
    maximum,
    breakdown: { kind: "token", confidence: pricing.confidence },
  };
}

function maximumCost(
  candidate: DirectorCatalogCandidate,
  requirements: GenerationRequirements,
): CostEstimate | undefined {
  const pricing = candidate.pricing ?? candidate.model.pricing;
  if (!pricing) return undefined;
  if (pricing.kind === "token") return tokenCost(pricing, requirements);

  const tier = selectTier(pricing.tiers, requirements);
  const amount = tier?.price ?? pricing.unitAmount;
  if (amount === undefined || !Number.isFinite(amount) || amount < 0) {
    return undefined;
  }

  let units: number;
  if (pricing.kind === "per-second") {
    if (requirements.durationSeconds === undefined) return undefined;
    units = requirements.durationSeconds * requirements.count;
  } else if (pricing.kind === "per-image") {
    units = requirements.count;
  } else {
    const declaredCapacity = candidate.model.limits?.maxOutputImages;
    const countParameter = parameterFor(
      candidate.model.parameters,
      PARAMETER_ALIASES.count,
    );
    const fixedOutputCount = candidate.model.metadata?.["fixedOutputCount"];
    const capacity =
      typeof fixedOutputCount === "number" && fixedOutputCount > 0
        ? fixedOutputCount
        : countParameter?.max && countParameter.max > 0
          ? countParameter.max
          : countParameter
            ? requirements.count
            : declaredCapacity && declaredCapacity > 0
              ? declaredCapacity
              : 1;
    units = Math.ceil(requirements.count / capacity);
  }
  const maximum = amount * units;
  if (!Number.isFinite(maximum)) return undefined;
  return {
    maximum,
    breakdown: {
      kind: pricing.kind,
      unitAmount: amount,
      units,
      ...(tier ? { tierId: tier.id } : {}),
      confidence: pricing.confidence,
    },
  };
}

export function quoteCandidate(
  candidate: DirectorCatalogCandidate,
  requirements: GenerationRequirements,
  rates?: ExchangeRateTable,
  options: DirectorRoutingOptions = {},
): DirectorQuote {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const pricingMaxAgeMs = options.pricingMaxAgeMs ?? DEFAULT_PRICING_MAX_AGE_MS;
  const exclusionReasons = candidateExclusionReasons(
    candidate,
    requirements,
    options,
  );
  const pricing = candidate.pricing ?? candidate.model.pricing;
  const freshPricing = pricing
    ? isFresh(pricing.checkedAt, pricing.validUntil, nowMs, pricingMaxAgeMs)
    : false;
  const estimate = maximumCost(candidate, requirements);
  const currency = pricing?.currency.trim().toUpperCase();
  const ratesFresh = isFreshExchangeRateTable(rates, nowMs);
  const configuredRate = currency ? rates?.rates[currency] : undefined;
  const validConfiguredRate =
    configuredRate !== undefined &&
    Number.isFinite(configuredRate) &&
    configuredRate > 0
      ? configuredRate
      : undefined;
  const rate =
    currency === "CNY"
      ? 1
      : ratesFresh && currency
        ? validConfiguredRate
        : undefined;
  const pricingStatus =
    !pricing || estimate === undefined
      ? "unknown"
      : !freshPricing
        ? "stale"
        : rate === undefined
          ? "nonconvertible"
          : "known";
  const eligible = exclusionReasons.length === 0;

  return {
    candidate,
    eligible,
    exclusionReasons,
    ...(currency ? { originalCurrency: currency } : {}),
    ...(estimate ? { originalMaximum: estimate.maximum } : {}),
    ...(estimate && rate !== undefined
      ? { cnyMaximum: estimate.maximum * rate }
      : {}),
    ...(currency !== "CNY" && rates && rate !== undefined
      ? { rateTimestamp: rates.checkedAt }
      : {}),
    comparable: eligible && pricingStatus === "known",
    pricingStatus,
    ...(pricing?.sourceUrl ? { pricingSourceUrl: pricing.sourceUrl } : {}),
    ...(pricing?.checkedAt ? { pricingCheckedAt: pricing.checkedAt } : {}),
    ...(estimate ? { breakdown: estimate.breakdown } : {}),
  };
}

function parameterKey(
  model: ModelDescriptor | undefined,
  aliases: readonly string[],
  fallback: string,
): string {
  return parameterFor(model?.parameters, aliases)?.key ?? fallback;
}

export function parametersForRequirements(
  requirements: GenerationRequirements,
  model?: ModelDescriptor,
): Record<string, ModelParameterValue> {
  const countParameter = parameterFor(
    model?.parameters,
    PARAMETER_ALIASES.count,
  );
  return {
    ...(requirements.aspectRatio
      ? {
          [parameterKey(model, PARAMETER_ALIASES.aspectRatio, "aspect_ratio")]:
            requirements.aspectRatio,
        }
      : {}),
    ...(requirements.resolution
      ? {
          [parameterKey(model, PARAMETER_ALIASES.resolution, "size")]:
            requirements.resolution,
        }
      : {}),
    ...(requirements.quality
      ? {
          [parameterKey(model, PARAMETER_ALIASES.quality, "quality")]:
            requirements.quality,
        }
      : {}),
    ...(requirements.durationSeconds !== undefined
      ? {
          [parameterKey(model, PARAMETER_ALIASES.duration, "duration")]:
            requirements.durationSeconds,
        }
      : {}),
    ...(requirements.operation.startsWith("image.") || countParameter
      ? {
          [countParameter?.key ?? "n"]: requirements.count,
        }
      : {}),
  };
}

function quoteFreshness(quote: DirectorQuote): number {
  const parsed = quote.pricingCheckedAt
    ? Date.parse(quote.pricingCheckedAt)
    : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareDirectorQuotes(
  left: DirectorQuote,
  right: DirectorQuote,
): number {
  if (left.comparable !== right.comparable) return left.comparable ? -1 : 1;
  if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
  const leftCost = left.cnyMaximum;
  const rightCost = right.cnyMaximum;
  if (leftCost !== undefined && rightCost !== undefined) {
    const cost = leftCost - rightCost;
    if (cost !== 0) return cost;
  } else if (leftCost !== undefined || rightCost !== undefined) {
    return leftCost !== undefined ? -1 : 1;
  }
  const freshness = quoteFreshness(right) - quoteFreshness(left);
  if (freshness !== 0) return freshness;
  return `${left.candidate.connectionId}:${left.candidate.model.id}`.localeCompare(
    `${right.candidate.connectionId}:${right.candidate.model.id}`,
  );
}

export function routeDirectorCall(
  call: DirectorCallDraft,
  candidates: readonly DirectorCatalogCandidate[],
  rates?: ExchangeRateTable,
  options: DirectorRoutingOptions = {},
): RoutedDirectorCall {
  const alternatives = candidates
    .map((candidate) => {
      const quote = quoteCandidate(
        candidate,
        call.requirements,
        rates,
        options,
      );
      if (
        candidate.model.limits?.maxPromptCharacters !== undefined &&
        call.prompt.length > candidate.model.limits.maxPromptCharacters
      ) {
        const exclusionReasons = [
          ...quote.exclusionReasons,
          `提示词最多支持 ${candidate.model.limits.maxPromptCharacters} 字符`,
        ];
        return {
          ...quote,
          eligible: false,
          comparable: false,
          exclusionReasons,
        };
      }
      return quote;
    })
    .sort(compareDirectorQuotes);
  const selected = alternatives.find((quote) => quote.comparable);
  return {
    ...call,
    ...(selected ? { selected } : {}),
    alternatives,
    parameters: parametersForRequirements(
      call.requirements,
      selected?.candidate.model,
    ),
  };
}

export function routeDirectorCalls(
  calls: readonly DirectorCallDraft[],
  candidates: readonly DirectorCatalogCandidate[],
  rates?: ExchangeRateTable,
  options: DirectorRoutingOptions = {},
): RoutedDirectorCall[] {
  return calls.map((call) =>
    routeDirectorCall(call, candidates, rates, options),
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function fingerprintCatalog(
  candidates: readonly DirectorCatalogCandidate[],
): string {
  const value = candidates
    .map((candidate) => ({
      connectionId: candidate.connectionId,
      provider: candidate.provider,
      authoritative: candidate.authoritative,
      catalogCheckedAt: candidate.catalogCheckedAt ?? null,
      model: candidate.model,
      pricing: candidate.pricing ?? candidate.model.pricing ?? null,
    }))
    .sort((left, right) =>
      `${left.connectionId}:${left.model.id}`.localeCompare(
        `${right.connectionId}:${right.model.id}`,
      ),
    );
  const serialized = stableJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

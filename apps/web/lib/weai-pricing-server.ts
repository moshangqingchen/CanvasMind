import { weAIFetch } from "@super-canvas/providers";
import {
  WEAI_ADOBE_PER_REQUEST_GROUP,
  WEAI_ADOBE_PER_REQUEST_URL_GROUP,
  WEAI_ADOBE_TOKEN_GROUP,
  WEAI_AZURE_OPENAI_GROUP,
  WEAI_CODEX_TOKEN_GROUP,
  WEAI_GEMINI_GROUP,
  type WeAiLiveGroupPricing,
  type WeAiLiveModelPricing,
} from "./weai-catalog";

const MODEL_PLAZA_PATH = "/api/v1/model-plaza";
const OFFICIAL_IMAGE_DOC_URL =
  "https://docs.we-ai.cc/guides/image-generation-service.html";
const CACHE_TTL_MS = 5 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

interface PricingCacheEntry {
  readonly expiresAt: number;
  readonly groups: ReadonlyMap<string, WeAiLiveGroupPricing>;
}

let cachedPricing: PricingCacheEntry | undefined;
let pendingPricing: Promise<PricingCacheEntry> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function canonicalGroupId(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized === WEAI_ADOBE_TOKEN_GROUP) return WEAI_ADOBE_TOKEN_GROUP;
  if (normalized === WEAI_GEMINI_GROUP) return WEAI_GEMINI_GROUP;
  if (normalized === WEAI_ADOBE_PER_REQUEST_GROUP)
    return WEAI_ADOBE_PER_REQUEST_GROUP;
  if (normalized === WEAI_ADOBE_PER_REQUEST_URL_GROUP)
    return WEAI_ADOBE_PER_REQUEST_URL_GROUP;
  if (normalized === WEAI_CODEX_TOKEN_GROUP) return WEAI_CODEX_TOKEN_GROUP;
  if (/^AZURE-openai(?:-官key)?$/iu.test(normalized))
    return WEAI_AZURE_OPENAI_GROUP;
  return undefined;
}

function rounded(value: number): number {
  return Number(value.toFixed(8));
}

function effectiveMultiplier(group: Record<string, unknown>): number {
  return (
    finiteNumber(group.user_rate_multiplier) ??
    finiteNumber(group.rate_multiplier) ??
    1
  );
}

function perRequestMultiplier(
  group: Record<string, unknown>,
  billingMode: string,
): number {
  if (billingMode !== "image" || group.image_rate_independent !== true)
    return effectiveMultiplier(group);
  return finiteNumber(group.image_rate_multiplier) ?? 1;
}

function tierId(value: string, fallback: number): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/gu, "");
  if (/^(?:1k|low)$/u.test(normalized)) return normalized;
  if (/^(?:2k|medium|med)$/u.test(normalized))
    return normalized === "med" ? "medium" : normalized;
  if (/^(?:4k|high)$/u.test(normalized)) return normalized;
  return normalized || `tier-${fallback + 1}`;
}

function modelPlazaModelPricing(
  group: Record<string, unknown>,
  model: Record<string, unknown>,
): WeAiLiveModelPricing | undefined {
  const pricing = isRecord(model.pricing) ? model.pricing : undefined;
  if (!pricing) return undefined;
  const billingMode = stringValue(pricing.billing_mode) ?? "token";
  const multiplier = effectiveMultiplier(group);
  if (billingMode === "token") {
    const scale = multiplier * 1_000_000;
    return {
      kind: "token",
      multiplier,
      ...(finiteNumber(pricing.input_price) !== undefined
        ? { input: rounded(finiteNumber(pricing.input_price)! * scale) }
        : {}),
      ...(finiteNumber(pricing.output_price) !== undefined
        ? { output: rounded(finiteNumber(pricing.output_price)! * scale) }
        : {}),
      ...(finiteNumber(pricing.cache_read_price) !== undefined
        ? { cacheRead: rounded(finiteNumber(pricing.cache_read_price)! * scale) }
        : {}),
    };
  }

  const requestScale = perRequestMultiplier(group, billingMode);
  const intervals = Array.isArray(pricing.intervals)
    ? pricing.intervals.filter(isRecord)
    : [];
  const tiers = intervals.flatMap((interval, index) => {
    const price = finiteNumber(interval.per_request_price);
    if (price === undefined) return [];
    const label = stringValue(interval.tier_label) ?? `档位 ${index + 1}`;
    return [
      {
        id: tierId(label, index),
        label,
        price: rounded(price * requestScale),
      },
    ];
  });
  const single = finiteNumber(pricing.per_request_price);
  if (tiers.length === 0 && single === undefined) return undefined;
  return {
    kind: billingMode === "image" ? "per-image" : "per-request",
    multiplier: requestScale,
    tiers:
      tiers.length > 0
        ? tiers
        : [{ id: "request", label: "单次", price: rounded(single! * requestScale) }],
  };
}

function addAdobeQualityAliases(
  groupId: string,
  models: Record<string, WeAiLiveModelPricing>,
): void {
  if (groupId !== WEAI_ADOBE_PER_REQUEST_GROUP) return;
  const combined = models["gpt-image-2"];
  if (!combined || combined.kind === "token") return;
  for (const quality of ["low", "medium", "high"] as const) {
    const tier = combined.tiers.find(
      (candidate) => candidate.id.toLowerCase() === quality,
    );
    if (!tier) continue;
    models[`gpt-image-2-${quality}`] = {
      kind: "per-request",
      multiplier: combined.multiplier,
      tiers: [{ ...tier, id: "request", label: "单次" }],
    };
  }
}

/** Parses the current Sub2API model-plaza response used by the We-AI site. */
export function parseWeAiModelPlazaPricing(
  payload: unknown,
  checkedAt = new Date().toISOString(),
  sourceUrl = `https://asian-acc.we-token.cc${MODEL_PLAZA_PATH}`,
): ReadonlyMap<string, WeAiLiveGroupPricing> {
  const envelope = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  if (!isRecord(envelope) || !Array.isArray(envelope.groups)) return new Map();
  const result = new Map<string, WeAiLiveGroupPricing>();
  for (const rawGroup of envelope.groups) {
    if (!isRecord(rawGroup)) continue;
    const rawId =
      stringValue(rawGroup.name) ?? stringValue(rawGroup.id) ?? "";
    const groupId = canonicalGroupId(rawId);
    if (!groupId) continue;
    const models: Record<string, WeAiLiveModelPricing> = {};
    for (const rawModel of Array.isArray(rawGroup.models)
      ? rawGroup.models
      : []) {
      if (!isRecord(rawModel)) continue;
      const id = stringValue(rawModel.name);
      const pricing = modelPlazaModelPricing(rawGroup, rawModel);
      if (id && pricing) models[id] = pricing;
    }
    addAdobeQualityAliases(groupId, models);
    result.set(groupId, {
      groupId,
      source: "model-plaza",
      sourceUrl,
      checkedAt,
      complete: true,
      multiplier: effectiveMultiplier(rawGroup),
      models,
    });
  }
  return result;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&times;/giu, "×")
    .replace(/&#215;/giu, "×")
    .replace(/&(?:amp|quot|#39);/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function centsFromChinesePrice(value: string): number | undefined {
  const decimal = /([0-9]+(?:\.[0-9]+)?)\s*分/u.exec(value)?.[1];
  if (decimal) return rounded(Number(decimal) / 100);
  const mao = /([0-9]+)\s*毛(?:\s*([0-9]+))?/u.exec(value);
  if (!mao) return undefined;
  return rounded(Number(mao[1]) / 10 + Number(mao[2] ?? 0) / 100);
}

function documentedPrice(text: string, modelId: string): number | undefined {
  const index = text.lastIndexOf(modelId);
  if (index < 0) return undefined;
  return centsFromChinesePrice(text.slice(index, index + 80));
}

function tokenPricing(multiplier: number): WeAiLiveModelPricing {
  return {
    kind: "token",
    multiplier,
    input: rounded(5 * multiplier),
    output: rounded(10 * multiplier),
    cacheRead: rounded(1.25 * multiplier),
    imageOutput: rounded(30 * multiplier),
  };
}

/** Parses current prices that We-AI publishes in its official image guide. */
export function parseWeAiOfficialDocsPricing(
  html: string,
  checkedAt = new Date().toISOString(),
  sourceUrl = OFFICIAL_IMAGE_DOC_URL,
): ReadonlyMap<string, WeAiLiveGroupPricing> {
  const text = htmlToText(html);
  const result = new Map<string, WeAiLiveGroupPricing>();

  const adobeSection = text.slice(
    Math.max(0, text.indexOf("2. ADOBE 渠道")),
    text.indexOf("3. AZ 渠道") > 0 ? text.indexOf("3. AZ 渠道") : undefined,
  );
  const adobeMultiplier = Number(
    /Token\s*计费[^。]{0,40}?([0-9]+(?:\.[0-9]+)?)\s*倍/u.exec(
      adobeSection,
    )?.[1] ?? "",
  );
  if (Number.isFinite(adobeMultiplier) && adobeMultiplier > 0) {
    result.set(WEAI_ADOBE_TOKEN_GROUP, {
      groupId: WEAI_ADOBE_TOKEN_GROUP,
      source: "official-docs",
      sourceUrl,
      checkedAt,
      complete: false,
      multiplier: adobeMultiplier,
      models: { "gpt-image-2": tokenPricing(adobeMultiplier) },
    });
  }

  const low = documentedPrice(adobeSection, "gpt-image-2-low");
  const medium = documentedPrice(adobeSection, "gpt-image-2-medium");
  const high = documentedPrice(adobeSection, "gpt-image-2-high");
  if (low !== undefined && medium !== undefined && high !== undefined) {
    const models: Record<string, WeAiLiveModelPricing> = {};
    for (const [quality, price] of [
      ["low", low],
      ["medium", medium],
      ["high", high],
    ] as const) {
      models[`gpt-image-2-${quality}`] = {
        kind: "per-request",
        multiplier: 1,
        tiers: [{ id: "request", label: "单次", price }],
      };
    }
    models["gpt-image-2"] = {
      kind: "per-request",
      multiplier: 1,
      tiers: [
        { id: "low", label: "LOW", price: low },
        { id: "medium", label: "MEDIUM", price: medium },
        { id: "high", label: "HIGH", price: high },
      ],
    };
    result.set(WEAI_ADOBE_PER_REQUEST_GROUP, {
      groupId: WEAI_ADOBE_PER_REQUEST_GROUP,
      source: "official-docs",
      sourceUrl,
      checkedAt,
      complete: false,
      multiplier: 1,
      models,
    });
  }

  const azSection = text.slice(Math.max(0, text.indexOf("3. AZ 渠道")));
  const azureMultiplier = Number(
    /倍率\s*([0-9]+(?:\.[0-9]+)?)\s*[x×]/iu.exec(azSection)?.[1] ?? "",
  );
  if (Number.isFinite(azureMultiplier) && azureMultiplier > 0) {
    result.set(WEAI_AZURE_OPENAI_GROUP, {
      groupId: WEAI_AZURE_OPENAI_GROUP,
      source: "official-docs",
      sourceUrl,
      checkedAt,
      complete: false,
      multiplier: azureMultiplier,
      models: { "gpt-image-2": tokenPricing(azureMultiplier) },
    });
  }
  return result;
}

async function responseText(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const length = finiteNumber(response.headers.get("content-length"));
  if (length !== undefined && length > MAX_RESPONSE_BYTES)
    throw new Error("We-AI pricing response is too large");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES)
    throw new Error("We-AI pricing response is too large");
  return text;
}

function originFromBaseUrl(baseUrl: unknown): string {
  try {
    const parsed = new URL(typeof baseUrl === "string" ? baseUrl : "");
    if (parsed.hostname === "we-token.cc" || parsed.hostname.endsWith(".we-token.cc"))
      return parsed.origin;
  } catch {
    // Use the official Asia endpoint below.
  }
  return "https://asian-acc.we-token.cc";
}

async function fetchPricing(baseUrl: unknown): Promise<PricingCacheEntry> {
  const checkedAt = new Date().toISOString();
  const origin = originFromBaseUrl(baseUrl);
  const plazaUrl = `${origin}${MODEL_PLAZA_PATH}`;
  try {
    const token = process.env.WEAI_WEBSITE_ACCESS_TOKEN?.trim();
    const response = await weAIFetch(plazaUrl, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    const payload = JSON.parse(await responseText(response)) as unknown;
    const groups = parseWeAiModelPlazaPricing(payload, checkedAt, plazaUrl);
    if (groups.size > 0)
      return { expiresAt: Date.now() + CACHE_TTL_MS, groups };
  } catch {
    // The We-AI site currently disables its public model-plaza endpoint. The
    // official guide below remains an authoritative, public live source.
  }

  const docsResponse = await weAIFetch(OFFICIAL_IMAGE_DOC_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  const groups = parseWeAiOfficialDocsPricing(
    await responseText(docsResponse),
    checkedAt,
  );
  if (groups.size === 0) throw new Error("We-AI official pricing was not found");
  return { expiresAt: Date.now() + CACHE_TTL_MS, groups };
}

/** Returns website pricing with a short shared cache so group changes stay instant. */
export async function liveWeAiPricingForGroup(
  groupId: unknown,
  baseUrl: unknown,
): Promise<WeAiLiveGroupPricing | undefined> {
  const id = typeof groupId === "string" ? canonicalGroupId(groupId) : undefined;
  if (!id) return undefined;
  if (cachedPricing && cachedPricing.expiresAt > Date.now())
    return cachedPricing.groups.get(id);
  pendingPricing ??= fetchPricing(baseUrl).finally(() => {
    pendingPricing = undefined;
  });
  const fresh = await pendingPricing;
  cachedPricing = fresh;
  return fresh.groups.get(id);
}

export function resetWeAiPricingCacheForTests(): void {
  cachedPricing = undefined;
  pendingPricing = undefined;
}

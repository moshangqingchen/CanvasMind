import type { FetchImplementation, StructuredModelPricing, StructuredPriceTier } from "./contracts.js";
import { fetchProviderJson, providerFetch, ProviderHttpError } from "./http.js";

export const WEAI_LEGACY_ORIGIN = "https://asian-acc.we-token.cc";
export const WEAI_LEGACY_MODELS_URL = `${WEAI_LEGACY_ORIGIN}/api/v1/model-plaza-legacy/models`;
export const WEAI_LEGACY_PRICE_UNIT_NOTE = "USD 为本站账面额度；供应商注明本站 1 人民币 = 1 美元。报价已按该分组倍率折算，不进行外汇换算。";
type Row = Record<string, unknown>;
const record = (value: unknown): Row | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;
const amount = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const name = (value: unknown): string | undefined => typeof value === "string" && value.trim() && value.trim().length <= 256 ? value.trim() : undefined;
const groupId = (value: unknown): number | undefined => {
  const number = typeof value === "number" ? value : typeof value === "string" && /^[1-9]\d*$/u.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
};

/** This fork's legacy UI is an exact-site contract, not a generic Sub2API API. */
export function isWeAiLegacyCatalogSource(siteUrl: string): boolean {
  try {
    const url = new URL(siteUrl);
    return url.origin === WEAI_LEGACY_ORIGIN && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

/** Only the official read endpoint and a single positive account group ID may
 * receive the website session. No API Key or write endpoint is included. */
export function isWeAiLegacyAuthenticatedRead(base: string, target: URL, method: string): boolean {
  if (base !== WEAI_LEGACY_ORIGIN || method !== "GET" || target.origin !== base ||
    `${target.origin}${target.pathname}` !== WEAI_LEGACY_MODELS_URL || target.hash || target.username || target.password) return false;
  if (!target.search) return true;
  const parameters = [...target.searchParams];
  return parameters.length === 1 && parameters[0]?.[0] === "group_id" && groupId(parameters[0][1]) !== undefined;
}

export interface WeAiLegacyGroupOption { id: number; name: string; platform?: string }
export interface WeAiLegacyModelEvidence {
  id: string;
  platform?: string;
  pricing?: StructuredModelPricing;
  priceLabel?: string;
  /** Missing tier amounts remain unconfigured, never filled from another tier. */
  configuredPriceFields: string[];
  unconfiguredPriceFields: string[];
  imageTierPricesComplete?: boolean;
}
export interface WeAiLegacyGroupEvidence {
  group: WeAiLegacyGroupOption;
  models: WeAiLegacyModelEvidence[];
  tokenMultiplier: number;
  imageMultiplier: number;
  imageQualityBilling: boolean;
  checkedAt: string;
}
export interface WeAiLegacyCatalogRead {
  groups: WeAiLegacyGroupEvidence[];
  availableGroups: WeAiLegacyGroupOption[];
  complete: boolean;
  status: "live" | "empty" | "failed" | "unauthorized";
  checkedAt: string;
  failedGroups: Array<{ groupId: number; status: number; reason: "http" | "invalid" }>;
}

/** The current official PricingView multiplies raw token rates by 1M and the
 * returned token_multiplier, and image request rates by image_multiplier.
 * Its locale explicitly calls these USD amounts; its CNY 1 = USD 1 recharge
 * convention is not a market exchange rate. Group/user rates are not applied
 * a second time. Null is unconfigured, while a configured zero remains zero.
 */
function pricingFromRow(row: Row, data: Row, id: number, checkedAt: string): { pricing: StructuredModelPricing; priceLabel: string } | undefined {
  if ([row.currency, data.currency].some(currency => currency !== undefined && currency !== null && currency !== "USD")) return undefined;
  const tokenMultiplier = amount(data.token_multiplier), imageMultiplier = amount(data.image_multiplier);
  if (tokenMultiplier === undefined || imageMultiplier === undefined) return undefined;
  const fields = ["input_price", "output_price", "cache_write_price", "cache_read_price", "image_input_price", "image_output_price", "per_request_price"];
  if (fields.some(field => row[field] !== undefined && row[field] !== null && amount(row[field]) === undefined)) return undefined;
  if (row.intervals !== undefined && row.intervals !== null && (!Array.isArray(row.intervals) || row.intervals.length)) return undefined;
  const scale = (value: unknown, multiplier: number, unit = 1) => {
    const raw = amount(value), result = raw === undefined ? undefined : Number((raw * multiplier * unit).toPrecision(12));
    return result !== undefined && Number.isFinite(result) ? result : undefined;
  };
  if (fields.some(field => amount(row[field]) !== undefined &&
    scale(row[field], row.billing_mode === "token" ? tokenMultiplier : imageMultiplier, row.billing_mode === "token" ? 1_000_000 : 1) === undefined)) return undefined;
  const base = { currency: "USD", checkedAt, confidence: "exact" as const, sourceUrl: `${WEAI_LEGACY_MODELS_URL}?group_id=${id}` };
  if (row.billing_mode === "token") {
    const tiers: StructuredPriceTier[] = [];
    for (const [field, label, kind] of [
      ["input_price", "文本输入", "input"], ["output_price", "文本输出", "output"],
      ["cache_write_price", "缓存写入", "cache_write"], ["cache_read_price", "缓存读取", "cache_read"],
      ["image_input_price", "图像输入", "image_input"], ["image_output_price", "图像输出", "image_output"],
    ] as const) {
      const price = scale(row[field], tokenMultiplier, 1_000_000);
      if (price !== undefined) tiers.push({ id: field, label, price, conditions: [{ parameter: "token_kind", operator: "equals", value: kind }], conditionMode: "all" });
    }
    if (!tiers.length) return undefined;
    const input = tiers.find(tier => tier.id === "input_price")?.price;
    const output = tiers.find(tier => tier.id === "output_price")?.price;
    const imageOutput = tiers.find(tier => tier.id === "image_output_price")?.price;
    const pricing: StructuredModelPricing = { ...base, kind: "token", tiers,
      ...(input !== undefined ? { inputPerMillion: input } : {}), ...(output !== undefined ? { outputPerMillion: output } : {}),
      ...(imageOutput !== undefined ? { imageOutputPerMillion: imageOutput } : {}) };
    return { pricing, priceLabel: tiers.map(tier => `${tier.label} $${tier.price}/1M tokens（USD 额度）`).join("；") };
  }
  if (row.billing_mode !== "image") return undefined;
  const rawTiers = record(row.image_tiers);
  if (row.image_tiers !== undefined && row.image_tiers !== null && !rawTiers) return undefined;
  const qualityFields = ["price_low", "price_medium", "price_high"];
  const resolutionFields = ["price_1k", "price_2k", "price_4k"];
  if ([...qualityFields, ...resolutionFields].some(field => rawTiers?.[field] !== undefined && rawTiers[field] !== null && amount(rawTiers[field]) === undefined)) return undefined;
  const qualities = qualityFields.some(field => amount(rawTiers?.[field]) !== undefined);
  const resolutions = resolutionFields.some(field => amount(rawTiers?.[field]) !== undefined);
  const dimension = qualities || !resolutions && data.image_quality_billing === true ? "quality" : "resolution";
  const labels = dimension === "quality" ? ["low", "medium", "high"] : ["1K", "2K", "4K"];
  const selected = dimension === "quality" ? qualityFields : resolutionFields;
  const tiers = selected.flatMap((field, index): StructuredPriceTier[] => {
    const raw = qualities || resolutions ? rawTiers?.[field] : row.per_request_price;
    const price = scale(raw, imageMultiplier);
    const label = labels[index]!;
    return price === undefined ? [] : [{ id: field, label, dimension, value: label, price }];
  });
  if (!tiers.length) return undefined;
  const fixed = tiers.length === 3 && tiers.every(tier => tier.price === tiers[0]!.price) ? tiers[0]!.price : undefined;
  const pricing: StructuredModelPricing = { ...base, kind: "per-request", billingUnit: "request", tiers, ...(fixed !== undefined ? { unitAmount: fixed } : {}) };
  return { pricing, priceLabel: tiers.map(tier => `${tier.label} $${tier.price}/次（USD 额度）`).join("；") };
}

/** A group's model array belongs only to selected_group_id. The options array
 * describes account groups, not shared model memberships or Key permissions. */
export function parseWeAiLegacyGroup(payload: unknown, checkedAt: string, requestedGroupId?: number): {
  availableGroups: WeAiLegacyGroupOption[]; selected?: WeAiLegacyGroupEvidence;
} | undefined {
  const root = record(payload), data = record(root?.data);
  if (!root || root.success === false || root.error || !(root.code === 0 || root.code === 200 || root.code === undefined && root.success === true) ||
    !data || !Array.isArray(data.groups) || !Array.isArray(data.models) || data.groups.length > 100 || data.models.length > 3000) return undefined;
  const availableGroups: WeAiLegacyGroupOption[] = [];
  const ids = new Set<number>();
  for (const value of data.groups) {
    const row = record(value), id = groupId(row?.id), label = name(row?.name), platform = name(row?.platform);
    if (!row || id === undefined || !label || ids.has(id)) return undefined;
    ids.add(id);
    availableGroups.push({ id, name: label, ...(platform ? { platform } : {}) });
  }
  if (!availableGroups.length) return data.models.length === 0 && requestedGroupId === undefined &&
    (data.selected_group_id === undefined || data.selected_group_id === null) ? { availableGroups } : undefined;
  const selectedId = groupId(data.selected_group_id), group = availableGroups.find(group => group.id === selectedId);
  const tokenMultiplier = amount(data.token_multiplier), imageMultiplier = amount(data.image_multiplier);
  if (!group || requestedGroupId !== undefined && requestedGroupId !== selectedId || tokenMultiplier === undefined || imageMultiplier === undefined ||
    typeof data.image_quality_billing !== "boolean") return undefined;
  const models = new Map<string, WeAiLegacyModelEvidence>(), rawById = new Map<string, string>();
  for (const value of data.models) {
    const row = record(value), id = name(row?.name), platform = name(row?.platform);
    if (!row || !id) return undefined;
    const pricing = pricingFromRow(row, data, group.id, checkedAt);
    const imageTiers = record(row.image_tiers);
    const quality = ["price_low", "price_medium", "price_high"];
    const resolution = ["price_1k", "price_2k", "price_4k"];
    const qualitySelected = quality.some(field => amount(imageTiers?.[field]) !== undefined);
    const resolutionSelected = resolution.some(field => amount(imageTiers?.[field]) !== undefined);
    const imageFields = qualitySelected ? quality : resolutionSelected ? resolution : ["per_request_price"];
    const fields = row.billing_mode === "image" ? imageFields : row.billing_mode === "token"
      ? ["input_price", "output_price", "cache_write_price", "cache_read_price", "image_input_price", "image_output_price"] : [];
    const valueFor = (field: string) => field.startsWith("price_") ? imageTiers?.[field] : row[field];
    const configuredPriceFields = fields.filter(field => amount(valueFor(field)) !== undefined);
    const unconfiguredPriceFields = fields.filter(field => amount(valueFor(field)) === undefined);
    const model: WeAiLegacyModelEvidence = { id, ...(platform ? { platform } : {}), ...(pricing ?? {}), configuredPriceFields, unconfiguredPriceFields,
      ...(row.billing_mode === "image" ? { imageTierPricesComplete: !!pricing && !unconfiguredPriceFields.length } : {}) };
    const fingerprint = JSON.stringify({ platform, billingMode: row.billing_mode, pricing, configuredPriceFields, unconfiguredPriceFields });
    if (rawById.has(id) && rawById.get(id) !== fingerprint) return undefined;
    rawById.set(id, fingerprint);
    models.set(id, model);
  }
  return { availableGroups, selected: { group, models: [...models.values()], tokenMultiplier, imageMultiplier,
    imageQualityBilling: data.image_quality_billing, checkedAt } };
}

/** Free same-site reads only, with two workers and a shared 90s deadline.
 * Failed/invalid groups are omitted from this live sample and explicitly mark
 * it partial, so the application can retain their historical evidence. */
export async function readWeAiLegacyCatalog(siteUrl: string, fetchImpl: FetchImplementation = providerFetch,
  headers?: Record<string, string>, signal?: AbortSignal): Promise<WeAiLegacyCatalogRead> {
  const empty = (status: WeAiLegacyCatalogRead["status"]): WeAiLegacyCatalogRead => ({ groups: [], availableGroups: [],
    failedGroups: [], complete: false, status, checkedAt: new Date().toISOString() });
  if (!isWeAiLegacyCatalogSource(siteUrl)) return empty("failed");
  const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 90_000);
  const sharedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  const read = async (url: string, id?: number) => {
    try {
      const payload = await fetchProviderJson(fetchImpl, url, { method: "GET", cache: "no-store", redirect: "error", ...(headers ? { headers } : {}) },
        { phase: "connect", timeoutMs: 8000, maxResponseBytes: 4 * 1024 * 1024, signal: sharedSignal });
      const checkedAt = new Date().toISOString();
      const parsed = parseWeAiLegacyGroup(payload, checkedAt, id);
      return { status: 200, checkedAt, parsed };
    } catch (error) {
      return { status: error instanceof ProviderHttpError ? error.details.status ?? 0 : 0, checkedAt: new Date().toISOString(), parsed: undefined };
    }
  };
  try {
    const initial = await read(WEAI_LEGACY_MODELS_URL);
    if (!initial.parsed) return { ...empty([401, 403].includes(initial.status) ? "unauthorized" : "failed"), checkedAt: initial.checkedAt };
    const availableGroups = initial.parsed.availableGroups;
    const identitySet = (groups: WeAiLegacyGroupOption[]) => JSON.stringify([...groups].sort((a, b) => a.id - b.id));
    const initialIdentities = identitySet(availableGroups);
    if (!availableGroups.length) return { ...empty("empty"), complete: true, checkedAt: initial.checkedAt };
    const groups = new Map<number, WeAiLegacyGroupEvidence>(), failedGroups: WeAiLegacyCatalogRead["failedGroups"] = [];
    if (initial.parsed.selected) groups.set(initial.parsed.selected.group.id, initial.parsed.selected);
    const pending = availableGroups.filter(group => !groups.has(group.id));
    let cursor = 0;
    await Promise.all([0, 1].map(async () => {
      while (cursor < pending.length) {
        const group = pending[cursor++]!;
        if (sharedSignal.aborted) { failedGroups.push({ groupId: group.id, status: 0, reason: "http" }); continue; }
        const result = await read(`${WEAI_LEGACY_MODELS_URL}?group_id=${group.id}`, group.id);
        const selected = result.parsed?.selected;
        if (selected && selected.group.name === group.name && selected.group.platform === group.platform &&
          identitySet(result.parsed!.availableGroups) === initialIdentities) groups.set(group.id, selected);
        else failedGroups.push({ groupId: group.id, status: result.status, reason: result.status === 200 ? "invalid" : "http" });
      }
    }));
    return { groups: availableGroups.flatMap(group => groups.has(group.id) ? [groups.get(group.id)!] : []), availableGroups,
      failedGroups, complete: !failedGroups.length, status: "live", checkedAt: new Date().toISOString() };
  } finally { clearTimeout(deadline); }
}

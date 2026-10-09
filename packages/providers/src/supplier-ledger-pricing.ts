import { fetchProviderJson, providerFetch } from "./http.js";
import type { FetchImplementation } from "./contracts.js";

export const SYNORA_LEDGER_URL = "https://synoralink.com/api/v1/usage?page=1&page_size=100";
export const SYNORA_NOTIFICATIONS_URL = "https://synoralink.com/api/v1/announcements";

/** A billed sample, never a fixed quote or proof that a Key may use a model. */
export interface SupplierLedgerPrice {
  amount: number;
  currency: string;
  unit: "image" | "request";
  checkedAt: string;
  observedAt: string;
  sourceUrl: string;
  supplierGroupId: string;
  modelId: string;
  resolution: string;
  parameters: { n: number; resolution: string };
  sample: true;
  billingMode: string;
  notificationAt?: string;
  notificationSourceUrl?: string;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const timestamp = (value: unknown): string | undefined => typeof value === "string" &&
  value.length <= 64 && Number.isFinite(Date.parse(value)) ? value : undefined;
const numericId = (value: unknown): string | undefined => {
  const id = typeof value === "number" ? value : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id >= 0 ? String(id) : undefined;
};
const safeModelId = (value: unknown): string | undefined => typeof value === "string" &&
  value.length > 0 && value.length <= 256 && !/\s|Bearer|sk-[A-Za-z0-9]{12}/u.test(value) ? value : undefined;
function rows(payload: unknown): unknown[] {
  const root = record(payload);
  if (!root || root.success === false || root.error || typeof root.code === "number" && ![0, 200].includes(root.code)) return [];
  const data = root.data;
  return Array.isArray(data) ? data : Array.isArray(record(data)?.items) ? record(data)!.items as unknown[] : [];
}

/** Exact first-party source; similarly named hosts and proxy paths are excluded. */
export function isSynoraLedgerSource(siteUrl: string): boolean {
  try {
    const url = new URL(siteUrl);
    return url.origin === "https://synoralink.com" && ["", "/"].includes(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function parseSynoraLedgerPrices(payload: unknown, options: {
  supplierSiteUrl: string; checkedAt: string; notifications?: unknown;
}): SupplierLedgerPrice[] {
  if (!isSynoraLedgerSource(options.supplierSiteUrl) || !timestamp(options.checkedAt)) return [];
  const latest = new Map<string, SupplierLedgerPrice>();
  for (const value of rows(payload).slice(0, 100)) {
    const row = record(value);
    if (!row || row.billing_mode !== "image" || row.image_count !== 1 ||
      row.success === false || ["failed", "error", "cancelled"].includes(String(row.status)) ||
      typeof row.actual_cost !== "number" || !Number.isFinite(row.actual_cost) || row.actual_cost < 0 ||
      row.currency !== undefined && row.currency !== "USD") continue;
    const supplierGroupId = numericId(row.group_id), modelId = safeModelId(row.model), observedAt = timestamp(row.created_at);
    const resolution = typeof row.image_size === "string" && /^(?:[124]K|[1-9]\d{1,4}x[1-9]\d{1,4})$/iu.test(row.image_size)
      ? row.image_size.toUpperCase() : undefined;
    if (!supplierGroupId || !modelId || !observedAt || !resolution) continue;
    // Synora's official account dashboard displays usage actual_cost in $.
    // No recharge ratio, group multiplier, token rate, or FX is applied here.
    const sample: SupplierLedgerPrice = { amount: row.actual_cost, currency: "USD", unit: "image", checkedAt: options.checkedAt,
      observedAt, sourceUrl: SYNORA_LEDGER_URL, supplierGroupId, modelId, resolution,
      parameters: { n: 1, resolution }, sample: true, billingMode: "image" };
    const identity = JSON.stringify([supplierGroupId, modelId, resolution]);
    const old = latest.get(identity);
    if (!old || Date.parse(observedAt) > Date.parse(old.observedAt)) latest.set(identity, sample);
  }
  const notices = rows(options.notifications).flatMap(value => {
    const row = record(value), at = timestamp(row?.created_at);
    return row && at && typeof row.title === "string" && typeof row.content === "string" &&
      row.title.includes("全参") && /价格|涨价|降价/u.test(row.title) ? [{ at, content: row.content }] : [];
  });
  return [...latest.values()].map(sample => {
    // The current notice names the full model and the full-parameter group.
    // "008" is not parsed as an amount; only an actual billed row sets price.
    if (sample.supplierGroupId !== "115") return sample;
    const escaped = sample.modelId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const model = new RegExp(`(?<![\\w.-])${escaped}(?![\\w.-])`, "u");
    const notice = notices.filter(value => model.test(value.content))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    return notice ? { ...sample, notificationAt: notice.at, notificationSourceUrl: SYNORA_NOTIFICATIONS_URL } : sample;
  });
}

/** Bounded official GETs, using the caller's confined website session. */
export async function readSynoraLedgerPrices(siteUrl: string, fetchImpl: FetchImplementation = providerFetch,
  options: { checkedAt?: string; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<SupplierLedgerPrice[]> {
  if (!isSynoraLedgerSource(siteUrl)) return [];
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const read = async (url: string): Promise<unknown> => {
    try {
      return await fetchProviderJson(fetchImpl, url, { method: "GET", cache: "no-store", redirect: "error",
        ...(options.headers ? { headers: options.headers } : {}) }, { phase: "connect", timeoutMs: 8000,
        maxResponseBytes: 4 * 1024 * 1024, ...(options.signal ? { signal: options.signal } : {}) });
    } catch { return undefined; }
  };
  const [ledger, notifications] = await Promise.all([read(SYNORA_LEDGER_URL), read(SYNORA_NOTIFICATIONS_URL)]);
  return parseSynoraLedgerPrices(ledger, { supplierSiteUrl: siteUrl, checkedAt, notifications });
}

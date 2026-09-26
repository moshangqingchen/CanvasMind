import { fetchProviderJson, supplierDirectoryBase, type FetchImplementation } from "@super-canvas/providers";
import type { SupplierBillingSnapshot } from "@super-canvas/db";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown): number | undefined => {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
function data(payload: unknown) {
  const root = record(payload);
  if (root.success === false || (typeof root.code === "number" && ![0, 200].includes(root.code))) throw Error("供应商未返回有效账务数据");
  return record(root.data ?? root);
}

/** No key-list sums or recent-page sums: only account-wide totals are accepted. */
export function parseSupplierBilling(kind: "newapi" | "sub2api", profilePayload: unknown, extraPayload: unknown) {
  const profile = data(profilePayload);
  let extra: Record<string, unknown>;
  try { extra = data(extraPayload); } catch { extra = {}; }
  const divisor = kind === "newapi" ? number(extra.quota_per_unit) : undefined;
  const explicitCurrency = String(profile.currency ?? extra.currency ?? "").toUpperCase();
  let unit = kind === "newapi" && !(divisor && divisor > 0) ? "quota"
    : ["USD", "CNY", "EUR"].includes(explicitCurrency) ? explicitCurrency : "credits";
  let factor = 1;
  if (kind === "newapi" && divisor && divisor > 0) {
    const display = String(extra.quota_display_type ?? "").toUpperCase();
    const exchange = number(extra.usd_exchange_rate);
    const customExchange = number(extra.custom_currency_exchange_rate);
    if (display === "TOKENS") unit = "quota";
    else if (display === "USD") unit = "USD";
    else if (display === "CNY" && exchange && exchange > 0) { unit = "CNY"; factor = exchange; }
    else if (display === "CUSTOM" && customExchange && customExchange > 0 && typeof extra.custom_currency_symbol === "string") {
      unit = extra.custom_currency_symbol.trim().slice(0, 20) || "额度"; factor = customExchange;
    }
  }
  const convert = (value: unknown) => {
    const amount = number(value);
    return amount === undefined ? undefined : kind === "newapi" && unit !== "quota" && divisor && divisor > 0 ? amount / divisor * factor : amount;
  };
  return {
    balance: convert(kind === "newapi" ? profile.quota : profile.balance),
    used: convert(kind === "newapi" ? profile.used_quota : extra.total_actual_cost),
    todayUsed: kind === "sub2api" ? number(extra.today_actual_cost) : undefined,
    requests: number(kind === "newapi" ? profile.request_count : extra.total_requests),
    unit,
  };
}

export async function readSupplierBilling(input: { siteUrl: string; sourceId: string; kind: "newapi" | "sub2api" }, fetch: FetchImplementation): Promise<SupplierBillingSnapshot> {
  const base = supplierDirectoryBase(input.siteUrl);
  const profilePath = input.kind === "newapi" ? "/api/user/self" : "/api/v1/user/profile";
  const extraPath = input.kind === "newapi" ? "/api/status" : "/api/v1/usage/dashboard/stats";
  const read = (path: string) => fetchProviderJson<unknown>(fetch, base + path, { method: "GET", cache: "no-store", redirect: "error" },
    { phase: "connect", timeoutMs: 12000, maxResponseBytes: 1024 * 1024 });
  const [profile, extra] = await Promise.allSettled([read(profilePath), read(extraPath)]);
  if (profile.status === "rejected") throw Error("余额与消耗读取失败，请检查站点登录或稍后重试");
  const amounts = parseSupplierBilling(input.kind, profile.value, extra.status === "fulfilled" ? extra.value : {});
  if (amounts.balance === undefined && amounts.used === undefined) throw Error("供应商没有返回可识别的余额或消耗字段");
  const checkedAt = new Date().toISOString();
  const partial = extra.status === "rejected" || amounts.balance === undefined || amounts.used === undefined || amounts.unit === "quota";
  return { sourceId: input.sourceId, ...amounts, checkedAt, lastSuccessAt: checkedAt, sourceUrl: base + profilePath,
    status: partial ? "partial" : "live", ...(partial ? { error: "部分账务字段未返回；未提供的金额显示为未读取" } : {}) };
}

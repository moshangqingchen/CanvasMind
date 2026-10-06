import { fetchProviderJson, isTk1688CatalogSource, ProviderHttpError, supplierDirectoryBase, type FetchImplementation } from "@super-canvas/providers";
import type { SupplierBillingSnapshot } from "@super-canvas/db";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown): number | undefined => {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
function data(payload: unknown) {
  const root = record(payload);
  const hasCode = root.code !== undefined && root.code !== null;
  if (root.success === false || (hasCode && ![0, 200].includes(number(root.code) ?? NaN))) throw Error("供应商未返回有效账务数据");
  return record(root.data ?? root);
}

const currency = (value: unknown) => typeof value === "string" && /^[A-Z]{3}$/u.test(value.trim().toUpperCase()) ? value.trim().toUpperCase() : undefined;

/** No key-list sums or recent-page sums: only account-wide totals are accepted. */
export function parseSupplierBilling(kind: "newapi" | "sub2api", profilePayload: unknown, extraPayload: unknown, todayPayload?: unknown,
  options: { siteUrl?: string } = {}) {
  const profile = data(profilePayload);
  let extra: Record<string, unknown>;
  try { extra = data(extraPayload); } catch { extra = {}; }
  let today: Record<string, unknown>;
  try { today = data(todayPayload); } catch { today = {}; }
  const divisor = kind === "newapi" ? number(extra.quota_per_unit) : undefined;
  const profileCurrency = currency(profile.currency), extraCurrency = currency(extra.currency);
  let unit = kind === "newapi" ? "quota" : profileCurrency ?? extraCurrency ?? "credits";
  let unitBasis: SupplierBillingSnapshot["unitBasis"] = kind === "newapi" ? "raw-quota" : unit === "credits" ? "unspecified" : "declared-currency";
  let unitNote = kind === "newapi" ? "站点未提供完整换算设置，显示原始额度，不换算为货币。"
    : unit === "credits" ? "站点未注明币种，金额仅按后台额度显示。" : "按站点返回的币种显示，未自动换算。";
  let factor = 1;
  if (kind === "newapi" && divisor && divisor > 0) {
    const tk1688 = options.siteUrl !== undefined && isTk1688CatalogSource(options.siteUrl);
    const display = tk1688 ? "CNY" : String(extra.quota_display_type ?? "").toUpperCase();
    const exchange = number(tk1688 ? extra.payment_fx_rate_cny_per_usd : extra.usd_exchange_rate);
    const customExchange = number(extra.custom_currency_exchange_rate);
    if (!display) unit = profileCurrency === "USD" || extraCurrency === "USD" ? "USD" : "credits";
    else if (display === "TOKENS") unit = "quota";
    else if (display === "USD") unit = "USD";
    else if (display === "CNY" && exchange && exchange > 0) { unit = "CNY"; factor = exchange; }
    else if (display === "CUSTOM" && customExchange && customExchange > 0 && typeof extra.custom_currency_symbol === "string") {
      unit = extra.custom_currency_symbol.trim().slice(0, 20) || "额度"; factor = customExchange;
    }
    if (unit !== "quota") {
      unitBasis = "site-conversion";
      unitNote = `按站点设置：每 ${divisor} 原始额度为 1 基础单位${factor !== 1 ? `，再乘站点汇率 ${factor}` : ""}；不使用外部汇率。`;
    } else if (display === "TOKENS") unitNote = "站点配置为原始额度显示，不换算为货币。";
  }
  const convert = (value: unknown) => {
    const amount = number(value);
    const converted = amount === undefined ? undefined : kind === "newapi" && unit !== "quota" && divisor && divisor > 0 ? amount / divisor * factor : amount;
    return converted !== undefined && Number.isFinite(converted) ? converted : undefined;
  };
  return {
    balance: convert(kind === "newapi" ? profile.quota : profile.balance),
    used: convert(kind === "newapi" ? profile.used_quota : extra.total_actual_cost),
    todayUsed: kind === "sub2api" ? number(extra.today_actual_cost) : convert(today.quota),
    requests: number(kind === "newapi" ? profile.request_count : extra.total_requests),
    unit,
    ...(kind === "sub2api" && profileCurrency && extraCurrency && profileCurrency !== extraCurrency
      ? { balanceUnit: profileCurrency, usedUnit: extraCurrency, todayUnit: extraCurrency } : {}),
    unitBasis, unitNote,
  };
}

function todayAvailability(result: PromiseSettledResult<unknown>, amount: number | undefined): Pick<SupplierBillingSnapshot, "todayStatus" | "todayError"> {
  if (amount !== undefined) return { todayStatus: "live" };
  if (result.status === "rejected") {
    const status = result.reason instanceof ProviderHttpError ? result.reason.details.status : undefined;
    if (status === 404 || status === 405 || status === 501) {
      return { todayStatus: "unsupported", todayError: "此站点暂不支持今日消耗查询" };
    }
    return { todayStatus: "failed", todayError: status === 401 || status === 403
      ? "今日消耗未读取，请检查站点登录或账号统计权限"
      : "今日消耗读取失败，请稍后重新读取" };
  }
  try { data(result.value); }
  catch { return { todayStatus: "failed", todayError: "供应商未返回有效的今日消耗，请稍后重新读取" }; }
  return { todayStatus: "missing", todayError: "供应商未返回今日消耗字段" };
}

export async function readSupplierBilling(input: { siteUrl: string; sourceId: string; kind: "newapi" | "sub2api" }, fetch: FetchImplementation): Promise<SupplierBillingSnapshot> {
  const base = supplierDirectoryBase(input.siteUrl);
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const todayWindow = input.kind === "newapi" ? { startAt: dayStart.toISOString(), endAt: now.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : undefined;
  const profilePath = input.kind === "newapi" ? "/api/user/self" : "/api/v1/user/profile";
  const extraPath = input.kind === "newapi" ? "/api/status" : "/api/v1/usage/dashboard/stats";
  // The self-stat endpoint aggregates all account keys/groups, without pagination.
  // https://doc.newapi.pro/api/fei-log/
  const todayQuery = new URLSearchParams({ type: "2", start_timestamp: String(Math.floor(dayStart.getTime() / 1000)), end_timestamp: String(Math.floor(now.getTime() / 1000)) });
  const read = (path: string) => fetchProviderJson<unknown>(fetch, base + path, { method: "GET", cache: "no-store", redirect: "error" },
    { phase: "connect", timeoutMs: 12000, maxResponseBytes: 1024 * 1024 });
  const [profile, extra, today] = await Promise.allSettled([read(profilePath), read(extraPath),
    input.kind === "newapi" ? read(`/api/log/self/stat?${todayQuery}`) : Promise.resolve(undefined)]);
  if (profile.status === "rejected") throw profile.reason;
  const amounts = parseSupplierBilling(input.kind, profile.value, extra.status === "fulfilled" ? extra.value : {}, today.status === "fulfilled" ? today.value : {},
    { siteUrl: input.siteUrl });
  if (amounts.balance === undefined && amounts.used === undefined) throw Error("供应商没有返回可识别的余额或消耗字段");
  const availability = todayAvailability(input.kind === "newapi" ? today : extra, amounts.todayUsed);
  const checkedAt = new Date().toISOString();
  let extraValid = extra.status === "fulfilled";
  if (extra.status === "fulfilled") { try { data(extra.value); } catch { extraValid = false; } }
  const incompleteTotals = !extraValid || amounts.balance === undefined || amounts.used === undefined || amounts.unit === "quota";
  const error = [incompleteTotals ? "部分账务字段未返回；未提供的金额显示为未读取" : undefined, availability.todayError].filter(Boolean).join("；");
  return { sourceId: input.sourceId, ...amounts, ...availability, ...(todayWindow ? { todayWindow } : {}), checkedAt, lastSuccessAt: checkedAt, sourceUrl: base + profilePath,
    usedSourceUrl: base + (input.kind === "newapi" ? profilePath : extraPath), todaySourceUrl: base + (input.kind === "newapi" ? "/api/log/self/stat" : extraPath),
    status: error ? "partial" : "live", ...(error ? { error } : {}) };
}

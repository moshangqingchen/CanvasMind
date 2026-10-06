import type { SupplierBillingSnapshot } from "@super-canvas/db";
import { isTk1688CatalogSource } from "@super-canvas/providers/tk1688-catalog";

/** Old money snapshots have no recorded FX. Preserve stored evidence and
 * request a fresh CNY read instead of relabelling or guessing their amounts. */
export function supplierBillingForDisplay(supplier: { siteUrl: string; apiUrl?: string }, billing?: SupplierBillingSnapshot) {
  if (!billing || !isTk1688CatalogSource(supplier.siteUrl, supplier.apiUrl) || billing.unit !== "USD") return billing;
  return { ...billing, balance: undefined, used: undefined, todayUsed: undefined, unit: "CNY",
    balanceUnit: "CNY", usedUnit: "CNY", todayUnit: "CNY", status: billing.status === "failed" ? "failed" as const : "partial" as const,
    todayStatus: billing.todayStatus === "failed" ? "failed" as const : "missing" as const,
    unitNote: "请重新读取人民币余额与消耗；上次金额未保存换算汇率。" };
}
export function billingAmount(value: number | undefined, unit = "credits") {
  if (value === undefined || !Number.isFinite(value)) return "未读取";
  return `${new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 10 }).format(value)} ${unit === "credits" ? "额度" : unit === "quota" ? "原始额度" : unit}`;
}
export function billingCompact(billing?: SupplierBillingSnapshot) {
  if (!billing || billing.balance === undefined) return "余额未读取";
  return `余额 ${billingAmount(billing.balance, billing.balanceUnit ?? billing.unit)}${billing.status === "failed" ? "（上次）" : ""}`;
}

export function billingTodayAmount(billing?: SupplierBillingSnapshot, now = new Date()) {
  if (billing?.todayUsed === undefined || !Number.isFinite(billing.todayUsed)) {
    return billing?.todayStatus === "unsupported" ? "暂不支持" : "未读取";
  }
  const readAt = billing.todayWindow?.endAt ?? billing.lastSuccessAt ?? billing.checkedAt;
  const stale = billing.status === "failed" || billing.todayStatus === "failed" ||
    (readAt !== undefined && new Date(readAt).toDateString() !== now.toDateString());
  return `${billingAmount(billing.todayUsed, billing.todayUnit ?? billing.unit)}${stale ? "（上次）" : ""}`;
}

export function billingSourceLabel(billing?: SupplierBillingSnapshot) {
  if (!billing) return undefined;
  try {
    const source = new URL(billing.sourceUrl);
    return ["http:", "https:"].includes(source.protocol) ? `来源：${source.host} 供应商后台` : undefined;
  } catch { return undefined; }
}

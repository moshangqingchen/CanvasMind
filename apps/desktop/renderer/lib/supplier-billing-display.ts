import type { SupplierBillingSnapshot } from "@super-canvas/db";
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

import type { SupplierBillingSnapshot } from "@super-canvas/db";
export function billingAmount(value: number | undefined, unit = "credits") {
  if (value === undefined || !Number.isFinite(value)) return "未读取";
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value)} ${unit === "credits" ? "额度" : unit === "quota" ? "原始额度" : unit}`;
}
export function billingCompact(billing?: SupplierBillingSnapshot) {
  if (!billing || billing.balance === undefined) return "余额未读取";
  return `余额 ${billingAmount(billing.balance, billing.unit)}${billing.status === "failed" ? "（上次）" : ""}`;
}

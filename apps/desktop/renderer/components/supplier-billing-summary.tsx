"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { refreshSupplierAccount, useSupplierBillingOverview } from "../lib/client-supplier-billing";
import { billingAmount, billingTodayAmount } from "../lib/supplier-billing-display";
import styles from "./supplier-billing-summary.module.css";

export function SupplierBillingSummary({ supplierId, compact = false, onRefreshed }: { supplierId?: string; compact?: boolean; onRefreshed?: () => void }) {
  const accounts = useSupplierBillingOverview();
  const account = accounts.find(item => item.id === supplierId);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!supplierId) return null;
  const billing = account?.billing;
  const stale = billing?.status === "failed";
  return <section className={`${styles.summary} ${compact ? styles.compact : ""}`} aria-label="供应商余额与消耗">
    <div className={styles.heading}><strong>{compact ? "账号余额与消耗" : "供应商账号账务"}</strong>
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { await refreshSupplierAccount(supplierId); onRefreshed?.(); }
        catch { setError("读取失败，请重试；原数据已保留"); }
        finally { setBusy(false); }
      }}><RefreshCw size={13} className={busy ? styles.spin : ""} />{busy ? "读取中…" : "重新读取消耗"}</button></div>
    <div className={styles.amounts}>
      <span>余额 <strong>{billingAmount(billing?.balance, billing?.unit)}</strong></span>
      <span>累计消耗 <strong>{billingAmount(billing?.used, billing?.unit)}</strong></span>
      <span title={billing?.todayError}>今日消耗 <strong>{billingTodayAmount(billing)}</strong></span>
    </div>
    <small>{billing?.lastSuccessAt ? `${stale ? "上次成功" : "数据更新"}：${new Date(billing.lastSuccessAt).toLocaleString("zh-CN")}` : "从供应商后台读取，尚未取得数据"}</small>
    {billing?.todayWindow ? <small>今日消耗按本机时区（{billing.todayWindow.timeZone}）从零点统计至读取时刻。</small>
      : billing?.todayUsed !== undefined ? <small>今日消耗按供应商后台统计口径显示。</small> : null}
    {(error || billing?.error) && <p role="status">{error || billing?.error}</p>}
    {!billing && account && !account.configured && <p>请先在连接配置中保存站点登录，再读取账号余额与消耗。</p>}
    {!compact && <small>账号累计值包含该账号在其他客户端的用量；本次生成报价另列，金额不自动换算。</small>}
  </section>;
}

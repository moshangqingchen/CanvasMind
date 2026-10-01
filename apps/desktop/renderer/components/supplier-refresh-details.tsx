"use client";

import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, CircleAlert, Clock3, Layers3, LoaderCircle, RefreshCw, X } from "lucide-react";
import type { SupplierRefreshResult } from "../lib/refresh-suppliers";
import { billingAmount, billingSourceLabel, billingTodayAmount } from "../lib/supplier-billing-display";
import { useDialogFocus } from "./use-dialog-focus";
import styles from "./supplier-refresh-details.module.css";

type RefreshStatus = "updated" | "partial" | "failed" | "empty" | "unconfigured" | "unconfirmed" | "idle";
const STATUS_LABELS: Record<RefreshStatus, string> = {
  updated: "已更新", partial: "部分待确认", failed: "刷新失败", empty: "已确认 · 无模型",
  unconfigured: "未配置 Key", unconfirmed: "待确认", idle: "尚未刷新",
};

export function SupplierRefreshIndicator({ status = "idle", running = false, label }: {
  status?: RefreshStatus; running?: boolean; label?: string;
}) {
  const Icon = running ? LoaderCircle : status === "updated" || status === "empty" ? CheckCircle2
    : status === "failed" ? CircleAlert : status === "partial" ? AlertTriangle : Clock3;
  return <span className={styles.indicator} data-status={running ? "running" : status}>
    <Icon size={14} aria-hidden="true" className={running ? styles.spin : undefined} />
    <span>{running ? "正在刷新" : label ?? STATUS_LABELS[status]}</span>
  </span>;
}

function checkedLabel(value?: string) {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString("zh-CN") : "尚未取得刷新记录";
}

export function SupplierRefreshDetails({ supplierName, result, running, canRefresh, onRefresh, onClose }: {
  supplierName: string;
  result?: SupplierRefreshResult;
  running: boolean;
  canRefresh: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const ref = useDialogFocus(true, onClose);
  if (typeof document === "undefined") return null;
  const connections = result?.connections ?? [];
  const groups = result?.groupChanges;
  const added = connections.reduce((count, item) => count + item.modelAddedIds.length, 0);
  const missing = connections.reduce((count, item) => count + item.modelRemovedModels.length, 0);
  const interfaces = connections.reduce((count, item) => count + item.interfaceChanges.length, 0);
  const prices = connections.reduce((count, item) => count + item.priceChanges.length, 0);
  const confirmed = connections.filter(item => item.status === "updated" || item.status === "empty").length;
  const issues = [
    ...(result?.directory && result.directory.status !== "updated" ? [{ name: "供应商目录", message: result.directory.message }] : []),
    ...connections.filter(item => !["updated", "empty"].includes(item.status)).map(item => ({ name: item.name, message: item.message })),
    ...connections.flatMap(item => item.modelIssues?.length ? [{
      name: `${item.name} · 接口`, message: `${item.modelIssues.length} 个模型接口待确认。${item.modelIssues[0]!.message}`,
    }] : []),
    ...connections.flatMap(item => {
      const failedPrices = item.priceIssues?.filter(model => model.failed) ?? [];
      return failedPrices.length ? [{ name: `${item.name} · 价格`, message: `${failedPrices.length} 个模型价格读取未完成。${failedPrices[0]!.message}` }] : [];
    }),
    ...(result?.keySync && result.keySync.status !== "live" ? [{ name: "账号密钥同步", message: result.keySync.message }] : []),
    ...(result?.billing && ["failed", "partial"].includes(result.billing.status) ? [{ name: "余额与累计消耗", message: result.billing.error ?? result.billing.unitNote ?? "部分数据尚未读取，已有数值保留。" }] : []),
    ...(result?.billing?.todayStatus === "failed" ? [{ name: "今日消耗", message: result.billing.todayError ?? "读取未完成，保留上次数据。" }] : []),
  ];
  const groupChangeCount = (groups?.added.length ?? 0) + (groups?.missing.length ?? 0) + (groups?.renamed.length ?? 0);
  const changesAvailable = Boolean(result && !result.snapshotOnly);
  const billingSource = billingSourceLabel(result?.billing);
  return createPortal(<div className={styles.backdrop} onPointerDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="supplier-refresh-title"
      aria-describedby="supplier-refresh-description" tabIndex={-1} className={styles.modal}>
      <header className={styles.header}>
        <div><p>供应商状态</p><h2 id="supplier-refresh-title">供应商刷新详情</h2></div>
        <button className={styles.close} type="button" aria-label="关闭刷新详情" onClick={onClose}><X size={19} /></button>
      </header>
      <div className={styles.body}>
        <section className={styles.hero} aria-label="刷新概况">
          <div className={styles.heroHeading}><h3>{supplierName}</h3><SupplierRefreshIndicator status={result?.status} running={running} /></div>
          <p id="supplier-refresh-description">{running ? "正在读取此供应商的目录与已保存连接，完成后结果会更新在这里。" : result?.message ?? "尚未保存刷新记录。配置供应商后，可单独刷新并查看具体变化。"}</p>
          <small>{result?.checkedAt ? `最近读取：${checkedLabel(result.checkedAt)}` : "尚未取得刷新记录"}</small>
          {result?.snapshotOnly && <p className={styles.note}>仅展示已保存状态；刷新后可查看本次变化。</p>}
          <div className={styles.metrics}>
            <div><span>连接已确认</span><strong>{confirmed}<small> / {connections.length}</small></strong></div>
            <div><span>分组变化</span><strong>{changesAvailable ? groupChangeCount : "—"}</strong></div>
            <div><span>模型新增 / 未再返回</span><strong>{changesAvailable ? <>{added}<small> / {missing}</small></> : "—"}</strong></div>
            <div><span>接口 / 价格变化</span><strong>{changesAvailable ? <>{interfaces}<small> / {prices}</small></> : "—"}</strong></div>
          </div>
        </section>
        {issues.length > 0 && <section className={styles.issues} aria-label="待处理事项">
          <h3><CircleAlert size={17} />需要检查（{issues.length}）</h3>
          <ul>{issues.map((issue, index) => <li key={`${issue.name}:${index}`}><strong>{issue.name}</strong><p>{issue.message}</p></li>)}</ul>
        </section>}
        {result?.directory && <section className={styles.section} aria-label="目录读取结果">
          <div className={styles.sectionHeading}><h3><Layers3 size={17} />供应商目录</h3><SupplierRefreshIndicator status={result.directory.status} /></div>
          <p>{result.directory.message}</p>
          {result.directory.checkedAt && <small>读取时间：{checkedLabel(result.directory.checkedAt)}</small>}
        </section>}
        {result?.keySync && <section className={styles.section} aria-label="密钥同步详情">
          <div className={styles.sectionHeading}><h3>账号密钥同步</h3><SupplierRefreshIndicator status={result.keySync.status === "live" ? "updated" : result.keySync.status} /></div>
          <p>{result.keySync.message}</p>
          <div className={styles.inlineCounts}><span>自动填入 <strong>{result.keySync.imported}</strong></span><span>保留已有 <strong>{result.keySync.preserved}</strong></span><span>跳过 <strong>{result.keySync.skipped}</strong></span></div>
        </section>}
        {result?.billing && <section className={styles.section} aria-label="账务读取结果">
          <div className={styles.sectionHeading}><h3>余额与消耗</h3><SupplierRefreshIndicator status={result.billing.status === "live" ? "updated" : ["partial", "failed"].includes(result.billing.status) ? result.billing.status as "partial" | "failed" : "unconfirmed"} /></div>
          <div className={styles.inlineCounts}><span>余额 <strong>{billingAmount(result.billing.balance, result.billing.balanceUnit ?? result.billing.unit)}{result.billing.status === "failed" && result.billing.balance !== undefined ? "（上次）" : ""}</strong></span><span>累计消耗 <strong>{billingAmount(result.billing.used, result.billing.usedUnit ?? result.billing.unit)}{result.billing.status === "failed" && result.billing.used !== undefined ? "（上次）" : ""}</strong></span><span>今日消耗 <strong>{billingTodayAmount(result.billing)}</strong></span></div>
          {result.billing.unitNote && <p>{result.billing.unitNote}</p>}
          {result.billing.lastSuccessAt && <small>{result.billing.status === "failed" ? "上次成功" : "数据更新"}：{checkedLabel(result.billing.lastSuccessAt)}</small>}
          {billingSource && <p className={styles.note}>{billingSource}</p>}
          {result.billing.error && <p>{result.billing.error}</p>}
          {result.billing.todayError && <p>今日消耗：{result.billing.todayError}</p>}
        </section>}
        {groups && !result?.snapshotOnly && <section className={styles.section} aria-label="分组变化详情">
          <div className={styles.sectionHeading}><h3>分组变化</h3><small>{groupChangeCount ? `${groupChangeCount} 项变化` : "未发现变化"}</small></div>
          {groupChangeCount > 0 ? <div className={styles.groupChanges}>
            <div><h4>新增分组（{groups.added.length}）</h4>{groups.added.length ? <ul>{groups.added.map(item => <li key={item.id}><strong>{item.label}</strong><code>{item.id}</code></li>)}</ul> : <p>无新增</p>}</div>
            <div><h4>未再返回（{groups.missing.length}）</h4>{groups.missing.length ? <ul>{groups.missing.map(item => <li key={item.id}><strong>{item.label}</strong><code>{item.id}</code></li>)}</ul> : <p>无缺失</p>}</div>
            <div><h4>名称变化（{groups.renamed.length}）</h4>{groups.renamed.length ? <ul>{groups.renamed.map(item => <li key={item.id}><strong>{item.before} → {item.after}</strong><code>{item.id}</code></li>)}</ul> : <p>无更名</p>}</div>
          </div> : <p>未发现公开分组变化。</p>}
          <p className={styles.note}>未再返回的分组保留在历史中；手动分组和自定义模型保持已有配置。</p>
        </section>}
        <section className={styles.section} aria-label="连接与模型详情">
          <div className={styles.sectionHeading}><h3>连接与模型</h3><small>{connections.length} 个连接</small></div>
          {connections.length ? <div className={styles.connections}>{connections.map(item => <article key={item.id} className={styles.connection}>
            <div className={styles.connectionHeading}><div><h4>{item.name}</h4><small>{item.group ?? item.groupId ?? "未指定分组"} · 已保存 {item.modelCount} 个模型</small></div><SupplierRefreshIndicator status={item.status} /></div>
            <p>{item.message}</p>
            {(item.checkedAt || item.lastSuccessAt) && <small>{item.checkedAt ? `最近尝试：${checkedLabel(item.checkedAt)}` : ""}{item.lastSuccessAt ? ` · 上次成功：${checkedLabel(item.lastSuccessAt)}` : ""}</small>}
            {!!item.modelIssues?.length && <details className={styles.modelIssues}>
              <summary><SupplierRefreshIndicator status="unconfirmed" label={`接口待确认的模型（${item.modelIssues.length}）`} /></summary>
              <ul>{item.modelIssues.map(model => <li key={model.id}><strong>{model.name}</strong><code>{model.id}</code><p>{model.message}</p></li>)}</ul>
            </details>}
            {!!item.priceIssues?.length && <details className={styles.modelIssues}>
              <summary><SupplierRefreshIndicator status={item.priceIssues.some(model => model.failed) ? "partial" : "unconfirmed"}
                label={`价格待确认的模型（${item.priceIssues.length}）`} /></summary>
              <ul>{item.priceIssues.map(model => <li key={model.id}><strong>{model.name}</strong><code>{model.id}</code><p>{model.message}</p></li>)}</ul>
            </details>}
            {item.modelAddedIds.length + item.modelRemovedModels.length + item.interfaceChanges.length + item.priceChanges.length > 0 && <div className={styles.modelChanges}>
              {item.modelAddedIds.length > 0 && <details open><summary>新增模型（{item.modelAddedIds.length}）</summary><ul>{item.modelAddedIds.map(id => <li key={id}><code>{id}</code></li>)}</ul></details>}
              {item.modelRemovedModels.length > 0 && <details open><summary>未再返回的模型（{item.modelRemovedModels.length}）</summary><ul>{item.modelRemovedModels.map(model => <li key={model.id}><strong>{model.name}</strong><code>{model.id}</code></li>)}</ul></details>}
              {item.interfaceChanges.length > 0 && <details open><summary>接口变化（{item.interfaceChanges.length}）</summary><ul>{item.interfaceChanges.map(model => <li key={model.id}><strong>{model.name}</strong><code>{model.id}</code><span>{model.before} → {model.after}</span></li>)}</ul></details>}
              {item.priceChanges.length > 0 && <details open><summary>价格变化（{item.priceChanges.length}）</summary><ul>{item.priceChanges.map(model => <li key={model.id}><strong>{model.name}</strong><code>{model.id}</code><span>{model.before} → {model.after}</span></li>)}</ul></details>}
            </div>}
          </article>)}</div> : <p>尚未保存连接。可在供应商配置中添加分组与 Key，再读取实际可用模型。</p>}
        </section>
      </div>
      <footer className={styles.footer}><p>刷新只读取资料；未完成的项目保留上次配置。</p><div>
        <button type="button" disabled={!canRefresh || running} onClick={onRefresh} className={styles.refresh}><RefreshCw size={15} className={running ? styles.spin : undefined} />{running ? "正在刷新…" : "重新刷新此供应商"}</button>
        <button type="button" onClick={onClose}>完成</button>
      </div></footer>
    </section>
  </div>, document.body);
}

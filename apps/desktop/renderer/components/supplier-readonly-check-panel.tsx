"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, SearchCheck, X } from "lucide-react";
import type { CatalogAuthKind, CatalogEvidenceRole, CatalogReadReason } from "../lib/catalog-read-contracts";
import type { SupplierReadOnlyCatalogChange, SupplierReadOnlyCheckReport, SupplierReadOnlySource } from "../lib/supplier-readonly-check-contracts";

const STATUS_LABELS = { complete: "已完成可读取接口的检测", partial: "已取得部分检测结果", failed: "本次检测未完成" };
const ROLE_LABELS: Record<CatalogEvidenceRole, string> = { "key-membership": "Key 可用型号", "catalog-offer": "官网目录", price: "报价", schema: "接口参数", health: "连接状态" };
const AUTH_LABELS: Record<CatalogAuthKind, string> = { anonymous: "公开资料", "site-account": "当前站点账号", "connection-key": "当前连接 Key" };
const REASON_LABELS: Record<CatalogReadReason, string> = { network: "网络读取失败", upstream: "上游返回错误", authentication: "认证未通过", balance: "账号额度限制", unsupported: "当前入口未提供支持", incomplete: "返回资料不完整", "invalid-response": "响应无法解析", budget: "达到本次读取上限", "credentials-unavailable": "缺少可用凭据", cancelled: "已取消" };
const CHANGE_LABELS: Record<SupplierReadOnlyCatalogChange["kind"], string> = { "group-discovered": "首次发现分组", "group-added": "新增分组", "group-renamed": "分组更名", "model-discovered": "首次发现型号", "model-added": "新增型号", "model-name": "型号名称变化", price: "价格变化", parameters: "参数变化" };

function SourceLink({ url }: { url: string }) {
  return /^https?:\/\//u.test(url) ? <a href={url} target="_blank" rel="noreferrer">查看来源</a> : null;
}

function Sources({ sources }: { sources: readonly SupplierReadOnlySource[] }) {
  return <ul className="sm-readonly-sources">{sources.map((source, index) => <li key={`${source.entryId}:${index}`}>
    <div><strong>{ROLE_LABELS[source.role]}</strong><span>{AUTH_LABELS[source.identity]} · {source.status === "succeeded" ? source.complete ? "读取完成" : "部分读取" : source.status === "deferred" ? "尚未读取" : "读取失败"}</span></div>
    <div>{source.reason && <span>{REASON_LABELS[source.reason]}</span>}<time dateTime={source.checkedAt}>{new Date(source.checkedAt).toLocaleString("zh-CN")}</time><SourceLink url={source.sourceUrl} /></div>
  </li>)}</ul>;
}

function ModelChanges({ label, models }: { label: string; models: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(100);
  return models.length > 0 && <details className="sm-readonly-models" onToggle={event => setOpen(event.currentTarget.open)}><summary>{label}（{models.length}）</summary>
    {open && <><ul>{models.slice(0, limit).map(model => <li key={model}><code>{model}</code></li>)}</ul>{models.length > limit && <button type="button" className="sm-button" onClick={() => setLimit(value => value + 100)}>再显示 100 个型号</button>}</>}
  </details>;
}

/** Results stay in this view only. No refresh, cache invalidation or save follows a check. */
export function SupplierReadOnlyCheckPanel({ supplierId, supplierName }: { supplierId: string; supplierName: string }) {
  const [report, setReport] = useState<SupplierReadOnlyCheckReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [changeLimit, setChangeLimit] = useState(50);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  async function check() {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true); setError(""); setCancelled(false); setExpanded(true);
    try {
      const response = await fetch(`/api/suppliers/${encodeURIComponent(supplierId)}/check`, {
        method: "POST", cache: "no-store", signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `检测未完成（HTTP ${response.status}）`);
      if (!payload || payload.readOnly !== true || payload.supplierId !== supplierId || !Array.isArray(payload.connections) ||
        !Array.isArray(payload.sources) || !Array.isArray(payload.catalogChanges) || !Array.isArray(payload.limitations)) throw new Error("检测结果与当前账号不匹配，请重试。");
      if (!controller.signal.aborted) { setReport(payload as SupplierReadOnlyCheckReport); setChangeLimit(50); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "检测未完成，请重试。");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setBusy(false); }
    }
  }

  return <section className="sm-readonly-check" aria-label="供应商更新只读检测">
    <div className="sm-readonly-heading"><div><h3>检查供应商更新</h3><p>检测“{supplierName}”已保存账号与连接的目录、报价和参数变化，结果仅在此展示。</p></div>
      <button type="button" className="sm-button" disabled={busy} onClick={() => void check()}>
        {busy ? <LoaderCircle size={15} className="sm-spin" /> : <SearchCheck size={15} />}{busy ? "正在只读检测…" : "只读检测当前账号"}
      </button>
      {busy && <button type="button" className="sm-button sm-quiet" onClick={() => { requestRef.current?.abort(); setCancelled(true); }}><X size={14} />取消检测</button>}
    </div>
    <p className="sm-muted">按已保存配置读取，不保存检测结果、不更新连接、不生成图片或视频。需应用到程序时使用刷新。</p>
    {busy && <p role="status">正在读取当前账号的资料与各连接目录；可继续浏览，切换账号会取消本次检测。</p>}
    {cancelled && <p role="status">本次检测已取消。{report ? "下方保留上次结果与原采样时间。" : ""}</p>}
    {error && <p className="sm-notice is-error" role="alert">{error}{report ? " 下方保留上次结果与原采样时间。" : ""}</p>}
    {report && <div className="sm-readonly-report">
      <div className="sm-readonly-result"><strong role="status">{STATUS_LABELS[report.status]}</strong><time dateTime={report.checkedAt}>{new Date(report.checkedAt).toLocaleString("zh-CN")}</time>
        <button type="button" className="sm-button sm-quiet" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "收起检测结果" : "展开检测结果"}</button>
      </div>
      {expanded && <>
      <ul className="sm-readonly-limitations">{report.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
      <details open><summary>账号与分组对照（{report.connections.length} 个连接）</summary>
        {!report.connections.length && <p className="sm-muted">当前账号没有可对照的已保存连接；官网来源读取情况见下方。</p>}
        {report.connections.map(connection => <article className="sm-readonly-connection" key={connection.connectionId}>
          <h4>{connection.name}</h4><p>分组：<code>{connection.groupIdentity || "—"}</code> · 本次读取 {connection.currentModelCount} 个型号{connection.membershipComplete ? "" : "（目录读取不完整）"}</p>
          <p className="sm-muted">{connection.hasBaseline ? connection.baselineCheckedAt ? `与 ${new Date(connection.baselineCheckedAt).toLocaleString("zh-CN")} 的已保存记录对照` : "与已保存的型号记录对照；原采样时间未记录" : "没有旧基线：本次首次发现，无法确认何时新增。"}</p>
          <ModelChanges label="新增型号" models={connection.addedModelIds} />
          <ModelChanges label="本次首次发现，无法确认何时新增" models={connection.firstDiscoveredModelIds} />
          <ModelChanges label="本次未返回，不代表永久删除" models={connection.missingModelIds} />
          {!connection.addedModelIds.length && !connection.firstDiscoveredModelIds.length && !connection.missingModelIds.length && <p className="sm-muted">未发现可确认的型号清单变化。</p>}
          <details><summary>此连接的读取来源（{connection.sources.length}）</summary><Sources sources={connection.sources} /></details>
        </article>)}
      </details>
      <details open={report.catalogChanges.length > 0}><summary>官网分组、报价与参数变化（{report.catalogChanges.length} 项）</summary>
        {!report.catalogChanges.length ? <p className="sm-muted">本次读取范围内没有可确认的目录字段变化。</p> : <ul className="sm-readonly-changes">{report.catalogChanges.slice(0, changeLimit).map((change, index) => <li key={index}>
          <div><strong>{CHANGE_LABELS[change.kind]}</strong><span>{change.groupName} · {change.groupIdentity}</span>{change.modelId && <code>{change.modelId}</code>}</div>
          <div className="sm-readonly-diff"><span>{change.before ?? "—"}</span><span aria-label="变为">→</span><span>{change.after}</span></div>
          <div><time dateTime={change.checkedAt}>{new Date(change.checkedAt).toLocaleString("zh-CN")}</time><SourceLink url={change.sourceUrl} /></div>
        </li>)}</ul>}
        {report.catalogChanges.length > changeLimit && <button type="button" className="sm-button" onClick={() => setChangeLimit(value => value + 50)}>再显示 50 项变化</button>}
      </details>
      <details><summary>全部读取来源与覆盖情况（{report.sources.length}）</summary><Sources sources={report.sources} /></details>
      </>}
    </div>}
  </section>;
}

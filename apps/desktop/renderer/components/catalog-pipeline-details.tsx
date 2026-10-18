"use client";

import { useState } from "react";
import type { CatalogConnectionStatus, CatalogMembershipCandidateSummary, CatalogPipelineDiagnostics, CatalogSourceDiagnostic } from "../lib/supplier-catalog-contracts";
import styles from "./catalog-check.module.css";
import { InformationChips, InformationGrid } from "./information-layout";

const ROLES: Record<CatalogSourceDiagnostic["role"], string> = { "key-membership": "Key 成员清单", "catalog-offer": "供应目录", price: "公布价格", schema: "参数与调用资料", health: "来源状态" };
const STATES: Record<CatalogSourceDiagnostic["status"], string> = { succeeded: "完整读取", partial: "部分读取", failed: "读取失败", deferred: "等待补查", unread: "尚未读取", running: "正在读取", unknown: "结果未定" };
const REASONS: Record<string, string> = { network: "网络", authentication: "鉴权", balance: "余额", unsupported: "不支持此读取入口", incomplete: "资料未完整读取", "invalid-response": "响应格式不完整", budget: "本轮读取预算已用完", "credentials-unavailable": "凭据暂不可读", cancelled: "已取消", "mode-off": "自动检查已关闭", draining: "应用正在退出", "identity-changed": "来源配置已变化", "host-cooldown": "等待主机冷却", "lease-expired": "中断后结果未定", upstream: "上游错误", "attempt-consumed": "本周期已尝试" };

function DiagnosticSource({ source, connectionNames }: { source: CatalogSourceDiagnostic; connectionNames: Map<string, string> }) {
  return <li className={styles.source}>
    <div className={styles.sourceHeading}><strong>{ROLES[source.role]}</strong><InformationChips values={[STATES[source.status], ...(source.paused ? ["已暂停"] : [])]} /></div>
    <InformationGrid items={[
      { label: "连接", value: <InformationChips values={source.connectionIds.map(id => connectionNames.get(id) ?? id)} /> },
      ...(source.groupIdentity ? [{ label: "分组", value: source.groupIdentity }] : []),
      { label: "资料身份", value: source.identity === "connection-key" ? "当前 Key" : source.identity === "site-account" ? "站点账号资料" : "公开资料" },
      { label: "用途", value: source.requiredForMembership ? "成员资格必需来源" : "补充资料" },
      ...(source.modelCount !== undefined ? [{ label: "型号数", value: source.modelCount }] : []),
      ...(source.checkedAt ? [{ label: "采样时间", value: <time dateTime={source.checkedAt}>{source.checkedAt}</time> }] : []),
      ...(source.nextCheckAt ? [{ label: "下次资格", value: <time dateTime={source.nextCheckAt}>{source.nextCheckAt}</time> }] : []),
    ]} />
    {source.reason && <p>{REASONS[source.reason] ?? "资料需下周期复查"}{source.status === "failed" || source.status === "unknown" ? "；保留已接受的目录与证据。" : ""}</p>}
    {source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">查看资料来源</a>}
  </li>;
}

export function CatalogPipelineDetails({ pipeline, connections, selectedConnectionIds, all, onConfirm, onRead }: {
  pipeline: CatalogPipelineDiagnostics;
  connections: readonly CatalogConnectionStatus[];
  selectedConnectionIds: readonly string[];
  all: boolean;
  onConfirm(candidate: CatalogMembershipCandidateSummary): Promise<void>;
  onRead(): Promise<void>;
}) {
  const [limit, setLimit] = useState(24), [historyLimit, setHistoryLimit] = useState(20);
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  const names = new Map(connections.map(row => [row.connectionId, row.name]));
  const visible = (id: string) => all || selectedConnectionIds.includes(id);
  const sources = pipeline.diagnostics.filter(row => row.connectionIds.some(visible));
  const candidates = pipeline.candidates.filter(row => visible(row.connectionId));
  const history = pipeline.historyDescriptors.filter(row => visible(row.connectionId));
  const contracts = pipeline.contracts?.filter(row => visible(row.connectionId)) ?? [];
  const confirm = async (candidate: CatalogMembershipCandidateSummary) => {
    setBusy(candidate.candidateVersion); setError("");
    try { await onConfirm(candidate); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "候选目录未确认，请重试。"); }
    finally { setBusy(""); }
  };
  return <>
    <section aria-label="待确认的目录骤降"><h4>待确认的目录变化 <small>CANDIDATES</small></h4>
      {!candidates.length ? <p className={styles.caption}>没有待确认的骤降目录。硬截断和读取不完整不能手动确认。</p> : candidates.map(candidate => <article className={styles.candidate} key={`${candidate.connectionId}:${candidate.sourceKey}`}>
        <strong>{names.get(candidate.connectionId) ?? candidate.connectionId}</strong>
        <InformationGrid items={[
          { label: "已接受型号", value: candidate.baselineCount }, { label: "本次型号", value: candidate.candidateCount },
          { label: "未再返回", value: candidate.missingCount }, { label: "独立日周期", value: `${candidate.countedCycles} / ${candidate.requiredCycles}` },
          { label: "周期间隔", value: "每次至少相隔 24 小时" },
          { label: "候选版本", value: <code title={candidate.candidateVersion}>{candidate.candidateVersion.slice(0, 12)}</code> },
          { label: "采样时间", value: <time dateTime={candidate.checkedAt}>{candidate.checkedAt}</time> },
        ]} />
        <p>保留已接受的目录，直到三个有效周期一致，或你确认这份候选。此操作只确认目录，不重新读取供应商。</p>
        <button type="button" className="sm-button" disabled={Boolean(busy)} onClick={() => void confirm(candidate)} aria-label={`确认 ${names.get(candidate.connectionId) ?? candidate.connectionId} 的候选目录 ${candidate.candidateVersion.slice(0, 12)}`}>{busy === candidate.candidateVersion ? "正在确认…" : "确认这份候选目录"}</button>
      </article>)}
      {error && <p role="status" className={styles.error}>{error} <button type="button" className="sm-button" onClick={() => void onRead()}>重新读取候选目录</button></p>}
    </section>
    <section aria-label="分来源读取诊断"><h4>来源读取诊断 <small>SOURCES</small></h4>
      <p className={styles.caption}>成员清单、供应目录、价格和调用资料分别记录。查看不会刷新或扫描。</p>
      {!sources.length ? <p className={styles.caption}>尚无新流水线的来源记录；已有目录仍保留。</p> : <ul className={styles.sources}>{sources.slice(0, limit).map(row => <DiagnosticSource key={row.sourceKey} source={row} connectionNames={names} />)}</ul>}
      {sources.length > limit && <button type="button" className="sm-button" onClick={() => setLimit(value => value + 24)}>再显示 24 个来源</button>}
    </section>
    {!!contracts.length && <section aria-label="调用契约诊断"><h4>参数与调用契约 <small>CONTRACTS</small></h4>
      <p className={styles.caption}>有目录记录不代表当前 Key 有权限，参数与调用契约也需独立完整。历史契约不作为新接口的兜底。</p>
      <ul className={styles.sources}>{contracts.slice(0, limit).map(row => <li className={styles.source} key={`${row.connectionId}:${row.modelId}:${row.operation}`}>
        <div className={styles.sourceHeading}><code>{row.modelId}</code><strong>{row.status === "pending" ? "待完整读取" : row.status === "protected" ? "保留人工或实测配置" : "契约已接受"}</strong></div>
        <InformationGrid items={[{ label: "连接", value: names.get(row.connectionId) ?? row.connectionId }, { label: "操作", value: row.operation }]} />
        {row.reason && <p>{row.reason === "removed" ? "已确认不再提供此调用契约" : row.reason === "conflicting-source" ? "来源存在冲突，未覆盖已保存的配置" : "接口或参数发生变化，尚未取得完整契约"}</p>}
        <p>采样时间 <time dateTime={row.checkedAt}>{row.checkedAt}</time></p>
        {row.sourceUrl && <a href={row.sourceUrl} target="_blank" rel="noreferrer">查看提交接口</a>}
      </li>)}</ul>
      {contracts.length > limit && <button type="button" className="sm-button" onClick={() => setLimit(value => value + 24)}>再显示 24 条契约</button>}
    </section>}
    <section aria-label="不再可见的历史型号"><h4>历史型号与参数 <small>HISTORY</small></h4>
      <p className={styles.caption}>“该连接不再可见”只描述当前 Key；历史参数供查阅，已保存的画布和选择不会被改写。</p>
      {!history.length ? <p className={styles.caption}>没有已记录的不再可见型号。</p> : history.slice(0, historyLimit).map(row => <details className={styles.record} key={`${row.connectionId}:${row.modelId}:${row.unavailableAt}`}>
        <summary><code>{row.modelId}</code><span>该连接不再可见</span><span>{names.get(row.connectionId) ?? row.connectionId}</span></summary>
        <p className={styles.caption}>记录时间 <time dateTime={row.unavailableAt}>{row.unavailableAt}</time></p>
        <div className={styles.descriptor}><strong>{row.descriptor.name}</strong>{row.descriptor.description && <p>{row.descriptor.description}</p>}
          <InformationGrid items={[{ label: "操作", value: row.descriptor.operations.length ? <InformationChips values={row.descriptor.operations} /> : "—" }]} />
          <details><summary>查看完整历史参数与契约记录</summary><pre>{JSON.stringify(row.descriptor, null, 2)}</pre></details>
        </div>
      </details>)}
      {history.length > historyLimit && <button type="button" className="sm-button" onClick={() => setHistoryLimit(value => value + 20)}>再显示 20 个历史型号</button>}
    </section>
  </>;
}

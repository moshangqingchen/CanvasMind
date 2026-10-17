"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CATALOG_POLICY_EVENT, catalogFailureLabel, readCatalogCheckStatus, saveCatalogCheckMode } from "../lib/client-catalog-check";
import type { CatalogChange, CatalogChangeRecord, CatalogCheckMode, CatalogUpgradeStatus } from "../lib/supplier-catalog-contracts";
import styles from "./catalog-check.module.css";

const CHANGE_LABELS: Record<CatalogChange["kind"], string> = { price: "价格变动", "model-added": "新增型号", "model-removed": "下架型号", "model-changed": "型号规格变动", "group-added": "新增分组", "group-removed": "移除分组", "group-changed": "分组变动" };
function ChangeRecord({ record, initiallyOpen = false }: { record: CatalogChangeRecord; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [limit, setLimit] = useState(50);
  return <details className={styles.record} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><time dateTime={record.checkedAt}>{new Date(record.checkedAt).toLocaleString("zh-CN")}</time><strong>{record.supplierName ?? record.connectionName}</strong><span>{record.connectionName} · {record.changes.length} 项变更</span></summary>
    {open && <><ul className={styles.changes}>{record.changes.slice(0, limit).map((change, index) => <li key={index}>
      <span>{CHANGE_LABELS[change.kind]}</span>
      {change.modelId && <code>{change.modelId}</code>}{change.groupId && <small>分组：{change.groupId}</small>}
      {(change.before !== undefined || change.after !== undefined) && <div className={styles.price}><span>{change.before ?? "—"}</span><span aria-label="变为">→</span><span>{change.after ?? "—"}</span></div>}
    </li>)}</ul>{record.changes.length > limit && <button className="sm-button" type="button" onClick={() => setLimit(value => value + 50)}>再显示 50 项</button>}</>}
  </details>;
}

export function CatalogCheckSettings({ review = false, ready, selectedSupplierId, selectedConnectionIds, onSelectConnection, refreshVersion }: {
  ready: boolean;
  review?: boolean; selectedSupplierId?: string; selectedConnectionIds: readonly string[];
  onSelectConnection: (id: string) => void; refreshVersion: string;
}) {
  const [status, setStatus] = useState<CatalogUpgradeStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(review);
  const [expanded, setExpanded] = useState(review);
  const [historyLimit, setHistoryLimit] = useState(20);
  const reviewed = useRef(false);
  const readSequence = useRef(0);
  const selectRef = useRef(onSelectConnection);
  useEffect(() => { selectRef.current = onSelectConnection; }, [onSelectConnection]);
  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++readSequence.current;
    try {
      const next = await readCatalogCheckStatus(signal);
      if (!signal?.aborted && sequence === readSequence.current) { setStatus(next); setError(""); }
    } catch { if (!signal?.aborted && sequence === readSequence.current) setError("自动检查设置暂时无法读取"); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { void load(controller.signal); }, 0);
    const updated = () => { void load(controller.signal); };
    window.addEventListener("supplier-catalog-upgraded", updated);
    window.addEventListener(CATALOG_POLICY_EVENT, updated);
    return () => {
      clearTimeout(timer); controller.abort(); window.removeEventListener("supplier-catalog-upgraded", updated);
      window.removeEventListener(CATALOG_POLICY_EVENT, updated);
    };
  }, [load, refreshVersion]);
  useEffect(() => {
    if (!review || !ready || !status || reviewed.current) return;
    reviewed.current = true;
    const first = status.manualConnectionIds[0] ?? status.changedConnectionIds[0];
    if (first) selectRef.current(first);
  }, [review, ready, status]);
  const save = async (mode: CatalogCheckMode) => {
    readSequence.current++;
    setBusy(true); setError("");
    try {
      const next = await saveCatalogCheckMode(mode);
      readSequence.current++;
      setStatus(next); window.dispatchEvent(new CustomEvent(CATALOG_POLICY_EVENT));
    } catch { setError("自动检查设置未保存，请重试"); }
    finally { setBusy(false); }
  };
  const manual = status?.connections.filter(connection => connection.manualRequired) ?? [];
  const attention = status?.mode === "off" ? status.connections : manual;
  const history = status?.history.filter(record => all || record.supplierId === selectedSupplierId && Boolean(selectedSupplierId) || selectedConnectionIds.includes(record.connectionId)) ?? [];
  return <section className={styles.settings} aria-label="供应商目录自动检查设置">
    <div className={styles.heading}><div><strong>自动检查供应商目录与价格</strong><p>完整读取后才更新；失败时保留已有目录和价格。</p></div>
      <select aria-label="自动检查供应商目录与价格" value={status?.mode ?? "daily"} disabled={!status || busy} onChange={event => void save(event.target.value as CatalogCheckMode)}>
        <option value="off">关闭</option><option value="upgrade">仅软件升级后</option><option value="daily">每天一次（默认）</option>
      </select>
    </div>
    {status?.mode === "off" && <p className={styles.caption}>自动检查已关闭；已有连接可手动刷新。</p>}
    {status?.mode === "upgrade" && <p className={styles.caption}>目录版本变化后每个连接尝试一次，失败后可手动刷新。</p>}
    {status?.mode === "daily" && <p className={styles.caption}>每 24 小时最多尝试一次；连续 3 次鉴权、余额或不支持失败后暂停。</p>}
    {error && <p role="status" className={styles.error}>{error} <button className="sm-button" type="button" onClick={() => void load()}>重试读取设置</button></p>}
    <button type="button" className={styles.disclosure} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>目录变更与待处理连接{manual.length ? "（" + manual.length + "）" : ""}</button>
    {expanded && <div className={styles.review}>
      <section aria-label="待手动刷新连接"><h4>待手动刷新</h4>
        {!attention.length ? <p className={styles.caption}>没有待手动刷新的连接。</p> : <ul className={styles.manual}>{attention.map(connection => <li key={connection.connectionId}>
          <div><strong>{connection.supplierName ? connection.supplierName + " · " : ""}{connection.name}</strong><span>{connection.manualRequired ? "待手动刷新" : "可手动刷新"}{connection.pauseReason ? " · " + catalogFailureLabel(connection.pauseReason) : ""}{connection.paused ? " · 自动检查已暂停" : ""}</span></div>
          <button className="sm-button" type="button" onClick={() => { setExpanded(false); onSelectConnection(connection.connectionId); }}>查看供应商</button>
        </li>)}</ul>}
      </section>
      <section aria-label="供应商目录变更记录"><div className={styles.historyHeading}><h4>目录变更记录 <small>最近 30 天</small></h4><button className="sm-button" type="button" aria-pressed={all} onClick={() => setAll(value => !value)}>{all ? "仅看当前供应商" : "查看全部供应商"}</button></div>
        {!history.length ? <p className={styles.caption}>没有已记录的目录或价格变动；仅采样时间变化不会产生记录。</p> : history.slice(0, historyLimit).map((record, index) => <ChangeRecord key={record.id} record={record} initiallyOpen={review && index === 0} />)}
        {history.length > historyLimit && <button className="sm-button" type="button" onClick={() => setHistoryLimit(value => value + 20)}>再显示 20 条记录</button>}
      </section>
    </div>}
  </section>;
}

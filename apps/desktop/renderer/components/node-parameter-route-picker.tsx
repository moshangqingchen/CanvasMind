"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, ExternalLink } from "lucide-react";
import type { SupplierBillingSnapshot } from "@super-canvas/db";
import { billingCompact } from "../lib/supplier-billing-display";
import { nodeParameterRoutePath, nodeParameterRouteRows, type NodeParameterRoute } from "../lib/node-parameter-routes";
import { ModelPriceTable } from "./model-price-table";
import { useAnchoredSurface } from "./ui/useAnchoredSurface";
import styles from "./node-parameter-route-picker.module.css";

type BillingAccount = { id: string; billing?: SupplierBillingSnapshot };
type RouteRow = ReturnType<typeof nodeParameterRouteRows>[number];

function RouteChoice({ row, balance, onChoose }: { row: RouteRow; balance: string; onChoose: (id: string) => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const connection = row.connection;
  const reasonId = useId();
  const switchId = useId();
  const quoteId = useId();
  return <li className={styles.row} data-route-id={connection.id} data-route-group={connection.group}>
    <button type="button" className={styles.choice} data-route-choice="true"
      aria-label={`选择线路 ${row.path}`} aria-pressed={row.current} aria-disabled={Boolean(row.unavailableReason)}
      aria-describedby={`${switchId} ${quoteId}${row.unavailableReason ? ` ${reasonId}` : ""}`}
      onClick={() => { if (!row.unavailableReason) onChoose(connection.id); }}>
      <span className={styles.identity}>
        <strong>{row.path}</strong>
        {connection.groupLabel && connection.groupLabel !== connection.group && <small>分组 ID：{connection.group}</small>}
        <small id={switchId}>切换后将使用：<span className={styles.modelId}>{row.switchModelId}</span></small>
        {connection.switchModelName && connection.switchModelName !== row.switchModelId && <small>{connection.switchModelName}</small>}
        <span className={styles.amount} id={quoteId}>同型号报价：{row.comparisonPrice}</span>
        <small>{balance}</small>
        {row.unavailableReason && <small id={reasonId}>{row.unavailableReason}</small>}
      </span>
      {row.current && <Check size={15} className={styles.current} aria-label="当前线路" />}
    </button>
    <details className={styles.details} open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}>
      <summary>{row.path}价格明细</summary>
      {detailsOpen && (connection.modelDescriptor ? <ModelPriceTable model={connection.modelDescriptor} /> : <p>{connection.modelQuote ?? "—"}</p>)}
    </details>
  </li>;
}

/** A route is one existing connection ID, never a sequence of connection/model writes. */
export function NodeParameterRoutePicker({ label, active, connections, currentConnection, currentModel, billingAccounts,
  onChange, onManage }: {
  label: string;
  active: boolean;
  connections: readonly NodeParameterRoute[];
  currentConnection: string;
  currentModel?: string;
  billingAccounts: readonly BillingAccount[];
  onChange: (connectionId: string) => void;
  /** The owner closes and flushes the parameter card before opening settings. */
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [previousActive, setPreviousActive] = useState(active);
  const [connectionContext, setConnectionContext] = useState(currentConnection);
  if (connectionContext !== currentConnection) { setConnectionContext(currentConnection); if (open) setOpen(false); }
  if (previousActive !== active) {
    setPreviousActive(active);
    if (previousActive && !active && open) setOpen(false);
  }
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const focusIntent = useRef<"current" | "first" | "last">("current");
  const surfaceId = useId();
  const triggerId = `${surfaceId}-trigger`;
  const current = connections.find(connection => connection.id === currentConnection);
  const path = nodeParameterRoutePath(connections, currentConnection);
  const balanceFor = (connection?: NodeParameterRoute) => billingCompact(billingAccounts.find(account => account.id === connection?.supplierId)?.billing);
  // Closed cards do not calculate every candidate's tariffs or mount their tables.
  const rows = useMemo(() => open && active ? nodeParameterRouteRows(connections, currentConnection) : [], [open, active, connections, currentConnection]);

  useAnchoredSurface({ open, active, onClose: () => setOpen(false), hostRef: host, triggerRef: trigger, surfaceRef: surface,
    minWidth: 320, maxWidth: 480, preferSidePlacement: true });
  useLayoutEffect(() => {
    if (!open) return;
    const buttons = [...(surface.current?.querySelectorAll<HTMLButtonElement>("button[data-route-choice]") ?? [])];
    const selected = focusIntent.current === "last" ? buttons.at(-1) : focusIntent.current === "first" ? buttons[0]
      : buttons.find(button => button.getAttribute("aria-pressed") === "true") ?? buttons[0];
    selected?.focus({ preventScroll: true });
  }, [open]);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-route-choice]") : null;
    if (!target && event.target !== trigger.current) return;
    event.preventDefault(); event.stopPropagation();
    if (!open) {
      focusIntent.current = event.key === "End" || event.key === "ArrowUp" ? "last" : "first";
      setOpen(true); return;
    }
    const buttons = [...(surface.current?.querySelectorAll<HTMLButtonElement>("button[data-route-choice]") ?? [])];
    const index = target ? buttons.indexOf(target) : -1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true }); buttons[next]?.scrollIntoView({ block: "nearest" });
  };
  const choose = (connectionId: string) => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
    if (connectionId !== currentConnection) onChange(connectionId);
  };

  return <div ref={host} className={styles.host} data-node-config-layer-open={open && active ? "true" : undefined} data-dialog-return-focus-id={triggerId} onKeyDown={keyDown}
    onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <div className={styles.bar} aria-label="当前线路">
      <span className={styles.path} title={current ? `${path} · ${current.name} · ${current.id}` : currentConnection || "未配置 API"}>{path}</span>
      <small className={styles.balance} title={balanceFor(current)}>{balanceFor(current)}</small>
      <button id={triggerId} ref={trigger} type="button" className={styles.trigger} aria-label={`${label} 线路`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? surfaceId : undefined}
        onClick={() => { focusIntent.current = "current"; setOpen(!open); }}>
        换线路 {connections.length}<ChevronDown size={12} aria-hidden="true" />
      </button>
    </div>
    {currentConnection && !current && <p className={styles.warning} role="status">原连接已归档或删除（{currentConnection}）。节点选择已保留，请恢复连接或手动选择其他连接。</p>}
    {current?.available === false && <p className={styles.warning} role="status">当前实际连接是 {current.name}（{current.group}），{current.unavailableReason ?? "该分组密钥不可用"}。请重新配置或选择其他可用分组。</p>}
    {open && active && <div ref={surface} id={surfaceId} popover="manual" className={styles.surface}
      role="dialog" aria-label={`${label} 候选线路`} aria-modal="false">
      <header className={styles.heading}><strong>选择线路</strong><span>比对型号：{currentModel || "—"}</span></header>
      <ul className={styles.list} aria-label="候选线路">
        {rows.map(row => <RouteChoice key={row.connection.id} row={row} balance={balanceFor(row.connection)} onChoose={choose} />)}
      </ul>
      {rows.length === 0 && <p className={styles.empty}>暂无连接，请先配置供应商。</p>}
      <button type="button" className={styles.manage} aria-label="管理供应商与密钥" onClick={() => { setOpen(false); onManage(); }}>
        <ExternalLink size={14} />管理供应商与密钥
      </button>
    </div>}
  </div>;
}

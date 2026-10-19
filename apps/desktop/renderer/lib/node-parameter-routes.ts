import type { CanvasNodeData } from "../components/types";
import type { SupplierBillingSnapshot } from "@super-canvas/db";
import { pickerConnectionLabel } from "./model-picker";
import { modelPickerPriceCompact } from "./model-picker-data";
import { billingCompact } from "./supplier-billing-display";

export type NodeParameterRoute = NonNullable<CanvasNodeData["connectionOptions"]>[number];

/** Open-menu projection only; every tariff stays attached to its own full model. */
export function nodeParameterRouteRows(connections: readonly NodeParameterRoute[], currentId: string, currentModel?: string) {
  return connections.map(connection => {
    const peers = connections.filter(candidate => candidate.supplier === connection.supplier && candidate.group === connection.group);
    const connectionLabel = pickerConnectionLabel(connection, peers);
    const supplierPrefix = [`${connection.supplierLabel} · `, `${connection.supplierLabel} › `, `${connection.supplierLabel} `]
      .find(prefix => connectionLabel.startsWith(prefix) && connectionLabel.length > prefix.length);
    const shortConnectionLabel = supplierPrefix ? connectionLabel.slice(supplierPrefix.length) : connectionLabel;
    const groupLabel = connection.groupLabel ?? connection.group;
    const switchModelId = connection.switchModelId ?? "—";
    const switchModelName = connection.switchModelName?.trim() || switchModelId;
    return {
      connection,
      connectionLabel,
      shortLabel: shortConnectionLabel === groupLabel ? groupLabel : `${groupLabel} · ${shortConnectionLabel}`,
      path: `${connection.supplierLabel} › ${groupLabel} › ${connectionLabel}`,
      current: connection.id === currentId,
      comparisonPrice: connection.modelDescriptor ? modelPickerPriceCompact(connection.modelDescriptor) : connection.modelQuote ?? "—",
      switchModelId,
      switchModelName,
      switchLabel: currentModel && connection.switchModelId && switchModelId === currentModel ? "同型号" : `切换后将使用：${switchModelName}`,
      unavailableReason: connection.available === false ? connection.unavailableReason ?? "密钥未配置或不可用" : undefined,
    };
  });
}

/** Group by supplier identity, preserving each supplier's and connection's order. */
export function nodeParameterRouteGroups(rows: ReturnType<typeof nodeParameterRouteRows>) {
  const groups = new Map<string, { supplier: string; label: string; rows: typeof rows }>();
  for (const row of rows) {
    const { supplier, supplierLabel } = row.connection;
    const group = groups.get(supplier) ?? { supplier, label: supplierLabel, rows: [] };
    group.rows.push(row);
    groups.set(supplier, group);
  }
  return [...groups.values()];
}

/** Only real recorded balances occupy the compact line; no status becomes money. */
export function nodeParameterRouteBalance(billing?: SupplierBillingSnapshot) {
  return billing?.balance !== undefined && Number.isFinite(billing.balance) ? billingCompact(billing) : "";
}

/** A single compact path can omit a unique connection name; its identity is retained. */
export function nodeParameterRoutePath(connections: readonly NodeParameterRoute[], currentId: string): string {
  const current = connections.find(connection => connection.id === currentId);
  if (!current) return currentId ? "原连接已不可用" : "未配置 API";
  const peers = connections.filter(connection => connection.supplier === current.supplier && connection.group === current.group);
  return `${current.supplierLabel} › ${current.groupLabel ?? current.group}${peers.length > 1 ? ` › ${pickerConnectionLabel(current, peers)}` : ""}`;
}

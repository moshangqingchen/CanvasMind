import type { CanvasNodeData } from "../components/types";
import type { SupplierBillingSnapshot } from "@super-canvas/db";
import { pickerConnectionLabel } from "./model-picker";
import { modelPickerPriceCompact } from "./model-picker-data";
import { billingCompact } from "./supplier-billing-display";

export type NodeParameterRoute = NonNullable<CanvasNodeData["connectionOptions"]>[number];

function withoutSupplierPrefix(label: string, supplierLabel: string) {
  const supplierPrefix = [`${supplierLabel} · `, `${supplierLabel} › `, `${supplierLabel} `]
    .find(prefix => label.startsWith(prefix) && label.length > prefix.length);
  return supplierPrefix ? label.slice(supplierPrefix.length) : label;
}

/** Keep every other character verbatim, including mojibake already stored in a name. */
function comparableLabel(label: string, supplierLabel: string) {
  const trimSeparators = (value: string) => value.replace(/^[\s·›|:：/\\–—-]+|[\s·›|:：/\\–—-]+$/gu, "");
  return trimSeparators(withoutSupplierPrefix(trimSeparators(label), supplierLabel));
}

/** Open-menu projection only; every tariff stays attached to its own full model. */
export function nodeParameterRouteRows(connections: readonly NodeParameterRoute[], currentId: string, currentModel?: string) {
  return connections.map(connection => {
    const peers = connections.filter(candidate => candidate.supplier === connection.supplier && candidate.group === connection.group);
    const connectionLabel = pickerConnectionLabel(connection, peers);
    const shortConnectionLabel = withoutSupplierPrefix(connectionLabel, connection.supplierLabel);
    const groupLabel = connection.groupLabel ?? connection.group;
    const comparableGroup = comparableLabel(groupLabel, connection.supplierLabel) || groupLabel;
    const comparableConnection = comparableLabel(connectionLabel, connection.supplierLabel) || connectionLabel;
    const sharesPrefix = comparableGroup.startsWith(comparableConnection) || comparableConnection.startsWith(comparableGroup);
    const primaryLabel = sharesPrefix && comparableConnection.length > comparableGroup.length ? comparableConnection : comparableGroup;
    const duplicateGroupLabel = connections.some(candidate => candidate.supplier === connection.supplier && candidate.group !== connection.group &&
      (comparableLabel(candidate.groupLabel ?? candidate.group, candidate.supplierLabel) || (candidate.groupLabel ?? candidate.group)) === comparableGroup);
    const switchModelId = connection.switchModelId ?? "—";
    const switchModelName = connection.switchModelName?.trim() || switchModelId;
    return {
      connection,
      connectionLabel,
      shortLabel: shortConnectionLabel === groupLabel ? groupLabel : `${groupLabel} · ${shortConnectionLabel}`,
      primaryLabel,
      groupIdLabel: duplicateGroupLabel ? connection.group : undefined,
      secondaryLabel: sharesPrefix ? undefined : comparableConnection,
      path: `${connection.supplierLabel} › ${groupLabel} › ${connectionLabel}`,
      current: connection.id === currentId,
      comparisonPrice: connection.modelDescriptor ? modelPickerPriceCompact(connection.modelDescriptor) : connection.modelQuote ?? "—",
      switchModelId,
      switchModelName,
      switchLabel: connection.switchModelId ? currentModel && switchModelId === currentModel ? "同型号" : `切换后将使用：${switchModelName}` : undefined,
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

/** Only one shared, nonempty account identity permits a supplier-level balance. */
export function nodeParameterRouteSharedSupplierId(rows: readonly ReturnType<typeof nodeParameterRouteRows>[number][]) {
  const supplierId = rows[0]?.connection.supplierId;
  return supplierId?.trim() && rows.every(row => row.connection.supplierId === supplierId) ? supplierId : undefined;
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

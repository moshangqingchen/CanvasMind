import type { CanvasNodeData } from "../components/types";
import { pickerConnectionLabel } from "./model-picker";
import { modelPickerPriceCompact } from "./model-picker-data";

export type NodeParameterRoute = NonNullable<CanvasNodeData["connectionOptions"]>[number];

/** Open-menu projection only; every tariff stays attached to its own full model. */
export function nodeParameterRouteRows(connections: readonly NodeParameterRoute[], currentId: string) {
  return connections.map(connection => {
    const peers = connections.filter(candidate => candidate.supplier === connection.supplier && candidate.group === connection.group);
    const connectionLabel = pickerConnectionLabel(connection, peers);
    return {
      connection,
      connectionLabel,
      path: `${connection.supplierLabel} › ${connection.groupLabel ?? connection.group} › ${connectionLabel}`,
      current: connection.id === currentId,
      comparisonPrice: connection.modelDescriptor ? modelPickerPriceCompact(connection.modelDescriptor) : connection.modelQuote ?? "—",
      switchModelId: connection.switchModelId ?? "—",
      unavailableReason: connection.available === false ? connection.unavailableReason ?? "密钥未配置或不可用" : undefined,
    };
  });
}

/** A single compact path can omit a unique connection name; its identity is retained. */
export function nodeParameterRoutePath(connections: readonly NodeParameterRoute[], currentId: string): string {
  const current = connections.find(connection => connection.id === currentId);
  if (!current) return currentId ? "原连接已不可用" : "未配置 API";
  const peers = connections.filter(connection => connection.supplier === current.supplier && connection.group === current.group);
  return `${current.supplierLabel} › ${current.groupLabel ?? current.group}${peers.length > 1 ? ` › ${pickerConnectionLabel(current, peers)}` : ""}`;
}

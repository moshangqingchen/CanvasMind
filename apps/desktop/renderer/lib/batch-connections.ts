import { arePortKindsCompatible, wouldCreateCycle, type PortKind } from "@super-canvas/core";
import type { Connection } from "@xyflow/react";
import type { CanvasEdge, CanvasNode } from "../components/types";
import { hasEdgeForNodePair } from "./canvas-connections";

export interface BatchConnectionSource {
  nodeId: string;
  handleId: string;
  kind: PortKind;
}

export type ConnectionSkipReason = "incompatible" | "cycle" | "duplicate" | "occupied" | "limit";

export function checkCanvasConnection(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[], connection: Connection) {
  const source = nodes.find(node => node.id === connection.source);
  const target = nodes.find(node => node.id === connection.target);
  const sourceKind = source?.data.outputs?.find(port => port.id === connection.sourceHandle)?.kind as PortKind | undefined;
  const targetPort = target?.data.inputs?.find(port => port.id === connection.targetHandle);
  const targetKind = targetPort?.kind as PortKind | undefined;
  let code: ConnectionSkipReason | undefined;
  let reason = "";
  if (!source || !target || !sourceKind || !targetKind || !arePortKindsCompatible(sourceKind, targetKind)) {
    code = "incompatible";
    reason = `不能连接 ${sourceKind ?? "?"} → ${targetKind ?? "?"}`;
  } else if (wouldCreateCycle({ nodes: [...nodes], edges: [...edges] }, connection.source, connection.target)) {
    code = "cycle";
    reason = "这条连线会形成循环，画布只支持无环工作流";
  } else if (hasEdgeForNodePair(edges, connection.source, connection.target)) {
    code = "duplicate";
    reason = "同一图片只能连接目标节点的一个接口";
  } else if (!targetPort?.multiple && edges.some(edge => edge.target === connection.target && edge.targetHandle === connection.targetHandle)) {
    code = "occupied";
    reason = `${targetPort?.label} 只能连接一个上游节点`;
  }
  return { valid: !code, source, target, sourceKind, targetKind, targetPort, reason, code };
}

/** Rows use half the first card's height as tolerance, then read left to right. */
export function readingOrderCanvasNodes(nodes: readonly CanvasNode[]): CanvasNode[] {
  const pending = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id));
  const ordered: CanvasNode[] = [];
  while (pending.length) {
    const first = pending.shift()!;
    const tolerance = (first.measured?.height ?? first.height ?? (Number(first.style?.height) || 240)) / 2;
    const row = [first];
    while (pending[0] && pending[0].position.y - first.position.y <= tolerance) row.push(pending.shift()!);
    ordered.push(...row.sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y || a.id.localeCompare(b.id)));
  }
  return ordered;
}

export function batchOutputSources(nodes: readonly CanvasNode[]): BatchConnectionSource[] {
  if (nodes.length < 2) return [];
  const byKind = new Map<PortKind, BatchConnectionSource[]>();
  for (const node of readingOrderCanvasNodes(nodes)) {
    const kinds = new Set<string>();
    for (const port of node.data.outputs ?? []) {
      if (kinds.has(port.kind)) continue;
      kinds.add(port.kind);
      const kind = port.kind as PortKind;
      const entries = byKind.get(kind) ?? [];
      entries.push({ nodeId: node.id, handleId: port.id, kind });
      byKind.set(kind, entries);
    }
  }
  return [...byKind.values()].sort((a, b) => b.length - a.length)[0]?.filter((_, _index, all) => all.length >= 2) ?? [];
}

export function planBatchConnections(options: {
  sources: readonly BatchConnectionSource[];
  targetId: string;
  targetHandle: string;
  nodes: readonly CanvasNode[];
  edges: readonly CanvasEdge[];
  maxInputImages?: number;
}) {
  const { sources, targetId, targetHandle, nodes, maxInputImages } = options;
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const sourceById = new Map(sources.map(source => [source.nodeId, source]));
  const orderedSources = readingOrderCanvasNodes(sources.flatMap(source => nodeById.get(source.nodeId) ? [nodeById.get(source.nodeId)!] : []))
    .map(node => sourceById.get(node.id)!);
  orderedSources.push(...sources.filter(source => !nodeById.has(source.nodeId)));
  const edges: CanvasEdge[] = [];
  const skipped: Array<{ source: BatchConnectionSource; reason: ConnectionSkipReason }> = [];
  const imageAssets = new Set<string>();
  const addImages = (node: CanvasNode | undefined, handle: string | null | undefined) => {
    if (!node) return;
    const port = node.data.outputs?.find(port => port.id === handle) ?? (!handle ? node.data.outputs?.[0] : undefined);
    if (port?.kind !== "image" && port?.kind !== "image[]") return;
    const ids = [node.data.assetId, ...(node.data.lastOutputAssetIds ?? [])].filter((id): id is string => typeof id === "string");
    for (const id of ids.length ? ids : [node.id]) imageAssets.add(id);
  };
  for (const edge of options.edges) if (edge.target === targetId) addImages(nodeById.get(edge.source), edge.sourceHandle);
  for (const source of orderedSources) {
    const connection = { source: source.nodeId, sourceHandle: source.handleId, target: targetId, targetHandle };
    const check = checkCanvasConnection(nodes, [...options.edges, ...edges], connection);
    if (!check.valid) { skipped.push({ source, reason: check.code! }); continue; }
    const before = new Set(imageAssets);
    addImages(check.source, source.handleId);
    if (maxInputImages !== undefined && imageAssets.size > before.size && imageAssets.size > maxInputImages) {
      imageAssets.clear(); for (const id of before) imageAssets.add(id);
      skipped.push({ source, reason: "limit" }); continue;
    }
    edges.push({ ...connection, id: `batch-${source.nodeId}-${targetId}-${edges.length}`, type: "smoothstep" });
  }
  return { edges, skipped };
}

export function batchConnectionSummary(count: number, label: string, skipped: readonly { reason: ConnectionSkipReason }[], limit?: number): string {
  const labels: Record<ConnectionSkipReason, string> = { incompatible: "类型不兼容", cycle: "形成循环", duplicate: "已连接", occupied: "单输入端口已占用", limit: `超出参考图上限（最多 ${limit} 张）` };
  const counts = new Map<ConnectionSkipReason, number>();
  for (const item of skipped) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  return `已连接 ${count} 个素材到「${label}」${skipped.length ? `；跳过 ${skipped.length} 个：${[...counts].map(([reason, total]) => `${labels[reason]} ${total}`).join("、")}` : ""}`;
}

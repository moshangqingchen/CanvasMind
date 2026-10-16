import type { CanvasNode, RunSnapshot } from "../components/types";
import type { CanvasRect } from "./canvas-usable-area";

export type IslandSaveState = "saved" | "pending" | "saving" | "error" | "conflict";
export interface IslandTask {
  id: string;
  nodeId: string;
  title: string;
  status: string;
  startedAt?: string;
}
export const activeIslandStatuses = new Set(["blocked", "queued", "submitting", "running", "archiving", "cancel_requested"]);
export const failedIslandStatuses = new Set(["failed", "needs_attention"]);
export const islandTaskLabels: Record<string, string> = {
  blocked: "等待上游", queued: "排队中", submitting: "正在提交", running: "生成中", archiving: "保存结果",
  cancel_requested: "取消中", cancelled: "已取消", succeeded: "已完成", failed: "失败", needs_attention: "需要处理",
};

/** A temporary feedback popup must not shrink the canvas's persistent fit area. */
export function islandCanvasBounds(rect: CanvasRect): CanvasRect {
  return { left: rect.left, right: rect.right, top: rect.top, bottom: Math.min(rect.bottom, rect.top + 44) };
}

/** A small view of tasks already reconciled into this canvas. No requests or history cache. */
export function collectIslandTasks(
  nodes: readonly CanvasNode[],
  statuses: ReadonlyMap<string, string>,
  presentation: ReadonlyMap<string, { startedAt: string }>,
  snapshots: ReadonlyMap<string, RunSnapshot>,
): IslandTask[] {
  const byNode = new Map(nodes.map(node => [node.id, node]));
  const tasks = new Map<string, IslandTask>();
  const representedSources = new Set<string>();
  for (const node of nodes) {
    const data = node.data;
    if (!data.generatedResult || node.hidden) continue;
    const sourceId = data.generatedFromNodeId;
    const runId = data.generatedFromRunId ?? data.generatedPendingRequestId ?? node.id;
    const key = `${runId}:${sourceId ?? node.id}`;
    const source = sourceId ? byNode.get(sourceId) : undefined;
    const snapshot = data.generatedFromRunId ? snapshots.get(data.generatedFromRunId) : undefined;
    const runNode = snapshot?.nodes.find(item => item.nodeId === sourceId);
    const status = runNode?.status ?? data.generatedStatus;
    if (!status) continue;
    const startedAt = snapshot?.run.createdAt ?? data.generatedCreatedAt;
    if (sourceId && (!presentation.get(sourceId)?.startedAt || !startedAt || presentation.get(sourceId)!.startedAt <= startedAt)) representedSources.add(sourceId);
    const previous = tasks.get(key);
    // Output cards from one generation are one task. Preserve an active or failed sibling.
    if (!previous || (activeIslandStatuses.has(status) && !activeIslandStatuses.has(previous.status)) || (failedIslandStatuses.has(status) && previous.status === "succeeded")) {
      tasks.set(key, { id: key, nodeId: node.id, title: source?.data.label || data.label, status, startedAt });
    }
  }
  for (const node of nodes) {
    if (node.hidden || node.data.generatedResult || !node.data.nodeType?.endsWith("-generation") || representedSources.has(node.id)) continue;
    const status = statuses.get(node.id);
    if (!status) continue;
    const startedAt = presentation.get(node.id)?.startedAt;
    tasks.set(`${node.id}:${startedAt ?? "current"}`, { id: `${node.id}:${startedAt ?? "current"}`, nodeId: node.id, title: node.data.label, status, startedAt });
  }
  return [...tasks.values()];
}

export function islandTaskTransition(previous: readonly IslandTask[], current: readonly IslandTask[]) {
  const old = new Map(previous.map(task => [task.id, task.status]));
  return {
    started: current.some(task => activeIslandStatuses.has(task.status) && !activeIslandStatuses.has(old.get(task.id) ?? "")),
    completed: current.some(task => task.status === "succeeded" && activeIslandStatuses.has(old.get(task.id) ?? "")),
  };
}

export function islandElapsed(tasks: readonly IslandTask[], now: number) {
  const times = tasks.filter(task => activeIslandStatuses.has(task.status)).map(task => Date.parse(task.startedAt ?? "")).filter(Number.isFinite);
  if (!times.length) return undefined;
  const seconds = Math.max(0, Math.floor((now - Math.min(...times)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

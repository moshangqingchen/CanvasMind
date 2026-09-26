import { fetchConnections, invalidateModelCache } from "./client-api";
import { fetchSuppliers, scanSupplier, supplierOwnsConnection, type SupplierRecord } from "./client-suppliers";
import { modelInventoryScanStatus } from "./model-inventory-status";

export interface SupplierRefreshResult {
  id: string;
  name: string;
  status: "updated" | "partial" | "failed";
  message: string;
}
export interface SupplierRefreshProgress {
  running: boolean;
  total: number;
  completed: number;
  current: string;
  results: SupplierRefreshResult[];
}
let snapshot: SupplierRefreshProgress = { running: false, total: 0, completed: 0, current: "", results: [] };
let pending: Promise<void> | undefined;
const listeners = new Set<(state: SupplierRefreshProgress) => void>();
function publish(update: Partial<SupplierRefreshProgress>) {
  snapshot = { ...snapshot, ...update };
  for (const listener of listeners) listener(snapshot);
}
export function subscribeSupplierRefresh(listener: (state: SupplierRefreshProgress) => void) {
  listeners.add(listener);
  listener(snapshot);
  return () => { listeners.delete(listener); };
}
function groupChanges(before: SupplierRecord, after: SupplierRecord) {
  const old = new Map(before.catalog.groups.filter(g => g.source !== "manual" && g.status !== "missing").map(g => [g.id, g]));
  const current = new Map(after.catalog.groups.filter(g => g.source !== "manual" && g.status !== "missing").map(g => [g.id, g]));
  return `分组新增 ${[...current.keys()].filter(id => !old.has(id)).length}、未再返回 ${[...old.keys()].filter(id => !current.has(id)).length}、更名 ${[...current.values()].filter(g => old.has(g.id) && old.get(g.id)!.label !== g.label).length}`;
}

/** One batch per window; closing/reopening Settings neither cancels nor duplicates it. */
export function refreshAllSuppliers(): Promise<void> {
  if (pending) return pending;
  publish({ running: true, total: 0, completed: 0, current: "正在读取已保存供应商", results: [] });
  pending = (async () => {
    const suppliers = (await fetchSuppliers()).filter(s => s.state?.visibility !== "deleted");
    publish({ total: suppliers.length });
    if (!suppliers.length) {
      publish({ results: [{ id: "empty", name: "尚未配置供应商", status: "updated", message: "请先添加供应商地址或保存一个连接，再刷新模型列表。" }] });
      return;
    }
    const priorConnections = new Map((await fetchConnections()).map(c => [c.id, c]));
    const outcomes: Array<{ after?: SupplierRecord; failed?: boolean }> = new Array(suppliers.length);
    let cursor = 0;
    // Scan two independent suppliers at a time. Each authenticated POST retains
    // its internal directory/key ordering and desktop persistence barrier.
    await Promise.all(Array.from({ length: Math.min(2, suppliers.length) }, async () => {
      while (cursor < suppliers.length) {
        const index = cursor++;
        const before = suppliers[index]!;
        publish({ current: before.name });
        try {
          outcomes[index] = { after: await scanSupplier(before.id, undefined, before.state?.revision ?? 0) };
        } catch {
          outcomes[index] = { failed: true };
        }
        publish({ completed: snapshot.completed + 1 });
      }
    }));
    publish({ current: "正在核对模型更新结果" });
    const finalConnections = await fetchConnections();
    const results = suppliers.map((before, index): SupplierRefreshResult => {
      const after = outcomes[index]?.after;
      if (!after) return { id: before.id, name: before.name, status: "failed", message: "刷新未完成，已保留配置；请检查网络或进入此供应商重新扫描。" };
      const connections = finalConnections.filter(c => supplierOwnsConnection(after, c));
      connections.forEach(c => invalidateModelCache(c.id));
      const keyed = connections.filter(c => c.apiKeySet);
      const refreshed = keyed.filter(c => ["live", "empty"].includes(modelInventoryScanStatus(c.config)) &&
        c.config.modelScanCheckedAt && c.config.modelScanCheckedAt !== priorConnections.get(c.id)?.config.modelScanCheckedAt);
      const confirmed = refreshed.length;
      const directoryOk = ["live", "empty"].includes(after.scanStatus) && after.scannedAt !== before.scannedAt;
      const incomplete = Boolean(after.scanError) || confirmed !== keyed.length || !directoryOk;
      const added = refreshed.reduce((n, c) => n + (Array.isArray(c.config.modelAddedIds) ? c.config.modelAddedIds.length : 0), 0);
      const removed = keyed.reduce((n, c) => n + (Array.isArray(c.config.modelRemovedModels) ? c.config.modelRemovedModels.length : 0), 0);
      return { id: before.id, name: before.name,
        status: incomplete ? (confirmed || directoryOk ? "partial" : "failed") : "updated",
        message: `${directoryOk ? groupChanges(before, after) : "目录未确认，保留原分组"}；Key 已确认 ${confirmed}/${keyed.length}；模型新增 ${added}、未再返回 ${removed}${connections.length > keyed.length ? `；${connections.length - keyed.length} 个连接未配置 Key` : ""}${after.scanError ? `；${after.scanError}` : ""}`,
      };
    });
    publish({ results });
  })().catch(() => {
    // Never expose arbitrary upstream messages or credential-bearing URLs.
    publish({ results: [...snapshot.results, { id: "batch", name: "读取供应商", status: "failed", message: "无法核对供应商更新结果，请检查本地服务后重试。" }] });
  }).finally(() => {
    pending = undefined;
    publish({ running: false, current: "" });
  });
  return pending;
}

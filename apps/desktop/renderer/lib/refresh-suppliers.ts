import { fetchConnections, invalidateModelCache } from "./client-api";
import { fetchSuppliers, scanSupplier, supplierOwnsConnection, type SupplierRecord } from "./client-suppliers";
import { refreshSupplierAccount, seedSupplierBilling } from "./client-supplier-billing";
import { buildSupplierRefreshResult, type SupplierRefreshResult } from "./supplier-refresh-report";
export { buildSupplierRefreshResult, supplierRefreshStatus } from "./supplier-refresh-report";
export type { SupplierRefreshResult, SupplierConnectionRefreshResult } from "./supplier-refresh-report";

export interface SupplierRefreshProgress {
  running: boolean;
  runningIds: string[];
  total: number;
  completed: number;
  current: string;
  results: SupplierRefreshResult[];
}
let snapshot: SupplierRefreshProgress = { running: false, runningIds: [], total: 0, completed: 0, current: "", results: [] };
let pending: Promise<void> | undefined;
let batch: Promise<void> | undefined;
let scope = new Set<string>();
const queuedSingles = new Map<string, Promise<void>>();
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
function publishResult(result: SupplierRefreshResult) {
  result = { ...result };
  const exists = snapshot.results.some(item => item.id === result.id);
  publish({ results: exists ? snapshot.results.map(item => item.id === result.id ? result : item) : [...snapshot.results, result] });
}
/** Saves a before/after report from the explicit Save and scan flow without issuing another request. */
export function recordSupplierRefreshResult(result: SupplierRefreshResult): void {
  if (!snapshot.running) publish({ total: 1, completed: 1, current: "", runningIds: [] });
  publishResult(result);
}

/** The shared operation survives closing Settings. One supplier is never scanned twice concurrently. */
function begin(ids?: readonly string[]): Promise<void> {
  const all = ids === undefined;
  scope = new Set(ids ?? []);
  publish({ running: true, runningIds: [...scope], total: 0, completed: 0,
    current: "正在读取已保存供应商", ...(all ? { results: [] } : {}) });
  pending = (async () => {
    const allSuppliers = (await fetchSuppliers()).filter(supplier => supplier.state?.visibility !== "deleted");
    const suppliers = allSuppliers.filter(supplier => all || scope.has(supplier.id));
    scope = new Set(suppliers.map(supplier => supplier.id));
    publish({ total: suppliers.length });
    if (!suppliers.length) {
      publishResult({ id: all ? "empty" : ids![0]!, name: all ? "尚未配置供应商" : "供应商已变更", status: all ? "updated" : "failed",
        message: all ? "请先添加供应商地址或保存一个连接，再刷新模型列表。" : "当前供应商已删除或尚未保存，请重新打开配置。" });
      return;
    }
    const priorConnections = await fetchConnections();
    const outcomes: Array<{ after?: SupplierRecord }> = new Array(suppliers.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(2, suppliers.length) }, async () => {
      while (cursor < suppliers.length) {
        const index = cursor++;
        const before = suppliers[index]!;
        publish({ current: before.name, runningIds: [...new Set([...snapshot.runningIds, before.id])] });
        try {
          outcomes[index] = { after: await scanSupplier(before.id, undefined, before.state?.revision ?? 0, { verifyCapabilities: false }) };
        } catch {
          // Arbitrary upstream exceptions can contain credentials. Persist only safe classified diagnostics.
          outcomes[index] = {};
        }
      }
    }));
    publish({ current: "正在核对模型与接口更新结果" });
    const finalConnections = await fetchConnections();
    // Other suppliers may be edited while these scans run. Never re-seed the account
    // overview with the full list captured before network IO.
    const currentSuppliers = await fetchSuppliers();
    seedSupplierBilling(currentSuppliers);
    const reports = suppliers.map((before, index): SupplierRefreshResult => {
      const after = outcomes[index]?.after;
      if (!after) return { ...buildSupplierRefreshResult(before, before, priorConnections, priorConnections), status: "failed",
        message: "刷新未完成，已保留配置；请检查网络或本地服务后重试。",
        directory: { status: "failed", message: "本次请求未完成，已有目录与分组保留。" } };
      finalConnections.filter(connection => supplierOwnsConnection(after, connection)).forEach(connection => invalidateModelCache(connection.id));
      return buildSupplierRefreshResult(before, after, priorConnections, finalConnections);
    });
    reports.forEach(publishResult);
    cursor = 0;
    await Promise.all(Array.from({ length: Math.min(2, suppliers.length) }, async () => {
      while (cursor < suppliers.length) {
        const index = cursor++;
        const after = outcomes[index]?.after;
        const report = reports[index]!;
        publish({ current: `${suppliers[index]!.name} · 账务核对` });
        if (after?.siteLogin?.configured) {
          try {
            const billing = await refreshSupplierAccount(after.id);
            // Source edits during the request must not attach one account's balance to another account.
            if (billing.sourceId === after.state?.sourceId) {
              report.billing = billing;
              if (["failed", "partial"].includes(billing.status) || billing.todayStatus === "failed") {
                if (report.status === "updated") report.status = "partial";
                report.message += `；${billing.status === "live" ? "今日消耗读取失败" : `账务${billing.status === "failed" ? "读取失败" : "部分未读取"}`}`;
              }
            } else {
              report.billing = undefined;
              if (report.status === "updated") report.status = "partial";
              report.message += "；账务来源已改变，请重新刷新";
            }
          } catch {
            if (report.status === "updated") report.status = "partial";
            report.billing = { ...report.billing, sourceId: after.state?.sourceId ?? "", status: "failed", checkedAt: new Date().toISOString(),
              unit: report.billing?.unit ?? "未确认", sourceUrl: report.billing?.sourceUrl ?? "",
              error: "本次账务请求未完成，请检查网络或站点权限后重试；已有金额为上次读取的数据。" };
            report.message += "；账务读取失败";
          }
        }
        report.checkedAt = new Date().toISOString();
        publishResult(report);
        publish({ completed: snapshot.completed + 1, runningIds: snapshot.runningIds.filter(id => id !== suppliers[index]!.id) });
      }
    }));
    // Restore input order after concurrent completion so rows do not jump.
    const byId = new Map(snapshot.results.map(result => [result.id, result]));
    if (all) publish({ results: suppliers.map(supplier => byId.get(supplier.id)!) });
  })().catch(() => {
    publishResult({ id: ids?.[0] ?? "batch", name: ids ? "供应商刷新" : "读取供应商", status: "failed", checkedAt: new Date().toISOString(),
      message: "无法核对供应商更新结果，请检查本地服务后重试。" });
  }).finally(() => {
    pending = undefined;
    scope = new Set();
    publish({ running: false, runningIds: [], current: "" });
  });
  return pending;
}
function whenIdle(ids?: readonly string[]): Promise<void> {
  return pending ? pending.then(() => whenIdle(ids)) : begin(ids);
}
export function refreshAllSuppliers(): Promise<void> {
  if (batch) return batch;
  batch = whenIdle().finally(() => { batch = undefined; });
  return batch;
}
export function refreshSupplier(id: string): Promise<void> {
  const queued = queuedSingles.get(id);
  if (queued) return queued;
  if (pending && scope.has(id)) return pending;
  // A supplier created while a batch is running may not be in that batch's
  // captured list. Join its result if present, otherwise perform its own scan.
  const task = (batch ? batch.then(() => snapshot.results.some(result => result.id === id)
    ? undefined : whenIdle([id])) : whenIdle([id])).finally(() => { queuedSingles.delete(id); });
  queuedSingles.set(id, task);
  return task;
}

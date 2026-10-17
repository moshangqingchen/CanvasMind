import type { CatalogFailureReason, CatalogCheckMode, CatalogUpgradeStatus } from "./supplier-catalog-contracts";

export const CATALOG_POLICY_EVENT = "supplier-catalog-check-policy-changed";
export const CATALOG_CHECK_ENDPOINT = "/api/suppliers/catalog-upgrade";

export async function readCatalogCheckStatus(signal?: AbortSignal, summary = false): Promise<CatalogUpgradeStatus> {
  const response = await fetch(CATALOG_CHECK_ENDPOINT + (summary ? "?summary=1" : ""), { cache: "no-store", signal });
  if (!response.ok) throw new Error("自动检查设置暂时无法读取");
  return response.json() as Promise<CatalogUpgradeStatus>;
}

export async function saveCatalogCheckMode(mode: CatalogCheckMode): Promise<CatalogUpgradeStatus> {
  const response = await fetch(CATALOG_CHECK_ENDPOINT, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
  if (!response.ok) throw new Error("自动检查设置未保存，请重试");
  return response.json() as Promise<CatalogUpgradeStatus>;
}

/** Local confirmation of one exact committed candidate; no refresh is requested. */
export async function confirmCatalogCandidate(input: { connectionId: string; sourceKey: string; candidateVersion: string }): Promise<CatalogUpgradeStatus> {
  const response = await fetch(CATALOG_CHECK_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "confirm-candidate", connectionId: input.connectionId, sourceKey: input.sourceKey, candidateVersion: input.candidateVersion }) });
  if (!response.ok) throw new Error(response.status === 409 ? "候选目录已变化，请重新查看后确认。" : "候选目录未确认，请重试。");
  return response.json() as Promise<CatalogUpgradeStatus>;
}

/** Per-supplier committed cursors survive restarts without suppressing later changes. */
export async function acknowledgeCatalogCheckNotice(noticeCursors: Readonly<Record<string, number>>, signal?: AbortSignal): Promise<void> {
  const response = await fetch(CATALOG_CHECK_ENDPOINT, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ noticeCursors }), signal });
  if (!response.ok) throw new Error("目录提示读取记录未保存");
}

/** Local API scheduling only. The server reserves each attempt before upstream I/O. */
export function nextCatalogCheckAction(status: Pick<CatalogUpgradeStatus, "mode" | "phase" | "nextCheckAt">, now: number): { method: "GET" | "POST"; delay: number } | null {
  if (status.mode === "off") return null;
  if (status.phase === "running") return { method: "GET", delay: 3000 };
  // Re-read only local state when every connection is paused or none exists.
  // A later manual recovery/addition must not require restarting the app.
  if (status.mode === "daily" && status.nextCheckAt === null) return { method: "GET", delay: 86_400_000 };
  const due = Date.parse(status.nextCheckAt ?? "");
  if (!Number.isFinite(due)) return null;
  return due <= now ? { method: "POST", delay: 5000 } : { method: "GET", delay: Math.min(due - now, 86_400_000) };
}

export function catalogCheckNotice(status: Pick<CatalogUpgradeStatus, "noticeId" | "priceChangedSupplierIds" | "changedConnectionIds" | "manualConnectionIds" | "retainedPriceModelCount">): string {
  if (!status.noticeId) return "";
  const parts: string[] = [];
  const prices = new Set(status.priceChangedSupplierIds).size;
  const changed = new Set(status.changedConnectionIds).size;
  const manual = new Set(status.manualConnectionIds).size;
  if (prices) parts.push(prices + " 个供应商价格有变动");
  else if (changed) parts.push("已更新 " + changed + " 个连接的型号目录");
  if (manual) parts.push(manual + " 个连接需要手动刷新");
  if (status.retainedPriceModelCount && status.retainedPriceModelCount > 0) parts.push("部分型号沿用上次价格（" + status.retainedPriceModelCount + " 个）");
  return parts.join(" · ");
}

export function catalogFailureLabel(reason?: CatalogFailureReason): string {
  return reason ? ({ network: "网络", authentication: "鉴权", balance: "余额", upstream: "上游错误", unsupported: "不支持", incomplete: "型号列表未完整读取", conflict: "配置已变更" } satisfies Record<CatalogFailureReason, string>)[reason] : "";
}

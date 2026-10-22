import type { ProviderConnectionView } from "./client-api";
import { supplierOwnsConnection, type SupplierInput, type SupplierRecord } from "./client-suppliers";
import { modelInventoryScanStatus } from "./model-inventory-status";

export interface SupplierBrowserEntry {
  id: string;
  supplierKey: string;
  name: string;
  siteUrl: string;
  apiUrl: string;
  record?: SupplierRecord;
}

export type SupplierAccountFilter = "all" | "saved" | "unconfigured" | "attention";

export function supplierAccountLabel(record?: SupplierRecord): string {
  if (!record) return "供应商模板";
  const login = record.siteLogin;
  if (login?.configured) {
    if (login.username?.trim()) return `账号 · ${login.username.trim()}`;
    if (login.userId?.trim()) return `用户 ID · ${login.userId.trim()}`;
    return "站点账号已保存";
  }
  return "未配置站点账号";
}

/** Only non-secret connection defaults cross the boundary into a new account. */
export function newSupplierAccountDraft(entry: SupplierBrowserEntry): SupplierInput {
  return {
    name: `${entry.name} · 新账号`,
    supplierKey: entry.supplierKey,
    siteUrl: entry.siteUrl,
    apiUrl: entry.apiUrl,
    kind: entry.record?.kind ?? "auto",
  };
}

/** Derive searchable public facts once per inventory update, not per keystroke. */
export function supplierAccountRows<T extends SupplierBrowserEntry>(entries: readonly T[], connections: readonly ProviderConnectionView[]) {
  return entries.map(entry => {
    const owned = connections.filter(connection => supplierOwnsConnection(entry, connection));
    const accountLabel = supplierAccountLabel(entry.record);
    const needsAttention = Boolean(entry.record && (
      ["failed", "unauthorized"].includes(entry.record.scanStatus) ||
      entry.record.scanComplete === false && entry.record.scanStatus !== "unscanned"
    )) || owned.some(connection => connection.apiKeySet && ["stale", "unauthorized"].includes(modelInventoryScanStatus(connection.config)));
    const searchText = [entry.name, entry.siteUrl, entry.apiUrl, entry.supplierKey,
      entry.record?.siteLogin?.username, entry.record?.siteLogin?.userId,
      ...owned.map(connection => connection.name)].filter(Boolean).join(" ").toLocaleLowerCase();
    return { entry, accountLabel, connectionCount: owned.length, saved: Boolean(entry.record),
      unconfigured: !owned.some(connection => connection.apiKeySet), needsAttention, searchText };
  });
}

export function supplierAccountMatches(row: ReturnType<typeof supplierAccountRows>[number], query: string, filter: SupplierAccountFilter): boolean {
  const matchesFilter = filter === "all" || filter === "saved" && row.saved ||
    filter === "unconfigured" && row.unconfigured || filter === "attention" && row.needsAttention;
  return matchesFilter && query.trim().toLocaleLowerCase().split(/\s+/u).every(term => row.searchText.includes(term));
}

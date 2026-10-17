/** Saved directory state for assistant consumers. Reading it never refreshes a supplier. */
export interface AgentCatalogConnection {
  connectionId: string;
  connectionName: string;
  supplierId?: string;
  supplierName?: string;
  status: "saved" | "unread";
}

export const AGENT_UNREAD_CATALOG_MESSAGE = "未读取目录 · 请先在设置中刷新";

/** Historical scanner source text must not imply that opening the picker scans. */
export function agentSavedCatalogDescription(description?: string): string | undefined {
  return description?.replace(/^由当前供应商 API 实时返回(?:的模型)?/u, "来自已保存的供应商目录");
}

export interface AgentCatalogSnapshot<T> {
  models: T[];
  connections: AgentCatalogConnection[];
}

/** Older local clients and isolated fixtures can still return the model array. */
export function agentCatalogSnapshot<T>(value: T[] | AgentCatalogSnapshot<T>): AgentCatalogSnapshot<T> {
  return Array.isArray(value) ? { models: value, connections: [] } : value;
}

export function unreadAgentCatalogConnections(connections: readonly AgentCatalogConnection[], query = "") {
  const search = query.trim().toLocaleLowerCase();
  return connections.filter(connection => connection.status === "unread" &&
    (!search || [connection.connectionName, connection.supplierName].join(" ").toLocaleLowerCase().includes(search)));
}

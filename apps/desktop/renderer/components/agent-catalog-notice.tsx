"use client";

import { Plug } from "lucide-react";
import { AGENT_UNREAD_CATALOG_MESSAGE, unreadAgentCatalogConnections, type AgentCatalogConnection } from "../lib/agent-catalog-status";
import styles from "./creative-agent-panel.module.css";

export function AgentCatalogNotice({ connections, query, onManage }: {
  connections: readonly AgentCatalogConnection[];
  query?: string;
  onManage: (connectionId: string) => void;
}) {
  const unread = unreadAgentCatalogConnections(connections, query);
  if (!unread.length) return null;
  return <div className={styles.catalogNotices} aria-label="未读取的供应商目录">
    {unread.map(connection => <div key={connection.connectionId} data-catalog-connection={connection.connectionId}>
      <span><strong>{connection.supplierName ?? connection.connectionName}</strong>{connection.supplierName && connection.supplierName !== connection.connectionName && <small>{connection.connectionName}</small>}<small>{AGENT_UNREAD_CATALOG_MESSAGE}</small></span>
      <button type="button" className={styles.ghost} onClick={() => onManage(connection.connectionId)} aria-label={`前往 ${connection.connectionName} 供应商设置`}><Plug size={12} />前往设置</button>
    </div>)}
  </div>;
}

export type CatalogCheckMode = "off" | "upgrade" | "daily";
export type CatalogFailureReason = "network" | "authentication" | "balance" | "upstream" | "unsupported" | "incomplete" | "conflict";
export interface CatalogChange {
  kind: "price" | "model-added" | "model-removed" | "model-changed" | "group-added" | "group-removed" | "group-changed";
  modelId?: string;
  groupId?: string;
  before?: string;
  after?: string;
}
export interface CatalogChangeRecord {
  id: string;
  checkedAt: string;
  supplierId?: string;
  supplierName?: string;
  connectionId: string;
  connectionName: string;
  changes: CatalogChange[];
}
export interface CatalogConnectionStatus {
  connectionId: string;
  supplierId?: string;
  supplierName?: string;
  name: string;
  manualRequired: boolean;
  pauseReason?: CatalogFailureReason;
  paused: boolean;
  lastAttemptAt?: string;
  nextCheckAt: string | null;
  retainedPriceModelCount?: number;
}
export interface CatalogUpgradeStatus {
  revision: string;
  mode: CatalogCheckMode;
  phase: "idle" | "running" | "complete";
  total: number;
  refreshed: number;
  unavailable: number;
  failed: number;
  retainedPriceModelCount?: number;
  updatedConnectionIds: string[];
  manualConnectionIds: string[];
  changedConnectionIds: string[];
  priceChangedSupplierIds: string[];
  nextCheckAt: string | null;
  connections: CatalogConnectionStatus[];
  history: CatalogChangeRecord[];
  noticeId: string | null;
}

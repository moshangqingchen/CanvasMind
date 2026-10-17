export type CatalogCheckMode = "off" | "upgrade" | "daily";
export type CatalogFailureReason = "network" | "authentication" | "balance" | "upstream" | "unsupported" | "incomplete" | "conflict";
export interface CatalogChange {
  kind: "price" | "model-added" | "model-removed" | "model-changed" | "group-added" | "group-removed" | "group-changed";
  modelId?: string;
  groupId?: string;
  before?: string;
  after?: string;
  reason?: "explicit-unpublished";
  sourceUrl?: string;
  checkedAt?: string;
  condition?: string;
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
  /** Read-only source facts. Viewing this never starts collection. */
  pipeline?: CatalogPipelineDiagnostics;
}

export interface CatalogSourceDiagnostic {
  sourceKey: string;
  supplierId: string;
  connectionIds: string[];
  entryId: string;
  role: "key-membership" | "catalog-offer" | "price" | "schema" | "health";
  identity: "anonymous" | "site-account" | "connection-key";
  groupIdentity?: string;
  sourceUrl?: string;
  status: "succeeded" | "partial" | "failed" | "deferred" | "unread" | "running" | "unknown";
  reason?: string;
  checkedAt?: string;
  complete: boolean;
  modelCount?: number;
  requiredForMembership: boolean;
  paused: boolean;
  nextCheckAt: string | null;
}
export interface CatalogMembershipCandidateSummary {
  connectionId: string;
  sourceKey: string;
  candidateVersion: string;
  baselineCount: number;
  candidateCount: number;
  missingCount: number;
  countedCycles: number;
  requiredCycles: number;
  checkedAt: string;
}
export interface CatalogHistoricalDescriptor {
  connectionId: string;
  modelId: string;
  unavailableAt: string;
  sourceKeys: string[];
  descriptor: import("@super-canvas/providers").ModelDescriptor;
}
export interface CatalogPipelineDiagnostics {
  diagnostics: CatalogSourceDiagnostic[];
  candidates: CatalogMembershipCandidateSummary[];
  historyDescriptors: CatalogHistoricalDescriptor[];
  contracts?: Array<{ connectionId: string; modelId: string; operation: string; status: "accepted" | "protected" | "pending";
    reason?: "incomplete" | "removed" | "conflicting-source"; checkedAt: string; sourceUrl?: string }>;
  /** Each supplier entry has its own monotonic cursor; no global sequence is inferred. */
  noticeCursors: Record<string, number>;
  acknowledgedCursors: Record<string, number>;
}

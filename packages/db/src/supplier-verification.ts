/** Durable supplier verification ledger. Never contains decrypted credentials. */
export type ImageResolutionTier = "1K" | "2K" | "4K";
export type CapabilityEvidenceStatus =
  | "declared"
  | "verified"
  | "inferred"
  | "approximate"
  | "assumed"
  | "unsupported"
  | "conflict";
export interface ImageCapabilityEvidence {
  id: string;
  supplierId: string;
  sourceId: string;
  connectionId: string;
  group: string;
  modelId: string;
  operation: "image.generate" | "image.edit";
  kind: "group" | "documentation" | "model-plaza" | "test" | "adapter" | "inference";
  sourceUrl?: string;
  checkedAt: string;
  excerpt: string;
  fingerprint: string;
  status: CapabilityEvidenceStatus;
  resolution?: ImageResolutionTier;
  quality?: string;
  ratio?: string;
  actualWidth?: number;
  actualHeight?: number;
}
export interface VerificationCharge {
  amount: number;
  currency: string;
  unit: "image" | "request";
  sourceUrl?: string;
  checkedAt: string;
  requestId?: string;
  taskId?: string;
  precision?: number;
}
export type SupplierVerificationStatus =
  | "queued"
  | "submitting"
  | "running"
  | "archiving"
  | "succeeded"
  | "unsupported"
  | "inconclusive"
  | "needs_attention"
  | "cancelled"
  | "superseded";
export interface SupplierVerificationCase {
  id: string;
  requestId: string;
  supplierId: string;
  sourceId: string;
  connectionId: string;
  group: string;
  /** Official group identity at submission planning, independent of its editable name. */
  supplierGroupId?: string;
  modelId: string;
  provider: string;
  fingerprint: string;
  dedupeKey: string;
  resolution: ImageResolutionTier;
  quality?: string;
  ratio: string;
  expectedWidth: number;
  expectedHeight: number;
  parameters: Record<string, string | number | boolean>;
  status: SupplierVerificationStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  /** Provider response may contain signed URLs; excluded from public endpoints. */
  task?: Record<string, unknown>;
  actualWidth?: number;
  actualHeight?: number;
  assetId?: string;
  approximate?: boolean;
  reason?: string;
  /** A rejected Key blocks this connection, not other groups of the supplier. */
  failureKind?: "authentication";
  rejectedParameter?: "quality" | "resolution";
  legalQualities?: string[];
  /** Descending retries use the model's captured values, never invented tiers. */
  qualityCandidates?: string[];
  /** An upstream account outage leaves the highest requested tier provisional. */
  provisional?: boolean;
  resolutionMismatch?: boolean;
  nextAttemptAt?: string;
  /** Links durable retries to the failed request without reusing its id. */
  retryOf?: string;
  retestOf?: string;
  expectedCharge?: VerificationCharge;
  actualCharge?: VerificationCharge;
  chargeStatus?: "unknown" | "matched" | "mismatch";
}
export interface SupplierVerificationRecord {
  id: string;
  schemaVersion: 1;
  revision: number;
  sourceId: string;
  /** v1: six submissions per supplier; v2: all groups/models, missing cases only. */
  policyVersion: 1 | 2;
  limit: number;
  used: number;
  round: number;
  paused: boolean;
  /** Preparation must not act as a permanent user or billing hold on new Keys. */
  pauseReason?: "preview" | "manual" | "safety";
  reason?: string;
  connectionBlocks?: Array<{
    connectionId: string;
    fingerprint: string;
    reason: string;
    kind: "authentication";
  }>;
  createdAt: string;
  updatedAt: string;
  cases: SupplierVerificationCase[];
  evidence: ImageCapabilityEvidence[];
  coverage?: Array<{ connectionId: string; group: string; modelId: string }>;
  skipped: Array<{ connectionId: string; group?: string; modelId: string; reason: string }>;
}

export class SupplierVerificationConflictError extends Error {
  constructor() {
    super("核验记录已更新，请重新读取");
    this.name = "SupplierVerificationConflictError";
  }
}

import type { CatalogAuthKind, CatalogEvidenceRole, CatalogReadReason } from "./catalog-read-contracts";

export interface SupplierReadOnlySource {
  entryId: string;
  sourceUrl: string;
  role: CatalogEvidenceRole;
  identity: CatalogAuthKind;
  status: "succeeded" | "failed" | "deferred";
  complete: boolean;
  checkedAt: string;
  reason?: CatalogReadReason;
  modelCount: number;
}

export interface SupplierReadOnlyConnectionCheck {
  connectionId: string;
  name: string;
  groupIdentity: string;
  hasBaseline: boolean;
  baselineCheckedAt?: string;
  membershipComplete: boolean;
  currentModelCount: number;
  addedModelIds: string[];
  firstDiscoveredModelIds: string[];
  /** Observed absence only; never proof that a supplier permanently removed a model. */
  missingModelIds: string[];
  sources: SupplierReadOnlySource[];
}

export interface SupplierReadOnlyCatalogChange {
  groupIdentity: string;
  groupName: string;
  kind: "group-discovered" | "group-added" | "group-renamed" | "model-discovered" | "model-added" | "model-name" | "price" | "parameters";
  modelId?: string;
  before?: string;
  after: string;
  sourceUrl: string;
  checkedAt: string;
}

export interface SupplierReadOnlyCheckReport {
  supplierId: string;
  supplierName: string;
  checkedAt: string;
  readOnly: true;
  /** Describes only the planned machine-readable sources, never the entire website. */
  status: "complete" | "partial" | "failed";
  connections: SupplierReadOnlyConnectionCheck[];
  sources: SupplierReadOnlySource[];
  catalogChanges: SupplierReadOnlyCatalogChange[];
  limitations: string[];
}

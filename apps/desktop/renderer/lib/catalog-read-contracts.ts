import type { DocumentedModelInterface, ModelDescriptor, ProviderOperation, StructuredPriceTier } from "@super-canvas/providers";
import type { CatalogNormalizedInterfaceDocument } from "./catalog-interface-document-compile";
import type { collectCangyuanCatalogRead } from "./cangyuan-catalog";
import type { collectWeAiPricingRead } from "./weai-pricing-server";
import type { collectTk1688CatalogRead } from "./tk1688-catalog";
import type { ChentuCapabilitiesCollectorResult, MiaowuSchemaCollectorResult } from "./provider-inventory-collector";
import type { GenericSupplierSourceRead } from "./catalog-generic-source-collector";
import type { CatalogSupplementReadResult } from "./catalog-supplement-collector";
import { isDeepStrictEqual } from "node:util";

/** Identity, eligibility cycle and target projection are deliberately separate. */
export type CatalogEvidenceRole = "key-membership" | "catalog-offer" | "price" | "schema" | "health";
export type CatalogAuthKind = "anonymous" | "site-account" | "connection-key";
export interface CatalogAuthScope {
  kind: CatalogAuthKind;
  principalRef: string;
  credentialEpoch: string;
}
export interface CatalogApplyScope {
  supplierId: string;
  supplierSourceId: string;
  connectionIds: string[];
  groupIdentity?: string;
  modelId?: string;
}
export interface CatalogReadItemSpec {
  sourceKey: string;
  entryId: string;
  sourceUrl: string;
  parserVersion: string;
  authScope: CatalogAuthScope;
  applyScope: CatalogApplyScope;
  role: CatalogEvidenceRole;
  /** Alternatives inside this source do not become additional requirements. */
  requiredForMembership: boolean;
}
export interface CatalogObservationContext {
  runId: string;
  observationCycleId: string;
  identityEpoch: string;
  dispatchSeq: number;
}
export type CatalogReadReason = "network" | "upstream" | "authentication" | "balance" | "unsupported" | "incomplete" |
  "invalid-response" | "budget" | "credentials-unavailable" | "cancelled";
export interface CatalogReadCoverage {
  domain: "key-list" | "offers" | "group-options" | "price-fragment" | "contract" | "health";
  modelIds: string[];
  groupIdentities?: string[];
  /** Document/price success alone cannot prove absence of unmentioned fields or prices. */
  exhaustive: boolean;
}
export interface CatalogReadReceipt {
  spec: CatalogReadItemSpec;
  context: CatalogObservationContext;
  status: "succeeded" | "failed" | "deferred";
  complete: boolean;
  freshness: "live" | "unread";
  checkedAt: string;
  attemptId?: string;
  startedAt?: string;
  completedAt?: string;
  reason?: CatalogReadReason;
  httpStatus?: number;
  /** Actual safe endpoints, including equivalent candidates of one logical read. */
  attemptedUrls?: string[];
  coverage?: CatalogReadCoverage;
}
export interface CatalogNormalizedFacts {
  /** Application descriptors are projections, not proof of supplier field ownership. */
  models: ModelDescriptor[];
  /** Only rows validated by a successful membership parser may add partial positives. */
  validatedMembershipModelIds?: string[];
  groups?: Array<{ id: string; label: string; modelIds: readonly string[] }>;
  dependencies?: Record<string, number | string>;
  contractDigests?: string[];
  contracts?: DocumentedModelInterface[];
  interfaceDocuments?: CatalogNormalizedInterfaceDocument[];
  priceStates?: Array<{ modelId: string; groupIdentity?: string; operation?: ProviderOperation; state: "explicit-unpublished" | "unknown"; conditions?: StructuredPriceTier["conditions"] }>;
  /** API origin used to compile relative invocation paths, not the docs host. */
  contractOrigin?: string;
  /** Only exact model/path declarations; no raw document or free-form error. */
  contractDiagnostics?: CatalogContractDiagnostic[];
  /** Normalized declarations/dependencies only; never raw HTTP bodies or saved connections. */
  sourceFacts?:
    | { kind: "cangyuan"; value: Awaited<ReturnType<typeof collectCangyuanCatalogRead>> }
    | { kind: "weai"; value: Awaited<ReturnType<typeof collectWeAiPricingRead>> }
    | { kind: "tk1688"; value: Awaited<ReturnType<typeof collectTk1688CatalogRead>> }
    | { kind: "chentu-capabilities"; capabilities: ChentuCapabilitiesCollectorResult["capabilities"] }
    | { kind: "miaowu-schema"; contract: MiaowuSchemaCollectorResult["contract"] };
  supplierGroups?: GenericSupplierSourceRead["groups"];
  supplement?: CatalogSupplementReadResult;
}
export interface CatalogContractDiagnostic {
  modelId: string;
  operation: ProviderOperation;
  code: "contract_incomplete" | "conflicting_contracts";
  method: string;
  submitEndpoint: string;
  parameterFingerprint?: string;
  schemaFingerprint?: string;
}
export interface CatalogReadObservation { receipt: CatalogReadReceipt; facts: CatalogNormalizedFacts }
export interface ConnectionObservationManifest {
  connectionId: string;
  observationCycleId: string;
  requiredSourceKeys: string[];
  receipts: Array<{ sourceKey: string; complete: boolean; status: CatalogReadReceipt["status"] }>;
  complete: boolean;
}
export interface CatalogReadCollection {
  enabled: boolean;
  observations: CatalogReadObservation[];
  catalogOffers: ModelDescriptor[];
  keyVisibleModels: ModelDescriptor[];
  manifest: ConnectionObservationManifest;
  /** Slice 1 never publishes these observations or infers removals. */
  publication: "disabled";
}

export function catalogReadReason(code?: string, status?: number): CatalogReadReason {
  // Gateways often send exhausted balance as 401/403; the explicit code wins.
  if (status === 402 || /balance|quota|insufficient|credit|余额|额度|欠费/iu.test(code ?? "")) return "balance";
  if (status === 401 || status === 403 || /credential|permission|unauthor/u.test(code ?? "")) return "authentication";
  if (/incomplete|truncat/u.test(code ?? "")) return "incomplete";
  if (/invalid_response|invalid-response/u.test(code ?? "")) return "invalid-response";
  if (/unsupported/u.test(code ?? "")) return "unsupported";
  if (status === 404 || status === 405 || status === 415) return "unsupported";
  if (status !== undefined && status >= 500) return "upstream";
  return "network";
}

/** No public/account catalog can satisfy a Key's membership requirement. */
export function catalogConnectionManifest(connectionId: string, observationCycleId: string,
  observations: readonly CatalogReadObservation[], plan: readonly CatalogReadItemSpec[]): ConnectionObservationManifest {
  const required = [...new Map(plan.filter(spec => spec.requiredForMembership && spec.role === "key-membership" &&
    spec.authScope.kind === "connection-key" && spec.applyScope.connectionIds.includes(connectionId)).map(spec => [spec.sourceKey, spec])).values()];
  const receipts = required.map(spec => {
    const receipt = observations.find(row => isDeepStrictEqual(row.receipt.spec, spec) &&
      row.receipt.context.observationCycleId === observationCycleId)?.receipt;
    return { sourceKey: spec.sourceKey, complete: receipt?.status === "succeeded" && receipt.complete && receipt.freshness === "live",
      status: receipt?.status ?? "deferred" as const };
  });
  return { connectionId, observationCycleId, requiredSourceKeys: required.map(spec => spec.sourceKey), receipts,
    complete: required.length > 0 && receipts.every(receipt => receipt.complete) };
}

import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { SupplierConflictError, type JsonObject, type ProviderConnectionRecord, type SupplierRecord } from "./types.js";

export const CATALOG_PIPELINE_SCHEMA_VERSION = 1;
export const CATALOG_PIPELINE_MAX_BYTES = 32 * 1024 * 1024;
const MODE_SETTING = "supplierCatalogCheckMode";
export const catalogPipelineSettingKey = (supplierId: string): string => `supplierCatalogPipeline:${supplierId}`;

export interface CatalogPipelineSourceState {
  lastDispatchedSeq: number;
  lastAcceptedSeq: number;
}
/** App-owned queue/counter/history values live only inside this bounded namespace. */
export interface CatalogPipelineState {
  schemaVersion: 1;
  supplierId: string;
  identityEpoch: string;
  nextDispatchSeq: number;
  sources: Record<string, CatalogPipelineSourceState>;
  entries: Record<string, JsonObject>;
}
export type CatalogCheckMode = "off" | "upgrade" | "daily";
export interface CatalogObservationIdentity {
  supplierId: string;
  supplierIdentity: string;
  connections: Array<{ connectionId: string; identity: string }>;
}
export interface CatalogObservationReserve {
  identity: CatalogObservationIdentity;
  sourceKey: string;
  observationCycleId: string;
  expectedMode: CatalogCheckMode;
  /** Only an explicitly requested manual read may run while automatic mode is off. */
  manual?: boolean;
  /** Used only when no namespace exists. Old due/paused values are app-migrated. */
  initialEntries?: Record<string, JsonObject>;
  /** Rotate after explicit refresh/config invalidation, without resetting order. */
  invalidatePrevious?: boolean;
}
export interface CatalogObservationReservation {
  identity: CatalogObservationIdentity;
  sourceKey: string;
  observationCycleId: string;
  dispatchSeq: number;
  identityEpoch: string;
  expectedMode: CatalogCheckMode;
  manual?: boolean;
}
type SupplierGroup = SupplierRecord["catalog"]["groups"][number];
export const catalogObservationGroupIdentity = (group: Pick<SupplierGroup, "id" | "supplierGroupId">): string =>
  group.supplierGroupId === undefined ? `name:${group.id}` : `site-id:${group.supplierGroupId}`;
type GroupFields = Pick<SupplierGroup, "label" | "status" | "source" | "models">;
type GroupDetails = NonNullable<SupplierGroup["details"]>;
type OwnedGroupDetails = Omit<GroupDetails, "ledgerPrices">;
export type CatalogSupplierFields = Pick<SupplierRecord,
  "scanStatus" | "scanComplete" | "scannedAt" | "scanLastSuccessAt" | "scanError" | "scanErrorCode" | "scanRetryable">;
/** Deliberately excludes defaultModel, transport, templates, secrets and user values. */
export interface CatalogConnectionFields {
  modelCatalogModels?: unknown;
  scannedModelIds?: unknown;
  modelScanGroups?: unknown;
  modelScanStatus?: unknown;
  modelScanAttemptStatus?: unknown;
  modelScanComplete?: unknown;
  modelScanCheckedAt?: unknown;
  modelScanLastSuccessAt?: unknown;
  modelScanError?: unknown;
  modelScanErrorCode?: unknown;
  modelScanHttpStatus?: unknown;
  modelScanUpstreamErrorCode?: unknown;
  modelCatalogSource?: unknown;
}
export interface CatalogFieldPatch<T> {
  /** Compare exactly the fields being set; omitted values mean absent. */
  expected: Partial<T>;
  set: Partial<T>;
}
/** groupId is the namespaced catalogObservationGroupIdentity, never a label. */
export type CatalogGroupPatch =
  | { kind: "fields"; groupId: string; fields?: CatalogFieldPatch<GroupFields>; details?: CatalogFieldPatch<OwnedGroupDetails> }
  | { kind: "insert"; group: SupplierGroup }
  | { kind: "remove"; groupId: string; expected: SupplierGroup };
export interface CatalogConnectionPatch {
  connectionId: string;
  fields?: CatalogFieldPatch<CatalogConnectionFields>;
  connectorModels?: { expected: unknown; value: unknown };
  protocolModels?: { expected: unknown; value: unknown };
  /** A coherent guarded automatic contract, never a complete connection. */
  connectorContract?: { expected: unknown; value: unknown };
}
export interface CatalogStateEntryPatch {
  key: string;
  expected?: JsonObject;
  value?: JsonObject;
}
/** Short queue/lease transaction. No catalog fields and no observation accepted. */
export interface CatalogPipelineUpdate {
  identity: CatalogObservationIdentity;
  expectedMode: CatalogCheckMode;
  expectedIdentityEpoch?: string;
  initialEntries?: Record<string, JsonObject>;
  state: CatalogStateEntryPatch[];
  /** Response projection only; never limits the atomic transaction's state. */
  resultEntryKeys?: readonly string[];
  resultEntryPrefixes?: readonly string[];
}
export interface CatalogObservationCommit {
  reservation: CatalogObservationReservation;
  /** Rechecked inside the atomic barrier, including time spent behind saves. */
  leaseDeadline?: number;
  supplierFields?: CatalogFieldPatch<CatalogSupplierFields>;
  groups?: CatalogGroupPatch[];
  connections?: CatalogConnectionPatch[];
  state?: CatalogStateEntryPatch[];
  /** Response projection only; all state is still published atomically. */
  resultEntryKeys?: readonly string[];
  resultEntryPrefixes?: readonly string[];
}
export interface CatalogObservationView {
  supplier: SupplierRecord | undefined;
  connections: ReadonlyMap<string, ProviderConnectionRecord>;
  pipeline: unknown;
  mode: unknown;
}
export interface CatalogObservationPrepared {
  supplier?: SupplierRecord;
  connections: ProviderConnectionRecord[];
  pipeline: CatalogPipelineState;
}
const supplierFields = ["scanStatus", "scanComplete", "scannedAt", "scanLastSuccessAt", "scanError", "scanErrorCode", "scanRetryable"] as const;
const connectionFields = ["modelCatalogModels", "scannedModelIds", "modelScanGroups", "modelScanStatus", "modelScanAttemptStatus", "modelScanComplete", "modelScanCheckedAt", "modelScanLastSuccessAt", "modelScanError", "modelScanErrorCode", "modelScanHttpStatus", "modelScanUpstreamErrorCode", "modelCatalogSource"] as const;
const groupFields = ["label", "status", "source", "models"] as const;
const groupDetailFields = ["source", "description", "referencePrice", "supportedResolutions", "unsupportedResolutions", "nativeResolutions", "upscaledResolutions", "exclusiveResolutions", "imagePrices", "rateMultiplier", "imageRateMultiplier", "concurrencyLimit", "rpmLimit", "stale"] as const;
const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function fail(message: string): never { throw new SupplierConflictError(message); }
const clone = <T>(value: T): T => structuredClone(value);
/** Changed maps are copied; untouched JSON values remain repository-owned.
 * Every entry written by a patch is independently cloned before publication. */
const copyPipeline = (value: CatalogPipelineState): CatalogPipelineState => ({ ...value, sources: { ...value.sources }, entries: { ...value.entries } });
type PipelineValidator = (value: unknown, supplierId: string) => asserts value is CatalogPipelineState;
const copyValidatedPipeline = (value: CatalogPipelineState, validator: PipelineValidator): CatalogPipelineState =>
  validator === assertCatalogPipelineState ? clone(value) : copyPipeline(value);
export function catalogSupplierIdentity(supplier: SupplierRecord): string {
  return hash([supplier.id, supplier.supplierKey, supplier.siteUrl, supplier.apiUrl, supplier.kind,
    supplier.state?.sourceId, supplier.state?.fingerprint, supplier.state?.visibility, supplier.state?.siteLogin, supplier.state?.scanId]);
}
export function catalogConnectionIdentity(connection: ProviderConnectionRecord): string {
  const config = { ...connection.config };
  for (const key of connectionFields) delete config[key];
  for (const key of ["connector", "modelProtocolTemplate"]) {
    if (config[key] && typeof config[key] === "object") {
      const remaining = { ...object(config[key]) }; delete remaining.models; config[key] = remaining;
    }
  }
  // Some legacy dedicated manual loaders advance only checkedAt. Retain that
  // generation guard even though a successful owned publication may update it.
  return hash([connection.id, connection.provider, connection.encryptedSecret, config, connection.config.modelScanCheckedAt]);
}
export function catalogObservationIdentity(supplier: SupplierRecord, connections: readonly ProviderConnectionRecord[] = []): CatalogObservationIdentity {
  return { supplierId: supplier.id, supplierIdentity: catalogSupplierIdentity(supplier),
    connections: connections.map(row => ({ connectionId: row.id, identity: catalogConnectionIdentity(row) })) };
}
/** Namespace anchor only; legacy connections do not acquire a stored supplier. */
export function catalogLegacyObservationOwner(connection: ProviderConnectionRecord): SupplierRecord {
  const base = new URL(String(connection.config.baseUrl));
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash ||
    typeof connection.config.supplierId === "string") fail("独立连接来源无效");
  return { id: `connection:${connection.id}`, name: "独立连接", supplierKey: "legacy", siteUrl: base.origin, apiUrl: base.href,
    kind: "auto", scanStatus: "unscanned", catalog: { groups: [] }, createdAt: connection.createdAt, updatedAt: connection.updatedAt };
}
function assertIdentity(view: CatalogObservationView, identity: CatalogObservationIdentity, mode: CatalogCheckMode, allowOff = false): SupplierRecord {
  const legacy = !view.supplier && identity.connections.length === 1 && identity.supplierId === `connection:${identity.connections[0]!.connectionId}`;
  const anchor = legacy ? view.connections.get(identity.connections[0]!.connectionId) : undefined;
  const supplier = view.supplier ?? (anchor ? catalogLegacyObservationOwner(anchor) : undefined);
  if (!supplier || supplier.id !== identity.supplierId || catalogSupplierIdentity(supplier) !== identity.supplierIdentity || supplier.state?.visibility === "deleted")
    fail("目录来源已改变，旧观察已丢弃");
  if ((view.mode ?? "daily") !== mode || mode === "off" && !allowOff) fail("自动检查设置已改变，旧观察已丢弃");
  const ids = new Set<string>();
  for (const guard of identity.connections) {
    const connection = view.connections.get(guard.connectionId);
    if (ids.has(guard.connectionId) || !connection || !legacy && connection.config.supplierId !== supplier.id || connection?.config.supplierArchived === true ||
      catalogConnectionIdentity(connection) !== guard.identity || supplier.state && connection.config.supplierSourceId !== supplier.state.sourceId)
      fail("目录 Key 或分组身份已改变，旧观察已丢弃");
    ids.add(guard.connectionId);
  }
  return supplier;
}
function applyStateEntries(pipeline: CatalogPipelineState, patches: readonly CatalogStateEntryPatch[]): void {
  const touched = new Set<string>();
  for (const patch of patches) {
    if (!patch.key || touched.has(patch.key) || !isDeepStrictEqual(Object.hasOwn(pipeline.entries, patch.key) ? pipeline.entries[patch.key] : undefined, patch.expected))
      fail("目录观察任务或计数已改变，未发布任何更改");
    touched.add(patch.key);
    if (patch.value === undefined) delete pipeline.entries[patch.key];
    else Object.defineProperty(pipeline.entries, patch.key, { value: clone(patch.value), enumerable: true, configurable: true, writable: true });
  }
}
export function prepareCatalogPipelineUpdate(view: CatalogObservationView, input: CatalogPipelineUpdate,
  validateCurrent: PipelineValidator = assertCatalogPipelineState): CatalogPipelineState {
  assertIdentity(view, input.identity, input.expectedMode, true);
  if (view.pipeline !== undefined) validateCurrent(view.pipeline, input.identity.supplierId);
  const pipeline: CatalogPipelineState = view.pipeline === undefined
    ? { schemaVersion: 1, supplierId: input.identity.supplierId, identityEpoch: randomUUID(), nextDispatchSeq: 1, sources: {}, entries: clone(input.initialEntries ?? {}) }
    : copyValidatedPipeline(view.pipeline as CatalogPipelineState, validateCurrent);
  if (input.expectedIdentityEpoch !== undefined && input.expectedIdentityEpoch !== pipeline.identityEpoch) fail("目录观察身份代次已改变");
  applyStateEntries(pipeline, input.state);
  assertCatalogPipelineState(pipeline, input.identity.supplierId);
  return pipeline;
}
export function assertCatalogPipelineState(value: unknown, supplierId: string): asserts value is CatalogPipelineState {
  const state = object(value);
  if (state.schemaVersion !== 1 || state.supplierId !== supplierId || typeof state.identityEpoch !== "string" || !state.identityEpoch ||
    !Number.isSafeInteger(state.nextDispatchSeq) || Number(state.nextDispatchSeq) < 1 || !state.sources || !state.entries ||
    Array.isArray(state.sources) || Array.isArray(state.entries) || typeof state.sources !== "object" || typeof state.entries !== "object")
    fail("目录观察状态格式无效，未发布任何更改");
  for (const source of Object.values(state.sources as object)) {
    const row = object(source);
    if (!Number.isSafeInteger(row.lastDispatchedSeq) || !Number.isSafeInteger(row.lastAcceptedSeq) || Number(row.lastAcceptedSeq) < 0 ||
      Number(row.lastAcceptedSeq) > Number(row.lastDispatchedSeq) || Number(row.lastDispatchedSeq) >= Number(state.nextDispatchSeq))
      fail("目录观察序号无效，未发布任何更改");
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > CATALOG_PIPELINE_MAX_BYTES) fail("目录观察状态超过体积保护上限，未发布任何更改");
}
export function prepareCatalogReservation(view: CatalogObservationView, input: CatalogObservationReserve,
  validateCurrent: PipelineValidator = assertCatalogPipelineState): { pipeline: CatalogPipelineState; reservation: CatalogObservationReservation } {
  assertIdentity(view, input.identity, input.expectedMode, input.manual === true);
  if (!input.sourceKey || !input.observationCycleId) fail("目录观察来源或周期为空");
  if (view.pipeline !== undefined) validateCurrent(view.pipeline, input.identity.supplierId);
  const pipeline: CatalogPipelineState = view.pipeline === undefined
    ? { schemaVersion: 1, supplierId: input.identity.supplierId, identityEpoch: randomUUID(), nextDispatchSeq: 1, sources: {}, entries: clone(input.initialEntries ?? {}) }
    : copyValidatedPipeline(view.pipeline as CatalogPipelineState, validateCurrent);
  if (input.invalidatePrevious) pipeline.identityEpoch = randomUUID();
  const dispatchSeq = pipeline.nextDispatchSeq++;
  if (!Number.isSafeInteger(pipeline.nextDispatchSeq)) fail("目录观察序号已达到上限");
  const previous = Object.hasOwn(pipeline.sources, input.sourceKey) ? pipeline.sources[input.sourceKey] : undefined;
  Object.defineProperty(pipeline.sources, input.sourceKey, { value: { lastDispatchedSeq: dispatchSeq, lastAcceptedSeq: previous?.lastAcceptedSeq ?? 0 }, enumerable: true, configurable: true, writable: true });
  assertCatalogPipelineState(pipeline, input.identity.supplierId);
  return { pipeline, reservation: { identity: clone(input.identity), sourceKey: input.sourceKey, observationCycleId: input.observationCycleId,
    dispatchSeq, identityEpoch: pipeline.identityEpoch, expectedMode: input.expectedMode, ...(input.manual ? { manual: true } : {}) } };
}
function applyFields(current: JsonObject, patch: CatalogFieldPatch<object>, allowed: readonly string[]): JsonObject {
  const keys = Object.keys(patch.set);
  if (Object.keys(patch.expected).some(key => !keys.includes(key)) || keys.some(key => !allowed.includes(key))) fail("目录补丁包含非所有权字段");
  for (const key of keys) if (!isDeepStrictEqual(current[key], object(patch.expected)[key])) fail("目录目标字段已改变，旧观察已丢弃");
  const next = { ...current };
  for (const key of keys) {
    const value = object(patch.set)[key];
    if (value === undefined) delete next[key]; else Object.defineProperty(next, key, { value: clone(value), enumerable: true, configurable: true, writable: true });
  }
  return next;
}
const stableGroupId = catalogObservationGroupIdentity;
export function prepareCatalogObservation(view: CatalogObservationView, input: CatalogObservationCommit,
  validateCurrent: PipelineValidator = assertCatalogPipelineState): CatalogObservationPrepared {
  if (input.leaseDeadline !== undefined && (!Number.isFinite(input.leaseDeadline) || Date.now() >= input.leaseDeadline))
    fail("目录任务租约已失效，未发布任何更改");
  const token = input.reservation;
  const current = assertIdentity(view, token.identity, token.expectedMode, token.manual === true);
  validateCurrent(view.pipeline, current.id);
  const pipeline = copyValidatedPipeline(view.pipeline, validateCurrent);
  const source = Object.hasOwn(pipeline.sources, token.sourceKey) ? pipeline.sources[token.sourceKey] : undefined;
  if (pipeline.identityEpoch !== token.identityEpoch || !source || source.lastDispatchedSeq !== token.dispatchSeq || source.lastAcceptedSeq >= token.dispatchSeq)
    fail("目录观察已被更新的请求替代");
  let supplier = validateCurrent === assertCatalogPipelineState ? clone(current) : current;
  let supplierChanged = false;
  if (!view.supplier && (input.supplierFields || input.groups?.length)) fail("独立连接不能发布供应商补丁");
  if (input.supplierFields) { supplier = applyFields(supplier as unknown as JsonObject, input.supplierFields, supplierFields) as unknown as SupplierRecord; supplierChanged = true; }
  const touchedGroups = new Set<string>();
  if (input.groups?.length) supplier = { ...supplier, catalog: { ...supplier.catalog, groups: [...supplier.catalog.groups] } };
  for (const patch of input.groups ?? []) {
    const id = patch.kind === "insert" ? stableGroupId(patch.group) : patch.groupId;
    if (!id || touchedGroups.has(id)) fail("目录分组补丁身份重复");
    touchedGroups.add(id);
    const matches = supplier.catalog.groups.filter(group => stableGroupId(group) === id);
    if (matches.length > 1) fail("目录分组身份不唯一");
    const group = matches[0];
    if (patch.kind === "insert") {
      if (group || supplier.catalog.groups.some(row => row.id === patch.group.id) || patch.group.details?.ledgerPrices?.length) fail("目录分组已存在或包含非目录证据");
      supplier.catalog.groups.push(clone(patch.group));
    } else if (patch.kind === "remove") {
      if (!group || !isDeepStrictEqual(group, patch.expected)) fail("目录分组已改变，不能删除旧快照");
      // Historical measured evidence must survive directory membership removal.
      if (group.details?.ledgerPrices?.length) fail("带实测证据的分组须归档保留，不能直接删除");
      supplier.catalog.groups = supplier.catalog.groups.filter(row => row !== group);
    } else {
      if (!group) fail("目录目标分组已不存在");
      const nextGroup = patch.fields ? applyFields(group as unknown as JsonObject, patch.fields, groupFields) as unknown as SupplierGroup : { ...group };
      if (patch.details) {
        const details = applyFields(object(group.details), patch.details, groupDetailFields);
        if (details.source !== "model-plaza" && details.source !== "key-groups") fail("目录分组详情缺少来源");
        nextGroup.details = details as unknown as GroupDetails;
      }
      supplier.catalog.groups[supplier.catalog.groups.indexOf(group)] = nextGroup;
    }
    supplierChanged = true;
  }
  const connections: ProviderConnectionRecord[] = [], touchedConnections = new Set<string>();
  for (const patch of input.connections ?? []) {
    const row = view.connections.get(patch.connectionId);
    if (!row || touchedConnections.has(row.id) || !token.identity.connections.some(guard => guard.connectionId === row.id)) fail("目录补丁缺少连接身份栅栏");
    touchedConnections.add(row.id);
    const next = validateCurrent === assertCatalogPipelineState ? clone(row) : { ...row, config: { ...row.config } };
    if (patch.fields) next.config = applyFields(next.config, patch.fields, connectionFields);
    if (patch.connectorContract) {
      if (!isDeepStrictEqual(row.config.connector, patch.connectorContract.expected)) fail("目录调用契约已改变，旧观察已丢弃");
      if (patch.connectorContract.value === undefined) delete next.config.connector;
      else next.config.connector = clone(patch.connectorContract.value);
    }
    for (const [name, models] of [["connector", patch.connectorModels], ["modelProtocolTemplate", patch.protocolModels]] as const) {
      if (!models) continue;
      const parent = object(next.config[name]);
      if (!isDeepStrictEqual(parent.models, models.expected)) fail("目录型号契约已改变，旧观察已丢弃");
      next.config[name] = applyFields(parent, { expected: { models: models.expected }, set: { models: models.value } }, ["models"]);
    }
    connections.push(next);
  }
  applyStateEntries(pipeline, input.state ?? []);
  Object.defineProperty(pipeline.sources, token.sourceKey, { value: { ...source, lastAcceptedSeq: token.dispatchSeq },
    enumerable: true, configurable: true, writable: true });
  assertCatalogPipelineState(pipeline, current.id);
  return { supplier: supplierChanged ? supplier : undefined, connections, pipeline };
}
export const catalogObservationModeSetting = MODE_SETTING;

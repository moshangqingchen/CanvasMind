import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ModelDescriptor, ProviderOperation } from "@super-canvas/providers";
import type { CatalogReadObservation } from "./catalog-read-contracts";

export const CATALOG_MEMBERSHIP_DAY_MS = 24 * 60 * 60 * 1000;
export const CATALOG_MEMBERSHIP_CONFIRMATION_CYCLES = 3;
export const CATALOG_MEMBERSHIP_DROP_RATIO = 0.3;
export const CATALOG_MEMBERSHIP_MIN_DROP = 10;
export const CATALOG_MEMBERSHIP_MIN_BASELINE = 20;

export interface CatalogMembershipBaseline {
  modelIds: string[];
  fingerprint: string;
  checkedAt: string;
  observationCycleId: string;
}
export interface CatalogMembershipCandidate extends CatalogMembershipBaseline {
  version: string;
  models: ModelDescriptor[];
  countedCycles: string[];
  lastCountedAt?: string;
}
export interface CatalogMembershipSourceState {
  sourceKey: string;
  identity: string;
  acceptedModels: ModelDescriptor[];
  baseline?: CatalogMembershipBaseline;
  candidate?: CatalogMembershipCandidate;
  /** A namespace rotation cannot turn an old receipt into current coverage. */
  lastIdentityEpoch: string;
  lastDispatchSeq: number;
  lastObservationCycleId: string;
  lastObservedAt: string;
  lastOutcome: "accepted" | "candidate" | "incomplete";
}
export interface HistoricalCatalogModel {
  modelId: string;
  descriptor: ModelDescriptor;
  identityEpoch: string;
  sourceKeys: string[];
  unavailableAt: string;
  observationCycleId: string;
}
export interface CatalogInventoryState {
  schemaVersion: 1;
  connectionId: string;
  identityEpoch: string;
  observedAt: string;
  sources: Record<string, CatalogMembershipSourceState>;
  visibleModels: ModelDescriptor[];
  historicalModels: HistoricalCatalogModel[];
}
export interface CatalogInventoryReductionInput {
  connectionId: string;
  identityEpoch: string;
  observationCycleId: string;
  observedAt: string;
  mode: "daily" | "upgrade" | "manual";
  requiredSourceKeys: readonly string[];
  observations: readonly CatalogReadObservation[];
  /** Only a terminal connection snapshot can classify a missing read as incomplete. */
  finalizeCycle?: boolean;
  /** Initial display only: legacy descriptors never become source baselines. */
  initialModels?: readonly ModelDescriptor[];
  /** The collector must explicitly attest each strictly validated partial row. */
  validatedPartialModelIds?: Readonly<Record<string, readonly string[]>>;
  manualConfirmation?: { sourceKey: string; candidateVersion: string };
}
export interface CatalogInventoryReduction {
  state: CatalogInventoryState;
  visibleModels: ModelDescriptor[];
  historicalModels: HistoricalCatalogModel[];
  addedIds: string[];
  removedIds: string[];
  manifestComplete: boolean;
  sourceResults: Array<{ sourceKey: string; outcome: "accepted" | "candidate" | "incomplete" | "ignored" | "confirmed" }>;
  manualConfirmation: "absent" | "accepted" | "rejected";
}

const operations = new Set<ProviderOperation>(["image.generate", "image.edit", "video.generate", "video.image-to-video", "music.generate"]);
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const instant = (value: string): number => Date.parse(value);
const validInstant = (value: string): boolean => Number.isFinite(instant(value));
const ids = (models: readonly ModelDescriptor[]): string[] => models.map(model => model.id).sort();
const fingerprint = (models: readonly ModelDescriptor[]): string => hash(ids(models));
const clone = <T>(value: T): T => structuredClone(value);
const own = <T>(value: Record<string, T>, key: string): T | undefined => Object.hasOwn(value, key) ? value[key] : undefined;
const put = <T>(value: Record<string, T>, key: string, row: T): void => {
  Object.defineProperty(value, key, { value: row, writable: true, enumerable: true, configurable: true });
};

function jsonSafe(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  seen.add(value);
  const result = Array.isArray(value) ? value.every(item => jsonSafe(item, seen))
    : Object.values(value).every(item => item === undefined || jsonSafe(item, seen));
  seen.delete(value);
  return result;
}

/** Reject malformed and duplicate rows as membership evidence, including partial reads. */
export function catalogInventoryModelsValid(models: readonly ModelDescriptor[]): boolean {
  const found = new Set<string>();
  return models.every(model => {
    if (!model || typeof model.id !== "string" || !model.id.trim() || typeof model.name !== "string" ||
      !Array.isArray(model.operations) || !model.operations.every(operation => operations.has(operation)) ||
      found.has(model.id) || !jsonSafe(model)) return false;
    found.add(model.id); return true;
  });
}

/** Count missing baseline IDs; newly discovered IDs cannot offset a mass withdrawal. */
export function catalogMembershipSuspiciousDrop(baselineIds: readonly string[], nextIds: readonly string[]): boolean {
  const current = new Set(nextIds), missing = baselineIds.filter(id => !current.has(id)).length;
  return baselineIds.length > 0 && (nextIds.length === 0 ||
    baselineIds.length >= CATALOG_MEMBERSHIP_MIN_BASELINE && missing >= CATALOG_MEMBERSHIP_MIN_DROP &&
    missing / baselineIds.length >= CATALOG_MEMBERSHIP_DROP_RATIO);
}

function sourceIdentity(observation: CatalogReadObservation, connectionId: string): string {
  const { spec } = observation.receipt;
  return hash({ sourceKey: spec.sourceKey, entryId: spec.entryId, sourceUrl: spec.sourceUrl, parserVersion: spec.parserVersion,
    authScope: spec.authScope, supplierId: spec.applyScope.supplierId, supplierSourceId: spec.applyScope.supplierSourceId,
    groupIdentity: spec.applyScope.groupIdentity ?? null, modelId: spec.applyScope.modelId ?? null, connectionId });
}
function applicable(observation: CatalogReadObservation, input: CatalogInventoryReductionInput): boolean {
  const { receipt } = observation, { spec, context } = receipt;
  return spec.role === "key-membership" && spec.authScope.kind === "connection-key" &&
    spec.authScope.principalRef === input.connectionId && spec.applyScope.connectionIds.includes(input.connectionId) &&
    context.identityEpoch === input.identityEpoch && context.observationCycleId === input.observationCycleId &&
    Number.isSafeInteger(context.dispatchSeq) && context.dispatchSeq > 0 && validInstant(receipt.checkedAt) &&
    instant(receipt.checkedAt) <= instant(input.observedAt);
}
function unionModels(...lists: ReadonlyArray<readonly ModelDescriptor[]>): ModelDescriptor[] {
  const result = new Map<string, ModelDescriptor>();
  for (const list of lists) for (const model of list) if (!result.has(model.id)) result.set(model.id, clone(model));
  return [...result.values()];
}
function baseline(models: readonly ModelDescriptor[], checkedAt: string, observationCycleId: string): CatalogMembershipBaseline {
  return { modelIds: ids(models), fingerprint: fingerprint(models), checkedAt, observationCycleId };
}
function sourceComplete(observation: CatalogReadObservation): boolean {
  const { receipt } = observation;
  return receipt.status === "succeeded" && receipt.complete && receipt.freshness === "live" &&
    receipt.reason === undefined && catalogInventoryModelsValid(observation.facts.models) &&
    receipt.coverage?.domain === "key-list" && receipt.coverage.exhaustive &&
    receipt.coverage.modelIds.length === observation.facts.models.length &&
    hash([...receipt.coverage.modelIds].sort()) === hash(ids(observation.facts.models));
}

/** Membership only. Contract/price owners project their fields separately. No I/O or mutation. */
export function reduceCatalogInventory(previous: CatalogInventoryState | undefined,
  input: CatalogInventoryReductionInput): CatalogInventoryReduction {
  if (!validInstant(input.observedAt)) throw new Error("目录成员观察时间无效");
  if (previous && previous.connectionId !== input.connectionId) throw new Error("目录成员连接身份不匹配");
  if (previous && previous.identityEpoch === input.identityEpoch && instant(input.observedAt) < instant(previous.observedAt))
    return { state: clone(previous), visibleModels: clone(previous.visibleModels), historicalModels: clone(previous.historicalModels),
      addedIds: [], removedIds: [], manifestComplete: false, sourceResults: [], manualConfirmation: input.manualConfirmation ? "rejected" : "absent" };
  const oldModels = previous?.visibleModels ?? input.initialModels ?? [];
  if (!catalogInventoryModelsValid(oldModels)) throw new Error("已保存目录成员结构无效");
  const sameIdentity = previous?.identityEpoch === input.identityEpoch;
  const state: CatalogInventoryState = { schemaVersion: 1, connectionId: input.connectionId, identityEpoch: input.identityEpoch,
    observedAt: input.observedAt, sources: clone(previous?.sources ?? {}), visibleModels: clone([...oldModels]),
    historicalModels: clone(previous?.historicalModels ?? []) };
  for (const source of Object.values(state.sources)) {
    // Old slice-2 fixture states can be migrated from their owning state epoch.
    source.lastIdentityEpoch ??= previous!.identityEpoch;
    if (!sameIdentity && source.candidate) {
      source.candidate.version = hash({ previousVersion: source.candidate.version, identityEpoch: input.identityEpoch });
      source.candidate.countedCycles = []; delete source.candidate.lastCountedAt;
    }
  }
  const sourceResults: CatalogInventoryReduction["sourceResults"] = [];
  const active = new Set(input.requiredSourceKeys), attempted = new Set<string>();
  let manualConfirmation: CatalogInventoryReduction["manualConfirmation"] = input.manualConfirmation ? "rejected" : "absent";
  let manifestCycle = input.observationCycleId;
  // One logical source has at most one usable receipt. Conflicting duplicates fail closed.
  const grouped = new Map<string, CatalogReadObservation[]>();
  for (const observation of input.observations) {
    if (!applicable(observation, input)) continue;
    active.add(observation.receipt.spec.sourceKey);
    const list = grouped.get(observation.receipt.spec.sourceKey) ?? [];
    list.push(observation); grouped.set(observation.receipt.spec.sourceKey, list);
  }
  for (const [sourceKey, rows] of grouped) {
    const observation = rows.reduce((a, b) => a.receipt.context.dispatchSeq >= b.receipt.context.dispatchSeq ? a : b);
    const { receipt, facts } = observation, identity = sourceIdentity(observation, input.connectionId);
    const old = own(state.sources, sourceKey), matching = old?.identity === identity;
    if (matching && (receipt.context.dispatchSeq <= old.lastDispatchSeq || instant(receipt.checkedAt) < instant(old.lastObservedAt))) {
      sourceResults.push({ sourceKey, outcome: "ignored" }); continue;
    }
    attempted.add(sourceKey);
    const source: CatalogMembershipSourceState = { sourceKey, identity,
      acceptedModels: matching ? clone(old.acceptedModels) : [], ...(matching && old.baseline ? { baseline: clone(old.baseline) } : {}),
      ...(matching && old.candidate ? { candidate: clone(old.candidate) } : {}), lastDispatchSeq: receipt.context.dispatchSeq,
      lastIdentityEpoch: input.identityEpoch,
      lastObservationCycleId: input.observationCycleId, lastObservedAt: receipt.checkedAt, lastOutcome: "incomplete" };
    const duplicateConflict = rows.some(row => !isDeepStrictEqual(row, observation));
    const complete = !duplicateConflict && sourceComplete(observation);
    if (!complete) {
      delete source.candidate;
      const validated = new Set(input.validatedPartialModelIds?.[sourceKey] ?? []);
      if (!duplicateConflict && receipt.freshness === "live" && receipt.reason === "incomplete" &&
        catalogInventoryModelsValid(facts.models))
        source.acceptedModels = unionModels(source.acceptedModels, facts.models.filter(model => validated.has(model.id)));
    } else if (source.baseline && catalogMembershipSuspiciousDrop(source.baseline.modelIds, ids(facts.models))) {
      const nextFingerprint = fingerprint(facts.models);
      let candidate = source.candidate;
      if (!candidate || candidate.fingerprint !== nextFingerprint) candidate = {
        ...baseline(facts.models, receipt.checkedAt, input.observationCycleId), models: clone(facts.models),
        version: hash({ identity, identityEpoch: input.identityEpoch, fingerprint: nextFingerprint, dispatchSeq: receipt.context.dispatchSeq }), countedCycles: [],
      };
      candidate.checkedAt = receipt.checkedAt; candidate.observationCycleId = input.observationCycleId;
      if (input.mode === "daily" && !candidate.countedCycles.includes(input.observationCycleId) &&
        (!candidate.lastCountedAt || instant(receipt.checkedAt) - instant(candidate.lastCountedAt) >= CATALOG_MEMBERSHIP_DAY_MS)) {
        candidate.countedCycles.push(input.observationCycleId); candidate.lastCountedAt = receipt.checkedAt;
      }
      // Only positive membership can advance while its withdrawal candidate is held.
      source.acceptedModels = unionModels(source.acceptedModels, facts.models);
      if (candidate.countedCycles.length >= CATALOG_MEMBERSHIP_CONFIRMATION_CYCLES) {
        source.acceptedModels = clone(facts.models); source.baseline = baseline(facts.models, receipt.checkedAt, input.observationCycleId);
        delete source.candidate; source.lastOutcome = "accepted";
      } else { source.candidate = candidate; source.lastOutcome = "candidate"; }
    } else {
      source.acceptedModels = clone(facts.models); source.baseline = baseline(facts.models, receipt.checkedAt, input.observationCycleId);
      delete source.candidate; source.lastOutcome = "accepted";
    }
    put(state.sources, sourceKey, source); sourceResults.push({ sourceKey, outcome: source.lastOutcome });
  }
  // A genuinely newer incomplete daily snapshot breaks continuity even if no receipt arrived.
  if (input.finalizeCycle && input.mode !== "manual") for (const sourceKey of input.requiredSourceKeys) {
    const source = own(state.sources, sourceKey);
    if (!attempted.has(sourceKey) && !grouped.has(sourceKey) && source &&
      source.lastObservationCycleId !== input.observationCycleId && instant(input.observedAt) > instant(source.lastObservedAt)) {
      delete source.candidate; source.lastOutcome = "incomplete";
      source.lastObservationCycleId = input.observationCycleId; source.lastObservedAt = input.observedAt;
      sourceResults.push({ sourceKey, outcome: "incomplete" });
    }
  }
  if (input.manualConfirmation && input.mode === "manual" && sameIdentity) {
    const { sourceKey, candidateVersion } = input.manualConfirmation, source = own(state.sources, sourceKey);
    if (source?.candidate?.version === candidateVersion && source.lastOutcome === "candidate" &&
      source.lastIdentityEpoch === input.identityEpoch && active.has(sourceKey)) {
      const candidate = source.candidate;
      source.acceptedModels = clone(candidate.models);
      source.baseline = { modelIds: clone(candidate.modelIds), fingerprint: candidate.fingerprint,
        checkedAt: candidate.checkedAt, observationCycleId: candidate.observationCycleId };
      manifestCycle = candidate.observationCycleId; source.lastOutcome = "accepted"; delete source.candidate;
      manualConfirmation = "accepted"; sourceResults.push({ sourceKey, outcome: "confirmed" });
    }
  }
  const required = [...new Set(input.requiredSourceKeys)];
  const manifestComplete = required.length > 0 && required.every(key => {
    const source = own(state.sources, key);
    return source?.lastOutcome === "accepted" && source.lastIdentityEpoch === input.identityEpoch &&
      source.lastObservationCycleId === manifestCycle && !source.candidate;
  });
  const accepted = unionModels(...[...active].sort().flatMap(key => {
    const source = own(state.sources, key); return source ? [source.acceptedModels] : [];
  }));
  // Existing descriptors retain contract, parameter and price fields owned by other reducers.
  const visibleIds = new Set(accepted.map(model => model.id));
  const keep = manifestComplete ? oldModels.filter(model => visibleIds.has(model.id)) : oldModels;
  state.visibleModels = unionModels(keep, accepted);
  const current = new Set(state.visibleModels.map(model => model.id)), oldIds = new Set(oldModels.map(model => model.id));
  const removedIds = oldModels.filter(model => !current.has(model.id)).map(model => model.id);
  for (const model of oldModels) if (!current.has(model.id)) {
    const row: HistoricalCatalogModel = { modelId: model.id, descriptor: clone(model), identityEpoch: input.identityEpoch,
      sourceKeys: [...active].filter(key => own(previous?.sources ?? {}, key)?.acceptedModels.some(old => old.id === model.id)),
      unavailableAt: input.observedAt, observationCycleId: manifestCycle };
    state.historicalModels = state.historicalModels.filter(old => old.modelId !== model.id || old.identityEpoch !== input.identityEpoch);
    state.historicalModels.push(row);
  }
  return { state, visibleModels: clone(state.visibleModels), historicalModels: clone(state.historicalModels),
    addedIds: state.visibleModels.filter(model => !oldIds.has(model.id)).map(model => model.id), removedIds,
    manifestComplete, sourceResults, manualConfirmation };
}

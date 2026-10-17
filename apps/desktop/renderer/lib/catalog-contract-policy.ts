import { createHash } from "node:crypto";
import type { DocumentedModelInterface, ModelDescriptor, ModelParameterDescriptor, ProviderOperation,
  RestConnectorConfig, RestModelConnectorOverride, RestRequestDefinition } from "@super-canvas/providers";
import { applyUserImageSizePresets } from "@super-canvas/providers/image-size-presets";
import type { CatalogContractDiagnostic } from "./catalog-read-contracts";

export type CatalogContractOwner = "automatic" | "manual" | "paid-test" | "app-preset";
export type CatalogContractPresence = "present" | "unknown" | "explicit-remove";
export interface CatalogContractScope {
  origin: string;
  sourceId: string;
  groupIdentity: string;
  modelId: string;
  operation: ProviderOperation;
}
export interface ContractIdentity extends CatalogContractScope {
  protocol: string;
  method: string;
  submit: string;
  poll?: string;
  output?: string;
  schemaFingerprint: string;
  wireSchemaRevision?: string;
}
/** A complete operation bundle, never a saved connection or a document body. */
export interface CatalogContractBundle {
  model: ModelDescriptor;
  connector: RestConnectorConfig;
}
export interface CatalogAcceptedContract {
  identity: ContractIdentity;
  sourceKey: string;
  owner: Exclude<CatalogContractOwner, "app-preset">;
  checkedAt: string;
  bundle: CatalogContractBundle;
}
export interface CatalogContractSlot {
  identity: ContractIdentity;
  sourceKey: string;
  presence: CatalogContractPresence;
  checkedAt: string;
  accepted?: CatalogAcceptedContract;
  /** Earlier contracts are view-only; never a fallback for a new identity. */
  history: CatalogAcceptedContract[];
  blocked: boolean;
  reason?: "incomplete" | "removed" | "conflicting-source";
}
export interface CatalogContractState {
  schemaVersion: 1;
  slots: Record<string, CatalogContractSlot>;
}
export interface CatalogContractObservation {
  identity: ContractIdentity;
  sourceKey: string;
  owner: CatalogContractOwner;
  presence: CatalogContractPresence;
  complete: boolean;
  checkedAt: string;
  bundle?: CatalogContractBundle;
}
export interface CatalogContractProjectionOptions {
  catalogContracts: CatalogContractState;
  sourceId: string;
  groupIdentity: string;
}
export const CATALOG_CONTRACT_PENDING_REASON = "当前调用契约尚未完整读取；上次契约仅供历史查看";
const operations = new Set<ProviderOperation>(["image.generate", "image.edit", "video.generate", "video.image-to-video", "music.generate"]);
const own = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!own(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const sameIdentity = (a: ContractIdentity, b: ContractIdentity) => digest(a) === digest(b);

/** Query values, embedded credentials and cross-origin endpoints are not contract evidence. */
export function catalogContractEndpoint(origin: string, endpoint: string): string {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/")
    throw new Error("Invalid catalog contract origin");
  if (!endpoint || endpoint.startsWith("//") || /\\|%(?:2e|2f|5c)/iu.test(endpoint) || endpoint.split("/").includes(".."))
    throw new Error("Invalid catalog contract endpoint");
  const endpointUrl = new URL(endpoint, base);
  if (endpointUrl.origin !== base.origin || endpointUrl.username || endpointUrl.password || endpointUrl.search || endpointUrl.hash)
    throw new Error("Invalid catalog contract endpoint");
  // URL parsing encodes template braces. Keep the wire placeholder stable.
  return `${endpointUrl.origin}${endpointUrl.pathname.replace(/%7B/giu, "{").replace(/%7D/giu, "}")}`;
}

export function catalogContractSlotKey(scope: CatalogContractScope): string {
  return digest({ origin: new URL(scope.origin).origin, sourceId: scope.sourceId, groupIdentity: scope.groupIdentity,
    modelId: scope.modelId, operation: scope.operation });
}

function effectiveConnector(connector: RestConnectorConfig, modelId: string, operation: ProviderOperation): RestConnectorConfig {
  const model = connector.modelOverrides?.[modelId];
  const layers = [connector, connector.operationOverrides?.[operation], model, model?.operationOverrides?.[operation]];
  const merged = Object.assign({}, ...layers.filter(Boolean)) as RestConnectorConfig;
  // Operation inheritance is resolved here, not after the contract guard.
  delete merged.modelOverrides; delete merged.operationOverrides; delete merged.models;
  delete merged.test; delete merged.cancel; delete merged.webhook;
  return structuredClone(merged);
}

function semanticParameter(parameter: ModelParameterDescriptor) {
  const wire = { ...parameter };
  delete (wire as Partial<ModelParameterDescriptor>).label; delete wire.description; delete wire.placeholder;
  return { ...wire, ...(parameter.options ? { options: parameter.options.map(({ value }) => ({ value })) } : {}) };
}

/** Adapter-normalized schema, not a documentation hash or sampling timestamp. */
export function catalogContractSchemaFingerprint(bundle: CatalogContractBundle): string {
  return digest({ operations: bundle.model.operations, inputKinds: bundle.model.inputKinds, outputKinds: bundle.model.outputKinds,
    parameters: bundle.model.parameters?.map(semanticParameter), limits: bundle.model.limits,
    connector: bundle.connector });
}

/** The compiler's normalized parameter domain, independent of document layout. */
export function catalogContractParameterFingerprint(model: Pick<ModelDescriptor, "parameters">, wireRequiredFields?: readonly string[]): string {
  return digest({ parameters: [...(model.parameters ?? [])].sort((a, b) => a.key.localeCompare(b.key)).map(semanticParameter),
    required: [...new Set(wireRequiredFields ?? ["model", "prompt", ...(model.parameters ?? []).filter(parameter => parameter.required).map(parameter => parameter.key)])].sort() });
}

export function catalogContractFromDocumented(scope: CatalogContractScope, protocol: string,
  binding: DocumentedModelInterface, wireSchemaRevision?: string): { identity: ContractIdentity; bundle: CatalogContractBundle } {
  const connector = effectiveConnector(binding.connector, scope.modelId, scope.operation);
  const model: ModelDescriptor = { id: binding.model.id, name: binding.model.name, operations: [scope.operation],
    inputKinds: structuredClone(binding.model.inputKinds), outputKinds: structuredClone(binding.model.outputKinds),
    parameters: structuredClone(binding.model.parameters ?? []), limits: structuredClone(binding.model.limits ?? {}) };
  const bundle = { model, connector };
  const identity: ContractIdentity = { ...scope, origin: new URL(scope.origin).origin, protocol,
    method: connector.submit.method ?? "POST", submit: catalogContractEndpoint(scope.origin, connector.submit.path),
    ...(connector.poll ? { poll: catalogContractEndpoint(scope.origin, connector.poll.path) } : {}),
    ...(connector.output.contentFallback ? { output: catalogContractEndpoint(scope.origin, connector.output.contentFallback.path) } : {}),
    schemaFingerprint: catalogContractSchemaFingerprint(bundle), ...(wireSchemaRevision ? { wireSchemaRevision } : {}) };
  const issues = validateCatalogContractBundle(identity, bundle);
  if (issues.length) throw new Error(`Incomplete catalog contract: ${issues.join(", ")}`);
  return { identity, bundle };
}

function requestIssues(request: RestRequestDefinition | undefined, origin: string): string[] {
  if (!request) return ["missing-request"];
  const issues: string[] = [];
  try { catalogContractEndpoint(origin, request.path); } catch { issues.push("unsafe-endpoint"); }
  if (request.headers && Object.keys(request.headers).some(key => /^(?:authorization|cookie|proxy-authorization|x-api-key)$/iu.test(key))) issues.push("embedded-credentials");
  return issues;
}

/** Enums, required sets, limits and wire mappings are validated/replaced together. */
export function validateCatalogContractBundle(identity: ContractIdentity, bundle: CatalogContractBundle): string[] {
  const issues: string[] = [];
  const model = bundle.model, connector = bundle.connector;
  if (!operations.has(identity.operation) || model.id !== identity.modelId || !model.operations.includes(identity.operation)) issues.push("model-operation");
  if (!identity.sourceId || !/^(?:site-id|name):.+/u.test(identity.groupIdentity) || !identity.protocol || !/^[a-f0-9]{64}$/u.test(identity.schemaFingerprint)) issues.push("identity");
  issues.push(...requestIssues(connector.submit, identity.origin));
  try {
    if (catalogContractEndpoint(identity.origin, connector.submit.path) !== identity.submit || (connector.submit.method ?? "POST") !== identity.method) issues.push("submit-identity");
    if ((connector.poll ? catalogContractEndpoint(identity.origin, connector.poll.path) : undefined) !== identity.poll) issues.push("poll-identity");
    if ((connector.output.contentFallback ? catalogContractEndpoint(identity.origin, connector.output.contentFallback.path) : undefined) !== identity.output) issues.push("output-identity");
  } catch { issues.push("endpoint-identity"); }
  if (!connector.auth || !["none", "bearer", "header"].includes(connector.auth.type) || connector.auth.type === "header" && !connector.auth.headerName) issues.push("auth");
  if (!model.parameters || !model.limits || !model.inputKinds || !model.outputKinds) issues.push("missing-bundle-fields");
  if (!connector.submit.mappings?.some(mapping => mapping.source.kind === "request" && mapping.source.path === "$.model")) issues.push("model-mapping");
  if (!connector.submit.mappings?.some(mapping => mapping.source.kind === "request" && mapping.source.path === "$.prompt")) issues.push("prompt-mapping");
  const expectedOutput = identity.operation.startsWith("image.") ? "image" : identity.operation.startsWith("video.") ? "video" : "audio";
  if (connector.output.kind !== expectedOutput || !model.outputKinds?.some(kind => kind === expectedOutput || kind === `${expectedOutput}[]`)) issues.push("output-kind");
  if ((identity.operation === "image.edit" || identity.operation === "video.image-to-video") &&
      !connector.submit.mappings?.some(mapping => mapping.source.kind === "assets" || mapping.source.kind === "openaiMessages")) issues.push("input-asset-mapping");
  if (connector.modelOverrides || connector.operationOverrides || connector.models || connector.allowedHosts?.some(host => host !== new URL(identity.origin).hostname)) issues.push("unresolved-inheritance");
  if (connector.poll) {
    issues.push(...requestIssues(connector.poll, identity.origin));
    if (!connector.submit.response?.taskIdPath || !connector.poll.response?.statusPath || !connector.statusMap || !Object.values(connector.statusMap).includes("succeeded")) issues.push("async-lifecycle");
  } else if (connector.submit.response?.taskIdPath) issues.push("missing-poll");
  if (!connector.output.path || !connector.output.kind || !connector.output.urlPath && !connector.output.base64Path && !connector.output.format && !connector.output.contentFallback) issues.push("output-mapping");
  const parameters = model.parameters ?? [], keys = new Set(parameters.map(parameter => parameter.key));
  if (keys.size !== parameters.length) issues.push("duplicate-parameter");
  for (const parameter of parameters) {
    if (!parameter.key || parameter.min !== undefined && parameter.max !== undefined && parameter.min > parameter.max) issues.push("parameter-range");
    if (parameter.default !== undefined && parameter.options?.length && parameter.allowCustomValue !== true && !parameter.options.some(option => option.value === parameter.default)) issues.push("parameter-default");
    if ([...(parameter.visibleWhen ?? []), ...(parameter.constraints ?? []).flatMap(constraint => constraint.when)].some(condition => !keys.has(condition.parameter))) issues.push("parameter-dependency");
    if (parameter.required && !(connector.submit.mappings ?? []).some(mapping => mapping.source.kind === "request" && mapping.source.path === `$.parameters.${parameter.key}`)) issues.push("required-mapping");
  }
  if (catalogContractSchemaFingerprint(bundle) !== identity.schemaFingerprint) issues.push("schema-fingerprint");
  return [...new Set(issues)];
}

export function emptyCatalogContractState(): CatalogContractState { return { schemaVersion: 1, slots: {} }; }

/** Automatic observations only own automatic fields; protected layers stay separate. */
export function reduceCatalogContract(state: CatalogContractState, observation: CatalogContractObservation): CatalogContractState {
  if (state.schemaVersion !== 1) throw new Error("Unsupported catalog contract state");
  const next = structuredClone(state), key = catalogContractSlotKey(observation.identity), previous = next.slots[key];
  const observedAt = Date.parse(observation.checkedAt), previousAt = previous ? Date.parse(previous.checkedAt) : undefined;
  if (!Number.isFinite(observedAt) || previousAt !== undefined && observedAt < previousAt) return next;
  if (observation.owner === "app-preset") return next; // Presets cannot grant a transport.
  if (previous?.accepted && previous.accepted.owner !== "automatic" && observation.owner === "automatic") return next;
  if (previous?.accepted?.owner === "manual" && observation.owner === "paid-test") return next;
  const compatible = previous && sameIdentity(previous.identity, observation.identity);
  const history = [...(previous?.history ?? [])];
  if (previous?.accepted && !compatible && !history.some(item => sameIdentity(item.identity, previous.accepted!.identity))) history.push(previous.accepted);
  const base: CatalogContractSlot = { identity: structuredClone(observation.identity), sourceKey: observation.sourceKey,
    presence: observation.presence, checkedAt: observation.checkedAt, history, blocked: true, reason: "incomplete" };
  if (previous && previousAt === observedAt && !compatible) {
    base.reason = "conflicting-source";
    next.slots[key] = base;
    return next;
  }
  if (compatible && previous.accepted && previous.accepted.sourceKey !== observation.sourceKey && previous.accepted.owner === observation.owner)
    return { ...next, slots: { ...next.slots, [key]: { ...previous, reason: "conflicting-source" } } };
  if (observation.presence === "unknown" || !observation.complete) {
    if (compatible && previous.accepted) { base.accepted = previous.accepted; base.blocked = false; delete base.reason; }
  } else if (observation.presence === "explicit-remove") {
    if (previous?.accepted && !history.some(item => sameIdentity(item.identity, previous.accepted!.identity))) history.push(previous.accepted);
    base.reason = "removed";
  } else if (observation.bundle && !validateCatalogContractBundle(observation.identity, observation.bundle).length) {
    base.accepted = { identity: structuredClone(observation.identity), sourceKey: observation.sourceKey, owner: observation.owner,
      checkedAt: observation.checkedAt, bundle: structuredClone(observation.bundle) };
    base.blocked = false; delete base.reason;
  } else if (compatible && previous.accepted) {
    base.accepted = previous.accepted; base.blocked = false; delete base.reason;
  }
  next.slots[key] = base;
  return next;
}

/** A parse failure alone is unknown. Only a comparable exact wire change can retire a binding. */
export function applyCatalogContractDiagnostics(state: CatalogContractState, diagnostics: readonly CatalogContractDiagnostic[],
  context: { origin: string; sourceId: string; groupIdentity: string; sourceKey: string; checkedAt: string }): CatalogContractState {
  const next = structuredClone(state);
  for (const diagnostic of diagnostics) {
    const key = catalogContractSlotKey({ ...context, modelId: diagnostic.modelId, operation: diagnostic.operation });
    const slot = next.slots[key], accepted = slot?.accepted;
    if (!slot || !accepted || accepted.owner !== "automatic" || accepted.sourceKey !== context.sourceKey) continue;
    const observedAt = Date.parse(context.checkedAt);
    if (!Number.isFinite(observedAt) || observedAt < Date.parse(slot.checkedAt)) continue;
    let endpoint: string;
    try { endpoint = catalogContractEndpoint(context.origin, diagnostic.submitEndpoint); } catch { continue; }
    const changed = endpoint !== accepted.identity.submit || diagnostic.method !== accepted.identity.method ||
      diagnostic.parameterFingerprint !== undefined && diagnostic.parameterFingerprint !== catalogContractParameterFingerprint(accepted.bundle.model) ||
      diagnostic.schemaFingerprint !== undefined && diagnostic.schemaFingerprint !== accepted.identity.schemaFingerprint;
    if (!changed) continue;
    if (!slot.history.some(item => sameIdentity(item.identity, accepted.identity))) slot.history.push(accepted);
    delete slot.accepted;
    slot.blocked = true; slot.presence = "unknown"; slot.reason = "incomplete"; slot.checkedAt = context.checkedAt;
  }
  return next;
}

function ownedOverride(connector: RestConnectorConfig): RestModelConnectorOverride {
  const { submit, poll, auth, output, statusMap, pollIntervalMs } = connector;
  return structuredClone({ submit, ...(poll ? { poll } : {}), auth, output, ...(statusMap ? { statusMap } : {}), ...(pollIntervalMs ? { pollIntervalMs } : {}) });
}

/** New-pipeline descriptors never consult legacy templates, sibling IDs or saved interfaces. */
export function projectCatalogContractModels(connection: { provider: string; config: Record<string, unknown> },
  scanned: readonly ModelDescriptor[], options: CatalogContractProjectionOptions): { models: ModelDescriptor[]; connector?: RestConnectorConfig } {
  let origin: string;
  try { origin = new URL(String(connection.config.baseUrl)).origin; } catch { origin = ""; }
  const overrides: Record<string, RestModelConnectorOverride> = {};
  const connectors: RestConnectorConfig[] = [];
  const models = scanned.map(model => {
    if (connection.config.manualProtocol === true || model.metadata?.source === "manual" || model.metadata?.source === "paid-test" || model.metadata?.protocolEvidence === "paid-test") {
      const saved = connection.config.connector;
      if (own(saved) && saved.submit && saved.output && model.operations.length) {
        const connector = saved as unknown as RestConnectorConfig;
        const operationOverrides = Object.fromEntries(model.operations.map(operation =>
          [operation, ownedOverride(effectiveConnector(connector, model.id, operation))]));
        overrides[model.id] = { ...ownedOverride(effectiveConnector(connector, model.id, model.operations[0]!)), operationOverrides };
        connectors.push(effectiveConnector(connector, model.id, model.operations[0]!));
      }
      // Existing manual/paid-test layers are not migrated into automatic history.
      return { ...structuredClone(model), metadata: { ...model.metadata, catalogContractPolicy: 1, catalogContractStatus: "protected" } };
    }
    const matches = Object.values(options.catalogContracts.slots).filter(slot => slot.identity.origin === origin &&
      slot.identity.sourceId === options.sourceId && slot.identity.groupIdentity === options.groupIdentity && slot.identity.modelId === model.id);
    const accepted = matches.filter(slot => !slot.blocked && slot.accepted &&
      !validateCatalogContractBundle(slot.accepted.identity, slot.accepted.bundle).length).map(slot => slot.accepted!);
    const metadata: Record<string, unknown> = { ...model.metadata, catalogContractPolicy: 1,
      catalogContractStatus: accepted.length ? "accepted" : "pending" };
    // A contract is not permission evidence. Preserve live denials from the Key inventory.
    const denied = model.metadata?.catalogMembershipVerified === false || model.metadata?.canvasRunnable === false && /401|403|权限|未开通|拒绝|未返回|not.?returned|unauthor|forbidden/iu.test(String(model.metadata.canvasUnavailableReason ?? "")) ||
      ["unauthorized", "empty"].includes(String(connection.config.modelScanStatus));
    if (!accepted.length || denied) return { ...structuredClone(model), metadata: { ...metadata, canvasRunnable: false,
      canvasUnavailableReason: model.metadata?.catalogMembershipVerified === false ? "尚未读取当前 Key 的成员证据；上次型号仅供历史查看"
        : denied ? model.metadata?.canvasUnavailableReason ?? "当前 Key 没有此型号的可用权限" : CATALOG_CONTRACT_PENDING_REASON } };
    // Different operation parameter domains are not deep-merged into a fictitious schema.
    const schemas = new Set(accepted.map(item => digest({ parameters: item.bundle.model.parameters, limits: item.bundle.model.limits,
      inputKinds: item.bundle.model.inputKinds, outputKinds: item.bundle.model.outputKinds })));
    if (schemas.size !== 1) return { ...structuredClone(model), metadata: { ...metadata, canvasRunnable: false, canvasUnavailableReason: "不同操作的参数契约需要独立选择" } };
    const first = accepted[0]!, descriptor = first.bundle.model;
    const operationOverrides = Object.fromEntries(accepted.map(item => [item.identity.operation, ownedOverride(item.bundle.connector)]));
    overrides[model.id] = { ...ownedOverride(first.bundle.connector), operationOverrides };
    connectors.push(first.bundle.connector);
    metadata.canvasRunnable = true; delete metadata.canvasUnavailableReason;
    return applyUserImageSizePresets({ ...structuredClone(model), operations: accepted.map(item => item.identity.operation),
      inputKinds: structuredClone(descriptor.inputKinds), outputKinds: structuredClone(descriptor.outputKinds),
      parameters: structuredClone(descriptor.parameters), limits: structuredClone(descriptor.limits), metadata });
  });
  if (!connectors.length) {
    const saved = connection.config.connector;
    if (own(saved) && saved.submit && saved.output) return { models, connector: { ...structuredClone(saved) as unknown as RestConnectorConfig,
      models: [], restrictModels: true, modelOverrides: {} } };
    return { models };
  }
  const connector = structuredClone(connectors[0]!);
  connector.models = models.filter(model => model.metadata?.canvasRunnable !== false);
  connector.restrictModels = true; connector.modelOverrides = overrides;
  return { models, connector };
}

/** Cache reads must not restore templates over a policy-owned projection. */
export function isCatalogContractProjection(model: ModelDescriptor): boolean { return model.metadata?.catalogContractPolicy === 1; }

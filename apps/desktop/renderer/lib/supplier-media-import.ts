import { randomUUID } from "node:crypto";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { modelGenerationMediaKinds, savedModelInterfaces, type ModelDescriptor, type SupplierAccountKeys } from "@super-canvas/providers";
import { supplierConnectionDraft } from "./supplier-connection-draft";
import { isAgentTextModel } from "./agent-model-capabilities";

/** Only the scanner supplies these receipts after a complete current-Key GET. */
export interface SupplierMediaScanReceipt {
  before: ProviderConnectionRecord;
  after: ProviderConnectionRecord;
}

const stableId = (value: unknown): string | undefined => {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? String(number) : undefined;
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Account commits stamp updatedAt even for untouched connections. Every saved
// field apart from that administrative timestamp still belongs to the baseline.
const unchangedBeforeKeyRead = (a: ProviderConnectionRecord, b: ProviderConnectionRecord) =>
  eq({ ...a, updatedAt: null }, { ...b, updatedAt: null });
const belongs = (supplier: SupplierRecord, connection: ProviderConnectionRecord) =>
  connection.config.supplierId === supplier.id && connection.config.supplierSourceId === supplier.state?.sourceId &&
  connection.config.supplierArchived !== true && connection.config.baseUrl === supplier.apiUrl;
const connectionGroup = (connection: ProviderConnectionRecord) => connection.config.accountKeyGroup ?? connection.config.modelGroup;

/** Scan-derived model/schema/price timestamps may change; user identity may not. */
function unchangedConsumer(before: ProviderConnectionRecord, after: ProviderConnectionRecord): boolean {
  const fields = ["supplierId", "supplierSourceId", "supplierArchived", "baseUrl", "usage", "modelGroup", "accountKeyGroup",
    "accountKeyGroupId", "accountKeyId", "preset", "customGroup", "protocol", "directorProtocol",
    "manualModels", "allowedModels", "modelNames"];
  const models = Array.isArray(after.config.modelCatalogModels) ? after.config.modelCatalogModels as unknown as ModelDescriptor[] : [];
  // The inventory fills an unset agent default with its first visible text
  // model. Existing user-selected defaults must still remain identical.
  const defaultUnchanged = eq(before.config.defaultModel, after.config.defaultModel) ||
    !before.config.defaultModel && models.some(model => model.id === after.config.defaultModel && isAgentTextModel(model));
  return before.id === after.id && before.name === after.name && before.provider === after.provider &&
    before.encryptedSecret === after.encryptedSecret && defaultUnchanged && fields.every(field => eq(before.config[field], after.config[field]));
}

function declaredMedia(model: ModelDescriptor): boolean {
  const metadata = model.metadata ?? {};
  if (metadata.outputKindsSource !== "declared" && metadata.operationsSource !== "declared") return false;
  return modelGenerationMediaKinds(model).some(kind => kind === "image" && model.operations.includes("image.generate") ||
    kind === "video" && model.operations.includes("video.generate"));
}

/** A directory name never proves a transport. Reuse an exact connected binding
 * or a supplier-declared Images schema that the existing OpenAI adapter runs. */
function connectedMedia(connection: ProviderConnectionRecord, model: ModelDescriptor, targetProvider: string): boolean {
  if (!declaredMedia(model) || model.metadata?.canvasRunnable === false || model.metadata?.parameterControlsUnavailable === true ||
    model.metadata?.autoInterfaceStatus === "incomplete" || !model.parameters?.length) return false;
  const binding = savedModelInterfaces(connection.config)[model.id];
  const kinds = modelGenerationMediaKinds(model);
  if (model.metadata?.autoInterfaceStatus === "connected" && binding?.model?.id === model.id &&
    binding.connector?.submit?.path && binding.connector.submit.method &&
    kinds.includes(binding.connector.output?.kind as "image" | "video") &&
    binding.model.operations.some(operation => model.operations.includes(operation) &&
      ["image.generate", "video.generate"].includes(operation))) return true;
  // This is the existing adapter's standardized Images contract, with explicit
  // endpoint/schema facts from this supplier, rather than ID-family inference.
  return targetProvider === "openai" && kinds.length === 1 && kinds[0] === "image" &&
    ["supplier-catalog", "model-api"].includes(String(model.metadata?.modelFactsSource)) &&
    model.metadata?.protocol === "openai-images" && Array.isArray(model.metadata?.endpointTypes) &&
    model.metadata.endpointTypes.some(endpoint => ["openai-images", "/images/generations", "/v1/images/generations"].includes(String(endpoint)));
}

/** Pure plan: retain all existing records and reuse ciphertext, never create a
 * supplier Key or a verification request. The caller commits with CAS guards. */
export function planSupplierAgentMediaImport(supplier: SupplierRecord, connections: ProviderConnectionRecord[],
  account: SupplierAccountKeys | undefined, receipts: readonly SupplierMediaScanReceipt[],
  options: { startedAt: string; initialConnections: readonly ProviderConnectionRecord[]; matchesKey: (connection: ProviderConnectionRecord, apiKey: string) => boolean }) {
  const next = [...connections];
  const addedIds: string[] = [];
  const imports = structuredClone(supplier.state?.agentMediaImports ?? []);
  if (!Number.isFinite(Date.parse(options.startedAt)) || !account?.complete || supplier.state?.visibility === "deleted" || supplier.scanComplete !== true ||
    !["live", "empty"].includes(supplier.scanStatus)) return { connections: next, addedIds, imports };
  for (const receipt of receipts) {
    const current = next.find(connection => connection.id === receipt.after.id);
    if (!current || !options.initialConnections.some(connection => unchangedBeforeKeyRead(connection, receipt.before)) || !eq(current, receipt.after) ||
      !unchangedConsumer(receipt.before, current) || !belongs(supplier, current) || current.config.usage !== "agent" ||
      !current.encryptedSecret) continue;
    const config = current.config;
    if (config.modelScanStatus !== "live" || config.modelScanAttemptStatus !== "live" || config.modelScanComplete !== true ||
      config.modelCatalogSource !== "live" || typeof config.modelScanRequestId !== "string" ||
      config.modelScanRequestId === receipt.before.config.modelScanRequestId ||
      typeof config.modelScanCheckedAt !== "string" || config.modelScanLastSuccessAt !== config.modelScanCheckedAt ||
      !Number.isFinite(Date.parse(config.modelScanCheckedAt)) || Date.parse(config.modelScanCheckedAt) < Date.parse(options.startedAt)) continue;
    const id = stableId(config.accountKeyGroupId);
    const groups = supplier.catalog.groups.filter(group => group.source === "catalog" && group.status !== "missing" && group.details?.stale !== true &&
      (id !== undefined ? stableId(group.supplierGroupId) === id : group.supplierGroupId === undefined && group.id === connectionGroup(current)));
    if (groups.length !== 1) continue;
    const group = groups[0]!;
    if (imports.some(entry => entry.sourceId === supplier.state?.sourceId &&
      (id !== undefined ? stableId(entry.supplierGroupId) === id : entry.supplierGroupId === undefined && entry.groupId === group.id))) continue;
    const keys = account.keys.filter(key => key.id === String(config.accountKeyId ?? "") &&
      (id !== undefined ? stableId(key.supplierGroupId) === id : key.supplierGroupId === undefined && key.group === group.id));
    let matched = false;
    try { matched = keys.length === 1 && options.matchesKey(current, keys[0]!.apiKey); } catch { /* Unreadable credentials do not authorize a connection. */ }
    if (!matched) continue;
    const sameGroup = (connection: ProviderConnectionRecord) => connection.config.supplierId === supplier.id &&
      connection.config.supplierSourceId === supplier.state?.sourceId && connection.config.baseUrl === supplier.apiUrl &&
      (id !== undefined ? stableId(connection.config.accountKeyGroupId) === id :
        connection.config.accountKeyGroupId === undefined && connectionGroup(connection) === group.id);
    // A disabled same-group record is an explicit choice; do not bypass it by
    // adding another connection. Existing canvas Keys are never unioned.
    if ([...next, ...options.initialConnections].some(connection => sameGroup(connection) &&
      (connection.config.usage !== "agent" || connection.config.supplierArchived === true))) continue;
    const draft = supplierConnectionDraft(supplier.supplierKey, group, "canvas", supplier.apiUrl);
    const models = Array.isArray(config.modelCatalogModels) ? config.modelCatalogModels as unknown as ModelDescriptor[] : [];
    const visible = new Set(Array.isArray(config.scannedModelIds) ? config.scannedModelIds.filter(value => typeof value === "string") : []);
    const media = models.filter(model => visible.has(model.id) && connectedMedia(current, model, draft.provider));
    if (!media.length) continue;
    const permitted = new Set(media.map(model => model.id));
    const bindings = Object.fromEntries(Object.entries(savedModelInterfaces(config)).filter(([modelId]) => permitted.has(modelId)));
    const snapshot = models.map(model => permitted.has(model.id) ? structuredClone(model) : { ...structuredClone(model),
      metadata: { ...model.metadata, canvasRunnable: false } });
    const createdAt = new Date().toISOString();
    const connection: ProviderConnectionRecord = { id: randomUUID(), name: `${supplier.name} · ${group.id} · 画布`,
      provider: draft.provider, encryptedSecret: current.encryptedSecret, createdAt, updatedAt: createdAt,
      config: { ...draft.config, supplierId: supplier.id, supplierName: supplier.name, supplierSourceId: supplier.state!.sourceId,
        accountKeyId: config.accountKeyId, accountKeyGroup: group.id, ...(id !== undefined ? { accountKeyGroupId: id } : {}),
        modelGroup: group.id, usage: "canvas", defaultModel: media[0]!.id,
        modelScanStatus: "live", modelScanAttemptStatus: "live", modelScanComplete: true, modelCatalogSource: "live",
        modelScanRequestId: randomUUID(), modelScanCheckedAt: config.modelScanCheckedAt, modelScanLastSuccessAt: config.modelScanLastSuccessAt,
        modelScanError: null, modelScanErrorCode: null, modelScanHttpStatus: null, modelScanUpstreamErrorCode: null,
        scannedModelIds: [...visible], modelCatalogModels: snapshot,
        ...(Object.keys(bindings).length ? { autoModelInterfaces: bindings } : {}),
        supplierMediaSourceConnectionId: current.id, supplierMediaConnectedAt: createdAt,
      } as ProviderConnectionRecord["config"] };
    next.push(connection);
    addedIds.push(connection.id);
    imports.push({ sourceId: supplier.state!.sourceId, groupId: group.id,
      ...(id !== undefined ? { supplierGroupId: id } : {}), sourceConnectionId: current.id,
      connectionId: connection.id, createdAt });
  }
  return { connections: next, addedIds, imports };
}

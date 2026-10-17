import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { bananaImageRoute, canApplyCangyuanCurrentContract, isCangyuanMusicRequest, isCangyuanNativeSeedanceRequest,
  isChuangxiangVideoConnection, isChuangxiangImageConnection, isChuangxiangMidjourneyConnection, isJiasuImageConnection,
  isJijiuGptImage, jijiuImageGroupAllowed, isPdogImageConnection, isSecureSkillImageConnection, isSecureSkillSeedreamConnection,
  remainingVideoModel, remainingVideoSupplier, remainingVideoTransport, type ModelDescriptor, type ProviderOperation, type RestConnectorConfig } from "@super-canvas/providers";
import { cOpenImageRoute } from "@super-canvas/providers/c-open-image-contract";
import { isGenimageImageConnection } from "@super-canvas/providers/genimage-image-capabilities";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { catalogConnectionScopes } from "./catalog-source-plan";
import { catalogContractFromDocumented, type CatalogContractObservation } from "./catalog-contract-policy";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import { applyChentuImageCapabilities } from "./chentu-image-capabilities";
import { chentuFallbackImageDescriptor } from "./chentu-catalog";
import { cyberAfeiDocumentedModel, cyberAfeiConnectorForModels } from "./cyberafei-catalog";
import { friModelFallbackImageDescriptor } from "./frimodel-presets";
import { applyMiaowuImageSchema, type MiaowuImageSchemaContract } from "./miaowu-image-schema";
import { applyMiaowuVideoSchema, type MiaowuVideoSchemaContract } from "./miaowu-video-schema";
import { MIAOWU_CONNECTOR, MIAOWU_IMAGE_OVERRIDE } from "./miaowu-presets";
import { matchesSupplierTemplate } from "./supplier-template-source";
import { supplierKeyForConnection } from "./supplier-identity";
import { mikotoConnectorForGroup, mikotoGroup } from "./mikoto-presets";

const protectedModel = (model: ModelDescriptor) => ["manual", "paid-test"].includes(String(model.metadata?.source)) || model.metadata?.protocolEvidence === "paid-test";
const denied = (model: ModelDescriptor) => /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthor|forbidden|not.?returned/iu.test(String(model.metadata?.canvasUnavailableReason ?? ""));
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** The router uses these same origin/group/model predicates. No saved/template route is consulted. */
function nativeAdapter(connection: ProviderConnectionRecord, model: ModelDescriptor): string | undefined {
  const { config, provider } = connection, id = model.id, baseUrl = String(config.baseUrl);
  if (config.manualProtocol === true || config.supplierArchived === true || ["agent", "disabled"].includes(String(config.usage)) ||
    !["openai", "weai", "rest"].includes(provider) || !model.operations.length || model.metadata?.canvasRunnable === false || denied(model)) return;
  const image = model.operations.every(operation => operation.startsWith("image."));
  if (image) {
    const banana = bananaImageRoute(connection, id);
    if (banana && !banana.unavailableReason) return "banana-native";
    if (provider === "openai" && cOpenImageRoute(config, id)) return "c-open-native";
    if (provider === "openai" && isGenimageImageConnection(config, id)) return "genimage-native";
    if (["openai", "rest"].includes(provider) && isJiasuImageConnection(config, id)) return "jiasu-native";
    if (["openai", "rest"].includes(provider) && isJijiuGptImage(config, id) && jijiuImageGroupAllowed(config, id)) return "jijiu-native";
    if (provider === "openai" && isPdogImageConnection(config, id)) return "pdog-native";
    if (provider === "openai" && isChuangxiangImageConnection(config, id)) return "chuangxiang-native";
    if (["openai", "rest"].includes(provider) && isChuangxiangMidjourneyConnection(config, id)) return "chuangxiang-midjourney";
    if (provider === "openai" && (isSecureSkillImageConnection(config, id) || isSecureSkillSeedreamConnection(config, id))) return "secure-skill-native";
    if (provider === "rest" && canApplyCangyuanCurrentContract(config, baseUrl, id)) return "cangyuan-current";
    if (["openai", "weai"].includes(provider) && matchesSupplierTemplate(connection)) {
      const supplier = supplierKeyForConnection(connection), group = String(config.accountKeyGroup ?? config.modelGroup ?? "");
      if (supplier === "chentu" && chentuFallbackImageDescriptor(id, group)?.metadata?.protocol === "openai-images") return "chentu-images";
      if (supplier === "frimodel" && friModelFallbackImageDescriptor(id, group)?.metadata?.protocol === "openai-images") return "frimodel-images";
      if (["openai", "mikoto", "weai"].includes(supplier) && /^gpt-image-(?:1(?:\.5)?|2(?:\.5)?)(?:-(?:low|medium|high|flare|sunburst|adobe|az|1k|2k|4k))*$/iu.test(id)) return `${supplier}-images`;
    }
    return;
  }
  if (model.operations.every(operation => operation === "music.generate") && provider === "rest" && isCangyuanMusicRequest(id, baseUrl)) return "cangyuan-music";
  if (model.operations.every(operation => operation.startsWith("video."))) {
    if (["openai", "rest"].includes(provider) && isCangyuanNativeSeedanceRequest(id, baseUrl)) return "cangyuan-video";
    if (["openai", "rest"].includes(provider) && isChuangxiangVideoConnection(config, id)) return "chuangxiang-video";
    const supplier = remainingVideoSupplier(baseUrl), context = { baseUrl, manualProtocol: config.manualProtocol,
      group: String(config.accountKeyGroup ?? config.modelGroup ?? ""), model,
      officialGroupId: typeof config.accountKeyGroupId === "string" || typeof config.accountKeyGroupId === "number" ? config.accountKeyGroupId : undefined,
      groupDescription: String(config.supplierGroupDescription ?? config.groupDescription ?? "") };
    if (supplier && remainingVideoModel(supplier, id, model, context) && remainingVideoTransport(supplier, id, context)) return `${supplier}-video`;
  }
}

function withoutSavedTransports(connection: ProviderConnectionRecord): ProviderConnectionRecord {
  const config = { ...connection.config };
  for (const key of ["connector", "modelProtocolTemplate", "autoModelInterfaces", "modelInterfaces", "modelCatalogModels"]) delete config[key];
  return { ...connection, config };
}
function builtinRestContract(connection: ProviderConnectionRecord, model: ModelDescriptor): { adapter: string; model: ModelDescriptor; connector: RestConnectorConfig } | undefined {
  if (connection.provider !== "rest" || !matchesSupplierTemplate(connection) || protectedModel(model) || denied(model) ||
    connection.config.manualProtocol === true || connection.config.supplierArchived === true || ["agent", "disabled"].includes(String(connection.config.usage))) return;
  const config = connection.config, supplier = supplierKeyForConnection(connection), context = { baseUrl: config.baseUrl,
    group: String(config.accountKeyGroup ?? config.modelGroup ?? ""), model, manualProtocol: config.manualProtocol,
    officialGroupId: typeof config.accountKeyGroupId === "string" || typeof config.accountKeyGroupId === "number" ? config.accountKeyGroupId : undefined };
  if (supplier === "cyberafei") {
    const endpoints = model.metadata?.endpointTypes;
    const descriptor = cyberAfeiDocumentedModel(model.id, Array.isArray(endpoints) && endpoints.length ? { endpointTypes: endpoints.filter((value): value is string => typeof value === "string") } : undefined, context);
    if (descriptor && descriptor.metadata?.canvasRunnable !== false && descriptor.operations.length &&
      (!model.outputKinds?.length || !descriptor.outputKinds?.length || model.outputKinds.some(kind => descriptor.outputKinds!.includes(kind))))
      return { adapter: "cyberafei-rest", model: completeBuiltinDescriptor(descriptor), connector: cyberAfeiConnectorForModels([descriptor], context) };
  }
  if (supplier === "mikoto" && config.preset === "mikoto-pro") {
    const group = mikotoGroup(config.accountKeyGroup ?? config.modelGroup);
    const descriptor = group?.provider === "rest" ? group.models.find(row => row.id === model.id) : undefined;
    if (group && descriptor && (!model.outputKinds?.length || !descriptor.outputKinds?.length || model.outputKinds.some(kind => descriptor.outputKinds!.includes(kind))))
      return { adapter: "mikoto-rest", model: completeBuiltinDescriptor(descriptor), connector: mikotoConnectorForGroup(group.id) };
  }
}
/** Older built-in descriptors omitted canonical media arrays although their
 * exact adapter's operation and limits already define them. This fills only
 * those structural fields; no request field, size, price or limit is added. */
function completeBuiltinDescriptor(model: ModelDescriptor): ModelDescriptor {
  const image = model.operations.every(operation => operation.startsWith("image."));
  const video = model.operations.every(operation => operation.startsWith("video."));
  return { ...model, parameters: model.parameters ?? [], limits: model.limits ?? {},
    inputKinds: model.inputKinds ?? ["text", ...(model.operations.includes("image.edit") || model.operations.includes("video.image-to-video") || Number(model.limits?.maxInputImages) > 0 ? ["image" as const, "image[]" as const] : []),
      ...(Number(model.limits?.maxInputVideos) > 0 ? ["video" as const, "video[]" as const] : []), ...(Number(model.limits?.maxInputAudios) > 0 ? ["audio" as const, "audio[]" as const] : [])],
    outputKinds: model.outputKinds ?? (image ? ["image"] : video ? ["video"] : []) };
}
function preservePrice(original: ModelDescriptor, descriptor: ModelDescriptor): ModelDescriptor {
  const metadata = { ...descriptor.metadata };
  for (const key of Object.keys(metadata)) if (/price|pricing|billing/iu.test(key)) delete metadata[key];
  for (const [key, value] of Object.entries(original.metadata ?? {})) if (/price|pricing|billing/iu.test(key)) metadata[key] = value;
  return { ...descriptor, name: original.name, pricing: original.pricing, metadata };
}

export interface CatalogDedicatedContractOptions {
  identityEpoch: string;
  observationCycleId: string;
  /** Accepted exact-Key source contributions, never legacy display cache. */
  membershipModelIds?: readonly string[];
}
export interface CatalogDedicatedContracts {
  models: ModelDescriptor[];
  nativeModels: ModelDescriptor[];
  contracts: CatalogContractObservation[];
  nativeBindings: CatalogContractObservation[];
}

/** Compile normalized dedicated facts through the existing pure adapter contracts.
 * This performs no I/O, does not change prices, and cannot mint Key membership. */
export function collectCatalogDedicatedContracts(connection: ProviderConnectionRecord, supplier: SupplierRecord | undefined,
  models: readonly ModelDescriptor[], observations: readonly CatalogReadObservation[], options: CatalogDedicatedContractOptions): CatalogDedicatedContracts {
  const scopes = catalogConnectionScopes(connection, supplier), origin = new URL(String(connection.config.baseUrl)).origin;
  const applicable = observations.filter(row => row.receipt.context.identityEpoch === options.identityEpoch &&
    row.receipt.spec.applyScope.supplierSourceId === scopes.apply.supplierSourceId &&
    row.receipt.spec.applyScope.groupIdentity === scopes.apply.groupIdentity &&
    row.receipt.spec.authScope.kind === "connection-key" && isDeepStrictEqual(row.receipt.spec.authScope, scopes.key) &&
    row.receipt.spec.applyScope.connectionIds.includes(connection.id));
  const freshMembers = new Set(applicable.filter(row => row.receipt.context.observationCycleId === options.observationCycleId &&
    row.receipt.spec.role === "key-membership" && row.receipt.status === "succeeded" && row.receipt.complete && row.receipt.freshness === "live")
    .flatMap(row => row.facts.models.filter(model => !denied(model)).map(model => model.id)));
  const proven = new Set(options.membershipModelIds ?? []), nativeModels: ModelDescriptor[] = [], contracts: CatalogContractObservation[] = [], nativeBindings: CatalogContractObservation[] = [];
  const safeConnection = withoutSavedTransports(connection);
  const prepared = models.map(model => {
    if (protectedModel(model)) return structuredClone(model);
    const metadata = { ...model.metadata }; delete metadata.catalogContractPolicy;
    if (metadata.canvasRunnable === false && !denied(model) && /契约尚未完整读取|上次型号仅供历史|协议|尚未内置/u.test(String(metadata.canvasUnavailableReason ?? ""))) {
      delete metadata.canvasRunnable; delete metadata.canvasUnavailableReason;
    }
    return { ...structuredClone(model), metadata };
  });
  // This old binding path sees no saved connector, interfaces or template, so
  // only built-in source-checked adapters can enrich it. It cannot resurrect a
  // custom/private transport or infer a sibling's model override.
  const nativeCandidates = bindScannedModelProtocols(safeConnection, prepared, safeConnection).models;
  let projected = models.map((original, index) => {
    let candidate = nativeCandidates[index] ?? original;
    const builtin = builtinRestContract(safeConnection, candidate);
    if (builtin) candidate = builtin.model;
    const adapter = builtin?.adapter ?? nativeAdapter(safeConnection, candidate);
    const identity = digest([connection.provider, origin, scopes.key, scopes.apply.supplierSourceId, scopes.apply.groupIdentity ?? "name:", original.id]);
    const marker = record(original.metadata?.catalogNativeContract);
    const accepted = marker.schemaVersion === 1 && marker.identity === identity && marker.adapter === adapter && proven.has(original.id);
    if (!adapter || !freshMembers.has(original.id) && !accepted || original.metadata?.catalogMembershipVerified === false || denied(original)) return structuredClone(original);
    const memberSample = applicable.find(row => row.receipt.spec.role === "key-membership" && row.receipt.status === "succeeded" && row.receipt.complete && row.facts.models.some(model => model.id === original.id));
    const checkedAt = memberSample?.receipt.checkedAt ?? (typeof marker.checkedAt === "string" ? marker.checkedAt : undefined);
    let current = preservePrice(original, candidate);
    for (const row of applicable) if (row.receipt.status === "succeeded" && row.receipt.complete &&
      row.facts.sourceFacts?.kind === "chentu-capabilities" && origin === "https://tu.988236.xyz") current = applyChentuImageCapabilities([current],
        { data: row.facts.sourceFacts.capabilities?.map(item => ({ model: item.modelId, sizes: item.sizes })) }, row.receipt.checkedAt)[0]!;
    current = { ...current, metadata: { ...current.metadata, catalogNativeContract: { schemaVersion: 1, identity, adapter, ...(checkedAt ? { checkedAt } : {}) }, canvasRunnable: true } };
    delete (current.metadata as Record<string, unknown>).canvasUnavailableReason;
    if (builtin) {
      if (!checkedAt) return structuredClone(original);
      const bindings: CatalogContractObservation[] = [];
      for (const operation of current.operations) try {
        const compiled = catalogContractFromDocumented({ origin, sourceId: scopes.apply.supplierSourceId, groupIdentity: scopes.apply.groupIdentity ?? "name:",
          modelId: current.id, operation }, builtin.adapter, { model: current, connector: builtin.connector,
            sourceUrl: `${origin}/` });
        bindings.push({ ...compiled, sourceKey: `builtin:${identity}`, checkedAt,
          owner: "automatic", presence: "present", complete: true });
      } catch { /* Existing builder cannot express a complete bundle for this exact model. */ }
      if (bindings.length !== current.operations.length) return structuredClone(original);
      nativeBindings.push(...bindings);
    }
    nativeModels.push(current); return current;
  });
  if (origin === "https://api.miaowuai.store") for (const row of applicable) {
    const fact = row.facts.sourceFacts, id = row.receipt.spec.applyScope.modelId;
    if (row.receipt.status !== "succeeded" || !row.receipt.complete || row.receipt.freshness !== "live" || fact?.kind !== "miaowu-schema" || !fact.contract || !id) continue;
    const contract = fact.contract;
    projected = projected.map(model => {
      if (model.id !== id || protectedModel(model) || denied(model)) return model;
      const receipt = { id, sourceUrl: `https://api.miaowuai.store/v1/dream/model_schema?model=${encodeURIComponent(id)}`,
        checkedAt: row.receipt.checkedAt, status: "live" as const, normalizedSchemaSha256: row.facts.contractDigests?.[0] };
      const image = "modes" in contract;
      const descriptor = preservePrice(model, image ? applyMiaowuImageSchema(model, { ...receipt, contract: contract as MiaowuImageSchemaContract })
        : applyMiaowuVideoSchema(model, { ...receipt, contract: contract as MiaowuVideoSchemaContract }));
      if (descriptor.metadata?.parameterSource !== (image ? "dream.image_schema" : "dream.video_schema")) return model;
      const connector = { ...structuredClone(MIAOWU_CONNECTOR), models: [descriptor], modelOverrides: image ? { [id]: structuredClone(MIAOWU_IMAGE_OVERRIDE) } : {} };
      for (const operation of descriptor.operations) {
        try {
          const compiled = catalogContractFromDocumented({ origin, sourceId: scopes.apply.supplierSourceId,
            groupIdentity: scopes.apply.groupIdentity ?? "name:", modelId: id, operation: operation as ProviderOperation }, image ? "miaowu-images" : "miaowu-videos",
          { model: descriptor, connector, sourceUrl: receipt.sourceUrl });
          contracts.push({ ...compiled, sourceKey: row.receipt.spec.sourceKey, checkedAt: row.receipt.checkedAt,
            owner: "automatic", presence: "present", complete: true });
        } catch { /* An unsupported bundle stays pending rather than borrowing an old mapping. */ }
      }
      return descriptor;
    });
  }
  return { models: projected, nativeModels, contracts, nativeBindings };
}

/** The schema parser already validates a complete per-call display tariff.
 * Only its exact Key/group/model price facts are exposed to the P4 reducer. */
export function normalizeCatalogDedicatedPriceFacts(connection: ProviderConnectionRecord, supplier: SupplierRecord | undefined,
  observations: readonly CatalogReadObservation[]): CatalogReadObservation[] {
  let origin: string; try { origin = new URL(String(connection.config.baseUrl)).origin; } catch { return [...observations]; }
  if (origin !== "https://api.miaowuai.store") return [...observations];
  const scopes = catalogConnectionScopes(connection, supplier);
  const group = String(connection.config.accountKeyGroup ?? connection.config.modelGroup ?? "");
  return observations.map(row => {
    const { spec } = row.receipt, facts = row.facts.sourceFacts, id = spec.applyScope.modelId;
    if (row.receipt.status !== "succeeded" || !row.receipt.complete || row.receipt.freshness !== "live" || spec.role !== "schema" ||
      facts?.kind !== "miaowu-schema" || !facts.contract || !("modes" in facts.contract) || !facts.contract.pricingDisplay || !id ||
      spec.sourceUrl !== `${origin}/v1/dream/model_schema?model=${encodeURIComponent(id)}` || !isDeepStrictEqual(spec.authScope, scopes.key) ||
      spec.applyScope.groupIdentity !== scopes.apply.groupIdentity || spec.applyScope.supplierSourceId !== scopes.apply.supplierSourceId ||
      !spec.applyScope.connectionIds.includes(connection.id) || !facts.contract.pricingDisplay.groups[group]) return row;
    const descriptor = applyMiaowuImageSchema({ id, name: id, operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"],
      metadata: { marketplaceGroup: group, catalogPriceOperation: "image.generate" } }, { id, sourceUrl: spec.sourceUrl, checkedAt: row.receipt.checkedAt, status: "live", contract: facts.contract });
    if (!descriptor.pricing) return row;
    return { ...row, facts: { ...row.facts, models: [descriptor] } };
  });
}

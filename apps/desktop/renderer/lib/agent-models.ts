import type { DirectorModelCapabilities, DirectorProtocol, ResolvedDirectorConnection } from "@super-canvas/director";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import { normalizeSupplierSiteBase, normalizeTk1688CnyModel, scanProviderModelCatalog, type ModelDescriptor } from "@super-canvas/providers";
import { repository } from "./server";
import { resolveDirectorConnection } from "./director-connections";
import {
  agentRecord, declaredAgentFlags, isAgentTextModel, normalizeAgentProtocol, resolveAgentCapabilities,
  type AgentCapabilitySource, type AgentInputStatus, type AgentInputLimits, type AgentReasoningOption,
} from "./agent-model-capabilities";

export const AGENT_PROTOCOLS = ["chat-completions", "responses", "anthropic-messages", "google-generate-content", "xai-responses", "generic-openai-compatible"] as const;
export function agentProtocol(config: Record<string, unknown>): DirectorProtocol {
  return normalizeAgentProtocol(config.directorProtocol) ?? normalizeAgentProtocol(config.protocol) ?? "openai-chat-completions";
}

function descriptors(values: unknown): ModelDescriptor[] {
  return (Array.isArray(values) ? values : []).flatMap(raw => {
    const value = agentRecord(raw);
    if (typeof value.id !== "string" || !value.id.trim()) return [];
    // Existing descriptors may contain the old scanner's [text] placeholder.
    // Only raw supplier modalities or an explicit source marker prove negatives.
    const metadata = agentRecord(value.metadata);
    const facts = Array.isArray(value.operations) ? {
      ...value,
      inputKinds: metadata.inputKindsSource === "declared" ? value.inputKinds : undefined,
      outputKinds: metadata.outputKindsSource === "declared" ? value.outputKinds : undefined,
    } : value;
    const fallback = scanProviderModelCatalog([facts]).models[0]!;
    return [normalizeTk1688CnyModel({ ...fallback, ...value, id: value.id.trim(), name: typeof value.name === "string" ? value.name : value.id,
      metadata: { ...fallback.metadata, ...agentRecord(value.metadata) },
      operations: Array.isArray(value.operations) ? value.operations.filter(operation =>
        ["image.generate", "image.edit", "video.generate", "video.image-to-video"].includes(String(operation))) : fallback.operations } as ModelDescriptor)];
  });
}

export function agentCapabilities(connection: ProviderConnectionRecord, modelId: string): DirectorModelCapabilities {
  return resolveAgentCapabilities(connection, modelId, descriptors(connection.config.modelCatalogModels).find(model => model.id === modelId)).capabilities;
}

export interface AgentModelOption {
  supplierId: string; supplierName: string; group: string; connectionId: string; connectionName: string;
  modelId: string; modelName: string; protocol: DirectorProtocol; available: boolean; reason?: string;
  supplierKey?: string;
  description?: string;
  metadata?: ModelDescriptor["metadata"];
  pricing?: ModelDescriptor["pricing"];
  capabilities: DirectorModelCapabilities; source: "key" | "manual" | "catalog";
  reasoningOptions?: AgentReasoningOption[];
  reasoningSource?: AgentCapabilitySource;
  reasoningFallback?: { sourceUrl: string; checkedAt: string };
  reasoningNotice?: string;
  inputLimits?: AgentInputLimits;
  imageInputStatus?: AgentInputStatus;
  imageInputSource?: AgentCapabilitySource;
  audioInputStatus?: AgentInputStatus;
  audioInputSource?: AgentCapabilitySource;
  videoInputStatus?: AgentInputStatus;
  videoInputSource?: AgentCapabilitySource;
  capabilitySource?: AgentCapabilitySource;
}

/** Directory facts describe a model, but never grant that model to a Key. */
function supplementModel(primary: ModelDescriptor, catalog: ModelDescriptor): ModelDescriptor {
  const primaryMetadata = agentRecord(primary.metadata);
  const catalogMetadata = agentRecord(catalog.metadata);
  const declaredInput = primaryMetadata.inputKindsSource === "declared";
  const useCatalogInput = !declaredInput && catalogMetadata.inputKindsSource === "declared";
  const useCatalogOutput = primaryMetadata.outputKindsSource !== "declared" && catalogMetadata.outputKindsSource === "declared";
  return {
    ...catalog, ...primary,
    operations: primary.operations.length ? primary.operations : catalog.operations,
    inputKinds: useCatalogInput ? catalog.inputKinds : primary.inputKinds ?? catalog.inputKinds,
    outputKinds: useCatalogOutput ? catalog.outputKinds : primary.outputKinds ?? catalog.outputKinds,
    limits: { ...catalog.limits, ...primary.limits },
    metadata: {
      ...catalogMetadata, ...primaryMetadata,
      agentCapabilities: { ...declaredAgentFlags(catalog), ...declaredAgentFlags(primary) },
      ...(useCatalogInput ? { inputKindsSource: "declared" } : {}),
      ...(useCatalogOutput ? { outputKindsSource: "declared" } : {}),
    },
  };
}

/** Reuse saved group credentials; capability, not a legacy usage label, chooses the consumer. */
export async function loadAgentModels(): Promise<AgentModelOption[]> {
  const [connections, suppliers] = await Promise.all([repository.listConnections(), repository.listSuppliers()]);
  const options: AgentModelOption[] = [];
  for (const connection of connections) {
    const config = connection.config;
    if (config.usage === "disabled" || config.supplierArchived === true || ["cli", "fake"].includes(connection.provider)) continue;
    const supplier = suppliers.find(supplier => supplier.id === config.supplierId);
    if (supplier?.state?.visibility === "deleted" ||
      (supplier?.state && config.supplierSourceId !== supplier.state.sourceId) ||
      (!supplier && config.supplierSourceId)) continue;
    if (supplier) {
      try {
        if (normalizeSupplierSiteBase(String(config.baseUrl ?? "")) !== normalizeSupplierSiteBase(supplier.apiUrl || supplier.siteUrl)) continue;
      } catch { continue; }
    }
    const status = String(config.modelScanStatus ?? "");
    const saved = descriptors(config.modelCatalogModels);
    const scanned = status === "empty" ? [] : Array.isArray(config.scannedModelIds)
      ? config.scannedModelIds.filter((value): value is string => typeof value === "string")
      : status === "live" ? saved.map(model => model.id) : undefined;
    const authoritative = scanned !== undefined;
    const models = new Map<string, { model: ModelDescriptor; source: AgentModelOption["source"] }>();
    const add = (model: ModelDescriptor, source: AgentModelOption["source"]) => {
      if (!models.has(model.id)) models.set(model.id, { model, source });
    };
    for (const model of saved) add(model, "key");
    for (const id of scanned ?? []) if (id.trim()) add(scanProviderModelCatalog([{ id }]).models[0]!, "key");
    for (const raw of Array.isArray(config.manualModels) ? config.manualModels : []) {
      const model = agentRecord(raw);
      if (model.capability === "chat" && typeof model.id === "string" && model.id.trim()) add({
        id: model.id.trim(), name: typeof model.name === "string" ? model.name : model.id,
        operations: [], inputKinds: ["text"], outputKinds: ["text"],
        metadata: { agentProtocol: model.protocol },
      }, "manual");
    }
    // Connector templates describe request serialization, not this Key's grants.
    const connector = agentRecord(config.connector);
    for (const value of [config.models, connector.models])
      for (const model of descriptors(value)) add(model, "catalog");
    // Supplier group entries are hints only. A live Key inventory remains authoritative.
    const group = supplier?.catalog.groups.find(group => group.id === config.modelGroup);
    for (const model of group?.models ?? []) {
      const facts = agentRecord(model);
      const catalog = descriptors([{ ...facts, id: model.id, name: model.name || model.id,
        operations: model.capability === "image" ? ["image.generate"] : model.capability === "video" ? ["video.generate"] : [],
        metadata: { agentProtocol: model.protocol, ...agentRecord(facts.metadata) },
      }])[0];
      const existing = models.get(model.id);
      if (existing) existing.model = supplementModel(existing.model, catalog);
      else if (model.capability === "chat") add(catalog, "catalog");
    }
    for (const id of Array.isArray(config.allowedModels) ? config.allowedModels : []) {
      if (typeof id === "string" && id.trim()) add(scanProviderModelCatalog([{ id }]).models[0]!, "catalog");
    }
    if (!models.size && typeof config.defaultModel === "string" && config.defaultModel.trim()) {
      add(scanProviderModelCatalog([{ id: config.defaultModel }]).models[0]!, "catalog");
    }
    for (const [modelId, entry] of models) {
      if (!isAgentTextModel(entry.model)) continue;
      const reason = !connection.encryptedSecret ? "请在供应商中填写此分组的 Key" : status === "unauthorized" ? "当前 Key 鉴权失败" :
        authoritative && !scanned.includes(modelId) ? "当前 Key 未返回此模型" :
        !authoritative && (entry.source === "catalog" || status === "unscanned") ? "此模型尚未由当前 Key 返回，请刷新供应商模型" : undefined;
      const resolved = resolveAgentCapabilities(connection, modelId, entry.model);
      options.push({
        supplierId: supplier?.id ?? String(config.supplierId ?? `${config.supplierKey ?? connection.provider}:${config.baseUrl ?? connection.id}`),
        supplierName: supplier?.name ?? String(config.supplierName ?? connection.name.split(" · ")[0]),
        group: String(config.modelGroup ?? "默认分组"), connectionId: connection.id, connectionName: connection.name,
        modelId, modelName: entry.model.name, available: !reason, ...(reason ? { reason } : {}),
        supplierKey: supplier?.supplierKey ?? (typeof config.supplierKey === "string" ? config.supplierKey : undefined),
        ...(entry.model.description ? { description: entry.model.description } : {}),
        ...(entry.model.metadata ? { metadata: entry.model.metadata } : {}),
        ...(entry.model.pricing ? { pricing: entry.model.pricing } : {}),
        source: entry.source, ...resolved,
      });
    }
  }
  return options;
}

export async function resolveAgentModel(connectionId: string, modelId: string, reasoningEffort?: string): Promise<ResolvedDirectorConnection> {
  const connection = await repository.getConnection(connectionId);
  if (!connection || connection.config.supplierArchived === true || connection.config.usage === "disabled") throw new Error("请选择已接入且未停用的供应商分组");
  const model = (await loadAgentModels()).find(model => model.connectionId === connectionId && model.modelId === modelId);
  if (!model?.available) throw new Error(model?.reason ?? "当前分组没有此对话模型，请刷新供应商模型后重新选择");
  const effort = reasoningEffort === "auto" ? undefined : reasoningEffort;
  if (effort && !model.reasoningOptions?.some(option => option.value === effort)) throw new Error("当前模型或渠道不支持所选思考强度，请选择自动或列表中的强度");
  return resolveDirectorConnection({
    id: "agent", brainConnectionId: connection.id, brainModelId: modelId,
    config: { protocol: model.protocol, directorCapabilities: model.capabilities, ...(effort ? { reasoningEffort: effort } : {}) },
    createdAt: connection.createdAt, updatedAt: connection.updatedAt,
  });
}

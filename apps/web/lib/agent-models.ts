import type {
  DirectorModelCapabilities,
  DirectorProtocol,
  ResolvedDirectorConnection,
} from "@super-canvas/director";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import { repository } from "./server";
import { resolveDirectorConnection } from "./director-connections";
import { loadCangyuanCatalog } from "./cangyuan-catalog";

export const AGENT_PROTOCOLS = [
  "chat-completions",
  "responses",
  "anthropic-messages",
  "google-generate-content",
  "xai-responses",
  "generic-openai-compatible",
] as const;
export function agentProtocol(
  config: Record<string, unknown>,
): DirectorProtocol {
  const p = String(
    config.directorProtocol ?? config.protocol ?? "chat-completions",
  );
  if (p === "responses") return "openai-responses";
  if (p === "chat-completions") return "openai-chat-completions";
  if (
    [
      "openai-responses",
      "openai-chat-completions",
      "anthropic-messages",
      "google-generate-content",
      "xai-responses",
    ].includes(p)
  )
    return p as DirectorProtocol;
  return "generic-openai-compatible";
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export function agentCapabilities(
  c: ProviderConnectionRecord,
  modelId: string,
): DirectorModelCapabilities {
  const protocol = agentProtocol(c.config);
  const perModel = object(object(c.config.agentModelCapabilities)[modelId]);
  const source = Object.keys(perModel).length
    ? perModel
    : object(c.config.directorCapabilities);
  return {
    text: true,
    imageInput: source.imageInput === true,
    audioInput:
      source.audioInput === true &&
      [
        "openai-chat-completions",
        "generic-openai-compatible",
        "google-generate-content",
      ].includes(protocol),
    videoInput:
      source.videoInput === true && protocol === "google-generate-content",
    structuredOutput: source.structuredOutput === true,
    toolCalling:
      source.toolCalling === true && protocol === "anthropic-messages",
    nativeWebSearch: false,
    reasoning: source.reasoning === true,
    probeSource: source.probeSource === "live" ? "live" : "manual",
  };
}
export interface AgentModelOption {
  supplierId: string;
  supplierName: string;
  group: string;
  connectionId: string;
  connectionName: string;
  modelId: string;
  modelName: string;
  protocol: DirectorProtocol;
  available: boolean;
  reason?: string;
  capabilities: DirectorModelCapabilities;
  source: "key" | "manual" | "catalog";
}
export async function loadAgentModels(): Promise<AgentModelOption[]> {
  const [connections, suppliers] = await Promise.all([
    repository.listConnections(),
    repository.listSuppliers(),
  ]);
  const options: AgentModelOption[] = [];
  for (const c of connections.filter((c) => c.config.usage === "agent" && c.config.supplierArchived !== true)) {
    const supplier = suppliers.find((s) => s.id === c.config.supplierId);
    const ids = new Map<
      string,
      { name: string; source: AgentModelOption["source"] }
    >();
    const status = String(c.config.modelScanStatus ?? "");
    const scanned = Array.isArray(c.config.scannedModelIds)
      ? c.config.scannedModelIds.filter(
          (v): v is string => typeof v === "string",
        )
      : [];
    const authoritative = status === "live" || status === "empty";
    const add = (
      id: unknown,
      name: unknown,
      source: AgentModelOption["source"],
    ) => {
      if (typeof id === "string" && id.trim())
        ids.set(id, { name: typeof name === "string" ? name : id, source });
    };
    for (const m of Array.isArray(c.config.modelCatalogModels)
      ? c.config.modelCatalogModels
      : []) {
      const v = object(m);
      add(v.id, v.name, "key");
    }
    for (const m of scanned) add(m, m, "key");
    for (const m of Array.isArray(c.config.manualModels)
      ? c.config.manualModels
      : []) {
      const v = object(m);
      if (v.capability === "chat") add(v.id, v.name, "manual");
    }
    for (const m of Array.isArray(c.config.allowedModels)
      ? c.config.allowedModels
      : [])
      if (!ids.has(String(m))) add(m, m, "catalog");
    if (
      !ids.size &&
      /cangyuan/u.test(String(c.config.preset ?? c.config.supplierKey ?? ""))
    ) {
      const catalog = await loadCangyuanCatalog().catch(() => null);
      const group = catalog?.marketplaceGroups?.find(
        (g) => g.id === c.config.modelGroup,
      );
      for (const m of group?.models ?? [])
        if (m.capability === "chat") add(m.id, m.name, "catalog");
    }
    if (!ids.size) add(c.config.defaultModel, c.config.defaultModel, "manual");
    for (const [modelId, entry] of ids) {
      const denied = !c.encryptedSecret
        ? "请配置 Key"
        : status === "unauthorized"
          ? "Key 鉴权失败"
          : authoritative && !scanned.includes(modelId)
            ? "当前 Key 未返回此模型"
            : undefined;
      options.push({
        supplierId:
          supplier?.id ??
          `${c.config.supplierKey ?? c.provider}:${c.config.baseUrl ?? c.id}`,
        supplierName: supplier?.name ?? c.name,
        group: String(c.config.modelGroup ?? "默认分组"),
        connectionId: c.id,
        connectionName: c.name,
        modelId,
        modelName: entry.name,
        protocol: agentProtocol(c.config),
        available: !denied,
        reason: denied,
        capabilities: agentCapabilities(c, modelId),
        source: entry.source,
      });
    }
  }
  return options;
}
export async function resolveAgentModel(
  connectionId: string,
  modelId: string,
  reasoningEffort?: string,
): Promise<ResolvedDirectorConnection> {
  const c = await repository.getConnection(connectionId);
  if (!c || c.config.supplierArchived === true || c.config.usage !== "agent")
    throw new Error("请选择智能体用途的连接");
  const model = (await loadAgentModels()).find(
    (m) => m.connectionId === connectionId && m.modelId === modelId,
  );
  if (!model?.available)
    throw new Error(
      model?.reason ?? "模型未配置，请先扫描或手动添加准确模型 ID",
    );
  const caps = agentCapabilities(c, modelId);
  return resolveDirectorConnection({
    id: "agent",
    brainConnectionId: c.id,
    brainModelId: modelId,
    config: {
      protocol: agentProtocol(c.config),
      directorCapabilities: caps,
      ...(caps.reasoning && reasoningEffort ? { reasoningEffort } : {}),
    },
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  });
}

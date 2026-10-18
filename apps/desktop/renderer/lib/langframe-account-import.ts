import { randomUUID } from "node:crypto";
import type { ProviderConnectionRecord, SupplierRecord, SupplierState } from "@super-canvas/db";
import { langframeModelsForKey, type ModelDescriptor, type SupplierAccountKeys } from "@super-canvas/providers";

type ImportOptions = { verifyCapabilities?: boolean; preserveOnly?: boolean;
  matchesKey?: (connection: ProviderConnectionRecord, apiKey: string) => boolean };

/** A scope is an application view of one real Key, never an upstream group binding. */
export function langframeScopeGroupId(keyId: string, usage: "canvas" | "agent") {
  return `langframe-key:${keyId}:${usage}`;
}

export function langframeModelsInScope(supplier: SupplierRecord, config: Readonly<Record<string, unknown>>) {
  if (!Array.isArray(config.langframeAccountGroups) || !Array.isArray(config.langframeModelIds) ||
      [...config.langframeAccountGroups, ...config.langframeModelIds].some(value => typeof value !== "string" || !value.trim())) return [];
  const groups = supplier.catalog.groups.filter(group => !group.id.startsWith("langframe-key:") &&
    group.status !== "missing" && group.details?.stale !== true);
  const allowed = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const models = langframeModelsForKey(groups, allowed(config.langframeAccountGroups), allowed(config.langframeModelIds));
  return models.filter(model => config.usage === "agent" ? !model.operations.length && model.outputKinds?.includes("text")
    : model.operations.some(operation => operation.startsWith("image.") || operation.startsWith("video.")));
}

function catalogModel(model: ModelDescriptor): SupplierRecord["catalog"]["groups"][number]["models"][number] {
  return { id: model.id, name: model.name,
    capability: model.operations.some(operation => operation.startsWith("image.")) ? "image"
      : model.operations.some(operation => operation.startsWith("video.")) ? "video" : "chat",
    protocol: model.operations.length ? "rest" : "chat-completions",
    ...(typeof model.metadata?.priceLabel === "string" ? { priceLabel: model.metadata.priceLabel } : {}),
    inputKinds: model.inputKinds, outputKinds: model.outputKinds, limits: model.limits, metadata: model.metadata };
}

export function planLangframeAccountImport(supplier: SupplierRecord, connections: ProviderConnectionRecord[],
  inventory: SupplierAccountKeys, encrypt: (secret: string) => string,
  initialConnections: ProviderConnectionRecord[], options: ImportOptions) {
  const next = [...connections], groups = new Map(supplier.catalog.groups.map(group => [group.id, group]));
  const summary: NonNullable<SupplierState["keySync"]> = { status: inventory.complete ? "live" : inventory.keys.length ? "partial" : "failed",
    imported: 0, preserved: 0, skipped: inventory.skipped, multipleGroups: 0, checkedAt: inventory.checkedAt,
    ...(inventory.error ? { error: inventory.error } : {}) };
  for (const key of inventory.keys.filter(key => key.routing === "ordered-fallback")) {
    if (!Array.isArray(key.accountGroups) || !Array.isArray(key.modelIds)) { summary.skipped++; continue; }
    for (const usage of ["canvas", "agent"] as const) {
      const groupId = langframeScopeGroupId(key.id, usage);
      const config = { supplierId: supplier.id, supplierKey: supplier.supplierKey, supplierName: supplier.name,
        supplierSourceId: supplier.state!.sourceId, supplierWebsiteUrl: supplier.siteUrl,
        baseUrl: `${new URL(supplier.apiUrl || supplier.siteUrl).origin}/v1`, customGroup: false,
        modelGroup: groupId, usage, accountKeyId: key.id, accountKeyGroup: groupId,
        accountKeyImportedAt: inventory.checkedAt, langframeAccountGroups: [...key.accountGroups],
        langframeModelIds: [...key.modelIds], langframeRouting: "ordered-fallback",
        langframeKeyScope: true,
        ...(usage === "agent" ? { protocol: "chat-completions", directorProtocol: "openai-chat-completions" } : {}) };
      const models = langframeModelsInScope(supplier, config);
      const label = `Key ${key.name || key.id.slice(-8)} · ${usage === "canvas" ? "图片与视频" : "对话"}`;
      const existing = next.filter(connection => connection.config.supplierId === supplier.id &&
        connection.config.supplierSourceId === supplier.state!.sourceId && connection.config.supplierArchived !== true &&
        connection.config.accountKeyId === key.id && (connection.config.usage === usage || connection.config.modelGroup === groupId));
      const existedAtStart = initialConnections.some(connection => connection.config.supplierId === supplier.id &&
        connection.config.supplierSourceId === supplier.state!.sourceId && connection.config.accountKeyId === key.id &&
        (connection.config.usage === usage || connection.config.modelGroup === groupId));
      if (!existing.length && existedAtStart) { summary.skipped++; continue; }
      if (existing.length && !existing.some(connection => connection.config.usage !== "disabled" && connection.encryptedSecret &&
          JSON.stringify(initialConnections.find(item => item.id === connection.id)) === JSON.stringify(connection) &&
          options.matchesKey?.(connection, key.apiKey))) { summary.preserved += existing.length; continue; }
      if (!models.length && !existing.length) { groups.delete(groupId); continue; }
      groups.set(groupId, { id: groupId, label, source: "catalog", status: "available", models: models.map(catalogModel),
        details: { source: "key-groups", description: `应用中的 Key 可用范围；不是独立上游路由分组。${key.accountGroups.length
          ? `实际分组顺序：${key.accountGroups.join(" → ")}` : "实际允许全部分组"}。前组不可用时由供应商回退，按实际成功分组计费。` } });
      if (existing.length) {
        for (const connection of existing) {
          const before = initialConnections.find(item => item.id === connection.id);
          if (JSON.stringify(before) !== JSON.stringify(connection) || connection.config.usage === "disabled") { summary.skipped++; continue; }
          if (connection.encryptedSecret) {
            summary.preserved++;
            if (!options.matchesKey?.(connection, key.apiKey)) continue;
          } else { summary.skipped++; continue; }
          const merged = { ...connection.config, ...config };
          next[next.indexOf(connection)] = { ...connection, provider: "langframe",
            encryptedSecret: connection.encryptedSecret || encrypt(key.apiKey), config: merged };
          if (!connection.encryptedSecret) summary.imported++;
        }
        continue;
      }
      if (options.preserveOnly) { summary.skipped++; continue; }
      next.push({ id: randomUUID(), name: `${supplier.name} · ${label}`, provider: "langframe", encryptedSecret: encrypt(key.apiKey),
        config: { ...config, defaultModel: models[0]!.id, modelScanStatus: "unscanned", modelScanComplete: false,
          modelScanRequestId: randomUUID(), modelCatalogModels: [], scannedModelIds: [] },
        createdAt: inventory.checkedAt, updatedAt: inventory.checkedAt });
      summary.imported++;
    }
  }
  return { connections: next, summary, catalog: { groups: [...groups.values()] } };
}

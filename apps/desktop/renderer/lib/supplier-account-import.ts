import { randomUUID } from "node:crypto";
import type { ProviderConnectionRecord, SupplierRecord, SupplierState } from "@super-canvas/db";
import type { SupplierAccountKeys } from "@super-canvas/providers";
import { supplierConnectionDraft } from "./supplier-connection-draft";

/** Fill missing credentials only. The caller commits this plan with source/revision guards. */
export function planSupplierAccountImport(
  supplier: SupplierRecord,
  connections: ProviderConnectionRecord[],
  inventory: SupplierAccountKeys,
  encrypt: (secret: string) => string,
  initialConnections: ProviderConnectionRecord[] = connections,
) {
  const next = [...connections];
  const summary: NonNullable<SupplierState["keySync"]> = {
    status: inventory.complete ? "live" : inventory.keys.length ? "partial" : "failed",
    imported: 0, preserved: 0, skipped: inventory.skipped, multipleGroups: 0,
    checkedAt: inventory.checkedAt, ...(inventory.error ? { error: inventory.error } : {}),
  };
  const groups = new Map(supplier.catalog.groups.map(group => [group.id, group]));
  const keysByGroup = new Map<string, SupplierAccountKeys["keys"]>();
  for (const key of inventory.keys) {
    keysByGroup.set(key.group, [...(keysByGroup.get(key.group) ?? []), key]);
  }
  for (const [groupId, keys] of keysByGroup) {
    if (keys.length > 1) summary.multipleGroups++;
    // A stable choice avoids flipping between keys on each scan. Existing keys
    // below always take precedence, including manually entered keys.
    const key = [...keys].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? 1 : BigInt(a.id) > BigInt(b.id) ? -1 : 0)[0]!;
    const group = groups.get(groupId) ?? { id: groupId, label: groupId, source: "catalog" as const, models: [] };
    groups.set(groupId, { ...group, status: "available" });
    const existing = next.filter(connection =>
      connection.config.supplierId === supplier.id &&
      connection.config.supplierSourceId === supplier.state!.sourceId &&
      connection.config.supplierArchived !== true &&
      (connection.config.modelGroup === groupId || connection.config.accountKeyGroup === groupId));
    if (existing.length) {
      for (const connection of existing) {
        if (connection.encryptedSecret) { summary.preserved++; continue; }
        if (connection.config.usage === "disabled" || JSON.stringify(initialConnections.find(item => item.id === connection.id)) !== JSON.stringify(connection)) {
          summary.skipped++; continue;
        }
        next[next.indexOf(connection)] = {
          ...connection, encryptedSecret: encrypt(key.apiKey),
          config: { ...connection.config, accountKeyId: key.id, accountKeyGroup: groupId, accountKeyImportedAt: inventory.checkedAt,
            supplierName: supplier.name, modelScanStatus: "unscanned", modelScanRequestId: randomUUID(), supplierVerificationRequestId: randomUUID(),
            modelCatalogModels: [], scannedModelIds: [] },
        };
        summary.imported++;
      }
      continue;
    }
    const usage = group.models.length > 0 && group.models.every(model => model.capability === "chat" || model.capability === "other") ? "agent" : "canvas";
    const draft = supplierConnectionDraft(supplier.supplierKey, group, usage, supplier.apiUrl);
    next.push({
      id: randomUUID(), name: `${supplier.name} · ${group.id} · ${usage === "agent" ? "智能体" : "画布"}`,
      provider: draft.provider, encryptedSecret: encrypt(key.apiKey),
      config: { ...draft.config, supplierId: supplier.id, supplierName: supplier.name,
        supplierSourceId: supplier.state!.sourceId, accountKeyId: key.id, accountKeyGroup: groupId, accountKeyImportedAt: inventory.checkedAt,
        modelScanStatus: "unscanned", modelScanRequestId: randomUUID(), supplierVerificationRequestId: randomUUID(),
        ...(usage === "agent" ? { protocol: "chat-completions", directorProtocol: "openai-chat-completions" } : {}),
      } as ProviderConnectionRecord["config"],
      createdAt: inventory.checkedAt, updatedAt: inventory.checkedAt,
    });
    summary.imported++;
  }
  return { connections: next, summary, catalog: { groups: [...groups.values()] } };
}

import { randomUUID } from "node:crypto";
import type { ProviderConnectionRecord, SupplierRecord, SupplierState } from "@super-canvas/db";
import type { SupplierAccountKeys } from "@super-canvas/providers";
import { supplierConnectionDraft } from "./supplier-connection-draft";

function importedKeyConfig(config: ProviderConnectionRecord["config"], verifyCapabilities?: boolean) {
  const next = { ...config };
  // A cleared Key's old request cannot authorize verification of the new Key.
  if (verifyCapabilities === false) delete next.supplierVerificationRequestId;
  else next.supplierVerificationRequestId = randomUUID();
  return next;
}

function officialGroupId(value: unknown): string | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/u.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? String(number) : undefined;
}

/** Fill missing credentials only. The caller commits this plan with source/revision guards. */
export function planSupplierAccountImport(
  supplier: SupplierRecord,
  connections: ProviderConnectionRecord[],
  inventory: SupplierAccountKeys,
  encrypt: (secret: string) => string,
  initialConnections: ProviderConnectionRecord[] = connections,
  options: {
    verifyCapabilities?: boolean;
    previousCatalog?: SupplierRecord["catalog"];
    /** Catalog refreshes may reconcile proven existing Keys without importing any. */
    preserveOnly?: boolean;
    /** Server-only proof for legacy imports that did not save a group ID. */
    matchesKey?: (connection: ProviderConnectionRecord, apiKey: string) => boolean;
  } = {},
) {
  const next = [...connections];
  const summary: NonNullable<SupplierState["keySync"]> = {
    status: inventory.complete ? "live" : inventory.keys.length ? "partial" : "failed",
    imported: 0, preserved: 0, skipped: inventory.skipped, multipleGroups: 0,
    checkedAt: inventory.checkedAt, ...(inventory.error ? { error: inventory.error } : {}),
  };
  const groups = new Map(supplier.catalog.groups.map(group => [group.id, group]));
  const previousGroups = (options.previousCatalog ?? supplier.catalog).groups;
  const connectionGroupId = (connection: ProviderConnectionRecord) => {
    const stored = officialGroupId(connection.config.accountKeyGroupId);
    if (stored !== undefined) return stored;
    const name = connection.config.accountKeyGroup ?? connection.config.modelGroup;
    const matches = previousGroups.filter(group => group.source !== "manual" && group.id === name);
    const ids = [...new Set(matches.map(group => officialGroupId(group.supplierGroupId)).filter(id => id !== undefined))];
    return ids.length === 1 ? ids[0] : undefined;
  };
  const unchanged = (connection: ProviderConnectionRecord) =>
    JSON.stringify(initialConnections.find(item => item.id === connection.id)) === JSON.stringify(connection);
  const keysByGroup = new Map<string, SupplierAccountKeys["keys"]>();
  for (const key of inventory.keys) {
    const id = officialGroupId(key.supplierGroupId);
    const identity = id !== undefined ? `site-id:${id}` : `name:${key.group}`;
    keysByGroup.set(identity, [...(keysByGroup.get(identity) ?? []), key]);
  }
  for (const keys of keysByGroup.values()) {
    if (keys.length > 1) summary.multipleGroups++;
    // A stable choice avoids flipping between keys on each scan. Existing keys
    // below always take precedence, including manually entered keys.
    const key = [...keys].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? 1 : BigInt(a.id) > BigInt(b.id) ? -1 : 0)[0]!;
    const stableId = officialGroupId(key.supplierGroupId);
    const identifiedGroups = stableId !== undefined ? [...groups.values()].filter(group =>
      group.source !== "manual" && officialGroupId(group.supplierGroupId) === stableId) : [];
    // A merge may still contain the former name as missing/stale evidence.
    // Prefer the current Key inventory's exact name before old group records.
    const exactGroups = identifiedGroups.filter(group => group.id.replace(/ \[分组ID \d+\]$/u, "") === key.group);
    const candidates = exactGroups.length ? exactGroups : identifiedGroups;
    const available = candidates.filter(group => group.status !== "missing");
    const current = available.length ? available : candidates;
    if (current.length > 1) { summary.skipped += keys.length; continue; }
    const identified = current[0];
    const named = groups.get(key.group);
    const compatibleNamed = named && (stableId === undefined || named.supplierGroupId === undefined || officialGroupId(named.supplierGroupId) === stableId) ? named : undefined;
    const oldGroup = identified ?? compatibleNamed;
    const currentName = identified?.id.replace(/ \[分组ID \d+\]$/u, "");
    const targetName = identified && currentName === key.group ? identified.id
      : named && named !== oldGroup && stableId !== undefined ? `${key.group} [分组ID ${stableId}]` : key.group;
    const group = { ...(oldGroup ?? { label: key.group, source: "catalog" as const, models: [] }), id: targetName,
      ...(identified && currentName !== key.group ? { label: targetName } : {}),
      ...(stableId !== undefined ? { supplierGroupId: stableId } : {}) };
    const groupId = group.id;
    const verifiedLegacyKey = (connection: ProviderConnectionRecord) => {
      if (!connection.encryptedSecret || connectionGroupId(connection) !== undefined || !options.matchesKey) return false;
      return keys.some(candidate => {
        if (candidate.id !== connection.config.accountKeyId) return false;
        try { return options.matchesKey!(connection, candidate.apiKey); } catch { return false; }
      });
    };
    const existing = next.filter(connection =>
      connection.config.supplierId === supplier.id &&
      connection.config.supplierSourceId === supplier.state!.sourceId &&
      connection.config.supplierArchived !== true &&
      (() => {
        const previousId = connectionGroupId(connection);
        // A reassigned Key must not turn its former group into a rename.
        if (stableId !== undefined && previousId !== undefined) return stableId === previousId;
        return connection.config.modelGroup === groupId || connection.config.accountKeyGroup === groupId ||
          (stableId !== undefined && verifiedLegacyKey(connection));
      })());
    const provenGroup = (connection: ProviderConnectionRecord) => stableId !== undefined &&
      (connectionGroupId(connection) === stableId || verifiedLegacyKey(connection));
    // Read-only catalog reconciliation cannot introduce groups from unrelated
    // account Keys or fill a connection whose credential was cleared.
    if (options.preserveOnly && !existing.some(connection => connection.encryptedSecret && provenGroup(connection) &&
      connection.config.usage !== "disabled" && unchanged(connection))) {
      summary.skipped += keys.length; continue;
    }
    if (oldGroup && oldGroup.id !== groupId) groups.delete(oldGroup.id);
    groups.set(groupId, { ...group, status: "available" });
    if (existing.length) {
      for (const connection of existing) {
        if (connection.encryptedSecret) {
          summary.preserved++;
          if (provenGroup(connection) && connection.config.usage !== "disabled" && unchanged(connection) &&
            (connection.config.accountKeyGroupId !== stableId || connection.config.accountKeyGroup !== groupId || connection.config.modelGroup !== groupId)) {
            next[next.indexOf(connection)] = { ...connection,
              config: { ...connection.config, accountKeyGroupId: stableId, accountKeyGroup: groupId, modelGroup: groupId } };
          }
          continue;
        }
        if (options.preserveOnly || connection.config.usage === "disabled" || !unchanged(connection)) {
          summary.skipped++; continue;
        }
        next[next.indexOf(connection)] = {
          ...connection, encryptedSecret: encrypt(key.apiKey),
          config: importedKeyConfig({ ...connection.config, accountKeyId: key.id, accountKeyGroup: groupId, accountKeyImportedAt: inventory.checkedAt,
            ...(stableId !== undefined ? { accountKeyGroupId: stableId } : {}), modelGroup: groupId,
            supplierName: supplier.name, modelScanStatus: "unscanned", modelScanComplete: false,
            modelScanError: null, modelScanErrorCode: null, modelScanHttpStatus: null,
            modelScanCheckedAt: null, modelScanLastSuccessAt: null, modelScanAttemptStatus: "unscanned",
            modelScanRequestId: randomUUID(),
            modelCatalogModels: [], scannedModelIds: [] }, options.verifyCapabilities),
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
      config: importedKeyConfig({ ...draft.config, supplierId: supplier.id, supplierName: supplier.name,
        supplierSourceId: supplier.state!.sourceId, accountKeyId: key.id, accountKeyGroup: groupId, accountKeyImportedAt: inventory.checkedAt,
        ...(stableId !== undefined ? { accountKeyGroupId: stableId } : {}),
        modelScanStatus: "unscanned", modelScanComplete: false,
        modelScanError: null, modelScanErrorCode: null, modelScanHttpStatus: null,
        modelScanCheckedAt: null, modelScanLastSuccessAt: null, modelScanAttemptStatus: "unscanned",
        modelScanRequestId: randomUUID(),
        ...(usage === "agent" ? { protocol: "chat-completions", directorProtocol: "openai-chat-completions" } : {}),
      } as ProviderConnectionRecord["config"], options.verifyCapabilities),
      createdAt: inventory.checkedAt, updatedAt: inventory.checkedAt,
    });
    summary.imported++;
  }
  return { connections: next, summary, catalog: { groups: [...groups.values()] } };
}

export type SettingsSection = "suppliers" | "personal-ai" | "reference" | "cloud" | "appearance";

/** A home entry only selects saved data; it never probes or changes a connection. */
export function initialSettingsSection(section?: SettingsSection, connectionId?: string | null, addingAccount = false): SettingsSection {
  return section ?? (connectionId || addingAccount ? "personal-ai" : "suppliers");
}

export function settingsSupplierTarget<T extends { id: string; supplierKey: string }>(entries: readonly T[], selectionId: string, cangyuanGroup?: string | null): T | undefined {
  return entries.find(entry => entry.id === selectionId)
    ?? entries.find(entry => entry.supplierKey === selectionId)
    ?? (cangyuanGroup ? entries.find(entry => entry.supplierKey === "cangyuan") : undefined)
    ?? entries[0];
}

export function settingsAccountTarget<T extends { id: string; provider: string }>(connections: readonly T[], connectionId?: string | null, adding = false): T | undefined {
  if (adding) return undefined;
  return connections.find(connection => connection.provider === "cli" && connection.id === connectionId)
    ?? connections.find(connection => connection.provider === "cli");
}

import type { ModelDescriptor } from "@super-canvas/providers";
import { modelSupportsGenerationMedia } from "@super-canvas/providers/model-media";
import { cleanModelDisplayName } from "./model-display";
import { modelCanvasUnavailableReason } from "./graph-ui";
import { tk1688ModelFamily, tk1688ModelSearchText } from "./tk1688-model-display";

export const MODEL_PICKER_PAGE_SIZE = 40;
export const RECENT_MODELS_KEY = "super-canvas.recent-models.v1";
export type ModelKindFilter = "all" | "image" | "video" | "music";
export type ModelStatusFilter = "all" | "runnable" | "verified" | "recent";
export type RecentModels = Array<{ connectionId: string; modelIds: string[] }>;

export function modelWasVerified(model: ModelDescriptor): boolean {
  return typeof model.metadata?.imageCapabilitiesVerifiedAt === "string";
}

export function filterPickerModels(models: readonly ModelDescriptor[], query: string, kind: ModelKindFilter,
  status: ModelStatusFilter, recentIds: readonly string[]): ModelDescriptor[] {
  const words = query.normalize("NFKC").trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const recent = new Set(recentIds);
  const filtered = models.filter(model => {
    const searchable = tk1688ModelFamily(model) ? tk1688ModelSearchText(model)
      : `${cleanModelDisplayName(model.name, model.metadata?.priceLabel)} ${model.id}`.normalize("NFKC").toLocaleLowerCase();
    return words.every(word => searchable.includes(word)) &&
      (kind === "all" || modelSupportsGenerationMedia(model, kind)) &&
      (status !== "runnable" || (model.operations.length > 0 && modelCanvasUnavailableReason(model) === null)) &&
      (status !== "verified" || modelWasVerified(model)) &&
      (status !== "recent" || recent.has(model.id));
  });
  // A remembered ID can only select a model still present in this connection's catalog.
  return status === "recent" ? filtered.sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id)) : filtered;
}

export function readRecentModels(raw: string | null): RecentModels {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && typeof item.connectionId === "string" && Array.isArray(item.modelIds))
      .slice(0, 40).map(item => ({ connectionId: item.connectionId,
        modelIds: [...new Set<string>(item.modelIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0))].slice(0, 8) }));
  } catch { return []; }
}

export function rememberModel(recent: RecentModels, connectionId: string, modelId: string): RecentModels {
  if (!connectionId || !modelId) return recent;
  return [{ connectionId, modelIds: [modelId, ...(recent.find(item => item.connectionId === connectionId)?.modelIds ?? []).filter(id => id !== modelId)].slice(0, 8) },
    ...recent.filter(item => item.connectionId !== connectionId)].slice(0, 40);
}

export interface PickerConnection {
  id: string; name: string; supplier: string; supplierLabel: string; group: string;
  available?: boolean; unavailableReason?: string;
  modelMatch?: boolean;
}

/** Show readable names; a short ID disambiguates only genuinely identical names. */
export function pickerConnectionLabel(connection: PickerConnection, peers: readonly PickerConnection[]): string {
  const name = connection.name.trim() || "API 连接";
  const sameName = peers.filter(peer => (peer.name.trim() || "API 连接") === name);
  if (sameName.length < 2) return name;
  let length = Math.min(8, connection.id.length);
  while (length < connection.id.length && sameName.some(peer => peer.id !== connection.id &&
    peer.id.slice(0, length) === connection.id.slice(0, length))) length++;
  return `${name} · ${connection.id.slice(0, length)}`;
}

export function pickerConnectionGroups<T extends PickerConnection>(connections: readonly T[], supplier: string) {
  const groups = new Map<string, { group: string; available: boolean; connections: T[] }>();
  for (const connection of connections) {
    if (connection.supplier !== supplier) continue;
    const group = groups.get(connection.group) ?? { group: connection.group, available: false, connections: [] };
    group.connections.push(connection);
    group.available ||= connection.available !== false;
    groups.set(connection.group, group);
  }
  return [...groups.values()];
}

/** Preview and select the same connection, preserving a saved selection before exact-model preferences. */
export function choosePickerConnection<T extends PickerConnection>(connections: readonly T[], currentId: string,
  supplier: string, group?: string): T | undefined {
  const candidates = connections.filter(connection => connection.supplier === supplier && (group === undefined || connection.group === group));
  return candidates.find(connection => connection.id === currentId) ??
    candidates.find(connection => connection.available !== false && connection.modelMatch === true) ??
    candidates.find(connection => connection.available !== false) ?? candidates[0];
}

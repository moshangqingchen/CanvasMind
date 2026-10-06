import { isTk1688ApiUrl } from "@super-canvas/providers/tk1688-model-policy";
import type { ProviderConnectionView } from "./client-api";
import { providerConnectionGroup, providerConnectionUsage } from "./provider-connection-options";

type Connection = ProviderConnectionView;

function purposeCopyIdentity(connection: Connection): string | undefined {
  const config = connection.config;
  // A custom connector or hand-authored model mapping may deliberately behave
  // differently even when it uses the same upstream key.
  if (["connector", "manualModels", "modelInterfaces"].some(field => config[field] !== undefined)) return undefined;
  const usage = providerConnectionUsage(connection);
  const ordinaryImage = usage === "canvas" && connection.provider === "openai" && config.protocol === "openai-images";
  const ordinaryText = usage === "agent" && connection.provider === "rest" &&
    ["openai-chat", "chat-completions", "openai-chat-completions"].includes(String(config.protocol));
  if (!ordinaryImage && !ordinaryText) return undefined;
  const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl.trim().replace(/\/+$/u, "") : "";
  if (!isTk1688ApiUrl(baseUrl)) return undefined;
  const supplierId = typeof config.supplierId === "string" ? config.supplierId.trim() : "";
  const sourceId = typeof config.supplierSourceId === "string" ? config.supplierSourceId.trim() : "";
  const keyId = typeof config.accountKeyId === "string" ? config.accountKeyId.trim() : "";
  // Names and model inventories cannot prove that two connections use the same
  // account/key. Keep manually entered and legacy identities independently.
  if (!supplierId || !sourceId || !keyId) return undefined;
  return JSON.stringify([supplierId, sourceId, keyId, baseUrl, providerConnectionGroup(connection)]);
}

/** Collapse only a proven image/text purpose pair in the visible canvas picker.
 * Saved node IDs and standalone agent connections remain valid candidates. */
export function canvasPickerConnections<T extends Connection>(
  connections: readonly T[],
  selectedId: string | undefined,
  available: (connection: T) => boolean,
): T[] {
  const pairs = new Map<string, T[]>();
  for (const connection of connections) {
    const identity = purposeCopyIdentity(connection);
    if (identity) pairs.set(identity, [...(pairs.get(identity) ?? []), connection]);
  }
  const hidden = new Set<string>();
  for (const pair of pairs.values()) {
    // Multiple configurations of the same purpose can represent intentional
    // transports. Do not choose among them or hide a genuine connection.
    if (pair.length !== 2) continue;
    const canvas = pair.find(connection => providerConnectionUsage(connection) === "canvas");
    const agent = pair.find(connection => providerConnectionUsage(connection) === "agent");
    if (!canvas || !agent) continue;
    const selected = pair.find(connection => connection.id === selectedId);
    // An unavailable historical selection needs its usable peer as an explicit
    // recovery choice; merely opening the picker must never replace that ID.
    if (selected && !available(selected) && pair.some(available)) continue;
    const visible = selected ?? (available(canvas) ? canvas : available(agent) ? agent : canvas);
    hidden.add((visible === canvas ? agent : canvas).id);
  }
  return connections.filter(connection => !hidden.has(connection.id));
}

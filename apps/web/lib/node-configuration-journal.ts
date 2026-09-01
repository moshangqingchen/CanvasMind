import type { CanvasNode, CanvasNodeData } from "../components/types";

const STORAGE_KEY = "super-canvas:node-configuration-journal:v1";
const MAX_ENTRY_AGE_MS = 24 * 60 * 60 * 1_000;

export interface PendingNodeConfiguration {
  version: 1;
  token: string;
  canvasId: string;
  nodeId: string;
  savedAt: number;
  data: Pick<
    CanvasNodeData,
    "provider" | "connectionId" | "model" | "inputs" | "parameters"
  >;
}

function storageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPendingNodeConfiguration(
  value: unknown,
): value is PendingNodeConfiguration {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  return (
    value.version === 1 &&
    typeof value.token === "string" &&
    typeof value.canvasId === "string" &&
    typeof value.nodeId === "string" &&
    typeof value.savedAt === "number"
  );
}

function writeEntries(
  entries: readonly PendingNodeConfiguration[],
  storage = storageOrNull(),
): void {
  if (!storage) return;
  try {
    if (entries.length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Local storage is only a refresh-safety journal; normal server saves still
    // work when storage is unavailable or full.
  }
}

export function readPendingNodeConfigurations(
  storage = storageOrNull(),
  now = Date.now(),
): PendingNodeConfiguration[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries = parsed.filter(
      (entry): entry is PendingNodeConfiguration =>
        isPendingNodeConfiguration(entry) &&
        now - entry.savedAt >= 0 &&
        now - entry.savedAt <= MAX_ENTRY_AGE_MS,
    );
    if (entries.length !== parsed.length) writeEntries(entries, storage);
    return entries;
  } catch {
    return [];
  }
}

function configurationData(
  data: CanvasNodeData,
): PendingNodeConfiguration["data"] {
  return {
    provider: data.provider,
    connectionId: data.connectionId,
    // An empty model is meaningful: it is the explicit "automatic" choice.
    model: data.model ?? "",
    inputs: data.inputs,
    parameters: data.parameters,
  };
}

export function journalNodeConfiguration(
  canvasId: string,
  node: CanvasNode,
  storage = storageOrNull(),
): PendingNodeConfiguration[] {
  const now = Date.now();
  const entry: PendingNodeConfiguration = {
    version: 1,
    token:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${now}-${Math.random().toString(36).slice(2)}`,
    canvasId,
    nodeId: node.id,
    savedAt: now,
    data: configurationData(node.data),
  };
  const entries = readPendingNodeConfigurations(storage, now).filter(
    (candidate) =>
      candidate.canvasId !== canvasId || candidate.nodeId !== node.id,
  );
  entries.push(entry);
  writeEntries(entries, storage);
  return entries.filter((candidate) => candidate.canvasId === canvasId);
}

export function applyPendingNodeConfigurations(
  nodes: CanvasNode[],
  canvasId: string,
  entries: readonly PendingNodeConfiguration[],
): CanvasNode[] {
  const patches = new Map(
    entries
      .filter((entry) => entry.canvasId === canvasId)
      .map((entry) => [entry.nodeId, entry.data] as const),
  );
  let changed = false;
  const next = nodes.map((node) => {
    const patch = patches.get(node.id);
    if (!patch) return node;
    changed = true;
    return { ...node, data: { ...node.data, ...patch } };
  });
  return changed ? next : nodes;
}

export function clearPersistedNodeConfigurations(
  persistedEntries: readonly PendingNodeConfiguration[] | undefined,
  storage = storageOrNull(),
): void {
  if (!persistedEntries?.length || !storage) return;
  const persistedTokens = new Set(
    persistedEntries.map((entry) => entry.token),
  );
  const remaining = readPendingNodeConfigurations(storage).filter(
    (entry) => !persistedTokens.has(entry.token),
  );
  writeEntries(remaining, storage);
}

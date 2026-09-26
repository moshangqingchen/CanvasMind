import type { DirectorAdapterInput } from "@super-canvas/director";

// Character budgets are deterministic across compatible gateways. They bound
// text payloads without pretending to know each provider's tokenization.
export const AGENT_CONTEXT_CHARACTERS = 64_000;
export const AGENT_SYSTEM_CHARACTERS = 16_000;
export const AGENT_OBSERVATION_CHARACTERS = 16_000;
type Message = DirectorAdapterInput["messages"][number];

export function clipContextText(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const marker = "\n[内容过长，已省略中段；需要细节时请按 ID 查询]";
  const remaining = Math.max(0, maximum - marker.length);
  return value.slice(0, Math.ceil(remaining * 0.7)) + marker.slice(0, maximum) +
    value.slice(value.length - Math.floor(remaining * 0.3));
}

/** Keep the current request intact; fill the remaining budget newest-first. */
export function boundedAgentContext(
  system: string,
  messages: readonly Message[],
  currentRequest?: string,
): Pick<DirectorAdapterInput, "system" | "messages"> {
  const boundedSystem = clipContextText(system, AGENT_SYSTEM_CHARACTERS);
  let remaining = AGENT_CONTEXT_CHARACTERS - boundedSystem.length;
  const selected = new Map<number, Message>();
  let current = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user" && messages[i]!.content === currentRequest) { current = i; break; }
  }
  if (current >= 0) {
    const message = messages[current]!;
    const content = clipContextText(message.content, remaining);
    selected.set(current, { ...message, content });
    remaining -= content.length;
  }
  for (let i = messages.length - 1; i >= 0 && remaining > 0; i--) {
    if (i === current) continue;
    const message = messages[i]!;
    const content = clipContextText(message.content, Math.min(16_000, remaining));
    selected.set(i, { ...message, content });
    remaining -= content.length;
  }
  return { system: boundedSystem, messages: [...selected].sort(([a], [b]) => a - b).map(([, m]) => m) };
}

/** Preserve JSON structure and mark omitted fields instead of slicing JSON. */
export function compactObservation(value: unknown, maximum = AGENT_OBSERVATION_CHARACTERS): unknown {
  const encoded = JSON.stringify(value) ?? "null";
  if (encoded.length <= maximum) return value;
  const shrink = (item: unknown, depth: number): unknown => {
    if (typeof item === "string") return clipContextText(item, 600);
    if (!item || typeof item !== "object") return item;
    if (depth > 5) return { truncated: true };
    if (Array.isArray(item)) return item.slice(0, 16).map(v => shrink(v, depth + 1)).concat(
      item.length > 16 ? [{ truncated: true, omittedItems: item.length - 16 }] : [],
    );
    return Object.fromEntries(Object.entries(item).map(([key, v]) => [key, shrink(v, depth + 1)]));
  };
  const compact = shrink(value, 0);
  const structured = { truncated: true, data: compact };
  if (JSON.stringify(structured).length <= maximum) return structured;
  const summary = { truncated: true, summary: clipContextText(encoded, Math.max(0, maximum - 100)) };
  // A JSON string can expand when encoded again (quotes, slashes, newlines).
  // Budget the actual transport representation, not only string.length.
  while (JSON.stringify(summary).length > maximum && summary.summary.length) {
    const excess = JSON.stringify(summary).length - maximum;
    summary.summary = clipContextText(summary.summary, Math.max(0, summary.summary.length - excess - 1));
  }
  return summary;
}

export function observationPage<T>(items: readonly T[], options: { offset?: number; limit?: number; maximumCharacters?: number }) {
  const offset = Math.min(items.length, Math.max(0, options.offset ?? 0));
  const limit = Math.min(30, Math.max(1, options.limit ?? 15));
  const selected: unknown[] = [];
  const maximum = options.maximumCharacters ?? AGENT_OBSERVATION_CHARACTERS;
  let characters = 0;
  for (const item of items.slice(offset, offset + limit)) {
    const compact = compactObservation(item, Math.min(10_000, maximum - 200));
    const length = JSON.stringify(compact).length;
    if (selected.length && characters + length > maximum - 200) break;
    selected.push(compact);
    characters += length;
  }
  const nextOffset = offset + selected.length;
  return { items: selected, total: items.length, offset, ...(nextOffset < items.length ? { nextOffset } : {}) };
}

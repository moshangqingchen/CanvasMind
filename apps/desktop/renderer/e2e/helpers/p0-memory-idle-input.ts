export type MemoryInputCounts = { pointerDown: number; wheel: number; keyDown: number; untrusted: number };
const keys = ["pointerDown", "wheel", "keyDown", "untrusted"] as const;

/** Reads fixed scalar counters only, never event keys, positions or text. */
export function readMemoryInputCounts(sample: Record<string, unknown> | undefined): MemoryInputCounts | null {
  const visibility = sample?.visibility;
  if (typeof visibility !== "object" || visibility === null || !("input" in visibility)) return null;
  const input = visibility.input;
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  if (!keys.every(key => typeof record[key] === "number" && Number.isSafeInteger(record[key]) && Number(record[key]) >= 0)) return null;
  return { pointerDown: Number(record.pointerDown), wheel: Number(record.wheel), keyDown: Number(record.keyDown), untrusted: Number(record.untrusted) };
}

export function memoryInputCountsChanged(before: MemoryInputCounts, after: MemoryInputCounts): boolean {
  return keys.some(key => before[key] !== after[key]);
}

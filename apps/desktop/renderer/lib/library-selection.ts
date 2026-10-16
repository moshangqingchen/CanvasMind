/** Shift selects the current filtered order; a missing anchor starts a fresh range. */
export function selectLibraryRange(ids: readonly string[], anchor: string | null, target: string, base: ReadonlySet<string> = new Set()) {
  const end = ids.indexOf(target);
  const start = anchor === null ? -1 : ids.indexOf(anchor);
  if (end < 0) return new Set(base);
  return new Set([...base, ...ids.slice(start < 0 ? end : Math.min(start, end), Math.max(start, end) + 1)]);
}

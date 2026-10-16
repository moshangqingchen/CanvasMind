/** Window rows by measured height; offsets include the final bottom edge. */
export function virtualWindow(offsets: readonly number[], scroll: number, height: number, overscan = 2) {
  const count = Math.max(0, offsets.length - 1);
  const locate = (value: number) => {
    let low = 0;
    let high = count;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (offsets[mid + 1]! <= value) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const start = Math.max(0, Math.min(count - 1, locate(Math.max(0, scroll))) - overscan);
  const end = Math.min(count, locate(Math.max(0, scroll) + Math.max(0, height)) + 1 + overscan);
  return { start, end, top: offsets[start] ?? 0, bottom: (offsets[count] ?? 0) - (offsets[end] ?? 0) };
}

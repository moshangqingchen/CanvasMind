// Historical samples retain the default 6 GiB floor. Phase 6 may explicitly
// select a user-approved daily-use environment; reject typos instead of weakening it.
export function resolvePerformanceMemoryEnvironment(override?: string) {
  if (override !== undefined && override !== "2.5" && override !== "4" && override !== "6") {
    throw new Error("UI_PERF_MIN_RAM_GIB must be explicitly 2.5, 4 or 6");
  }
  const minimumAvailableMemoryGiB = override === "2.5" ? 2.5 : override === "4" ? 4 : 6;
  return {
    minimumAvailableMemoryGiB,
    minimumAvailableMemoryBytes: minimumAvailableMemoryGiB * 1024 ** 3,
    environmentLabel: `ram-floor-${minimumAvailableMemoryGiB}gib-${override === undefined ? "default" : "explicit"}`,
  } as const;
}

export const performanceMemoryEnvironment = resolvePerformanceMemoryEnvironment(process.env.UI_PERF_MIN_RAM_GIB);
export const { minimumAvailableMemoryGiB, minimumAvailableMemoryBytes } = performanceMemoryEnvironment;

export function memorySampleValidity(...availableBytes: number[]) {
  return availableBytes.length > 0 && availableBytes.every(bytes => Number.isFinite(bytes) && bytes >= minimumAvailableMemoryBytes);
}

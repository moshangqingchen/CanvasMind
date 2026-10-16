import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePerformanceMemoryEnvironment } from "../e2e/helpers/performance-environment";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("performance measurement memory environment", () => {
  it("keeps the historical default at 6 GiB and labels it", () => {
    expect(resolvePerformanceMemoryEnvironment()).toEqual({
      minimumAvailableMemoryGiB: 6,
      minimumAvailableMemoryBytes: 6 * 1024 ** 3,
      environmentLabel: "ram-floor-6gib-default",
    });
  });

  it.each(["2.5", "4", "6"])("records the explicitly approved %s GiB environment", value => {
    expect(resolvePerformanceMemoryEnvironment(value)).toEqual({
      minimumAvailableMemoryGiB: Number(value),
      minimumAvailableMemoryBytes: Number(value) * 1024 ** 3,
      environmentLabel: `ram-floor-${value}gib-explicit`,
    });
  });

  it.each(["", "0", "2.50", "3", "4.0", "5", "7", "4 ", "NaN"])("rejects an unapproved or malformed floor: %j", value => {
    expect(() => resolvePerformanceMemoryEnvironment(value)).toThrow("UI_PERF_MIN_RAM_GIB must be explicitly 2.5, 4 or 6");
  });

  it.each(["2.5", "4", "6"])("invalidates every sample boundary below its explicit %s GiB floor", async value => {
    vi.stubEnv("UI_PERF_MIN_RAM_GIB", value);
    vi.resetModules();
    const { memorySampleValidity, performanceMemoryEnvironment } = await import("../e2e/helpers/performance-environment");
    const floor = Number(value) * 1024 ** 3;
    expect(performanceMemoryEnvironment.minimumAvailableMemoryBytes).toBe(floor);
    expect(memorySampleValidity(floor, floor + 1)).toBe(true);
    expect(memorySampleValidity(floor - 1, floor)).toBe(false);
    expect(memorySampleValidity(floor, floor - 1)).toBe(false);
    expect(memorySampleValidity()).toBe(false);
    expect(memorySampleValidity(Number.NaN, floor)).toBe(false);
    expect(memorySampleValidity(Number.POSITIVE_INFINITY, floor)).toBe(false);
  });
});

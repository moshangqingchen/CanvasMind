/** User-authorized bounds fill missing supplier facts; they are not official limits. */
export interface SeedanceDurationFallback {
  family: "seedance-2.0" | "seedance-2.5";
  min: number;
  max: number;
}

export function seedanceDurationFamily(id: string): SeedanceDurationFallback["family"] | undefined {
  const versions = [...id.matchAll(/(?:^|[^a-z0-9])(?:seedance|sd)[\s_-]*2[._-]([05])(?=$|[^a-z0-9.])/giu)]
    .map(match => match[1]);
  if (!versions.length || new Set(versions).size !== 1) return undefined;
  return versions[0] === "0" ? "seedance-2.0" : "seedance-2.5";
}

export function seedanceDurationFallback(id: string, facts: {
  min?: number | undefined;
  max?: number | undefined;
  values?: readonly unknown[] | undefined;
  default?: unknown;
}): SeedanceDurationFallback | undefined {
  const family = seedanceDurationFamily(id);
  if (!family || facts.values?.length || facts.min !== undefined && facts.max !== undefined) return undefined;
  const min = facts.min ?? 1, max = facts.max ?? (family === "seedance-2.0" ? 15 : 30);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return undefined;
  // A documented default is evidence too. Never erase it or silently widen the
  // user's fallback to accommodate an incompatible supplier declaration.
  if (facts.default !== undefined && (typeof facts.default !== "number" || !Number.isInteger(facts.default) || facts.default < min || facts.default > max)) return undefined;
  return { family, min, max };
}

export function seedanceDurationFallbackMetadata(fallback: SeedanceDurationFallback | undefined): Record<string, unknown> {
  return fallback ? { durationRangeSource: "user-fallback", durationRangeUnverified: false,
    durationRangeFallbackFamily: fallback.family, userFallbackDurationRange: { min: fallback.min, max: fallback.max } } : {};
}

export function seedanceDurationFallbackDescription(fallback: SeedanceDurationFallback): string {
  return `供应商未公布完整时长范围，按用户指定兜底使用 ${fallback.min}–${fallback.max} 秒；这不是供应商官方范围，已公布的参数与组合限制优先。`;
}

import type { ModelParameterOption } from "./contracts.js";

/** Expand a supported/default highest request value without implying per-tier tests. */
export function imageQualityPresetsForHighest(
  modelId: string,
  qualities: readonly string[],
): ModelParameterOption[] | undefined {
  // A quality-specific model remains a separate SKU.
  if (/-(?:low|medium|high)$/u.test(modelId)) return undefined;
  const values = /^gpt-image-2\.5(?:-|$)/u.test(modelId)
    ? ["auto", "low", "medium", "high", "xhigh", "max"]
    : /^gpt-image-2(?:-|$)/u.test(modelId) ? ["low", "medium", "high"] : undefined;
  if (!values || !qualities.includes(values[values.length - 1]!)) return undefined;
  const labels: Record<string, string> = { auto: "自动", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高" };
  return values.map(value => ({ value, label: `${labels[value]}（${value}）` }));
}

/** Existing adapters call this only with their exact successful request evidence. */
export const imageQualityPresetsAfterSuccess = imageQualityPresetsForHighest;

export const IMAGE_QUALITY_PRESET_DESCRIPTION = "最高档已通过，开放同型号全部质量选项；其余选项未逐档实测。";

import type { ModelParameterDescriptor } from "@super-canvas/providers";
import type { GenerationNodeType } from "./graph-ui";

type VideoDurationControl =
  | { kind: "fixed"; value: number }
  | { kind: "range"; value: number; min: number; max: number; step: number };

/** Use the already-resolved supplier contract, never an inferred duration range. */
export function videoDurationControl(
  nodeType: GenerationNodeType,
  descriptor: ModelParameterDescriptor,
  value: unknown,
  rangeUnverified = false,
  conditionalUpperBoundConfirmed = false,
): VideoDurationControl | undefined {
  if (nodeType !== "video-generation" || !["duration", "seconds"].includes(descriptor.key)) return;
  const numeric = typeof value === "number" ? value
    : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return;
  if (descriptor.valueType === "integer" && !Number.isInteger(numeric)) return;

  if (descriptor.control === "select") {
    const options = descriptor.options ?? [];
    return options.length === 1 && String(options[0]?.value) === String(value)
      ? { kind: "fixed", value: numeric } : undefined;
  }
  // Number-control options can be suggestions or special automatic sentinels,
  // rather than an exhaustive enum. Keep their original editing semantics.
  if (descriptor.control !== "number" || descriptor.options?.length) return;
  // Older saved catalogs predate the explicit provenance flag. Their existing
  // warning still distinguishes an editor guard from a published supplier cap.
  if (!conditionalUpperBoundConfirmed && (rangeUnverified || /未公开[^。；;]*上限/u.test(descriptor.description ?? ""))) return;
  const { min, max } = descriptor;
  const step = descriptor.step ?? 1;
  if (min === undefined || max === undefined || !Number.isFinite(min) ||
      !Number.isFinite(max) || !Number.isFinite(step) || min < 0 || max < min || step <= 0) return;
  if (descriptor.valueType === "integer" && ![min, max, step, numeric].every(Number.isInteger)) return;
  const offset = (numeric - min) / step;
  if (numeric < min || numeric > max || Math.abs(offset - Math.round(offset)) > 1e-8) return;
  if (min === max) return { kind: "fixed", value: numeric };
  // The slider endpoint must itself satisfy the supplier's step constraint.
  const reachableMax = min + Math.floor((max - min) / step + 1e-8) * step;
  if (!Number.isFinite(reachableMax) || reachableMax <= min) return;
  return { kind: "range", value: numeric, min, max: reachableMax, step };
}

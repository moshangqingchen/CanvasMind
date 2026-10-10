import type { ModelDescriptor, ModelParameterDescriptor } from "@super-canvas/providers";
import type { GenerationNodeType } from "./graph-ui";

type VideoDurationControl =
  | { kind: "select"; options: NonNullable<ModelParameterDescriptor["options"]> }
  | { kind: "unavailable"; reason: string; confirmedDefault?: string | number | boolean }
  | { kind: "range"; value: number; min: number; max: number; step: number; invalidValue?: string };

export function confirmedVideoParameterDefault(model: Pick<ModelDescriptor, "metadata"> | null | undefined, key: string) {
  const values = model?.metadata?.videoParameterConfirmedDefaults;
  const value = values && typeof values === "object" && !Array.isArray(values) ? (values as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function videoDurationControlContext(model: Pick<ModelDescriptor, "metadata"> | null | undefined, key = "duration") {
  const metadata = model?.metadata;
  return {
    preserveExplicitControl: metadata?.durationRangeUnverified !== true &&
      (metadata?.source === "manual" || metadata?.source === "paid-test" || metadata?.protocolEvidence === "paid-test"),
    confirmedDefault: confirmedVideoParameterDefault(model, key),
    userFallbackRange: metadata?.durationRangeSource === "user-fallback" && metadata?.durationRangeUnverified !== true,
  };
}

/** Use resolved supplier bounds or an explicitly identified user fallback. */
export function videoDurationControl(
  nodeType: GenerationNodeType,
  descriptor: ModelParameterDescriptor,
  value: unknown,
  rangeUnverified = false,
  conditionalUpperBoundConfirmed = false,
  context: ReturnType<typeof videoDurationControlContext> = { preserveExplicitControl: false, confirmedDefault: undefined, userFallbackRange: false },
): VideoDurationControl | undefined {
  if (nodeType !== "video-generation" || !["duration", "seconds"].includes(descriptor.key)) return;
  const unavailable = (): VideoDurationControl | undefined => context.preserveExplicitControl ? undefined : ({ kind: "unavailable",
    ...(context.confirmedDefault !== undefined && context.confirmedDefault === descriptor.default ? { confirmedDefault: context.confirmedDefault } : {}),
    reason: "供应商尚未确认完整的可选时长，保留当前值；仅提供已公布的默认值，不推测其他秒数。" });
  const numeric = typeof value === "number" ? value
    : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;

  if (descriptor.control === "select") {
    const options = descriptor.options ?? [];
    return options.length ? { kind: "select", options } : unavailable();
  }
  // Number-control options can be suggestions or special automatic sentinels,
  // rather than an exhaustive enum. Keep their original editing semantics.
  if (descriptor.control !== "number" || descriptor.options?.length) return unavailable();
  // Older saved catalogs predate the explicit provenance flag. Their existing
  // warning still distinguishes an editor guard from a published supplier cap.
  if (!conditionalUpperBoundConfirmed && (rangeUnverified || !context.userFallbackRange && /未公开[^。；;]*上限/u.test(descriptor.description ?? ""))) return unavailable();
  const { min, max } = descriptor;
  const step = descriptor.step ?? 1;
  if (min === undefined || max === undefined || !Number.isFinite(min) ||
      !Number.isFinite(max) || !Number.isFinite(step) || min < 0 || max < min || step <= 0) return unavailable();
  if (descriptor.valueType === "integer" && ![min, max, step].every(Number.isInteger)) return unavailable();
  if (min === max) return { kind: "select", options: [{ value: min, label: `${min} 秒` }] };
  // The slider endpoint must itself satisfy the supplier's step constraint.
  const reachableMax = min + Math.floor((max - min) / step + 1e-8) * step;
  if (!Number.isFinite(reachableMax) || reachableMax <= min) return unavailable();
  const accepts = (candidate: number) => Number.isFinite(candidate) && candidate >= min && candidate <= reachableMax &&
    (descriptor.valueType !== "integer" || Number.isInteger(candidate)) &&
    Math.abs((candidate - min) / step - Math.round((candidate - min) / step)) <= 1e-8;
  if (accepts(numeric)) return { kind: "range", value: numeric, min, max: reachableMax, step };
  // A bad saved value must not change the control back into an unbounded
  // spinner or be silently replaced. The slider offers a legal candidate;
  // only an explicit user edit applies it to the saved request parameters.
  const fallback = Number(descriptor.default);
  return { kind: "range", value: accepts(fallback) ? fallback : min, min, max: reachableMax, step,
    invalidValue: value === undefined || value === null || value === "" ? "未设置" : String(value) };
}

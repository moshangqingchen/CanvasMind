"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterOption,
  ModelParameterValue,
  ProviderOperation,
  ValidationIssue,
} from "@super-canvas/providers";
import {
  coerceParameterInput,
  isExactSizeParameterDescriptor,
  normalizedParametersForModel,
  parameterValueForModel,
  parameterDescriptorsForValues,
  setParameterValue,
  usesSecureSeedreamSizePrecedence,
} from "../lib/model-parameters";
import type { GenerationNodeType } from "../lib/graph-ui";
import { confirmedVideoParameterDefault, videoDurationControl, videoDurationControlContext } from "../lib/video-duration-control";
import { imageModeParameters } from "../lib/image-editing";
import { validateModelParameters } from "@super-canvas/providers/cli-contracts";
import {
  tk1688ParametersForResolutionChange,
  tk1688ResolutionControl,
} from "../lib/tk1688-resolution-control";
import { isImageRatioParameter, nativeImageResolutionControl } from "../lib/native-image-resolution";
import { NativeImageResolutionFields } from "./native-image-resolution-fields";

interface NodeParameterFieldsProps {
  nodeId: string;
  nodeType: GenerationNodeType;
  provider: string;
  model?: ModelDescriptor | null;
  parameters: Record<string, unknown>;
  onChange: (parameters: Record<string, unknown>) => void;
  showAdvanced?: boolean;
  operation?: ProviderOperation;
  transparentSupported?: boolean;
  hasReferenceVideo?: boolean;
}

function controlId(nodeId: string, key: string) {
  return `node-parameter-${nodeId}-${key.replace(/[^a-z0-9_-]/giu, "-")}`;
}

function dimensionParts(value: unknown): [string, string] {
  const match = /^(\d*)x(\d*)$/iu.exec(String(value ?? "").trim());
  return match ? [match[1]!, match[2]!] : ["", ""];
}

const RESOLUTION_TIER_LABELS = ["1K", "2K", "4K"] as const;

export interface ResolutionTierShortcut {
  readonly label: (typeof RESOLUTION_TIER_LABELS)[number];
  /** First matching descriptor option, used when the shortcut is clicked. */
  readonly value: string;
  /** Every exact descriptor size belonging to this tier, used for active state. */
  readonly values: readonly string[];
}

function canonicalDimension(value: unknown): string | undefined {
  const [width, height] = dimensionParts(value);
  if (!width || !height) return undefined;
  return `${Number(width)}x${Number(height)}`;
}

function resolutionTierFromLabel(
  label: string,
): ResolutionTierShortcut["label"] | undefined {
  const normalized = label.toUpperCase();
  return RESOLUTION_TIER_LABELS.find((tier) => {
    if (new RegExp(`非\\s*${tier}`, "iu").test(normalized)) return false;
    return new RegExp(`(^|[^A-Z0-9])${tier}([^A-Z0-9]|$)`, "u").test(
      normalized,
    );
  });
}

export function resolutionTierShortcuts(
  descriptor: ModelParameterDescriptor,
): readonly ResolutionTierShortcut[] {
  const shortcuts: Array<ResolutionTierShortcut | undefined> =
    RESOLUTION_TIER_LABELS.map((label) => {
      const values = (descriptor.options ?? []).flatMap((option) => {
        if (resolutionTierFromLabel(option.label) !== label) return [];
        const value = canonicalDimension(option.value);
        return value ? [value] : [];
      });
      return values.length > 0
        ? { label, value: values[0]!, values }
        : undefined;
    });
  return shortcuts.filter(
    (shortcut): shortcut is ResolutionTierShortcut => shortcut !== undefined,
  );
}

/** Preserve the chosen shape when moving to another resolution budget. */
export function sizeOnTierChange(
  descriptor: ModelParameterDescriptor,
  value: unknown,
  tier: ResolutionTierShortcut["label"],
  exactPreference?: { ratio?: unknown },
): string {
  if (String(value ?? "auto").toLowerCase() === "auto") return "auto";
  const current = descriptor.options?.find(
    (o) => String(o.value) === String(value),
  );
  const explicitRatio = typeof exactPreference?.ratio === "string" && /^\d+:\d+$/u.test(exactPreference.ratio) ? exactPreference.ratio : undefined;
  const ratioLabel = explicitRatio ?? current?.label.match(/\d+\s*:\s*\d+/u)?.[0];
  const options = resolutionOptionsForTier(descriptor, tier).filter((o) =>
    canonicalDimension(o.value),
  );
  const matching =
    ratioLabel &&
    options.find((o) => o.label.match(/\d+\s*:\s*\d+/u)?.[0] === ratioLabel);
  if (matching) return String(matching.value);
  if (exactPreference) return String(value);
  const [width, height] = dimensionParts(value).map(Number);
  if (!width || !height || !options.length) return "auto";
  const closest = options.reduce((best, option) => {
    const distance = (v: unknown) => {
      const [w, h] = dimensionParts(v).map(Number);
      return Math.abs(Math.log(w! / h! / (width / height)));
    };
    return distance(option.value) < distance(best.value) ? option : best;
  });
  return String(closest.value);
}

export function resolutionTierForValue(
  shortcuts: readonly ResolutionTierShortcut[],
  value: unknown,
): ResolutionTierShortcut["label"] | undefined {
  const current = canonicalDimension(value);
  return current
    ? shortcuts.find((shortcut) => shortcut.values.includes(current))?.label
    : undefined;
}

export function activeResolutionTierForValue(
  shortcuts: readonly ResolutionTierShortcut[],
  value: unknown,
  savedTier: unknown,
): ResolutionTierShortcut["label"] | undefined {
  if (String(value).toLowerCase() !== "auto")
    return resolutionTierForValue(shortcuts, value);
  const normalizedTier = String(savedTier ?? "").toUpperCase();
  return shortcuts.find((shortcut) => shortcut.label === normalizedTier)?.label;
}

/** Keep the supplier's declared tier spelling and automatic mode on the wire. */
export function syncUserImageNativeTier(
  model: Pick<ModelDescriptor, "metadata" | "parameters"> | null | undefined,
  parameters: Readonly<Record<string, unknown>>,
  tier: ResolutionTierShortcut["label"] | null,
): Record<string, unknown> {
  const next = { ...parameters };
  const key = model?.metadata?.imageResolutionTierParameter ?? model?.metadata?.imageNativeResolutionParameter;
  if (typeof key !== "string" || key === "size" || key === "size_tier") return next;
  const descriptor = model?.parameters?.find(parameter => parameter.key === key);
  if (!descriptor) return next;
  const option = descriptor.options?.find(item => tier
    ? String(item.value).toUpperCase() === tier
    : ["auto", "web"].includes(String(item.value).toLowerCase()));
  if (option) next[key] = option.value;
  else if (tier && !descriptor.options?.length) next[key] = tier;
  return next;
}

export function resolutionOptionsForTier(
  descriptor: ModelParameterDescriptor,
  tier: ResolutionTierShortcut["label"] | undefined,
) {
  const options = descriptor.options ?? [];
  return tier
    ? options.filter(
        (option) =>
          String(option.value) === "auto" ||
          resolutionTierFromLabel(option.label) === tier,
      )
    : options;
}

export function shouldUseUnifiedResolutionControl(
  descriptors: readonly ModelParameterDescriptor[],
  parameters: Readonly<Record<string, unknown>>,
): boolean {
  const dimensions = descriptors.find(
    (descriptor) =>
      descriptor.key === "size" && descriptor.control === "dimensions",
  );
  if (!dimensions || resolutionTierShortcuts(dimensions).length === 0)
    return false;
  // A legacy node may contain only aspect_ratio. Keep its old control visible
  // until the user selects an exact/automatic size, then use the unified UI.
  const ratioKey = descriptors.find(isImageRatioParameter)?.key;
  return parameters.size !== undefined || !ratioKey || parameters[ratioKey] === undefined;
}

interface SizeAspectRatioContext {
  hasSizeControl: boolean;
  hasAspectRatioControl: boolean;
  defaultAspectRatio?: ModelParameterValue;
  aspectRatioKey?: string;
  model?: Pick<ModelDescriptor, "metadata" | "parameters"> | null;
}

/**
 * Keeps the provider's exact-size and aspect-ratio inputs mutually exclusive,
 * regardless of whether `size` is rendered as text, select, or dimensions.
 */
function hasIndependentImageTier(model?: SizeAspectRatioContext["model"]): boolean {
  if (model?.metadata?.imageUserSizePresets) return false;
  return Boolean(((model?.metadata?.imageNativeParameterContract === true || model?.metadata?.mikotoImageContract === true || model?.metadata?.pdogImageProtocol === 1 || model?.metadata?.imageApplicationOnlyResolution === true) && model.metadata.imageResolutionTierParameter === "size_tier") ||
    (model?.metadata?.tk1688ImageSizeContract === 2 && model.metadata.imageResolutionTierParameter === "resolution"));
}

/** This combination is stamped only by the exact Genimage official native route. */
export function isGenimageNativeImageContractModel(model: ModelDescriptor | null | undefined): boolean {
  const contracts: Readonly<Record<string, string>> = {
    "gemini-3-pro-image-preview": "declared-tiers",
    "gemini-3.1-flash-image-preview": "declared-tiers",
    "gemini-2.5-flash-image": "omit-size",
    "gemini-3.1-flash-lite-image": "open-size",
    "gemini-nano-banana-2.1": "open-size",
  };
  return Boolean(model && model.metadata?.source !== "manual" && model.metadata?.source !== "paid-test" &&
    model.metadata?.protocolEvidence !== "paid-test" && model.metadata?.imageNativeParameterContract === true &&
    model.metadata.bananaProtocolVersion === 1 && model.metadata.protocol === "gemini-generate-content" &&
    model.metadata.imageContractParameterCoverage === "exact-full-id-description-and-linked-native-schema" &&
    model.metadata.documentationUrl === "https://docs.newapi.ai/zh/docs/api/ai-model/images/gemini/geminirelayv1beta-383837589" &&
    contracts[model.id] !== undefined && model.metadata.imageSizeFieldContract === contracts[model.id]);
}

export function undeclaredGenimageNativeImageParameterKeys(model: ModelDescriptor | null | undefined, parameters: Readonly<Record<string, unknown>>): string[] {
  if (!isGenimageNativeImageContractModel(model)) return [];
  const declared = ["aspect_ratio", "aspectRatio", "ratio", "image_size", "imageSize", "resolution", "size_tier", "size", "n"];
  // The adapter checks key presence, including empty/auto unknown values.
  // Keep every saved alias; only an explicit clear action removes an extra key.
  return Object.keys(parameters).filter(key => !declared.includes(key));
}

export function undeclaredCOpenImageParameterKeys(model: ModelDescriptor | undefined, parameters: Readonly<Record<string, unknown>>, operation?: ProviderOperation): string[] {
  if (model?.metadata?.cOpenImageContract !== 1 || model.metadata.imageAdditionalFieldContract !== "not-declared-in-exact-supplier-material") return [];
  const measured = model.metadata.imageMeasuredAdditionalFields as Readonly<Record<string, unknown>> | undefined;
  const exactMeasuredPng = operation === "image.generate" && measured?.operation === "image.generate" &&
    measured.origin === "https://api.hangzhale.com" && measured.officialGroupId === "75" && measured.fullModelId === model.id &&
    ["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].includes(model.id) &&
    measured.source === "same-exact-identity-original-transparent-png-evidence" &&
    measured.background === "transparent" && measured.output_format === "png" &&
    parameters.background === "transparent" && parameters.output_format === "png";
  return ["output_format", "output_compression", "background", "moderation", "user"].filter(key =>
    !(exactMeasuredPng && ["background", "output_format"].includes(key)) && parameters[key] !== undefined && parameters[key] !== "" && parameters[key] !== "auto");
}

export function setParameterValueWithSizeExclusivity(
  parameters: Readonly<Record<string, unknown>>,
  key: string,
  value: ModelParameterValue | undefined,
  context: SizeAspectRatioContext,
): Record<string, unknown> {
  const next = setParameterValue(parameters, key, value, context.model);
  const aspectRatioKey = context.aspectRatioKey ?? "aspect_ratio";
  // This supplier's tier selection has no published pixel/ratio mapping.
  // Editing W/H retains both preferences; only size is sent on the wire.
  if (context.model?.metadata?.imageOpenSizePreferences === true || hasIndependentImageTier(context.model)) return next;

  if (key === "size" && context.hasSizeControl && context.hasAspectRatioControl && aspectRatioKey !== "size") {
    if (value === undefined) {
      const restored = setParameterValue(
        next,
        aspectRatioKey,
        context.defaultAspectRatio,
      );
      delete restored.size_tier;
      return restored;
    }
    delete next[aspectRatioKey];
  }

  if (key === aspectRatioKey && value !== undefined && context.hasSizeControl && aspectRatioKey !== "size") {
    delete next.size;
    delete next.size_tier;
  }

  return next;
}

export function savedSelectValueMissingFromDescriptor(
  descriptor: ModelParameterDescriptor,
  value: unknown,
): boolean {
  return (
    descriptor.control === "select" &&
    value !== "" &&
    value !== undefined &&
    !(descriptor.options ?? []).some(
      (option) => String(option.value) === String(value),
    )
  );
}

function parameterDataValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return `数组（${value.length} 项）`;
  if (typeof value === "object") return "对象";
  return String(value);
}

/** Saved values and this model's contract data replace editor verdicts.
 * The validator and adapter still decide whether an actual request is legal.
 */
export function parameterIssueFacts(
  issues: readonly Pick<ValidationIssue, "path">[],
  descriptors: readonly ModelParameterDescriptor[],
  parameters: Readonly<Record<string, unknown>>,
  model?: Pick<ModelDescriptor, "metadata"> | null,
): string[] {
  return [...new Set(issues.map(issue => issue.path.replace(/^parameters\./u, "")))].map(key => {
    const descriptor = descriptors.find(item => item.key === key);
    const duration = ["duration", "seconds", "duration_seconds"].includes(key);
    const conditional = model?.metadata?.durationMaxByResolution;
    const resolution = parameters.resolution ?? descriptors.find(item => item.key === "resolution")?.default;
    const conditionalMax = conditional && typeof conditional === "object" && !Array.isArray(conditional)
      ? (conditional as Record<string, unknown>)[String(resolution)] : undefined;
    const rangeMissing = duration && model?.metadata?.durationRangeUnverified === true &&
      !(typeof conditionalMax === "number" && Number.isFinite(conditionalMax)) ||
      ["resolution", "size_tier", "image_size"].includes(key) && model?.metadata?.resolutionRangeUnverified === true;
    const unit = duration ? " 秒" : "";
    let range = "—";
    if (descriptor && !rangeMissing) {
      const choices = descriptor.options?.map(option => option.label === String(option.value)
        ? option.label : `${option.label}（${String(option.value)}）`).join(" / ");
      const minimum = typeof descriptor.min === "number" && Number.isFinite(descriptor.min) ? descriptor.min : undefined;
      const maximum = typeof descriptor.max === "number" && Number.isFinite(descriptor.max) ? descriptor.max : undefined;
      const bounds = minimum !== undefined && maximum !== undefined ? `${minimum}–${maximum}${unit}`
        : minimum !== undefined ? `≥ ${minimum}${unit}` : maximum !== undefined ? `≤ ${maximum}${unit}` : undefined;
      const step = typeof descriptor.step === "number" && Number.isFinite(descriptor.step) ? `步长 ${descriptor.step}${unit}` : undefined;
      range = [choices, bounds, step].filter(Boolean).join(" · ") || (descriptor.control === "toggle" ? "true / false" : "—");
    }
    const defaultValue = rangeMissing ? confirmedVideoParameterDefault(model, key) : descriptor?.default;
    return `${descriptor?.label ?? key} · 当前值：${parameterDataValue(parameters[key])} · 目录范围：${range} · 默认值：${parameterDataValue(defaultValue)}${duration && model?.metadata?.durationRangeSource === "user-fallback" ? " · 用户指定兜底" : ""}${descriptor?.valueType ? ` · 数据类型：${descriptor.valueType}` : ""}${descriptor?.required ? " · 必填：true" : ""}`;
  });
}

/** Use one layout for exact sizes, without extending a select-only contract. */
export function imageDimensionsPresentation(descriptor: ModelParameterDescriptor): ModelParameterDescriptor {
  return isExactSizeParameterDescriptor(descriptor)
    ? { ...descriptor, label: "分辨率", control: "dimensions" }
    : descriptor;
}

function DimensionsControl({
  id,
  descriptor,
  value,
  savedTier,
  update,
  readOnlyDimensions = false,
  showAllResolutionTiers = false,
  useSavedResolutionTier = false,
  automaticOptions,
  allowOptionalAlignment = true,
  showContractDescription = false,
  showResolutionShortcuts = true,
  explicitRatio,
}: {
  id: string;
  descriptor: ModelParameterDescriptor;
  value: unknown;
  savedTier: unknown;
  update: (raw: string, tier?: ResolutionTierShortcut["label"] | null) => void;
  readOnlyDimensions?: boolean;
  showAllResolutionTiers?: boolean;
  useSavedResolutionTier?: boolean;
  automaticOptions?: readonly ModelParameterOption[];
  allowOptionalAlignment?: boolean;
  showContractDescription?: boolean;
  showResolutionShortcuts?: boolean;
  explicitRatio?: unknown;
}) {
  const initial = useMemo(() => dimensionParts(value), [value]);
  const [width, setWidth] = useState(initial[0]);
  const [height, setHeight] = useState(initial[1]);
  const [previousValue, setPreviousValue] = useState(value);
  // Synchronize presets, undo and external edits without remounting inputs.
  // Remounting on every committed size loses the next field's focus and resets
  // the user's alignment choice when moving from width to height.
  if (previousValue !== value) {
    setPreviousValue(value);
    setWidth(initial[0]);
    setHeight(initial[1]);
  }
  const requires16PixelAlignment = descriptor.step === 16;
  const [align16, setAlign16] = useState(requires16PixelAlignment);
  const shouldAlign16 = requires16PixelAlignment || (allowOptionalAlignment && align16);
  const resolutionShortcuts = resolutionTierShortcuts(descriptor);
  const autoOption = descriptor.options?.find(
    (option) => String(option.value) === "auto",
  );
  const automatic = String(value || descriptor.default || "") === "auto";
  const activeResolutionTier = activeResolutionTierForValue(
    resolutionShortcuts,
    useSavedResolutionTier || automatic ? "auto" : `${width}x${height}`,
    savedTier,
  );
  const fullyAutomatic =
    (useSavedResolutionTier ? Boolean(autoOption) : automatic) &&
    activeResolutionTier === undefined;
  const visiblePresetOptions =
    useSavedResolutionTier && !activeResolutionTier && automaticOptions
      ? automaticOptions
      : resolutionOptionsForTier(descriptor, activeResolutionTier);
  const presetValue = visiblePresetOptions.some(
    (option) => String(option.value) === String(value),
  )
    ? String(value)
    : "";

  const normalized = (raw: string, alignTo16 = shouldAlign16) => {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    const step = alignTo16 ? 16 : Math.max(1, descriptor.step ?? 1);
    const rounded = Math.round(numeric / step) * step;
    return Math.max(
      descriptor.min ?? step,
      Math.min(descriptor.max ?? Number.MAX_SAFE_INTEGER, rounded),
    );
  };
  const commit = (
    nextWidth = width,
    nextHeight = height,
    alignTo16 = shouldAlign16,
  ) => {
    if (readOnlyDimensions) return;
    const w = normalized(nextWidth, alignTo16);
    const h = normalized(nextHeight, alignTo16);
    if (w === undefined || h === undefined) return;
    setWidth(String(w));
    setHeight(String(h));
    const exactSize = `${w}x${h}`;
    update(
      exactSize,
      (useSavedResolutionTier ? activeResolutionTier : undefined) ?? resolutionTierForValue(resolutionShortcuts, exactSize) ?? null,
    );
  };

  return (
    <div className="field parameter-field parameter-dimensions">
      <div className="parameter-dimensions-heading">
        <label title={descriptor.description}>{descriptor.label}</label>
        {!readOnlyDimensions && (requires16PixelAlignment || allowOptionalAlignment) && <label className="parameter-dimensions-align" htmlFor={`${id}-align`}>
          <span>
            {requires16PixelAlignment ? "16 倍数（必需）" : "16 倍数对齐"}
          </span>
          <input
            id={`${id}-align`}
            type="checkbox"
            checked={shouldAlign16}
            disabled={requires16PixelAlignment || readOnlyDimensions}
            title={readOnlyDimensions ? "尺寸由当前渠道支持的比例预设确定" : undefined}
            onChange={(event) => {
              const nextAlign16 = event.target.checked;
              setAlign16(nextAlign16);
              if (nextAlign16) commit(width, height, nextAlign16);
            }}
          />
        </label>}
      </div>
      {showResolutionShortcuts && (resolutionShortcuts.length > 0 || showAllResolutionTiers) ? (
        <div
          className={`parameter-dimensions-shortcuts${autoOption || showAllResolutionTiers ? " has-auto" : ""}`}
          role="group"
          aria-label="自动与输出分辨率快捷档位"
        >
          {autoOption || showAllResolutionTiers ? (
            <button
              className="parameter-dimensions-shortcut"
              type="button"
              aria-pressed={fullyAutomatic}
              disabled={!autoOption}
              title={!autoOption ? "当前渠道使用固定尺寸" : undefined}
              onClick={() => {
                setWidth("");
                setHeight("");
                update("auto", null);
              }}
            >
              自动
            </button>
          ) : null}
          {(showAllResolutionTiers
            ? RESOLUTION_TIER_LABELS
            : resolutionShortcuts.map(shortcut => shortcut.label)
          ).map((tier) => {
            const shortcut = resolutionShortcuts.find(
              shortcut => shortcut.label === tier,
            );
            return (
              <button
                className="parameter-dimensions-shortcut"
                type="button"
                aria-pressed={activeResolutionTier === tier}
                disabled={!shortcut}
                title={!shortcut ? "当前渠道未声明支持此档位" : undefined}
                onClick={() => {
                  if (!shortcut) return;
                  const next = readOnlyDimensions && !useSavedResolutionTier && String(value).toLowerCase() === "auto"
                    ? shortcut.value
                    : sizeOnTierChange(
                    descriptor,
                    value,
                    shortcut.label,
                    showContractDescription ? { ratio: explicitRatio } : undefined,
                  );
                  const [w, h] = dimensionParts(next);
                  setWidth(w);
                  setHeight(h);
                  update(next, readOnlyDimensions && !useSavedResolutionTier ? null : shortcut.label);
                }}
                key={tier}
              >
                {tier}
              </button>
            );
          })}
        </div>
      ) : null}
      {descriptor.options?.length ? (
        <select
          id={`${id}-preset`}
          aria-label="输出分辨率预设"
          value={presetValue}
          onChange={(event) => {
            const next = event.target.value;
            if (!next) return;
            if (next === "auto") {
              setWidth("");
              setHeight("");
              update(next, activeResolutionTier ?? null);
              return;
            }
            if (readOnlyDimensions) {
              update(
                next,
                useSavedResolutionTier
                  ? activeResolutionTier ?? null
                  : resolutionTierForValue(resolutionShortcuts, next) ?? null,
              );
              return;
            }
            const [nextWidth, nextHeight] = dimensionParts(next);
            commit(nextWidth, nextHeight);
          }}
        >
          <option value="" disabled={readOnlyDimensions}>
            {activeResolutionTier
              ? `${activeResolutionTier} 比例与尺寸（W × H）`
              : readOnlyDimensions
                ? "选择比例与尺寸（W × H）"
                : "自定义尺寸（W × H）"}
          </option>
          {visiblePresetOptions.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {String(option.value) === "auto" && activeResolutionTier
                ? `自动（提示词优先，其次参考图 · 保持 ${activeResolutionTier}）`
                : option.label}
            </option>
          ))}
        </select>
      ) : null}
      {showContractDescription && activeResolutionTier && String(value).toLowerCase() !== "auto" &&
        !resolutionOptionsForTier(descriptor, activeResolutionTier).some(option => String(option.value) === String(value)) &&
        <small className="parameter-help" role="status">已保留 {activeResolutionTier} 档位偏好与当前 W/H；该档位没有此比例的已列像素，请确认 W/H 后提交。</small>}
      <div className="parameter-dimensions-inputs">
        <span>W</span>
        <input
          id={`${id}-width`}
          aria-label="图片宽度"
          type="number"
          value={width}
          readOnly={readOnlyDimensions}
          title={readOnlyDimensions ? "请从上方选择当前渠道支持的比例与尺寸" : undefined}
          min={descriptor.min}
          max={descriptor.max}
          step={shouldAlign16 ? 16 : descriptor.step ?? 1}
          placeholder="宽"
          onChange={(event) => setWidth(event.target.value)}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
        <span className="parameter-dimensions-swap">↔</span>
        <span>H</span>
        <input
          id={`${id}-height`}
          aria-label="图片高度"
          type="number"
          value={height}
          readOnly={readOnlyDimensions}
          title={readOnlyDimensions ? "请从上方选择当前渠道支持的比例与尺寸" : undefined}
          min={descriptor.min}
          max={descriptor.max}
          step={shouldAlign16 ? 16 : descriptor.step ?? 1}
          placeholder="高"
          onChange={(event) => setHeight(event.target.value)}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
      </div>
      {showContractDescription && descriptor.description && <small className="parameter-help">{descriptor.description}</small>}
    </div>
  );
}

export function jijiuVideoAspectRatioPresets(
  model: Pick<ModelDescriptor, "metadata"> | null | undefined,
  descriptor: ModelParameterDescriptor,
): Array<{ value: string; label: string }> {
  if (model?.metadata?.jijiuVideoContract !== true || descriptor.key !== "aspect_ratio" || descriptor.control !== "text") return [];
  const presets = model.metadata.videoAspectRatioPresets;
  if (!Array.isArray(presets)) return [];
  const seen = new Set<string>();
  return presets.flatMap((preset: unknown) => {
    if (!preset || typeof preset !== "object" || !("value" in preset) || !("label" in preset) || typeof preset.value !== "string" || typeof preset.label !== "string"
      || !preset.label.trim() || !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/u.test(preset.value)
      || !preset.value.split(":").every(part => Number(part) > 0 && Number.isFinite(Number(part))) || seen.has(preset.value)) return [];
    seen.add(preset.value);
    return [{ value: preset.value, label: preset.label }];
  });
}

function VideoRatioSuggestions({
  id, descriptor, presets, value, disabledReason, update,
}: {
  id: string;
  descriptor: ModelParameterDescriptor;
  presets: Array<{ value: string; label: string }>;
  value: string;
  disabledReason?: string;
  update: (value: string) => void;
}) {
  // This choice controls presentation only. It must never become a request value.
  const customChoice = "__custom_ratio__";
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const custom = editingValue === value || value !== "" && !presets.some(option => option.value === value);
  return (
    <>
      <select id={id} value={custom ? customChoice : value} disabled={Boolean(disabledReason)}
        title={disabledReason ?? descriptor.description} aria-required={descriptor.required}
        onChange={event => {
          if (event.target.value === customChoice) setEditingValue(value);
          else { setEditingValue(null); update(event.target.value); }
        }}>
        <option value="">供应商默认</option>
        {presets.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        <option value={customChoice}>自定义</option>
      </select>
      {custom && <input type="text" aria-label={`${descriptor.label}（自定义）`} value={value}
        disabled={Boolean(disabledReason)} placeholder={descriptor.placeholder}
        title={disabledReason ?? descriptor.description} aria-required={descriptor.required}
        onChange={event => { setEditingValue(event.target.value); update(event.target.value); }} />}
    </>
  );
}

function ParameterControl({
  nodeId,
  nodeType,
  modelId,
  descriptor,
  parameters,
  onChange,
  disabledReason,
  sizeAspectRatioContext,
  clampNumericInput,
  durationRangeUnverified,
  durationUpperBoundConfirmed,
  resolutionRangeUnverified,
  imageLayout,
}: {
  nodeId: string;
  nodeType: GenerationNodeType;
  modelId?: string;
  descriptor: ModelParameterDescriptor;
  parameters: Record<string, unknown>;
  onChange: (parameters: Record<string, unknown>) => void;
  disabledReason?: string;
  sizeAspectRatioContext: SizeAspectRatioContext;
  clampNumericInput: boolean;
  durationRangeUnverified: boolean;
  durationUpperBoundConfirmed: boolean;
  resolutionRangeUnverified: boolean;
  imageLayout: boolean;
}) {
  // The same node can be configured in the inspector and a popover at once.
  // Each rendered control needs its own ID so labels target the local input.
  const instanceId = useId();
  const id = `${controlId(nodeId, descriptor.key)}-${instanceId}`;
  const aspectRatioKey = sizeAspectRatioContext.aspectRatioKey ?? "aspect_ratio";
  const value = descriptor.key === "size" && usesSecureSeedreamSizePrecedence(sizeAspectRatioContext.model)
    ? (parameterValueForModel(sizeAspectRatioContext.model, parameters, "size") ?? descriptor.default ?? "")
    : descriptor.key === aspectRatioKey &&
    parameters[aspectRatioKey] === undefined &&
    parameters.size !== undefined &&
    sizeAspectRatioContext.hasSizeControl
      ? ""
      : descriptor.key === "size" &&
          parameters.size === undefined &&
          parameters[aspectRatioKey] !== undefined
        ? ""
        : (parameterValueForModel(sizeAspectRatioContext.model, parameters, descriptor.key) ?? descriptor.default ?? "");
  const durationContext = videoDurationControlContext(sizeAspectRatioContext.model, descriptor.key);
  const ratioPresets = nodeType === "video-generation" ? jijiuVideoAspectRatioPresets(sizeAspectRatioContext.model, descriptor) : [];
  const durationControl = videoDurationControl(nodeType, descriptor, value, durationRangeUnverified, durationUpperBoundConfirmed, durationContext);
  const unverifiedValue = parameterValueForModel(sizeAspectRatioContext.model, parameters, descriptor.key) ?? "";
  const confirmedDefault = durationControl?.kind === "unavailable" ? durationControl.confirmedDefault
    : confirmedVideoParameterDefault(sizeAspectRatioContext.model, descriptor.key) === descriptor.default ? descriptor.default : undefined;
  const unverifiedValueMissing = unverifiedValue !== "" && (confirmedDefault === undefined || String(unverifiedValue) !== String(confirmedDefault));
  const selectOptions = durationControl?.kind === "select" ? durationControl.options : descriptor.options;
  const savedSelectValueMissing = savedSelectValueMissingFromDescriptor(
    durationControl?.kind === "select" ? { ...descriptor, control: "select", options: selectOptions } : descriptor,
    value,
  );
  const update = (raw: string | boolean) => {
    let nextValue = coerceParameterInput(descriptor, raw, nodeType);
    if (
      clampNumericInput && nodeType !== "video-generation" &&
      typeof nextValue === "number" &&
      Number.isFinite(nextValue)
    ) {
      nextValue = Math.min(
        descriptor.max ?? Number.POSITIVE_INFINITY,
        Math.max(descriptor.min ?? Number.NEGATIVE_INFINITY, nextValue),
      );
    }
    const next = setParameterValueWithSizeExclusivity(
      parameters,
      descriptor.key,
      nextValue,
      sizeAspectRatioContext,
    );
    if (
      descriptor.key === "output_format" &&
      nextValue !== "jpeg" &&
      nextValue !== "webp"
    ) {
      delete next.output_compression;
    }
    onChange(next);
  };
  const updateDimensions = (
    raw: string,
    tier?: ResolutionTierShortcut["label"] | null,
  ) => {
    const nextValue = coerceParameterInput(descriptor, raw, nodeType);
    let next = setParameterValueWithSizeExclusivity(
      parameters,
      descriptor.key,
      nextValue,
      sizeAspectRatioContext,
    );
    if (sizeAspectRatioContext.model?.metadata?.imageUserSizePresets) {
      if (tier) next.size_tier = tier;
      else delete next.size_tier;
      // Choosing a preset is an explicit shape change. Keep its named ratio in
      // sync instead of leaving a previous independent preference to block it.
      const chosen = descriptor.options?.find(option => String(option.value) === raw);
      const ratio = chosen?.label.match(/\d+\s*:\s*\d+/u)?.[0]?.replaceAll(" ", "");
      for (const key of ["aspect_ratio", "aspectRatio", "ratio"]) {
        // Secure Seedream's legacy ratio overrides size. The explicit size
        // edit already removed it; restoring it would override the new pixels.
        if (parameters[key] !== undefined && !usesSecureSeedreamSizePrecedence(sizeAspectRatioContext.model)) {
          if (ratio) next[key] = ratio;
          else delete next[key];
        }
      }
      next = syncUserImageNativeTier(sizeAspectRatioContext.model, next, tier ?? null);
    } else if (!hasIndependentImageTier(sizeAspectRatioContext.model)) {
      if (sizeAspectRatioContext.model?.metadata?.imageOpenSizePreferences === true) {
        if (tier !== undefined && tier !== null) next.size_tier = tier;
      } else if (descriptor.control === "select" || tier === null) delete next.size_tier;
      else if (tier !== undefined) next.size_tier = tier;
    }
    onChange(next);
  };

  const nativeImageContract = nodeType === "image-generation" && imageLayout && (sizeAspectRatioContext.model?.metadata?.imageNativeParameterContract === true ||
    sizeAspectRatioContext.model?.metadata?.mikotoImageContract === true);
  const imageDimensions = nodeType === "image-generation" && imageLayout
    ? { ...imageDimensionsPresentation(descriptor), ...(nativeImageContract ? { label: sizeAspectRatioContext.model?.metadata?.imageUserSizePresets ? "比例与尺寸（W × H）" : descriptor.label } : {}) }
    : descriptor;
  if (imageDimensions.control === "dimensions") {
    return (
      <>
      <DimensionsControl
        key={id}
        id={id}
        descriptor={imageDimensions}
        value={value}
        savedTier={parameters.size_tier ?? parameters[String(sizeAspectRatioContext.model?.metadata?.imageResolutionTierParameter ?? sizeAspectRatioContext.model?.metadata?.imageNativeResolutionParameter ?? "size_tier")]}
        useSavedResolutionTier={Boolean(sizeAspectRatioContext.model?.metadata?.imageUserSizePresets &&
          (parameters.size_tier !== undefined || parameters[String(sizeAspectRatioContext.model.metadata.imageResolutionTierParameter ?? sizeAspectRatioContext.model.metadata.imageNativeResolutionParameter ?? "size_tier")] !== undefined))}
        update={updateDimensions}
        readOnlyDimensions={descriptor.control === "select"}
        allowOptionalAlignment={!nativeImageContract}
        showContractDescription={nativeImageContract}
        showResolutionShortcuts={!hasIndependentImageTier(sizeAspectRatioContext.model)}
        explicitRatio={parameters.aspect_ratio ?? parameters.aspectRatio ?? parameters.ratio}
      />
      {savedSelectValueMissing && <small role="status" className="parameter-help parameter-wide">已保存：{String(value)}；目录尺寸：{(descriptor.options ?? []).map(option => option.label).join(" / ") || "—"}</small>}
      </>
    );
  }

  if (descriptor.control === "toggle") {
    return (
      <label
        className="parameter-toggle"
        htmlFor={id}
        title={descriptor.description}
      >
        <span>{descriptor.label}</span>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => update(event.target.checked)}
        />
      </label>
    );
  }

  return (
    <div
      className={`field parameter-field${descriptor.key === "lyrics" || nodeType === "image-generation" && imageLayout && isImageRatioParameter(descriptor) ? " parameter-wide" : ""}${disabledReason ? " is-disabled" : ""}`}
    >
      <label htmlFor={id} title={disabledReason ?? descriptor.description}>
        {descriptor.label}
      </label>
      {durationControl?.kind === "range" ? (
        <div className="parameter-duration-range">
          <div className="parameter-duration-track">
            <input
              id={id}
              className="parameter-duration-slider nodrag nopan"
              type="range"
              min={durationControl.min}
              max={durationControl.max}
              step={durationControl.step}
              value={durationControl.value}
              disabled={Boolean(disabledReason)}
              title={disabledReason ?? descriptor.description}
              aria-valuetext={durationControl.invalidValue !== undefined ? `已保存 ${durationControl.invalidValue}；候选 ${durationControl.value} 秒` : `${durationControl.value} 秒`}
              aria-invalid={durationControl.invalidValue !== undefined || undefined}
              aria-describedby={`${id}-bounds${durationContext.userFallbackRange ? ` ${id}-source` : ""}${durationControl.invalidValue !== undefined ? ` ${id}-saved` : ""}`}
              onChange={(event) => update(event.target.value)}
            />
            <output htmlFor={id}>{durationControl.invalidValue !== undefined ? `${durationControl.invalidValue}（已保存）` : `${durationControl.value} 秒`}</output>
          </div>
          <small id={`${id}-bounds`} className="parameter-duration-bounds">
            <span>{durationControl.min} 秒</span>
            <span>{durationControl.max} 秒</span>
          </small>
          {durationContext.userFallbackRange && <small id={`${id}-source`} className="parameter-help" data-duration-source="user-fallback">
            用户兜底范围：{durationControl.min}–{durationControl.max} 秒。供应商未公布完整范围；已公布的限制仍优先适用。
          </small>}
          {durationControl.invalidValue !== undefined && <div id={`${id}-saved`} className="parameter-duration-saved parameter-help" role="status">
            <span>当前值：{durationControl.invalidValue} · 目录范围：{durationControl.min}–{durationControl.max} 秒 · 步长：{durationControl.step} 秒。</span>
            <button type="button" className="button nodrag nopan" disabled={Boolean(disabledReason)}
              onClick={() => update(String(durationControl.value))}>使用 {durationControl.value} 秒</button>
          </div>}
        </div>
      ) : durationControl?.kind === "unavailable" || nodeType === "video-generation" && descriptor.key === "resolution" && resolutionRangeUnverified && descriptor.allowCustomValue !== true && sizeAspectRatioContext.model?.metadata?.videoResolutionValueMode !== "derived-size" ? (
        <div className="parameter-duration-unavailable">
          <select id={id} value={String(unverifiedValue)} disabled={Boolean(disabledReason)}
            title={disabledReason ?? descriptor.description} aria-describedby={`${id}-unavailable`}
            aria-invalid={unverifiedValueMissing || undefined} onChange={event => update(event.target.value)}>
            <option value="">供应商默认（未公开可选范围）</option>
            {confirmedDefault !== undefined && <option value={String(confirmedDefault)}>{String(confirmedDefault)}（已公布默认值）</option>}
            {unverifiedValueMissing && <option value={String(unverifiedValue)} disabled>{String(unverifiedValue)}（已保存）</option>}
          </select>
          <small id={`${id}-unavailable`} role="status" className="parameter-help">
            当前值：{unverifiedValueMissing ? String(unverifiedValue) : "供应商默认"} · 目录范围：—。
            选择供应商默认会清除当前自定义值。
          </small>
        </div>
      ) : durationControl?.kind === "select" || descriptor.control === "select" ? (
        <select
          id={id}
          value={String(value)}
          disabled={Boolean(disabledReason)}
          title={disabledReason ?? descriptor.description}
          aria-required={descriptor.required}
          aria-invalid={nodeType === "video-generation" && savedSelectValueMissing || undefined}
          onChange={(event) => update(event.target.value)}
        >
          <option value="">
            {descriptor.key === aspectRatioKey &&
            parameters.size !== undefined &&
            sizeAspectRatioContext.hasSizeControl
              ? "按精确尺寸"
              : "模型默认"}
          </option>
          {savedSelectValueMissing ? (
            <option value={String(value)} disabled={nodeType === "video-generation"}>{String(value)}（已保存）</option>
          ) : null}
          {(selectOptions ?? []).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      ) : ratioPresets.length > 0 ? (
        <VideoRatioSuggestions key={`${nodeId}:${modelId ?? ""}:${descriptor.key}`}
          id={id} descriptor={descriptor} presets={ratioPresets} value={String(value)} disabledReason={disabledReason} update={update} />
      ) : descriptor.key === "lyrics" ? (
        <textarea id={id} value={String(value)} rows={6} maxLength={20000} disabled={Boolean(disabledReason)} placeholder="[Verse] 你的歌词…" onChange={event => update(event.target.value)} />
      ) : (
        <>
          <input
            id={id}
            type={descriptor.control === "number" ? "number" : "text"}
            value={String(value)}
            min={descriptor.min}
            max={descriptor.max}
            step={descriptor.step}
            disabled={Boolean(disabledReason)}
            title={disabledReason ?? descriptor.description}
            aria-required={descriptor.required}
            list={descriptor.options?.length ? `${id}-options` : undefined}
            placeholder={descriptor.placeholder}
            onChange={(event) => update(event.target.value)}
          />
          {descriptor.options?.length ? (
            <datalist id={`${id}-options`}>
              {descriptor.options.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </datalist>
          ) : null}
          {descriptor.allowCustomValue && <small className="parameter-help">
            {descriptor.options?.length ? `API 示例：${descriptor.options.map(option => String(option.value)).join(" / ")}。` : ""}
            按输入发送；留空使用供应商默认值。
          </small>}
        </>
      )}
      {durationControl?.kind === "select" && savedSelectValueMissing && <small role="status" className="parameter-help">当前值：{String(value)} · 目录时长：{durationControl.options.map(option => option.label).join(" / ") || "—"}。</small>}
      {disabledReason && <small className="parameter-help">{disabledReason}</small>}
    </div>
  );
}

export function NodeParameterFields({
  nodeId,
  nodeType,
  provider,
  model,
  parameters,
  onChange,
  showAdvanced = true,
  operation,
  transparentSupported = false,
  hasReferenceVideo = false,
}: NodeParameterFieldsProps) {
  const undeclaredSavedImageFields = nodeType === "image-generation" ? [...new Set([
    ...undeclaredCOpenImageParameterKeys(model ?? undefined, parameters, operation),
    ...undeclaredGenimageNativeImageParameterKeys(model, parameters),
  ])] : [];
  const descriptors = useMemo(
    () => parameterDescriptorsForValues(nodeType, provider, model, parameters, operation, { hasReferenceVideo }),
    [hasReferenceVideo, model, nodeType, parameters, provider, operation],
  );
  const resolutionControlId = useId();
  const userSizePresets = nodeType === "image-generation" && Boolean(model?.metadata?.imageUserSizePresets);
  const tk1688Resolution = provider !== "cli"
    ? tk1688ResolutionControl(model, descriptors)
    : undefined;
  const nativeResolution = nodeType === "image-generation" && provider !== "cli" && !tk1688Resolution && !userSizePresets
    ? nativeImageResolutionControl(descriptors, model)
    : undefined;
  const unifiedExactSize = nodeType === "image-generation" && provider !== "cli" && !nativeResolution && !tk1688Resolution &&
    (userSizePresets || shouldUseUnifiedResolutionControl(descriptors.map(imageDimensionsPresentation), parameters));
  const clampNumericInput = provider !== "cli" && model?.metadata?.clampNumericParameters === true;
  const clearUnavailableParameters =
    provider !== "cli" && model?.metadata?.parameterControlsUnavailable === true;
  const resolutionBounds = model?.metadata?.durationMaxByResolution;
  const activeResolution = parameters.resolution ?? descriptors.find(d => d.key === "resolution")?.default;
  const activeDurationMaximum = resolutionBounds && typeof resolutionBounds === "object" && !Array.isArray(resolutionBounds)
    ? (resolutionBounds as Record<string, unknown>)[String(activeResolution)] : undefined;
  const durationUpperBoundConfirmed = typeof activeDurationMaximum === "number" && Number.isFinite(activeDurationMaximum);
  const contractValues = Object.fromEntries(Object.entries(parameters).filter(([key]) => descriptors.some(d => d.key === key)));
  const parameterIssues = model && (provider === "cli" || nodeType !== "image-generation")
    ? validateModelParameters(provider === "cli" ? model : { ...model, parameters: descriptors }, provider === "cli" ? parameters : {
      ...Object.fromEntries(descriptors.filter(d => d.default !== undefined).map(d => [d.key, d.default])), ...contractValues,
    }, operation).issues : [];
  const hasLinkedControls = Boolean(model?.parameters?.some(d => d.visibleWhen?.length || d.constraints?.length));
  const parameterJson = JSON.stringify(parameters, null, 2);
  useEffect(() => {
    if (!clampNumericInput && !clearUnavailableParameters && !hasLinkedControls) return;
    const normalized = normalizedParametersForModel(
      nodeType,
      provider,
      model,
      parameters,
      { hasReferenceVideo },
    );
    // Keep the editor's lyrics draft while hidden. Run normalization and the
    // music adapter omit it from instrumental requests.
    if (nodeType === "music-generation" && typeof parameters.lyrics === "string" && model?.parameters?.some(p => p.key === "lyrics")) normalized.lyrics = parameters.lyrics;
    if (JSON.stringify(normalized) !== JSON.stringify(parameters))
      onChange(normalized);
  }, [
    clampNumericInput,
    clearUnavailableParameters,
    hasLinkedControls,
    hasReferenceVideo,
    model,
    nodeType,
    onChange,
    parameterJson,
    parameters,
    provider,
  ]);
  const outputFormat = String(
    parameters.output_format ??
      descriptors.find((descriptor) => descriptor.key === "output_format")
        ?.default ??
      "png",
  ).toLowerCase();
  const compressionEnabled = outputFormat === "jpeg" || outputFormat === "webp";
  const aspectRatioDescriptor = descriptors.find(
    isImageRatioParameter,
  );
  const sizeAspectRatioContext = {
    hasSizeControl: descriptors.some(isExactSizeParameterDescriptor),
    hasAspectRatioControl: Boolean(aspectRatioDescriptor),
    defaultAspectRatio: aspectRatioDescriptor?.default,
    aspectRatioKey: aspectRatioDescriptor?.key,
    model,
  } satisfies SizeAspectRatioContext;
  const compactImageNotes = nodeType === "image-generation" && model?.metadata?.jijiuImageContract === true && model.id === "gpt-image-2-2K/4K";

  return (
    <>
      {provider === "cli" && !model && <p className="parameter-group-note">请先在“个人 AI 网站”中接入并同步模型与参数。</p>}
      {!compactImageNotes && !userSizePresets && typeof model?.metadata?.imageParameterContractNote === "string" && model.metadata.imageParameterContractNote && (
        <p className="parameter-group-note">{model.metadata.imageParameterContractNote}</p>
      )}
      {parameterIssues.length > 0 && <div role="status" className="parameter-group-note" aria-label="当前参数与目录数据">{parameterIssueFacts(parameterIssues, descriptors, parameters, model).map(fact => <p key={fact}>{fact}</p>)}</div>}
      {typeof model?.metadata?.imageCapabilityNote === "string" && model.metadata.imageCapabilityNote && (
        <p className="parameter-group-note">实测说明：{model.metadata.imageCapabilityNote}</p>
      )}
      {!compactImageNotes && typeof model?.metadata?.supplierGroupResolutionLabel === "string" && model.metadata.supplierGroupResolutionLabel && (
        <p className="parameter-group-note" title={typeof model.metadata.supplierGroupDescription === "string" ? model.metadata.supplierGroupDescription : undefined}>
          分组说明：{model.metadata.supplierGroupResolutionLabel}{model.metadata.supplierGroupInfoStale ? "（上次记录）" : ""}
        </p>
      )}
      <div className="parameter-grid">
        {nativeResolution && <NativeImageResolutionFields
          id={`${controlId(nodeId, nativeResolution.resolution.key)}-${resolutionControlId}`}
          model={model}
          resolution={nativeResolution.resolution}
          ratio={nativeResolution.ratio}
          parameters={parameters}
          onChange={onChange}
          hasExactSizeControl={sizeAspectRatioContext.hasSizeControl}
        />}
        {tk1688Resolution && (
          <DimensionsControl
            id={`${controlId(nodeId, "size")}-${resolutionControlId}`}
            descriptor={tk1688Resolution.descriptor}
            value={tk1688Resolution.value}
            savedTier={tk1688Resolution.savedTier}
            readOnlyDimensions
            showAllResolutionTiers
            useSavedResolutionTier
            automaticOptions={tk1688Resolution.automaticOptions}
            update={() => onChange(
              tk1688ParametersForResolutionChange(tk1688Resolution, parameters),
            )}
          />
        )}
        {descriptors.filter(
          descriptor => (provider === "cli" || descriptor.key !== "background") &&
            (!userSizePresets || !["size_tier", String(model?.metadata?.imageResolutionTierParameter ?? model?.metadata?.imageNativeResolutionParameter ?? "size_tier")].filter(key => key !== "size").includes(descriptor.key)) &&
            (!(nodeType === "image-generation" && usesSecureSeedreamSizePrecedence(model)) || !["width", "height"].includes(descriptor.key)) &&
            (provider === "cli" || descriptor.key !== "mask") && (!tk1688Resolution || !["size", "resolution", "aspect_ratio"].includes(descriptor.key)) &&
            (!nativeResolution || (descriptor.key !== nativeResolution.resolution.key && descriptor.key !== nativeResolution.ratio?.key)) &&
            (!unifiedExactSize || descriptor.key !== aspectRatioDescriptor?.key),
        ).map((descriptor) => (
          <ParameterControl
            key={descriptor.key}
            nodeId={nodeId}
            nodeType={nodeType}
            modelId={model?.id}
            descriptor={descriptor}
            parameters={parameters}
            onChange={onChange}
            sizeAspectRatioContext={sizeAspectRatioContext}
            clampNumericInput={clampNumericInput}
            durationRangeUnverified={model?.metadata?.durationRangeUnverified === true || (!model?.parameters?.length && provider !== "fake")}
            durationUpperBoundConfirmed={durationUpperBoundConfirmed}
            resolutionRangeUnverified={model?.metadata?.resolutionRangeUnverified === true}
            imageLayout={provider !== "cli"}
            disabledReason={
              provider !== "cli" && descriptor.key === "output_format" && parameters.background === "transparent"
                ? "透明模式使用 PNG，保留透明通道"
                : descriptor.key === "output_compression" && !compressionEnabled
                ? "压缩率适用格式：JPEG / WebP · 当前格式：PNG（无损）"
                : undefined
            }
          />
        ))}
        {undeclaredSavedImageFields.length > 0 && <div className="parameter-help" role="group" aria-label="已保存的其它图片字段">
          {undeclaredSavedImageFields.map(key => <div className="parameter-field" key={key}>
            <span>{key}（已保存）：{String(parameters[key])}</span>
            <button type="button" className="button nodrag nopan" onClick={() => {
              const next = { ...parameters }; delete next[key]; onChange(next);
            }}>清除 {key}</button>
          </div>)}
          <small>这些原值继续保存；当前完整型号资料未声明其请求映射，提交前可在此逐项清除。</small>
        </div>}
        {nodeType === "image-generation" && provider !== "cli" && (
          <div className="image-output-mode">
            <span>生成模式</span>
            <div role="group" aria-label="生成模式" className="image-output-mode-options">
              <button type="button" aria-pressed={parameters.background !== "transparent"}
                onClick={() => onChange(imageModeParameters(parameters, transparentSupported, "normal"))}>普通模式</button>
              {transparentSupported && <button type="button" aria-pressed={parameters.background === "transparent"}
                onClick={() => onChange(imageModeParameters(parameters, true, "transparent"))}>透明模式</button>}
            </div>
            {transparentSupported && parameters.background === "transparent" && <small>透明背景 · PNG 原图</small>}
            {!transparentSupported && parameters.background === "transparent" && <small role="status">当前模式：透明 · 目录模式：普通。</small>}
          </div>
        )}
      </div>
      {compactImageNotes && model.metadata && Boolean(model.metadata.imageParameterContractNote || model.metadata.supplierGroupResolutionLabel) && (
        <details className="parameter-contract-details" onPointerDown={event => event.stopPropagation()}>
          <summary>参数说明与分组依据{model.metadata.supplierGroupInfoStale ? "（分组说明待更新）" : ""}</summary>
          {typeof model.metadata.imageParameterContractNote === "string" && <p>{model.metadata.imageParameterContractNote}</p>}
          {typeof model.metadata.supplierGroupResolutionLabel === "string" && <p title={typeof model.metadata.supplierGroupDescription === "string" ? model.metadata.supplierGroupDescription : undefined}>
            分组说明：{model.metadata.supplierGroupResolutionLabel}{model.metadata.supplierGroupInfoStale ? "（上次记录）" : ""}
          </p>}
        </details>
      )}
      {showAdvanced ? (
        <AdvancedParametersEditor
          key={`${nodeId}:${parameterJson}`}
          initialJson={parameterJson}
          onChange={onChange}
        />
      ) : null}
    </>
  );
}

function AdvancedParametersEditor({
  initialJson,
  onChange,
}: {
  initialJson: string;
  onChange: (parameters: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(initialJson);
  const [draftError, setDraftError] = useState<string | null>(null);

  function applyDraft() {
    try {
      const parsed = JSON.parse(draft) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("参数必须是 JSON 对象");
      }
      onChange(parsed as Record<string, unknown>);
      setDraftError(null);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "JSON 无效");
    }
  }

  return (
    <details className="advanced-parameters">
      <summary>高级参数 JSON</summary>
      <textarea
        aria-label="高级参数 JSON"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
      />
      <div className="advanced-parameters-actions">
        <span role="status">{draftError}</span>
        <button className="button small" type="button" onClick={applyDraft}>
          应用 JSON
        </button>
      </div>
    </details>
  );
}

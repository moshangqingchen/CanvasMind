"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterOption,
  ModelParameterValue,
  ProviderOperation,
} from "@super-canvas/providers";
import {
  coerceParameterInput,
  isExactSizeParameterDescriptor,
  normalizedParametersForModel,
  parameterDescriptorsForValues,
  setParameterValue,
} from "../lib/model-parameters";
import type { GenerationNodeType } from "../lib/graph-ui";
import { imageModeParameters } from "../lib/image-editing";
import { validateModelParameters } from "@super-canvas/providers/cli-contracts";
import {
  tk1688ParametersForResolutionChange,
  tk1688ResolutionControl,
} from "../lib/tk1688-resolution-control";

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
}

function controlId(nodeId: string, key: string) {
  return `node-parameter-${nodeId}-${key.replace(/[^a-z0-9_-]/giu, "-")}`;
}

function dimensionParts(value: unknown): [string, string] {
  const match = /^(\d+)x(\d+)$/iu.exec(String(value ?? "").trim());
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
): string {
  if (String(value ?? "auto").toLowerCase() === "auto") return "auto";
  const current = descriptor.options?.find(
    (o) => String(o.value) === String(value),
  );
  const ratioLabel = current?.label.match(/\d+\s*:\s*\d+/u)?.[0];
  const options = resolutionOptionsForTier(descriptor, tier).filter((o) =>
    canonicalDimension(o.value),
  );
  const matching =
    ratioLabel &&
    options.find((o) => o.label.match(/\d+\s*:\s*\d+/u)?.[0] === ratioLabel);
  if (matching) return String(matching.value);
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
  return parameters.size !== undefined || parameters.aspect_ratio === undefined;
}

interface SizeAspectRatioContext {
  hasSizeControl: boolean;
  hasAspectRatioControl: boolean;
  defaultAspectRatio?: ModelParameterValue;
}

/**
 * Keeps the provider's exact-size and aspect-ratio inputs mutually exclusive,
 * regardless of whether `size` is rendered as text, select, or dimensions.
 */
export function setParameterValueWithSizeExclusivity(
  parameters: Readonly<Record<string, unknown>>,
  key: string,
  value: ModelParameterValue | undefined,
  context: SizeAspectRatioContext,
): Record<string, unknown> {
  const next = setParameterValue(parameters, key, value);

  if (key === "size" && context.hasAspectRatioControl) {
    if (value === undefined) {
      const restored = setParameterValue(
        next,
        "aspect_ratio",
        context.defaultAspectRatio,
      );
      delete restored.size_tier;
      return restored;
    }
    delete next.aspect_ratio;
  }

  if (key === "aspect_ratio" && value !== undefined && context.hasSizeControl) {
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
  // Keep the legacy control's default behavior: dimensions start aligned to
  // 16 even when a provider does not declare a step. Providers that require
  // alignment still lock the checkbox below.
  const [align16, setAlign16] = useState(true);
  const shouldAlign16 = requires16PixelAlignment || align16;
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
      resolutionTierForValue(resolutionShortcuts, exactSize) ?? null,
    );
  };

  return (
    <div className="field parameter-field parameter-dimensions">
      <div className="parameter-dimensions-heading">
        <label title={descriptor.description}>{descriptor.label}</label>
        <label className="parameter-dimensions-align" htmlFor={`${id}-align`}>
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
        </label>
      </div>
      {resolutionShortcuts.length > 0 || showAllResolutionTiers ? (
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
                  const next = sizeOnTierChange(
                    descriptor,
                    value,
                    shortcut.label,
                  );
                  const [w, h] = dimensionParts(next);
                  setWidth(w);
                  setHeight(h);
                  update(next, shortcut.label);
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
          step={shouldAlign16 ? 16 : 1}
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
          step={shouldAlign16 ? 16 : 1}
          placeholder="高"
          onChange={(event) => setHeight(event.target.value)}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
      </div>
    </div>
  );
}

function ParameterControl({
  nodeId,
  descriptor,
  parameters,
  onChange,
  disabledReason,
  sizeAspectRatioContext,
  clampNumericInput,
}: {
  nodeId: string;
  descriptor: ModelParameterDescriptor;
  parameters: Record<string, unknown>;
  onChange: (parameters: Record<string, unknown>) => void;
  disabledReason?: string;
  sizeAspectRatioContext: SizeAspectRatioContext;
  clampNumericInput: boolean;
}) {
  // The same node can be configured in the inspector and a popover at once.
  // Each rendered control needs its own ID so labels target the local input.
  const instanceId = useId();
  const id = `${controlId(nodeId, descriptor.key)}-${instanceId}`;
  const value =
    descriptor.key === "aspect_ratio" &&
    parameters.aspect_ratio === undefined &&
    parameters.size !== undefined &&
    sizeAspectRatioContext.hasSizeControl
      ? ""
      : descriptor.key === "size" &&
          parameters.size === undefined &&
          parameters.aspect_ratio !== undefined
        ? ""
        : (parameters[descriptor.key] ?? descriptor.default ?? "");
  const savedSelectValueMissing = savedSelectValueMissingFromDescriptor(
    descriptor,
    value,
  );
  const update = (raw: string | boolean) => {
    let nextValue = coerceParameterInput(descriptor, raw);
    if (
      clampNumericInput &&
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
    const nextValue = coerceParameterInput(descriptor, raw);
    const next = setParameterValueWithSizeExclusivity(
      parameters,
      descriptor.key,
      nextValue,
      sizeAspectRatioContext,
    );
    if (tier === null) delete next.size_tier;
    else if (tier !== undefined) next.size_tier = tier;
    onChange(next);
  };

  if (descriptor.control === "dimensions") {
    return (
      <DimensionsControl
        key={id}
        id={id}
        descriptor={descriptor}
        value={value}
        savedTier={parameters.size_tier}
        update={updateDimensions}
      />
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
      className={`field parameter-field${disabledReason ? " is-disabled" : ""}`}
    >
      <label htmlFor={id} title={disabledReason ?? descriptor.description}>
        {descriptor.label}
      </label>
      {descriptor.control === "select" ? (
        <select
          id={id}
          value={String(value)}
          disabled={Boolean(disabledReason)}
          title={disabledReason}
          onChange={(event) => update(event.target.value)}
        >
          <option value="">
            {descriptor.key === "aspect_ratio" &&
            parameters.size !== undefined &&
            sizeAspectRatioContext.hasSizeControl
              ? "按精确尺寸"
              : "模型默认"}
          </option>
          {savedSelectValueMissing ? (
            <option value={String(value)}>{String(value)}（已保存）</option>
          ) : null}
          {(descriptor.options ?? []).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
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
            title={disabledReason}
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
        </>
      )}
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
}: NodeParameterFieldsProps) {
  const descriptors = useMemo(
    () => parameterDescriptorsForValues(nodeType, provider, model, parameters, operation),
    [model, nodeType, parameters, provider, operation],
  );
  const resolutionControlId = useId();
  const tk1688Resolution = provider !== "cli"
    ? tk1688ResolutionControl(model, descriptors, parameters)
    : undefined;
  const clampNumericInput = provider !== "cli" && model?.metadata?.clampNumericParameters === true;
  const clearUnavailableParameters =
    provider !== "cli" && model?.metadata?.parameterControlsUnavailable === true;
  const cliIssues = provider === "cli" && model ? validateModelParameters(model, parameters, operation).issues : [];
  const parameterJson = JSON.stringify(parameters, null, 2);
  useEffect(() => {
    if (!clampNumericInput && !clearUnavailableParameters) return;
    const normalized = normalizedParametersForModel(
      nodeType,
      provider,
      model,
      parameters,
    );
    if (JSON.stringify(normalized) !== JSON.stringify(parameters))
      onChange(normalized);
  }, [
    clampNumericInput,
    clearUnavailableParameters,
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
    (descriptor) => descriptor.key === "aspect_ratio",
  );
  const sizeAspectRatioContext = {
    hasSizeControl: descriptors.some(isExactSizeParameterDescriptor),
    hasAspectRatioControl: Boolean(aspectRatioDescriptor),
    defaultAspectRatio: aspectRatioDescriptor?.default,
  } satisfies SizeAspectRatioContext;

  return (
    <>
      {provider === "cli" && !model && <p className="parameter-group-note">请先在“个人 AI 网站”中接入并同步模型与参数。</p>}
      {cliIssues.length > 0 && <div role="alert" className="parameter-group-note">{cliIssues.map(issue => <p key={`${issue.path}:${issue.code}`}>{issue.message}</p>)}<p>已保留原参数，请修正后再生成。</p></div>}
      {typeof model?.metadata?.imageCapabilityNote === "string" && model.metadata.imageCapabilityNote && (
        <p className="parameter-group-note">实测说明：{model.metadata.imageCapabilityNote}</p>
      )}
      {typeof model?.metadata?.supplierGroupResolutionLabel === "string" && model.metadata.supplierGroupResolutionLabel && (
        <p className="parameter-group-note" title={typeof model.metadata.supplierGroupDescription === "string" ? model.metadata.supplierGroupDescription : undefined}>
          分组说明：{model.metadata.supplierGroupResolutionLabel}{model.metadata.supplierGroupInfoStale ? "（上次读取，本次未确认）" : ""}
        </p>
      )}
      <div className="parameter-grid">
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
            update={(raw, tier) => onChange(
              tk1688ParametersForResolutionChange(tk1688Resolution, parameters, raw, tier),
            )}
          />
        )}
        {descriptors.filter(
          descriptor => (provider === "cli" || descriptor.key !== "background") &&
            (provider === "cli" || descriptor.key !== "mask") && (!tk1688Resolution || !["size", "resolution", "aspect_ratio"].includes(descriptor.key)),
        ).map((descriptor) => (
          <ParameterControl
            key={descriptor.key}
            nodeId={nodeId}
            descriptor={descriptor}
            parameters={parameters}
            onChange={onChange}
            sizeAspectRatioContext={sizeAspectRatioContext}
            clampNumericInput={clampNumericInput}
            disabledReason={
              provider !== "cli" && descriptor.key === "output_format" && parameters.background === "transparent"
                ? "透明模式使用 PNG，保留透明通道"
                : descriptor.key === "output_compression" && !compressionEnabled
                ? "PNG 是无损格式，不支持设置压缩率；请选择 JPEG 或 WebP"
                : undefined
            }
          />
        ))}
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
            {!transparentSupported && parameters.background === "transparent" && <small role="status">原透明模式当前不受支持，请切换到普通模式。</small>}
          </div>
        )}
      </div>
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

"use client";

import { useMemo, useState } from "react";
import type {
  ModelDescriptor,
  ModelParameterDescriptor,
} from "@super-canvas/providers";
import {
  coerceParameterInput,
  parameterDescriptorsFor,
  setParameterValue,
} from "../lib/model-parameters";
import type { GenerationNodeType } from "../lib/graph-ui";

interface NodeParameterFieldsProps {
  nodeId: string;
  nodeType: GenerationNodeType;
  provider: string;
  model?: ModelDescriptor | null;
  parameters: Record<string, unknown>;
  onChange: (parameters: Record<string, unknown>) => void;
  showAdvanced?: boolean;
}

function controlId(nodeId: string, key: string) {
  return `node-parameter-${nodeId}-${key.replace(/[^a-z0-9_-]/giu, "-")}`;
}

function dimensionParts(value: unknown): [string, string] {
  const match = /^(\d+)x(\d+)$/iu.exec(String(value ?? "").trim());
  return match ? [match[1]!, match[2]!] : ["", ""];
}

function DimensionsControl({
  id,
  descriptor,
  value,
  update,
}: {
  id: string;
  descriptor: ModelParameterDescriptor;
  value: unknown;
  update: (raw: string) => void;
}) {
  const initial = dimensionParts(value);
  const [width, setWidth] = useState(initial[0]);
  const [height, setHeight] = useState(initial[1]);
  const [align16, setAlign16] = useState(true);

  const normalized = (raw: string, shouldAlign16 = align16) => {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    const step = shouldAlign16 ? 16 : Math.max(1, descriptor.step ?? 1);
    const rounded = Math.round(numeric / step) * step;
    return Math.max(
      descriptor.min ?? step,
      Math.min(descriptor.max ?? Number.MAX_SAFE_INTEGER, rounded),
    );
  };
  const commit = (
    nextWidth = width,
    nextHeight = height,
    shouldAlign16 = align16,
  ) => {
    const w = normalized(nextWidth, shouldAlign16);
    const h = normalized(nextHeight, shouldAlign16);
    if (w === undefined || h === undefined) return;
    setWidth(String(w));
    setHeight(String(h));
    update(`${w}x${h}`);
  };

  return (
    <div className="field parameter-field parameter-dimensions">
      <div className="parameter-dimensions-heading">
        <label title={descriptor.description}>{descriptor.label}</label>
        <label className="parameter-dimensions-align" htmlFor={`${id}-align`}>
          <span>16 倍数对齐</span>
          <input
            id={`${id}-align`}
            type="checkbox"
            checked={align16}
            onChange={(event) => {
              const nextAlign16 = event.target.checked;
              setAlign16(nextAlign16);
              if (nextAlign16) commit(width, height, nextAlign16);
            }}
          />
        </label>
      </div>
      <div className="parameter-dimensions-inputs">
        <span>W</span>
        <input
          id={`${id}-width`}
          aria-label="图片宽度"
          type="number"
          value={width}
          min={descriptor.min}
          max={descriptor.max}
          step={align16 ? 16 : 1}
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
          min={descriptor.min}
          max={descriptor.max}
          step={align16 ? 16 : 1}
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
  hasAspectRatioControl,
}: {
  nodeId: string;
  descriptor: ModelParameterDescriptor;
  parameters: Record<string, unknown>;
  onChange: (parameters: Record<string, unknown>) => void;
  disabledReason?: string;
  hasAspectRatioControl?: boolean;
}) {
  const id = controlId(nodeId, descriptor.key);
  const value =
    descriptor.key === "aspect_ratio" &&
    parameters.aspect_ratio === undefined &&
    parameters.size !== undefined
      ? ""
      : (parameters[descriptor.key] ?? descriptor.default ?? "");
  const update = (raw: string | boolean) => {
    const nextValue = coerceParameterInput(descriptor, raw);
    const next = setParameterValue(parameters, descriptor.key, nextValue);
    if (descriptor.key === "size") {
      if (nextValue !== undefined) delete next.aspect_ratio;
      else if (hasAspectRatioControl) next.aspect_ratio = "auto";
    }
    if (nextValue !== undefined && descriptor.key === "aspect_ratio") {
      delete next.size;
    }
    if (
      descriptor.key === "output_format" &&
      nextValue !== "jpeg" &&
      nextValue !== "webp"
    ) {
      delete next.output_compression;
    }
    onChange(next);
  };

  if (descriptor.control === "dimensions") {
    return (
      <DimensionsControl
        key={`${id}:${String(value)}`}
        id={id}
        descriptor={descriptor}
        value={value}
        update={update}
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
            {descriptor.key === "aspect_ratio" && parameters.size !== undefined
              ? "按精确尺寸"
              : "API 默认"}
          </option>
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
}: NodeParameterFieldsProps) {
  const descriptors = useMemo(
    () => parameterDescriptorsFor(nodeType, provider, model),
    [model, nodeType, provider],
  );
  const parameterJson = JSON.stringify(parameters, null, 2);
  const outputFormat = String(
    parameters.output_format ??
      descriptors.find((descriptor) => descriptor.key === "output_format")
        ?.default ??
      "png",
  ).toLowerCase();
  const compressionEnabled = outputFormat === "jpeg" || outputFormat === "webp";
  const hasAspectRatioControl = descriptors.some(
    (descriptor) => descriptor.key === "aspect_ratio",
  );

  return (
    <>
      <div className="parameter-grid">
        {descriptors.map((descriptor) => (
          <ParameterControl
            key={descriptor.key}
            nodeId={nodeId}
            descriptor={descriptor}
            parameters={parameters}
            onChange={onChange}
            hasAspectRatioControl={hasAspectRatioControl}
            disabledReason={
              descriptor.key === "output_compression" && !compressionEnabled
                ? "PNG 是无损格式，不支持设置压缩率；请选择 JPEG 或 WebP"
                : undefined
            }
          />
        ))}
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

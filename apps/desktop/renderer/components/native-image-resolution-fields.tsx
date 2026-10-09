"use client";

import type { ModelDescriptor, ModelParameterDescriptor, ModelParameterValue } from "@super-canvas/providers";
import { coerceParameterInput, setParameterValue } from "../lib/model-parameters";
import { declaredImageOutputDimensions, imageResolutionOptionLabel } from "../lib/native-image-resolution";

export function NativeImageResolutionFields({
  id, model, resolution, ratio, parameters, onChange, hasExactSizeControl = false,
}: {
  id: string;
  model?: ModelDescriptor | null;
  resolution: ModelParameterDescriptor;
  ratio?: ModelParameterDescriptor;
  parameters: Record<string, unknown>;
  onChange: (parameters: Record<string, unknown>) => void;
  hasExactSizeControl?: boolean;
}) {
  const value = parameters[resolution.key] ?? resolution.default ?? "";
  const ratioValue = ratio && !(hasExactSizeControl && parameters.size !== undefined)
    ? parameters[ratio.key] ?? ratio.default ?? "" : "";
  const dimensions = declaredImageOutputDimensions(model, value, ratioValue);
  const options = resolution.options ?? [];
  const missing = value !== "" && !options.some(option => String(option.value) === String(value));
  const update = (descriptor: ModelParameterDescriptor, raw: ModelParameterValue) => {
    const next = setParameterValue(parameters, descriptor.key, coerceParameterInput(descriptor, String(raw)));
    if (descriptor.key === ratio?.key && raw !== "" && hasExactSizeControl) {
      delete next.size;
      delete next.size_tier;
    }
    onChange(next);
  };
  const showDimensions = Array.isArray(model?.metadata?.imageOutputDimensions) && model.metadata.imageOutputDimensions.length > 0;

  return <div className="field parameter-field parameter-dimensions parameter-native-resolution">
    <div className="parameter-dimensions-heading">
      <label id={`${id}-heading`} title={resolution.description}>分辨率</label>
    </div>
    <div className="parameter-dimensions-shortcuts parameter-native-resolution-shortcuts"
      role="group" aria-label="自动与输出分辨率快捷档位" aria-describedby={`${id}-heading`}>
      {options.map(option => <button key={String(option.value)} type="button"
        className="parameter-dimensions-shortcut"
        aria-pressed={String(value) === String(option.value)}
        onClick={() => update(resolution, option.value)}>
        {imageResolutionOptionLabel(option)}
      </button>)}
    </div>
    {missing && <small role="status" className="parameter-help">
      已保存：{imageResolutionOptionLabel({ value: String(value), label: String(value) })}，当前目录未确认此档位
    </small>}
    {ratio && <>
      <label className="parameter-native-ratio-label" htmlFor={`${id}-ratio`} title={ratio.description}>画面比例</label>
      <select id={`${id}-ratio`} value={String(ratioValue)} aria-required={ratio.required}
        title={ratio.description} onChange={event => update(ratio, event.target.value)}>
        <option value="">{hasExactSizeControl && parameters.size !== undefined ? "按精确尺寸" : "模型默认"}</option>
        {ratioValue !== "" && !ratio.options?.some(option => String(option.value) === String(ratioValue)) &&
          <option value={String(ratioValue)}>{String(ratioValue)}（已保存）</option>}
        {(ratio.options ?? []).map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
      </select>
    </>}
    {showDimensions && <div className="parameter-dimensions-inputs">
      <span>W</span>
      <input id={`${id}-width`} aria-label="图片宽度" value={dimensions?.width ?? ""} readOnly
        placeholder="宽" title="尺寸由所选分辨率和比例确定" />
      <span className="parameter-dimensions-swap">↔</span>
      <span>H</span>
      <input id={`${id}-height`} aria-label="图片高度" value={dimensions?.height ?? ""} readOnly
        placeholder="高" title="尺寸由所选分辨率和比例确定" />
    </div>}
  </div>;
}

"use client";

import type { ModelDescriptor, ModelParameterDescriptor, ModelParameterValue } from "@super-canvas/providers";
import { coerceParameterInput, parameterValueForModel, setParameterValue } from "../lib/model-parameters";
import { declaredImageOutputDimensions, declaredImageReferenceDimensions, imageResolutionOptionLabel, nativeImageRatioOptionLabel } from "../lib/native-image-resolution";

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
  const value = parameterValueForModel(model, parameters, resolution.key) ?? resolution.default ?? "";
  const ratioValue = ratio && !(hasExactSizeControl && parameters.size !== undefined)
    ? parameterValueForModel(model, parameters, ratio.key) ?? ratio.default ?? "" : "";
  const exactDimensions = declaredImageOutputDimensions(model, value, ratioValue);
  const referenceDimensions = declaredImageReferenceDimensions(model, value, ratioValue);
  const dimensions = exactDimensions ?? referenceDimensions;
  const dimensionsTitle = referenceDimensions && !exactDimensions ? "供应商参考像素；成品可能略有不同，不作为 size 请求发送" : "仅显示供应商已公布的像素；未公布时以原图为准";
  const options = resolution.options ?? [];
  const missing = value !== "" && !options.some(option => String(option.value) === String(value));
  const update = (descriptor: ModelParameterDescriptor, raw: ModelParameterValue) => {
    const next = setParameterValue(parameters, descriptor.key, coerceParameterInput(descriptor, String(raw)), model);
    if (descriptor.key === ratio?.key && raw !== "" && hasExactSizeControl) {
      delete next.size;
      delete next.size_tier;
    }
    onChange(next);
  };
  // An exact size control owns the editable W/H fields. Do not render a second,
  // disconnected pair here (especially when the supplier publishes no pixels).
  const showDimensions = !hasExactSizeControl && (model?.metadata?.imageNativeParameterContract === true || (Array.isArray(model?.metadata?.imageOutputDimensions) && model.metadata.imageOutputDimensions.length > 0));

  return <div className="field parameter-field parameter-dimensions parameter-native-resolution">
    <div className="parameter-dimensions-heading">
      <label id={`${id}-heading`} title={resolution.description}>分辨率</label>
    </div>
    <div className="parameter-dimensions-shortcuts parameter-native-resolution-shortcuts"
      role="group" aria-label="自动与输出分辨率快捷档位" aria-describedby={`${id}-heading`}>
      {options.map(option => <button key={String(option.value)} type="button"
        className="parameter-dimensions-shortcut"
        aria-pressed={String(value) === String(option.value)}
        disabled={resolution.key === "__fixed_resolution"} onClick={() => update(resolution, option.value)}>
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
        {(ratio.options ?? []).map(option => <option key={String(option.value)} value={String(option.value)}>
          {nativeImageRatioOptionLabel(model, resolution, value, option)}
        </option>)}
      </select>
    </>}
    {showDimensions && <div className="parameter-dimensions-inputs">
      <span>W</span>
      <input id={`${id}-width`} aria-label="图片宽度" value={dimensions?.width ?? ""} readOnly
        placeholder={dimensions ? "宽" : "以原图为准"} title={dimensionsTitle} />
      <span className="parameter-dimensions-swap">↔</span>
      <span>H</span>
      <input id={`${id}-height`} aria-label="图片高度" value={dimensions?.height ?? ""} readOnly
        placeholder={dimensions ? "高" : "以原图为准"} title={dimensionsTitle} />
    </div>}
    {showDimensions && referenceDimensions && !exactDimensions && <small className="parameter-help">W/H 为供应商参考像素，实际以原图为准；请求仅发送比例。</small>}
    {resolution.description && <small className="parameter-help">{resolution.description}</small>}
    {ratio?.description && <small className="parameter-help">{ratio.description}</small>}
  </div>;
}

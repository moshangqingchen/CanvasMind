"use client";

import { useState } from "react";
import type { ModelDescriptor, ModelParameterDescriptor, ModelParameterValue } from "@super-canvas/providers";
import { coerceParameterInput, parameterValueForModel, setParameterValue } from "../lib/model-parameters";
import { declaredImageOutputDimensions, declaredImageReferenceDimensions, imageResolutionOptionLabel, nativeImageRatioOptionLabel } from "../lib/native-image-resolution";
import { genimageImageRatioIssues } from "@super-canvas/providers/genimage-image-capabilities";
import { mikotoImageRatioIssues } from "@super-canvas/providers/supplier-image-constraints";
import { pdogImageSizeSelection } from "@super-canvas/providers/pdog-image-contract";

/** An open exact-supplier size field has no unpublished alignment or edge cap. */
export function genimageSizeForDimensions(width: string, height: string): string | undefined {
  return [width, height].every(value => /^\d+$/u.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0)
    ? `${Number(width)}x${Number(height)}` : undefined;
}

function GenimageCustomSizeFields({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const parts = /^(\d+)x(\d+)$/iu.exec(value);
  const [width, setWidth] = useState(parts?.[1] ?? "");
  const [height, setHeight] = useState(parts?.[2] ?? "");
  const [previous, setPrevious] = useState(value);
  if (previous !== value) { setPrevious(value); setWidth(parts?.[1] ?? ""); setHeight(parts?.[2] ?? ""); }
  const commit = () => { const size = genimageSizeForDimensions(width, height); if (size) onChange(size); };
  return <>
    <label htmlFor={`${id}-custom-size`}>尺寸参数（size）</label>
    <input id={`${id}-custom-size`} aria-label="基因形象自定义尺寸参数" value={value}
      placeholder="1K / 2K / 4K / WIDTHxHEIGHT" onChange={event => onChange(event.target.value)} />
    <div className="parameter-dimensions-inputs">
      <span>W</span><input id={`${id}-width`} aria-label="图片宽度" type="number" value={width} step={1}
        placeholder="宽" onChange={event => setWidth(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === "Enter") commit(); }} />
      <span className="parameter-dimensions-swap">↔</span>
      <span>H</span><input id={`${id}-height`} aria-label="图片高度" type="number" value={height} step={1}
        placeholder="高" onChange={event => setHeight(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === "Enter") commit(); }} />
    </div>
  </>;
}

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
  const genimageOpenSize = model?.metadata?.genimageNativeSizeOpen === true &&
    ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].includes(model.id) &&
    resolution.key === "size" && resolution.allowCustomValue === true;
  const mikotoDeclaredTier = model?.metadata?.mikotoImageContract === true &&
    model.metadata.imageResolutionTierParameter === "size_tier" && resolution.key === "size_tier";
  const pdogDeclaredTier = model?.metadata?.pdogImageProtocol === 1 &&
    model.metadata.imageResolutionTierParameter === "size_tier" && resolution.key === "size_tier";
  const tk1688DeclaredTier = model?.metadata?.tk1688ImageSizeContract === 2 &&
    model.metadata.imageResolutionTierParameter === "resolution" && resolution.key === "resolution";
  const secureDeclaredTier = model?.metadata?.secureSkillImageProtocol === 1 && resolution.key === "image_size";
  const applicationNativePreferences = model?.metadata?.imageOpenSizePreferences === true && model.metadata.imageNativeParameterContract === true;
  const independentSizePreferences = genimageOpenSize || mikotoDeclaredTier || pdogDeclaredTier || tk1688DeclaredTier || secureDeclaredTier || applicationNativePreferences;
  const value = parameterValueForModel(model, parameters, resolution.key) ?? resolution.default ?? "";
  const savedGenimageRatio = [parameters.aspect_ratio, parameters.aspectRatio, parameters.ratio].find(v => v !== undefined && v !== "" && v !== "auto");
  const ratioValue = independentSizePreferences ? savedGenimageRatio ?? parameterValueForModel(model, parameters, ratio?.key ?? "aspect_ratio") ?? "auto"
    : ratio && !(hasExactSizeControl && parameters.size !== undefined)
      ? parameterValueForModel(model, parameters, ratio.key) ?? ratio.default ?? "" : "";
  const exactDimensions = declaredImageOutputDimensions(model, value, ratioValue);
  const referenceDimensions = declaredImageReferenceDimensions(model, value, ratioValue);
  const dimensions = exactDimensions ?? referenceDimensions;
  const dimensionsTitle = referenceDimensions && !exactDimensions
    ? pdogDeclaredTier ? "官方档位与比例映射的 size 请求值；已输入的 W/H 优先保留" : "供应商参考像素；成品可能略有不同，不作为 size 请求发送"
    : "仅显示供应商已公布的像素；未公布时以原图为准";
  const options = resolution.options ?? [];
  const missing = value !== "" && !options.some(option => String(option.value) === String(value));
  const update = (descriptor: ModelParameterDescriptor, raw: ModelParameterValue) => {
    const next = setParameterValue(parameters, descriptor.key, coerceParameterInput(descriptor, String(raw)), model);
    if (!independentSizePreferences && descriptor.key === ratio?.key && raw !== "" && hasExactSizeControl) {
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
      当前档位：{imageResolutionOptionLabel({ value: String(value), label: String(value) })} · 目录档位：{options.map(imageResolutionOptionLabel).join(" / ") || "—"}
    </small>}
    {mikotoDeclaredTier && <small className="parameter-help">
      {value ? `${String(value)} · ` : ""}逐档像素映射：—；请填写独立 W/H，请求使用 size 原值。
      {[parameters.aspect_ratio, parameters.aspectRatio, parameters.ratio].find(v => v !== undefined && v !== "" && v !== "auto") !== undefined &&
        ` 比例偏好：${String([parameters.aspect_ratio, parameters.aspectRatio, parameters.ratio].find(v => v !== undefined && v !== "" && v !== "auto"))}（保留）。`}
    </small>}
    {pdogDeclaredTier && <small className="parameter-help">
      档位与比例按官方表映射为 size；表中没有的组合请填写独立 W/H。已输入的 W/H 和比例偏好保留，请求使用 size。
    </small>}
    {tk1688DeclaredTier && <small className="parameter-help">
      商家档位与独立 W/H 分开保存；未公布逐档像素表时请填写 W/H，按 size 原值发送。默认工作台像素不作为高档像素表。
    </small>}
    {secureDeclaredTier && <small className="parameter-help">
      image_size 与 aspect_ratio 是供应商原字段。明确 size 优先；使用档位及比例映射时请将尺寸设为供应商默认。已输入的 W/H 保留。
    </small>}
    {ratio && <>
      <label className="parameter-native-ratio-label" htmlFor={`${id}-ratio`} title={ratio.description}>画面比例</label>
      {independentSizePreferences && ratio.allowCustomValue ? <input id={`${id}-ratio`} aria-label={mikotoDeclaredTier ? "Mikoto画面比例偏好" : pdogDeclaredTier ? "pDog画面比例偏好" : tk1688DeclaredTier ? "词元画面比例偏好" : secureDeclaredTier ? "Secure Skill画面比例" : "基因形象画面比例偏好"} value={String(ratioValue)}
        placeholder="auto / WIDTH:HEIGHT" onChange={event => update(ratio, event.target.value)} /> : <select id={`${id}-ratio`} value={String(ratioValue)} aria-required={ratio.required}
        title={ratio.description} onChange={event => update(ratio, event.target.value)}>
        <option value="">{hasExactSizeControl && parameters.size !== undefined ? "按精确尺寸" : "模型默认"}</option>
        {ratioValue !== "" && !ratio.options?.some(option => String(option.value) === String(ratioValue)) &&
          <option value={String(ratioValue)}>{String(ratioValue)}（已保存）</option>}
        {(ratio.options ?? []).map(option => <option key={String(option.value)} value={String(option.value)}>
          {nativeImageRatioOptionLabel(model, resolution, value, option)}
        </option>)}
      </select>}
      {ratioValue !== "" && !ratio.options?.some(option => String(option.value) === String(ratioValue)) && <small role="status" className="parameter-help">
        当前比例：{String(ratioValue)} · 目录比例：{ratio.options?.map(option => option.label).join(" / ") || "—"}
      </small>}
    </>}
    {genimageOpenSize ? <GenimageCustomSizeFields id={id} value={String(value)} onChange={raw => update(resolution, raw)} /> : showDimensions && <div className="parameter-dimensions-inputs">
      <span>W</span>
      <input id={`${id}-width`} aria-label="图片宽度" value={dimensions?.width ?? ""} readOnly
        placeholder={dimensions ? "宽" : "以原图为准"} title={dimensionsTitle} />
      <span className="parameter-dimensions-swap">↔</span>
      <span>H</span>
      <input id={`${id}-height`} aria-label="图片高度" value={dimensions?.height ?? ""} readOnly
        placeholder={dimensions ? "高" : "以原图为准"} title={dimensionsTitle} />
    </div>}
    {genimageOpenSize && genimageImageRatioIssues(parameters).map(issue => <small key={issue.code} role="status" className="parameter-help">{issue.message}</small>)}
    {mikotoDeclaredTier && mikotoImageRatioIssues(parameters).map(issue => <small key={issue.code} role="status" className="parameter-help">{issue.message}</small>)}
    {pdogDeclaredTier && pdogImageSizeSelection(parameters).issues.map(issue => <small key={issue.code} role="status" className="parameter-help">{issue.message}</small>)}
    {genimageOpenSize && savedGenimageRatio !== undefined && !genimageImageRatioIssues(parameters).length &&
      <small className="parameter-help">比例偏好：{String(savedGenimageRatio)} · 请求 size：{String(value)}。按原 W/H 发送；小幅参考像素偏差保留。</small>}
    {showDimensions && referenceDimensions && !exactDimensions && <small className="parameter-help">{pdogDeclaredTier
      ? "W/H 为官方映射的 size；有独立 W/H 输入时保留用户值，成品以原图为准。"
      : "W/H 为供应商参考像素，实际以原图为准；请求仅发送比例。"}</small>}
    {resolution.description && <small className="parameter-help">{resolution.description}</small>}
    {ratio?.description && <small className="parameter-help">{ratio.description}</small>}
  </div>;
}

"use client";

import { useState } from "react";
import type { ModelDescriptor, ModelParameterDescriptor, ModelParameterOption, ModelParameterValue } from "@super-canvas/providers";
import { coerceParameterInput, modelParameterAliases, parameterValueForModel, setParameterValue } from "../lib/model-parameters";
import { declaredImageOutputDimensions, declaredImageReferenceDimensions, imageResolutionOptionLabel, nativeImageRatioOptionLabel } from "../lib/native-image-resolution";
import { genimageImageRatioIssues } from "@super-canvas/providers/genimage-image-capabilities";
import { mikotoImageRatioIssues } from "@super-canvas/providers/supplier-image-constraints";
import { pdogImageSizeSelection } from "@super-canvas/providers/pdog-image-contract";
import { Dropdown, type DropdownOption } from "./ui/Dropdown";
import { Segmented } from "./ui/Segmented";
import { Disclosure } from "./ui/Disclosure";
import { RatioIcon } from "./ui/RatioIcon";

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
  return <Disclosure label="自定义宽高与尺寸参数" defaultOpen={!parts} className="parameter-custom-size">
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
  </Disclosure>;
}

/** UI-only custom entry state stays separate from native parameter mapping. */
export function NativeImageRatioFields({ id, value, options, ratio, inputLabel, independentSizePreferences = false, panelPresentation = false, allowSingleOptionDisplay = true, onChange }: {
  id: string;
  value: string;
  options: readonly DropdownOption[];
  ratio: ModelParameterDescriptor;
  inputLabel: string;
  independentSizePreferences?: boolean;
  panelPresentation?: boolean;
  allowSingleOptionDisplay?: boolean;
  onChange: (value: string) => void;
}) {
  const [editingCustomRatio, setEditingCustomRatio] = useState(false);
  const customRatioChoice = "__custom_ratio__";
  const customRatio = ratio.allowCustomValue === true && (editingCustomRatio || value !== "" && !options.some(option => option.value === value));
  const singleOption = panelPresentation && allowSingleOptionDisplay && !ratio.allowCustomValue && ratio.options?.length === 1 && String(ratio.options[0]!.value) === value
    ? options.find(option => option.value === value && !option.disabled) : undefined;
  return <>
    <Dropdown id={`${id}-ratio`} label="画面比例" value={customRatio ? customRatioChoice : value} required={ratio.required}
      title={ratio.description} description={independentSizePreferences ? "比例偏好与宽高分别保存；独立宽高不会随比例改写。" : undefined}
      singleOptionDisplay={singleOption ? "static" : undefined}
      options={singleOption ? options.filter(option => option.disabled || option === singleOption) : [...options, ...(ratio.allowCustomValue ? [{ value: customRatioChoice, label: "自定义比例" }] : [])]}
      onChange={raw => {
        if (raw === customRatioChoice) { setEditingCustomRatio(true); return; }
        setEditingCustomRatio(false); onChange(raw);
      }} />
    {customRatio && <input id={`${id}-ratio-custom`} aria-label={inputLabel} value={value}
      placeholder="auto / WIDTH:HEIGHT" onChange={event => onChange(event.target.value)} />}
  </>;
}

/** Full route-specific facts are shared with the panel's sources disclosure. */
export function nativeImageResolutionSourceNotes({ model, resolution, ratio, parameters, hasExactSizeControl = false }: {
  model?: ModelDescriptor | null;
  resolution: ModelParameterDescriptor;
  ratio?: ModelParameterDescriptor;
  parameters: Readonly<Record<string, unknown>>;
  hasExactSizeControl?: boolean;
}) {
  const value = parameterValueForModel(model, parameters, resolution.key) ?? resolution.default ?? "";
  const savedRatio = [parameters.aspect_ratio, parameters.aspectRatio, parameters.ratio].find(v => v !== undefined && v !== "" && v !== "auto");
  const mikoto = model?.metadata?.mikotoImageContract === true && model.metadata.imageResolutionTierParameter === "size_tier" && resolution.key === "size_tier";
  const pdog = model?.metadata?.pdogImageProtocol === 1 && model.metadata.imageResolutionTierParameter === "size_tier" && resolution.key === "size_tier";
  const tk1688 = model?.metadata?.tk1688ImageSizeContract === 2 && model.metadata.imageResolutionTierParameter === "resolution" && resolution.key === "resolution";
  const secure = model?.metadata?.secureSkillImageProtocol === 1 && resolution.key === "image_size";
  const genimage = model?.metadata?.genimageNativeSizeOpen === true && ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].includes(model.id) && resolution.key === "size" && resolution.allowCustomValue === true;
  const independent = genimage || mikoto || pdog || tk1688 || secure || model?.metadata?.imageOpenSizePreferences === true && model.metadata.imageNativeParameterContract === true;
  const ratioValue = independent ? savedRatio ?? parameterValueForModel(model, parameters, ratio?.key ?? "aspect_ratio") ?? "auto"
    : ratio && !(hasExactSizeControl && parameters.size !== undefined) ? parameterValueForModel(model, parameters, ratio.key) ?? ratio.default ?? "" : "";
  const reference = declaredImageReferenceDimensions(model, value, ratioValue);
  const exact = declaredImageOutputDimensions(model, value, ratioValue);
  const showDimensions = !hasExactSizeControl && (model?.metadata?.imageNativeParameterContract === true || Array.isArray(model?.metadata?.imageOutputDimensions) && model.metadata.imageOutputDimensions.length > 0);
  return [
    mikoto ? `${value ? `${String(value)} · ` : ""}逐档像素映射：—；请填写独立 W/H，请求使用 size 原值。${savedRatio !== undefined ? ` 比例偏好：${String(savedRatio)}（保留）。` : ""}` : "",
    pdog ? "档位与比例按官方表映射为 size；表中没有的组合请填写独立 W/H。已输入的 W/H 和比例偏好保留，请求使用 size。" : "",
    tk1688 ? "商家档位与独立 W/H 分开保存；未公布逐档像素表时请填写 W/H，按 size 原值发送。默认工作台像素不作为高档像素表。" : "",
    secure ? "image_size 与 aspect_ratio 是供应商原字段。明确 size 优先；使用档位及比例映射时请将尺寸设为供应商默认。已输入的 W/H 保留。" : "",
    genimage && savedRatio !== undefined && !genimageImageRatioIssues(parameters).length ? `比例偏好：${String(savedRatio)} · 请求 size：${String(value)}。按原 W/H 发送；小幅参考像素偏差保留。` : "",
    showDimensions && reference && !exact ? pdog ? "W/H 为官方映射的 size；有独立 W/H 输入时保留用户值，成品以原图为准。" : "W/H 为供应商参考像素，实际以原图为准；请求仅发送比例。" : "",
  ].filter(Boolean);
}

export function NativeImageResolutionSources(props: Parameters<typeof nativeImageResolutionSourceNotes>[0]) {
  return <>{nativeImageResolutionSourceNotes(props).map(note => <p key={note}>{note}</p>)}</>;
}

export function NativeImageResolutionFields({
  id, model, resolution, ratio, parameters, onChange, hasExactSizeControl = false, panelPresentation = false,
}: {
  id: string;
  model?: ModelDescriptor | null;
  resolution: ModelParameterDescriptor;
  ratio?: ModelParameterDescriptor;
  parameters: Record<string, unknown>;
  onChange: (parameters: Record<string, unknown>) => void;
  hasExactSizeControl?: boolean;
  panelPresentation?: boolean;
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
  const aliases = modelParameterAliases(model);
  const hasSavedAlias = (key: string) => aliases.find(([canonical]) => canonical === key)?.[1].some(alias => parameters[alias] !== undefined) === true;
  const hasRatioIssues = Boolean(genimageOpenSize && genimageImageRatioIssues(parameters).length || mikotoDeclaredTier && mikotoImageRatioIssues(parameters).length || pdogDeclaredTier && pdogImageSizeSelection(parameters).issues.length);
  const fixedResolution = resolution.key === "__fixed_resolution";
  // These exact contracts explicitly accept auto even in an open ratio field;
  // an arbitrary open string descriptor does not establish that meaning.
  const ratioAutomatic: ModelParameterOption | undefined = ratio?.options?.find(option => String(option.value) === "auto") ??
    (ratio?.allowCustomValue && (genimageOpenSize || mikotoDeclaredTier) ? { value: "auto", label: "自动" } : undefined);
  const automaticRatioLabel = ratioAutomatic && /供应商|模型默认|上游默认/u.test(ratioAutomatic.label)
    ? ratioAutomatic.label : "自动 · 跟随提示词，其次参考图";
  const ratioInputLabel = mikotoDeclaredTier ? "Mikoto画面比例偏好" : pdogDeclaredTier ? "pDog画面比例偏好" : tk1688DeclaredTier ? "词元画面比例偏好" : secureDeclaredTier ? "Secure Skill画面比例" : "基因形象画面比例偏好";
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
    <Segmented label="自动与输出分辨率快捷档位" className="parameter-native-resolution-shortcuts" value={String(value)}
      disabled={panelPresentation && fixedResolution}
      singleOptionDisplay={panelPresentation && !missing && !hasSavedAlias(resolution.key) && !hasRatioIssues ? "static" : undefined}
      options={[
        ...(options.some(option => String(option.value).toLowerCase() === "auto")
          ? options.filter(option => String(option.value).toLowerCase() === "auto").map(option => ({ value: String(option.value), label: imageResolutionOptionLabel(option) }))
          : [{ value: "__automatic_resolution_unavailable__", label: "自动", disabled: true, title: "当前型号未提供自动档位" }]),
        ...options.filter(option => String(option.value).toLowerCase() !== "auto").map(option => ({ value: String(option.value), label: imageResolutionOptionLabel(option),
          disabled: fixedResolution && !panelPresentation, title: fixedResolution ? "分辨率由当前完整型号固定" : undefined })),
      ]}
      onChange={raw => { if (fixedResolution) return; const option = options.find(option => String(option.value) === raw); if (option) update(resolution, option.value); }} />
    {missing && <small role="status" className="parameter-help">
      当前档位：{imageResolutionOptionLabel({ value: String(value), label: String(value) })} · 目录档位：{options.map(imageResolutionOptionLabel).join(" / ") || "—"}
    </small>}
    {mikotoDeclaredTier && <small className="parameter-help">
      逐档像素映射：—；请填写独立 W/H，请求使用 size 原值。
    </small>}
    {pdogDeclaredTier && <small className="parameter-help">
      表外组合请填写独立 W/H；已输入的 W/H 优先保留。
    </small>}
    {tk1688DeclaredTier && <small className="parameter-help">
      未公布逐档像素表，请填写独立 W/H，按 size 原值发送。
    </small>}
    {secureDeclaredTier && <small className="parameter-help">
      明确 size 优先；使用档位及比例映射时请将尺寸设为供应商默认。
    </small>}
    {ratio && <>
      <label className="parameter-native-ratio-label" htmlFor={`${id}-ratio`} title={ratio.description}>{independentSizePreferences ? "画面比例偏好" : "画面比例"}</label>
      <NativeImageRatioFields id={id} ratio={ratio} value={String(ratioValue)} inputLabel={ratioInputLabel} independentSizePreferences={independentSizePreferences}
        panelPresentation={panelPresentation} allowSingleOptionDisplay={!hasSavedAlias(ratio.key) && !hasRatioIssues}
        options={[
          { value: ratioAutomatic ? "auto" : "__automatic_ratio_unavailable__", label: automaticRatioLabel,
            detail: options.find(option => String(option.value) === String(value)) ? `保持 ${imageResolutionOptionLabel(options.find(option => String(option.value) === String(value))!)}` : undefined,
            disabled: !ratioAutomatic, disabledReason: !ratioAutomatic ? "当前型号未声明此自动比例，请选择已列比例或模型默认。" : undefined },
          { value: "", label: hasExactSizeControl && parameters.size !== undefined ? "按精确尺寸" : "模型默认" },
          ...(!ratio.allowCustomValue && ratioValue !== "" && !ratio.options?.some(option => String(option.value) === String(ratioValue))
            ? [{ value: String(ratioValue), label: `${String(ratioValue)}（已保存）` }] : []),
          ...(ratio.options ?? []).filter(option => String(option.value) !== "auto").map(option => ({ value: String(option.value), label: option.label,
            icon: /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/u.test(String(option.value)) ? <RatioIcon ratio={String(option.value)} /> : undefined,
            detail: nativeImageRatioOptionLabel(model, resolution, value, option) })),
        ]} onChange={raw => update(ratio, raw)} />
      {ratioValue !== "" && !ratio.options?.some(option => String(option.value) === String(ratioValue)) && <small role="status" className="parameter-help">
        当前比例：{String(ratioValue)} · 目录比例：{ratio.options?.map(option => option.label).join(" / ") || "—"}
      </small>}
    </>}
    {genimageOpenSize ? <>
      <div className="parameter-size-summary" aria-label="当前尺寸">请求 size：{String(value) || "供应商默认"}</div>
      <GenimageCustomSizeFields id={id} value={String(value)} onChange={raw => update(resolution, raw)} />
    </> : showDimensions && <>
    <div className="parameter-size-summary" aria-label="当前尺寸" title={dimensionsTitle}>
      {dimensions ? `${exactDimensions ? "供应商声明尺寸" : pdogDeclaredTier ? "size 映射" : "参考尺寸"} ${dimensions.width} × ${dimensions.height}` : "实际像素以原图为准"}
    </div>
    <Disclosure label="查看宽高" className="parameter-custom-size">
    <div className="parameter-dimensions-inputs">
      <span>W</span>
      <input id={`${id}-width`} aria-label="图片宽度" value={dimensions?.width ?? ""} readOnly
        placeholder={dimensions ? "宽" : "以原图为准"} title={dimensionsTitle} />
      <span className="parameter-dimensions-swap">↔</span>
      <span>H</span>
      <input id={`${id}-height`} aria-label="图片高度" value={dimensions?.height ?? ""} readOnly
        placeholder={dimensions ? "高" : "以原图为准"} title={dimensionsTitle} />
    </div>
    </Disclosure>
    </>}
    {genimageOpenSize && genimageImageRatioIssues(parameters).map(issue => <small key={issue.code} role="status" className="parameter-help">{issue.message}</small>)}
    {mikotoDeclaredTier && mikotoImageRatioIssues(parameters).map(issue => <small key={issue.code} role="status" className="parameter-help">{issue.message}</small>)}
    {pdogDeclaredTier && pdogImageSizeSelection(parameters).issues.map(issue => <small key={issue.code} role="status" className="parameter-help">{issue.message}</small>)}
    {genimageOpenSize && savedGenimageRatio !== undefined && !genimageImageRatioIssues(parameters).length &&
      <small className="parameter-help">比例偏好：{String(savedGenimageRatio)} · 请求 size：{String(value)}。</small>}
    {showDimensions && referenceDimensions && !exactDimensions && <small className="parameter-help">{pdogDeclaredTier
      ? "已输入的 W/H 优先于映射尺寸。"
      : "参考像素不作为 size 请求发送。"}</small>}
  </div>;
}

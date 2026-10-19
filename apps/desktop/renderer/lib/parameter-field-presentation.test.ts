import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, ModelParameterDescriptor } from "@super-canvas/providers";
import { NodeParameterFields } from "../components/node-parameter-fields";
import { NodeParameterSources } from "../components/node-parameter-sources";
import { NativeImageResolutionSources } from "../components/native-image-resolution-fields";
import { coerceParameterInput } from "./model-parameters";
import { parameterPresentationGroups } from "./parameter-field-presentation";

const field = (key: string, extra: Partial<ModelParameterDescriptor> = {}): ModelParameterDescriptor => ({ key, label: key, control: "text", ...extra });
const model = (parameters: ModelParameterDescriptor[], metadata: ModelDescriptor["metadata"] = {}): ModelDescriptor => ({
  id: "presentation-contract", name: "本地展示合同", operations: ["image.generate", "video.generate", "music.generate"], parameters, metadata,
});
const network = vi.fn(() => { throw new Error("Presentation tests must stay offline"); });
beforeAll(() => { vi.stubGlobal("React", React); vi.stubGlobal("fetch", network); });
afterAll(() => { try { expect(network).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); } });

describe("parameter presentation guards", () => {
  it("keeps every video protocol, billing and unknown field core; only the explicit optional detail list collapses", () => {
    const core = ["mode", "duration", "fps", "generate_audio", "resolution", "quality", "reference_video_seconds", "n", "first_frame", "future_supplier_field"].map(key => field(key));
    const details = ["seed", "negative_prompt", "watermark"].map(key => field(key));
    const groups = parameterPresentationGroups("video-generation", [...core, ...details], []);
    expect(groups.find(group => group.key === "video")!.descriptors).toEqual(core);
    expect(groups.find(group => group.key === "more")!.descriptors).toEqual(details);
    for (const descriptor of [...core, ...details]) expect(groups.flatMap(group => group.descriptors).filter(item => item === descriptor)).toHaveLength(1);
  });

  it("keeps required fields core and forces invalid optional fields open in their stable group", () => {
    const descriptors = [field("seed", { required: true }), field("negative_prompt"), field("watermark")];
    const groups = parameterPresentationGroups("image-generation", descriptors, [{ path: "parameters.negative_prompt" }, { path: "parameters.watermark.enabled" }]);
    expect(groups.find(group => group.key === "more")!.descriptors).toEqual(descriptors.slice(1));
    expect(groups.find(group => group.key === "more")!.forceOpen).toBe(true);
    expect(groups.find(group => group.key === "output")!.descriptors).toEqual(descriptors.slice(0, 1));
    expect(parameterPresentationGroups("image-generation", descriptors, []).find(group => group.key === "more")!.descriptors).toEqual(descriptors.slice(1));
  });

  it("separates music composition from output and tempo while retaining unknown controls", () => {
    const descriptors = ["title", "lyrics", "instrumental", "duration", "bpm", "audio_format", "n", "new_music_option", "seed"].map(key => field(key));
    const groups = parameterPresentationGroups("music-generation", descriptors, []);
    expect(groups.map(group => [group.label, group.descriptors.map(descriptor => descriptor.key)])).toEqual([
      ["作品与歌词", ["title", "lyrics", "instrumental"]],
      ["输出与节奏", ["duration", "bpm", "audio_format", "n", "new_music_option"]],
      ["更多参数", ["seed"]],
    ]);
  });

  it("renders an invalid saved seed and its correction control visibly instead of hiding the issue in more parameters", () => {
    const seed = field("seed", { label: "随机种子", control: "number", valueType: "integer", min: 0, max: 10 });
    const html = renderToStaticMarkup(createElement(NodeParameterFields, { nodeId: "invalid-seed", nodeType: "video-generation", provider: "rest", model: model([seed]), parameters: { seed: 999 }, onChange: () => undefined, showAdvanced: false }));
    expect(html).toContain('aria-label="当前参数与目录数据"');
    expect(html).toContain("更多参数");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("含需修改的参数，修正前保持展开。");
    expect(html).toMatch(/type="number"[^>]*value="999"/u);
    expect(html).not.toMatch(/<div[^>]* hidden=/u);
  });

  it("keeps transparent mode, format and compression in the same visible output section", () => {
    const descriptors = [field("output_format", { control: "select", options: [{ value: "png", label: "PNG" }] }), field("output_compression", { control: "number" })];
    const html = renderToStaticMarkup(createElement(NodeParameterFields, { nodeId: "output", nodeType: "image-generation", provider: "rest", model: model(descriptors), parameters: { background: "transparent", output_format: "png" }, transparentSupported: true, onChange: () => undefined, showAdvanced: false }));
    const output = html.slice(html.indexOf('data-parameter-section="output"'));
    expect(output).toContain('aria-label="生成模式"');
    expect(output).toContain("透明背景 · PNG 原图");
    expect(output).toContain("透明模式使用 PNG，保留透明通道");
    expect(output).toContain("压缩率适用格式：JPEG / WebP");
    expect(output).not.toContain("更多参数");
  });

  it("keeps explicit removal of undeclared saved values outside every collapsed disclosure", () => {
    const current = model([field("seed", { description: "种子来源" })], { cOpenImageContract: 1, imageAdditionalFieldContract: "not-declared-in-exact-supplier-material" });
    const html = renderToStaticMarkup(createElement(NodeParameterFields, { nodeId: "saved-extra", nodeType: "image-generation", provider: "rest", model: current, parameters: { user: "saved-user" }, onChange: () => undefined, showAdvanced: false }));
    const clear = html.indexOf('aria-label="已保存的其它图片字段"');
    const more = html.indexOf("parameter-more-fields");
    const sources = html.indexOf("parameter-sources");
    expect(clear).toBeGreaterThan(more);
    expect(clear).toBeLessThan(sources);
    expect(html.slice(clear, sources)).toContain("清除 user");
    expect(html.slice(clear, sources)).not.toContain("hidden=");
  });
});

describe("parameter evidence presentation", () => {
  it("retains the generated fixed-resolution contract note even though it is absent from the original descriptor list", () => {
    const ratio = field("aspect_ratio", { control: "select", options: [{ value: "16:9", label: "16:9" }] });
    const current = model([ratio], { imageNativeParameterContract: true, imageFixedResolution: "2K" });
    const html = renderToStaticMarkup(createElement(NodeParameterFields, { nodeId: "fixed-native", nodeType: "image-generation", provider: "rest", model: current, parameters: { aspect_ratio: "16:9" }, onChange: () => undefined, showAdvanced: false }));
    expect(html).toContain("清晰度由完整型号决定；切换档位需要切换型号。供应商未公开逐比例像素表，以原图为准。");
    expect(html).toContain("参数与来源");
  });

  it("keeps complete contract, group, native and descriptor facts in one initially closed sources disclosure", () => {
    const resolution = field("size_tier", { description: "完整档位来源原文" });
    const current = model([resolution], { mikotoImageContract: true, imageResolutionTierParameter: "size_tier", imageParameterContractNote: "完整图片合同原文", imageCapabilityNote: "同身份实测原文", supplierGroupResolutionLabel: "原生组说明", supplierGroupDescription: "完整分组来源", supplierGroupInfoStale: true });
    const html = renderToStaticMarkup(createElement(NodeParameterSources, { model: current, descriptors: [resolution], nodeType: "image-generation", nativeSources: createElement(NativeImageResolutionSources, { model: current, resolution, parameters: { size_tier: "4K", aspect_ratio: "4:3" } }), transparencyNote: "完整透明来源" }));
    expect(html).toContain("参数与来源");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("hidden=\"\"");
    for (const text of ["完整图片合同原文", "同身份实测原文", "原生组说明（上次记录）", "完整分组来源", "完整档位来源原文", "4K · 逐档像素映射：—；请填写独立 W/H，请求使用 size 原值。 比例偏好：4:3（保留）。", "完整透明来源"]) expect(html).toContain(text);
  });

  it("preserves a visible user-fallback marker and valid slider description while moving the complete source facts", () => {
    const duration = field("duration", { label: "时长", control: "number", valueType: "integer", min: 1, max: 30, step: 1, default: 5 });
    const html = renderToStaticMarkup(createElement(NodeParameterFields, { nodeId: "fallback", nodeType: "video-generation", provider: "rest", model: model([duration], { durationRangeSource: "user-fallback" }), parameters: { duration: 5 }, onChange: () => undefined, showAdvanced: false }));
    const marker = /<small id="([^"]+)"[^>]*data-duration-source="user-fallback">([^<]+)<\/small>/u.exec(html);
    expect(marker?.[2]).toContain("用户兜底范围：1–30 秒");
    expect(html).toMatch(new RegExp(`aria-describedby="[^"]*${marker![1]}[^"]*"`, "u"));
    expect(html).toContain("用户兜底范围：1–30 秒。供应商未公布完整范围；已公布的限制仍优先适用。");
  });

  it("presents dynamic numeric quality through the dropdown and numeric custom editor without changing its raw type or bounds", () => {
    const quality = field("quality", { label: "数值质量", control: "number", valueType: "number", allowCustomValue: true, min: 0, max: 1, step: 0.05, required: true });
    const parameters = { quality: 0.75 };
    const html = renderToStaticMarkup(createElement(NodeParameterFields, { nodeId: "numeric-quality", nodeType: "video-generation", provider: "rest", model: model([quality]), parameters, onChange: () => undefined, showAdvanced: false }));
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="数值质量"');
    expect(html).toMatch(/type="number"[^>]*aria-label="数值质量（自定义）"[^>]*min="0"[^>]*max="1"[^>]*step="0.05"/u);
    expect(html).toContain('value="0.75"');
    expect(coerceParameterInput(quality, "0.75", "video-generation")).toBe(0.75);
    expect(parameters).toEqual({ quality: 0.75 });
  });
});

describe("panel-only enum presentation", () => {
  it.each(["video-generation", "image-generation"] as const)("keeps the disabled automatic ratio label and reason inspectable beside a sole static ratio in %s", nodeType => {
    const ratio = field("aspect_ratio", { label: "单一比例", control: "select", default: "16:9", options: [{ value: "16:9", label: "16:9" }] });
    const current = model([ratio], nodeType === "image-generation" ? { imageNativeParameterContract: true, imageFixedResolution: "2K" } : {});
    const html = renderToStaticMarkup(createElement(NodeParameterFields, { nodeId: `fixed-ratio-${nodeType}`, nodeType, provider: "rest", model: current, parameters: { aspect_ratio: "16:9" }, panelPresentation: true, onChange: () => undefined, showAdvanced: false }));
    expect(html).toMatch(/role="textbox"[^>]*data-value="16:9"/u);
    expect(html).toContain("自动 · 跟随提示词，其次参考图");
    expect(html).toContain("当前型号未声明此自动比例，请选择已列比例或模型默认。");
    expect(html).toContain("选项限制");
  });

  it("uses the common dropdown for every closed enum only when the canvas panel opts in", () => {
    const descriptors = [field("resolution", { control: "select", default: "720p", options: [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] }),
      field("n", { control: "select", valueType: "integer", default: 1, options: [{ value: 1, label: "1 个" }, { value: 2, label: "2 个" }] })];
    const parameters = { resolution: "720p", n: 2 };
    const props = { nodeId: "panel-enums", nodeType: "video-generation" as const, provider: "rest", model: model(descriptors), parameters, onChange: vi.fn(), showAdvanced: false };
    const ordinaryEditor = renderToStaticMarkup(createElement(NodeParameterFields, props));
    expect(ordinaryEditor.match(/<select /gu)).toHaveLength(2);
    const panel = renderToStaticMarkup(createElement(NodeParameterFields, { ...props, panelPresentation: true }));
    expect(panel).not.toContain("<select");
    expect(panel.match(/role="combobox"/gu)).toHaveLength(2);
    expect(panel).toContain('data-value="2"');
    expect(parameters).toEqual({ resolution: "720p", n: 2 });
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("shows a legal fixed duration statically while retaining invalid saved values and alias correction as dropdowns", () => {
    const descriptor = field("duration", { label: "时长", control: "number", valueType: "integer", min: 30, max: 30, default: 30 });
    const render = (parameters: Record<string, unknown>, metadata: ModelDescriptor["metadata"] = {}) => renderToStaticMarkup(createElement(NodeParameterFields, {
      nodeId: "fixed-duration", nodeType: "video-generation", provider: "rest", model: model([descriptor], metadata), parameters, onChange: () => undefined, panelPresentation: true, showAdvanced: false,
    }));
    expect(render({ duration: 30 })).toMatch(/role="textbox"[^>]*data-value="30"[^>]*aria-label="时长"/u);
    expect(render({ duration: 45 })).toContain('role="combobox"');
    expect(render({ duration: 45 })).toContain('data-value="45"');
    expect(render({ duration: 45 })).toContain('aria-invalid="true"');
    expect(render({ duration: 30, seconds: 30 }, { jiasuVideoContract: true })).toContain('role="combobox"');
  });

  it("retains the canonical re-selection entry when a sole enum is displayed through a saved alias", () => {
    const descriptor = field("duration", { control: "select", valueType: "integer", default: 30, options: [{ value: 30, label: "30 秒" }] });
    const parameters = { seconds: 30 };
    const html = renderToStaticMarkup(createElement(NodeParameterFields, { nodeId: "sole-alias", nodeType: "video-generation", provider: "rest", model: model([descriptor], { jiasuVideoContract: true }), parameters, panelPresentation: true, onChange: () => undefined, showAdvanced: false }));
    expect(html).toContain('role="combobox"');
    expect(html).toContain('data-value="30"');
    expect(parameters).toEqual({ seconds: 30 });
  });

  it("renders transparent PNG as a readonly locked value while keeping other editors on their existing control", () => {
    const descriptor = field("output_format", { label: "输出格式", control: "select", default: "png", options: ["png", "jpeg", "webp"].map(value => ({ value, label: value.toUpperCase() })) });
    const props = { nodeId: "png-lock", nodeType: "image-generation" as const, provider: "rest", model: model([descriptor]), parameters: { background: "transparent", output_format: "png" }, transparentSupported: true, onChange: vi.fn(), showAdvanced: false };
    const panel = renderToStaticMarkup(createElement(NodeParameterFields, { ...props, panelPresentation: true }));
    expect(panel).toMatch(/role="textbox"[^>]*data-value="png"[^>]*aria-label="输出格式"[^>]*aria-disabled="true"/u);
    expect(panel).toContain('aria-readonly="true"');
    expect(panel).not.toContain("<select");
    expect(renderToStaticMarkup(createElement(NodeParameterFields, props))).toContain("<select");
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("places the panel duration value beside its label before the slider, and leaves the other editor layout unchanged", () => {
    const descriptor = field("duration", { label: "时长", control: "number", valueType: "integer", min: 1, max: 30, step: 1, default: 5 });
    const props = { nodeId: "duration-row", nodeType: "video-generation" as const, provider: "rest", model: model([descriptor]), parameters: { duration: 5 }, onChange: () => undefined, showAdvanced: false };
    const panel = renderToStaticMarkup(createElement(NodeParameterFields, { ...props, panelPresentation: true }));
    expect(panel.indexOf("<label")).toBeLessThan(panel.indexOf("<output"));
    expect(panel.indexOf("<output")).toBeLessThan(panel.indexOf('type="range"'));
    const ordinary = renderToStaticMarkup(createElement(NodeParameterFields, props));
    expect(ordinary.indexOf('type="range"')).toBeLessThan(ordinary.indexOf("<output"));
  });
});

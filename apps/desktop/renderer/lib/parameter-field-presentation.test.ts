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

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, ModelParameterDescriptor } from "@super-canvas/providers";
import { jijiuVideoAspectRatioPresets, NodeParameterFields } from "../components/node-parameter-fields";
import { normalizedParametersForModel } from "./model-parameters";

const ratio: ModelParameterDescriptor = { key: "aspect_ratio", label: "画面比例", control: "text", valueType: "string", placeholder: "供应商默认（留空）" };
const presets = [{ value: "16:9", label: "16:9（横屏）" }, { value: "9:16", label: "9:16（竖屏）" }, { value: "1:1", label: "1:1（方形）" }];
const model: ModelDescriptor = { id: "SD2.0fast稳定903A", name: "SD2.0fast稳定903A", operations: ["video.generate"], parameters: [ratio],
  metadata: { jijiuVideoContract: true, videoAspectRatioPresets: presets } };
const render = (parameters: Record<string, unknown>, selectedModel = model) => renderToStaticMarkup(React.createElement(NodeParameterFields, {
  nodeId: "ratio-offline", nodeType: "video-generation", provider: "openai", model: selectedModel, parameters, onChange: () => {},
}));

describe("Jijiu video aspect-ratio shortcuts", () => {
  const network = vi.fn(() => { throw Error("No network is allowed"); });
  beforeAll(() => { vi.stubGlobal("React", React); vi.stubGlobal("fetch", network); });
  afterAll(() => { try { expect(network).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); } });

  it("offers the three declared shortcuts plus default and custom, without a default mutation", () => {
    const html = render({});
    expect(html).toContain('value="" selected="">供应商默认</option>');
    for (const option of presets) expect(html).toContain(`value="${option.value}">${option.label}</option>`);
    expect(html).toContain('value="__custom_ratio__">自定义</option>');
    expect(html).not.toContain('aria-label="画面比例（自定义）"');
    expect(ratio.options).toBeUndefined();
    expect(normalizedParametersForModel("video-generation", "openai", model, {})).toEqual({});
  });

  it.each(["3:2", "21:9", "1.5:1"])("preserves saved custom %s rather than coercing it to a suggested option", value => {
    const html = render({ aspect_ratio: value });
    expect(html).toContain('value="__custom_ratio__" selected="">自定义</option>');
    expect(html).toMatch(new RegExp(`aria-label="画面比例（自定义）"[^>]*value="${value.replaceAll(".", "\\.")}"`, "u"));
    expect(normalizedParametersForModel("video-generation", "openai", model, { aspect_ratio: value })).toEqual({ aspect_ratio: value });
  });

  it("keeps fixed enums and other suppliers' free-text controls unchanged", () => {
    const fixed = { ...model, parameters: [{ ...ratio, control: "select" as const, options: presets }] };
    const other = { ...model, metadata: { videoAspectRatioPresets: presets } };
    expect(jijiuVideoAspectRatioPresets(fixed, fixed.parameters[0]!)).toEqual([]);
    expect(jijiuVideoAspectRatioPresets(other, ratio)).toEqual([]);
    expect(render({ aspect_ratio: "16:9" }, fixed)).not.toContain("__custom_ratio__");
    expect(render({ aspect_ratio: "3:2" }, other)).not.toContain("__custom_ratio__");
  });

  it("accepts only well-formed positive string ratios from exact-contract metadata", () => {
    const malformed = { ...model, metadata: { ...model.metadata, videoAspectRatioPresets: [...presets, presets[0],
      { value: "custom", label: "bad" }, { value: "0:9", label: "bad" }, { value: 16, label: "bad" },
      { value: "2:1", label: "" }, { value: "-2:1", label: "bad" }, null] } };
    expect(jijiuVideoAspectRatioPresets(malformed, ratio)).toEqual(presets);
  });
});

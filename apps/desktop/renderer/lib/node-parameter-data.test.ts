import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { remainingVideoModel } from "@super-canvas/providers";
import { validateModelParameters } from "@super-canvas/providers/cli-contracts";
import { NodeParameterFields, parameterIssueFacts } from "../components/node-parameter-fields";
import { NativeImageResolutionFields } from "../components/native-image-resolution-fields";

vi.mock("../components/ui/Dropdown", async () => ({
  Dropdown: (await import("./test-helpers/parameter-dropdown.test-helper")).StaticParameterDropdown,
}));

const model: ModelDescriptor = { id: "dola-sd-2.5", name: "dola-sd-2.5", operations: ["video.generate"],
  parameters: [
    { key: "duration", label: "视频时长", control: "number", valueType: "integer", min: 1, max: 30, step: 1, default: 5 },
    { key: "resolution", label: "输出分辨率", control: "select", options: [{ value: "provider-default", label: "供应商默认" }] },
    { key: "aspect_ratio", label: "画面比例", control: "select", options: [{ value: "16:9", label: "16:9" }] },
  ], metadata: { resolutionRangeUnverified: true, durationRangeSource: "user-fallback" } };

describe("parameter panel directory data (offline)", () => {
  const network = vi.fn(() => { throw Error("No provider requests are allowed"); });
  beforeAll(() => { vi.stubGlobal("React", React); vi.stubGlobal("fetch", network); });
  afterAll(() => { try { expect(network).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); } });

  it("shows saved 720p and the empty supplier range instead of a validator verdict", () => {
    const parameters = Object.freeze({ duration: 30, aspect_ratio: "16:9", resolution: "720p" });
    const onChange = vi.fn();
    const validation = validateModelParameters(model, parameters);
    expect(validation.valid).toBe(false);
    const html = renderToStaticMarkup(React.createElement(NodeParameterFields, { nodeId: "saved-720p", nodeType: "video-generation",
      provider: "rest", model, parameters, onChange, showAdvanced: false }));
    expect(html).toContain("输出分辨率 · 当前值：720p · 目录范围：— · 默认值：—");
    expect(html).toContain('value="720p" disabled="" selected="">720p（已保存）');
    expect(html).not.toMatch(/未确认|不支持|不可运行|请重新选择/u);
    expect(parameters).toEqual({ duration: 30, aspect_ratio: "16:9", resolution: "720p" });
    expect(onChange).not.toHaveBeenCalled();
    expect(validateModelParameters(model, parameters)).toEqual(validation);
  });

  it("renders the model plaza API example as a suggestion beside an editable resolution", () => {
    const supplied = remainingVideoModel("jiasu", "dola-sd-2.5", { id: "dola-sd-2.5", name: "dola-sd-2.5", operations: ["video.generate"],
      metadata: { jiasuCatalogRecord: { supportedEndpointTypes: ["openai-video"], description: "30图 0视频 10音频", apiParameters: [] } } }, { group: "vip" })!;
    expect(supplied.parameters?.find(parameter => parameter.key === "resolution")).toMatchObject({ control: "text", allowCustomValue: true,
      options: [{ value: "720p", label: "720p（API 示例）" }] });
    const parameters = Object.freeze({ duration: 29, aspect_ratio: "16:9", resolution: "1440p" });
    const onChange = vi.fn();
    expect(validateModelParameters(supplied, parameters).valid).toBe(true);
    const html = renderToStaticMarkup(React.createElement(NodeParameterFields, { nodeId: "plaza-example", nodeType: "video-generation",
      provider: "rest", model: supplied, parameters, onChange, showAdvanced: false }));
    expect(html).toMatch(/<input(?=[^>]*type="text")(?=[^>]*value="1440p")[^>]*>/u);
    expect(html).toContain("<datalist");
    expect(html).toContain("720p（API 示例）");
    expect(html).toContain("按输入发送；留空使用供应商默认值");
    expect(html).not.toContain("1440p（已保存）");
    expect(onChange).not.toHaveBeenCalled();
    expect(parameters.resolution).toBe("1440p");
  });

  it.each(["jiasu", "secure", "chentu", "cangyuan"])("retains %s editable typed duration and resolution across an offline parameter render", supplier => {
    const supplied: ModelDescriptor = { id: `${supplier}-typed-fields-fixture`, name: "Offline API fields", operations: ["video.generate"],
      metadata: { supplier, durationRangeUnverified: true, resolutionRangeUnverified: true, videoResolutionAllowsCustom: true },
      parameters: [
        { key: "duration", label: "视频时长", control: "number", valueType: "integer", allowCustomValue: true, min: 1, step: 1,
          options: [{ value: 5, label: "5 秒（API 示例）" }] },
        { key: "resolution", label: "输出分辨率", control: "text", valueType: "string", allowCustomValue: true,
          options: [{ value: "720p", label: "720p（API 示例）" }] },
      ] };
    const parameters = Object.freeze({ duration: 38, resolution: "1440p" });
    const onChange = vi.fn();
    const html = renderToStaticMarkup(React.createElement(NodeParameterFields, { nodeId: `${supplier}-fields`, nodeType: "video-generation",
      provider: "rest", model: supplied, parameters, onChange, showAdvanced: false }));
    expect(html).toMatch(/<input(?=[^>]*type="number")(?=[^>]*value="38")[^>]*>/u);
    expect(html).toMatch(/<input(?=[^>]*type="text")(?=[^>]*value="1440p")[^>]*>/u);
    expect(html).toContain("API 示例：5");
    expect(html).toContain("API 示例：720p");
    expect(html).not.toContain("选择供应商默认会清除当前自定义值");
    expect(validateModelParameters(supplied, parameters).valid).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(parameters).toEqual({ duration: 38, resolution: "1440p" });
  });

  it("keeps an out-of-range duration and shows bounds, step and declared default", () => {
    const parameters = Object.freeze({ duration: 38, resolution: "provider-default" });
    const html = renderToStaticMarkup(React.createElement(NodeParameterFields, { nodeId: "saved-duration", nodeType: "video-generation",
      provider: "rest", model, parameters, onChange: () => { throw Error("Saved parameters changed"); }, showAdvanced: false }));
    expect(html).toContain("视频时长 · 当前值：38 · 目录范围：1–30 秒 · 步长 1 秒 · 默认值：5 · 用户指定兜底");
    expect(html).toContain("38（已保存）");
    expect(html).not.toMatch(/不符合|待修正|需要重新|不能大于/u);
    expect(validateModelParameters(model, parameters).issues).toContainEqual(expect.objectContaining({ path: "parameters.duration", code: "max" }));
  });

  it("keeps open select suggestions editable after reloading saved custom strings", () => {
    const open: ModelDescriptor = { ...model, metadata: { resolutionRangeUnverified: true }, parameters: [
      model.parameters![0]!,
      { key: "resolution", label: "输出分辨率", control: "select", valueType: "string", allowCustomValue: true,
        options: [{ value: "720p", label: "720p（示例）" }] },
      { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", allowCustomValue: true,
        options: [{ value: "16:9", label: "16:9（示例）" }] },
    ] };
    for (const aspect_ratio of ["2.35:1", "2.39:1"]) {
      const parameters = Object.freeze({ duration: 7, resolution: "custom-resolution", aspect_ratio });
      const onChange = vi.fn();
      const html = renderToStaticMarkup(React.createElement(NodeParameterFields, { nodeId: "open-select", nodeType: "video-generation",
        provider: "rest", model: open, parameters, onChange }));
      expect(html).toMatch(/<input(?=[^>]*aria-label="输出分辨率（自定义）")(?=[^>]*value="custom-resolution")[^>]*>/u);
      expect(html).toContain(`aria-label="画面比例（自定义）"`);
      expect(html).toContain(`value="${aspect_ratio}"`);
      expect(html).toContain("720p（示例）");
      expect(html).toContain("16:9（示例）");
      expect(html).not.toContain('aria-invalid="true"');
      expect(validateModelParameters(open, parameters).valid).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
      expect(parameters).toEqual({ duration: 7, resolution: "custom-resolution", aspect_ratio });
    }
  });

  it("offers custom input from a suggested value without widening explicit enums or duration bounds", () => {
    const suggested: ModelDescriptor = { ...model, parameters: model.parameters!.map(parameter => parameter.key === "aspect_ratio"
      ? { ...parameter, valueType: "string", allowCustomValue: true } : parameter) };
    const html = renderToStaticMarkup(React.createElement(NodeParameterFields, { nodeId: "suggested-select", nodeType: "video-generation",
      provider: "rest", model: suggested, parameters: { duration: 38, resolution: "720p", aspect_ratio: "16:9" }, onChange: vi.fn() }));
    expect(html).toContain('value="__custom_ratio__">自定义</option>');
    expect(html).not.toContain('aria-label="画面比例（自定义）"');
    expect(html).not.toContain('aria-label="输出分辨率（自定义）"');
    expect(html).toContain('value="720p" disabled="" selected="">720p（已保存）');
    expect(html).toContain("38（已保存）");
    expect(validateModelParameters(suggested, { duration: 38, aspect_ratio: "2.39:1" }).issues)
      .toContainEqual(expect.objectContaining({ path: "parameters.duration", code: "max" }));
  });

  it("uses only published defaults when duration range data is missing and preserves absent custom fields", () => {
    const missing = { metadata: { durationRangeUnverified: true, videoParameterConfirmedDefaults: { duration: 8 } } };
    const issues = [{ path: "parameters.duration" }, { path: "parameters.duration" }, { path: "parameters.custom" }];
    expect(parameterIssueFacts(issues, model.parameters!, { duration: 42, custom: false }, missing)).toEqual([
      "视频时长 · 当前值：42 · 目录范围：— · 默认值：8 · 数据类型：integer",
      "custom · 当前值：false · 目录范围：— · 默认值：—",
    ]);
  });

  it("shows original native tier and ratio alongside actual directory choices without inventing pixels", () => {
    const resolution = { key: "size", label: "分辨率", control: "select" as const,
      options: [{ value: "auto", label: "自动" }, { value: "2K", label: "2K" }, { value: "4K", label: "4K" }] };
    const ratio = { key: "aspect_ratio", label: "画面比例", control: "select" as const, options: [{ value: "1:1", label: "1:1" }] };
    const html = renderToStaticMarkup(React.createElement(NativeImageResolutionFields, { id: "saved-tier", resolution, ratio,
      model: { id: "native", name: "native", operations: ["image.generate"], metadata: { imageNativeParameterContract: true } },
      parameters: { size: "4096x4096", aspect_ratio: "3:2" }, onChange: () => { throw Error("Saved parameters changed"); } }));
    expect(html).toContain("当前档位：4096x4096 · 目录档位：自动 / 2K / 4K");
    expect(html).toContain("当前比例：3:2 · 目录比例：1:1");
    expect(html.match(/readOnly="" placeholder="以原图为准"[^>]*value=""/gu)).toHaveLength(2);
    expect(html).not.toMatch(/未确认|不支持|不可运行/u);
  });
});

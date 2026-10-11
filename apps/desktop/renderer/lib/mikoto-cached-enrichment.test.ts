import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { effectiveImageCapabilities } from "./supplier-capabilities";
import { normalizedParametersForModel, setParameterValue } from "./model-parameters";
import { nativeImageResolutionControl } from "./native-image-resolution";
import { NodeParameterFields, setParameterValueWithSizeExclusivity } from "../components/node-parameter-fields";
import { modelEstimatedCost } from "./model-display";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

const supplier = { id: "mikoto", siteUrl: "https://api.mikoto.vip", apiUrl: "https://api.mikoto.vip",
  updatedAt: "2026-10-11T04:48:27.246Z", scannedAt: "2026-10-11T04:48:27.246Z",
  state: { sourceId: "source-39" }, catalog: { groups: [] } } as unknown as SupplierRecord;
const connection = { id: "key-39", provider: "openai", config: { supplierKey: "mikoto", baseUrl: "https://api.mikoto.vip/",
  accountKeyGroup: "生图（2k4k 高质量）", accountKeyGroupId: "39" } };
const savedModel = (id: string): ModelDescriptor => ({ id, name: id, operations: ["image.generate", "image.edit"],
  parameters: [{ key: "quality", label: "质量（quality）", control: "text", valueType: "string",
    description: "官方分组声明五档质量，未公布具体接口值；按输入的字符串发送。" }],
  pricing: { kind: "per-image", currency: "USD", unitAmount: 0.12, sourceUrl: "https://api.mikoto.vip/api/v1/channels/available",
    checkedAt: "2026-10-11T04:48:27.246Z", confidence: "exact" },
  metadata: { mikotoImageContract: true, imageQualityEnumPublished: false, priceSource: "supplier-catalog", supplierPriceGroupId: "39" } });
const enrich = (model: ModelDescriptor, current = connection) => effectiveImageCapabilities({ supplier, connection: current, model, fingerprint: "current-39" });

describe("installed cached Mikoto enrichment contract", () => {
  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("retains the open quality and same-group declared tiers for %s", id => {
    const source = savedModel(id);
    const snapshot = structuredClone(source);
    const result = enrich(source);
    const quality = result.model.parameters?.find(p => p.key === "quality");
    expect(quality).toMatchObject({ control: "text", valueType: "string" });
    expect(quality?.options).toBeUndefined();
    expect(quality?.default).toBe("max");
    expect(result.model.metadata?.imageQualityDefaultSource).toBe("user-highest-quality-preference");
    expect(result.model.parameters?.find(p => p.key === "size")).toMatchObject({ control: "dimensions", step: 1, allowCustomValue: true });
    expect(result.model.parameters?.find(p => p.key === "size")?.options).toBeUndefined();
    const native = nativeImageResolutionControl(result.model.parameters ?? [], result.model)!;
    expect(native.resolution.key).toBe("size_tier");
    expect(native.resolution.options?.map(o => o.value)).toEqual(["2K", "4K"]);
    expect(result.tiers.map(t => t.tier)).toEqual(["2K", "4K"]);
    expect(result.probeTiers).toEqual([]);
    expect(result.needsQualityProbe).toBe(false);
    expect(result.model.pricing).toEqual(source.pricing);
    expect(result.model.metadata?.supplierPriceGroupId).toBe("39");
    const choice = { quality: "max", size: "2880x2880", size_tier: "4K" };
    expect(normalizedParametersForModel("image-generation", "openai", result.model, choice)).toEqual(choice);
    expect(enrich(result.model).model).toEqual(result.model);
    expect(source).toEqual(snapshot);
  });
  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("renders selectable tiers and independent exact W/H for %s without pixel guesses", id => {
    const model = enrich(savedModel(id)).model;
    const selected = Object.freeze({ size_tier: "4K", size: "3840x2160", quality: "max", aspect_ratio: "16:9" });
    const onChange = vi.fn();
    const html = renderToStaticMarkup(React.createElement(NodeParameterFields, { nodeId: "mikoto39", nodeType: "image-generation",
      provider: "openai", model, parameters: selected, onChange }));
    expect(html).toMatch(/<button(?=[^>]*aria-pressed="false")[^>]*>2K<\/button>/u);
    expect(html).toMatch(/<button(?=[^>]*aria-pressed="true")[^>]*>4K<\/button>/u);
    expect(html).not.toContain(">1K</button>");
    expect(html).toContain("逐档像素映射：—；请填写独立 W/H");
    expect(html).toContain("比例偏好：16:9（保留）");
    expect(html).toMatch(/<input(?=[^>]*aria-label="Mikoto画面比例偏好")(?=[^>]*value="16:9")[^>]*>/u);
    expect(html).toMatch(/<input(?=[^>]*aria-label="图片宽度")(?=[^>]*value="3840")[^>]*>/u);
    expect(html).toMatch(/<input(?=[^>]*aria-label="图片高度")(?=[^>]*value="2160")[^>]*>/u);
    expect(html).toMatch(/<input(?=[^>]*type="text")(?=[^>]*value="max")[^>]*>/u);
    expect(html).not.toMatch(/max="3840"|step="16"|16 倍数对齐|readOnly=""/u);
    const twoK = setParameterValue(selected, "size_tier", "2K", model);
    expect(twoK).toMatchObject({ size_tier: "2K", size: "3840x2160", quality: "max", aspect_ratio: "16:9" });
    const changedDimensions = setParameterValueWithSizeExclusivity(twoK, "size", "2051x2049", {
      hasSizeControl: true, hasAspectRatioControl: true, model });
    expect(normalizedParametersForModel("image-generation", "openai", model, changedDimensions)).toEqual({
      size_tier: "2K", size: "2051x2049", quality: "max", aspect_ratio: "16:9" });
    expect(modelEstimatedCost(model, { ...selected, n: 1 })).toBe("0.12 USD");
    expect(modelEstimatedCost(model, { ...changedDimensions, n: 1 })).toBeUndefined();
    const consistentPreference = setParameterValueWithSizeExclusivity(changedDimensions, "aspect_ratio", "1:1", {
      hasSizeControl: true, hasAspectRatioControl: true, model });
    expect(consistentPreference).toMatchObject({ size_tier: "2K", size: "2051x2049", quality: "max", aspect_ratio: "1:1" });
    expect(modelEstimatedCost(model, { ...consistentPreference, n: 1 })).toBe("0.12 USD");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("preserves this complete model's existing 2K/4K request values without rebuilding a pixel table", () => {
    const input = { ...savedModel("gpt-image-2.5-flare"), parameters: [
      { key: "size", label: "size", control: "dimensions" as const, options: [
        { label: "1K · source example", value: "1024x1024" },
        { label: "2K · source example", value: "2048x2048" },
        { label: "4K · source example", value: "2880x2880" },
      ] }, ...savedModel("gpt-image-2.5-flare").parameters! ] };
    const result = enrich(input).model;
    expect(result.parameters?.find(p => p.key === "size")?.options).toEqual(input.parameters[0]!.options?.slice(1));
    expect(result.parameters?.find(p => p.key === "size")?.options?.some(o => o.value === "1440x1440")).toBe(false);
    expect(result.parameters?.find(p => p.key === "quality")?.control).toBe("text");
  });
  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("retains the actual medium restriction on %s without generic max options", id => {
    const result = enrich(savedModel(id), { ...connection, config: { ...connection.config,
      accountKeyGroup: "生图（2k4k 中质量）", accountKeyGroupId: "16" } });
    expect(result.model.parameters?.find(p => p.key === "quality")).toMatchObject({ default: "medium", options: [{ label: "medium", value: "medium" }] });
    expect(normalizedParametersForModel("image-generation", "openai", result.model, { quality: "max", size: "2880x2880" })).toMatchObject({ quality: "max", size: "2880x2880" });
  });
  it("keeps the GPT2 supplier's eight pixel pairs separate from 2.5", () => {
    const result = enrich({ id: "gpt-image-2", name: "gpt-image-2", operations: ["image.generate"], parameters: [
      { key: "size", label: "size", control: "dimensions", options: [{ label: "4K", value: "2880x2880" }] },
      { key: "quality", label: "quality", control: "select" },
    ] });
    const size = result.model.parameters!.find(p => p.key === "size")!;
    expect(size.options?.map(o => o.value)).toContain("1440x1440");
    expect(size.options?.map(o => o.value)).toContain("3840x1646");
    expect(size.min).toBeUndefined();
    expect(size.max).toBeUndefined();
    expect(size.step).toBe(1);
    expect(nativeImageResolutionControl(result.model.parameters ?? [], result.model)).toBeUndefined();
    expect(result.model.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["high"]);
  });
});

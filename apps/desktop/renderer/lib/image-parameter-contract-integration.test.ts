import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { cangyuanCurrentModel } from "@super-canvas/providers/cangyuan-current-models";
import { resolveImageModelContract } from "@super-canvas/providers/image-model-contract";
import { evaluateImageParameters } from "@super-canvas/providers/image-parameter-contract";
import { modelPriceAmount } from "@super-canvas/providers/media-billing";
import { NodeParameterFields } from "../components/node-parameter-fields";
import { ModelPriceDetails } from "../components/model-price-details";
import { modelEstimatedCost, modelPriceSummary } from "./model-display";
import { designBatchPrice } from "./design-batch-price";
import type { CanvasNode } from "../components/types";
import { normalizedParametersForModel, parameterDescriptorsForValues } from "./model-parameters";
import { rememberModelParameters, savedModelParameters } from "./saved-model-parameters";

const modelId = "gpt-image-2.5-flare";
// Same offline supplier identity/descriptor as canvas-mikoto-open-parameters.spec.ts.
// Fixture prices are assertions about isolation, not a claim about a current tariff.
const connection = {
  provider: "openai",
  config: {
    baseUrl: "https://api.mikoto.vip/v1",
    supplierKey: "mikoto",
    accountKeyGroupId: "39",
    accountKeyGroup: "生图（2k4k 高质量）",
    usage: "canvas",
  },
};
const rawModel: ModelDescriptor = {
  id: modelId,
  name: modelId,
  operations: ["image.generate", "image.edit"],
  parameters: [{ key: "quality", label: "质量（quality）", control: "text", valueType: "string" }],
  metadata: { mikotoImageContract: true, imageQualityEnumPublished: false, supplierPriceGroupId: "39" },
  pricing: {
    kind: "per-image", currency: "USD", unitAmount: 0.12,
    checkedAt: "2026-10-11T04:48:27.246Z", sourceUrl: "https://quotes.invalid/mikoto-fixture", confidence: "exact",
  },
};
const selected = { size: "3840x2160", size_tier: "4K", aspect_ratio: "16:9", quality: "max" };

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

function renderFields(model: ModelDescriptor, parameters: Record<string, unknown>) {
  const onChange = vi.fn();
  const html = renderToStaticMarkup(React.createElement(NodeParameterFields, {
    nodeId: "contract-image", nodeType: "image-generation", provider: "openai", model, parameters,
    operation: "image.generate", showAdvanced: false, onChange,
  }));
  expect(onChange).not.toHaveBeenCalled();
  return html;
}

describe("shared image contract across controls, saved values and quotes (offline)", () => {
  const network = vi.fn(() => { throw new Error("Image contract tests must never contact a supplier"); });
  beforeAll(() => { vi.stubGlobal("React", React); vi.stubGlobal("fetch", network); });
  afterAll(() => {
    try { expect(network).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); }
  });

  it("keeps 4K / 16:9 / 3840×2160 / max in the common evaluation and the existing panel", () => {
    const input = freezeDeep(structuredClone(rawModel));
    const values = freezeDeep({ ...selected });
    const model = resolveImageModelContract(connection, input);
    const result = evaluateImageParameters(model, values, { operation: "image.generate" });
    expect(result.requestParameters).toMatchObject(selected);
    expect(result.pricingParameters).toMatchObject(selected);
    expect(result.controls.find(control => control.key === "quality")?.options?.map(option => option.value)).toContain("max");
    const size = result.controls.find(control => control.key === "size");
    expect(size?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "3840x2160", label: "4K · 16:9 · 3840 × 2160" }),
    ]));
    const html = renderFields(result.model, values);
    expect(html.match(/aria-label="自动与输出分辨率快捷档位"/gu)).toHaveLength(1);
    expect(html).toMatch(/<button(?=[^>]*aria-pressed="true")(?=[^>]*data-value="4K")[^>]*><span>4K<\/span>/u);
    expect(html).toMatch(/<button(?=[^>]*role="combobox")(?=[^>]*data-value="3840x2160")[^>]*>/u);
    expect(html).toContain("16:9");
    expect(html).toContain("4K · 3840 × 2160");
    expect(html.match(/aria-label="图片宽度"/gu)).toHaveLength(1);
    expect(html.match(/aria-label="图片高度"/gu)).toHaveLength(1);
    expect(html).toMatch(/<input[^>]*aria-label="图片宽度"[^>]*value="3840"/u);
    expect(html).toMatch(/<input[^>]*aria-label="图片高度"[^>]*value="2160"/u);
    expect(html).toMatch(/<button(?=[^>]*role="combobox")(?=[^>]*data-value="max")[^>]*>/u);
    expect(html).toContain("最高");
    expect(html).toContain('aria-label="生成模式"');
    expect(html).toContain("普通模式");
    expect(input).toEqual(rawModel);
    expect(values).toEqual(selected);
  });

  it("does not reuse a same-name model's quality rules between real Mikoto groups", () => {
    const high = resolveImageModelContract(connection, structuredClone(rawModel));
    const mediumConnection = { provider: connection.provider, config: {
      baseUrl: connection.config.baseUrl, supplierKey: "mikoto", usage: "canvas",
      accountKeyGroup: "生图（2k4k 中质量）" } };
    const medium = resolveImageModelContract(mediumConnection, { ...structuredClone(rawModel),
      metadata: { mikotoImageContract: true, imageQualityEnumPublished: true } });
    expect(high.id).toBe(medium.id);
    expect(evaluateImageParameters(high, {}).controls.find(control => control.key === "quality")?.default).toBe("max");
    expect(evaluateImageParameters(medium, {}).controls.find(control => control.key === "quality")?.options?.map(option => option.value)).toEqual(["medium"]);
    // A now-invalid saved choice is retained for validation, never silently lowered.
    expect(evaluateImageParameters(medium, selected).requestParameters.quality).toBe("max");
    expect(normalizedParametersForModel("image-generation", "openai", medium, selected)).toMatchObject(selected);
    expect(modelEstimatedCost(medium, selected)).toBeUndefined();
  });

  it("keeps explicit fixed-high and max contracts and prices separate for the same complete model ID", () => {
    // Deliberately synthetic manual schemas: do not attribute a fictional high-only
    // Image 2.5 group to a real supplier or widen an explicit fixed contract.
    const fixed: ModelDescriptor = {
      ...structuredClone(rawModel),
      metadata: { source: "manual", fixedQuality: "high", imageNativeParameterContract: true },
      parameters: [
        { key: "size", label: "输出尺寸", control: "dimensions", allowCustomValue: true },
        { key: "quality", label: "质量", control: "select", default: "high", options: [{ value: "high", label: "高" }] },
      ],
      pricing: { kind: "per-image", currency: "CNY", unitAmount: 0.07, confidence: "exact", checkedAt: "offline-fixture" },
    };
    const fixedConnection = { provider: "openai", config: { baseUrl: "https://fixed-contract.invalid/v1", accountKeyGroupId: "high-only", manualProtocol: true } };
    const fixedModel = resolveImageModelContract(fixedConnection, freezeDeep(fixed));
    const maxModel = resolveImageModelContract(connection, structuredClone(rawModel));
    expect(fixedModel.id).toBe(maxModel.id);
    expect(evaluateImageParameters(fixedModel, {}).controls.find(control => control.key === "quality")?.options?.map(option => option.value)).toEqual(["high"]);
    expect(evaluateImageParameters(maxModel, {}).controls.find(control => control.key === "quality")?.options?.map(option => option.value)).toContain("max");
    expect(modelEstimatedCost(fixedModel, { size: selected.size, quality: "high" })).toBe("0.07 CNY");
    expect(modelEstimatedCost(maxModel, selected)).toBe("0.12 USD");
    expect(modelEstimatedCost(fixedModel, selected)).toBeUndefined();
    const history = rememberModelParameters({ connectionId: "fixed", model: modelId, qualityMode: "custom", parameters: { ...selected, quality: "high" } });
    const both = JSON.parse(JSON.stringify(rememberModelParameters({ connectionId: "max", model: modelId,
      qualityMode: "custom", parameters: selected, modelParameterSelections: history })));
    expect(savedModelParameters(both, "fixed", modelId)?.parameters.quality).toBe("high");
    expect(savedModelParameters(both, "max", modelId)?.parameters.quality).toBe("max");
  });

  it.each([selected, { size: "3501x2301", size_tier: "4K", quality: "low" }])(
    "preserves explicitly saved values through JSON restore and repeated refresh: %j", original => {
      const values = freezeDeep(structuredClone(original));
      let model = resolveImageModelContract(connection, structuredClone(rawModel));
      for (let round = 0; round < 3; round++) {
        model = resolveImageModelContract(connection, JSON.parse(JSON.stringify(model)));
        const restored = JSON.parse(JSON.stringify(values));
        const evaluated = evaluateImageParameters(model, restored, { operation: "image.generate" });
        expect(evaluated.requestParameters).toMatchObject(original);
        expect(evaluated.pricingParameters).toMatchObject(original);
        expect(normalizedParametersForModel("image-generation", "openai", model, restored)).toMatchObject(original);
        expect(parameterDescriptorsForValues("image-generation", "openai", model, restored, "image.generate")
          .find(control => control.key === "quality")?.options?.map(option => option.value)).toContain(original.quality);
        expect(restored).toEqual(original);
      }
      expect(values).toEqual(original);
    },
  );

  it("retains the native lowercase billing tier in both request and price evaluation", () => {
    const model: ModelDescriptor = { ...cangyuanCurrentModel({ id: "gpt-image-2-x", name: "Cangyuan native tier fixture", operations: ["image.generate", "image.edit"] }),
      pricing: { kind: "tiered", billingUnit: "image", currency: "CNY", confidence: "exact", checkedAt: "offline-fixture",
        tiers: [
          { id: "2k", label: "2k", price: 0.075, conditions: [{ parameter: "tier", operator: "equals", value: "2k" }] },
          { id: "4k", label: "4k", price: 0.095, conditions: [{ parameter: "tier", operator: "equals", value: "4k" }] },
        ] },
    };
    const values = freezeDeep({ size: "3840x2160", size_tier: "4K", tier: "4k", quality: "high", n: 1 });
    const evaluated = evaluateImageParameters(model, values, { operation: "image.generate" });
    expect(evaluated.requestParameters).toMatchObject({ size: "3840x2160", tier: "4k", quality: "high", n: 1 });
    expect(evaluated.pricingParameters).toMatchObject({ size: "3840x2160", tier: "4k", quality: "high", n: 1 });
    expect(modelPriceAmount(model.pricing!, evaluated.pricingParameters)).toBe(0.095);
    expect(modelEstimatedCost(model, values)).toBe("0.095 CNY");
    expect(values.tier).toBe("4k");
  });

  it.each(["size_tier", "image_size"])("preserves case-sensitive native %s conditions in displayed and batch prices", key => {
    const model: ModelDescriptor = {
      id: "offline-native-image", name: "Offline native image", operations: ["image.generate"],
      metadata: { source: "manual" },
      parameters: [{ key, label: "档位", control: "text", default: "4K", allowCustomValue: true }],
      pricing: { kind: "tiered", billingUnit: "image", currency: "USD", confidence: "exact", checkedAt: "offline-fixture",
        tiers: ["auto", "custom-tier", "2k"].map(value => ({ id: value, label: value, price: 0.2,
          conditions: [{ parameter: "resolution", operator: "equals", value }] })) },
    };
    for (const value of ["auto", "custom-tier", "2k"]) {
      const parameters = { [key]: value };
      expect(modelEstimatedCost(model, parameters)).toBe("0.2 USD");
      expect(modelPriceSummary(model, parameters)).toContain("0.2 USD");
      const node: CanvasNode = { id: "native-price", type: "workflow", position: { x: 0, y: 0 },
        data: { nodeType: "image-generation", label: "Native condition quote", parameters, inputs: [], outputs: [] } };
      expect(designBatchPrice(model, [node])).toMatchObject({ total: 0.2, unknown: 0, currency: "USD" });
    }
  });

  it("does not invent a price when controls and selected parameters are available", () => {
    const unpriced: ModelDescriptor = { ...structuredClone(rawModel), pricing: undefined };
    const model = resolveImageModelContract(connection, unpriced);
    const evaluated = evaluateImageParameters(model, selected);
    expect(evaluated.model.pricing).toBeUndefined();
    expect(modelEstimatedCost(evaluated.model, evaluated.pricingParameters)).toBeUndefined();
    const html = renderToStaticMarkup(React.createElement(ModelPriceDetails, { model, parameters: selected }));
    expect(html).not.toContain("本次预计费用");
    expect(modelPriceSummary(model, selected)).not.toMatch(/(?:USD|CNY|¥|\$)\s*\d/u);
    expect(renderFields(evaluated.model, selected)).toMatch(/<button(?=[^>]*role="combobox")(?=[^>]*data-value="max")[^>]*>/u);
  });
});

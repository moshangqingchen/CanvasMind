import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseSupplierCatalog, type ModelDescriptor, type SupplierCatalogDiscovery } from "@super-canvas/providers";
import { applyJijiuImageCapabilities, jijiuGptImageParameters, jijiuGptImageRequestIssues } from "@super-canvas/providers/jijiu-image-contract";
import { validateModelParameters } from "@super-canvas/providers/cli-contracts";
import { NodeParameterFields } from "../components/node-parameter-fields";
import { modelEstimatedCost, modelPriceSummary } from "./model-display";
import { normalizedParametersForModel, parametersWithDefaults, setParameterValue } from "./model-parameters";
import { applySupplierCatalogPrices } from "./supplier-model-pricing";

vi.mock("./supplier-service", () => ({ getSupplierRecord: vi.fn(async () => null) }));
vi.mock("./server", () => ({ repository: { getSupplierVerification: vi.fn(async () => null) } }));

const id = "gpt-image-2-2K/4K", source = "https://newapi.jijiucanvas.com";
const fixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/jijiu-billing-20261010.json", import.meta.url), "utf8"));
const checkedAt = "2026-10-10T04:00:00Z";
const catalog: SupplierCatalogDiscovery = { ...parseSupplierCatalog(fixture, { supplierSiteUrl: source, checkedAt }), kind: "newapi", status: "live", complete: true, checkedAt };
const descriptor = (modelId = id, group = "default") => applyJijiuImageCapabilities({ provider: "openai", config: {
  baseUrl: `${source}/v1`, modelGroup: group, accountKeyGroup: group, usage: "canvas",
} }, { id: modelId, name: modelId, operations: ["image.generate", "image.edit"], metadata: {
  supplierGroupResolutionLabel: "官网分组 1K / 2K / 4K", supplierGroupDescription: "原始分组说明保留",
} });
const render = (model: ModelDescriptor, parameters: Record<string, string | number> = { size: "4K", quality: "high", n: 1 }) => renderToStaticMarkup(
  React.createElement(NodeParameterFields, { nodeId: "jijiu-high-tier", nodeType: "image-generation", provider: "openai", model,
    parameters, onChange: () => {}, showAdvanced: false, operation: "image.generate" }));

describe("Jijiu exact high-tier image controls (offline)", () => {
  const network = vi.fn(() => { throw new Error("No provider requests allowed in renderer control tests"); });
  beforeAll(() => { vi.stubGlobal("React", React); vi.stubGlobal("fetch", network); });
  afterAll(() => { try { expect(network).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); } });

  it("renders native tiers and independent highest quality without inventing a pixel matrix", () => {
    const model = descriptor(), html = render(model);
    expect(model.parameters?.find(parameter => parameter.key === "size")?.options?.map(option => option.value)).toEqual(["auto", "1K", "2K", "4K"]);
    expect(model.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["auto", "high"]);
    expect(html).toContain('aria-pressed="true">4K</button>');
    expect(html).toContain('value="high" selected="">最高</option>');
    expect(html.match(/aria-label="图片宽度"/gu)).toHaveLength(1);
    expect(html.match(/aria-label="图片高度"/gu)).toHaveLength(1);
    expect(html.match(/readOnly="" placeholder="以原图为准"[^>]*value=""/gu)).toHaveLength(2);
    expect(html).not.toMatch(/2048|4096|16 倍数|value="max"/u);
  });

  it.each(["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-sunburst"])("keeps %s's declared size string editable without turning its example into a pixel enum", modelId => {
    for (const group of ["default", "图片-GPT-image-2/2.5-1K"]) {
      const model = descriptor(modelId, group);
      const size = model.parameters?.find(parameter => parameter.key === "size");
      expect(size).toMatchObject({ control: "text", valueType: "string", allowCustomValue: true });
      expect(size?.options?.map(option => option.value)).toEqual(["auto", "1024x1024"]);
      expect(size).not.toHaveProperty("min");
      expect(size).not.toHaveProperty("max");
      const selected = Object.freeze({ size: "1536x1024", n: 1 });
      const html = render(model, selected);
      const width = html.match(/<input\b[^>]*aria-label="图片宽度"[^>]*>/u)?.[0];
      const height = html.match(/<input\b[^>]*aria-label="图片高度"[^>]*>/u)?.[0];
      expect(width).toContain('type="number"');
      expect(width).toContain('value="1536"');
      expect(height).toContain('value="1024"');
      expect(width).not.toMatch(/readOnly|disabled|max=/u);
      expect(height).not.toMatch(/readOnly|disabled|max=/u);
      expect(html.match(/aria-label="图片宽度"/gu)).toHaveLength(1);
      expect(html.match(/aria-label="图片高度"/gu)).toHaveLength(1);
      expect(html).toContain("自定义尺寸（W × H）");
      expect(html).toContain("1024 × 1024（官方示例）");
      expect(html).not.toMatch(/>2K<\/button>|>4K<\/button>|16 倍数/u);

      expect(validateModelParameters(model, selected, "image.generate")).toEqual({ valid: true, issues: [] });
      expect(jijiuGptImageRequestIssues({ provider: "openai", config: { baseUrl: `${source}/v1`, modelGroup: group, accountKeyGroup: group } }, {
        model: modelId, operation: "image.generate", connectionId: "jijiu-size-field", idempotencyKey: "offline-size-field",
        prompt: "Offline contract check", parameters: selected,
      })).toEqual([]);
      expect(parametersWithDefaults(model.parameters!, selected, true)).toEqual(selected);
      const refreshed = normalizedParametersForModel("image-generation", "openai", descriptor(modelId, group), selected);
      expect(refreshed).toEqual(selected);
      const restored = JSON.parse(JSON.stringify(refreshed)) as typeof selected;
      expect(normalizedParametersForModel("image-generation", "openai", model, restored)).toEqual(selected);
      expect(jijiuGptImageParameters(restored, modelId)).toEqual(selected);
      expect(setParameterValue(restored, "size", "1024x1536", model)).toEqual({ n: 1, size: "1024x1536" });
      expect(selected).toEqual({ size: "1536x1024", n: 1 });
    }
  });

  it("keeps the 2K/4K declared model separate from the ordinary WIDTHxHEIGHT contract", () => {
    const model = descriptor();
    const size = model.parameters?.find(parameter => parameter.key === "size");
    expect(size).toMatchObject({ control: "select", options: [
      { value: "auto", label: "自动 · 比例与像素由供应商决定" },
      ...["1K", "2K", "4K"].map(value => ({ value, label: value })),
    ] });
    expect(size?.allowCustomValue).not.toBe(true);
    const html = render(model, { size: "4K", quality: "high", n: 1 });
    expect(html).toContain('aria-pressed="true">4K</button>');
    expect(html.match(/readOnly="" placeholder="以原图为准"[^>]*value=""/gu)).toHaveLength(2);
    expect(validateModelParameters(model, { size: "1536x1024", quality: "high", n: 1 }, "image.generate").valid).toBe(false);
    expect(normalizedParametersForModel("image-generation", "openai", model, { size: "4K", quality: "high", n: 1 }))
      .toMatchObject({ size: "4K", quality: "high" });
  });

  it("keeps the two source notes in one closed, neutral disclosure after the controls", () => {
    const html = render(descriptor());
    expect(html.match(/<details class="parameter-contract-details"/gu)).toHaveLength(1);
    expect(html).not.toMatch(/<details[^>]*open=/u);
    expect(html).not.toContain("parameter-group-note");
    expect(html).toContain("参数说明与分组依据");
    expect(html).toContain("官网分组 1K / 2K / 4K");
    expect(html).toContain("原始分组说明保留");
    expect(html.indexOf('aria-pressed="true">4K')).toBeLessThan(html.indexOf('<details class="parameter-contract-details"'));
    expect(html.indexOf('value="high"')).toBeLessThan(html.indexOf('<details class="parameter-contract-details"'));
  });

  it("does not collapse unrelated source notes or hide an invalid saved selection", () => {
    const other = render(descriptor("gpt-image-2"), { size: "auto", n: 1 });
    expect(other).not.toContain("parameter-contract-details");
    expect(other.match(/class="parameter-group-note"/gu)).toHaveLength(2);
    const generic = render({ ...descriptor(), metadata: { ...descriptor().metadata, jijiuImageContract: false } });
    expect(generic).not.toContain("parameter-contract-details");
    const invalid = render(descriptor(), { size: "4096x4096", quality: "max", n: 1 });
    expect(invalid).toContain("当前档位：4096x4096 · 目录档位：自动 / 1K / 2K / 4K");
    expect(invalid).not.toMatch(/未确认|不支持|不可运行/u);
    expect(invalid).toContain("4096x4096");
    expect(invalid).toContain('value="max" selected=""');
  });

  it.each(["default", "图片-GPT-image-2-2K/4K"])("keeps the exact %s group's published request price for 2K/4K with high quality", group => {
    const model = applySupplierCatalogPrices([descriptor(id, group)], group, catalog, source)[0]!;
    expect(model.pricing).toMatchObject({ currency: "CNY", billingUnit: "request", sourceUrl: `${source}/api/pricing` });
    expect(model.metadata?.supplierPriceGroup).toBe(group);
    for (const size of ["2K", "4K"]) {
      const saved = normalizedParametersForModel("image-generation", "openai", model, { size, quality: "high", n: 1 });
      expect(saved).toMatchObject({ size, quality: "high" });
      expect(modelPriceSummary(model, saved)).toBe("0.1 CNY / 次");
      expect(modelEstimatedCost(model, saved)).toBe("0.1 CNY");
    }
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cangyuanCurrentModel, parseTk1688Marketplace, type ModelDescriptor } from "@super-canvas/providers";
import { applyUserImageSizePresets } from "@super-canvas/providers/image-size-presets";
import { NodeParameterFields, syncUserImageNativeTier } from "../components/node-parameter-fields";
import { modelEstimatedCost } from "./model-display";
import { normalizedParametersForModel } from "./model-parameters";

const descriptor = (id: string) => applyUserImageSizePresets(cangyuanCurrentModel({
  id, name: id, operations: ["image.generate", "image.edit"],
}));
const render = (model: ModelDescriptor, parameters: Record<string, unknown>) => renderToStaticMarkup(
  React.createElement(NodeParameterFields, { nodeId: "native-tier", nodeType: "image-generation", provider: "rest",
    model, parameters, onChange: vi.fn(), operation: "image.generate" }),
);

describe("user image size controls retain the supplier's native billing tier", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  for (const id of ["gpt-image-2-x", "gpt-image-2.5-x"]) {
    it(`${id} shows one tier control and restores a lowercase native 4k selection`, () => {
      const model = descriptor(id), before = structuredClone(model);
      const highest = id === "gpt-image-2.5-x" ? "max" : "high";
      const html = render(model, { tier: "4k", size: "2880x2880", quality: highest, series: "sunburst" });
      expect(html.match(/aria-label="自动与输出分辨率快捷档位"/gu)).toHaveLength(1);
      expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>4K<\/button>/u);
      expect(html).not.toContain("清晰度 / 计费档位");
      expect(html.match(/aria-label="图片宽度"/gu)).toHaveLength(1);
      expect(html.match(/aria-label="图片高度"/gu)).toHaveLength(1);
      expect(html).toContain(`value="${highest}" selected=""`);
      expect(model).toEqual(before);
    });

    it(`${id} displays its original web tier as automatic and hides the conditional quality field`, () => {
      const model = descriptor(id);
      expect(model.parameters?.find(parameter => parameter.key === "tier")?.options?.map(option => option.value))
        .toEqual(["web", "1k", "2k", "4k"]);
      const html = render(model, { tier: "web", size: "auto", series: "sunburst" });
      expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>自动<\/button>/u);
      expect(html).not.toMatch(/<label[^>]*>质量<\/label>/u);
      expect(html).not.toContain("清晰度 / 计费档位");
      expect(html).toContain('aria-label="图片宽度"');
    });

    it(`${id} displays an explicit 2k billing tier for custom pixels without inferring a new tier`, () => {
      const parameters = Object.freeze({ tier: "2k", size: "1111x777", quality: "low", series: "sunburst" });
      const html = render(descriptor(id), parameters);
      expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>2K<\/button>/u);
      expect(html).toMatch(/<input[^>]*aria-label="图片宽度"[^>]*value="1111"/u);
      expect(html).toMatch(/<input[^>]*aria-label="图片高度"[^>]*value="777"/u);
      expect(html).toContain('value="low" selected=""');
      expect(parameters).toEqual({ tier: "2k", size: "1111x777", quality: "low", series: "sunburst" });
    });
  }

  it("uses the native lowercase tier for the matching quote and retains it across normalization", () => {
    const model: ModelDescriptor = { ...descriptor("gpt-image-2-x"), pricing: { kind: "tiered", billingUnit: "image", currency: "CNY", confidence: "exact", checkedAt: "test",
      tiers: [
        { id: "web", label: "web", price: 0.015, conditions: [{ parameter: "tier", operator: "equals", value: "web" }] },
        { id: "1k", label: "1k", price: 0.055, conditions: [{ parameter: "tier", operator: "equals", value: "1k" }] },
        { id: "2k", label: "2k", price: 0.075, conditions: [{ parameter: "tier", operator: "equals", value: "2k" }] },
        { id: "4k", label: "4k", price: 0.095, conditions: [{ parameter: "tier", operator: "equals", value: "4k" }] },
      ] } };
    for (const [tier, pixels, cost] of [["1K", "1024x1024", "0.055 CNY"], ["2K", "2048x2048", "0.075 CNY"], ["4K", "2880x2880", "0.095 CNY"]] as const) {
      const saved = Object.freeze({ size: pixels, size_tier: tier, tier: "web", quality: "high", n: 1 });
      const changed = syncUserImageNativeTier(model, saved, tier);
      expect(changed).toEqual({ ...saved, tier: tier.toLowerCase() });
      expect(modelEstimatedCost(model, changed)).toBe(cost);
      expect(normalizedParametersForModel("image-generation", "rest", model, JSON.parse(JSON.stringify(changed))))
        .toMatchObject(changed);
      expect(saved.tier).toBe("web");
    }
    const automatic = syncUserImageNativeTier(model, { size: "auto", tier: "4k", n: 1 }, null);
    expect(automatic).toEqual({ size: "auto", tier: "web", n: 1 });
    expect(modelEstimatedCost(model, automatic)).toBe("0.015 CNY");
  });

  it("retains custom dimensions and automatic shape within the selected native billing tier", () => {
    const model = descriptor("gpt-image-2.5-x");
    for (const size of ["1111x777", "auto"]) {
      const selected = Object.freeze({ size, size_tier: "4K", tier: "2k", quality: "low", series: "flare" });
      expect(syncUserImageNativeTier(model, selected, "4K")).toEqual({ ...selected, tier: "4k" });
      expect(selected.tier).toBe("2k");
    }
  });

  it("does not erase a required native tier when the supplier has no automatic option", () => {
    const current = descriptor("gpt-image-2-x");
    const withoutAutomatic: ModelDescriptor = { ...current, parameters: current.parameters?.map(parameter => parameter.key === "tier"
      ? { ...parameter, required: true, options: parameter.options?.filter(option => option.value !== "web") } : parameter) };
    const selected = Object.freeze({ size: "auto", tier: "2k", quality: "high" });
    expect(syncUserImageNativeTier(withoutAutomatic, selected, null)).toEqual(selected);
  });

  it("keeps inferring an old pixel-only saved selection when no native billing tier exists", () => {
    const model = applyUserImageSizePresets({ id: "gpt-image-2.5-flare", name: "Open size", operations: ["image.generate"],
      metadata: { imageNativeParameterContract: true, imageOpenSizePreferences: true },
      parameters: [{ key: "size", label: "尺寸", control: "dimensions", default: "auto", step: 1 }] });
    const preset = render(model, { size: "3840x2160" });
    expect(preset).toMatch(/<button[^>]*aria-pressed="true"[^>]*>4K<\/button>/u);
    const custom = render(model, { size: "3501x2301" });
    expect(custom).not.toMatch(/<button[^>]*aria-pressed="true"[^>]*>自动<\/button>/u);
    expect(custom).toMatch(/<input[^>]*aria-label="图片宽度"[^>]*value="3501"/u);
  });

  it("switches Adobe's restored 4K to 1K without retaining a conflicting old resolution field", () => {
    const model = applyUserImageSizePresets(parseTk1688Marketplace({ success: true, data: { items: [{
      base_model: "gpt-image-2.5-sunburst", alias: "gpt-image-2.5-sunburst@s47c261", status: "active", charge_type: "per_request",
      description: "Adobe支持原生4K(3840*2160)，不支持N。",
    }] } }).models[1]!);
    const saved = { size: "1024x1024", size_tier: "1K", resolution: "4K", quality: "max" };
    expect(syncUserImageNativeTier(model, saved, "1K")).toEqual({ ...saved, resolution: "1K" });
    const html = render(model, { size: "2880x2880", size_tier: "4K", resolution: "4K", quality: "max" });
    expect(html.match(/aria-label="自动与输出分辨率快捷档位"/gu)).toHaveLength(1);
    expect(html.match(/aria-label="图片宽度"/gu)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>4K<\/button>/u);
    expect(model.metadata?.tk1688SupportedResolutions).toEqual(["4K"]);
  });
});

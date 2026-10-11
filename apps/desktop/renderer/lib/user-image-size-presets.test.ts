import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { applyUserImageSizePresets, resolveUserImageSizeParameters } from "@super-canvas/providers/image-size-presets";
import { NodeParameterFields, resolutionTierShortcuts, sizeOnTierChange } from "../components/node-parameter-fields";
import { normalizedParametersForModel } from "./model-parameters";
import { withCurrentImageRequestParameters } from "./image-request-parameters";
import type { ProviderConnectionView } from "./client-api";

const connection: ProviderConnectionView = { id: "weai-open", name: "WeAI", provider: "weai", apiKey: "", apiKeySet: true, config: {
  baseUrl: "https://asian-acc.we-token.cc/v1", modelGroup: "生图-openai-adobe-image2.5专属", usage: "canvas",
} };
const raw: ModelDescriptor = { id: "gpt-image-2.5-flare", name: "Flare", operations: ["image.generate", "image.edit"],
  parameters: [{ key: "size", label: "输出尺寸", control: "dimensions", default: "auto", step: 1 }],
  metadata: { imageNativeParameterContract: true, imageOpenSizePreferences: true, priceLabel: "0.1 USD / 次", imageSupportedResolutions: [] } };

describe("user requested image presets survive source contract refresh", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());
  it("restores all three tiers, exact screenshot presets, price and saved values after repeated enrichment", () => {
    const current = withCurrentImageRequestParameters(connection, [raw])[0]!;
    const repeated = withCurrentImageRequestParameters(connection, JSON.parse(JSON.stringify([current])))[0]!;
    expect(repeated).toEqual(current);
    const size = repeated.parameters!.find(parameter => parameter.key === "size")!;
    expect(resolutionTierShortcuts(size).map(tier => tier.label)).toEqual(["1K", "2K", "4K"]);
    expect(size.options?.map(option => option.value)).toEqual(expect.arrayContaining(["2880x2880", "3520x2336", "2336x3520", "3312x2480", "3840x1648"]));
    expect(sizeOnTierChange(size, "2048x2048", "4K")).toBe("2880x2880");
    expect(repeated.metadata?.priceLabel).toBe(raw.metadata?.priceLabel);
    expect(repeated.metadata?.imageSupportedResolutions).toEqual([]);
    const saved = { size: "3520x2336", size_tier: "4K", quality: "max" };
    expect(normalizedParametersForModel("image-generation", "weai", repeated, saved)).toMatchObject(saved);
    expect(resolveUserImageSizeParameters(repeated, saved)).toMatchObject({ size: "3520x2336", quality: "max" });
  });
  it("shows a single unified tier and dimensions control even when old independent controls exist", () => {
    const model = applyUserImageSizePresets({ ...raw, parameters: [...raw.parameters!,
      { key: "size_tier", label: "档位偏好", control: "select", options: [{ value: "4K", label: "4K" }] },
      { key: "aspect_ratio", label: "比例偏好", control: "text", default: "auto" }],
      metadata: { ...raw.metadata, imageResolutionTierParameter: "size_tier", imageNativeResolutionParameter: "size_tier" } });
    const html = renderToStaticMarkup(React.createElement(NodeParameterFields, { nodeId: "restored", nodeType: "image-generation", provider: "weai", model,
      parameters: { size: "2880x2880", size_tier: "4K", aspect_ratio: "1:1" }, onChange: vi.fn() }));
    expect(html.match(/aria-label="自动与输出分辨率快捷档位"/gu)).toHaveLength(1);
    expect(html).toContain("4K · 3:2 · 3520 × 2336");
    expect(html).toContain('aria-label="图片宽度"');
    expect(html).not.toContain("请填写独立 W/H");
  });
});

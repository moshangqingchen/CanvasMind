import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { resolveImageModelContract } from "@super-canvas/providers/image-model-contract";
import { DeferredPanelContent } from "../components/deferred-panel-content";
import { NodeParameterFields } from "../components/node-parameter-fields";
import { ModelPriceDetails } from "../components/model-price-details";

// Reuse the offline identity and values from image-parameter-contract-integration.
const connection = { provider: "openai", config: {
  baseUrl: "https://api.mikoto.vip/v1", supplierKey: "mikoto",
  accountKeyGroupId: "39", accountKeyGroup: "生图（2k4k 高质量）", usage: "canvas",
} };
const rawModel: ModelDescriptor = {
  id: "gpt-image-2.5-flare", name: "gpt-image-2.5-flare", operations: ["image.generate", "image.edit"],
  parameters: [{ key: "quality", label: "质量（quality）", control: "text", valueType: "string" }],
  metadata: { mikotoImageContract: true, imageQualityEnumPublished: false, supplierPriceGroupId: "39" },
  pricing: { kind: "per-image", currency: "USD", unitAmount: 0.12, confidence: "exact",
    checkedAt: "offline-fixture", sourceUrl: "https://quotes.invalid/deferred-panel-fixture" },
};
const parameters = { size: "3840x2160", size_tier: "4K", aspect_ratio: "16:9", quality: "max" };

function imageParameterBody() {
  const model = resolveImageModelContract(connection, rawModel);
  return React.createElement(React.Fragment, null,
    React.createElement(NodeParameterFields, { nodeId: "immediate-image", nodeType: "image-generation", provider: "openai",
      model, parameters, operation: "image.generate", onChange: vi.fn() }),
    React.createElement(ModelPriceDetails, { model, parameters }),
  );
}

describe("parameter panel first-render content", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("renders all image controls and the matching quote immediately when requested", () => {
    const onReady = vi.fn();
    const html = renderToStaticMarkup(React.createElement(DeferredPanelContent, {
      immediate: true, onReady,
    }, imageParameterBody()));
    expect(html).not.toContain('data-panel-loading="true"');
    expect(html).toContain('aria-label="自动与输出分辨率快捷档位"');
    // This exact fixture group explicitly declares 2K / 4K; do not invent 1K.
    for (const tier of ["自动", "2K", "4K"]) expect(html).toContain(`>${tier}</button>`);
    expect(html).toContain("4K · 16:9 · 3840 × 2160");
    expect(html).toMatch(/<input[^>]*aria-label="图片宽度"[^>]*value="3840"/u);
    expect(html).toMatch(/<input[^>]*aria-label="图片高度"[^>]*value="2160"/u);
    expect(html).toContain('value="max" selected=""');
    expect(html).toContain('aria-label="生成模式"');
    expect(html).toContain("本次预计费用");
    expect(html).toContain("0.12 USD");
    // Server rendering must not invoke a client lifecycle callback.
    expect(onReady).not.toHaveBeenCalled();
  });

  it("keeps the default heavy-panel first render as a skeleton", () => {
    const onReady = vi.fn();
    const html = renderToStaticMarkup(React.createElement(DeferredPanelContent, {
      onReady,
    }, imageParameterBody()));
    expect(html).toContain('data-panel-loading="true"');
    expect(html).not.toContain('aria-label="图片宽度"');
    expect(html).not.toContain("本次预计费用");
    expect(onReady).not.toHaveBeenCalled();
  });

  it("preserves the custom fallback when explicitly deferred", () => {
    const html = renderToStaticMarkup(React.createElement(DeferredPanelContent, {
      immediate: false, fallback: React.createElement("span", { role: "status" }, "正在打开账单"),
    }, imageParameterBody()));
    expect(html).toContain("正在打开账单");
    expect(html).not.toContain('aria-label="图片宽度"');
  });
});

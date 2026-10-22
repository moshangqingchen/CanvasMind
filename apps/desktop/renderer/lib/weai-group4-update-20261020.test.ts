import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NodeParameterFields } from "../components/node-parameter-fields";
import { normalizedParametersForModel } from "./model-parameters";
import { createNodeParameterQuote } from "./node-parameter-quote";
import { WEAI_CODEX_PER_REQUEST_GROUP as group, WEAI_CODEX_TOKEN_GROUP, applyWeAiLivePricing, weAiCanvasModelDescriptors, weAiCanvasModelDescriptorsFromSavedScan } from "./weai-catalog";

vi.mock("../components/ui/Dropdown", async () => ({
  Dropdown: (await import("./test-helpers/parameter-dropdown.test-helper")).StaticParameterDropdown,
}));

const ids = ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
const render = (id: string, parameters: Record<string, unknown>) => renderToStaticMarkup(React.createElement(NodeParameterFields, {
  nodeId: "weai-group4-offline", nodeType: "image-generation", provider: "weai", model: weAiCanvasModelDescriptors(group).find(model => model.id === id)!, parameters, onChange: () => {},
}));

describe("October 20 We-AI group 4 source panel and quote", () => {
  const network = vi.fn(() => { throw Error("No network is allowed"); });
  beforeAll(() => { vi.stubGlobal("React", React); vi.stubGlobal("fetch", network); });
  afterAll(() => { try { expect(network).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); } });

  it("exposes only the 3 complete group 4 IDs and keeps menu labels concise", () => {
    const models = weAiCanvasModelDescriptors(group);
    expect(models.map(model => model.id)).toEqual(ids);
    for (const model of models) {
      expect(model.name).toBe(`${model.id}（$0.056/次）`);
      expect(model.pricing).toMatchObject({ kind: "per-request", billingUnit: "request", unitAmount: .056,
        sourceUrl: "https://asian-acc.we-token.cc/api/v1/model-plaza-legacy/models?group_id=4" });
    }
  });
  it.each(ids)("shows tier, ratio, exact W/H and highest quality fields for %s", id => {
    const parameters = { size_tier: "4K", aspect_ratio: "16:9", size: "3840x2160", quality: id.includes("2.5") ? "max" : "high", n: 1 };
    const html = render(id, parameters);
    for (const text of ["1K", "2K", "4K", "3840", "2160", parameters.quality]) expect(html).toContain(text);
    expect(html).toContain("16:9");
    const model = weAiCanvasModelDescriptors(group).find(model => model.id === id)!;
    expect(model.metadata).toMatchObject({ imageContractGroupId: "4", imageUserSizePresetSource: "user-request", imageGenerationVerified: false });
    const saved = JSON.parse(JSON.stringify(parameters));
    expect(normalizedParametersForModel("image-generation", "weai", model, saved)).toEqual(parameters);
    expect(saved).toEqual(parameters);
  });
  it.each(ids)("quotes every resolution and quality of %s using the same-group per-request source", id => {
    const model = weAiCanvasModelDescriptors(group).find(model => model.id === id)!;
    for (const size_tier of ["1K", "2K", "4K"]) for (const quality of id.includes("2.5") ? ["auto", "max"] : ["auto", "low", "medium", "high"]) {
      const quote = createNodeParameterQuote(model, { size_tier, aspect_ratio: "16:9", quality, n: 1 });
      expect(quote.displayCost).toContain("0.056");
      expect(quote.priceSourceUrl).toBe("https://asian-acc.we-token.cc/api/v1/model-plaza-legacy/models?group_id=4");
      expect(quote.displayCost).toBe("0.056 USD");
    }
  });
  it("restores the persisted exact Key scan and removes IDs missing from that Key", () => {
    const config = { modelGroup: group, accountKeyGroupId: "4", modelScanStatus: "live", modelScanCheckedAt: "2026-10-21T04:00:00Z", scannedModelIds: [ids[0], ids[2]], defaultModel: ids[2] };
    const saved = JSON.parse(JSON.stringify(config));
    const models = weAiCanvasModelDescriptorsFromSavedScan(saved)!;
    expect(models.map(model => model.id)).toEqual([ids[0], ids[2]]);
    expect(models.find(model => model.isDefault)?.id).toBe(ids[2]);
    expect(saved).toEqual(config);
    expect(weAiCanvasModelDescriptorsFromSavedScan({ ...config, modelScanStatus: "empty", scannedModelIds: [] })).toEqual([]);
  });
  it("does not reuse group 6 Token rates for the same IDs or apply group 4 rates to group 6", () => {
    const group4 = weAiCanvasModelDescriptors(group), group6 = weAiCanvasModelDescriptors(WEAI_CODEX_TOKEN_GROUP);
    const tokenPricing = { groupId: WEAI_CODEX_TOKEN_GROUP, source: "model-plaza" as const, sourceUrl: "https://example.test/group6", checkedAt: "2026-10-21T04:00:00Z", complete: true, multiplier: .7,
      models: Object.fromEntries(ids.map(id => [id, { kind: "token" as const, multiplier: .7, input: 99 }])) };
    expect(applyWeAiLivePricing(group4, tokenPricing)).toEqual(group4);
    const requestPricing = { ...tokenPricing, groupId: group, models: Object.fromEntries(ids.map(id => [id, { kind: "per-request" as const, multiplier: .7, tiers: [{ id: "1k", label: "1K", price: .056 }] }])) };
    expect(applyWeAiLivePricing(group6, requestPricing)).toEqual(group6);
    expect(applyWeAiLivePricing(group4, { ...tokenPricing, groupId: group })).toEqual(group4);
  });
  it("retains saved unconfirmed output fields for review instead of claiming same-group transparency", () => {
    const model = weAiCanvasModelDescriptors(group)[0]!;
    const parameters = { size: "3840x2160", quality: "high", background: "transparent", output_format: "png" };
    expect(normalizedParametersForModel("image-generation", "weai", model, structuredClone(parameters))).toEqual(parameters);
    expect(render(model.id, parameters)).toContain("transparent");
    expect(model.parameters?.some(p => ["background", "output_format"].includes(p.key))).toBe(false);
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { ModelPriceDetails } from "../components/model-price-details";
import * as modelDisplay from "./model-display";
import { createNodeParameterQuote } from "./node-parameter-quote";

const checkedAt = "2026-10-18T08:00:00.000Z";
const video: ModelDescriptor = {
  id: "priced-video", name: "Priced video", operations: ["video.generate"],
  parameters: [
    { key: "duration", label: "时长", control: "number", valueType: "integer", min: 1, max: 15, default: 5 },
    { key: "resolution", label: "分辨率", control: "select", default: "720p", options: [
      { label: "720p", value: "720p" }, { label: "1080p", value: "1080p" },
    ] },
  ],
  pricing: {
    kind: "tiered", billingUnit: "second", currency: "CNY", confidence: "exact", checkedAt,
    sourceUrl: "https://supplier.example/pricing",
    tiers: [
      { id: "720", label: "720p", dimension: "resolution", value: "720p", price: 0.1 },
      { id: "1080", label: "1080p", dimension: "resolution", value: "1080p", price: 0.2 },
    ],
  },
};

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

describe("node parameter quote projection", () => {
  it("keeps quantity, original currency, confidence and time conditions together without changing inputs", () => {
    const parameters = Object.freeze({ n: 2 });
    const model: ModelDescriptor = Object.freeze({
      id: "request-model", name: "Request model", operations: ["music.generate"] as const,
      pricing: Object.freeze({
        kind: "per-request", currency: "USD", unitAmount: 1.5, confidence: "snapshot", checkedAt,
        sourceUrl: "https://supplier.example/request-pricing",
        timeMultipliers: [{ timeZone: "Asia/Shanghai" as const, startHour: 0, endHour: 24, multiplier: 2 }],
      }),
    });
    const before = JSON.stringify(model);
    const quote = createNodeParameterQuote(model, parameters);

    expect(quote.displayCost).toBe("6 USD（参考）（上海当前时段价，以提交时刻为准）");
    expect(quote.parameters).toBe(parameters);
    expect(quote.priceCheckedAt).toBe(checkedAt);
    expect(quote.priceSourceUrl).toBe("https://supplier.example/request-pricing");
    expect(quote.unavailableNote).toBeUndefined();
    expect(JSON.stringify(model)).toBe(before);
    expect(parameters).toEqual({ n: 2 });
  });

  it("uses selected duration and tariff branch rather than a catalog starting price", () => {
    const quote = createNodeParameterQuote(video, { duration: 10, resolution: "1080p", n: 2 });
    expect(quote.displayCost).toBe("4 CNY");
    expect(quote.estimate?.tierIndex).toBe(1);
    expect(quote.estimate?.parameters).toMatchObject({ duration: 10, resolution: "1080p", n: 2 });

    const creditQuote = createNodeParameterQuote({
      id: "credit-model", name: "Credit model", operations: ["music.generate"],
      pricing: { kind: "per-request", currency: "credits", unitAmount: 3, confidence: "exact", checkedAt },
    }, {});
    expect(creditQuote.displayCost).toBe("3 额度");
  });

  it("does not promote token rates, measured charges or retained prices into current request estimates", () => {
    const models: ModelDescriptor[] = [
      { ...video, pricing: { kind: "token", currency: "USD", inputPerMillion: 1, outputPerMillion: 2, confidence: "exact", checkedAt } },
      { ...video, metadata: { priceSource: "generated-result", priceLabel: "0.8 CNY / 次（实测）",
        measuredPrice: { parameters: { duration: 5, resolution: "720p" }, amount: 0.8 } } },
      { ...video, metadata: { priceStatus: "partial", priceLabel: "0.5 CNY / 次（上次价格）" } },
    ];
    for (const model of models) {
      const quote = createNodeParameterQuote(model, { duration: 5, resolution: "720p" });
      expect(quote.estimate).toBeUndefined();
      expect(quote.displayCost).toBe("—");
      expect(quote.unavailableNote).toBe("当前参数组合暂无法估算，费率与来源详见价格明细。");
    }
  });

  it("leaves a missing model or invalid combination unpriced without inventing a precise failure reason", () => {
    for (const quote of [createNodeParameterQuote(undefined, {}), createNodeParameterQuote(video, { duration: 30 })]) {
      expect(quote.displayCost).toBe("—");
      expect(quote.unavailableNote).not.toMatch(/供应商未公布|不支持|参数无效/u);
    }
  });

  it("renders the shared amount and selected table branch without estimating again", () => {
    const quote = createNodeParameterQuote(video, { duration: 10, resolution: "1080p" });
    const estimate = vi.spyOn(modelDisplay, "modelEstimatedQuote");
    const html = renderToStaticMarkup(React.createElement(ModelPriceDetails, { quote }));

    expect(estimate).not.toHaveBeenCalled();
    expect(html).toContain("本次预计费用 <strong>2 CNY</strong>");
    expect(html).toContain("当前参数</span>");
    expect(html).toContain("https://supplier.example/pricing");
    expect(html).toContain(checkedAt);
  });

  it("preserves the details' legacy props and explicitly renders an unpriced shared projection", () => {
    const estimated = renderToStaticMarkup(React.createElement(ModelPriceDetails, {
      model: video, parameters: { duration: 5, resolution: "720p" },
    }));
    expect(estimated).toContain("本次预计费用 <strong>0.5 CNY</strong>");

    const quote = createNodeParameterQuote(video, { duration: 30 });
    const estimate = vi.spyOn(modelDisplay, "modelEstimatedQuote");
    const unavailable = renderToStaticMarkup(React.createElement(ModelPriceDetails, { quote }));
    expect(estimate).not.toHaveBeenCalled();
    expect(unavailable).toContain("本次预计费用 <strong>—</strong>");
    expect(unavailable).toContain(quote.unavailableNote);
    expect(unavailable).not.toContain("当前参数</span>");
  });
});

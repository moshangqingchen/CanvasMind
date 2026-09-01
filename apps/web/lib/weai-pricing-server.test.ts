import { describe, expect, it } from "vitest";
import {
  applyWeAiLivePricing,
  WEAI_ADOBE_PER_REQUEST_GROUP,
  WEAI_ADOBE_TOKEN_GROUP,
  WEAI_AZURE_OPENAI_GROUP,
  weAiCanvasModelDescriptors,
} from "./weai-catalog";
import {
  parseWeAiModelPlazaPricing,
  parseWeAiOfficialDocsPricing,
} from "./weai-pricing-server";

describe("We-AI live website pricing", () => {
  it("parses the current official Adobe and Azure guide prices", () => {
    const groups = parseWeAiOfficialDocsPricing(
      `
        <h2>2. ADOBE 渠道</h2>
        <table>
          <tr><td>gpt-image-2-low</td><td>4 分 / 次</td></tr>
          <tr><td>gpt-image-2-medium</td><td>7 分 / 次</td></tr>
          <tr><td>gpt-image-2-high</td><td>1 毛 5 / 次</td></tr>
        </table>
        <p>Token 计费：1 倍率，模型使用 gpt-image-2 即可。</p>
        <h2>3. AZ 渠道</h2>
        <p>倍率 3x</p>
      `,
      "2026-08-24T10:00:00.000Z",
    );

    expect(groups.get(WEAI_ADOBE_TOKEN_GROUP)?.multiplier).toBe(1);
    expect(
      groups.get(WEAI_ADOBE_PER_REQUEST_GROUP)?.models[
        "gpt-image-2-high"
      ],
    ).toMatchObject({
      kind: "per-request",
      tiers: [{ price: 0.15 }],
    });
    expect(groups.get(WEAI_AZURE_OPENAI_GROUP)).toMatchObject({
      multiplier: 3,
      models: {
        "gpt-image-2": {
          kind: "token",
          input: 15,
          output: 30,
          cacheRead: 3.75,
          imageOutput: 90,
        },
      },
    });
  });

  it("uses the model-plaza paid prices and user multiplier when available", () => {
    const groups = parseWeAiModelPlazaPricing(
      {
        data: {
          groups: [
            {
              id: "az",
              name: "AZURE-openai-官key",
              rate_multiplier: 3,
              user_rate_multiplier: 2.5,
              models: [
                {
                  name: "gpt-image-2",
                  pricing: {
                    billing_mode: "token",
                    input_price: 0.000005,
                    output_price: 0.00001,
                    cache_read_price: 0.00000125,
                  },
                },
              ],
            },
            {
              id: "adobe",
              name: WEAI_ADOBE_PER_REQUEST_GROUP,
              rate_multiplier: 1,
              models: [
                {
                  name: "gpt-image-2",
                  pricing: {
                    billing_mode: "per_request",
                    intervals: [
                      { tier_label: "LOW", per_request_price: 0.04 },
                      { tier_label: "MEDIUM", per_request_price: 0.07 },
                      { tier_label: "HIGH", per_request_price: 0.15 },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
      "2026-08-24T10:00:00.000Z",
    );

    expect(groups.get(WEAI_AZURE_OPENAI_GROUP)).toMatchObject({
      source: "model-plaza",
      complete: true,
      multiplier: 2.5,
      models: { "gpt-image-2": { input: 12.5, output: 25 } },
    });
    expect(
      groups.get(WEAI_ADOBE_PER_REQUEST_GROUP)?.models[
        "gpt-image-2-high"
      ],
    ).toMatchObject({ tiers: [{ price: 0.15 }] });
  });

  it("replaces only the display price and preserves the real model ID", () => {
    const pricing = parseWeAiOfficialDocsPricing(
      `
        2. ADOBE 渠道
        gpt-image-2-low 4 分 / 次
        gpt-image-2-medium 7 分 / 次
        gpt-image-2-high 1 毛 5 / 次
        Token 计费：1 倍率
        3. AZ 渠道 倍率 3x
      `,
      "2026-08-24T10:00:00.000Z",
    ).get(WEAI_ADOBE_PER_REQUEST_GROUP);
    const items = applyWeAiLivePricing(
      weAiCanvasModelDescriptors(WEAI_ADOBE_PER_REQUEST_GROUP),
      pricing,
    );

    expect(items.map((item) => item.id)).toEqual([
      "gpt-image-2-low",
      "gpt-image-2-medium",
      "gpt-image-2-high",
    ]);
    expect(items[0]?.name).toContain("$0.04/次");
    expect(items[2]?.name).toContain("$0.15/次");
    expect(items[2]?.metadata).toMatchObject({
      pricingSource: "official-docs",
      pricingComplete: false,
    });
  });
});

import { describe, expect, it } from "vitest";

import type {
  DirectorCallDraft,
  DirectorCatalogCandidate,
  ExchangeRateTable,
} from "../src/types.js";
import {
  fingerprintCatalog,
  parametersForRequirements,
  quoteCandidate,
  routeDirectorCall,
} from "../src/routing.js";

const NOW = new Date("2026-08-30T00:00:00.000Z");

function candidate(
  id: string,
  amount: number | undefined,
  overrides: Partial<DirectorCatalogCandidate> = {},
): DirectorCatalogCandidate {
  return {
    connectionId: `connection-${id}`,
    connectionName: id,
    provider: "test",
    supplier: "Test Supplier",
    authoritative: true,
    catalogCheckedAt: "2026-08-29T12:00:00.000Z",
    model: {
      id,
      name: id,
      operations: ["image.generate", "image.edit"],
      inputKinds: ["text", "image", "image[]"],
      outputKinds: ["image"],
      parameters: [
        {
          key: "ratio",
          label: "Ratio",
          control: "select",
          options: [
            { label: "Square", value: "1:1" },
            { label: "Widescreen", value: "16:9" },
          ],
        },
        {
          key: "resolution",
          label: "Resolution",
          control: "select",
          options: [
            { label: "1024x1024", value: "1024x1024" },
            { label: "1920x1080", value: "1920x1080" },
          ],
        },
        { key: "count", label: "Count", control: "number", min: 1, max: 4 },
      ],
      limits: { maxOutputImages: 4, maxInputImages: 3 },
      ...(amount === undefined
        ? {}
        : {
            pricing: {
              kind: "per-image" as const,
              currency: "CNY",
              unitAmount: amount,
              checkedAt: "2026-08-29T00:00:00.000Z",
              validUntil: "2026-09-05T00:00:00.000Z",
              confidence: "exact" as const,
            },
          }),
    },
    ...overrides,
  };
}

const imageCall: DirectorCallDraft = {
  id: "hero",
  label: "Hero image",
  prompt: "A cinematic hero frame",
  requirements: {
    operation: "image.generate",
    count: 2,
    aspectRatio: "16:9",
    resolution: "1920x1080",
  },
};

describe("director routing", () => {
  it("filters hard requirements before selecting the lowest comparable price", () => {
    const cheapButIneligible = candidate("cheap", 0.1, {
      model: {
        ...candidate("base", 1).model,
        id: "cheap",
        name: "cheap",
        operations: ["video.generate"],
      },
    });
    const routed = routeDirectorCall(
      imageCall,
      [candidate("expensive", 4), cheapButIneligible, candidate("winner", 2)],
      undefined,
      { now: NOW },
    );

    expect(routed.selected?.candidate.model.id).toBe("winner");
    expect(routed.selected?.originalMaximum).toBe(4);
    expect(
      routed.alternatives.find((quote) => quote.candidate.model.id === "cheap"),
    ).toMatchObject({ eligible: false, comparable: false });
  });

  it("excludes unknown, stale, and nonconvertible prices from automatic ranking", () => {
    const stale = candidate("stale", 0.01, {
      model: {
        ...candidate("base", 1).model,
        id: "stale",
        name: "stale",
        pricing: {
          kind: "per-image",
          currency: "CNY",
          unitAmount: 0.01,
          checkedAt: "2026-01-01T00:00:00.000Z",
          validUntil: "2026-01-02T00:00:00.000Z",
          confidence: "snapshot",
        },
      },
    });
    const usd = candidate("usd", 1, {
      model: {
        ...candidate("base", 1).model,
        id: "usd",
        name: "usd",
        pricing: {
          kind: "per-image",
          currency: "USD",
          unitAmount: 1,
          checkedAt: "2026-08-29T00:00:00.000Z",
          confidence: "exact",
        },
      },
    });

    expect(
      quoteCandidate(
        candidate("unknown", undefined),
        imageCall.requirements,
        undefined,
        { now: NOW },
      ).pricingStatus,
    ).toBe("unknown");
    expect(
      quoteCandidate(stale, imageCall.requirements, undefined, { now: NOW })
        .pricingStatus,
    ).toBe("stale");
    expect(
      quoteCandidate(usd, imageCall.requirements, undefined, { now: NOW })
        .pricingStatus,
    ).toBe("nonconvertible");
    expect(
      routeDirectorCall(imageCall, [stale, usd], undefined, { now: NOW })
        .selected,
    ).toBeUndefined();
  });

  it("normalizes per-second and token prices through a fresh CNY rate table", () => {
    const rates: ExchangeRateTable = {
      base: "CNY",
      checkedAt: "2026-08-29T00:00:00.000Z",
      validUntil: "2026-08-31T00:00:00.000Z",
      rates: { USD: 7 },
      source: "ecb",
    };
    const video = candidate("video", undefined, {
      model: {
        id: "video",
        name: "video",
        operations: ["video.generate"],
        inputKinds: ["text"],
        outputKinds: ["video"],
        parameters: [
          {
            key: "seconds",
            label: "Duration",
            control: "number",
            min: 1,
            max: 30,
          },
        ],
        pricing: {
          kind: "per-second",
          currency: "USD",
          unitAmount: 0.5,
          checkedAt: "2026-08-29T00:00:00.000Z",
          confidence: "exact",
        },
      },
    });
    const videoQuote = quoteCandidate(
      video,
      { operation: "video.generate", count: 2, durationSeconds: 10 },
      rates,
      { now: NOW },
    );
    expect(videoQuote).toMatchObject({
      originalMaximum: 10,
      cnyMaximum: 70,
      pricingStatus: "known",
      breakdown: { units: 20 },
    });

    const token = candidate("token", undefined, {
      model: {
        id: "token",
        name: "token",
        operations: ["image.generate"],
        pricing: {
          kind: "token",
          currency: "USD",
          inputPerMillion: 5,
          outputPerMillion: 10,
          checkedAt: "2026-08-29T00:00:00.000Z",
          confidence: "estimate",
        },
      },
    });
    expect(
      quoteCandidate(
        token,
        {
          operation: "image.generate",
          count: 1,
          maximumInputTokens: 1_000_000,
          maximumOutputTokens: 500_000,
        },
        rates,
        { now: NOW },
      ).cnyMaximum,
    ).toBe(70);

    expect(
      quoteCandidate(
        video,
        { operation: "video.generate", count: 1, durationSeconds: 10 },
        {
          ...rates,
          checkedAt: "2026-08-01T00:00:00.000Z",
          validUntil: "2026-09-01T00:00:00.000Z",
        },
        { now: NOW },
      ).pricingStatus,
    ).toBe("nonconvertible");
  });

  it("quotes fixed-request and exact tier prices without parsing display labels", () => {
    const fixed = candidate("fixed", undefined, {
      model: {
        ...candidate("base", 1).model,
        id: "fixed",
        name: "fixed",
        pricing: {
          kind: "per-request",
          currency: "CNY",
          unitAmount: 6,
          checkedAt: "2026-08-29T00:00:00.000Z",
          confidence: "exact",
        },
      },
    });
    expect(
      quoteCandidate(
        fixed,
        { operation: "image.generate", count: 4 },
        undefined,
        { now: NOW },
      ).originalMaximum,
    ).toBe(6);

    const tiered = candidate("tiered", undefined, {
      model: {
        ...candidate("base", 1).model,
        id: "tiered",
        name: "tiered",
        parameters: [
          {
            key: "quality",
            label: "Quality",
            control: "select",
            options: [
              { label: "Standard", value: "standard" },
              { label: "High", value: "high" },
            ],
          },
        ],
        pricing: {
          kind: "tiered",
          currency: "CNY",
          checkedAt: "2026-08-29T00:00:00.000Z",
          confidence: "exact",
          tiers: [
            {
              id: "standard",
              label: "Standard",
              price: 2,
              dimension: "quality",
              value: "standard",
            },
            {
              id: "high",
              label: "High",
              price: 5,
              dimension: "quality",
              value: "high",
            },
          ],
        },
      },
    });
    expect(
      quoteCandidate(
        tiered,
        { operation: "image.generate", count: 1, quality: "high" },
        undefined,
        { now: NOW },
      ),
    ).toMatchObject({
      originalMaximum: 5,
      breakdown: { kind: "tiered", tierId: "high" },
    });
  });

  it("uses quote freshness and stable ids to break equal-price ties", () => {
    const older = candidate("older", 1);
    const newer = candidate("newer", 1, {
      model: {
        ...candidate("base", 1).model,
        id: "newer",
        name: "newer",
        pricing: {
          ...candidate("base", 1).model.pricing!,
          checkedAt: "2026-08-29T12:00:00.000Z",
        },
      },
    });
    expect(
      routeDirectorCall(
        { ...imageCall, requirements: { ...imageCall.requirements, count: 1 } },
        [older, newer],
        undefined,
        { now: NOW },
      ).selected?.candidate.model.id,
    ).toBe("newer");
  });

  it("uses the model's real parameter keys and does not confuse resolution with ratio", () => {
    const model = candidate("model", 1).model;
    expect(parametersForRequirements(imageCall.requirements, model)).toEqual({
      ratio: "16:9",
      resolution: "1920x1080",
      count: 2,
    });
    const unsupported = {
      ...imageCall,
      requirements: { ...imageCall.requirements, resolution: "2048x2048" },
    };
    expect(
      routeDirectorCall(unsupported, [candidate("model", 1)], undefined, {
        now: NOW,
      }).selected,
    ).toBeUndefined();
  });

  it("fingerprints price and capability changes deterministically", () => {
    const first = candidate("a", 1);
    const second = candidate("a", 2);
    expect(fingerprintCatalog([first])).toBe(fingerprintCatalog([first]));
    expect(fingerprintCatalog([first])).not.toBe(fingerprintCatalog([second]));
  });
});

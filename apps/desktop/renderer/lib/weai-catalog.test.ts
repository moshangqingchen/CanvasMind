import { describe, expect, it } from "vitest";
import {
  WEAI_ADOBE_PER_REQUEST_GROUP,
  WEAI_ADOBE_PER_REQUEST_URL_GROUP,
  WEAI_ADOBE_TOKEN_GROUP,
  WEAI_AZURE_OPENAI_GROUP,
  WEAI_CATALOG,
  WEAI_CODEX_TOKEN_GROUP,
  WEAI_GEMINI_GROUP,
  WEAI_GROUP_IDS,
  applyWeAiLivePricing,
  isWeAiGroupId,
  readWeAiSavedModelScan,
  resolveWeAiDefaultModel,
  resolveWeAiProtocol,
  weAiCallableModels,
  weAiCanvasModelDescriptors,
  weAiCanvasModelDescriptorsFromSavedScan,
  weAiCatalogGroup,
  weAiCatalogModel,
  weAiSizePresetForTier,
  type WeAiPerImagePricing,
  type WeAiPerRequestPricing,
  type WeAiTokenPricing,
} from "./weai-catalog";

function tokenPrice(groupId: string, modelId: string): WeAiTokenPricing {
  const pricing = weAiCatalogModel(groupId, modelId)?.pricing;
  expect(pricing?.kind).toBe("token");
  return pricing as WeAiTokenPricing;
}

function imagePrice(groupId: string, modelId: string): WeAiPerImagePricing {
  const pricing = weAiCatalogModel(groupId, modelId)?.pricing;
  expect(pricing?.kind).toBe("per-image");
  return pricing as WeAiPerImagePricing;
}

function requestPrice(groupId: string, modelId: string): WeAiPerRequestPricing {
  const pricing = weAiCatalogModel(groupId, modelId)?.pricing;
  expect(pricing?.kind).toBe("per-request");
  return pricing as WeAiPerRequestPricing;
}

describe("We-AI static catalog", () => {
  it("propagates live model-plaza prices to both name and metadata", () => {
    const base = weAiCanvasModelDescriptors(
      WEAI_ADOBE_PER_REQUEST_GROUP,
    ).find((model) => model.id === "gpt-image-2-low");
    expect(base).toBeDefined();
    const [priced] = applyWeAiLivePricing([base!], {
      groupId: WEAI_ADOBE_PER_REQUEST_GROUP,
      source: "model-plaza",
      sourceUrl: "https://example.test/api/v1/model-plaza",
      checkedAt: "2026-08-29T00:00:00.000Z",
      complete: true,
      multiplier: 1,
      models: {
        "gpt-image-2-low": {
          kind: "per-request",
          multiplier: 1,
          tiers: [{ id: "request", label: "单次", price: 0.031 }],
        },
      },
    });
    expect(priced?.name).toContain("$0.031/次");
    expect(priced?.metadata?.priceLabel).toBe("$0.031/次");
  });

  it("contains all six authenticated marketplace groups in display order", () => {
    expect(WEAI_CATALOG.map((group) => group.id)).toEqual(WEAI_GROUP_IDS);
    expect(
      WEAI_CATALOG.map((group) => [
        group.id,
        group.multiplier,
        group.billingMode,
      ]),
    ).toEqual([
      [WEAI_CODEX_TOKEN_GROUP, 0.7, "token"],
      [WEAI_GEMINI_GROUP, 1, "per-image"],
      [WEAI_AZURE_OPENAI_GROUP, 3, "token"],
      [WEAI_ADOBE_PER_REQUEST_GROUP, 1, "per-request"],
      [WEAI_ADOBE_TOKEN_GROUP, 1, "token"],
      [WEAI_ADOBE_PER_REQUEST_URL_GROUP, 1, "per-request"],
    ]);
  });

  it("keeps the saved legacy tier and aspect ratio on an exact documented size preset", () => {
    const adobeModel = weAiCanvasModelDescriptors(
      WEAI_ADOBE_PER_REQUEST_GROUP,
    ).find((model) => model.id === "gpt-image-2-low");
    expect(adobeModel).toBeDefined();
    expect(weAiSizePresetForTier(adobeModel!, "1k", "16:9")).toBe("1024x1024");
    expect(weAiSizePresetForTier(adobeModel!, "2k", "16:9")).toBe("2048x1152");
    expect(weAiSizePresetForTier(adobeModel!, "4k", "16:9")).toBe("3840x2160");
    expect(weAiSizePresetForTier(adobeModel!, "4k", "9:16")).toBe("2160x3840");
  });

  it("stores the authenticated token prices while restricting routes to GPT Image 2", () => {
    expect(tokenPrice(WEAI_ADOBE_TOKEN_GROUP, "gpt-image-2")).toMatchObject({
      input: 5,
      output: 10,
      cacheRead: 1.25,
      imageOutput: 30,
    });

    expect(tokenPrice(WEAI_CODEX_TOKEN_GROUP, "gpt-image-1")).toMatchObject({
      input: 3.5,
      output: 0,
      cacheRead: 0.875,
      imageOutput: 28,
    });
    expect(tokenPrice(WEAI_CODEX_TOKEN_GROUP, "gpt-image-1.5")).toMatchObject({
      input: 3.5,
      output: 7,
      cacheRead: 0.875,
      imageOutput: 22.4,
    });
    expect(tokenPrice(WEAI_CODEX_TOKEN_GROUP, "gpt-image-2")).toMatchObject({
      input: 3.5,
      output: 7,
      cacheRead: 0.875,
      imageOutput: 21,
    });
    expect(
      weAiCallableModels(weAiCatalogGroup(WEAI_CODEX_TOKEN_GROUP)!).map(
        (model) => model.id,
      ),
    ).toEqual(["gpt-image-2"]);
  });

  it("keeps all Azure marketplace prices but only routes GPT Image 2", () => {
    const group = weAiCatalogGroup(WEAI_AZURE_OPENAI_GROUP)!;
    expect(group.models.map((model) => model.id)).toEqual([
      "gpt-image-1",
      "gpt-image-1.5",
      "gpt-image-2",
    ]);
    expect(tokenPrice(group.id, "gpt-image-1")).toMatchObject({
      input: 15,
      output: 0,
      cacheRead: 3.75,
      imageOutput: 120,
    });
    expect(tokenPrice(group.id, "gpt-image-1.5")).toMatchObject({
      input: 15,
      output: 30,
      cacheRead: 3.75,
      imageOutput: 96,
    });
    expect(tokenPrice(group.id, "gpt-image-2")).toMatchObject({
      input: 15,
      output: 30,
      cacheRead: 3.75,
      imageOutput: 90,
    });
    expect(group.models.map((model) => model.routeStatus)).toEqual([
      "marketplace-only",
      "marketplace-only",
      "callable",
    ]);
  });

  it("separates the Gemini marketplace list from its documented route IDs", () => {
    const group = weAiCatalogGroup(WEAI_GEMINI_GROUP)!;
    expect(group).toMatchObject({
      protocol: "gemini-openai-compatible",
      canvasSupported: true,
      defaultModel: "gemini-3.1-flash-image",
    });
    expect(group.protocols.map((protocol) => protocol.id)).toEqual([
      "gemini-openai-compatible",
      "gemini-generate-content",
    ]);
    expect(group.models.map((model) => model.id)).toEqual([
      "gemini-3-pro-image",
      "gemini-3-pro-image-preview",
      "gemini-3.0-pro-image",
      "gemini-3.0-pro-image-preview",
      "gemini-3.1-flash-image",
      "gemini-3.1-flash-image-preview",
    ]);
    expect(
      group.models.map((model) => [
        model.id,
        model.canvasCallable,
        model.routeStatus,
      ]),
    ).toEqual([
      ["gemini-3-pro-image", true, "callable"],
      ["gemini-3-pro-image-preview", false, "alias"],
      ["gemini-3.0-pro-image", false, "marketplace-only"],
      ["gemini-3.0-pro-image-preview", false, "marketplace-only"],
      ["gemini-3.1-flash-image", true, "callable"],
      ["gemini-3.1-flash-image-preview", false, "alias"],
    ]);
    expect(group.models[1]?.aliasFor).toBe("gemini-3-pro-image");
    expect(group.models[5]?.aliasFor).toBe("gemini-3.1-flash-image");
    expect(weAiCallableModels(group).map((model) => model.id)).toEqual([
      "gemini-3-pro-image",
      "gemini-3.1-flash-image",
    ]);

    for (const modelId of group.models.slice(0, 4).map((model) => model.id)) {
      expect(imagePrice(group.id, modelId).tiers).toEqual([
        { id: "1k", label: "1K", price: 0.06 },
        { id: "2k", label: "2K", price: 0.08 },
        { id: "4k", label: "4K", price: 0.1 },
      ]);
    }
    for (const modelId of group.models.slice(4).map((model) => model.id)) {
      expect(imagePrice(group.id, modelId).tiers).toEqual([
        { id: "1k", label: "1K", price: 0.04 },
        { id: "2k", label: "2K", price: 0.06 },
        { id: "4k", label: "4K", price: 0.08 },
      ]);
    }
  });

  it("models Adobe fixed-quality pricing per request without fake resolution tiers", () => {
    const group = weAiCatalogGroup(WEAI_ADOBE_PER_REQUEST_GROUP)!;
    expect(group).toMatchObject({
      billingMode: "per-request",
      billingLabel: "按次计费",
      defaultModel: "gpt-image-2-low",
    });
    expect(requestPrice(group.id, "gpt-image-2")).toMatchObject({
      dimension: "quality",
      unit: "request",
      tiers: [
        { id: "low", label: "LOW", price: 0.04 },
        { id: "medium", label: "MEDIUM", price: 0.07 },
        { id: "high", label: "HIGH", price: 0.15 },
      ],
      supportedSizes: ["1K", "2K", "4K"],
    });
    expect(weAiCatalogModel(group.id, "gpt-image-2")).toMatchObject({
      canvasCallable: false,
      routeStatus: "route-disabled",
    });

    for (const [modelId, price] of [
      ["gpt-image-2-low", 0.04],
      ["gpt-image-2-medium", 0.07],
      ["gpt-image-2-high", 0.15],
    ] as const) {
      const modelPricing = requestPrice(group.id, modelId);
      expect(modelPricing).toMatchObject({
        dimension: "fixed",
        unit: "request",
        tiers: [{ id: "request", label: "单次", price }],
        supportedSizes: ["1K", "2K", "4K"],
      });
      expect(weAiCatalogModel(group.id, modelId)?.canvasCallable).toBe(true);
    }
  });

  it("publishes the three real Adobe fixed-quality models with independent exact size", () => {
    const models = weAiCanvasModelDescriptors(WEAI_ADOBE_PER_REQUEST_GROUP);
    expect(models.map((model) => model.id)).toEqual([
      "gpt-image-2-low",
      "gpt-image-2-medium",
      "gpt-image-2-high",
    ]);
    expect(
      models.map((model) =>
        model.parameters?.map((parameter) => parameter.key),
      ),
    ).toEqual([
      ["aspect_ratio", "size", "response_format", "n"],
      ["aspect_ratio", "size", "response_format", "n"],
      ["aspect_ratio", "size", "response_format", "n"],
    ]);
    const defaultModel = models.find((model) => model.id === "gpt-image-2-low");
    expect(defaultModel).toMatchObject({
      name: "GPT Image 2 LOW（$0.04/次 · 1K/2K/4K）",
      isDefault: true,
      metadata: {
        fixedQuality: "low",
      },
    });
    expect(
      defaultModel?.parameters?.some(
        (parameter) => parameter.key === "quality",
      ),
    ).toBe(false);
    expect(
      defaultModel?.parameters
        ?.find((parameter) => parameter.key === "size")
        ?.options?.map((option) => option.value),
    ).toEqual([
      "auto",
      "1024x1024",
      "1536x1024",
      "1024x1536",
      "2048x2048",
      "2048x1152",
      "2160x2160",
      "3840x2160",
      "2160x3840",
      "2880x2160",
      "2160x2880",
      "3264x2176",
      "2176x3264",
      "3840x1648",
    ]);
    expect(
      defaultModel?.parameters?.find(
        (parameter) => parameter.key === "response_format",
      ),
    ).toMatchObject({
      default: "url",
      options: [{ label: "URL（供应商要求，避免大图断线）", value: "url" }],
    });
    const highDefault = weAiCanvasModelDescriptors(
      WEAI_ADOBE_PER_REQUEST_GROUP,
      undefined,
      "gpt-image-2-high",
    );
    expect(
      highDefault.filter((model) => model.isDefault).map((model) => model.id),
    ).toEqual(["gpt-image-2-high"]);
    expect(models.some((model) => model.id.includes("::"))).toBe(false);
  });

  it("keeps the return-URL Adobe route separate from the suffix-only route", () => {
    const group = weAiCatalogGroup(WEAI_ADOBE_PER_REQUEST_URL_GROUP)!;
    expect(group.models.map((model) => model.id)).toEqual(["gpt-image-2"]);
    expect(group.defaultModel).toBe("gpt-image-2");
    expect(group.models[0]).toMatchObject({
      canvasCallable: true,
      routeStatus: "callable",
    });
    expect(requestPrice(group.id, "gpt-image-2").tiers).toEqual([
      { id: "low", label: "LOW", price: 0.04 },
      { id: "medium", label: "MEDIUM", price: 0.07 },
      { id: "high", label: "HIGH", price: 0.15 },
    ]);
    expect(requestPrice(group.id, "gpt-image-2").supportedSizes).toEqual([
      "1K",
      "2K",
      "4K",
    ]);
  });

  it("publishes the channel-specific output-count limits", () => {
    expect(
      weAiCatalogModel(WEAI_ADOBE_TOKEN_GROUP, "gpt-image-2")?.limits
        ?.maxOutputImages,
    ).toBe(10);
    expect(
      weAiCatalogModel(WEAI_AZURE_OPENAI_GROUP, "gpt-image-2")?.limits
        ?.maxOutputImages,
    ).toBe(10);
    expect(
      weAiCatalogModel(WEAI_ADOBE_PER_REQUEST_GROUP, "gpt-image-2-high")?.limits
        ?.maxOutputImages,
    ).toBe(10);
    expect(
      weAiCatalogModel(WEAI_ADOBE_PER_REQUEST_URL_GROUP, "gpt-image-2")?.limits
        ?.maxOutputImages,
    ).toBe(10);
    expect(
      weAiCatalogModel(WEAI_CODEX_TOKEN_GROUP, "gpt-image-2")?.limits
        ?.maxOutputImages,
    ).toBe(1);
    expect(
      weAiCatalogModel(WEAI_GEMINI_GROUP, "gemini-3.1-flash-image")?.limits
        ?.maxOutputImages,
    ).toBe(1);
  });

  it("always resolves saved defaults and protocols to route-safe values", () => {
    for (const group of WEAI_CATALOG) {
      const defaultModel = weAiCatalogModel(group.id, group.defaultModel);
      expect(defaultModel?.canvasCallable).toBe(true);
      expect(group.pricesIncludeMultiplier).toBe(true);
      expect(resolveWeAiDefaultModel(group, "unknown-model")).toBe(
        group.defaultModel,
      );
      for (const model of group.models) {
        expect(model.description.length).toBeGreaterThan(0);
        expect(model.routeNote.length).toBeGreaterThan(0);
        expect(model.pricing.currency).toBe("USD");
      }
    }

    const adobe = weAiCatalogGroup(WEAI_ADOBE_PER_REQUEST_GROUP)!;
    expect(resolveWeAiDefaultModel(adobe, "gpt-image-2")).toBe(
      "gpt-image-2-low",
    );
    const gemini = weAiCatalogGroup(WEAI_GEMINI_GROUP)!;
    expect(resolveWeAiDefaultModel(gemini, "gemini-3.0-pro-image")).toBe(
      "gemini-3.1-flash-image",
    );
    expect(resolveWeAiProtocol(gemini, "gemini-generate-content")).toBe(
      "gemini-generate-content",
    );
    expect(resolveWeAiProtocol(gemini, "invalid-protocol")).toBe(
      "gemini-openai-compatible",
    );
  });

  it("provides safe group and model lookup helpers", () => {
    expect(isWeAiGroupId(WEAI_CODEX_TOKEN_GROUP)).toBe(true);
    expect(isWeAiGroupId("unknown-group")).toBe(false);
    expect(weAiCatalogGroup("unknown-group")).toBeUndefined();
    expect(weAiCatalogModel(WEAI_CODEX_TOKEN_GROUP, "gpt-image-2")?.name).toBe(
      "GPT Image 2",
    );
    expect(
      weAiCatalogModel(WEAI_CODEX_TOKEN_GROUP, "missing-model"),
    ).toBeUndefined();
  });

  it("restores a keyed model scan without requesting the provider again", () => {
    const config = {
      modelGroup: WEAI_ADOBE_PER_REQUEST_GROUP,
      defaultModel: "gpt-image-2-high",
      modelScanStatus: "live",
      modelScanCheckedAt: "2026-08-03T04:00:00.000Z",
      scannedModelIds: [
        "gpt-image-2-low",
        "gpt-image-2-medium",
        "gpt-image-2-high",
      ],
      unavailableModels: [{ id: "gpt-image-2-high", reason: "unknown_model" }],
    };

    expect(readWeAiSavedModelScan(config)).toEqual({
      status: "live",
      checkedAt: "2026-08-03T04:00:00.000Z",
      modelIds: ["gpt-image-2-low", "gpt-image-2-medium", "gpt-image-2-high"],
    });
    expect(
      weAiCanvasModelDescriptorsFromSavedScan(config)?.map((model) => [
        model.id,
        model.isDefault,
      ]),
    ).toEqual([
      ["gpt-image-2-low", true],
      ["gpt-image-2-medium", false],
    ]);
  });

  it("treats a saved empty scan as authoritative", () => {
    const config = {
      modelGroup: WEAI_AZURE_OPENAI_GROUP,
      modelScanStatus: "empty",
      scannedModelIds: [],
    };
    expect(readWeAiSavedModelScan(config)?.status).toBe("empty");
    expect(weAiCanvasModelDescriptorsFromSavedScan(config)).toEqual([]);
    expect(
      weAiCanvasModelDescriptorsFromSavedScan({
        modelGroup: WEAI_AZURE_OPENAI_GROUP,
      }),
    ).toBeNull();
  });
});

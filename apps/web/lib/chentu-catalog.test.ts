import { describe, expect, it, vi } from "vitest";
import {
  CHENTU_CATALOG_SOURCE,
  chentuCatalogFromPricing,
  chentuDefaultModelForLiveGroup,
  chentuFallbackImageDescriptor,
  chentuVideoConnectorForModels,
  loadChentuCatalog,
  resolveChentuScannedGroup,
  type ChentuPricingPayload,
} from "./chentu-catalog";

/**
 * Trimmed verbatim from the live https://tu.988236.xyz/api/pricing payload
 * saved at .codex-temp/probe/chentu.json (captured 2026-08-28).
 */
const payload: ChentuPricingPayload = {
  data: [
    {
      model_name: "gpt-image-2",
      vendor_id: 1,
      quota_type: 1,
      model_ratio: 0,
      model_price: 0.02735,
      completion_ratio: 0,
      enable_groups: ["1k低价生图"],
      supported_endpoint_types: ["image-generation", "openai"],
    },
    {
      model_name: "gpt-image-2-1k",
      vendor_id: 1,
      quota_type: 1,
      model_ratio: 0,
      model_price: 0.04,
      completion_ratio: 0,
      enable_groups: [
        "低价Adobe生图",
        "az兜底渠道1k生图",
        "1k低价生图",
        "兜底原生生图",
      ],
      supported_endpoint_types: ["image-generation", "openai"],
    },
    {
      model_name: "gpt-image-2-4k",
      vendor_id: 1,
      quota_type: 1,
      model_ratio: 0,
      model_price: 0.04,
      completion_ratio: 0,
      enable_groups: ["兜底原生生图", "低价Adobe生图", "image2官key"],
      supported_endpoint_types: ["image-generation", "openai"],
    },
    {
      model_name: "gpt-image-2自由传参",
      vendor_id: 1,
      quota_type: 1,
      model_ratio: 0,
      model_price: 0.04,
      completion_ratio: 0,
      enable_groups: ["兜底原生生图", "低价Adobe生图", "image2官key"],
      supported_endpoint_types: ["image-generation", "openai"],
    },
    {
      model_name: "gemini-3-pro-image-4k",
      vendor_id: 4,
      quota_type: 1,
      model_ratio: 0,
      model_price: 0.09,
      completion_ratio: 0,
      enable_groups: ["测试生图", "逆向小小nano生图"],
      supported_endpoint_types: ["image-generation", "openai"],
    },
    {
      model_name: "happyhorse-720p",
      description:
        "文生视频单图生视频，4-15s，支持16：9，9：16，3：4，1：1，4：3",
      quota_type: 1,
      model_ratio: 0,
      model_price: 1.2,
      completion_ratio: 0,
      enable_groups: ["排klingsd视频"],
      supported_endpoint_types: ["openai-video", "openai"],
    },
    {
      model_name: "seedance-2.0-480p",
      description: "卡脸，933，秒数4-15s。",
      quota_type: 1,
      model_ratio: 0,
      model_price: 1.5,
      completion_ratio: 0,
      enable_groups: ["排klingsd视频"],
      supported_endpoint_types: ["openai"],
    },
    {
      model_name: "kling-v3",
      description:
        "Kling 3.0 标准视频模型。支持 3-15 秒、720p/1080p、16:9/1:1/9:16 和可选结果音轨；首尾帧使用 start_frame 与 end_fram",
      vendor_id: 9,
      quota_type: 1,
      model_ratio: 0,
      model_price: 0.8,
      completion_ratio: 0,
      enable_groups: ["klingsd视频"],
      supported_endpoint_types: ["openai-video", "openai"],
    },
    {
      model_name: "claude-sonnet-4-6",
      vendor_id: 8,
      quota_type: 0,
      model_ratio: 1.5,
      model_price: 0,
      completion_ratio: 5,
      cache_ratio: 0.1,
      enable_groups: ["CC-MAX-企业版-CC Test满分", "纯血ccmax"],
      supported_endpoint_types: ["openai"],
    },
  ],
  group_ratio: {
    "0.01福利额度不多速刷": 0.01,
    "0.04gpt/k12": 0.06,
    "0.08gpt": 0.09,
    "0.13特惠Pro号池": 0.13,
    "1k低价生图": 0.55,
    "CC-MAX-企业版-CC Test满分": 0.7,
    az兜底渠道1k生图: 1.25,
    default: 1,
    gemini大语言模型: 0.25,
    grokheavy号池: 0.13,
    grok纯享视频: 1,
    image2官key: 4.5,
    klingsd视频: 1,
    "sora，veo，omni视频": 1,
    低价Adobe生图: 1.25,
    低价gemni生图: 1,
    兜底原生生图: 1.75,
    排klingsd视频: 1,
    无敌稳定Pro: 0.17,
    测试生图: 1,
    纯血ccmax: 0.9,
  },
  usable_group: {
    "1k低价生图": "",
    az兜底渠道1k生图: "官key兜底专用",
    image2官key: "满血全参，支持透明底和局部重绘",
    低价Adobe生图: "Adobe渠道",
    排klingsd视频: "白天排队，晚上用最好",
    纯血ccmax: "纯血 MAX20X Claude Code OAuth 号池，零追加隐藏提示词",
  },
};

function resetCatalogCache(): void {
  delete (globalThis as Record<string, unknown>)["__superCanvasChentuCatalog"];
}

describe("chentu catalog", () => {
  it("prices models with the live ￥ group-ratio math", () => {
    const catalog = chentuCatalogFromPricing(payload);
    expect(CHENTU_CATALOG_SOURCE).toBe("https://tu.988236.xyz/api/pricing");
    expect(catalog.source).toBe("live");

    const cheapGroup = catalog.marketplaceGroups.find(
      (group) => group.id === "1k低价生图",
    );
    expect(cheapGroup).toMatchObject({ ratio: 0.55 });
    expect(
      cheapGroup?.models.find((model) => model.id === "gpt-image-2"),
    ).toMatchObject({
      capability: "image",
      priceLabel: "￥ 0.015 / 请求",
      billingLabel: "按次计费",
      canvasRunnable: true,
    });

    const officialGroup = catalog.marketplaceGroups.find(
      (group) => group.id === "image2官key",
    );
    expect(officialGroup).toMatchObject({
      ratio: 4.5,
      description: "满血全参，支持透明底和局部重绘",
    });
    expect(
      officialGroup?.models.find((model) => model.id === "gpt-image-2-4k"),
    ).toMatchObject({ priceLabel: "￥ 0.18 / 请求" });

    // Groups listed in enable_groups without a group_ratio entry price at 1.
    const missingRatioGroup = catalog.marketplaceGroups.find(
      (group) => group.id === "逆向小小nano生图",
    );
    expect(missingRatioGroup).toMatchObject({ ratio: 1 });
    expect(
      missingRatioGroup?.models.find(
        (model) => model.id === "gemini-3-pro-image-4k",
      ),
    ).toMatchObject({ priceLabel: "￥ 0.09 / 请求", capability: "image" });

    const ccGroup = catalog.marketplaceGroups.find(
      (group) => group.id === "纯血ccmax",
    );
    expect(
      ccGroup?.models.find((model) => model.id === "claude-sonnet-4-6"),
    ).toMatchObject({
      capability: "chat",
      priceLabel: "输入 ￥2.70 / 1M · 输出 ￥13.50 / 1M",
      billingLabel: "按量计费",
    });
  });

  it("prefers a structured per-second unit over text inference", () => {
    const catalog = chentuCatalogFromPricing({
      data: [
        {
          model_name: "sd-2.5-by-second",
          description: "视频线路",
          video_api: { pricing: { unit: "per_second" } },
          quota_type: 1,
          model_price: 0.5,
          enable_groups: ["klingsd视频"],
          supported_endpoint_types: ["openai-video", "openai"],
        },
      ],
      group_ratio: { klingsd视频: 1 },
      usable_group: {},
    });
    expect(
      catalog.marketplaceGroups[0]?.models.find(
        (model) => model.id === "sd-2.5-by-second",
      ),
    ).toMatchObject({ priceLabel: "￥ 0.50 / 秒", billingLabel: "按秒计费" });
  });

  it("classifies image, openai-video and openai-only video models", () => {
    const catalog = chentuCatalogFromPricing(payload);
    const queueGroup = catalog.marketplaceGroups.find(
      (group) => group.id === "排klingsd视频",
    );
    expect(
      queueGroup?.models.find((model) => model.id === "happyhorse-720p"),
    ).toMatchObject({ capability: "video", canvasRunnable: true });
    expect(
      queueGroup?.models.find((model) => model.id === "seedance-2.0-480p"),
    ).toMatchObject({
      capability: "video",
      canvasRunnable: false,
      canvasUnavailableReason: "仅支持对话式接口调用，画布协议未验证",
    });

    // Only openai-video models publish a runnable canvas descriptor.
    expect(catalog.groups["排klingsd视频"]?.map((model) => model.id)).toEqual([
      "happyhorse-720p",
    ]);
    const happyhorse = catalog.groups["排klingsd视频"]?.[0];
    expect(happyhorse).toMatchObject({
      name: "happyhorse-720p · ￥ 1.20 / 请求",
      operations: ["video.generate", "video.image-to-video"],
      outputKinds: ["video"],
      description:
        "文生视频单图生视频，4-15s，支持16：9，9：16，3：4，1：1，4：3",
      metadata: {
        supplier: "chentu",
        modelGroup: "排klingsd视频",
        groupRatio: 1,
        priceLabel: "￥ 1.20 / 请求",
        billingLabel: "按次计费",
        canvasRunnable: true,
        protocol: "openai-videos",
      },
    });
    expect(happyhorse?.inputKinds).toEqual([
      "text",
      "image",
      "image[]",
      "video",
      "video[]",
      "audio",
      "audio[]",
    ]);
    expect(happyhorse?.parameters?.map((parameter) => parameter.key)).toEqual([
      "duration",
      "aspect_ratio",
      "resolution",
    ]);
    expect(
      happyhorse?.parameters?.find((parameter) => parameter.key === "duration"),
    ).toMatchObject({ default: 5, min: 1, max: 30 });
    expect(
      happyhorse?.parameters?.find(
        (parameter) => parameter.key === "resolution",
      ),
    ).toMatchObject({
      default: "720p",
      options: [
        { label: "480p", value: "480p" },
        { label: "720p", value: "720p" },
        { label: "1080p", value: "1080p" },
        { label: "2k", value: "2k" },
      ],
    });

    const image = catalog.groups["1k低价生图"]?.find(
      (model) => model.id === "gpt-image-2",
    );
    expect(image).toMatchObject({
      name: "gpt-image-2 · ￥ 0.015 / 请求",
      operations: ["image.generate", "image.edit"],
      metadata: {
        supplier: "chentu",
        modelGroup: "1k低价生图",
        groupRatio: 0.55,
        priceLabel: "￥ 0.015 / 请求",
        billingLabel: "按次计费",
        canvasRunnable: true,
        protocol: "openai-images",
      },
    });
  });

  it("restores the documented 1K/2K/4K controls for live GPT Image models", () => {
    const catalog = chentuCatalogFromPricing(payload);
    const adobeModels = catalog.groups["低价Adobe生图"] ?? [];
    const freeModel = adobeModels.find(
      (model) => model.id === "gpt-image-2自由传参",
    );
    const freeSize = freeModel?.parameters?.find(
      (parameter) => parameter.key === "size",
    );
    expect(freeSize).toMatchObject({
      control: "dimensions",
      default: "auto",
      min: 16,
      max: 8192,
      step: 16,
    });
    expect(freeSize?.options?.[0]).toEqual({
      label: "自动（提示词优先，其次参考图）",
      value: "auto",
    });
    expect(
      freeSize?.options?.filter((option) => option.label.startsWith("1K ·")),
    ).toHaveLength(16);
    expect(
      freeSize?.options?.filter((option) => option.label.startsWith("2K ·")),
    ).toHaveLength(9);
    expect(
      freeSize?.options?.filter((option) => option.label.startsWith("4K ·")),
    ).toHaveLength(9);
    expect(freeSize?.options).toContainEqual({
      label: "4K · 16:9 · 3840 × 2160",
      value: "3840x2160",
    });

    const oneKSize = adobeModels
      .find((model) => model.id === "gpt-image-2-1k")
      ?.parameters?.find((parameter) => parameter.key === "size");
    expect(oneKSize).toMatchObject({ control: "select", default: "auto" });
    expect(
      oneKSize?.options
        ?.filter((option) => option.value !== "auto")
        .every((option) => option.label.startsWith("1K ·")),
    ).toBe(true);

    const fourKSize = adobeModels
      .find((model) => model.id === "gpt-image-2-4k")
      ?.parameters?.find((parameter) => parameter.key === "size");
    expect(fourKSize).toMatchObject({
      control: "select",
      default: "2880x2880",
    });
    expect(
      fourKSize?.options?.every((option) => option.label.startsWith("4K ·")),
    ).toBe(true);

    const officialFree = catalog.groups["image2官key"]?.find(
      (model) => model.id === "gpt-image-2自由传参",
    );
    expect(
      officialFree?.parameters?.find((parameter) => parameter.key === "n"),
    ).toMatchObject({ max: 10 });
    expect(
      officialFree?.parameters?.find(
        (parameter) => parameter.key === "quality",
      ),
    ).toMatchObject({ default: "standard" });
    expect(
      officialFree?.parameters?.find((parameter) => parameter.key === "style"),
    ).toMatchObject({ default: "vivid" });
  });

  it("keeps the free-parameter 1K/2K/4K schema during a pending key scan", () => {
    const fallback = chentuFallbackImageDescriptor(
      "gpt-image-2自由传参",
      "低价Adobe生图",
    );
    const size = fallback?.parameters?.find(
      (parameter) => parameter.key === "size",
    );
    expect(size).toMatchObject({
      control: "dimensions",
      default: "auto",
      min: 16,
      max: 8192,
      step: 16,
    });
    expect(
      size?.options?.filter((option) => option.label.startsWith("1K ·")),
    ).toHaveLength(16);
    expect(
      size?.options?.filter((option) => option.label.startsWith("2K ·")),
    ).toHaveLength(9);
    expect(
      size?.options?.filter((option) => option.label.startsWith("4K ·")),
    ).toHaveLength(9);
    expect(chentuFallbackImageDescriptor("not-a-chentu-image-model")).toBe(
      undefined,
    );
  });

  it("recognizes a scan-only documented 2K GPT Image model", () => {
    const catalog = chentuCatalogFromPricing(payload);
    const resolved = resolveChentuScannedGroup(catalog, "低价Adobe生图", [
      "gpt-image-2-2k",
    ]);
    const model = resolved.canvasModels[0];
    const size = model?.parameters?.find(
      (parameter) => parameter.key === "size",
    );
    expect(model).toMatchObject({
      id: "gpt-image-2-2k",
      metadata: { canvasRunnable: true },
    });
    expect(size).toMatchObject({
      control: "select",
      default: "2048x2048",
    });
    expect(size?.options).toHaveLength(9);
    expect(
      size?.options?.every((option) => option.label.startsWith("2K ·")),
    ).toBe(true);
  });

  it("uses keyed scan IDs as the sole visibility source", () => {
    const catalog = chentuCatalogFromPricing(payload);
    const resolved = resolveChentuScannedGroup(catalog, "低价Adobe生图", [
      "gpt-image-2-1k",
      "gpt-image-2-4k",
      "kling-new-99",
      "claude-sonnet-4-6",
      "scan-only-mystery",
      "gpt-image-2-1k",
      "  ",
    ]);

    // Pricing-only IDs (gpt-image-2自由传参) are dropped; scan-only IDs stay
    // visible at an unknown price.
    expect(resolved.marketplaceGroup.models.map((model) => model.id)).toEqual([
      "gpt-image-2-1k",
      "gpt-image-2-4k",
      "kling-new-99",
      "claude-sonnet-4-6",
      "scan-only-mystery",
    ]);
    expect(resolved.canvasModels.map((model) => model.id)).toEqual([
      "gpt-image-2-1k",
      "gpt-image-2-4k",
    ]);
    expect(resolved.canvasModels[0]).toMatchObject({
      name: "gpt-image-2-1k · ￥ 0.05 / 请求",
      metadata: {
        modelGroup: "低价Adobe生图",
        groupRatio: 1.25,
        canvasRunnable: true,
      },
    });
    expect(resolved.canvasDisplayModels.map((model) => model.id)).toEqual([
      "gpt-image-2-1k",
      "gpt-image-2-4k",
      "kling-new-99",
    ]);
    expect(
      resolved.canvasDisplayModels.find((model) => model.id === "kling-new-99"),
    ).toMatchObject({
      operations: ["video.generate", "video.image-to-video"],
      metadata: {
        canvasRunnable: false,
        canvasUnavailableReason: "尚无已验证的画布生成协议",
        catalogCapability: "video",
      },
    });
    expect(
      resolved.marketplaceGroup.models.find(
        (model) => model.id === "kling-new-99",
      ),
    ).toMatchObject({
      capability: "video",
      priceLabel: "价格以平台为准",
      canvasRunnable: false,
    });
    expect(
      resolved.marketplaceGroup.models.find(
        (model) => model.id === "claude-sonnet-4-6",
      ),
    ).toMatchObject({
      capability: "chat",
      canvasRunnable: false,
      canvasUnavailableReason: "对话模型不用于画布",
    });
    expect(resolved.marketplaceGroup).toMatchObject({
      ratio: 1.25,
      description: "Adobe渠道",
      canvasSupported: true,
      canvasModelCount: 2,
    });

    const empty = resolveChentuScannedGroup(catalog, "低价Adobe生图", []);
    expect(empty.marketplaceGroup.models).toEqual([]);
    expect(empty.canvasModels).toEqual([]);
    expect(empty.canvasDisplayModels).toEqual([]);
    expect(empty.marketplaceGroup).toMatchObject({
      canvasSupported: false,
      canvasModelCount: 0,
    });
  });

  it("keeps scanned openai-only video models visible but not runnable", () => {
    const catalog = chentuCatalogFromPricing(payload);
    const resolved = resolveChentuScannedGroup(catalog, "排klingsd视频", [
      "happyhorse-720p",
      "seedance-2.0-480p",
    ]);
    expect(resolved.canvasModels.map((model) => model.id)).toEqual([
      "happyhorse-720p",
    ]);
    expect(resolved.canvasDisplayModels.map((model) => model.id)).toEqual([
      "happyhorse-720p",
      "seedance-2.0-480p",
    ]);
    expect(
      resolved.canvasDisplayModels.find(
        (model) => model.id === "seedance-2.0-480p",
      ),
    ).toMatchObject({
      metadata: {
        canvasRunnable: false,
        canvasUnavailableReason: "仅支持对话式接口调用，画布协议未验证",
      },
    });
    expect(resolved.marketplaceGroup).toMatchObject({
      canvasSupported: true,
      canvasModelCount: 1,
    });
  });

  it("degrades live → stale → built-in fallback", async () => {
    resetCatalogCache();
    const failedFetch = vi.fn(
      async () => new Response("unavailable", { status: 503 }),
    ) as unknown as typeof fetch;
    const liveFetch = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    // No live snapshot yet: fall back to the built-in preset catalog.
    const fallback = await loadChentuCatalog({
      force: true,
      fetch: failedFetch,
    });
    expect(fallback.source).toBe("fallback");
    const fallbackCheap = fallback.marketplaceGroups.find(
      (group) => group.id === "1k低价生图",
    );
    expect(fallbackCheap).toMatchObject({
      ratio: 0.55,
      canvasSupported: true,
    });
    expect(fallbackCheap?.models.map((model) => model.id)).toEqual([
      "gpt-image-2",
      "gpt-image-2-1k",
    ]);
    expect(fallback.groups["1k低价生图"]?.map((model) => model.id)).toEqual([
      "gpt-image-2",
      "gpt-image-2-1k",
    ]);
    expect(fallback.groups["1k低价生图"]?.[0]).toMatchObject({
      operations: ["image.generate", "image.edit"],
      metadata: {
        supplier: "chentu",
        modelGroup: "1k低价生图",
        priceLabel: "￥ 0.015 / 请求",
        canvasRunnable: true,
      },
    });

    // Live success replaces the fallback.
    const live = await loadChentuCatalog({ force: true, fetch: liveFetch });
    expect(live.source).toBe("live");
    expect(
      live.marketplaceGroups.some((group) => group.id === "排klingsd视频"),
    ).toBe(true);

    // A later failure serves the last live snapshot marked stale.
    const stale = await loadChentuCatalog({ force: true, fetch: failedFetch });
    expect(stale.source).toBe("stale");
    expect(
      stale.marketplaceGroups.some((group) => group.id === "排klingsd视频"),
    ).toBe(true);
    expect(stale.groups["排klingsd视频"]?.map((model) => model.id)).toEqual([
      "happyhorse-720p",
    ]);
    resetCatalogCache();
  });

  it("builds the OpenAI Videos rest connector for video groups", () => {
    const catalog = chentuCatalogFromPricing(payload);
    const models = catalog.groups["排klingsd视频"] ?? [];
    const connector = chentuVideoConnectorForModels(models);
    expect(connector).toMatchObject({
      auth: { type: "bearer" },
      allowedHosts: ["tu.988236.xyz"],
      assetsRequirePublicUrls: true,
      restrictModels: true,
      pollIntervalMs: 4_000,
      submit: { path: "/v1/videos", method: "POST", bodyMode: "json" },
      poll: { path: "/v1/videos/{taskId}", method: "GET", bodyMode: "none" },
      output: { kind: "video", defaultMimeType: "video/mp4" },
    });
    expect(connector.submit.mappings?.map((mapping) => mapping.target)).toEqual(
      [
        "/model",
        "/prompt",
        "/seconds",
        "/ratio",
        "/resolution",
        "/image_urls",
        "/video_urls",
        "/audio_urls",
      ],
    );
    expect(connector.models?.map((model) => model.id)).toEqual([
      "happyhorse-720p",
    ]);
    expect(connector.models).not.toBe(models);
  });

  it("prefers the preset default model per group", () => {
    const catalog = chentuCatalogFromPricing(payload);
    expect(
      chentuDefaultModelForLiveGroup(
        "1k低价生图",
        catalog.groups["1k低价生图"] ?? [],
      ),
    ).toBe("gpt-image-2");
    expect(
      chentuDefaultModelForLiveGroup(
        "排klingsd视频",
        catalog.groups["排klingsd视频"] ?? [],
      ),
    ).toBe("happyhorse-720p");
    expect(chentuDefaultModelForLiveGroup("排klingsd视频", [])).toBe("");
  });
});

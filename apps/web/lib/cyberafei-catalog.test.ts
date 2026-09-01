import { describe, expect, it, vi } from "vitest";
import {
  CYBERAFEI_API_BASE_URL,
  CYBERAFEI_BASE_URL,
  cyberAfeiCatalogFromPricing,
  cyberAfeiConnectorForModels,
  cyberAfeiDefaultModelForGroup,
  loadCyberAfeiCatalog,
  resolveCyberAfeiScannedGroup,
  type PricingPayload,
} from "./cyberafei-catalog";

describe("cyberafei catalog", () => {
  const imageGroup = "image-2稳定生图";
  const videoGroup = "特价seedance2.0";
  const compositeGroup = "图片视频模型综合分组";
  const payload: PricingPayload = {
    data: [
      {
        model_name: "gpt-image-2",
        model_price: 0.15,
        quota_type: 1,
        enable_groups: [imageGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gpt-image-4K",
        model_price: 0.35,
        quota_type: 1,
        enable_groups: [imageGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gpt-image-2-2K",
        model_price: 0.35,
        quota_type: 1,
        enable_groups: [imageGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gpt-image-2-4K",
        model_price: 0.35,
        quota_type: 1,
        enable_groups: [imageGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "video-v1-10s",
        model_price: 1.5,
        quota_type: 1,
        enable_groups: [videoGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "firefly-video-v2",
        video_api: { pricing: { unit: "per_second" } },
        model_price: 20,
        quota_type: 1,
        enable_groups: [videoGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gemini-3.1-flash-image-preview",
        model_price: 0.3,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gemini-3-pro-image-preview",
        model_price: 0.975,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["gemini", "openai"],
      },
      {
        model_name: "gemini-3.1-flash-image-1k",
        model_price: 0.3,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["gemini", "openai"],
      },
      {
        model_name: "gemini-3.1-flash-image-2k",
        model_price: 0.4,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["gemini", "openai"],
      },
      {
        model_name: "gemini-3.1-flash-image-4k",
        model_price: 0.5,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["gemini", "openai"],
      },
      {
        model_name: "gemini-3.1-flash-image-preview-2K",
        model_price: 1,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gemini-3.1-flash-image-preview-4K",
        model_price: 1.5,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "grok-imagine-video-1.5-720p",
        model_price: 8.5,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "grok-imagine-video-1.5",
        model_price: 8.5,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "grok-imagine-无限",
        model_price: 1,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "grok-imagine-image",
        model_price: 0.3,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "grok-imagine-image-quality",
        model_price: 0.8,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "nano-banana-pro",
        model_price: 0.975,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gpt-image-2",
        model_price: 0.15,
        quota_type: 1,
        enable_groups: ["gpt5.6-破甲版"],
        supported_endpoint_types: ["openai"],
      },
    ],
    group_ratio: {
      [imageGroup]: 1,
      [videoGroup]: 1,
      [compositeGroup]: 1,
      "gpt5.6-破甲版": 1,
    },
    usable_group: {
      [imageGroup]: "稳定生图",
      [videoGroup]: "SD2 视频",
      [compositeGroup]: "图片视频综合分组",
      "gpt5.6-破甲版": "GPT 文本分组",
    },
  };

  it("uses structured per-second pricing units when a catalog provides them", () => {
    const catalog = cyberAfeiCatalogFromPricing(payload);
    const model = catalog.marketplaceGroups
      .find((group) => group.id === videoGroup)
      ?.models.find((item) => item.id === "firefly-video-v2");
    expect(model).toMatchObject({
      priceLabel: "$20 / 秒",
      billingLabel: "按秒计费",
    });
  });

  it("keeps a successful empty pricing response live without fallback models", () => {
    const catalog = cyberAfeiCatalogFromPricing({
      data: [],
      group_ratio: {},
      usable_group: {},
    });

    expect(catalog).toMatchObject({
      source: "live",
      groups: {},
      marketplaceGroups: [],
    });
  });

  it("uses keyed scan IDs as the sole visibility source", () => {
    const catalog = cyberAfeiCatalogFromPricing(payload);
    const first = resolveCyberAfeiScannedGroup(catalog, compositeGroup, [
      "gemini-3.1-flash-image-preview",
      "gemini-3.1-flash-image-preview-2K",
      "gemini-3.1-flash-image-preview-4K",
      "grok-imagine-image",
      "grok-imagine-video",
      "kling-3.0",
      "gpt-image-2-2K",
      "scan-only-image",
      "grok-imagine-image",
      "  ",
    ]);

    expect(first.marketplaceGroup.models.map((model) => model.id)).toEqual([
      "gemini-3.1-flash-image-preview",
      "gemini-3.1-flash-image-preview-2K",
      "gemini-3.1-flash-image-preview-4K",
      "grok-imagine-image",
      "grok-imagine-video",
      "kling-3.0",
      "gpt-image-2-2K",
      "scan-only-image",
    ]);
    expect(first.canvasModels.map((model) => model.id)).toEqual([
      "gemini-3.1-flash-image-preview",
      "grok-imagine-image",
      "grok-imagine-video",
      "gpt-image-2-2K",
    ]);
    expect(first.canvasDisplayModels.map((model) => model.id)).toEqual([
      "gemini-3.1-flash-image-preview",
      "gemini-3.1-flash-image-preview-2K",
      "gemini-3.1-flash-image-preview-4K",
      "grok-imagine-image",
      "grok-imagine-video",
      "kling-3.0",
      "gpt-image-2-2K",
      "scan-only-image",
    ]);
    expect(
      first.canvasDisplayModels.find(
        (model) => model.id === "gemini-3.1-flash-image-preview-2K",
      ),
    ).toMatchObject({
      metadata: {
        canvasRunnable: false,
        canvasUnavailableReason: "尚无已验证的画布生成协议",
      },
    });
    expect(
      first.canvasDisplayModels.find((model) => model.id === "kling-3.0"),
    ).toMatchObject({
      operations: ["video.generate", "video.image-to-video"],
      metadata: { canvasRunnable: false, catalogCapability: "video" },
    });
    expect(
      first.marketplaceGroup.models.find(
        (model) => model.id === "grok-imagine-image",
      ),
    ).toMatchObject({ priceLabel: "$0.30 / 请求", capability: "image" });
    expect(
      first.marketplaceGroup.models.find(
        (model) => model.id === "gpt-image-2-2K",
      ),
    ).toMatchObject({ priceLabel: "价格以平台为准", capability: "image" });
    expect(
      first.marketplaceGroup.models.find(
        (model) => model.id === "scan-only-image",
      ),
    ).toMatchObject({ priceLabel: "价格以平台为准" });
    expect(first.marketplaceGroup).toMatchObject({
      canvasSupported: true,
      canvasModelCount: 4,
    });

    const afterRemoval = resolveCyberAfeiScannedGroup(catalog, compositeGroup, [
      "grok-imagine-image",
    ]);
    expect(
      afterRemoval.marketplaceGroup.models.map((model) => model.id),
    ).toEqual(["grok-imagine-image"]);
    expect(afterRemoval.canvasModels.map((model) => model.id)).toEqual([
      "grok-imagine-image",
    ]);

    const empty = resolveCyberAfeiScannedGroup(catalog, compositeGroup, []);
    expect(empty.marketplaceGroup.models).toEqual([]);
    expect(empty.canvasModels).toEqual([]);
    expect(empty.canvasDisplayModels).toEqual([]);
    expect(empty.marketplaceGroup).toMatchObject({
      canvasSupported: false,
      canvasModelCount: 0,
    });
  });

  it("keeps scanned models visible but removes a capability denied by the group", () => {
    const catalog = cyberAfeiCatalogFromPricing(payload);
    const resolved = resolveCyberAfeiScannedGroup(
      catalog,
      "gpt5.6-破甲版",
      ["gpt-image-2"],
      {
        capabilityBlocks: [
          {
            capability: "image",
            reason: "group_permission_denied",
            detectedAt: "2026-08-03T03:20:15.860Z",
            providerMessage: "Image generation is not enabled for this group",
            model: "gpt-image-2",
          },
        ],
      },
    );

    expect(resolved.canvasModels).toEqual([]);
    expect(resolved.canvasDisplayModels).toMatchObject([
      {
        id: "gpt-image-2",
        metadata: {
          canvasRunnable: false,
          canvasUnavailableReason: "当前分组未开通图片生成（已确认上游 403）",
        },
      },
    ]);
    expect(resolved.marketplaceGroup).toMatchObject({
      canvasSupported: false,
      canvasModelCount: 0,
      models: [
        {
          id: "gpt-image-2",
          canvasRunnable: false,
          canvasUnavailableReason: "当前分组未开通图片生成（已确认上游 403）",
        },
      ],
    });
  });

  it("returns an unavailable empty catalog on pricing failure instead of stale models", async () => {
    const liveFetch = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const failedFetch = vi.fn(
      async () => new Response("unavailable", { status: 503 }),
    ) as unknown as typeof fetch;

    const live = await loadCyberAfeiCatalog({ force: true, fetch: liveFetch });
    expect(live.source).toBe("live");
    expect(live.marketplaceGroups.length).toBeGreaterThan(0);

    const unavailable = await loadCyberAfeiCatalog({
      force: true,
      fetch: failedFetch,
    });
    expect(unavailable).toMatchObject({
      source: "unavailable",
      groups: {},
      marketplaceGroups: [],
    });
  });

  it("publishes only models with a verified canvas protocol in each marketplace group", () => {
    const catalog = cyberAfeiCatalogFromPricing(payload);

    expect(catalog.source).toBe("live");
    expect(catalog.groups[imageGroup]?.map((model) => model.id)).toEqual([
      "gpt-image-2",
      "gpt-image-4K",
      "gpt-image-2-2K",
      "gpt-image-2-4K",
    ]);
    expect(catalog.groups[videoGroup]?.map((model) => model.id)).toEqual([
      "video-v1-10s",
    ]);
    expect(catalog.groups[compositeGroup]?.map((model) => model.id)).toEqual([
      "gemini-3.1-flash-image-preview",
      "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image-1k",
      "gemini-3.1-flash-image-2k",
      "gemini-3.1-flash-image-4k",
      "grok-imagine-video-1.5-720p",
      "grok-imagine-video-1.5",
      "grok-imagine-无限",
      "grok-imagine-image",
      "grok-imagine-image-quality",
    ]);
    expect(
      catalog.groups[compositeGroup]?.map((model) => model.id),
    ).not.toEqual(
      expect.arrayContaining([
        "gemini-3.1-flash-image-preview-2K",
        "gemini-3.1-flash-image-preview-4K",
        "nano-banana-pro",
      ]),
    );
    expect(catalog.groups["gpt5.6-破甲版"]?.map((model) => model.id)).toEqual([
      "gpt-image-2",
    ]);

    expect(
      catalog.marketplaceGroups.find((group) => group.id === imageGroup),
    ).toMatchObject({ canvasSupported: true, canvasModelCount: 4 });
    expect(
      catalog.marketplaceGroups.find((group) => group.id === compositeGroup),
    ).toMatchObject({ canvasSupported: true, canvasModelCount: 10 });
    expect(
      catalog.marketplaceGroups.find((group) => group.id === "gpt5.6-破甲版"),
    ).toMatchObject({ canvasSupported: true, canvasModelCount: 1 });
    expect(
      catalog.marketplaceGroups
        .find((group) => group.id === imageGroup)
        ?.models.map((model) => model.id),
    ).toEqual([
      "gpt-image-2",
      "gpt-image-2-2K",
      "gpt-image-2-4K",
      "gpt-image-4K",
    ]);
    expect(
      catalog.marketplaceGroups
        .find((group) => group.id === compositeGroup)
        ?.models.find((model) => model.id === "nano-banana-pro"),
    ).toMatchObject({ priceLabel: "$0.975 / 请求", endpointTypes: ["openai"] });
    expect(
      catalog.marketplaceGroups
        .find((group) => group.id === compositeGroup)
        ?.models.find((model) => model.id === "grok-imagine-无限"),
    ).toMatchObject({ capability: "image", priceLabel: "$1 / 请求" });
  });

  it("uses the official Image-2 and Gemini size parameters", () => {
    const catalog = cyberAfeiCatalogFromPricing(payload);
    const image4K = catalog.groups[imageGroup]?.find(
      (model) => model.id === "gpt-image-4K",
    );
    const imageSize = image4K?.parameters?.find(
      (parameter) => parameter.key === "size",
    );

    expect(image4K?.name).toBe("gpt-image-4K · $0.35 / 请求");
    expect(imageSize).toMatchObject({
      control: "dimensions",
      default: "3840x2160",
      min: 16,
      max: 3840,
      step: 16,
    });
    expect(imageSize?.options).toHaveLength(14);
    expect(imageSize?.options).toEqual(
      expect.arrayContaining([
        { label: "自动（提示词优先，其次参考图）", value: "auto" },
        {
          label: "纸张 3:4 自定义 · 2096×2800（16 像素对齐）",
          value: "2096x2800",
        },
        {
          label: "纸张 A4/A3 竖版·接口上限 · 2416×3424（按最大像素约束校正）",
          value: "2416x3424",
        },
      ]),
    );
    expect(image4K?.metadata).toMatchObject({
      documentedOutputSizes: [
        "2160x2160",
        "3840x2160",
        "2160x3840",
        "2880x2160",
        "2160x2880",
        "3248x2160",
        "2160x3248",
        "3840x1648",
      ],
      observedOutputSizes: {
        "2160x2160": "2160x2160",
        "3840x2160": "3840x2160",
        "2160x3840": "2160x3840",
        "2880x2160": "2880x2160",
        "2160x2880": "1086x1448",
        "3240x2160": "1536x1024",
        "2160x3240": "2160x3248",
        "3840x1646": "3840x1648",
        "2100x2970": "2096x2976",
        "2480x3508": "2416x3424",
        "3508x4961": "2416x3424",
        "3840x2715": "3424x2416",
      },
      unconfirmedSizes: ["2715x3840"],
      sizeBehavior: "provider-may-normalize",
    });
    expect(image4K?.metadata).not.toHaveProperty("fixedOutputSize");
    expect(
      image4K?.parameters?.find((parameter) => parameter.key === "quality")
        ?.options,
    ).toEqual([
      { label: "自动", value: "auto" },
      { label: "低", value: "low" },
      { label: "中", value: "medium" },
      { label: "高", value: "high" },
    ]);
    const image2K = catalog.groups[imageGroup]?.find(
      (model) => model.id === "gpt-image-2-2K",
    );
    expect(image2K).toMatchObject({
      metadata: {
        defaultOutputSize: "2048x1152",
        unconfirmedSizes: ["2048x2048"],
        observedOutputSizes: {
          "2048x1152": "2048x1152",
          "1152x2048": "1152x2048",
          "2048x1536": "2048x1536",
          "1536x2048": "1536x2048",
          "2048x1360": "2048x1360",
          "1360x2048": "1360x2048",
          "2688x1152": "2688x1152",
        },
      },
    });
    expect(image2K?.metadata).not.toHaveProperty("fixedOutputSize");
    expect(
      image2K?.parameters?.find((parameter) => parameter.key === "size"),
    ).toMatchObject({
      control: "select",
      default: "2048x1152",
      options: [
        {
          label: "2K 1:1 · 2048×2048（本次网络异常，未确认）",
          value: "2048x2048",
        },
        { label: "2K 16:9 · 2048×1152（实测精确）", value: "2048x1152" },
        { label: "2K 9:16 · 1152×2048（实测精确）", value: "1152x2048" },
        { label: "2K 4:3 · 2048×1536（实测精确）", value: "2048x1536" },
        { label: "2K 3:4 · 1536×2048（实测精确）", value: "1536x2048" },
        { label: "2K 3:2 · 2048×1360（实测精确）", value: "2048x1360" },
        { label: "2K 2:3 · 1360×2048（实测精确）", value: "1360x2048" },
        { label: "2K 21:9 · 2688×1152（实测精确）", value: "2688x1152" },
      ],
    });
    const image2Alias4K = catalog.groups[imageGroup]?.find(
      (model) => model.id === "gpt-image-2-4K",
    );
    expect(
      image2Alias4K?.parameters?.find((parameter) => parameter.key === "size"),
    ).toMatchObject({
      control: "dimensions",
      default: "3840x2160",
      min: 16,
      max: 3840,
      step: 16,
    });
    expect(
      image2Alias4K?.parameters?.find((parameter) => parameter.key === "size")
        ?.options,
    ).toHaveLength(14);
    expect(
      image2Alias4K?.parameters?.find((parameter) => parameter.key === "size")
        ?.options,
    ).toEqual(
      expect.arrayContaining([
        { label: "自动（提示词优先，其次参考图）", value: "auto" },
        {
          label: "纸张 A 系列自定义 · 2096×2976（16 像素对齐）",
          value: "2096x2976",
        },
        {
          label: "纸张 A4/A3 竖版·接口上限 · 2416×3424（按最大像素约束校正）",
          value: "2416x3424",
        },
      ]),
    );
    expect(image2Alias4K?.metadata).toMatchObject({
      defaultOutputSize: "3840x2160",
      referenceEditEndpoint: "/v1/images/edits",
      referenceEditVerifiedAt: "2026-08-04",
      observedOutputSizes: {
        "2160x2880": "2160x2880",
        "3240x2160": "3248x2160",
        "2100x2800": "2096x2800",
        "2100x2970": "2096x2976",
        "2480x3508": "2416x3424",
        "3508x4961": "2416x3424",
        "2715x3840": "1054x1492",
        "3840x2715": "3424x2416",
      },
    });
    expect(image2Alias4K).toMatchObject({
      operations: ["image.generate", "image.edit"],
      limits: { maxInputImages: 16 },
    });
    expect(image2Alias4K?.metadata).not.toHaveProperty("fixedOutputSize");
    const regularImage2 = catalog.groups[imageGroup]?.find(
      (model) => model.id === "gpt-image-2",
    );
    expect(
      regularImage2?.parameters?.find((parameter) => parameter.key === "size"),
    ).toMatchObject({
      control: "dimensions",
      default: "1024x1024",
    });
    expect(
      regularImage2?.parameters?.find((parameter) => parameter.key === "size")
        ?.options,
    ).toHaveLength(17);
    expect(regularImage2?.metadata).toMatchObject({
      unconfirmedSizes: ["2160x2160"],
      observedOutputSizes: {
        "2048x2048": "1254x1254",
        "3840x2160": "1672x941",
      },
    });

    const flash = catalog.groups[compositeGroup]?.find(
      (model) => model.id === "gemini-3.1-flash-image-preview",
    );
    const ratios = flash?.parameters?.find(
      (parameter) => parameter.key === "aspectRatio",
    );
    expect(ratios?.default).toBe("auto");
    expect(ratios?.options).toHaveLength(15);
    expect(ratios?.options).toEqual(
      expect.arrayContaining([
        { label: "自动（图生图时跟随参考图）", value: "auto" },
        {
          label: "16:9 · 1K / 2K / 4K：1376×768 / 2752×1536 / 5504×3072",
          value: "16:9",
        },
        {
          label: "8:1 · 1K / 2K / 4K：2928×352 / 5856×704 / 11712×1408",
          value: "8:1",
        },
      ]),
    );
    expect(
      flash?.parameters?.find((parameter) => parameter.key === "imageSize"),
    ).toMatchObject({
      default: "4K",
      options: [
        { label: "自动（默认 4K）", value: "auto" },
        { label: "1K", value: "1K" },
        { label: "2K", value: "2K" },
        { label: "4K", value: "4K" },
      ],
    });

    const fixed4K = catalog.groups[compositeGroup]?.find(
      (model) => model.id === "gemini-3.1-flash-image-4k",
    );
    expect(fixed4K).toMatchObject({
      operations: ["image.generate"],
      metadata: {
        protocol: "gemini-native",
        fixedImageSize: "4K",
        sizeBehavior: "fixed-tier",
      },
      limits: { maxInputImages: 0 },
    });
    expect(
      fixed4K?.parameters?.find((parameter) => parameter.key === "imageSize"),
    ).toMatchObject({
      default: "4K",
      options: [{ label: "4K（型号固定）", value: "4K" }],
    });
    expect(
      fixed4K?.parameters?.find((parameter) => parameter.key === "aspectRatio")
        ?.options,
    ).toEqual(
      expect.arrayContaining([
        { label: "16:9 · 4K：5504×3072", value: "16:9" },
      ]),
    );

    const grokUnlimited = catalog.groups[compositeGroup]?.find(
      (model) => model.id === "grok-imagine-无限",
    );
    expect(
      grokUnlimited?.parameters?.find((parameter) => parameter.key === "size"),
    ).toMatchObject({ control: "dimensions", default: "1024x1024" });
    expect(
      catalog.groups[compositeGroup]?.find(
        (model) => model.id === "grok-imagine-image-quality",
      )?.parameters,
    ).toEqual([]);
    expect(
      catalog.groups[compositeGroup]?.find(
        (model) => model.id === "grok-imagine-image",
      )?.parameters,
    ).toEqual([]);
  });

  it("builds the documented endpoints and request mappings", () => {
    const catalog = cyberAfeiCatalogFromPricing(payload);
    const imageModels = catalog.groups[imageGroup] ?? [];
    const videoModels = catalog.groups[videoGroup] ?? [];
    const compositeModels = catalog.groups[compositeGroup] ?? [];
    const connector = cyberAfeiConnectorForModels([
      ...imageModels,
      ...videoModels,
      ...compositeModels,
    ]);

    expect(CYBERAFEI_BASE_URL).toBe("https://api.3365api.cn");
    expect(CYBERAFEI_API_BASE_URL).toBe("https://api.3365api.cn/v1");
    expect(connector.submit.path).toBe("/v1/images/generations");
    expect(connector.modelOverrides?.["video-v1-10s"]?.submit?.path).toBe(
      "/v1/video/generations",
    );
    expect(
      connector.modelOverrides?.["video-v1-10s"]?.poll?.response
        ?.statusFallbackPaths,
    ).toEqual(["$.data.status"]);
    expect(
      connector.modelOverrides?.["gemini-3.1-flash-image-preview"]?.submit
        ?.path,
    ).toBe("/v1beta/models/gemini-3.1-flash-image-preview:generateContent");
    expect(
      connector.modelOverrides?.["gemini-3.1-flash-image-preview"]?.submit
        ?.template,
    ).toMatchObject({ generationConfig: { responseModalities: ["IMAGE"] } });
    expect(
      connector.modelOverrides?.[
        "gemini-3.1-flash-image-preview"
      ]?.submit?.mappings?.filter((mapping) =>
        mapping.target.startsWith("/generationConfig/imageConfig/"),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "/generationConfig/imageConfig/aspectRatio",
          omitValues: ["auto"],
        }),
        expect.objectContaining({
          target: "/generationConfig/imageConfig/imageSize",
          omitValues: ["auto"],
        }),
      ]),
    );
    expect(
      connector.modelOverrides?.["gemini-3.1-flash-image-preview"]?.output
        ?.base64FallbackPaths,
    ).toEqual(["inlineData.data", "text"]);
    expect(
      connector.modelOverrides?.["gemini-3.1-flash-image-4k"]?.submit?.path,
    ).toBe("/v1beta/models/gemini-3.1-flash-image-4k:generateContent");
    expect(
      connector.modelOverrides?.["gemini-3.1-flash-image-4k"]?.submit?.template,
    ).toMatchObject({
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { imageSize: "4K" },
      },
    });
    expect(
      connector.modelOverrides?.[
        "gemini-3.1-flash-image-4k"
      ]?.submit?.mappings?.some(
        (mapping) =>
          mapping.target === "/generationConfig/imageConfig/imageSize",
      ),
    ).toBe(false);
    expect(
      connector.modelOverrides?.["grok-imagine-无限"]?.submit?.mappings?.map(
        (mapping) => mapping.target,
      ),
    ).toEqual(["/model", "/prompt", "/size"]);
    expect(
      connector.modelOverrides?.[
        "grok-imagine-image-quality"
      ]?.submit?.mappings?.map((mapping) => mapping.target),
    ).toEqual(["/model", "/prompt"]);
    expect(
      connector.modelOverrides?.["grok-imagine-image"]?.submit?.mappings?.map(
        (mapping) => mapping.target,
      ),
    ).toEqual(["/model", "/prompt"]);
    expect(
      connector.modelOverrides?.["grok-imagine-video-1.5-720p"],
    ).toMatchObject({
      submit: { path: "/v1/videos/generations" },
      poll: { path: "/v1/videos/{taskId}" },
    });
    expect(
      connector.modelOverrides?.["gpt-image-2-4K"]?.operationOverrides?.[
        "image.edit"
      ]?.submit,
    ).toMatchObject({
      path: "/v1/images/edits",
      method: "POST",
      bodyMode: "multipart",
    });
    expect(
      connector.modelOverrides?.["gpt-image-2-4K"]?.operationOverrides?.[
        "image.edit"
      ]?.submit?.mappings?.map((mapping) => mapping.target),
    ).toEqual([
      "/model",
      "/prompt",
      "/size",
      "/quality",
      "/n",
      "/response_format",
      "/image[]",
    ]);
    expect(
      connector.modelOverrides?.["gpt-image-2-4K"]?.operationOverrides?.[
        "image.edit"
      ]?.submit?.mappings?.find(
        (mapping) => mapping.target === "/response_format",
      )?.source,
    ).toEqual({ kind: "literal", value: "url" });
    expect(
      connector.modelOverrides?.["gpt-image-2-4K"]?.operationOverrides?.[
        "image.edit"
      ]?.submit?.mappings?.at(-1)?.source,
    ).toMatchObject({ kind: "assets", assetKind: "image", select: "all" });
    expect(connector.models?.map((model) => model.id)).toEqual(
      expect.arrayContaining(["gpt-image-2-2K", "gpt-image-2-4K"]),
    );
    expect(cyberAfeiDefaultModelForGroup(compositeGroup, compositeModels)).toBe(
      "gemini-3.1-flash-image-preview",
    );
    expect(cyberAfeiDefaultModelForGroup(imageGroup, imageModels)).toBe(
      "gpt-image-4K",
    );
  });
});

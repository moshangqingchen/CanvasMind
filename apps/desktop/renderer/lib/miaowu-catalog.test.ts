import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MIAOWU_CONNECTOR, MIAOWU_MODELS } from "./miaowu-presets";
import {
  MIAOWU_CATALOG_SOURCE,
  loadMiaowuCatalog,
  miaowuCatalogFromPricing,
  miaowuConnectorForModels,
  miaowuDefaultModel,
  miaowuModelsForGroup,
} from "./miaowu-catalog";
import { modelPriceAmount } from "@super-canvas/providers";

// Public /api/pricing captured at 2026-10-08T14:33:14Z. Its generic
// `openai` endpoint label is not the declared image/video output contract.
const CURRENT_PUBLIC_FIXTURE = JSON.parse(readFileSync(new URL("./miaowu-catalog-20261008.fixture.json", import.meta.url), "utf8"));

it("retains all eighteen exact public media models and their native contracts despite a generic chat endpoint label", () => {
  const catalog = miaowuCatalogFromPricing(CURRENT_PUBLIC_FIXTURE);
  expect(catalog.models.map(model => model.id)).toEqual([
    "dola-seedance-2.5", "seedance-2.0-mini-deal", "jimeng-seedance-2.5", "minimax-h3-max",
    "gpt-image-2.5-flare", "doubao-seedance-2.0-fast", "seedream-5-0-pro", "sora-2", "minimax-h3",
    "doubao-seedance-2.5", "GPT-image-2", "Image-nano-banana-pro", "wan3.0-video", "gpt-image-2.5-sunburs",
    "Image-nano-banana-2", "dola-seedance-2.0-fast", "Image-nano-banana", "seedance-2.0-deal",
  ]);
  expect(catalog.models.filter(model => model.outputKinds?.includes("video"))).toHaveLength(11);
  expect(catalog.models.filter(model => model.outputKinds?.includes("image"))).toHaveLength(7);
  const connector = miaowuConnectorForModels(catalog.models);
  for (const model of catalog.models) {
    expect(model.pricing).toMatchObject({ currency: "CNY", confidence: "exact", sourceUrl: MIAOWU_CATALOG_SOURCE });
    expect(model.parameters?.length).toBeGreaterThan(0);
    const image = model.outputKinds?.includes("image");
    expect(model.operations.every(operation => operation.startsWith(image ? "image." : "video."))).toBe(true);
    expect(model.metadata?.parameterSource).toBe(image ? "pricing.image_api" : "pricing.video_api");
    expect(connector.modelOverrides?.[model.id]?.submit?.path ?? connector.submit.path).toBe(image ? "/v1/images" : "/v1/videos");
  }
  const mini = catalog.models.find(model => model.id === "seedance-2.0-mini-deal")!;
  expect(mini.parameters?.find(parameter => parameter.key === "duration")?.constraints).toEqual([
    { when: [{ parameter: "resolution", values: ["720p"] }], max: 12 },
  ]);
});

it("preserves current fractional request and second prices instead of rounding them to cents", () => {
  const catalog = miaowuCatalogFromPricing(CURRENT_PUBLIC_FIXTURE);
  const models = new Map(catalog.models.map(model => [model.id, model]));
  for (const [id, label] of [
    ["dola-seedance-2.5", "¥0.875/次"], ["dola-seedance-2.0-fast", "¥0.875/次"],
    ["doubao-seedance-2.0-fast", "¥2.5/次"], ["doubao-seedance-2.5", "¥6.25/次"],
    ["seedance-2.0-deal", "¥3.125/次"], ["minimax-h3", "¥0.0625/秒"],
    ["wan3.0-video", "¥0.195–0.65/秒"], ["gpt-image-2.5-flare", "¥0.04–0.2/次"],
    ["GPT-image-2", "¥0.05/次"],
  ]) {
    expect(models.get(id!)?.metadata?.priceLabel).toBe(label);
    expect(models.get(id!)?.name).toBe(`${id}（${label}）`);
  }
  expect(modelPriceAmount(models.get("dola-seedance-2.5")!.pricing!, { resolution: "720p", duration: 30 })).toBe(.875);
  expect(models.get("minimax-h3")!.pricing!.kind).toBe("per-second");
  expect(modelPriceAmount(models.get("minimax-h3")!.pricing!, { resolution: "720p" })).toBe(.0625);
  expect(modelPriceAmount(models.get("wan3.0-video")!.pricing!, { resolution: "480p" })).toBe(.195);
});

it("matches every current media model's own public enums, durations, reference limits and wire fields", () => {
  const catalog = miaowuCatalogFromPricing(CURRENT_PUBLIC_FIXTURE);
  for (const model of catalog.models) {
    const row = CURRENT_PUBLIC_FIXTURE.data.find((item: { model_name: string }) => item.model_name === model.id)!;
    const image = model.outputKinds?.includes("image");
    const contract = image ? row.image_api : row.video_api;
    expect(model.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(contract.sizes);
    expect(model.parameters?.find(parameter => parameter.key === "aspect_ratio")?.options?.map(option => option.value)).toEqual(contract.ratios);
    expect(model.limits).toMatchObject({ maxInputImages: contract.images_max ?? 0,
      maxInputVideos: image ? 0 : contract.videos_max ?? 0, maxInputAudios: image ? 0 : contract.audios_max ?? 0 });
    expect(model.metadata?.remoteMediaUrlsOnly).toBe(true);
    expect(model.parameters?.some(parameter => ["seed", "watermark", "generate_audio"].includes(parameter.key))).toBe(false);
    if (image) {
      expect(model.parameters?.some(parameter => parameter.key === "duration")).toBe(false);
      expect(model.operations).toEqual(["image.generate", "image.edit"]);
    } else {
      const duration = model.parameters?.find(parameter => parameter.key === "duration");
      if (contract.seconds_options?.length) {
        expect(duration?.control).toBe("select");
        expect(duration?.options?.map(option => option.value)).toEqual(contract.seconds_options.map(Number));
      } else {
        expect(duration).toMatchObject({ min: contract.seconds_min, max: contract.seconds_max, step: 1 });
      }
      expect(model.metadata?.videoWireFields).toEqual(["model", "prompt", "seconds", "ratio", "resolution",
        ...(contract.images_max ? ["image_urls"] : []), ...(contract.videos_max ? ["video_urls"] : []), ...(contract.audios_max ? ["audio_urls"] : [])]);
      expect(model.metadata?.supportsFirstLastFrames).toBe(false);
    }
  }
});

it("applies a declared group ratio once to every resolution tier as well as the headline price", () => {
  const fixture = structuredClone(CURRENT_PUBLIC_FIXTURE);
  // Synthetic alternate-group ratio; the real anonymous response exposes only default=1.
  fixture.group_ratio.vip = .8;
  const catalog = miaowuCatalogFromPricing(fixture);
  const repriced = miaowuModelsForGroup(catalog, "vip");
  const flare = repriced.find(model => model.id === "gpt-image-2.5-flare")!;
  expect(flare.pricing?.unitAmount).toBe(.16);
  expect(flare.metadata?.pricingGroupRatio).toBe(.8);
  expect(modelPriceAmount(flare.pricing!, { resolution: "1080p" })).toBe(.032);
  expect(modelPriceAmount(flare.pricing!, { resolution: "4K" })).toBe(.16);
  const jimeng = repriced.find(model => model.id === "jimeng-seedance-2.5")!;
  expect(jimeng.pricing!.kind).toBe("per-second");
  expect(modelPriceAmount(jimeng.pricing!, { resolution: "480p" })).toBe(.5);
  expect(modelPriceAmount(jimeng.pricing!, { resolution: "720p" })).toBe(.6);
  const rescope = miaowuModelsForGroup({ ...catalog, models: repriced }, "vip");
  expect(rescope.find(model => model.id === flare.id)?.pricing).toEqual(flare.pricing);
  expect(catalog.models.find(model => model.id === flare.id)?.pricing?.unitAmount).toBe(.2);
});

it("uses October per-call rules, audio limits, aspect ratios and discrete Sora seconds", () => {
  const catalog = miaowuCatalogFromPricing({ group_ratio: { default: 1 }, data: [
    { model_name: "seedance-2.0-deal", model_price: .2857142857, enable_groups: ["default"], video_api: { images_max: 9, audios_max: 3, seconds_min: 4, seconds_max: 15, sizes: ["720p"], ratios: ["16:9", "9:16", "4:3", "3:4", "21:9", "1:1"], pricing: { unit: "per_call", rules: [{ size: "720p", price: .44642857142857145 }] } } },
    { model_name: "seedance-2.5-pro", enable_groups: ["default"], video_api: { images_max: 30, audios_max: 10, seconds_min: 4, seconds_max: 30, sizes: ["480p", "720p"], pricing: { unit: "per_call", rules: [{ size: "480p", price: .8571428571428571 }, { size: "720p", price: 1.4285714285714286 }] } } },
    { model_name: "sora-2", model_price: 1 / 7, enable_groups: ["default"], video_api: { images_max: 1, seconds_options: ["8"], sizes: ["720p"], ratios: ["16:9", "9:16"], pricing: { unit: "per_call" } } },
  ] });
  const models = new Map(catalog.models.map(m => [m.id, m]));
  const deal = models.get("seedance-2.0-deal")!;
  expect(deal.pricing).toMatchObject({ kind: "per-request", currency: "CNY", unitAmount: 3.125, billingUnit: "request" });
  expect(deal.limits?.maxInputAudios).toBe(3);
  expect(deal.parameters?.find(p => p.key === "aspect_ratio")?.options).toHaveLength(6);
  const pro = models.get("seedance-2.5-pro")!;
  expect(pro.limits).toMatchObject({ maxInputImages: 30, maxInputAudios: 10 });
  expect(modelPriceAmount(pro.pricing!, { resolution: "480p", duration: 30 })).toBe(6);
  expect(modelPriceAmount(pro.pricing!, { resolution: "720p", duration: 4 })).toBe(10);
  expect(models.get("sora-2")?.parameters?.find(p => p.key === "duration")).toMatchObject({ control: "select", default: 8, options: [{ label: "8 秒", value: 8 }] });
});

/**
 * Trimmed from the verbatim 2026-08-28 probe of
 * https://api.miaowuai.store/api/pricing (.codex-temp/probe/miaowu.json);
 * "seedance-2.0v" is a synthetic vip-only record for group/ratio coverage.
 */
const FIXTURE = {
  auto_groups: ["default"],
  group_ratio: { default: 1, vip: 0.8 },
  usable_group: { default: "默认分组", vip: "" },
  success: true,
  data: [
    {
      model_name: "seedance-2.0-mini",
      description: "933  不卡人脸  480p，可以出720p的，但是720p最高只能12s",
      quota_type: 1,
      model_ratio: 0,
      model_price: 0.1142857142857143,
      completion_ratio: 0,
      enable_groups: ["default", "vip"],
      supported_endpoint_types: ["openai"],
      video_api: {
        modes: ["multi-ref-to-video"],
        images_max: 9,
        videos_max: 3,
        audios_max: 3,
        seconds_min: 5,
        seconds_max: 15,
        sizes: ["480p", "720p"],
        ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        pricing: { unit: "per_call" },
      },
    },
    {
      model_name: "seedance-2.0-pro",
      description: "adobe的，没有加很多牛，933不卡脸",
      quota_type: 1,
      model_ratio: 0,
      model_price: 0.2857142857142857,
      completion_ratio: 0,
      enable_groups: ["default", "vip"],
      supported_endpoint_types: ["openai"],
      video_api: {
        modes: ["multi-ref-to-video"],
        images_max: 9,
        videos_max: 3,
        audios_max: 3,
        seconds_min: 4,
        seconds_max: 15,
        sizes: ["720p", "720p"],
        ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "16:9"],
        pricing: { unit: "per_call" },
      },
    },
    {
      model_name: "minimax-h3",
      description: "官方720p，垫视频的话选择720p的，最高13s  ",
      quota_type: 1,
      model_ratio: 0,
      model_price: 0.017142857142857144,
      completion_ratio: 0,
      enable_groups: ["default", "vip"],
      supported_endpoint_types: ["openai"],
      video_api: {
        modes: ["multi-ref-to-video"],
        images_max: 9,
        audios_max: 3,
        seconds_min: 4,
        seconds_max: 15,
        sizes: ["720p"],
        ratios: ["9:16", "16:9", "4:3", "3:4", "1:1"],
        pricing: {
          unit: "per_second",
          rules: [{ price: 0.017142857142857144 }],
        },
      },
    },
    {
      model_name: "wan3.0-video-480p",
      description: "通义万相 3.0 480P，2-30 秒，支持首帧图，按秒计费",
      quota_type: 0,
      model_ratio: 37.5,
      model_price: 0,
      completion_ratio: 1,
      enable_groups: ["default", "vip"],
      supported_endpoint_types: ["openai"],
      video_api: {
        modes: ["multi-ref-to-video"],
        images_max: 10,
        videos_max: 5,
        audios_max: 5,
        seconds_min: 2,
        seconds_max: 30,
        sizes: ["480p"],
        ratios: ["9:16", "16:9", "4:3", "3:4", "1:1"],
        pricing: {
          unit: "per_second",
          rules: [{ price: 0.05714285714285715 }],
        },
      },
    },
    {
      model_name: "kling-3.0-omni",
      quota_type: 1,
      model_ratio: 0,
      model_price: 0.014285714285714287,
      completion_ratio: 0,
      enable_groups: ["default", "vip"],
      supported_endpoint_types: ["openai"],
      video_api: {
        modes: ["multi-ref-to-video"],
        images_max: 3,
        seconds_min: 5,
        seconds_max: 15,
        sizes: ["720p"],
        ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        pricing: { unit: "per_second" },
      },
    },
    {
      model_name: "seedance-2.0v",
      quota_type: 1,
      model_ratio: 0,
      model_price: 0.625,
      completion_ratio: 0,
      enable_groups: ["vip"],
      supported_endpoint_types: ["openai"],
    },
  ],
};

function resetCatalogCache() {
  delete (globalThis as Record<string, unknown>).__superCanvasMiaowuCatalog;
}

function okFetch(payload: unknown = FIXTURE) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("miaowuCatalogFromPricing", () => {
  it("preserves the documented image_api media type and native single-image parameters", () => {
    const snapshot = miaowuCatalogFromPricing({ group_ratio: { default: 1 }, data: [{
      model_name: "GPT-image-2", quota_type: 0, model_price: 0.02, enable_groups: ["default"],
      image_api: { modes: ["text-to-image", "image-to-image"], images_max: 5,
        sizes: ["1080p"], ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        pricing: { unit: "per_call", rules: [{ size: "1080p", price: 0.02 }] } },
    }, { model_name: "gpt-image-2.5-sunburs", quota_type: 1, enable_groups: ["default"],
      image_api: { modes: ["text-to-image", "image-to-image"], images_max: 5,
        sizes: ["1080p", "2K", "4K"], ratios: ["16:9"] },
    }] });
    expect(snapshot.marketplaceModels.map(model => model.capability)).toEqual(["image", "image"]);
    const model = snapshot.models[0]!;
    expect(model).toMatchObject({ id: "GPT-image-2", operations: ["image.generate", "image.edit"],
      outputKinds: ["image"], inputKinds: ["text", "image", "image[]"], limits: { maxInputImages: 5 },
      pricing: { kind: "per-request", currency: "CNY", unitAmount: 0.14 },
      metadata: { parameterSource: "pricing.image_api", imageNativeResolutionOptions: true, imageNativeRatioOptions: true } });
    expect(model.parameters?.map(parameter => parameter.key)).toEqual(["resolution", "aspect_ratio"]);
    expect(model.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["1080p"]);
    expect(snapshot.models[1]?.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["1080p", "2K", "4K"]);
    const connector = miaowuConnectorForModels(snapshot.models);
    expect(connector.modelOverrides?.[model.id]).toMatchObject({ submit: { path: "/v1/images" },
      poll: { path: "/v1/images/{taskId}" }, output: { kind: "image", contentFallback: { path: "/v1/images/{taskId}/content" } } });
    expect(connector.modelOverrides?.[model.id]?.submit?.mappings?.map(mapping => mapping.target)).toEqual(["/model", "/prompt", "/ratio", "/resolution", "/image_urls"]);
  });

  it("uses the live size_seconds_max contract for per-resolution video duration limits", () => {
    const snapshot = miaowuCatalogFromPricing({ data: [{ model_name: "wan3.0-vedio-deal",
      video_api: { modes: ["text-to-video"], sizes: ["720p", "1080p"], seconds_min: 2, seconds_max: 30,
        size_seconds_max: { "720p": 10, "1080p": 15 }, ratios: ["16:9"] } }] });
    expect(snapshot.models[0]?.metadata?.durationMaxByResolution).toEqual({ "720p": 10, "1080p": 15 });
  });
  const snapshot = miaowuCatalogFromPricing(FIXTURE);
  const byId = new Map(snapshot.models.map((model) => [model.id, model]));

  it("parses the fixture into a live snapshot", () => {
    expect(snapshot.source).toBe("live");
    expect(snapshot.models).toHaveLength(6);
    expect(snapshot.marketplaceModels).toHaveLength(6);
    expect([...byId.keys()]).toEqual([
      "seedance-2.0-mini",
      "seedance-2.0-pro",
      "minimax-h3",
      "wan3.0-video-480p",
      "kling-3.0-omni",
      "seedance-2.0v",
    ]);
    expect(Date.parse(snapshot.checkedAt)).not.toBeNaN();
  });

  it("converts quota prices at the ×7 rate and trims trailing zeros", () => {
    expect(byId.get("seedance-2.0-mini")?.name).toBe(
      "seedance-2.0-mini（¥0.8/次）",
    );
    expect(byId.get("seedance-2.0-pro")?.name).toBe(
      "seedance-2.0-pro（¥2/次）",
    );
    expect(byId.get("minimax-h3")?.metadata?.priceLabel).toBe("¥0.12/秒");
    expect(byId.get("minimax-h3")?.metadata?.billingLabel).toBe("按秒计费");
    expect(byId.get("minimax-h3")?.metadata?.pricingCheckedAt).toBe(
      snapshot.checkedAt,
    );
  });

  it("uses per-second rule prices instead of treating them as per-call", () => {
    const model = byId.get("wan3.0-video-480p")!;
    expect(model.name).toBe("wan3.0-video-480p（¥0.4/秒）");
    expect(model.metadata?.priceLabel).toBe("¥0.4/秒");
    expect(model.metadata?.billingLabel).toBe("按秒计费");
  });

  it("honors a per-second video unit even when quota_type is fixed-price", () => {
    const model = byId.get("kling-3.0-omni")!;
    expect(model.name).toBe("kling-3.0-omni（¥0.1/秒）");
    expect(model.metadata?.billingLabel).toBe("按秒计费");
  });

  it("keeps vip-only video models without inventing parameter controls", () => {
    // 0.625 × 7 × 0.8 = ¥3.5
    const marketplace = snapshot.marketplaceModels.find(
      (item) => item.id === "seedance-2.0v",
    );
    expect(marketplace).toMatchObject({
      capability: "video",
      priceLabel: "¥3.5/次",
      tags: ["vip"],
    });
    expect(byId.get("seedance-2.0v")).toMatchObject({
      parameters: [],
      inputKinds: ["text"],
      outputKinds: ["video"],
      metadata: {
        parameterControlsUnavailable: true,
        parameterSource: "pricing.model-detail",
      },
    });
    expect(byId.get("seedance-2.0-mini")?.metadata?.marketplaceGroup).toBe(
      "default",
    );
  });

  it("maps video_api parameter ranges and media limits", () => {
    const mini = byId.get("seedance-2.0-mini")!;
    expect(
      mini.parameters!.find((parameter) => parameter.key === "duration"),
    ).toMatchObject({ min: 5, max: 15, default: 5 });
    expect(
      mini.parameters!.find((parameter) => parameter.key === "resolution")
        ?.options,
    ).toEqual([
      { label: "480p", value: "480p" },
      { label: "720p", value: "720p" },
    ]);
    expect(mini.metadata).toMatchObject({
      clampNumericParameters: true,
      durationMaxByResolution: { "720p": 12 },
      parameterSource: "pricing.video_api",
    });
    expect(mini.limits).toEqual({
      maxInputImages: 9,
      maxInputVideos: 3,
      maxInputAudios: 3,
    });

    const duration = byId
      .get("minimax-h3")!
      .parameters!.find((parameter) => parameter.key === "duration");
    expect(duration).toMatchObject({ min: 4, max: 15, default: 4 });
    const resolution = byId
      .get("minimax-h3")!
      .parameters!.find((parameter) => parameter.key === "resolution");
    expect(resolution?.default).toBe("720p");
    expect(resolution?.options?.map((option) => option.value)).toEqual([
      "720p",
    ]);

    const pro = byId.get("seedance-2.0-pro")!;
    expect(
      pro
        .parameters!.find((parameter) => parameter.key === "resolution")
        ?.options?.map((option) => option.value),
    ).toEqual(["720p"]);
    expect(
      pro
        .parameters!.find((parameter) => parameter.key === "aspect_ratio")
        ?.options?.map((option) => option.value),
    ).toEqual(["1:1", "16:9", "9:16", "4:3", "3:4"]);

    const wan = byId.get("wan3.0-video-480p")!;
    expect(
      wan.parameters!.find((parameter) => parameter.key === "duration"),
    ).toMatchObject({ min: 2, max: 30 });
    expect(
      wan.parameters!.find((parameter) => parameter.key === "resolution")
        ?.options,
    ).toEqual([{ label: "480p", value: "480p" }]);
    expect(wan.inputKinds).toEqual([
      "text",
      "image",
      "image[]",
      "video",
      "video[]",
      "audio",
      "audio[]",
    ]);
    expect(wan.limits).toEqual({
      maxInputImages: 10,
      maxInputVideos: 5,
      maxInputAudios: 5,
    });
  });

  it("uses each video_api model's own supported controls", () => {
    const model = byId.get("kling-3.0-omni")!;
    expect(
      model.parameters!.find((parameter) => parameter.key === "duration"),
    ).toMatchObject({ min: 5, max: 15, default: 5 });
    const resolution = model.parameters!.find(
      (parameter) => parameter.key === "resolution",
    );
    expect(resolution?.default).toBe("720p");
    expect(resolution?.options?.map((option) => option.value)).toEqual([
      "720p",
    ]);
    expect(model.description).toBe("喵呜模型广场的按次计费视频模型。");
    expect(model.inputKinds).toEqual(["text", "image", "image[]"]);
    expect(model.limits).toEqual({
      maxInputImages: 3,
      maxInputVideos: 0,
      maxInputAudios: 0,
    });
    expect(model.metadata).toMatchObject({
      modality: "video",
      remoteMediaUrlsOnly: true,
      supportsFirstLastFrames: false,
      clampNumericParameters: true,
    });
  });

  it("keeps models without video_api as unparameterized video descriptors", () => {
    const catalog = miaowuCatalogFromPricing({
      group_ratio: { default: 1, vip: 0.8 },
      data: [
        {
          model_name: "seedance-2.0-min",
          model_price: 0.17142857142857143,
          quota_type: 1,
          enable_groups: ["vip", "default"],
          supported_endpoint_types: ["openai"],
        },
      ],
    });
    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]).toMatchObject({
      id: "seedance-2.0-min",
      operations: ["video.generate", "video.image-to-video"],
      inputKinds: ["text"],
      outputKinds: ["video"],
      parameters: [],
      metadata: { parameterControlsUnavailable: true },
    });
    expect(catalog.marketplaceModels[0]).toMatchObject({
      id: "seedance-2.0-min",
      capability: "video",
    });
  });

  it("exposes marketplace models for the settings UI", () => {
    const marketplace = snapshot.marketplaceModels.find(
      (item) => item.id === "seedance-2.0-mini",
    );
    expect(marketplace).toEqual({
      id: "seedance-2.0-mini",
      name: "seedance-2.0-mini（¥0.8/次）",
      description: "933  不卡人脸  480p，可以出720p的，但是720p最高只能12s",
      capability: "video",
      priceLabel: "¥0.8/次",
      billingLabel: "按次计费",
      tags: [],
      endpointTypes: ["openai"],
    });
  });

  it("keeps the live default and vip hierarchy with group-specific prices", () => {
    expect(snapshot.marketplaceGroups.map((group) => group.id)).toEqual([
      "default",
      "vip",
    ]);
    const defaultGroup = snapshot.marketplaceGroups[0]!;
    const vipGroup = snapshot.marketplaceGroups[1]!;
    expect(defaultGroup).toMatchObject({ ratio: 1, canvasSupported: true });
    expect(defaultGroup.models).toHaveLength(5);
    expect(vipGroup).toMatchObject({
      ratio: 0.8,
      canvasSupported: true,
      canvasModelCount: 6,
    });
    expect(vipGroup.models).toHaveLength(6);
    expect(
      vipGroup.models.find((model) => model.id === "seedance-2.0-mini"),
    ).toMatchObject({ priceLabel: "¥0.64/次" });
    expect(
      defaultGroup.models.some((model) => model.id === "seedance-2.0v"),
    ).toBe(false);
    expect(vipGroup.models.some((model) => model.id === "seedance-2.0v")).toBe(
      true,
    );
  });

  it("returns runtime descriptors scoped and repriced to one group", () => {
    const vipModels = miaowuModelsForGroup(snapshot, "vip");
    expect(vipModels).toHaveLength(6);
    expect(
      vipModels.find((model) => model.id === "seedance-2.0-mini"),
    ).toMatchObject({
      name: "seedance-2.0-mini（¥0.64/次）",
      metadata: {
        marketplaceGroup: "vip",
        priceLabel: "¥0.64/次",
        groupRatio: 0.8,
      },
    });
    expect(miaowuModelsForGroup(snapshot, "default")).toHaveLength(5);
  });

  it("skips malformed records", () => {
    const snapshot = miaowuCatalogFromPricing({
      group_ratio: { default: 1 },
      data: [null, 42, { description: "no name" }, { model_name: "   " }],
    } as never);
    expect(snapshot.models).toHaveLength(0);
  });
});

describe("loadMiaowuCatalog", () => {
  beforeEach(resetCatalogCache);

  it("returns the live catalog and caches it", async () => {
    const fetchImpl = okFetch();
    const snapshot = await loadMiaowuCatalog({ fetch: fetchImpl });
    expect(snapshot.source).toBe("live");
    expect(snapshot.models).toHaveLength(6);
    expect(fetchImpl).toHaveBeenCalledWith(
      MIAOWU_CATALOG_SOURCE,
      expect.objectContaining({ cache: "no-store" }),
    );
    const again = await loadMiaowuCatalog({ fetch: fetchImpl });
    expect(again).toBe(snapshot);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to the bundled snapshot when the endpoint is unreachable", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    const snapshot = await loadMiaowuCatalog({ fetch: fetchImpl });
    expect(snapshot.source).toBe("fallback");
    expect(snapshot.models.map((model) => model.id)).toEqual(
      MIAOWU_MODELS.map((model) => model.id),
    );
    expect(snapshot.marketplaceModels).toHaveLength(11);
    expect(snapshot.marketplaceGroups.map((group) => group.id)).toEqual([
      "default",
      "vip",
    ]);
    expect(snapshot.marketplaceGroups[0]).toMatchObject({
      canvasModelCount: 11,
    });
    expect(
      snapshot.marketplaceModels.find((item) => item.id === "seedance-2.0-min"),
    ).toMatchObject({ capability: "video" });
    expect(
      snapshot.marketplaceModels.find(
        (item) => item.id === "seedance-2.0-mini",
      ),
    ).toMatchObject({ priceLabel: "¥0.8/次", billingLabel: "按次计费" });
    expect(
      snapshot.marketplaceModels.find(
        (item) => item.id === "wan3.0-video-480p",
      ),
    ).toMatchObject({ billingLabel: "按秒计费" });
  });

  it("degrades live → stale on a later failure, keeping the live models", async () => {
    const live = await loadMiaowuCatalog({ fetch: okFetch() });
    expect(live.source).toBe("live");
    const failing = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    const stale = await loadMiaowuCatalog({ force: true, fetch: failing });
    expect(stale.source).toBe("stale");
    expect(stale.models).toEqual(live.models);
  });

  it("treats HTTP errors and empty catalogs as failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("nope", { status: 500 }),
    );
    const snapshot = await loadMiaowuCatalog({ fetch: fetchImpl });
    expect(snapshot.source).toBe("fallback");

    resetCatalogCache();
    const empty = await loadMiaowuCatalog({
      fetch: okFetch({ group_ratio: { default: 1 }, data: [] }),
    });
    expect(empty.source).toBe("fallback");
  });
});

describe("miaowuConnectorForModels", () => {
  it("replaces only the model list on a cloned connector", () => {
    const models = miaowuCatalogFromPricing(FIXTURE).models;
    const connector = miaowuConnectorForModels(models);
    expect((connector.models ?? []).map((model) => model.id)).toEqual(
      models.map((model) => model.id),
    );
    expect(connector.submit.path).toBe("/v1/videos");
    expect(connector.allowedHosts).toEqual(["api.miaowuai.store"]);
    expect(connector.modelOverrides?.["seedance-2.0v"]?.submit?.path).toBe(
      "/v1/chat/completions",
    );
    connector.models = [];
    (connector.statusMap as Record<string, string>).queued = "mutated";
    expect(MIAOWU_CONNECTOR.models?.length ?? 0).toBeGreaterThan(0);
    expect(MIAOWU_CONNECTOR.statusMap?.queued).toBe("queued");
  });
});

describe("miaowuDefaultModel", () => {
  const models = miaowuCatalogFromPricing(FIXTURE).models;

  it("keeps a configured default that is still live", () => {
    expect(miaowuDefaultModel(models, "seedance-2.0-pro")).toBe(
      "seedance-2.0-pro",
    );
  });

  it("falls back to the first live model when the saved default is gone", () => {
    // "seedance-2.0" (the preset default) is not in the fixture either.
    expect(miaowuDefaultModel(models, "seedance-2.0-retired")).toBe(
      "seedance-2.0-mini",
    );
    expect(miaowuDefaultModel(models)).toBe("seedance-2.0-mini");
  });

  it("prefers the preset default when it is live", () => {
    expect(miaowuDefaultModel(MIAOWU_MODELS, "unknown-model")).toBe(
      "seedance-2.0-mini",
    );
  });
});

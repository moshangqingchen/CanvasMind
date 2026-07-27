import { describe, expect, it, vi } from "vitest";
import {
  cangyuanCatalogFromPricing,
  loadCangyuanCatalog,
} from "./cangyuan-catalog";

const pricingPayload = {
  group_ratio: {
    IMAGE: 1,
    VIDEO: 1,
    "LLM-GPT-plus": 0.075,
    "全模型-无claude/gpt": 1,
    备用image线路: 1,
  },
  usable_group: {
    IMAGE: "图片与视频创作",
    VIDEO: "视频创作",
    "LLM-GPT-plus": "GPT 对话线路",
  },
  data: [
    {
      model_name: "gpt-image-2",
      model_price: 0.02,
      tags: "image,gpt-image",
      request_unit: "image",
      enable_groups: ["IMAGE", "全模型-无claude/gpt"],
    },
    {
      model_name: "new-image-model",
      model_price: 0.125,
      tags: "image,new",
      request_unit: "image",
      enable_groups: ["备用image线路"],
      image_ui_params: {
        params: {
          aspectRatio: {
            enabled: true,
            options: [
              { label: "方形", value: "1:1" },
              { label: "横屏", value: "16:9" },
            ],
          },
          count: { enabled: true, min: 1, max: 3 },
        },
      },
      api_doc: {
        modes: {
          sync: {
            params: [{ name: "images", description: "参考图数组" }],
          },
        },
      },
    },
    {
      model_name: "not-an-image-model",
      model_price: 1,
      tags: "text",
      request_unit: "token",
      enable_groups: ["IMAGE"],
    },
    {
      model_name: "veo-3-1",
      model_price: 0.9,
      billing_mode: "per_request",
      request_unit: "generation",
      enable_groups: ["IMAGE", "VIDEO", "全模型-无claude/gpt"],
      video_ui_params: {
        payloadBuilder: "chat-video",
        params: {
          duration: {
            enabled: true,
            min: 4,
            max: 8,
            numericOptions: [4, 6, 8],
          },
          ratio: {
            enabled: true,
            options: [
              { label: "横屏", value: "16:9" },
              { label: "竖屏", value: "9:16" },
            ],
          },
          resolution: {
            enabled: true,
            options: [
              { label: "720p", value: "720p" },
              { label: "1080p", value: "1080p" },
            ],
          },
          generateAudio: { enabled: true },
        },
        referenceLimits: { images: 2, videos: 0, audios: 0 },
      },
      api_doc: {
        request_json: { reference_mode: "frame" },
        params: [{ name: "generate_audio" }, { name: "images" }],
      },
    },
    {
      model_name: "gpt-5.4",
      quota_type: 0,
      model_ratio: 1.25,
      completion_ratio: 6,
      cache_ratio: 0.1,
      enable_groups: ["LLM-GPT-plus"],
      supported_endpoint_types: ["openai"],
    },
  ],
};

describe("Cangyuan live catalog", () => {
  it("uses marketplace group membership and live prices", () => {
    const catalog = cangyuanCatalogFromPricing(pricingPayload);

    expect(catalog.groups.IMAGE.map((model) => model.id)).toEqual([
      "gpt-image-2",
      "veo-3-1",
    ]);
    expect(catalog.groups.IMAGE[0]?.name).toBe("GPT Image 2（¥0.02/张）");
    expect(catalog.groups.IMAGE[1]).toMatchObject({
      id: "veo-3-1",
      name: "veo-3-1（¥0.90/次）",
      operations: ["video.generate", "video.image-to-video"],
      limits: { maxInputImages: 2, maxInputVideos: 0 },
      metadata: { referenceMode: "frame", payloadBuilder: "chat-video" },
    });
    expect(
      catalog.groups.IMAGE[1]?.parameters?.map((item) => item.key),
    ).toEqual(["duration", "aspect_ratio", "resolution", "generate_audio"]);
    expect(
      catalog.groups["全模型-无claude/gpt"].map((model) => model.id),
    ).toEqual(["gpt-image-2", "veo-3-1"]);
    expect(catalog.groups.VIDEO.map((model) => model.id)).toEqual(["veo-3-1"]);
    expect(catalog.groups["备用image线路"]).toEqual([
      expect.objectContaining({
        id: "new-image-model",
        name: "new-image-model（¥0.125/张）",
        operations: ["image.generate", "image.edit"],
        parameters: [
          expect.objectContaining({ key: "aspect_ratio" }),
          expect.objectContaining({ key: "n", max: 3 }),
        ],
      }),
    ]);
    expect(catalog.marketplaceGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "IMAGE",
          description: "图片与视频创作",
          canvasSupported: true,
        }),
        expect.objectContaining({
          id: "LLM-GPT-plus",
          canvasSupported: false,
          models: [
            expect.objectContaining({
              id: "gpt-5.4",
              capability: "chat",
              priceLabel: "输入 ¥0.1875/1M · 输出 ¥1.125/1M · 缓存 ¥0.0188/1M",
            }),
          ],
        }),
      ]),
    );
  });

  it("checks the homepage, docs, and pricing endpoint before publishing", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      return new Response(
        url.endsWith("/api/pricing") ? JSON.stringify(pricingPayload) : "ok",
        {
          status: 200,
          headers: url.endsWith("/api/pricing")
            ? { "content-type": "application/json" }
            : undefined,
        },
      );
    });

    const catalog = await loadCangyuanCatalog({
      force: true,
      fetch: fetchMock,
    });

    expect(catalog.source).toBe("live");
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://ai.cangyuansuanli.cn/",
      "https://ai.cangyuansuanli.cn/docs/api",
      "https://ai.cangyuansuanli.cn/api/pricing",
    ]);
  });

  it("reads reference media duration limits from the provider documentation", () => {
    const catalog = cangyuanCatalogFromPricing({
      data: [
        {
          model_name: "documented-video-model",
          model_price: 1,
          tags: "video",
          enable_groups: ["IMAGE"],
          video_ui_params: {
            referenceLimits: {
              images: 0,
              videos: 3,
              audios: 1,
              video: {
                maxDurationMs: 15_000,
                totalMaxDurationMs: 30_000,
              },
              audio: { maxDurationMs: 12_000 },
            },
          },
          api_doc: {
            params: [
              {
                name: "reference_videos",
                description: "最多 3 条，单条 2–15s，多条总时长 ≤30 秒。",
              },
            ],
          },
        },
      ],
    });

    expect(catalog.groups.IMAGE[0]?.limits).toMatchObject({
      maxInputVideos: 3,
      maxInputAudios: 1,
      maxInputVideoDurationSeconds: 15,
      maxTotalInputVideoDurationSeconds: 30,
      maxInputAudioDurationSeconds: 12,
    });
  });

  it("falls back to the reference_videos text when structured limits are absent", () => {
    const catalog = cangyuanCatalogFromPricing({
      data: [
        {
          model_name: "text-documented-video-model",
          model_price: 1,
          tags: "video",
          enable_groups: ["IMAGE"],
          video_ui_params: { referenceLimits: { videos: 2 } },
          api_doc: {
            params: [
              {
                name: "reference_videos",
                description: "参考视频单条 4–18 秒，多条总时长不超过 24 秒。",
              },
            ],
          },
        },
      ],
    });

    expect(catalog.groups.IMAGE[0]?.limits).toMatchObject({
      maxInputVideoDurationSeconds: 18,
      maxTotalInputVideoDurationSeconds: 24,
    });
  });

  it("publishes automatic ratios, documented dimensions, and high 4K defaults", () => {
    const catalog = cangyuanCatalogFromPricing({
      data: [
        {
          model_name: "gpt-image-2-4k",
          model_price: 0.08,
          request_unit: "image",
          enable_groups: ["IMAGE"],
          image_ui_params: {
            params: {
              aspectRatio: {
                enabled: true,
                options: [
                  { label: "1:1", value: "1:1" },
                  { label: "16:9", value: "16:9" },
                ],
              },
              customDimensions: { enabled: true },
              quality: {
                enabled: true,
                options: [
                  { label: "中", value: "medium" },
                  { label: "高", value: "high" },
                ],
              },
            },
          },
          api_doc: {
            modes: { sync: { params: [{ name: "images" }] } },
          },
        },
      ],
    });
    const model = catalog.groups.IMAGE[0];

    expect(
      model?.parameters?.find((parameter) => parameter.key === "aspect_ratio")
        ?.options?.[0],
    ).toEqual({ label: "自动（提示词优先）", value: "auto" });
    expect(
      model?.parameters?.find((parameter) => parameter.key === "aspect_ratio")
        ?.default,
    ).toBe("auto");
    expect(
      model?.parameters?.find((parameter) => parameter.key === "size"),
    ).toMatchObject({ control: "dimensions", step: 16, max: 3840 });
    expect(
      model?.parameters?.find((parameter) => parameter.key === "quality")
        ?.default,
    ).toBe("high");
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  GenericRestAdapter,
  type ProviderConnectionResolver,
} from "@super-canvas/providers";
import {
  cangyuanCatalogFromPricing,
  cangyuanConnectorForModels,
  loadCangyuanCatalog,
  parseCangyuanAvailabilityPayload,
} from "./cangyuan-catalog";
import { CANGYUAN_BACKUP_IMAGE_GROUP } from "./provider-presets";

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
      api_doc: {
        modes: {
          async: {
            endpoints: [
              { method: "POST", path: "{{base}}/images/edits" },
              { method: "GET", path: "{{base}}/images/edits/{task_id}" },
            ],
            params: [
              { name: "image", description: "上传单张参考图文件" },
              { name: "image[]", description: "重复提交多张参考图" },
            ],
          },
        },
      },
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
          background: {
            enabled: true,
            options: [
              { label: "自动", value: "auto" },
              { label: "不透明", value: "opaque" },
              { label: "透明", value: "transparent" },
            ],
          },
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
    expect(catalog.groups.IMAGE[0]).toMatchObject({
      operations: ["image.generate", "image.edit"],
      inputKinds: ["text", "image", "image[]"],
      limits: { maxInputImages: 9 },
    });
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
    expect(catalog.groups[CANGYUAN_BACKUP_IMAGE_GROUP]).toEqual([
      expect.objectContaining({
        id: "new-image-model",
        name: "new-image-model（¥0.125/张）",
        operations: ["image.generate", "image.edit"],
        parameters: [
          expect.objectContaining({ key: "aspect_ratio" }),
          expect.objectContaining({
            key: "background",
            default: "auto",
            options: [
              { label: "自动", value: "auto" },
              { label: "不透明", value: "opaque" },
              { label: "透明", value: "transparent" },
            ],
          }),
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

  it("routes GPT Image 2 references through the verified JSON generation endpoint", async () => {
    const catalog = cangyuanCatalogFromPricing(pricingPayload);
    const connector = cangyuanConnectorForModels("IMAGE", catalog.groups.IMAGE);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "edit-1", status: "queued" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "edit-1",
            status: "completed",
            data: [{ url: "https://cdn.example.com/edited.png" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    const resolver: ProviderConnectionResolver = {
      resolve: async () => ({
        id: "cangyuan",
        provider: "rest",
        apiKey: "test-key",
        baseUrl: "https://ai.cangyuansuanli.cn",
        settings: { connector },
      }),
    };
    const adapter = new GenericRestAdapter(resolver, { fetch: fetchMock });
    const request = {
      connectionId: "cangyuan",
      operation: "image.edit" as const,
      model: "gpt-image-2",
      prompt: "保留人物构图并改变服装",
      idempotencyKey: "run:edit",
      assets: [
        {
          id: "reference",
          kind: "image" as const,
          mimeType: "image/jpeg",
          filename: "reference.jpg",
          data: new Uint8Array([1, 2, 3]),
        },
      ],
      parameters: { aspect_ratio: "1:1", quality: "high", n: 1 },
    };

    await expect(adapter.validate(request)).resolves.toEqual({
      valid: true,
      issues: [],
    });
    const task = await adapter.submit(request);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://ai.cangyuansuanli.cn/v1/images/generations",
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      model: "gpt-image-2",
      prompt: "保留人物构图并改变服装",
      async: true,
      size: "1:1",
      response_format: "url",
    });
    expect(body.images).toHaveLength(1);
    expect(body.images[0]).toMatch(/^data:image\/jpeg;base64,/u);

    await adapter.poll(task);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://ai.cangyuansuanli.cn/v1/images/generations/edit-1",
    );
  });

  it("maps GPT Image 2 canvas ratios to the current generation size field", async () => {
    const catalog = cangyuanCatalogFromPricing(pricingPayload);
    const connector = cangyuanConnectorForModels("IMAGE", catalog.groups.IMAGE);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "generate-1", status: "queued" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const adapter = new GenericRestAdapter(
      {
        resolve: async () => ({
          id: "cangyuan",
          provider: "rest",
          apiKey: "test-key",
          baseUrl: "https://ai.cangyuansuanli.cn",
          settings: { connector },
        }),
      },
      { fetch: fetchMock },
    );

    await adapter.submit({
      connectionId: "cangyuan",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "正方形宣传图",
      idempotencyKey: "run:generate",
      parameters: { aspect_ratio: "1:1", quality: "high", n: 1 },
      assets: [],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      async: true,
      model: "gpt-image-2",
      prompt: "正方形宣传图",
      size: "1:1",
      n: 1,
      response_format: "url",
    });
    expect(body).not.toHaveProperty("aspect_ratio");
    expect(body).not.toHaveProperty("quality");
  });

  it("polls asynchronous GPT Image tasks in the renamed backup group", async () => {
    const connector = cangyuanConnectorForModels(
      CANGYUAN_BACKUP_IMAGE_GROUP,
      [
        {
          id: "gpt-image-2-4k",
          name: "gpt-image-2-4k",
          operations: ["image.generate", "image.edit"],
          parameters: [
            {
              key: "aspect_ratio",
              label: "画面比例",
              control: "select",
              valueType: "string",
              options: [{ label: "1:1", value: "1:1" }],
            },
            {
              key: "background",
              label: "背景模式",
              control: "select",
              valueType: "string",
              default: "auto",
              options: [
                { label: "自动", value: "auto" },
                { label: "不透明", value: "opaque" },
                { label: "透明", value: "transparent" },
              ],
            },
            {
              key: "n",
              label: "生成张数",
              control: "number",
              valueType: "integer",
              min: 1,
              max: 1,
            },
          ],
        },
      ],
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "backup-4k", status: "queued" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "backup-4k",
            status: "completed",
            data: [{ url: "https://cdn.example.com/backup-4k.png" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "backup-edit", status: "queued" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "backup-edit",
            status: "completed",
            data: [{ url: "https://cdn.example.com/backup-edit.png" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    const adapter = new GenericRestAdapter(
      {
        resolve: async () => ({
          id: "cangyuan-backup",
          provider: "rest",
          apiKey: "test-key",
          baseUrl: "https://ai.cangyuansuanli.cn",
          settings: { connector },
        }),
      },
      { fetch: fetchMock },
    );

    const task = await adapter.submit({
      connectionId: "cangyuan-backup",
      operation: "image.generate",
      model: "gpt-image-2-4k",
      prompt: "4K 方形海报",
      idempotencyKey: "run:backup-4k",
      parameters: {
        aspect_ratio: "1:1",
        background: "transparent",
        n: 1,
      },
      assets: [],
    });
    await adapter.poll(task);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://ai.cangyuansuanli.cn/v1/images/generations",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://ai.cangyuansuanli.cn/v1/images/generations/backup-4k",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      background: "transparent",
    });

    const editTask = await adapter.submit({
      connectionId: "cangyuan-backup",
      operation: "image.edit",
      model: "gpt-image-2-4k",
      prompt: "保留主体并移除背景",
      idempotencyKey: "run:backup-edit",
      parameters: {
        aspect_ratio: "1:1",
        background: "transparent",
        n: 1,
      },
      assets: [
        {
          id: "reference",
          kind: "image",
          mimeType: "image/png",
          filename: "reference.png",
          data: new Uint8Array([1, 2, 3]),
        },
      ],
    });
    await adapter.poll(editTask);
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      "https://ai.cangyuansuanli.cn/v1/images/generations",
    );
    const editBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(editBody).toMatchObject({ background: "transparent" });
    expect(editBody.images).toHaveLength(1);
    expect(String(fetchMock.mock.calls[3]?.[0])).toBe(
      "https://ai.cangyuansuanli.cn/v1/images/generations/backup-edit",
    );
  });

  it("maps Banana ratios to size and routes references through JSON generation", () => {
    const catalog = cangyuanCatalogFromPricing({
      data: [
        {
          model_name: "nano-banana2-4k",
          model_price: 0.145,
          billing_mode: "per_request",
          request_unit: "image",
          tags: "image,banana",
          enable_groups: ["IMAGE"],
          image_ui_params: {
            params: {
              aspectRatio: {
                enabled: true,
                options: [{ label: "方形", value: "1:1" }],
              },
              count: { enabled: true, max: 4 },
            },
          },
          api_doc: {
            params: [
              { name: "model" },
              { name: "prompt" },
              { name: "size" },
              { name: "n" },
              { name: "response_format" },
              { name: "images" },
              { name: "async" },
            ],
            endpoints: [
              { method: "POST", path: "{{base}}/images/generations" },
              { method: "POST", path: "{{base}}/images/edits" },
            ],
          },
        },
      ],
    });
    const connector = cangyuanConnectorForModels("IMAGE", catalog.groups.IMAGE);
    const override = connector.modelOverrides?.["nano-banana2-4k"];
    const generationTargets =
      override?.submit?.mappings?.map((mapping) => mapping.target) ?? [];
    const edit = override?.operationOverrides?.["image.edit"]?.submit;
    const editTargets = edit?.mappings?.map((mapping) => mapping.target) ?? [];

    expect(generationTargets).toEqual(
      expect.arrayContaining(["/size", "/n", "/response_format"]),
    );
    expect(generationTargets).not.toContain("/aspect_ratio");
    expect(edit).toMatchObject({
      path: "/v1/images/generations",
      bodyMode: "json",
    });
    expect(editTargets).toContain("/images");
  });

  it("uses the live Seedance flat fields for explicit sd8 SKUs and keeps image order", async () => {
    const catalog = cangyuanCatalogFromPricing({
      data: [
        {
          model_name: "sd8-seedance-2.0",
          model_price: 2.9,
          billing_mode: "per_request",
          tags: "video,seedance",
          enable_groups: ["VIDEO"],
          video_ui_params: {
            payloadBuilder: "seedance-flat",
            params: {
              duration: { enabled: true, numericOptions: [5, 10, 15] },
              ratio: {
                enabled: true,
                options: [{ label: "方形", value: "1:1" }],
              },
              frameInputs: { enabled: false },
              generateAudio: { enabled: false },
            },
            referenceLimits: { images: 9, videos: 3, audios: 3 },
          },
          api_doc: {
            params: [
              { name: "model" },
              { name: "prompt" },
              { name: "duration" },
              { name: "aspect_ratio" },
              { name: "reference_image_urls" },
              { name: "reference_videos" },
              { name: "reference_audios" },
            ],
          },
        },
      ],
    });
    const connector = cangyuanConnectorForModels("VIDEO", catalog.groups.VIDEO);
    expect(connector.assetsRequirePublicUrls).toBe(true);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "video-1", status: "queued" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const adapter = new GenericRestAdapter(
      {
        resolve: async () => ({
          id: "cangyuan",
          provider: "rest",
          apiKey: "test-key",
          baseUrl: "https://ai.cangyuansuanli.cn",
          settings: { connector },
        }),
      },
      { fetch: fetchMock },
    );

    await adapter.submit({
      connectionId: "cangyuan",
      operation: "video.image-to-video",
      model: "sd8-seedance-2.0",
      prompt: "让 @image2 转身",
      idempotencyKey: "run:sd8",
      parameters: {
        duration: 10,
        aspect_ratio: "1:1",
        // Simulate stale values from another selected model. Strict model
        // mappings must not forward fields absent from this SKU.
        resolution: "720p",
        generate_audio: true,
      },
      assets: [
        {
          id: "image-1",
          kind: "image",
          mimeType: "image/png",
          url: "https://assets.test/image-1.png",
        },
        {
          id: "image-2",
          kind: "image",
          mimeType: "image/png",
          url: "https://assets.test/image-2.png",
        },
        {
          id: "video-1",
          kind: "video",
          mimeType: "video/mp4",
          url: "https://assets.test/reference.mp4",
        },
        {
          id: "audio-1",
          kind: "audio",
          mimeType: "audio/mpeg",
          url: "https://assets.test/reference.mp3",
        },
      ],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      model: "sd8-seedance-2.0",
      prompt: "让 @image2 转身",
      duration: 10,
      aspect_ratio: "1:1",
      reference_image_urls: [
        "https://assets.test/image-1.png",
        "https://assets.test/image-2.png",
      ],
      reference_videos: ["https://assets.test/reference.mp4"],
      reference_audios: ["https://assets.test/reference.mp3"],
    });
    expect(body).not.toHaveProperty("images");
    expect(body).not.toHaveProperty("resolution");
    expect(body).not.toHaveProperty("generate_audio");
  });

  it("reads combined Seedance 2.5 frame docs and the structured frame capability", () => {
    const catalog = cangyuanCatalogFromPricing({
      data: [
        {
          model_name: "sd4-seedance-2.5-720p",
          model_price: 0.39,
          billing_mode: "per_second",
          tags: "video,seedance",
          enable_groups: ["VIDEO"],
          video_ui_params: {
            payloadBuilder: "seedance-flat",
            params: {
              duration: { enabled: true, numericOptions: [4, 5] },
              ratio: {
                enabled: true,
                options: [{ label: "横屏", value: "16:9" }],
              },
              frameInputs: { enabled: true },
              generateAudio: { enabled: true },
            },
            referenceLimits: { images: 10, videos: 3, audios: 1 },
          },
          api_doc: {
            params: [
              { name: "first_image_url / last_image_url" },
              { name: "generate_audio" },
            ],
          },
        },
      ],
    });

    expect(catalog.groups.VIDEO[0]).toMatchObject({
      name: "sd4-seedance-2.5-720p（¥0.39/秒）",
      metadata: { supportsFirstLastFrames: true },
    });
  });

  it("uses current reference fields for Grok, Omni, and other flat video models", () => {
    const videoRecord = (
      model_name: string,
      payloadBuilder: string,
      referenceLimits: { images: number; videos: number; audios: number },
      frameInputs = false,
    ) => ({
      model_name,
      model_price: 1,
      tags: "video",
      enable_groups: ["VIDEO"],
      video_ui_params: {
        payloadBuilder,
        params: {
          duration: { enabled: true, numericOptions: [5] },
          ratio: {
            enabled: true,
            options: [{ label: "横屏", value: "16:9" }],
          },
          frameInputs: { enabled: frameInputs },
        },
        referenceLimits,
      },
      api_doc: { params: [] },
    });
    const catalog = cangyuanCatalogFromPricing({
      data: [
        videoRecord(
          "grok-video",
          "grok-generations",
          { images: 7, videos: 1, audios: 0 },
        ),
        videoRecord(
          "omni-fast",
          "omni-frame",
          { images: 5, videos: 0, audios: 0 },
          true,
        ),
        videoRecord(
          "happyhouse-1.0",
          "seedance-flat",
          { images: 9, videos: 1, audios: 0 },
        ),
        videoRecord(
          "minimax-h3-2k",
          "seedance-flat",
          { images: 5, videos: 0, audios: 3 },
          true,
        ),
      ],
    });
    const connector = cangyuanConnectorForModels("VIDEO", catalog.groups.VIDEO);
    const targets = (model: string) =>
      connector.modelOverrides?.[model]?.submit?.mappings?.map(
        (mapping) => mapping.target,
      ) ?? [];

    expect(targets("grok-video")).toEqual(
      expect.arrayContaining(["/reference_image_urls", "/video_url"]),
    );
    expect(targets("grok-video")).not.toContain("/image_urls");
    expect(targets("omni-fast")).toEqual(
      expect.arrayContaining([
        "/reference_image_urls",
        "/first_image_url",
        "/last_image_url",
      ]),
    );
    expect(targets("omni-fast")).not.toContain("/image_url");
    expect(targets("happyhouse-1.0")).toEqual(
      expect.arrayContaining(["/reference_image_urls", "/reference_videos"]),
    );
    expect(targets("happyhouse-1.0")).not.toContain("/images");
    expect(targets("minimax-h3-2k")).toEqual(
      expect.arrayContaining([
        "/reference_image_urls",
        "/reference_videos",
        "/reference_audios",
        "/first_image_url",
        "/last_image_url",
      ]),
    );
    expect(targets("minimax-h3-2k")).not.toContain("/images");
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
    const connector = cangyuanConnectorForModels("IMAGE", catalog.groups.IMAGE);
    expect(
      connector.modelOverrides?.["gpt-image-2-4k"]?.submit?.mappings?.map(
        (mapping) => mapping.target,
      ),
    ).toContain("/quality");
  });

  it("maps Wan 3.0 and Seedance 2.0 1080p reference fields separately", () => {
    const catalog = cangyuanCatalogFromPricing({
      data: [
        {
          model_name: "wan3.0-15s",
          model_price: 1.99,
          tags: "video,wan",
          enable_groups: ["VIDEO"],
          video_ui_params: {
            payloadBuilder: "wan3-flat",
            params: {
              duration: { enabled: true, min: 4, max: 15 },
              ratio: { enabled: true, options: [{ label: "横屏", value: "16:9" }] },
              resolution: {
                enabled: true,
                options: [{ label: "720p", value: "720p" }],
              },
            },
            referenceLimits: { images: 10, videos: 5, audios: 5 },
          },
          api_doc: {
            params: [
              { name: "reference_image_urls" },
              { name: "reference_videos" },
              { name: "reference_audios" },
            ],
          },
        },
        {
          model_name: "seedance-2.0-1080p",
          model_price: 4.9,
          tags: "video,seedance",
          enable_groups: ["VIDEO"],
          video_ui_params: {
            payloadBuilder: "seedance-reference-urls",
            params: {
              duration: { enabled: true, numericOptions: [4, 8, 15] },
              ratio: { enabled: true, options: [{ label: "横屏", value: "16:9" }] },
              generateAudio: { enabled: true },
            },
            referenceLimits: { images: 5, videos: 3, audios: 3 },
          },
          api_doc: {
            params: [
              { name: "image_url" },
              { name: "reference_image_urls" },
              { name: "reference_videos" },
              { name: "reference_audios" },
              { name: "generate_audio" },
            ],
          },
        },
      ],
    });
    const connector = cangyuanConnectorForModels("VIDEO", catalog.groups.VIDEO);
    const targets = (model: string) =>
      connector.modelOverrides?.[model]?.submit?.mappings?.map(
        (mapping) => mapping.target,
      ) ?? [];

    expect(targets("wan3.0-15s")).toEqual(
      expect.arrayContaining([
        "/reference_image_urls",
        "/reference_videos",
        "/reference_audios",
      ]),
    );
    expect(targets("seedance-2.0-1080p")).toEqual(
      expect.arrayContaining([
        "/image_url",
        "/reference_image_urls",
        "/reference_videos",
        "/reference_audios",
      ]),
    );
    expect(targets("seedance-2.0-1080p")).not.toContain("/resolution");
  });

  it("keeps Midjourney ratio-only even when a stale pixel-size field is present", () => {
    const connector = cangyuanConnectorForModels("IMAGE", [
      {
        id: "midjourney-8.2-2k",
        name: "Midjourney 8.2 2K",
        operations: ["image.generate"],
        parameters: [
          {
            key: "aspect_ratio",
            label: "画面比例",
            control: "select",
            valueType: "string",
            options: [{ label: "16:9", value: "16:9" }],
          },
          {
            key: "size",
            label: "精确尺寸",
            control: "dimensions",
            valueType: "string",
          },
        ],
      },
    ]);
    const mappings = connector.modelOverrides?.["midjourney-8.2-2k"]?.submit
      ?.mappings;
    expect(mappings?.map((mapping) => mapping.target)).toContain("/size");
    expect(
      mappings?.some(
        (mapping) =>
          mapping.target === "/size" &&
          mapping.source.kind === "request" &&
          mapping.source.path === "$.parameters.size",
      ),
    ).toBe(false);
  });

  it("normalizes Cangyuan availability arrays and keyed payloads", () => {
    const arraySnapshot = parseCangyuanAvailabilityPayload(
      {
        checked_at: "2026-09-02T01:02:03.000Z",
        data: [
          {
            model_name: "midjourney-8.2-2k",
            category: "image",
            latest_status: "operational",
            availability: "99.5",
            average_latency_ms: 640.4,
            timeline: [{ status: "operational" }],
          },
        ],
      },
      15,
    );
    expect(arraySnapshot).toEqual({
      checkedAt: "2026-09-02T01:02:03.000Z",
      windowDays: 15,
      items: [
        {
          name: "midjourney-8.2-2k",
          category: "image",
          latestStatus: "operational",
          availability: 99.5,
          averageLatencyMs: 640.4,
          timeline: [{ status: "operational" }],
        },
      ],
    });

    const keyedSnapshot = parseCangyuanAvailabilityPayload({
      models: {
        "minimax-h3-2k": {
          category: "video",
          latestStatus: "degraded",
          uptime: 97,
          averageLatencyMs: "1200",
        },
      },
    });
    expect(keyedSnapshot.items[0]).toMatchObject({
      name: "minimax-h3-2k",
      latestStatus: "degraded",
      availability: 97,
      averageLatencyMs: 1200,
    });
  });
});

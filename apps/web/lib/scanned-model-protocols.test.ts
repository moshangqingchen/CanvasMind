import { describe, expect, it, vi } from "vitest";
import {
  GenericRestAdapter,
  WeAIImageAdapter,
  StaticConnectionResolver,
  type ModelDescriptor,
} from "@super-canvas/providers";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import {
  chentuNativeGeminiConnector,
  chentuNativeGeminiDescriptor,
} from "./chentu-gemini";
import {
  mikotoConnectionConfig,
  MIKOTO_IMAGE_GROUP,
  MIKOTO_SEEDANCE_GROUP,
  MIKOTO_GEMINI_GROUP,
} from "./mikoto-presets";

const scanned = (
  id: string,
  operations: ModelDescriptor["operations"] = ["image.generate", "image.edit"],
): ModelDescriptor => ({
  id,
  name: `${id}（价格以平台为准）`,
  operations,
  metadata: {
    canvasRunnable: false,
    canvasUnavailableReason: "画布协议尚未内置",
    priceLabel: "价格以平台为准",
  },
});

describe("scanned model protocol binding", () => {
  it("restores an exact model's native endpoint without requiring model-in-body inheritance", () => {
    const id = "ad-gemini-3-pro-image-preview";
    const connection = {
      provider: "rest",
      config: {
        connector: chentuNativeGeminiConnector([
          chentuNativeGeminiDescriptor(id),
        ]),
      },
    };
    const result = bindScannedModelProtocols(connection, [scanned(id)]);
    expect(result.models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(result.models[0]?.parameters?.map((p) => p.key)).toEqual([
      "aspect_ratio",
      "image_size",
    ]);
    expect(result.connector?.modelOverrides?.[id]?.submit?.path).toContain(
      `${id}:generateContent`,
    );
  });
  it("never inherits Grok transport for a different video family, including stale inherited templates", () => {
    const grok = {
      id: "grok-imagine-video",
      name: "Grok",
      operations: ["video.generate"] as const,
    };
    const stale = {
      ...grok,
      id: "minimax-h3",
      metadata: { protocolSourceModel: grok.id, canvasRunnable: true },
    };
    const connection = {
      provider: "rest",
      config: {
        connector: {
          submit: {
            path: "/grok-only",
            mappings: [
              {
                target: "/model",
                source: { kind: "request", path: "$.model" },
              },
            ],
          },
          output: { path: "$.url", kind: "video" },
          models: [grok, stale],
        },
      },
    };
    const result = bindScannedModelProtocols(connection, [
      scanned("veo3.1", ["video.generate"]),
      stale,
    ]);
    expect(
      result.models.every((m) => m.metadata?.canvasRunnable === false),
    ).toBe(true);
    expect(result.connector?.models).toEqual([]);
  });
  it("inherits fixed resolution SKUs only inside the same supplier channel", () => {
    const models = ["minimax-h3-768p", "mm2-minimax-h3", "sd4-seedance-2.0", "sd10-seedance-2.0"].map(id => ({id, name: id, operations: ["video.generate"] as const, parameters: [{key: "resolution", label: "Resolution", control: "select" as const, valueType: "string" as const, default: "720p"}]}));
    const config = {submit: {path: "/v1/videos", mappings: [{target: "/model", source: {kind: "request", path: "$.model"}}]}, output: {path: "$.url", kind: "video"}, models,
      modelOverrides: Object.fromEntries(models.map(m => [m.id, {submit: {path: `/channels/${m.id}`, mappings: [{target: "/model", source: {kind: "request", path: "$.model"}}]}}]))};
    const result = bindScannedModelProtocols({provider: "rest", config: {connector: config}}, [scanned("minimax-h3-2k", ["video.generate"]), scanned("sd4-seedance-2.5-720p", ["video.generate"])]);
    expect(result.models.every(m => m.metadata?.canvasRunnable === true)).toBe(true);
    expect(result.connector?.modelOverrides?.["minimax-h3-2k"]?.submit?.path).toBe("/channels/minimax-h3-768p");
    expect(result.connector?.modelOverrides?.["sd4-seedance-2.5-720p"]?.submit?.path).toBe("/channels/sd4-seedance-2.0");
    expect(result.models.every(m => !m.parameters?.some(p => p.key === "resolution"))).toBe(true);
  });
  it("matches fixed-resolution aliases when same-channel transports differ only in optional resolution", () => {
    const modelMapping = {target: "/model", source: {kind: "request", path: "$.model"}};
    const resolutionMapping = {target: "/resolution", source: {kind: "request", path: "$.parameters.resolution"}, omitIfUndefined: true};
    const ids = ["sd4-seedance-2.0", "sd4-seedance-2.0-fast"];
    const connector = {
      submit: {path: "/v1/videos", mappings: [modelMapping]},
      output: {path: "$.url", kind: "video"},
      models: ids.map(id => ({id, name: id, operations: ["video.generate"]})),
      modelOverrides: Object.fromEntries(ids.map((id, i) => [id, {
        submit: {path: "/v1/videos", mappings: i ? [modelMapping, resolutionMapping] : [modelMapping]},
        poll: {path: "/v1/videos/{taskId}"},
      }])),
    };
    const fixed = "sd4-seedance-2.5-720p";
    const result = bindScannedModelProtocols({provider: "rest", config: {connector}}, [scanned(fixed, ["video.generate"]), scanned("sd4-seedance-2.5", ["video.generate"])]);
    expect(result.models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(result.models[1]?.metadata?.canvasRunnable).toBe(false);
    expect(result.connector?.modelOverrides?.[fixed]?.submit?.mappings).toEqual([modelMapping]);
    expect(result.connector?.modelOverrides?.[fixed]?.poll?.path).toBe("/v1/videos/{taskId}");
    expect(connector.modelOverrides[ids[1]!]!.submit.mappings).toHaveLength(2);
  });
  it.each([0, 0.025, 0.055, 0.075, 0.095])(
    "repairs a cached unknown-price label from its own exact price %s",
    (unitAmount) => {
      const model: ModelDescriptor = {
        ...scanned("gpt-image-2.5-flare-4k"),
        metadata: { canvasRunnable: true, priceLabel: "价格以平台为准" },
        pricing: {
          kind: "per-image",
          currency: "CNY",
          unitAmount,
          checkedAt: "2026-09-10",
          confidence: "exact",
        },
      };
      const connection = {
        provider: "rest",
        config: mikotoConnectionConfig(MIKOTO_IMAGE_GROUP),
      };
      const result = bindScannedModelProtocols(connection, [model]);
      expect(result.models[0]?.name).toBe(
        `gpt-image-2.5-flare-4k（¥${unitAmount}/张）`,
      );
      expect(result.models[0]?.metadata?.priceLabel).toBe(`¥${unitAmount}/张`);
      expect(result.connector?.models?.[0]?.name).toBe(result.models[0]?.name);
      expect(
        bindScannedModelProtocols(connection, result.models).models[0]?.name,
      ).toBe(result.models[0]?.name);
    },
  );

  it("does not append an unknown-price label when binding a priced model's transport", () => {
    const model: ModelDescriptor = {
      ...scanned("gpt-image-2.5-flare-4k"),
      name: "gpt-image-2.5-flare-4k（¥0.095/张）",
      pricing: {
        kind: "per-image",
        currency: "CNY",
        unitAmount: 0.095,
        checkedAt: "2026-09-10",
        confidence: "exact",
      },
    };
    const result = bindScannedModelProtocols(
      { provider: "rest", config: mikotoConnectionConfig(MIKOTO_IMAGE_GROUP) },
      [model],
    );
    expect(result.models[0]?.name).toBe(model.name);
  });

  it("runs a new image ID with the group's generation, edit and polling protocol", async () => {
    const connection = {
      provider: "rest",
      config: mikotoConnectionConfig(MIKOTO_IMAGE_GROUP),
    };
    const result = bindScannedModelProtocols(connection, [
      scanned("gpt-image-2.5-flare"),
    ]);
    const model = result.models[0]!;
    expect(model.metadata?.canvasRunnable).toBe(true);
    expect(model.metadata?.canvasUnavailableReason).toBeUndefined();
    expect(model.pricing).toBeUndefined();
    expect(model.metadata?.priceLabel).toBe("价格以平台为准");
    expect(model.parameters?.length).toBeGreaterThan(0);
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/v1/images/generations/async")) {
          expect(JSON.parse(String(init?.body)).model).toBe(model.id);
          return Response.json({ task_id: "new-model-task", status: "queued" });
        }
        if (String(url).endsWith("/v1/images/edits/async")) {
          expect(init?.body).toBeInstanceOf(FormData);
          expect((init!.body as FormData).get("model")).toBe(model.id);
          return Response.json({ task_id: "edit-task", status: "queued" });
        }
        expect(String(url)).toBe(
          "https://api.mikoto.vip/v1/images/tasks/new-model-task",
        );
        return Response.json({
          status: "success",
          result: { data: [{ url: "https://api.mikoto.vip/generated.png" }] },
        });
      },
    );
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        {
          id: "group",
          provider: "rest",
          apiKey: "test",
          baseUrl: "https://api.mikoto.vip",
          settings: { connector: result.connector },
        },
      ]),
      { fetch: fetch as typeof globalThis.fetch },
    );
    const request = {
      connectionId: "group",
      model: model.id,
      operation: "image.generate" as const,
      prompt: "test",
      parameters: {},
      idempotencyKey: "scan-test",
    };
    expect((await adapter.validate(request)).valid).toBe(true);
    const task = await adapter.submit(request);
    const completed = await adapter.poll(task);
    expect(completed.status).toBe("succeeded");
    expect(await adapter.extractOutputs(completed.result)).toMatchObject([
      { kind: "image", url: "https://api.mikoto.vip/generated.png" },
    ]);
    await adapter.submit({
      ...request,
      operation: "image.edit",
      assets: [
        {
          id: "img",
          kind: "image",
          mimeType: "image/png",
          url: "https://api.mikoto.vip/input.png",
        },
      ],
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      (await adapter.validate({ ...request, model: "not-scanned" })).valid,
    ).toBe(false);
  });

  it("copies video overrides instead of falling through to the image endpoint", () => {
    const connection = {
      provider: "rest",
      config: mikotoConnectionConfig(MIKOTO_SEEDANCE_GROUP),
    };
    const result = bindScannedModelProtocols(connection, [
      scanned("seedance-3.0", ["video.generate", "video.image-to-video"]),
    ]);
    expect(result.models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(
      result.connector?.modelOverrides?.["seedance-3.0"]?.submit?.path,
    ).toBe("/v1/videos");
    expect(result.connector?.modelOverrides?.["seedance-3.0"]?.poll?.path).toBe(
      "/v1/videos/{taskId}",
    );
    expect(result.connector?.models?.map((m) => m.id)).toEqual([
      "seedance-3.0",
    ]);
  });

  it("retains explicit permission denials and never routes chat models as images", () => {
    const connection = {
      provider: "rest",
      config: mikotoConnectionConfig(MIKOTO_IMAGE_GROUP),
    };
    const denied = {
      ...scanned("gpt-image-blocked"),
      metadata: {
        canvasRunnable: false,
        canvasUnavailableReason: "当前分组未开通图片生成（已确认上游 403）",
      },
    };
    const result = bindScannedModelProtocols(connection, [
      denied,
      scanned("claude-chat", []),
    ]);
    expect(
      result.models.every((m) => m.metadata?.canvasRunnable === false),
    ).toBe(true);
    expect(result.connector?.models).toEqual([]);
  });

  it("removes models that disappeared and supports repeated refreshes", () => {
    const connection = {
      provider: "rest",
      config: mikotoConnectionConfig(MIKOTO_IMAGE_GROUP),
    };
    const first = bindScannedModelProtocols(connection, [
      scanned("gpt-image-2.5-flare"),
    ]);
    const saved = {
      provider: "rest",
      config: {
        ...connection.config,
        connector: first.connector,
        modelProtocolTemplate: first.templateConnector,
      },
    };
    const second = bindScannedModelProtocols(saved, first.models);
    expect(second.models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(bindScannedModelProtocols(saved, []).connector?.models).toEqual([]);
    const empty = {
      ...saved,
      config: {
        ...saved.config,
        connector: bindScannedModelProtocols(saved, []).connector,
      },
    };
    expect(
      bindScannedModelProtocols(empty, [scanned("gpt-image-new")]).models[0]
        ?.metadata?.canvasRunnable,
    ).toBe(true);
  });

  it("binds newly scanned Gemini image models to the native group", () => {
    const connection = {
      provider: "weai",
      config: mikotoConnectionConfig(MIKOTO_GEMINI_GROUP),
    };
    const result = bindScannedModelProtocols(connection, [
      scanned("gemini-new-image-preview"),
      scanned("gpt-image-2.5-flare"),
    ]);
    expect(result.models[0]?.metadata).toMatchObject({
      canvasRunnable: true,
      protocol: "gemini-generate-content",
    });
    expect(result.models[1]?.metadata?.canvasRunnable).toBe(false);
  });

  it("submits a scanned Gemini model through generateContent while rejecting unscanned IDs", async () => {
    const config = mikotoConnectionConfig(MIKOTO_GEMINI_GROUP);
    const id = "gemini-new-image-preview";
    const bound = bindScannedModelProtocols({ provider: "weai", config }, [
      scanned(id),
    ]);
    const fetch = vi.fn(async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: Buffer.from("mock").toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "group",
          provider: "weai",
          apiKey: "mock",
          baseUrl: "https://api.mikoto.vip",
          settings: {
            ...config,
            modelCatalogModels: bound.models,
            scannedModelIds: [id],
          },
        },
      ]),
      { fetch },
    );
    const request = {
      connectionId: "group",
      model: id,
      operation: "image.generate" as const,
      prompt: "test",
      parameters: { image_size: "1K" },
      idempotencyKey: "native-scan",
    };
    expect((await adapter.validate(request)).valid).toBe(true);
    await adapter.submit(request);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(
      `https://api.mikoto.vip/v1beta/models/${id}:generateContent`,
    );
    expect(
      (await adapter.validate({ ...request, model: "gemini-unscanned-image" }))
        .valid,
    ).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  GenericRestAdapter,
  WeAIImageAdapter,
  StaticConnectionResolver,
  type ModelDescriptor,
} from "@super-canvas/providers";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { parametersWithDefaults } from "./model-parameters";
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
  it("applies current exact-group size and quality limits to cached canvas models", () => {
    const cached: ModelDescriptor = { id: "gpt-image-2.5-flare", name: "Cached", operations: ["image.generate", "image.edit"],
      parameters: [{ key: "size", label: "尺寸", control: "dimensions", default: "3840x2160", options: [{ label: "4K", value: "3840x2160" }] }],
      metadata: { canvasRunnable: true } };
    const oneK = bindScannedModelProtocols({ provider: "openai", config: { baseUrl: "https://token.secure-skill.com", modelGroup: "gpt-image-2.5" } }, [cached]).models[0]!;
    expect(oneK.parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toEqual(["1024x1024", "1536x1024", "1024x1536"]);
    const extended = bindScannedModelProtocols({ provider: "openai", config: { baseUrl: "https://token.secure-skill.com", modelGroup: "image2.5特价" } }, [cached]).models[0]!;
    expect(extended.metadata?.imageSizeContract).toBeUndefined();
    const fixedQuality = bindScannedModelProtocols({ provider: "openai", config: { baseUrl: "https://token.secure-skill.com", modelGroup: "image-2-1k" } },
      [{ ...cached, id: "gpt-image-2", parameters: [{ key: "quality", label: "质量", control: "select", default: "high" }] }]).models[0]!;
    expect(fixedQuality.parameters?.some(p => p.key === "quality")).toBe(false);
  });
  it.each(["grok-video1.5-fast", "grok-imagine-video-1.5（按次）"])("requires an exact Chentu contract for inferred native video %s", id => {
    const model: ModelDescriptor = { id, name: id, operations: ["video.generate", "video.image-to-video"], outputKinds: ["video"],
      metadata: { canvasRunnable: true, operationsSource: "inferred", priceLabel: "¥0.59/请求" } };
    const result = bindScannedModelProtocols({ provider: "openai", config: { baseUrl: "https://tu.988236.xyz", modelGroup: "grok纯享视频" } }, [model]).models[0]!;
    expect(result.metadata).toMatchObject({ canvasRunnable: false, parameterControlsUnavailable: true, priceLabel: "¥0.59/请求" });
    expect(result.parameters).toEqual([]);
    expect(result.outputKinds).toEqual(["video"]);
  });
  it("requires an endpoint for declared native Chentu controls and preserves exact models and upstream denials", () => {
    const connection = { provider: "openai", config: { baseUrl: "https://tu.988236.xyz", modelGroup: "视频" } };
    const model: ModelDescriptor = { id: "future-video-schema", name: "Future", operations: ["video.generate"], outputKinds: ["video"],
      parameters: [{ key: "duration", label: "时长", control: "select", options: [{ label: "6秒", value: 6 }] }],
      metadata: { canvasRunnable: true, operationsSource: "declared" } };
    const result = bindScannedModelProtocols(connection, [model]).models[0]!;
    expect(result.metadata?.canvasRunnable).toBe(false);
    expect(result.parameters).toEqual([]);
    const documented = bindScannedModelProtocols(connection, [{ ...model, id: "seedance-2.0-720p", parameters: undefined,
      metadata: { canvasRunnable: true, operationsSource: "inferred" } }]).models[0]!;
    expect(documented.metadata?.canvasRunnable).toBe(true);
    expect(documented.parameters?.length).toBeGreaterThan(0);
    const denied = { ...model, parameters: undefined, metadata: { canvasRunnable: false, canvasUnavailableReason: "当前分组未开通视频生成（已确认上游 403）" } };
    expect(bindScannedModelProtocols(connection, [denied]).models[0]?.metadata).toMatchObject(denied.metadata);
  });
  it("removes a stale guessed Chentu alias schema while preserving a real exact saved contract", () => {
    const live = scanned("veo-new-alias", ["video.generate"]);
    const stale = { id: live.id, name: "Old guess", operations: ["video.generate"], outputKinds: ["video"],
      parameters: [{ key: "duration", label: "Duration", control: "number", min: 1, max: 30 }], metadata: { canvasRunnable: true } };
    const config = { baseUrl: "https://tu.988236.xyz/v1", connector: { submit: { path: "/v1/videos", mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }] },
      output: { kind: "video", path: "$.video_url" }, models: [stale] } };
    const pending = bindScannedModelProtocols({ provider: "rest", config }, [live]).models[0]!;
    expect(pending.metadata).toMatchObject({ canvasRunnable: false, parameterControlsUnavailable: true });
    expect(pending.parameters).toEqual([]);
    const verified = { ...stale, parameters: [{ key: "duration", label: "Verified duration", control: "select", options: [{ value: 6, label: "6秒" }] }],
      metadata: { canvasRunnable: true, operationsSource: "declared", source: "manual" } };
    const exact = bindScannedModelProtocols({ provider: "rest", config: { ...config, connector: { ...config.connector, models: [verified] } } }, [live]).models[0]!;
    expect(exact.metadata?.canvasRunnable).toBe(true);
    expect(exact.metadata?.parameterControlsUnavailable).toBeUndefined();
    expect(exact.parameters).toEqual(verified.parameters);
  });
  it("does not inherit an image endpoint for a cached music ID or borrow a sibling music route", () => {
    const music = scanned("suno-v5", ["music.generate"]);
    const config = { baseUrl: "https://supplier.example", connector: { submit: { path: "/v1/images/generations", mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }] }, output: { kind: "image", path: "$.data" },
      models: [{ id: "suno-v5", name: "Old", operations: ["music.generate"], outputKinds: ["audio"], metadata: { canvasRunnable: true } }] } };
    expect(bindScannedModelProtocols({ provider: "rest", config }, [music]).models[0]?.metadata?.canvasRunnable).toBe(false);
    const sameMedia = { ...config, connector: { ...config.connector, submit: { path: "/v1/music", mappings: config.connector.submit.mappings }, output: { kind: "audio", path: "$.audio_url" },
      models: [{ id: "suno-v4", name: "Old", operations: ["music.generate"], outputKinds: ["audio"], metadata: { canvasRunnable: true } }] } };
    expect(bindScannedModelProtocols({ provider: "rest", config: sameMedia }, [music]).models[0]?.metadata?.canvasRunnable).toBe(false);
  });
  it("preserves an exact saved music transport with audio output", () => {
    const music = scanned("suno-v5", ["music.generate"]);
    const config = { baseUrl: "https://supplier.example", connector: { submit: { path: "/v1/music", mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }] }, output: { kind: "audio", path: "$.audio_url" },
      models: [{ id: music.id, name: "Saved", operations: ["music.generate"], outputKinds: ["audio"], metadata: { canvasRunnable: true } }] } };
    const bound = bindScannedModelProtocols({ provider: "rest", config }, [music]);
    expect(bound.models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(bound.connector?.submit.path).toBe("/v1/music");
    expect(bound.models[0]?.outputKinds).toEqual(["audio"]);
  });
  it("does not inherit an Omni or stale generic video body for We-AI SD2", () => {
    const seedance = scanned("seedance-2.0-1080p", ["video.generate"]);
    const config = { baseUrl: "https://video.we-token.cc", connector: { submit: { path: "/v1/videos", mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }, { target: "/seconds", source: { kind: "request", path: "$.parameters.duration" } }] },
      output: { kind: "video", path: "$.video_url" }, models: [{ id: seedance.id, name: "Old", operations: ["video.generate"], outputKinds: ["video"], metadata: { canvasRunnable: true } }] } };
    expect(bindScannedModelProtocols({ provider: "rest", config }, [seedance]).models[0]?.metadata?.canvasRunnable).toBe(false);
    const withSavedContract = { ...config, connector: { ...config.connector, submit: { ...config.connector.submit, path: "/my-verified-sd2-path", mappings: [...config.connector.submit.mappings,
      { target: "/duration_seconds", source: { kind: "request", path: "$.parameters.duration_seconds" } }, { target: "/reference_images", source: { kind: "request", path: "$.parameters.reference_images" } }] } } };
    expect(bindScannedModelProtocols({ provider: "rest", config: withSavedContract }, [seedance]).models[0]?.metadata?.canvasRunnable).toBe(true);
  });
  it("applies Secure's distinct shared-ID contracts using the current connection group", () => {
    const model = scanned("seedance-2.5", ["video.generate", "video.image-to-video"]);
    const standard = bindScannedModelProtocols({ provider: "openai", config: { baseUrl: "https://token.secure-skill.com/v1", modelGroup: "sd特价分组1" } }, [model]).models[0]!;
    expect(standard.limits?.maxInputImages).toBe(30);
    expect(standard.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min: 4, max: 30 });
    const vivid = bindScannedModelProtocols({ provider: "openai", config: { baseUrl: "https://token.secure-skill.com/v1", modelGroup: "vividai-video" } }, [model]).models[0]!;
    expect(vivid.parameters?.find(parameter => parameter.key === "duration")?.options?.map(option => option.value)).toEqual([15]);
    const unknown = bindScannedModelProtocols({ provider: "openai", config: { baseUrl: "https://token.secure-skill.com/v1" } }, [model]).models[0]!;
    expect(unknown.metadata?.canvasRunnable).toBe(false);
  });
  it("does not allow cached image transports to override a Key's declared text output", () => {
    const connection = { provider: "rest", config: { baseUrl: "https://unrelated.example", connector: {
      submit: { path: "/images", mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }] },
      models: [{ id: "gpt-image-2", name: "Old image", operations: ["image.generate"], outputKinds: ["image"] }],
    } } };
    const live: ModelDescriptor = { id: "gpt-image-2", name: "Live text", operations: [], outputKinds: ["text"],
      metadata: { canvasRunnable: false, canvasUnavailableReason: "尚未验证画布协议", outputKindsSource: "declared", operationsSource: "inferred" } };
    const bound = bindScannedModelProtocols(connection, [live]);
    expect(bound.models[0]?.operations).toEqual([]);
    expect(bound.models[0]?.outputKinds).toEqual(["text"]);
    expect(bound.connector?.models).toEqual([]);
  });
  it("adds documented video parameters for a returned FriModel ID but never repairs a permission denial", () => {
    const connection = { provider: "openai", config: { baseUrl: "https://api.frimodel.com/v1", modelGroup: "veo" } };
    const visible = scanned("videos-mini", ["video.generate"]);
    const models = bindScannedModelProtocols(connection, [visible]).models;
    expect(models).toHaveLength(1);
    expect(models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(models[0]?.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min: 4, max: 15 });
    const denied = { ...visible, metadata: { canvasRunnable: false, canvasUnavailableReason: "403 权限拒绝" } };
    expect(bindScannedModelProtocols(connection, [denied]).models[0]?.metadata?.canvasRunnable).toBe(false);
  });
  it("repairs the current Chuangxiang GPT SKU's single output and nine-reference JSON contract in saved caches", () => {
    const connection = { provider: "openai", config: { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图", usage: "canvas" } };
    const model: ModelDescriptor = { id: "gpt-image-2.5-flare-4k", name: "创想4K", operations: ["image.generate"], metadata: { canvasRunnable: true } };
    const result = bindScannedModelProtocols(connection, [model]).models[0]!;
    expect(result.limits).toMatchObject({ maxInputImages: 9, maxOutputImages: 1 });
    expect(result.parameters?.find(parameter => parameter.key === "n")).toMatchObject({ max: 1 });
    expect(result.parameters?.find(parameter => parameter.key === "quality")?.default).toBe("max");
    expect(result.metadata).toMatchObject({ imageSupportedResolutions: ["4K"], imageUnsupportedResolutions: ["1K", "2K"] });
  });
  it("repairs a saved pDog Image2 cache to the documented high quality and single-image contract", () => {
    const connection = { provider: "openai", config: { baseUrl: "https://ai.whyshy.cn", modelGroup: "1K2K4K(超分组)", usage: "canvas" } };
    const cached: ModelDescriptor = { id: "gpt-image-2", name: "Image2", operations: ["image.generate", "image.edit"],
      parameters: [{ key: "quality", label: "质量", control: "select", default: "max", options: [{ value: "max", label: "max" }] }], metadata: { canvasRunnable: true } };
    const repaired = bindScannedModelProtocols(connection, [cached]).models[0]!;
    expect(repaired.parameters?.find(parameter => parameter.key === "quality")).toMatchObject({ default: "high", options: [
      { value: "low", label: "low" }, { value: "medium", label: "medium" }, { value: "high", label: "high" },
    ] });
    expect(repaired.parameters?.find(parameter => parameter.key === "n")).toMatchObject({ min: 1, max: 1 });
    expect(repaired.parameters?.find(parameter => parameter.key === "size")?.options).toContainEqual({ value: "2048x1152", label: "2K · 16:9 · 2048x1152" });
    expect(cached.parameters?.[0]?.default).toBe("max");
  });
  it("keeps pDog Image2.5 at the user's max candidate without claiming supplier verification", () => {
    const connection = { provider: "openai", config: { baseUrl: "https://ai.whyshy.cn", modelGroup: "1K2K4K(超分组)", usage: "canvas" } };
    const model: ModelDescriptor = { id: "gpt-image-2.5-flare", name: "Image2.5", operations: ["image.generate"], metadata: { canvasRunnable: true } };
    const result = bindScannedModelProtocols(connection, [model]).models[0]!;
    expect(result.parameters?.find(parameter => parameter.key === "quality")?.default).toBe("max");
    expect(result.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    expect(result.metadata?.qualitySupport).toBe("assumed");
  });
  it.each([
    ["https://genimage.pro/v1", "geminiResponseUrl"],
    ["https://api.frimodel.com/v1", "gemini_image"],
    ["https://token.secure-skill.com/v1", "banana-全系列"],
    ["https://asian-acc.we-token.cc/v1", "adobe香蕉"],
    ["https://vapi.chuangxiangai.asia", "生图"],
  ])("repairs saved Banana controls for %s without changing GPT", (baseUrl, modelGroup) => {
    const connection = { provider: "openai", config: { baseUrl, modelGroup, usage: "canvas" } };
    const gpt: ModelDescriptor = { id: "gpt-image-2", name: "GPT", operations: ["image.generate", "image.edit"], metadata: { canvasRunnable: true } };
    const oldBanana: ModelDescriptor = { id: "gemini-3-pro-image-preview", name: "Banana", operations: ["image.generate"], metadata: { canvasRunnable: true }, parameters: [
      { key: "size", label: "尺寸", control: "dimensions", default: "auto" },
      { key: "quality", label: "质量", control: "select", default: "max" },
    ] };
    const expectedGpt = bindScannedModelProtocols(connection, [gpt]).models[0];
    const bound = bindScannedModelProtocols(connection, [gpt, oldBanana]);
    expect(bound.models[0]).toEqual(expectedGpt);
    const banana = bound.models[1]!;
    expect(banana.operations).toEqual(["image.generate", "image.edit"]);
    expect(banana.parameters?.map(p => p.key)).toEqual(["aspect_ratio", "image_size", "n"]);
    expect(parametersWithDefaults(banana.parameters!, { size: "auto", size_tier: "2K", quality: "max" })).toEqual({ aspect_ratio: "auto", image_size: "2K", n: 1 });
    expect(parametersWithDefaults(banana.parameters!, { size: "3072x2048", quality: "high" })).toEqual({ aspect_ratio: "3:2", image_size: "2K", n: 1 });
    expect(parametersWithDefaults(banana.parameters!, { image_size: "1K", size_tier: "4K", aspect_ratio: "9:16" })).toEqual({ aspect_ratio: "9:16", image_size: "1K", n: 1 });
    expect(bindScannedModelProtocols(connection, bound.models).models[1]).toEqual(banana);
  });
  it("binds image transport in a legacy agent Key without adding unreturned template IDs or converting chat models", () => {
    const connection = { provider: "rest", config: { usage: "agent", protocol: "responses", connector: {
      submit: { path: "/images", mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }] },
      models: ["gpt-image-old", "gpt-image-template-only"].map(id => ({ id, name: id, operations: ["image.generate"] })),
    } } };
    const result = bindScannedModelProtocols(connection, [scanned("gpt-image-new", ["image.generate"]), scanned("gpt-6-astra", [])]);
    expect(result.models.map(model => model.id)).toEqual(["gpt-image-new", "gpt-6-astra"]);
    expect(result.models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(result.models[1]?.operations).toEqual([]);
    expect(result.connector?.models?.map(model => model.id)).toEqual(["gpt-image-new"]);
    expect(connection.config.protocol).toBe("responses");
  });
  it("binds Genimage's declared sizes and highest-quality probe without replacing group prices", () => {
    const input: ModelDescriptor = { id: "gpt-image-2.5-flare", name: "Flare", operations: ["image.generate"],
      metadata: { canvasRunnable: true }, pricing: { kind: "per-request", unitAmount: 0.08, currency: "USD", confidence: "exact", checkedAt: "2026-09-22" } };
    const result = bindScannedModelProtocols({ provider: "openai", config: {
      baseUrl: "https://genimage.pro/v1", modelGroup: "geminiResponseUrl", usage: "canvas",
    } }, [input]).models[0]!;
    expect(result.parameters?.find(p => p.key === "size")?.options).toHaveLength(34);
    expect(result.parameters?.find(p => p.key === "quality")?.default).toBe("max");
    expect(result.pricing).toEqual(input.pricing);
    expect(result.operations).toEqual(["image.generate"]);
    expect(result.metadata?.imageTestedQualities).toBeUndefined();
  });
  it("keeps a newly scanned model's own size and quality when binding family transport", () => {
    const parameters = [{ key: "size", label: "2K", control: "select" as const, options: [{ label: "2K", value: "2048x2048" }] }];
    const connection = { provider: "rest", config: { connector: {
      submit: { path: "/images", method: "POST", mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }] },
      models: [{ id: "gpt-image-old", name: "Old", operations: ["image.generate"], parameters: [{ key: "size", label: "1K", control: "text", default: "1024x1024" }] }],
    } } };
    const result = bindScannedModelProtocols(connection, [{ ...scanned("gpt-image-new", ["image.generate"]), parameters, limits: { maxInputImages: 3 } }]);
    expect(result.models[0]?.parameters).toEqual(parameters);
    expect(result.models[0]?.limits).toEqual({ maxInputImages: 3 });
  });
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

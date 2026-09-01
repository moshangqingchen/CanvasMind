import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import {
  coerceParameterInput,
  isExactSizeParameterDescriptor,
  modelDescriptorFromConnectionConfig,
  modelDescriptorForSavedSelection,
  modelDescriptorForSavedSelectionOrDefault,
  modelDescriptorListsEqual,
  parameterDescriptorsFor,
  parametersWithDefaults,
  normalizedParametersForModel,
  parameterDescriptorsForValues,
  setParameterValue,
} from "./model-parameters";

describe("model parameter helpers", () => {
  it("provides practical image and video defaults", () => {
    const image = parameterDescriptorsFor("image-generation", "openai");
    const video = parameterDescriptorsFor("video-generation", "runway");

    expect(parametersWithDefaults(image)).toMatchObject({
      aspect_ratio: "auto",
      quality: "high",
      n: 1,
    });
    expect(parametersWithDefaults(video)).toMatchObject({
      duration: 5,
      ratio: "1280:720",
    });
    expect(video.some((parameter) => parameter.key === "n")).toBe(false);
  });

  it("replaces a stale select value when switching to a fixed model tier", () => {
    expect(
      parametersWithDefaults(
        [
          {
            key: "imageSize",
            label: "分辨率",
            control: "select",
            default: "4K",
            options: [{ label: "4K（型号固定）", value: "4K" }],
          },
        ],
        { imageSize: "1K" },
      ),
    ).toEqual({ imageSize: "4K" });
  });

  it("uses a REST model's declared fields and filters unrelated operations", () => {
    const model: ModelDescriptor = {
      id: "custom-video",
      name: "Custom Video",
      operations: ["video.generate"],
      parameters: [
        {
          key: "fps",
          label: "FPS",
          control: "number",
          valueType: "integer",
          default: 24,
          operations: ["video.generate"],
        },
        {
          key: "image_only",
          label: "Image only",
          control: "toggle",
          operations: ["image.generate"],
        },
      ],
    };

    expect(
      parameterDescriptorsFor("video-generation", "rest", model).map(
        (parameter) => parameter.key,
      ),
    ).toEqual(["fps"]);
  });

  it("does not invent controls when a video model marks them unavailable", () => {
    const model: ModelDescriptor = {
      id: "unparameterized-video",
      name: "Unparameterized Video",
      operations: ["video.generate"],
      parameters: [],
      metadata: { parameterControlsUnavailable: true },
    };

    expect(
      parameterDescriptorsFor("video-generation", "rest", model),
    ).toEqual([]);
    expect(
      normalizedParametersForModel("video-generation", "rest", model, {
        duration: 26,
        aspect_ratio: "16:9",
        resolution: "2k",
      }),
    ).toEqual({});
  });

  it("shows image count only when the model declares a multi-image limit", () => {
    const model = (
      max: number,
      fixedOutputCount?: number,
    ): ModelDescriptor => ({
      id: `image-${max}`,
      name: `Image ${max}`,
      operations: ["image.generate"],
      metadata: fixedOutputCount === undefined ? {} : { fixedOutputCount },
      parameters: [
        {
          key: "size",
          label: "尺寸",
          control: "text",
        },
        {
          key: "n",
          label: "生成张数",
          control: "number",
          valueType: "integer",
          min: 1,
          max,
        },
      ],
    });

    expect(
      parameterDescriptorsFor("image-generation", "rest", model(1)).map(
        (parameter) => parameter.key,
      ),
    ).toEqual(["size"]);
    expect(
      parameterDescriptorsFor("image-generation", "rest", model(4)).map(
        (parameter) => parameter.key,
      ),
    ).toEqual(["size", "n"]);
    expect(
      parameterDescriptorsFor("image-generation", "rest", model(10, 1)).map(
        (parameter) => parameter.key,
      ),
    ).toEqual(["size"]);
  });

  it("does not infer image batching for REST or We-AI without a model declaration", () => {
    expect(
      parameterDescriptorsFor("image-generation", "rest").some(
        (parameter) => parameter.key === "n",
      ),
    ).toBe(false);
    expect(
      parameterDescriptorsFor("image-generation", "weai").some(
        (parameter) => parameter.key === "n",
      ),
    ).toBe(false);
    expect(
      parameterDescriptorsFor("image-generation", "fake").some(
        (parameter) => parameter.key === "n",
      ),
    ).toBe(true);
  });

  it("honors a fixed single-output metadata flag in fallback parameters", () => {
    const model: ModelDescriptor = {
      id: "fixed-image",
      name: "Fixed Image",
      operations: ["image.generate"],
      metadata: { fixedOutputCount: 1 },
    };
    expect(
      parameterDescriptorsFor("image-generation", "openai", model).some(
        (parameter) => parameter.key === "n",
      ),
    ).toBe(false);
  });

  it("removes stale batch counts from fixed-output models and clamps supported counts", () => {
    const fixed: ModelDescriptor = {
      id: "fixed-image",
      name: "Fixed Image",
      operations: ["image.generate"],
      metadata: { fixedOutputCount: 1 },
      parameters: [
        {
          key: "n",
          label: "数量",
          control: "number",
          valueType: "integer",
          min: 1,
          max: 1,
          default: 1,
        },
      ],
    };
    const batch: ModelDescriptor = {
      ...fixed,
      id: "batch-image",
      metadata: {},
      parameters: [
        {
          key: "n",
          label: "数量",
          control: "number",
          valueType: "integer",
          min: 1,
          max: 4,
          default: 1,
        },
      ],
    };

    expect(
      normalizedParametersForModel("image-generation", "rest", fixed, {
        n: 3,
      }),
    ).not.toHaveProperty("n");
    expect(
      normalizedParametersForModel("image-generation", "rest", batch, {
        n: 99,
      }),
    ).toMatchObject({ n: 4 });
  });

  it("coerces typed form values and removes API-default values", () => {
    const descriptor = {
      key: "n",
      label: "数量",
      control: "number" as const,
      valueType: "integer" as const,
    };
    expect(coerceParameterInput(descriptor, "3.8")).toBe(3);
    expect(
      setParameterValue({ n: 2, quality: "high" }, "n", undefined),
    ).toEqual({ quality: "high" });
  });

  it("does not restore a size default beside an explicitly saved aspect ratio", () => {
    const descriptors = [
      {
        key: "size",
        label: "尺寸",
        control: "text" as const,
        default: "1024x1024",
      },
      {
        key: "aspect_ratio",
        label: "画面比例",
        control: "select" as const,
        default: "16:9",
      },
    ];

    expect(
      parametersWithDefaults(descriptors, { aspect_ratio: "9:16" }),
    ).toEqual({ aspect_ratio: "9:16" });
    expect(parametersWithDefaults(descriptors, { size: "2160x3840" })).toEqual({
      size: "2160x3840",
    });
    expect(parametersWithDefaults(descriptors)).toEqual({ size: "1024x1024" });
  });

  it("keeps Gemini resolution tiers independent from aspect ratio", () => {
    const descriptors = [
      {
        key: "size",
        label: "输出分辨率",
        control: "select" as const,
        default: "auto",
        options: [
          { label: "自动（提示词优先）", value: "auto" },
          { label: "1K", value: "1K" },
          { label: "2K", value: "2K" },
          { label: "4K", value: "4K" },
        ],
      },
      {
        key: "aspect_ratio",
        label: "画面比例",
        control: "select" as const,
        default: "auto",
      },
    ];

    expect(isExactSizeParameterDescriptor(descriptors[0]!)).toBe(false);
    expect(parametersWithDefaults(descriptors)).toEqual({
      size: "auto",
      aspect_ratio: "auto",
    });
    expect(
      parametersWithDefaults(descriptors, {
        size: "4K",
        aspect_ratio: "16:9",
      }),
    ).toEqual({ size: "4K", aspect_ratio: "16:9" });
  });

  it("preserves the internal tier used by automatic exact-size controls", () => {
    const descriptors = [
      {
        key: "size",
        label: "输出分辨率",
        control: "dimensions" as const,
        default: "auto",
        options: [
          { label: "自动", value: "auto" },
          { label: "1K 方图", value: "1024x1024" },
          { label: "2K 方图", value: "2048x2048" },
          { label: "4K 方图", value: "2160x2160" },
        ],
      },
    ];

    expect(
      parametersWithDefaults(descriptors, { size: "auto", size_tier: "4k" }),
    ).toEqual({ size: "auto", size_tier: "4K" });
  });

  it("defaults tiered automatic dimensions to the highest available tier", () => {
    const descriptors = [
      {
        key: "size",
        label: "输出分辨率",
        control: "dimensions" as const,
        default: "auto",
        options: [
          { label: "自动", value: "auto" },
          { label: "1K 方图", value: "1024x1024" },
          { label: "2K 方图", value: "2048x2048" },
          { label: "4K 方图", value: "2160x2160" },
        ],
      },
    ];

    expect(parametersWithDefaults(descriptors)).toEqual({
      size: "auto",
      size_tier: "4K",
    });
    expect(
      parametersWithDefaults(descriptors, {
        size: "1024x1024",
      }),
    ).toEqual({ size: "1024x1024" });
    expect(
      parametersWithDefaults(descriptors, {
        size: "auto",
        size_tier: "2K",
      }),
    ).toEqual({ size: "auto", size_tier: "2K" });
  });

  it("reads a connector's configured default model before remote discovery", () => {
    const descriptor = modelDescriptorFromConnectionConfig(
      {
        connector: {
          models: [
            {
              id: "image-4k",
              name: "Image 4K",
              operations: ["image.generate"],
              isDefault: true,
              metadata: { fixedOutputCount: 1 },
              parameters: [
                {
                  key: "size",
                  label: "尺寸",
                  control: "text",
                  default: "3840x2160",
                },
              ],
            },
          ],
        },
      },
      "image-4k",
    );
    expect(descriptor?.id).toBe("image-4k");
    expect(
      parametersWithDefaults(
        parameterDescriptorsFor("image-generation", "rest", descriptor),
      ),
    ).toEqual({ size: "3840x2160" });
  });

  it("migrates legacy Adobe virtual IDs to real fixed-quality models", () => {
    const models: ModelDescriptor[] = ["low", "medium", "high"].map(
      (quality) => ({
        id: `gpt-image-2-${quality}`,
        name: `GPT Image 2 ${quality.toUpperCase()}`,
        operations: ["image.generate"],
        isDefault: quality === "low",
        metadata: {
          fixedQuality: quality,
          modelGroup: "生图-openai-adobe-按次",
        },
        parameters: [
          {
            key: "size",
            label: "输出分辨率",
            control: "dimensions",
            default: "auto",
            options: [
              { label: "1K", value: "1024x1024" },
              { label: "2K", value: "2048x2048" },
              { label: "4K", value: "2160x2160" },
            ],
          },
        ],
      }),
    );

    expect(
      modelDescriptorForSavedSelection(models, "gpt-image-2-high")?.id,
    ).toBe("gpt-image-2-high");
    expect(
      modelDescriptorForSavedSelection(models, "gpt-image-2-high::4k")?.id,
    ).toBe("gpt-image-2-high");
    expect(
      modelDescriptorForSavedSelection(models, "gpt-image-2::2k", {
        quality: "medium",
      })?.id,
    ).toBe("gpt-image-2-medium");
    expect(
      modelDescriptorForSavedSelection(models, "gpt-image-2", {
        quality: "invalid",
      })?.id,
    ).toBe("gpt-image-2-low");
  });

  it("canonicalizes documented Gemini preview aliases", () => {
    const models: ModelDescriptor[] = [
      {
        id: "gemini-3-pro-image",
        name: "Gemini 3 Pro Image",
        operations: ["image.generate", "image.edit"],
      },
      {
        id: "gemini-3.1-flash-image",
        name: "Gemini 3.1 Flash Image",
        operations: ["image.generate", "image.edit"],
        isDefault: true,
      },
    ];

    expect(
      modelDescriptorForSavedSelection(models, "gemini-3-pro-image-preview")
        ?.id,
    ).toBe("gemini-3-pro-image");
    expect(
      modelDescriptorForSavedSelection(models, "gemini-3.0-pro-image"),
    ).toBeUndefined();
  });

  it("never replaces an explicit model from a transient catalog snapshot", () => {
    const models: ModelDescriptor[] = [
      {
        id: "minimax-h3-2k",
        name: "MiniMax H3 2K",
        operations: ["video.generate"],
        isDefault: true,
      },
    ];

    expect(
      modelDescriptorForSavedSelectionOrDefault(models, "happyhouse-1.1"),
    ).toBeUndefined();
    expect(modelDescriptorForSavedSelectionOrDefault(models, "")?.id).toBe(
      "minimax-h3-2k",
    );
    expect(
      modelDescriptorForSavedSelectionOrDefault(models, undefined)?.id,
    ).toBe("minimax-h3-2k");
  });

  it("detects whether a catalog refresh materially changed model options", () => {
    const models: ModelDescriptor[] = [
      {
        id: "happyhouse-1.1",
        name: "happyhouse-1.1（¥2.90/次）",
        operations: ["video.generate"],
      },
    ];

    expect(modelDescriptorListsEqual(models, structuredClone(models))).toBe(
      true,
    );
    expect(
      modelDescriptorListsEqual(models, [
        { ...models[0]!, name: "happyhouse-1.1（价格已更新）" },
      ]),
    ).toBe(false);
  });

  it("applies opt-in resolution-specific duration bounds", () => {
    const model: ModelDescriptor = {
      id: "seedance-2.0-mini",
      name: "Seedance 2.0 Mini",
      operations: ["video.generate"],
      parameters: [
        {
          key: "duration",
          label: "时长（秒）",
          control: "number",
          valueType: "integer",
          min: 1,
          max: 15,
          default: 5,
        },
        {
          key: "resolution",
          label: "输出分辨率",
          control: "select",
          options: [
            { label: "480p", value: "480p" },
            { label: "720p", value: "720p" },
          ],
        },
      ],
      metadata: {
        clampNumericParameters: true,
        durationMaxByResolution: { "720p": 12 },
      },
    };

    expect(
      parameterDescriptorsForValues(
        "video-generation",
        "rest",
        model,
        { resolution: "720p" },
      ).find((descriptor) => descriptor.key === "duration")?.max,
    ).toBe(12);
    expect(
      normalizedParametersForModel("video-generation", "rest", model, {
        duration: 1000,
        resolution: "720p",
      }),
    ).toMatchObject({ duration: 12, resolution: "720p" });
    expect(
      normalizedParametersForModel("video-generation", "rest", model, {
        duration: 1000,
        resolution: "480p",
      }),
    ).toMatchObject({ duration: 15, resolution: "480p" });
  });
});

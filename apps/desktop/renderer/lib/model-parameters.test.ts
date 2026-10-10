import React from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { jiasuVideoRequestIssues, remainingVideoModel, type ModelDescriptor } from "@super-canvas/providers";
import { applyJiasuImageCapabilities, jiasuImageRequestIssues, normalizeJiasuImageParameters } from "@super-canvas/providers/jiasu-image-contract";
import type { CanvasNode } from "../components/types";
import type { ProviderConnectionView } from "./client-api";
import { NativeImageResolutionFields } from "../components/native-image-resolution-fields";
import { setParameterValueWithSizeExclusivity } from "../components/node-parameter-fields";
import {
  coerceParameterInput,
  isExactSizeParameterDescriptor,
  modelDescriptorFromConnectionConfig,
  modelDescriptorsFromConnectionConfig,
  modelDescriptorForSavedSelection,
  modelDescriptorForSavedSelectionOrDefault,
  modelDescriptorListsEqual,
  parameterDescriptorsFor,
  parametersWithDefaults,
  normalizedParametersForModel,
  parameterValueForModel,
  parameterDescriptorsForValues,
  setParameterValue,
} from "./model-parameters";

describe("Jiasu saved video parameters", () => {
  const ids = ["sd-2.5-J2", "doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628"];
  const descriptor = (id: string) => remainingVideoModel("jiasu", id, {
    id, name: id, operations: ["video.generate"], metadata: { canvasRunnable: true },
  }, { group: "vip" })!;
  const source = (model: ModelDescriptor, parameters: Record<string, unknown>): CanvasNode => ({
    id: "jiasu-saved-video", type: "workflow", position: { x: 0, y: 0 }, data: {
      nodeType: "video-generation", label: "Saved video", provider: "openai", connectionId: "jiasu-parameters",
      model: model.id, qualityMode: "custom", parameters, parts: [],
      inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "video", kind: "video", label: "视频" }],
    },
  });
  const connection = (model: ModelDescriptor): ProviderConnectionView => ({
    id: "jiasu-parameters", name: "Jiasu parameter fixture", provider: "openai", apiKey: "", apiKeySet: true, apiKeyUsable: true,
    config: { baseUrl: "https://ai.jiasuapi.com/v1", modelGroup: "vip", accountKeyGroup: "vip", usage: "canvas",
      defaultModel: model.id, modelScanStatus: "live", scannedModelIds: [model.id], modelCatalogModels: [model] },
  });
  let canvas: Pick<typeof import("../components/canvas-app"), "normalizeGenerationNodeForRun">;
  beforeAll(async () => { vi.stubGlobal("React", React); canvas = await import("../components/canvas-app"); });
  afterAll(() => vi.unstubAllGlobals());

  it.each(ids)("retains saved rejected 480p for %s through reload and run validation", id => {
    const model = descriptor(id);
    const saved = { duration: 5, resolution: "480p", aspect_ratio: "9:16",
      materials: [{ type: "image", url: "https://media.example/reference.png", name: "参考图" }],
      face: { enabled: true, mode: "light" } };
    const original = source(model, saved), restored = JSON.parse(JSON.stringify(original)) as CanvasNode;
    const snapshot = structuredClone(restored);
    const normalized = canvas.normalizeGenerationNodeForRun(restored, [connection(model)], {
      connectionId: "jiasu-parameters", items: [model], authoritative: true,
    });
    expect(normalized.data.parameters).toEqual(saved);
    expect(restored).toEqual(snapshot);
    expect(jiasuVideoRequestIssues({ idempotencyKey: "saved-video-request", connectionId: "jiasu-parameters", operation: "video.generate", model: id,
      prompt: "静止镜头", parameters: normalized.data.parameters }, model, "vip").map(issue => issue.path)).toEqual(["parameters.resolution"]);
  });

  it.each(ids)("preserves legal material and face objects and fills only missing defaults for %s", id => {
    const model = descriptor(id);
    const selected = { resolution: "720p", duration: 5,
      materials: [{ type: "video", url: "https://media.example/reference.mp4", name: "参考视频" }],
      face: { enabled: true, mode: "heavy" } };
    const normalized = normalizedParametersForModel("video-generation", "openai", model, selected);
    expect(normalized).toEqual({ aspect_ratio: "16:9", ...selected });
    expect(jiasuVideoRequestIssues({ idempotencyKey: "legal-video-request", connectionId: "jiasu-parameters", operation: "video.generate", model: id,
      prompt: "静止镜头", parameters: normalized }, model, "vip")).toEqual([]);
    const empty = normalizedParametersForModel("video-generation", "openai", model);
    expect(empty).toMatchObject({ resolution: "720p", aspect_ratio: "16:9" });
    if (id.startsWith("doubao-")) expect(empty).not.toHaveProperty("duration");
    else expect(empty.duration).toBe(30);
  });

  it("keeps the existing explicit model switch path from inheriting unsupported values", () => {
    const model = descriptor("doubao-seedance-2-0-260128");
    const changed = parametersWithDefaults(parameterDescriptorsFor("video-generation", "openai", model), {
      duration: 5, resolution: "480p", aspect_ratio: "2:1", face: { enabled: true, mode: "light" },
    });
    expect(changed).toEqual({ duration: 5, resolution: "720p", aspect_ratio: "16:9" });
    expect(normalizedParametersForModel("video-generation", "openai", model, changed)).toEqual(changed);
  });

  it.each(ids)("uses saved video aliases instead of masking them with new defaults for %s", id => {
    const model = descriptor(id);
    const restored = JSON.parse(JSON.stringify(source(model, { seconds: 5, ratio: "9:16", resolution: "720p" }))) as CanvasNode;
    const normalized = canvas.normalizeGenerationNodeForRun(restored, [connection(model)], {
      connectionId: "jiasu-parameters", items: [model], authoritative: true,
    });
    expect(normalized.data.parameters).toEqual({ seconds: 5, duration: 5, ratio: "9:16", aspect_ratio: "9:16", resolution: "720p" });
    expect(jiasuVideoRequestIssues({ idempotencyKey: "video-alias-request", connectionId: "jiasu-parameters", operation: "video.generate", model: id,
      prompt: "静止镜头", parameters: normalized.data.parameters }, model, "vip")).toEqual([]);
    const conflict = normalizedParametersForModel("video-generation", "openai", model, { duration: 5, seconds: 6, aspect_ratio: "16:9", ratio: "9:16" });
    expect(conflict).toMatchObject({ duration: 5, seconds: 6, aspect_ratio: "16:9", ratio: "9:16" });
    expect(jiasuVideoRequestIssues({ idempotencyKey: "video-alias-conflict", connectionId: "jiasu-parameters", operation: "video.generate", model: id,
      prompt: "静止镜头", parameters: conflict }, model, "vip").map(issue => issue.path)).toEqual(["parameters.duration", "parameters.aspect_ratio"]);
  });

  it("lets explicit video control edits replace only their own old aliases", () => {
    const model = descriptor("sd-2.5-J2");
    const saved = { seconds: 6, ratio: "9:16", duration: 5, aspect_ratio: "16:9", resolution: "720p", face: { enabled: true, mode: "light" } };
    const context = { hasSizeControl: false, hasAspectRatioControl: true, aspectRatioKey: "aspect_ratio", model };
    expect(parameterValueForModel(model, { seconds: 6, ratio: "9:16" }, "duration")).toBe(6);
    expect(parameterValueForModel(model, { seconds: 6, ratio: "9:16" }, "aspect_ratio")).toBe("9:16");
    const durationEdited = setParameterValueWithSizeExclusivity(saved, "duration", 7, context);
    expect(durationEdited).toEqual({ duration: 7, ratio: "9:16", aspect_ratio: "16:9", resolution: "720p", face: saved.face });
    const ratioEdited = setParameterValueWithSizeExclusivity(durationEdited, "aspect_ratio", "1:1", context);
    expect(ratioEdited).toEqual({ duration: 7, aspect_ratio: "1:1", resolution: "720p", face: saved.face });
    expect(jiasuVideoRequestIssues({ idempotencyKey: "video-control-edit", connectionId: "jiasu-parameters", operation: "video.generate", model: model.id,
      prompt: "静止镜头", parameters: ratioEdited }, model, "vip")).toEqual([]);
    expect(saved.seconds).toBe(6);
    expect(setParameterValueWithSizeExclusivity(saved, "duration", 7, { ...context, model: { metadata: {} } })).toHaveProperty("seconds", 6);
  });
});

describe("Jiasu saved image aliases", () => {
  const ids = ["gpt-image-2.5-1k", "gpt-image-2.5-sunburst-1k"];
  const config = { baseUrl: "https://ai.jiasuapi.com/v1", modelGroup: "vip", accountKeyGroup: "vip", usage: "canvas",
    modelScanStatus: "live", scannedModelIds: ids };
  const descriptor = (id: string) => applyJiasuImageCapabilities({ provider: "openai", config }, {
    id, name: id, operations: ["image.generate", "image.edit"], metadata: { canvasRunnable: true },
  });
  const connection = (model: ModelDescriptor): ProviderConnectionView => ({
    id: "jiasu-image-aliases", name: "Jiasu image aliases fixture", provider: "openai", apiKey: "", apiKeySet: true, apiKeyUsable: true,
    config: { ...config, defaultModel: model.id, modelCatalogModels: [model] },
  });
  let canvas: Pick<typeof import("../components/canvas-app"), "normalizeGenerationNodeForRun">;
  beforeAll(async () => { vi.stubGlobal("React", React); canvas = await import("../components/canvas-app"); });
  afterAll(() => vi.unstubAllGlobals());
  const run = (model: ModelDescriptor, parameters: Record<string, unknown>) => {
    const node: CanvasNode = { id: "jiasu-image-aliases", type: "workflow", position: { x: 0, y: 0 }, data: {
      nodeType: "image-generation", label: "Saved image", provider: "openai", connectionId: "jiasu-image-aliases", model: model.id,
      qualityMode: "custom", parameters, parts: [], inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "image", kind: "image", label: "图片" }],
    } };
    const restored = JSON.parse(JSON.stringify(node)) as CanvasNode;
    const normalized = canvas.normalizeGenerationNodeForRun(restored, [connection(model)], {
      connectionId: "jiasu-image-aliases", items: [model], authoritative: true,
    });
    expect(restored.data.parameters).toEqual(parameters);
    return normalized.data.parameters!;
  };
  const issues = (model: ModelDescriptor, parameters: Readonly<Record<string, unknown>>) => jiasuImageRequestIssues(connection(model), {
    idempotencyKey: "image-alias-fixture", connectionId: "jiasu-image-aliases", operation: "image.generate", model: model.id, prompt: "静止画面", parameters,
  });

  it.each(ids)("restores selected ratio and 1K aliases for %s without default substitution", id => {
    const model = descriptor(id);
    for (const ratioKey of ["aspect_ratio", "aspectRatio"]) for (const resolutionKey of ["image_size", "size_tier"]) {
      const selected = { [ratioKey]: "9:16", [resolutionKey]: "1K" };
      const normalized = run(model, selected);
      expect(normalized).toMatchObject({ ...selected, ratio: "9:16", resolution: "1K" });
      expect(normalizeJiasuImageParameters(id, normalized, model)).toMatchObject({ ratio: "9:16", resolution: "1K" });
      expect(issues(model, normalized)).toEqual([]);
    }
  });

  it.each(ids)("keeps rejected 4K aliases visible and invalid for %s after run normalization", id => {
    const model = descriptor(id);
    for (const resolutionKey of ["image_size", "size_tier"]) {
      const normalized = run(model, { [resolutionKey]: "4K", aspect_ratio: "9:16" });
      expect(normalized).toMatchObject({ [resolutionKey]: "4K", resolution: "4K", ratio: "9:16", aspect_ratio: "9:16" });
      expect(normalizeJiasuImageParameters(id, normalized, model).resolution).toBe("4K");
      expect(issues(model, normalized)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.resolution", code: "invalid_resolution" })]));
    }
  });

  it.each(ids)("retains every explicit conflicting alias for %s so provider validation rejects it", id => {
    const model = descriptor(id);
    const selected = { ratio: "1:1", aspect_ratio: "9:16", aspectRatio: "16:9", resolution: "1K", image_size: "4K", size_tier: "4K" };
    const normalized = run(model, selected);
    expect(normalized).toMatchObject(selected);
    expect(issues(model, normalized).some(issue => issue.path.startsWith("parameters."))).toBe(true);
  });

  it.each(ids)("shows saved aliases and lets native image controls explicitly repair them for %s", id => {
    const model = descriptor(id);
    const original = { image_size: "4K", size_tier: "4K", aspect_ratio: "9:16", aspectRatio: "9:16", quality: "auto" };
    let selected: Record<string, unknown> = original;
    const elements = (node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] => {
      if (Array.isArray(node)) return node.flatMap(elements);
      if (!React.isValidElement(node)) return [];
      const element = node as React.ReactElement<Record<string, unknown>>;
      return [element, ...elements(element.props.children as React.ReactNode)];
    };
    const render = () => elements(NativeImageResolutionFields({ id: "jiasu-control", model, parameters: selected,
      resolution: model.parameters!.find(parameter => parameter.key === "resolution")!, ratio: model.parameters!.find(parameter => parameter.key === "ratio")!,
      onChange: parameters => { selected = parameters; } }));
    const old = render();
    expect(old.find(element => element.type === "select")?.props.value).toBe("9:16");
    expect(old.find(element => element.props.role === "status")?.props.children).toEqual(expect.arrayContaining([expect.stringContaining("4K")]));
    const chooseResolution = old.find(element => element.type === "button")?.props.onClick as () => void;
    chooseResolution();
    expect(selected).toEqual({ resolution: "1K", aspect_ratio: "9:16", aspectRatio: "9:16", quality: "auto" });
    const chooseRatio = render().find(element => element.type === "select")?.props.onChange as (event: { target: { value: string } }) => void;
    chooseRatio({ target: { value: "16:9" } });
    expect(selected).toEqual({ resolution: "1K", ratio: "16:9", quality: "auto" });
    expect(issues(model, normalizedParametersForModel("image-generation", "openai", model, selected))).toEqual([]);
    expect(original).toEqual({ image_size: "4K", size_tier: "4K", aspect_ratio: "9:16", aspectRatio: "9:16", quality: "auto" });
  });

  it("leaves aliases from other supplier descriptors untouched during explicit edits", () => {
    const other: ModelDescriptor = { id: "other-image", name: "Other image", operations: ["image.generate"], metadata: {} };
    const saved = { resolution: "1K", image_size: "4K", size_tier: "4K", ratio: "1:1", aspect_ratio: "9:16" };
    expect(setParameterValue(saved, "resolution", "2K", other)).toEqual({ ...saved, resolution: "2K" });
    expect(setParameterValue(saved, "ratio", "16:9", other)).toEqual({ ...saved, ratio: "16:9" });
    expect(parameterValueForModel(other, { aspect_ratio: "9:16" }, "ratio")).toBeUndefined();
  });
});

describe("model parameter helpers", () => {
  it.each(["ratio", "aspectRatio"])("preserves native %s exclusivity when defaults are restored", key => {
    const descriptors = [
      { key: "size", label: "尺寸", control: "dimensions" as const, default: "1024x1024" },
      { key, label: "比例", control: "select" as const, default: "1:1", options: [{ label: "1:1", value: "1:1" }, { label: "9:16", value: "9:16" }] },
    ];
    expect(parametersWithDefaults(descriptors, { size: "1024x1024" })).toEqual({ size: "1024x1024" });
    expect(parametersWithDefaults(descriptors, { [key]: "9:16" })).toEqual({ [key]: "9:16" });
  });
  it("does not restore removed connector models from an authoritative empty catalog", () => {
    const config = { connector: { models: [{ id: "removed", name: "Removed", operations: ["image.generate"] }] } };
    expect(modelDescriptorsFromConnectionConfig(config)).toHaveLength(1);
    for (const status of ["live", "failed", "empty", "unauthorized"]) {
      expect(modelDescriptorsFromConnectionConfig({ ...config, modelScanStatus: status, modelCatalogModels: [] })).toEqual([]);
    }
  });
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

    expect(parameterDescriptorsFor("video-generation", "rest", model)).toEqual(
      [],
    );
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

  it.each(["1K", "2K"])(
    "uses only the available %s tier even with a stale saved 4K tier",
    (tier) => {
      const descriptors = [
        {
          key: "size",
          label: "输出分辨率",
          control: "dimensions" as const,
          default: "auto",
          options: [
            { label: "自动", value: "auto" },
            { label: `${tier} · 1:1`, value: "1024x1024" },
          ],
        },
      ];
      expect(parametersWithDefaults(descriptors)).toEqual({
        size: "auto",
        size_tier: tier,
      });
      expect(
        parametersWithDefaults(descriptors, { size: "auto", size_tier: "4K" }),
      ).toEqual({ size: "auto", size_tier: tier });
    },
  );

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
      parameterDescriptorsForValues("video-generation", "rest", model, {
        resolution: "720p",
      }).find((descriptor) => descriptor.key === "duration")?.max,
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
  it("resolves supplier visibility and discrete duration constraints outside CLI", () => {
    const model: ModelDescriptor = { id: "video", name: "Video", operations: ["video.generate"], parameters: [
      { key: "resolution", label: "分辨率", control: "select", default: "720p", options: ["720p", "1080p"].map(value => ({label: value, value})) },
      { key: "duration", label: "时长", control: "select", default: 5, valueType: "integer", options: [5,10].map(value => ({label: String(value),value})), constraints: [{when:[{parameter:"resolution",values:["1080p"]}],options:[{label:"8 秒",value:8}]}] },
      { key: "lyrics", label: "歌词", control: "text", visibleWhen:[{parameter:"instrumental",values:[false]}] },
      { key: "instrumental", label: "纯音乐", control: "toggle", default: false },
    ] };
    const fields = parameterDescriptorsForValues("video-generation", "rest", model, { resolution: "1080p", instrumental: true });
    expect(fields.find(d => d.key === "duration")).toMatchObject({default:8,options:[{label:"8 秒",value:8}]});
    expect(fields.some(d => d.key === "lyrics")).toBe(false);
    expect(normalizedParametersForModel("video-generation", "rest", model, {resolution:"1080p",duration:5,instrumental:true,lyrics:"old"})).toEqual({resolution:"1080p",duration:8,instrumental:true});
  });
});

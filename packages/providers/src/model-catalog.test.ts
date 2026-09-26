import { describe, expect, it } from "vitest";
import { scanProviderModelCatalog } from "./model-catalog.js";

describe("provider model catalog scanner", () => {
  it("classifies bare Midjourney SKUs as image models while respecting explicit text output", () => {
    const models = scanProviderModelCatalog([{ id: "midjourney-1k" }, { id: "midjourney-2k" },
      { id: "midjourney-helper", output_modalities: ["text"] }]).models;
    expect(models.slice(0, 2).every(model => model.operations.includes("image.generate"))).toBe(true);
    expect(models.slice(0, 2).every(model => model.metadata?.canvasRunnable === false)).toBe(true);
    expect(models[2]?.operations).toEqual([]);
  });
  it("retains explicit upstream identities and conflicting routes without guessing from display names", () => {
    const models = scanProviderModelCatalog([
      { id: "gpt-pro-[稳定优先]", upstream_model: "gpt-5.4" },
      { id: "dynamic", official_model: "gpt-5.4", base_model: "gpt-5.2-pro" },
      { id: "gpt-5.4-[high-quality]" },
    ]).models;
    expect(models[0]!.metadata?.officialModelCandidates).toEqual(["gpt-5.4"]);
    expect(models[1]!.metadata?.officialModelCandidates).toEqual(["gpt-5.4", "gpt-5.2-pro"]);
    expect(models[2]!.metadata?.officialModelCandidates).toBeUndefined();
  });
  it("reads only explicitly enumerated reasoning levels from parameter documentation", () => {
    const models = scanProviderModelCatalog([
      { id: "documented-responses", documentation: { text: "`reasoning.effort`: [low, medium, high, xhigh]" } },
      { id: "documented-chat", description: "思考强度支持：none、minimal、low、medium、high、xhigh、max、ultra。" },
      { id: "table-chat", description: "| reasoning_effort | string | low, high |" },
    ]).models;
    expect(models[0]?.metadata).toMatchObject({ reasoningOptionsSource: "documentation",
      reasoningOptions: [{ value: "low" }, { value: "medium" }, { value: "high" }, { value: "xhigh" }] });
    expect((models[1]?.metadata?.reasoningOptions as Array<{ value: string }>).map(option => option.value))
      .toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(models[2]?.metadata?.reasoningOptions).toEqual([{ value: "low", label: "low" }, { value: "high", label: "high" }]);
  });

  it("reads named parameter options and nested JSON schema enums without accepting unrelated enums", () => {
    const models = scanProviderModelCatalog([
      { id: "parameter-list", parameters: [{ key: "reasoning_effort", options: [{ value: "high", label: "高" }, { value: "ultra", label: "极高" }, { value: "turbo" }] }] },
      { id: "json-schema", documentation: { parameters: { type: "object", properties: {
        reasoning: { type: "object", properties: { effort: { type: "string", enum: ["medium", "high", "xhigh"] } } },
        quality: { enum: ["low", "ultra"] },
      } } } },
      { id: "thinking-schema", parameters: [{ name: "thinking", schema: { enum: ["low", "high"] } }] },
    ]).models;
    expect(models[0]?.metadata).toMatchObject({ reasoningOptionsSource: "documentation",
      reasoningOptions: [{ value: "high", label: "高" }, { value: "ultra", label: "极高" }] });
    expect((models[1]?.metadata?.reasoningOptions as Array<{ value: string }>).map(option => option.value)).toEqual(["medium", "high", "xhigh"]);
    expect((models[2]?.metadata?.reasoningOptions as Array<{ value: string }>).map(option => option.value)).toEqual(["low", "high"]);
  });

  it("does not derive levels from marketing adjectives or override explicitly published choices", () => {
    const models = scanProviderModelCatalog([
      { id: "marketing", description: "High quality, low latency. reasoning_effort improves high quality responses.", parameters: [{ key: "quality", enum: ["low", "high"] }] },
      { id: "misleading", description: "reasoning_effort: high quality at low cost" },
      { id: "unsupported", description: "思考档位：turbo, blazing" },
      { id: "authoritative", reasoning_efforts: ["high"], description: "reasoning_effort: low, high, ultra" },
    ]).models;
    for (const model of models.slice(0, 3)) expect(model?.metadata?.reasoningOptions).toBeUndefined();
    expect(models[3]?.metadata).toMatchObject({ reasoningOptionsSource: "declared", reasoningOptions: [{ value: "high" }] });
  });

  it("preserves declared media input counts and capability evidence from model documentation", () => {
    const model = scanProviderModelCatalog([{ id: "multimodal-chat", input_modalities: ["text", "images", "video", "audio"],
      output_modalities: ["text"], limits: { maxInputImages: 12, maxInputAssets: 15 }, input_limits: { max_videos: "2", audios: 3 },
      documentation: { reasoning: { efforts: ["low", "high"] } } }]).models[0];
    expect(model).toMatchObject({ inputKinds: ["text", "image", "video", "audio"],
      limits: { maxInputImages: 12, maxInputVideos: 2, maxInputAudios: 3, maxInputAssets: 15 },
      metadata: { modelFactsSource: "model-api", agentCapabilities: { imageInput: true, videoInput: true, audioInput: true },
        inputLimitSources: { maxInputImages: "declared", maxInputVideos: "declared", maxInputAudios: "declared" },
        reasoningOptions: [{ value: "low" }, { value: "high" }] } });
  });

  it("reads explicit upload limits from prose without treating generated image counts as input evidence", () => {
    const models = scanProviderModelCatalog([
      { id: "doc-chat", description: "最多支持上传 8 张图片。视频输入上限为 2。Upload up to 3 audio files." },
      { id: "image-generator", description: "最多生成 4 张图片", max_images: 4 },
      { id: "chat-model", documentation: { text: "不支持音频输入。Supports video input." } },
    ]).models;
    expect(models[0]).toMatchObject({ limits: { maxInputImages: 8, maxInputVideos: 2, maxInputAudios: 3 },
      metadata: { agentCapabilities: { imageInput: true, videoInput: true, audioInput: true },
        inputLimitSources: { maxInputImages: "documentation", maxInputVideos: "documentation", maxInputAudios: "documentation" } } });
    expect(models[1]?.limits).toBeUndefined();
    expect(models[1]?.metadata?.agentCapabilities).toBeUndefined();
    expect(models[2]?.metadata?.agentCapabilities).toEqual({ audioInput: false, videoInput: true });
  });

  it("keeps zero limits and rejects malformed counts without inventing other media support", () => {
    const model = scanProviderModelCatalog([{ id: "limited-chat", limits: { maxInputImages: 0, maxInputVideos: -2, maxInputAudios: 1.5 } }]).models[0];
    expect(model?.limits).toEqual({ maxInputImages: 0 });
    expect(model?.metadata?.agentCapabilities).toEqual({ imageInput: false });
    const unspecified = scanProviderModelCatalog([{ id: "gpt-6-astra" }]).models[0];
    expect(unspecified?.limits).toBeUndefined();
    expect(unspecified?.metadata?.agentCapabilities).toBeUndefined();
  });

  it("does not turn the scanner's default text-only display fields into declared media exclusions on a second scan", () => {
    const first = scanProviderModelCatalog([{ id: "unknown-chat" }]).models[0];
    const second = scanProviderModelCatalog([first]).models[0];
    expect(second?.metadata?.inputKindsSource).toBe("inferred");
    expect(second?.metadata?.agentCapabilities).toBeUndefined();
  });

  it("preserves declared modalities, protocol and accepted reasoning choices without asserting default text is exclusive", () => {
    const models = scanProviderModelCatalog([
      { id: "mystery-chat" },
      { id: "image-understanding-pro", input_modalities: ["text", "image"], output_modalities: ["text"],
        protocol: "responses", reasoning_efforts: ["high", "xhigh"], supports_reasoning: true },
      { id: "dual-output", input_modalities: ["text"], output_modalities: ["text", "image"] },
    ]).models;
    expect(models[0]).toMatchObject({ inputKinds: ["text"], metadata: { inputKindsSource: "inferred" } });
    expect(models[0]?.metadata?.agentCapabilities).toBeUndefined();
    expect(models[1]).toMatchObject({ operations: [], inputKinds: ["text", "image"], outputKinds: ["text"],
      metadata: { inputKindsSource: "declared", outputKindsSource: "declared", agentProtocol: "responses",
        agentCapabilities: { imageInput: true, audioInput: false, reasoning: true },
        reasoningOptions: [{ value: "high" }, { value: "xhigh" }] } });
    expect(models[2]).toMatchObject({ operations: ["image.generate", "image.edit"], outputKinds: ["text", "image"] });
  });

  it("honors explicit generation operations before text output hints", () => {
    const model = scanProviderModelCatalog([{ id: "video-editor", operations: ["image.edit"], output_modalities: ["text"] }]).models[0];
    expect(model?.operations).toEqual(["image.edit"]);
  });

  it("recognizes new video families and does not mistake visual understanding for generation", () => {
    const ids = ["happyhorse-1.1", "minimax-h3-4k", "wan3.0-15s", "gpt-4-vision-preview", "nano-banana2"];
    const models = scanProviderModelCatalog(ids.map(id => ({id}))).models;
    expect(models.slice(0, 3).every(m => m.operations.includes("video.generate"))).toBe(true);
    expect(models[3]?.operations).toEqual([]);
    expect(models[4]?.operations).toContain("image.generate");
  });
  it("keeps every group membership when one model occurs in multiple groups", () => {
    const scan = scanProviderModelCatalog({ data: [
      { id: "image-pro", group: "A" },
      { id: "image-pro", group: "B" },
      { model_name: "video-pro", enable_groups: ["A", "B"] },
    ] });
    expect(scan.models).toHaveLength(2);
    expect(scan.groups).toEqual([
      { id: "A", label: "A", modelIds: ["image-pro", "video-pro"] },
      { id: "B", label: "B", modelIds: ["image-pro", "video-pro"] },
    ]);
  });
  it("keeps live models grouped and carries price metadata", () => {
    const scan = scanProviderModelCatalog({
      data: [
        {
          id: "image-pro",
          name: "Image Pro",
          group: "图片组",
          price_label: "¥0.12/张",
          billing_mode: "per_request",
        },
        {
          id: "video-pro",
          name: "Video Pro",
          model_group: "视频组",
          pricing: { label: "$0.4/秒", unit: "second" },
          type: "video",
        },
      ],
    });

    expect(scan.models).toHaveLength(2);
    expect(scan.models[0]).toMatchObject({
      id: "image-pro",
      operations: ["image.generate", "image.edit"],
      metadata: {
        priceLabel: "¥0.12/张",
        billingLabel: "per_request",
        catalogGroup: "图片组",
        canvasRunnable: true,
      },
    });
    expect(scan.models[1]).toMatchObject({
      id: "video-pro",
      operations: ["video.generate", "video.image-to-video"],
      metadata: { priceLabel: "$0.4/秒", billingLabel: "second" },
    });
    expect(scan.groups).toEqual([
      { id: "图片组", label: "图片组", modelIds: ["image-pro"] },
      { id: "视频组", label: "视频组", modelIds: ["video-pro"] },
    ]);
  });

  it("marks unknown models as visible but not callable", () => {
    const scan = scanProviderModelCatalog({ models: [{ id: "chat-model" }] });
    expect(scan.models[0]).toMatchObject({
      id: "chat-model",
      operations: [],
      metadata: {
        canvasRunnable: false,
        canvasUnavailableReason: "尚未验证该模型的画布调用协议",
      },
    });
  });

  it("accepts direct arrays and recognizes common image/video model names", () => {
    const scan = scanProviderModelCatalog([
      { id: "dall-e-3", group: "绘图", price: "$0.04" },
      { id: "sora-2", group: "视频", pricing: { unit: "每秒" } },
    ]);

    expect(scan.models[0]?.operations).toContain("image.generate");
    expect(scan.models[0]?.metadata?.priceLabel).toBe("$0.04");
    expect(scan.models[1]?.operations).toContain("video.generate");
    expect(scan.groups.map((group) => group.label)).toEqual(["绘图", "视频"]);
  });
});

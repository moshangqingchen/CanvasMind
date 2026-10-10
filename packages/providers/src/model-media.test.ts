import { describe, expect, it } from "vitest";
import { modelGenerationMediaKinds, inferGenerationMediaKinds } from "./model-media.js";
import { scanProviderModelCatalog } from "./model-catalog.js";

describe("strict output media classification", () => {
  it("recognizes declared generation endpoints for exact opaque and Chinese IDs", () => {
    const models = scanProviderModelCatalog([
      { id: "SD2.0fast稳定903A", supported_endpoint_types: ["openai", "openai-video"] },
      { id: "MinimaxH3", supported_endpoint_types: ["openai-video"] },
      { id: "opaque-image", supported_endpoint_types: ["image-generation", "openai", "gemini"] },
      { id: "opaque-mixed", endpoints: ["/v1/images/edits", "/v1/videos"] },
    ]).models;
    expect(models.map(modelGenerationMediaKinds)).toEqual([["video"], ["video"], ["image"], ["image", "video"]]);
    expect(models[0]?.operations).toContain("video.generate");
    expect(models[2]?.operations).toContain("image.generate");
    expect(models.map(model => model.id)).toEqual(["SD2.0fast稳定903A", "MinimaxH3", "opaque-image", "opaque-mixed"]);
  });
  it("does not treat chat endpoints or multimodal inputs as media output", () => {
    const models = scanProviderModelCatalog([
      { id: "opaque", input_modalities: ["image", "video"], supported_endpoint_types: ["openai", "gemini", "openai-response"] },
      { id: "qwen-vl-image-chat", supported_endpoint_types: ["chat", "image-understanding", "video-captioning"] },
      { id: "opaque-text", output_modalities: ["text"], supported_endpoint_types: ["image-generation", "openai-video"] },
      { id: "opaque-chat", capability: "chat", supported_endpoint_types: ["openai-video"] },
      { id: "opaque-declared", operations: [], supported_endpoint_types: ["openai-video"] },
    ]).models;
    expect(models.map(modelGenerationMediaKinds)).toEqual([[], [], [], [], []]);
    expect(models.every(model => model.operations.length === 0)).toBe(true);
  });
  it.each(["image-understanding-pro", "qwen-vl-image-chat", "video-captioner", "suno-lyrics", "flux-embedding", "gpt-4-vision-preview"])("does not use visual or music-looking input/text IDs as generation: %s", id => {
    expect(inferGenerationMediaKinds(id)).toEqual([]);
  });
  it("keeps image-to-video models in video nodes and preserves multiple declared outputs", () => {
    expect(inferGenerationMediaKinds("video-image-to-video")).toEqual(["video"]);
    expect(modelGenerationMediaKinds({ id: "opaque", operations: [], outputKinds: ["image", "video", "text"], metadata: { catalogCapability: "image" } })).toEqual(["image", "video"]);
  });
  it("uses declared output ahead of inferred scanner operations and names", () => {
    expect(modelGenerationMediaKinds({ id: "gpt-image-2", operations: ["image.generate"], outputKinds: ["text"], metadata: { operationsSource: "inferred", outputKindsSource: "declared" } })).toEqual([]);
    expect(modelGenerationMediaKinds({ id: "opaque", operations: ["image.generate"], outputKinds: ["video"] })).toEqual(["video"]);
    expect(modelGenerationMediaKinds({ id: "opaque", operations: ["image.edit"], outputKinds: ["text"], metadata: { operationsSource: "declared", outputKindsSource: "declared" } })).toEqual([]);
    expect(modelGenerationMediaKinds({ id: "image-understanding-pro", operations: ["image.generate"], outputKinds: ["image"], metadata: { modelFactsSource: "model-api", outputKindsSource: "inferred" } })).toEqual([]);
  });
  it("requires music evidence for audio output and excludes lyrics-only music models", () => {
    expect(modelGenerationMediaKinds({ id: "tts-1", operations: [], outputKinds: ["audio"] })).toEqual([]);
    expect(modelGenerationMediaKinds({ id: "suno-lyrics", operations: [], outputKinds: ["text"] })).toEqual([]);
    expect(modelGenerationMediaKinds({ id: "lyria-3-pro", operations: [], outputKinds: ["audio[]"] })).toEqual(["music"]);
    expect(modelGenerationMediaKinds({ id: "opaque", operations: ["music.generate"], outputKinds: ["audio[]"] })).toEqual(["music"]);
  });
});

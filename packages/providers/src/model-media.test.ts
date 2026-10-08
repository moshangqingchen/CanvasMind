import { describe, expect, it } from "vitest";
import { modelGenerationMediaKinds, inferGenerationMediaKinds } from "./model-media.js";

describe("strict output media classification", () => {
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

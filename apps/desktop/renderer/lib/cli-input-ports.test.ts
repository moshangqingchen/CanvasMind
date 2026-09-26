import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { cliInputPorts } from "./cli-input-ports";
const model: ModelDescriptor = { id: "v", name: "Video", provider: "cli", operations: ["video.generate", "video.image-to-video"], inputKinds: ["text", "image", "video", "audio"], limits: { maxInputImages: 2, maxInputVideos: 1, maxInputAudios: 1 }, metadata: { inputRoles: ["reference", "firstFrame", "lastFrame"] } };
describe("CLI model input ports", () => {
  it("shows only declared first/last frames and supported reference media", () => {
    expect(cliInputPorts(model).map(input => input.id)).toEqual(["prompt", "firstFrame", "lastFrame", "references", "referenceVideos", "referenceAudios"]);
    expect(cliInputPorts({ ...model, limits: { maxInputImages: 0, maxInputVideos: 1, maxInputAudios: 0 } }).map(input => input.id)).toEqual(["prompt", "referenceVideos"]);
  });
  it("defaults unspecified roles to references and never invents frame inputs", () => {
    const inputs = cliInputPorts({ ...model, metadata: {} });
    expect(inputs.map(input => input.id)).toEqual(["prompt", "references", "referenceVideos", "referenceAudios"]);
    expect(cliInputPorts({ ...model, inputKinds: ["text"], limits: {} }).map(input => input.id)).toEqual(["prompt"]);
  });
});

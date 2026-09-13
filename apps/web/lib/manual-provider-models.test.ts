import { describe, expect, it } from "vitest";
import { manualProviderModelDescriptors, mergeManualProviderModels, validateManualProviderModels } from "./manual-provider-models";

const connection = { provider: "openai", config: { usage: "canvas", modelGroup: "手动组", manualModels: [{ id: "my-custom-model", capability: "image", protocol: "openai-images" }] } };
describe("manual provider models", () => {
  it("retains a manually specified protocol when the model ID is unknown", () => {
    expect(manualProviderModelDescriptors(connection)[0]).toMatchObject({ id: "my-custom-model", operations: ["image.generate", "image.edit"] });
    expect(mergeManualProviderModels(connection, [{ id: "my-custom-model", name: "model", operations: [], metadata: { canvasRunnable: false, canvasUnavailableReason: "尚未验证该模型的画布调用协议" } }], true)[0]?.operations).toContain("image.generate");
  });
  it("does not expand an authoritative nonempty inventory or bypass denied models", () => {
    expect(mergeManualProviderModels(connection, [{ id: "other", name: "Other", operations: [] }], true).map((model) => model.id)).toEqual(["other"]);
    expect(manualProviderModelDescriptors({ ...connection, config: { ...connection.config, modelScanStatus: "unauthorized" } })).toEqual([]);
    expect(mergeManualProviderModels(connection, [{ id: "my-custom-model", name: "Denied", operations: [], metadata: { canvasRunnable: false, canvasUnavailableReason: "当前 Key 无权限" } }], true)[0]?.operations).toEqual([]);
  });
  it("requires video connectors and maintains canvas/agent isolation", () => {
    expect(() => validateManualProviderModels("openai", { manualModels: [{ id: "sora", capability: "video", protocol: "openai-videos" }] })).toThrow("视频");
    expect(() => validateManualProviderModels("rest", { usage: "agent", manualModels: connection.config.manualModels })).toThrow("对话");
    expect(() => validateManualProviderModels("rest", { usage: "agent", protocol: "responses", manualModels: [{ id: "gpt", capability: "chat", protocol: "responses" }] })).not.toThrow();
    expect(() => validateManualProviderModels("rest", { usage: "canvas", connector: { models: [{ id: "kling", operations: ["video.generate"] }] }, manualModels: [{ id: "kling", capability: "video", protocol: "rest" }] })).not.toThrow();
    expect(() => validateManualProviderModels("rest", { usage: "canvas", connector: { models: [{ id: "kling", operations: ["video.generate"] }] }, manualModels: [{ id: "not-configured", capability: "video", protocol: "rest" }] })).toThrow();
  });
});

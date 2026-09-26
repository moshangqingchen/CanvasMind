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
  it("keeps media adapter requirements independently of the old usage label", () => {
    expect(() => validateManualProviderModels("openai", { manualModels: [{ id: "sora", capability: "video", protocol: "openai-videos" }] })).toThrow("视频");
    expect(() => validateManualProviderModels("rest", { usage: "agent", manualModels: connection.config.manualModels })).toThrow("REST");
    expect(() => validateManualProviderModels("rest", { usage: "agent", protocol: "responses", manualModels: [{ id: "gpt", capability: "chat", protocol: "responses" }] })).not.toThrow();
    expect(() => validateManualProviderModels("rest", { usage: "canvas", connector: { models: [{ id: "kling", operations: ["video.generate"] }] }, manualModels: [{ id: "kling", capability: "video", protocol: "rest" }] })).not.toThrow();
    expect(() => validateManualProviderModels("rest", { usage: "canvas", connector: { models: [{ id: "kling", operations: ["video.generate"] }] }, manualModels: [{ id: "not-configured", capability: "video", protocol: "rest" }] })).toThrow();
  });
  it("allows one Key to contain image and chat models with independent protocols", () => {
    const config = { usage: "agent", protocol: "responses", manualModels: [
      ...connection.config.manualModels,
      { id: "chat", capability: "chat", protocol: "anthropic-messages" },
    ] };
    expect(() => validateManualProviderModels("openai", config)).not.toThrow();
    expect(config.protocol).toBe("responses");
    expect(manualProviderModelDescriptors({ provider: "openai", config })).toEqual([
      expect.objectContaining({ id: "my-custom-model", operations: ["image.generate", "image.edit"] }),
      expect.objectContaining({ id: "chat", operations: [], outputKinds: ["text"], metadata: expect.objectContaining({ agentProtocol: "anthropic-messages", canvasRunnable: false }) }),
    ]);
  });
  it("adds a chat model to an existing REST image connector without changing that connector", () => {
    const config = { usage: "canvas", protocol: "rest", connector: { models: [{ id: "image", operations: ["image.generate"] }] }, manualModels: [
      { id: "image", capability: "image", protocol: "rest" },
      { id: "chat", capability: "chat", protocol: "responses" },
    ] };
    const before = structuredClone(config);
    expect(() => validateManualProviderModels("rest", config)).not.toThrow();
    expect(config).toEqual(before);
    expect(() => validateManualProviderModels("cli", { usage: "agent", manualModels: [config.manualModels[1]] })).toThrow("对话协议");
    expect(() => validateManualProviderModels("rest", { manualModels: [{ id: "chat", capability: "chat", protocol: "rest" }] })).toThrow("对话协议");
  });
  it("retains discovered image input when a chat protocol is supplied manually", () => {
    const merged = mergeManualProviderModels({ provider: "openai", config: {
      manualModels: [{ id: "chat", capability: "chat", protocol: "responses" }],
    } }, [{ id: "chat", name: "Chat", operations: [], inputKinds: ["text", "image"], outputKinds: ["text"],
      metadata: { inputKindsSource: "declared" } }], true);
    expect(merged[0]).toMatchObject({ inputKinds: ["text", "image"], metadata: { inputKindsSource: "declared", agentProtocol: "responses" } });
  });
});

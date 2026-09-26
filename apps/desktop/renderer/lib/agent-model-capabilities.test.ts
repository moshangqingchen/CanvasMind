import { describe, expect, it } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import { scanProviderModelCatalog, type ModelDescriptor } from "@super-canvas/providers";
import { agentModelEvidenceFingerprint, createAgentModelEvidence, isAgentTextModel, modelAgentProtocol, resolveAgentCapabilities } from "./agent-model-capabilities";

const connection = (config: Record<string, unknown> = {}): ProviderConnectionRecord => ({
  id: "key-one", name: "Group key", provider: "rest", encryptedSecret: "encrypted-test-key",
  config: { baseUrl: "https://gateway.example/v1", modelGroup: "A", protocol: "openai-images", ...config },
  createdAt: "2026-09-22", updatedAt: "2026-09-22",
});
const descriptor = (id = "unknown-model", metadata: Record<string, unknown> = {}): ModelDescriptor => ({
  id, name: id, operations: [], inputKinds: ["text"], outputKinds: ["text"], metadata,
});

describe("model capability evidence", () => {
  it("defaults undeclared chat vision on without claiming verification and honors explicit negatives", () => {
    const c = connection();
    expect(resolveAgentCapabilities(c, "unknown-model", descriptor())).toMatchObject({ imageInputStatus: "assumed", imageInputSource: "default", capabilitySource: "default", capabilities: { imageInput: true, videoInput: false, audioInput: false }, inputLimits: {} });
    expect(resolveAgentCapabilities(c, "unknown-model", descriptor("unknown-model", { inputKindsSource: "inferred" })).imageInputStatus).toBe("assumed");
    expect(resolveAgentCapabilities(c, "unknown-model", descriptor("unknown-model", { inputKindsSource: "declared" })).imageInputStatus).toBe("unsupported");
  });

  it("gives same-credential live evidence precedence over declarations and family hints", () => {
    const c = connection();
    c.config.agentModelEvidence = { "gpt-4o": createAgentModelEvidence(c, { modelId: "gpt-4o", capabilities: { imageInput: false }, protocol: "openai-responses" }) };
    const result = resolveAgentCapabilities(c, "gpt-4o", descriptor("gpt-4o", { agentCapabilities: { imageInput: true } }));
    expect(result).toMatchObject({ protocol: "openai-responses", imageInputStatus: "unsupported", capabilitySource: "live", capabilities: { imageInput: false } });
  });

  it.each(["secret", "supplier", "source", "base", "group", "protocol", "headers", "provider", "model"])("invalidates live evidence when %s changes", change => {
    const c = connection({ supplierId: "supplier", supplierSourceId: "source-one" });
    c.config.agentModelEvidence = { "unknown-model": createAgentModelEvidence(c, { modelId: "unknown-model", protocol: "openai-responses", capabilities: { imageInput: true } }) };
    if (change === "secret") c.encryptedSecret = "new-key";
    if (change === "supplier") c.config.supplierId = "other-supplier";
    if (change === "source") c.config.supplierSourceId = "source-two";
    if (change === "base") c.config.baseUrl = "https://other.example/v1";
    if (change === "group") c.config.modelGroup = "B";
    if (change === "protocol") c.config.protocol = "responses";
    if (change === "headers") c.config.directorHeaders = { "x-channel": "different" };
    if (change === "provider") c.provider = "openai";
    const result = resolveAgentCapabilities(c, change === "model" ? "other-model" : "unknown-model", descriptor());
    expect(result.imageInputStatus).toBe("assumed");
  });

  it("does not invent reasoning levels from a boolean and hides rejected transport parameters", () => {
    const c = connection({ protocol: "responses" });
    const model = descriptor("m", { agentCapabilities: { reasoning: true } });
    expect(resolveAgentCapabilities(c, "m", model).reasoningOptions.map(option => option.value)).toEqual(["auto"]);
    model.metadata = { ...model.metadata, reasoningOptions: ["high", "xhigh", "high", "invalid value"] };
    expect(resolveAgentCapabilities(c, "m", model).reasoningOptions.map(option => option.value)).toEqual(["auto", "high", "xhigh"]);
    c.config.agentRuntimeProfiles = { m: { fingerprint: agentModelEvidenceFingerprint(c), protocol: "openai-responses", disableReasoning: true } };
    expect(resolveAgentCapabilities(c, "m", model).reasoningOptions.map(option => option.value)).toEqual(["auto"]);
  });

  it("removes only rejected channel reasoning values without hiding other documented levels", () => {
    const c = connection();
    c.config.agentRuntimeProfiles = { "gpt-6-astra": { fingerprint: agentModelEvidenceFingerprint(c), unsupportedReasoningEfforts: ["max"] } };
    const result = resolveAgentCapabilities(c, "gpt-6-astra");
    expect(result.reasoningOptions.map(option => option.value)).toEqual(["auto", "low", "medium", "high", "xhigh"]);
    expect(result).toMatchObject({ reasoningSource: "live", reasoningFallback: { sourceUrl: "https://developers.openai.com/api/docs/models/gpt-6-astra" } });
    c.encryptedSecret = "different-key";
    expect(resolveAgentCapabilities(c, "gpt-6-astra").reasoningOptions.at(-1)?.value).toBe("max");
  });

  it("intersects media declarations with the actual adapter serializers", () => {
    const result = resolveAgentCapabilities(connection({ protocol: "responses" }), "m", descriptor("m", {
      agentCapabilities: { imageInput: true, audioInput: true, videoInput: true, toolCalling: true },
    }));
    expect(result.capabilities).toMatchObject({ imageInput: true, audioInput: false, videoInput: false, toolCalling: false });
    expect(result).toMatchObject({ audioInputStatus: "unsupported", audioInputSource: "adapter", videoInputStatus: "unsupported", videoInputSource: "adapter" });
  });

  it("carries documented media counts, including zero, without inventing unspecified limits", () => {
    const model = { ...descriptor(), limits: { maxInputImages: 4, maxInputVideos: 2, maxInputAudios: 0, maxInputAssets: 5 } };
    expect(resolveAgentCapabilities(connection({ protocol: "google-generate-content" }), model.id, model)).toMatchObject({
      capabilities: { imageInput: true, videoInput: true, audioInput: false },
      inputLimits: { maxImages: 4, maxVideos: 2, maxAudios: 0, maxAssets: 5 }, imageInputSource: "provider-catalog", audioInputStatus: "unsupported",
    });
    expect(resolveAgentCapabilities(connection(), "m", { ...descriptor(), limits: { maxInputImages: -1, maxInputVideos: 1.5, maxInputAudios: Infinity } }).inputLimits).toEqual({});
  });

  it("does not default vision on for a known generation model", () => {
    const model = scanProviderModelCatalog([{ id: "gpt-image-2" }]).models[0];
    expect(resolveAgentCapabilities(connection(), model.id, { ...model, inputKinds: ["text"] }).imageInputStatus).toBe("unknown");
  });

  it("uses exact official model reasoning defaults only when the supplier has not declared levels", () => {
    const result = resolveAgentCapabilities(connection(), "gpt-6-astra", descriptor("gpt-6-astra"));
    expect(result.reasoningOptions.map(option => option.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    expect(result).toMatchObject({ reasoningSource: "official-model", reasoningFallback: { sourceUrl: "https://developers.openai.com/api/docs/models/gpt-6-astra", checkedAt: "2026-09-22" } });
    const declared = descriptor("gpt-6-astra", { reasoningOptions: ["high"] });
    expect(resolveAgentCapabilities(connection(), declared.id, declared).reasoningOptions.map(option => option.value)).toEqual(["auto", "high"]);
    const disabled = descriptor("gpt-6-astra", { agentCapabilities: { reasoning: false } });
    expect(resolveAgentCapabilities(connection(), disabled.id, disabled).reasoningOptions.map(option => option.value)).toEqual(["auto"]);
    expect(resolveAgentCapabilities(connection(), "gpt-6-astra-unverified-alias").reasoningOptions.map(option => option.value)).toEqual(["auto"]);
  });

  it("defaults exact official GPT reasoning models to Responses only when no channel protocol is declared", () => {
    expect(modelAgentProtocol(connection({ protocol: undefined }), "gpt-6-astra")).toBe("openai-responses");
    expect(modelAgentProtocol(connection({ protocol: "chat-completions" }), "gpt-6-astra")).toBe("openai-chat-completions");
    expect(modelAgentProtocol(connection({ protocol: undefined }), "gpt-5.2-2025-12-11")).toBe("openai-responses");
    expect(modelAgentProtocol(connection({ protocol: undefined }), "gpt-5.2-openai-compact")).toBe("openai-chat-completions");
    expect(modelAgentProtocol(connection({ protocol: undefined }), "unknown-model")).toBe("openai-chat-completions");
  });

  it.each(["gpt-6-sol", "gpt-6-luna"])("fills %s from official documentation while honoring channel declarations and rejections", modelId => {
    const c = connection({ protocol: undefined });
    expect(resolveAgentCapabilities(c, modelId)).toMatchObject({
      protocol: "openai-responses", reasoningSource: "official-model",
      reasoningFallback: { sourceUrl: `https://developers.openai.com/api/docs/models/${modelId}`, checkedAt: "2026-09-23" },
    });
    expect(resolveAgentCapabilities(c, modelId).reasoningOptions.map(option => option.value))
      .toEqual(["auto", "none", "low", "medium", "high", "xhigh", "max"]);
    const declared = descriptor(modelId, { reasoningOptions: ["low", "high"], agentProtocol: "chat-completions" });
    const channel = resolveAgentCapabilities(c, modelId, declared);
    expect(channel).toMatchObject({ protocol: "openai-chat-completions", reasoningSource: "provider-catalog" });
    expect(channel.reasoningOptions.map(option => option.value)).toEqual(["auto", "low", "high"]);
    expect(channel.reasoningFallback).toBeUndefined();
    c.config.agentRuntimeProfiles = { [modelId]: { fingerprint: agentModelEvidenceFingerprint(c), unsupportedReasoningEfforts: ["max"] } };
    expect(resolveAgentCapabilities(c, modelId).reasoningOptions.map(option => option.value))
      .toEqual(["auto", "none", "low", "medium", "high", "xhigh"]);
  });

  it.each([
    ["gpt-5.2", ["none", "low", "medium", "high", "xhigh"], "gpt-5.2"],
    ["gpt-5.2-2025-12-11", ["none", "low", "medium", "high", "xhigh"], "gpt-5.2"],
    ["gpt-5.2-pro", ["medium", "high", "xhigh"], "gpt-5.2-pro"],
    ["gpt-5.2-pro-2025-12-11", ["medium", "high", "xhigh"], "gpt-5.2-pro"],
    ["gpt-5.3-codex", ["low", "medium", "high", "xhigh"], "gpt-5.3-codex"],
    ["gpt-5.4-mini", ["none", "low", "medium", "high", "xhigh"], "gpt-5.4-mini"],
    ["gpt-5.4-mini-2026-03-17", ["none", "low", "medium", "high", "xhigh"], "gpt-5.4-mini"],
    ["gpt-5.4-2026-03-05", ["none", "low", "medium", "high", "xhigh"], "gpt-5.4"],
    ["gpt-5.5-2026-04-23", ["none", "low", "medium", "high", "xhigh"], "gpt-5.5"],
    ["gpt-5.6-luna", ["none", "low", "medium", "high", "xhigh", "max"], "gpt-5.6-luna"],
  ] as const)("recognizes documented reasoning model/snapshot %s", (modelId, options, source) => {
    const result = resolveAgentCapabilities(connection(), modelId);
    expect(result.reasoningOptions.map(option => option.value)).toEqual(["auto", ...options]);
    expect(result).toMatchObject({ reasoningSource: "official-model", reasoningFallback: { sourceUrl: `https://developers.openai.com/api/docs/models/${source}`, checkedAt: "2026-09-22" } });
  });

  it.each(["gpt-5.2-openai-compact", "gpt-5.2-pro-2026-01-01", "gpt-5.6-luna-fast", "gpt-5.3-codex-2026-02-01"])("does not guess reasoning for undocumented reseller/snapshot %s", modelId => {
    expect(resolveAgentCapabilities(connection(), modelId).reasoningOptions.map(option => option.value)).toEqual(["auto"]);
  });

  it.each([
    ["claude-opus-4-5", ["low", "medium", "high"]],
    ["claude-opus-4-5-20251101", ["low", "medium", "high"]],
    ["claude-opus-4-6", ["low", "medium", "high", "max"]],
    ["claude-sonnet-4-6", ["low", "medium", "high", "max"]],
    ["claude-opus-4-7", ["low", "medium", "high", "xhigh", "max"]],
    ["claude-opus-4-8", ["low", "medium", "high", "xhigh", "max"]],
    ["claude-opus-5", ["low", "medium", "high", "xhigh", "max"]],
    ["claude-sonnet-5", ["low", "medium", "high", "xhigh", "max"]],
    ["claude-fable-5", ["low", "medium", "high", "xhigh", "max"]],
    ["claude-fable-5-1", ["low", "medium", "high", "xhigh", "max"]],
  ] as const)("offers documented native Messages efforts for %s", (modelId, options) => {
    const result = resolveAgentCapabilities(connection({ protocol: "anthropic-messages" }), modelId);
    expect(result.reasoningOptions.map(option => option.value)).toEqual(["auto", ...options]);
    expect(result).toMatchObject({ reasoningSource: "official-model", reasoningFallback: { sourceUrl: "https://platform.claude.com/docs/en/build-with-claude/effort" }, capabilities: { reasoning: true } });
  });

  it.each([
    ["gemini-3-pro-preview", ["low", "high"]],
    ["gemini-3.1-pro-preview", ["low", "medium", "high"]],
    ["gemini-3-flash-preview", ["minimal", "low", "medium", "high"]],
    ["gemini-3.5-flash", ["minimal", "low", "medium", "high"]],
    ["models/gemini-3.5-flash", ["minimal", "low", "medium", "high"]],
  ] as const)("offers documented native thinkingLevel values for %s", (modelId, options) => {
    const result = resolveAgentCapabilities(connection({ protocol: "google-generate-content" }), modelId);
    expect(result.reasoningOptions.map(option => option.value)).toEqual(["auto", ...options]);
    expect(result.reasoningSource).toBe("official-model");
  });

  it("intersects supplier-declared native efforts with adapter parameter support without inventing budgets", () => {
    const model = descriptor("private-model", { reasoningOptions: ["minimal", "low", "high", "xhigh", "max"] });
    expect(resolveAgentCapabilities(connection({ protocol: "google-generate-content" }), model.id, model).reasoningOptions.map(option => option.value)).toEqual(["auto", "minimal", "low", "high"]);
    expect(resolveAgentCapabilities(connection({ protocol: "anthropic-messages" }), model.id, model).reasoningOptions.map(option => option.value)).toEqual(["auto", "low", "high", "xhigh", "max"]);
    expect(resolveAgentCapabilities(connection({ protocol: "google-generate-content" }), "gemini-2.5-pro", model).reasoningOptions.map(option => option.value)).toEqual(["auto"]);
    expect(resolveAgentCapabilities(connection({ protocol: "google-generate-content" }), "models/gemini-2.5-pro", model).reasoningOptions.map(option => option.value)).toEqual(["auto"]);
    expect(resolveAgentCapabilities(connection({ protocol: "anthropic-messages" }), "unknown-native").reasoningOptions.map(option => option.value)).toEqual(["auto"]);
  });

  it("keeps declared audio chat and exact official audio models while excluding pure audio tasks", () => {
    const models = scanProviderModelCatalog([
      { id: "gpt-4o-audio-preview" }, { id: "gpt-4o-audio-preview-2025-06-03" },
      { id: "custom-audio-chat", input_modalities: ["text", "audio"], output_modalities: ["text"] },
      { id: "audio-generator", output_modalities: ["audio"] }, { id: "tts-1" }, { id: "whisper-1" },
      { id: "text-transcription", input_modalities: ["audio"], output_modalities: ["text"] },
    ]).models;
    expect(models.map(isAgentTextModel)).toEqual([true, true, true, false, false, false, false]);
    expect(resolveAgentCapabilities(connection({ protocol: "chat-completions" }), models[0].id, models[0])).toMatchObject({
      capabilities: { imageInput: false, audioInput: true, videoInput: false }, audioInputSource: "official-model", imageInputSource: "official-model",
    });
    const unsupported = { ...models[0], metadata: { agentCapabilities: { audioInput: false } } };
    expect(resolveAgentCapabilities(connection(), unsupported.id, unsupported).audioInputStatus).toBe("unsupported");
  });

  it("separates image/video generators and non-chat models while preserving declared dual output", () => {
    const models = scanProviderModelCatalog([
      { id: "gpt-image-2" }, { id: "veo-3" }, { id: "text-embedding-3" }, { id: "rerank" },
      { id: "image-reader", input_modalities: ["text", "image"], output_modalities: ["text"] },
      { id: "dual", output_modalities: ["text", "image"] }, { id: "unknown-chat" },
    ]).models;
    expect(models.map(isAgentTextModel)).toEqual([false, false, false, false, true, true, true]);
  });
});

describe("verified channel routing", () => {
  const verified = () => connection({ baseUrl: "https://ai.cangyuansuanli.cn/v1", modelGroup: "LLM-GPT-plus", protocol: "chat-completions" });
  it("selects verified Responses and vision while supplementing successful reasoning levels with official defaults", () => {
    const result = resolveAgentCapabilities(verified(), "gpt-6-astra");
    expect(result).toMatchObject({ protocol: "openai-responses", capabilitySource: "channel-verification", imageInputStatus: "supported" });
    expect(result.reasoningOptions.map(option => option.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
  });
  it("routes GPT-5.5 through its verified text endpoint and labels assumed vision plus official reasoning", () => {
    const result = resolveAgentCapabilities(verified(), "gpt-5.5");
    expect(result).toMatchObject({ protocol: "openai-responses", capabilitySource: "channel-verification", imageInputStatus: "assumed", imageInputSource: "default", reasoningSource: "official-model" });
    expect(result.reasoningOptions.map(option => option.value)).toEqual(["auto", "none", "low", "medium", "high", "xhigh"]);
  });
  it.each(["host", "path", "group", "model"])("never shares the verified rule across another %s", change => {
    const c = verified();
    if (change === "host") c.config.baseUrl = "https://ai.cangyuansuanli.cn.evil.example/v1";
    if (change === "path") c.config.baseUrl = "https://ai.cangyuansuanli.cn/other/v1";
    if (change === "group") c.config.modelGroup = "other-group";
    expect(resolveAgentCapabilities(c, change === "model" ? "gpt-6-other" : "gpt-6-astra")).toMatchObject({ protocol: "openai-chat-completions", imageInputStatus: "assumed", imageInputSource: "default" });
  });
  it("prefers the current credential's live protocol and negative capability over the channel rule", () => {
    const c = verified();
    c.config.agentModelEvidence = { "gpt-6-astra": createAgentModelEvidence(c, { modelId: "gpt-6-astra", protocol: "openai-chat-completions", capabilities: { imageInput: false, reasoning: false } }) };
    expect(modelAgentProtocol(c, "gpt-6-astra")).toBe("openai-chat-completions");
    expect(resolveAgentCapabilities(c, "gpt-6-astra")).toMatchObject({ imageInputStatus: "unsupported", reasoningOptions: [{ value: "auto" }] });
  });
  it("honors updated supplier restrictions ahead of old static channel successes and official defaults", () => {
    const model = descriptor("gpt-6-astra", { reasoningOptions: ["high"], agentCapabilities: { imageInput: false } });
    expect(resolveAgentCapabilities(verified(), model.id, model)).toMatchObject({ imageInputStatus: "unsupported", imageInputSource: "provider-catalog", reasoningSource: "provider-catalog", reasoningOptions: [{ value: "auto" }, { value: "high" }] });
    model.metadata = { agentCapabilities: { reasoning: false } };
    expect(resolveAgentCapabilities(verified(), model.id, model).reasoningOptions).toEqual([{ value: "auto", label: "自动" }]);
  });
  it("does not hide other verified choices after one successful reasoning call", () => {
    const c = verified();
    c.config.agentModelEvidence = { "gpt-6-astra": createAgentModelEvidence(c, { modelId: "gpt-6-astra", capabilities: { reasoning: true }, reasoningOptions: [{ value: "high", label: "高" }] }) };
    expect(resolveAgentCapabilities(c, "gpt-6-astra").reasoningOptions.map(option => option.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
  });
  it("keeps known reasoning choices in intensity order despite latest verification order", () => {
    const c = verified();
    c.config.agentModelEvidence = { "gpt-6-astra": createAgentModelEvidence(c, { modelId: "gpt-6-astra", capabilities: { reasoning: true }, reasoningOptions: [
      { value: "xhigh", label: "超高" }, { value: "custom-b", label: "B" }, { value: "custom-a", label: "A" }, { value: "high", label: "高" },
    ] }) };
    expect(resolveAgentCapabilities(c, "gpt-6-astra").reasoningOptions.map(option => option.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max", "custom-b", "custom-a"]);
  });
});

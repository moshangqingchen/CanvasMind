import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import type { ResolvedDirectorConnection } from "@super-canvas/director";
const mocks = vi.hoisted(() => ({ repository: null as unknown as MemoryRepository, complete: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; } }));
vi.mock("./director-adapters", () => ({ directorAdapterRegistry: { get: () => ({ complete: mocks.complete }) } }));
import { agentCompatibilityFallback, completeAgentModel } from "./agent-model-call";
import { DirectorAdapterError } from "./director-adapters/shared";
import { agentModelEvidenceFingerprint } from "./agent-model-capabilities";
const connection: ResolvedDirectorConnection = {
  id: "key-1", name: "key", provider: "openai", supplier: "supplier", baseUrl: "https://example.test/v1", apiKey: "secret",
  protocol: "openai-chat-completions", model: "text", enabled: true, reasoningEffort: "high",
  capabilities: { text: true, imageInput: true, audioInput: false, videoInput: false, structuredOutput: true, toolCalling: false, nativeWebSearch: false, reasoning: true },
};
const input = { system: "system", messages: [{ role: "user" as const, content: "hello" }] };
const reply = { output: { type: "reply", message: "hello" } };
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.repository = new MemoryRepository();
  await mocks.repository.saveConnection({ id: connection.id, name: connection.name, provider: "openai", encryptedSecret: "encrypted", config: { baseUrl: connection.baseUrl, modelGroup: "group-a" } });
});
describe("agent compatibility negotiation", () => {
  it.each([
    ["timeout", undefined, "timeout"],
    ["network", undefined, "network"],
    ["invalid_response", undefined, "模型未返回可用内容"],
    ["upstream", 401, "unauthorized endpoint"],
    ["upstream", 400, "余额不足 unsupported endpoint"],
    ["upstream", 404, "model not found"],
    ["upstream", 429, "too many requests"],
  ] as const)("does not retry %s/%s", async (code, status, message) => {
    const error = new DirectorAdapterError(code, message, { status });
    mocks.complete.mockRejectedValue(error);
    expect(agentCompatibilityFallback(connection, error)).toBeUndefined();
    await expect(completeAgentModel(connection, input)).rejects.toBe(error);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
  it("retries one explicitly unsupported endpoint and persists its exact credential/model profile", async () => {
    mocks.complete.mockRejectedValueOnce(new DirectorAdapterError("upstream", "endpoint /chat/completions not supported", { status: 404 })).mockResolvedValue(reply);
    await completeAgentModel(connection, input);
    expect(mocks.complete.mock.calls.map(call => call[0].protocol)).toEqual(["openai-chat-completions", "openai-responses"]);
    const record = await mocks.repository.getConnection(connection.id);
    expect(record?.config.agentRuntimeProfiles).toMatchObject({ text: { protocol: "openai-responses", fingerprint: agentModelEvidenceFingerprint(record!) } });
    expect(record?.config.agentModelEvidence).toMatchObject({ text: { protocol: "openai-responses", capabilities: { text: true, reasoning: true }, reasoningOptions: [{ value: "high" }] } });
    await completeAgentModel(connection, input);
    expect(mocks.complete.mock.calls[2][0].protocol).toBe("openai-responses");
  });
  it("removes only an explicitly unsupported optional parameter and bounds negotiation to one retry", async () => {
    mocks.complete.mockRejectedValue(new DirectorAdapterError("upstream", "unsupported response_format parameter", { status: 400 }));
    await expect(completeAgentModel(connection, input)).rejects.toThrow("response_format");
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect(mocks.complete.mock.calls[1][0]).toMatchObject({ protocol: "openai-chat-completions", capabilities: { structuredOutput: false } });
    expect((await mocks.repository.getConnection(connection.id))?.config.agentRuntimeProfiles).toBeUndefined();
  });
  it("merges verified image input and thinking levels without changing the key or its group", async () => {
    mocks.complete.mockResolvedValue(reply);
    await completeAgentModel(connection, { ...input, attachments: [{ kind: "image", url: "data:image/png;base64,AA==" }] });
    await completeAgentModel({ ...connection, reasoningEffort: "xhigh" }, input);
    const record = await mocks.repository.getConnection(connection.id);
    expect(record?.encryptedSecret).toBe("encrypted");
    expect(record?.config.modelGroup).toBe("group-a");
    expect(record?.config.agentModelEvidence).toMatchObject({ text: { capabilities: { imageInput: true }, reasoningOptions: [{ value: "high" }, { value: "xhigh" }] } });
  });
  it("does not reuse a profile or save stale evidence after the credential changes", async () => {
    mocks.complete.mockImplementationOnce(async () => {
      const record = (await mocks.repository.getConnection(connection.id))!;
      await mocks.repository.saveConnection({ ...record, encryptedSecret: "new-secret" });
      return reply;
    });
    await completeAgentModel(connection, input);
    expect((await mocks.repository.getConnection(connection.id))?.config.agentModelEvidence).toBeUndefined();
  });
  it("records only the audio/video inputs actually sent and accepted", async () => {
    mocks.complete.mockResolvedValue(reply);
    await completeAgentModel({ ...connection, protocol: "google-generate-content", capabilities: { ...connection.capabilities, audioInput: true, videoInput: true } }, {
      ...input, attachments: [{ kind: "audio", url: "data:audio/mpeg;base64,AA==" }, { kind: "video", url: "data:video/mp4;base64,AA==" }],
    });
    const record = await mocks.repository.getConnection(connection.id);
    expect(record?.config.agentModelEvidence).toMatchObject({ text: { capabilities: { audioInput: true, videoInput: true } } });
    const evidence = record!.config.agentModelEvidence as Record<string, { capabilities: Record<string, unknown> }>;
    expect(evidence.text.capabilities.imageInput).toBeUndefined();
  });
  it("does not mistake an image count rejection for missing vision support", async () => {
    mocks.complete.mockRejectedValue(new DirectorAdapterError("upstream", "unsupported image count: maximum 2", { status: 400 }));
    await expect(completeAgentModel(connection, { ...input, attachments: [{ kind: "image", url: "data:image/png;base64,AA==" }] })).rejects.toThrow("maximum 2");
    expect((await mocks.repository.getConnection(connection.id))?.config.agentModelEvidence).toBeUndefined();
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
  it("remembers an explicitly rejected thinking value without disabling every other level", async () => {
    mocks.complete.mockRejectedValueOnce(new DirectorAdapterError("upstream", "reasoning_effort value max is not supported; use high", { status: 400 })).mockResolvedValue(reply);
    await completeAgentModel({ ...connection, reasoningEffort: "max" }, input);
    expect(mocks.complete.mock.calls[1][0].reasoningEffort).toBeUndefined();
    const record = await mocks.repository.getConnection(connection.id);
    expect(record?.config.agentRuntimeProfiles).toMatchObject({ text: { unsupportedReasoningEfforts: ["max"] } });
    await completeAgentModel(connection, input);
    expect(mocks.complete.mock.calls[2][0].reasoningEffort).toBe("high");
  });
});

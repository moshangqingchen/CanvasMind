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
  mocks.complete.mockReset();
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
    ["upstream", 500, "unsupported response_format"],
    ["upstream", 502, "endpoint /chat/completions not supported"],
  ] as const)("does not retry %s/%s", async (code, status, message) => {
    const error = new DirectorAdapterError(code, message, { status });
    mocks.complete.mockRejectedValue(error);
    expect(agentCompatibilityFallback(connection, error)).toBeUndefined();
    await expect(completeAgentModel(connection, input)).rejects.toBe(error);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
  it("negotiates an explicitly rejected endpoint once and caches the successful protocol", async () => {
    const error = new DirectorAdapterError("upstream", "endpoint /chat/completions not supported", { status: 404 });
    mocks.complete.mockRejectedValueOnce(error).mockResolvedValue(reply);
    await expect(completeAgentModel(connection, input)).resolves.toBe(reply);
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect(mocks.complete.mock.calls[1][0].protocol).toBe("openai-responses");
    expect((await mocks.repository.getConnection(connection.id))?.config.agentRuntimeProfiles).toMatchObject({ text: { protocol: "openai-responses" } });
    await completeAgentModel(connection, input);
    expect(mocks.complete.mock.calls[2][0].protocol).toBe("openai-responses");
    expect(mocks.complete).toHaveBeenCalledTimes(3);
  });
  it("uses an existing matching compatibility profile before dispatch", async () => {
    const record = (await mocks.repository.getConnection(connection.id))!;
    await mocks.repository.saveConnection({ ...record, config: { ...record.config,
      agentRuntimeProfiles: { text: { protocol: "openai-responses", fingerprint: agentModelEvidenceFingerprint(record), verifiedAt: "2026-10-16" } },
    } });
    mocks.complete.mockResolvedValue(reply);
    await completeAgentModel(connection, input);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.complete.mock.calls[0][0].protocol).toBe("openai-responses");
    expect((await mocks.repository.getConnection(connection.id))?.config.agentModelEvidence).toMatchObject({ text: { protocol: "openai-responses", capabilities: { text: true, reasoning: true } } });
  });
  it.each([400, 404, 405, 415, 422])("negotiates a pre-output unsupported schema rejection (%s) and persists only the successful profile", async status => {
    mocks.complete.mockRejectedValueOnce(new DirectorAdapterError("upstream", "unsupported response_format parameter", { status })).mockResolvedValue(reply);
    await expect(completeAgentModel(connection, input)).resolves.toBe(reply);
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect(mocks.complete.mock.calls[0][0]).toMatchObject({ protocol: "openai-chat-completions", capabilities: { structuredOutput: true } });
    expect(mocks.complete.mock.calls[1][0]).toMatchObject({ protocol: "openai-chat-completions", capabilities: { structuredOutput: false } });
    const record = await mocks.repository.getConnection(connection.id);
    expect(record?.config.agentRuntimeProfiles).toMatchObject({ text: { disableStructuredOutput: true, fingerprint: agentModelEvidenceFingerprint(record!) } });
    expect(record?.config.modelGroup).toBe("group-a");
    expect(record?.encryptedSecret).toBe("encrypted");
  });
  it("does not negotiate twice or persist a failed fallback", async () => {
    mocks.complete.mockRejectedValueOnce(new DirectorAdapterError("upstream", "unsupported response_format", { status: 400 }))
      .mockRejectedValueOnce(new DirectorAdapterError("upstream", "unsupported reasoning_effort", { status: 400 }));
    await expect(completeAgentModel(connection, input)).rejects.toThrow("reasoning_effort");
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect((await mocks.repository.getConnection(connection.id))?.config.agentRuntimeProfiles).toBeUndefined();
  });
  it("merges a rejected thinking enum with a matching cached profile without disabling supported levels", async () => {
    const record = (await mocks.repository.getConnection(connection.id))!;
    await mocks.repository.saveConnection({ ...record, config: { ...record.config,
      agentRuntimeProfiles: { text: { protocol: connection.protocol, fingerprint: agentModelEvidenceFingerprint(record), unsupportedReasoningEfforts: ["max"], verifiedAt: "2026-10-16" } },
    } });
    mocks.complete.mockRejectedValueOnce(new DirectorAdapterError("upstream", "reasoning_effort high not supported", { status: 422 })).mockResolvedValue(reply);
    await completeAgentModel(connection, input);
    expect(mocks.complete.mock.calls[1][0].reasoningEffort).toBeUndefined();
    expect((await mocks.repository.getConnection(connection.id))?.config.agentRuntimeProfiles).toMatchObject({ text: { unsupportedReasoningEfforts: ["max", "high"] } });
    await completeAgentModel({ ...connection, reasoningEffort: "low" }, input);
    expect(mocks.complete.mock.calls[2][0].reasoningEffort).toBe("low");
  });
  it("negotiates an absent reasoning parameter without claiming support for the rejected effort", async () => {
    mocks.complete.mockRejectedValueOnce(new DirectorAdapterError("upstream", "unsupported reasoning_effort parameter", { status: 400 })).mockResolvedValue(reply);
    await completeAgentModel(connection, input);
    expect(mocks.complete.mock.calls[1][0].reasoningEffort).toBeUndefined();
    const record = await mocks.repository.getConnection(connection.id);
    expect(record?.config.agentRuntimeProfiles).toMatchObject({ text: { disableReasoning: true } });
    expect(record?.config.agentModelEvidence).toMatchObject({ text: { capabilities: { text: true } } });
    expect((record?.config.agentModelEvidence as Record<string, Record<string, unknown>>).text.reasoningOptions).toBeUndefined();
  });
  it.each(["余额不足", "额度用尽", "billing", "payment required", "authentication failed", "authorization denied", "鉴权失败", "认证失败", "access denied", "invalid api key", "Permission denied", "Unauthenticated", "Invalid token", "Not authorized", "Access token expired", "permission_denied", "invalid_access_token", "Invalid bearer token", "Auth failed", "Budget exceeded", "Rate limit exceeded", "Invalid credentials", "credentials expired", "auth_failed", "rate_limit_exceeded"])("does not negotiate a 400 that mentions %s even alongside an unsupported parameter", async detail => {
    const error = new DirectorAdapterError("upstream", `${detail}: unsupported response_format`, { status: 400 });
    mocks.complete.mockRejectedValue(error);
    await expect(completeAgentModel(connection, input)).rejects.toBe(error);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect((await mocks.repository.getConnection(connection.id))?.config.agentRuntimeProfiles).toBeUndefined();
  });
  it("does not negotiate after a raw successful response chunk even before text is parsed", async () => {
    const error = new DirectorAdapterError("upstream", "unsupported response_format", { status: 400, responseBodyReceived: true });
    mocks.complete.mockRejectedValue(error);
    const onTextDelta = vi.fn();
    await expect(completeAgentModel(connection, { ...input, onTextDelta })).rejects.toBe(error);
    expect(onTextDelta).not.toHaveBeenCalled();
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect((await mocks.repository.getConnection(connection.id))?.config.agentRuntimeProfiles).toBeUndefined();
  });
  it("does not negotiate after any text callback even if the next error resembles a compatible 4xx", async () => {
    mocks.complete.mockImplementationOnce(async (_connection, request) => {
      request.onTextDelta("");
      throw new DirectorAdapterError("upstream", "unsupported response_format", { status: 400 });
    });
    await expect(completeAgentModel(connection, { ...input, onTextDelta: vi.fn() })).rejects.toThrow("response_format");
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
  it("does not negotiate when the request is aborted during a compatible rejection", async () => {
    const controller = new AbortController();
    mocks.complete.mockImplementationOnce(async () => {
      controller.abort();
      throw new DirectorAdapterError("upstream", "unsupported response_format", { status: 400 });
    });
    await expect(completeAgentModel(connection, { ...input, signal: controller.signal })).rejects.toThrow("response_format");
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect((await mocks.repository.getConnection(connection.id))?.config.agentRuntimeProfiles).toBeUndefined();
  });
  it("does not dispatch an already aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(completeAgentModel(connection, { ...input, signal: controller.signal })).rejects.toThrow();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("does not switch audio input to the image-only Responses protocol", async () => {
    mocks.complete.mockRejectedValue(new DirectorAdapterError("upstream", "endpoint /chat/completions not supported", { status: 404 }));
    await expect(completeAgentModel(connection, { ...input, attachments: [{ kind: "audio", url: "data:audio/mpeg;base64,AA==" }] })).rejects.toThrow("endpoint");
    expect(mocks.complete).toHaveBeenCalledTimes(1);
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
  it("applies a saved unsupported thinking value before dispatch without disabling other levels", async () => {
    const record = (await mocks.repository.getConnection(connection.id))!;
    await mocks.repository.saveConnection({ ...record, config: { ...record.config,
      agentRuntimeProfiles: { text: { protocol: connection.protocol, fingerprint: agentModelEvidenceFingerprint(record), unsupportedReasoningEfforts: ["max"], verifiedAt: "2026-10-16" } },
    } });
    mocks.complete.mockResolvedValue(reply);
    await completeAgentModel({ ...connection, reasoningEffort: "max" }, input);
    expect(mocks.complete.mock.calls[0][0].reasoningEffort).toBeUndefined();
    await completeAgentModel(connection, input);
    expect(mocks.complete.mock.calls[1][0].reasoningEffort).toBe("high");
    expect(mocks.complete).toHaveBeenCalledTimes(2);
  });
  it("does not replay or persist success after a partial text stream fails", async () => {
    const delta = vi.fn();
    mocks.complete.mockImplementationOnce(async (_connection, request) => {
      request.onTextDelta('{"type":"reply","message":"一半');
      throw new DirectorAdapterError("network", "connection reset");
    });
    await expect(completeAgentModel(connection, { ...input, onTextDelta: delta })).rejects.toThrow("connection reset");
    expect(delta).toHaveBeenCalledTimes(1);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect((await mocks.repository.getConnection(connection.id))?.config.agentRuntimeProfiles).toBeUndefined();
  });
});

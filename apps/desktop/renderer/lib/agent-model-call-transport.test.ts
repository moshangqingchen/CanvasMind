import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import type { ResolvedDirectorConnection } from "@super-canvas/director";

const mocks = vi.hoisted(() => ({ repository: null as unknown as MemoryRepository }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; } }));
import { completeAgentModel } from "./agent-model-call";
import { DIRECTOR_ADAPTER_TIMEOUT_MS, DirectorAdapterError, requestJson } from "./director-adapters/shared";

const connection: ResolvedDirectorConnection = {
  id: "fixture", name: "fixture", provider: "test", supplier: "test", baseUrl: "https://example.invalid/v1", apiKey: "fixture-not-a-real-key",
  model: "configured-model", protocol: "openai-chat-completions", enabled: true,
  capabilities: { text: true, imageInput: false, audioInput: false, videoInput: false, structuredOutput: true, toolCalling: false, nativeWebSearch: false, reasoning: false },
};
const input = { system: "system", messages: [{ role: "user" as const, content: "你好" }], onTextDelta: vi.fn() };
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const completed = () => new Response(event({ choices: [{ delta: { content: '{"type":"reply","message":"你好"}' }, finish_reason: "stop" }] }) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });

beforeEach(async () => {
  input.onTextDelta.mockClear();
  mocks.repository = new MemoryRepository();
  await mocks.repository.saveConnection({ id: connection.id, name: connection.name, provider: "openai", encryptedSecret: "fixture-encrypted", config: { baseUrl: connection.baseUrl } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("agent compatibility transport boundary", () => {
  it("reads the explicit 4xx error body, dispatches one compatible request through the same transport, then reuses the saved profile", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "unsupported response_format json_schema" } }), { status: 400 }))
      .mockImplementation(async () => completed());
    vi.stubGlobal("fetch", fetch);
    expect((await completeAgentModel(connection, input)).output).toEqual({ type: "reply", message: "你好" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[0][1].body).response_format).toBeDefined();
    expect(JSON.parse(fetch.mock.calls[1][1].body).response_format).toBeUndefined();
    expect((await mocks.repository.getConnection(connection.id))?.config.agentRuntimeProfiles).toMatchObject({ "configured-model": { disableStructuredOutput: true } });
    await completeAgentModel(connection, input);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetch.mock.calls[2][1].body).response_format).toBeUndefined();
  });

  it.each([": keepalive\n\n", 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n', new Uint8Array([0xe4])])("marks a successful raw chunk before parsing text (%s) and never reissues an interrupted request", async first => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      if (pulls++ === 0) controller.enqueue(typeof first === "string" ? new TextEncoder().encode(first) : first);
      else controller.error(new Error("unsupported response_format after connection reset"));
    } });
    const fetch = vi.fn(async () => new Response(body, { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(completeAgentModel(connection, input)).rejects.toMatchObject({ code: "network", responseBodyReceived: true });
    expect(input.onTextDelta).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await mocks.repository.getConnection(connection.id))?.config.agentRuntimeProfiles).toBeUndefined();
  });

  it("retains the body marker on a parsed upstream stream error before any message delta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(event({ error: { message: "unsupported response_format" } }), { headers: { "content-type": "text/event-stream" } })));
    await expect(requestJson(connection, "https://example.invalid/v1/chat/completions", { method: "POST" }, undefined, input.onTextDelta)).rejects.toMatchObject({ code: "upstream", status: 502, responseBodyReceived: true });
    expect(input.onTextDelta).not.toHaveBeenCalled();
  });

  it("does not mark an HTTP rejection body as model output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "unsupported response_format" } }), { status: 422 })));
    await expect(requestJson(connection, "https://example.invalid/v1/chat/completions", { method: "POST" })).rejects.toMatchObject({ code: "upstream", status: 422, responseBodyReceived: false });
  });

  it("never negotiates a 400 declared as SSE once any error body fragment arrived", async () => {
    const fetch = vi.fn(async () => new Response(event({ error: { message: "unsupported response_format json_schema" } }), { status: 400, headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(completeAgentModel(connection, input)).rejects.toMatchObject({ code: "upstream", status: 400, responseBodyReceived: true });
    expect(input.onTextDelta).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await mocks.repository.getConnection(connection.id))?.config.agentRuntimeProfiles).toBeUndefined();
  });

  it("does not negotiate an authentication failure disguised as an unsupported parameter", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: "authentication failed: unsupported response_format" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    await expect(completeAgentModel(connection, input)).rejects.toBeInstanceOf(DirectorAdapterError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("gives an elapsed transport timeout priority over a simultaneous compatible rejection", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url: string, request: RequestInit) => new Promise<Response>((_resolve, reject) => {
      request.signal!.addEventListener("abort", () => reject(new DirectorAdapterError("upstream", "unsupported response_format", { status: 400 })), { once: true });
    }));
    vi.stubGlobal("fetch", fetch);
    const outcome = completeAgentModel(connection, input).catch(error => error);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(DIRECTOR_ADAPTER_TIMEOUT_MS);
    expect(await outcome).toMatchObject({ code: "timeout" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await mocks.repository.getConnection(connection.id))?.config.agentRuntimeProfiles).toBeUndefined();
  });
});

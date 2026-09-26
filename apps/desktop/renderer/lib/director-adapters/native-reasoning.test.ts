import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectorAdapterInput, DirectorConnection, DirectorProtocol } from "@super-canvas/director";
import { createDirectorAdapterRegistry } from "./index";

const input: DirectorAdapterInput = {
  system: "Return a short answer.", messages: [{ role: "user", content: "Hello" }],
};
const reply = JSON.stringify({ type: "reply", message: "Hello" });
function connection(protocol: DirectorProtocol, model: string, reasoningEffort?: string): DirectorConnection {
  return {
    id: "native-test", name: "native test", provider: "test", supplier: "test", enabled: true,
    baseUrl: "https://native.example.test/v1", apiKey: "fixture", model, protocol, reasoningEffort,
    capabilities: { text: true, imageInput: true, audioInput: false, videoInput: false,
      structuredOutput: false, toolCalling: false, nativeWebSearch: false, reasoning: true },
  };
}
function mockRequest(protocol: DirectorProtocol) {
  const fetchMock = vi.fn(async () => Response.json(protocol === "anthropic-messages"
    ? { content: [{ type: "text", text: reply }], stop_reason: "end_turn" }
    : { candidates: [{ content: { parts: [{ text: reply }] }, finishReason: "STOP" }] }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe("native model reasoning serialization", () => {
  it.each([
    ["claude-opus-4-5", "medium", false],
    ["claude-opus-4-5-20251101", "high", false],
    ["claude-opus-4-6", "max", true],
    ["claude-sonnet-4-6", "max", true],
    ["claude-opus-4-7", "xhigh", true],
    ["claude-opus-4-8", "xhigh", true],
    ["claude-opus-5", "max", true],
    ["claude-sonnet-5", "xhigh", true],
    ["claude-fable-5", "max", true],
    ["claude-fable-5-1", "max", true],
  ] as const)("serializes %s effort %s with its supported thinking mode", async (model, effort, adaptive) => {
    const fetchMock = mockRequest("anthropic-messages");
    await createDirectorAdapterRegistry().get("anthropic-messages").complete(connection("anthropic-messages", model, effort), input);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://native.example.test/v1/messages");
    expect(body.output_config).toEqual({ effort });
    expect(body.thinking).toEqual(adaptive ? { type: "adaptive" } : undefined);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.max_tokens).toBe(8192);
  });

  it.each([
    ["gemini-3-pro-preview", "low"],
    ["gemini-3.1-pro-preview", "medium"],
    ["gemini-3-flash-preview", "minimal"],
    ["gemini-3.5-flash", "high"],
  ])("serializes %s with native thinkingLevel %s", async (model, effort) => {
    const fetchMock = mockRequest("google-generate-content");
    const base = connection("google-generate-content", `models/${model}`, effort);
    const configured = { ...base, capabilities: { ...base.capabilities, structuredOutput: true } };
    await createDirectorAdapterRegistry().get("google-generate-content").complete(configured, { ...input, maxOutputTokens: 16384 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe(`https://native.example.test/v1/models/${model}:generateContent`);
    expect(body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: effort }, maxOutputTokens: 16384, responseMimeType: "application/json" });
    expect(body.generationConfig.responseJsonSchema).toBeDefined();
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("adds thinkingConfig even when neither structured output nor output budget is set", async () => {
    const fetchMock = mockRequest("google-generate-content");
    await createDirectorAdapterRegistry().get("google-generate-content").complete(connection("google-generate-content", "gemini-3.5-flash", "medium"), input);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: "medium" } });
  });

  it.each([
    ["anthropic-messages", "claude-opus-5", "none"],
    ["google-generate-content", "gemini-2.5-pro", "high"],
    ["google-generate-content", "gemini-2.5-flash", "low"],
    ["google-generate-content", "gemini-3.5-flash", "xhigh"],
  ] as const)("rejects unsupported native option %s / %s / %s before calling upstream", async (protocol, model, effort) => {
    const fetchMock = mockRequest(protocol);
    await expect(createDirectorAdapterRegistry().get(protocol).complete(connection(protocol, model, effort), input)).rejects.toMatchObject({ code: "configuration" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["anthropic-messages", "claude-opus-4-5", "max"],
    ["anthropic-messages", "claude-sonnet-4-6", "xhigh"],
    ["google-generate-content", "gemini-3-pro-preview", "medium"],
    ["google-generate-content", "gemini-3.1-pro-preview", "minimal"],
  ] as const)("preserves already-validated supplier declarations for %s / %s / %s", async (protocol, model, effort) => {
    const fetchMock = mockRequest(protocol);
    await createDirectorAdapterRegistry().get(protocol).complete(connection(protocol, model, effort), input);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(protocol === "anthropic-messages" ? body.output_config.effort : body.generationConfig.thinkingConfig.thinkingLevel).toBe(effort);
  });

  it.each([
    ["anthropic-messages", "claude-opus-4-6"],
    ["google-generate-content", "gemini-2.5-pro"],
  ] as const)("leaves automatic native settings unchanged for %s", async (protocol, model) => {
    const fetchMock = mockRequest(protocol);
    await createDirectorAdapterRegistry().get(protocol).complete(connection(protocol, model), input);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(body.generationConfig).toBeUndefined();
  });

  it.each([
    ["claude-opus-4-6", "high"],
    ["claude-fable-5-1", "high"],
    ["claude-opus-5", undefined],
  ])("uses automatic strict tools when adaptive thinking is active on %s", async (model, effort) => {
    const fetchMock = mockRequest("anthropic-messages");
    const base = connection("anthropic-messages", model!, effort);
    const configured = { ...base, capabilities: { ...base.capabilities, toolCalling: true } };
    await createDirectorAdapterRegistry().get("anthropic-messages").complete(configured, input);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.tool_choice.type).toBe("auto");
    expect(body.tools[0].strict).toBe(true);
  });
});

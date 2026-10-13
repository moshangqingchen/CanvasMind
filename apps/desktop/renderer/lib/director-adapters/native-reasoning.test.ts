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
function mockRequest() {
  const fetchMock = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: reply }] }, finishReason: "STOP" }] }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe("native model reasoning serialization", () => {

  it.each([
    ["gemini-3-pro-preview", "low"],
    ["gemini-3.1-pro-preview", "medium"],
    ["gemini-3-flash-preview", "minimal"],
    ["gemini-3.5-flash", "high"],
  ])("serializes %s with native thinkingLevel %s", async (model, effort) => {
    const fetchMock = mockRequest();
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
    const fetchMock = mockRequest();
    await createDirectorAdapterRegistry().get("google-generate-content").complete(connection("google-generate-content", "gemini-3.5-flash", "medium"), input);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: "medium" } });
  });

  it.each([
    ["google-generate-content", "gemini-2.5-pro", "high"],
    ["google-generate-content", "gemini-2.5-flash", "low"],
    ["google-generate-content", "gemini-3.5-flash", "xhigh"],
  ] as const)("rejects unsupported native option %s / %s / %s before calling upstream", async (protocol, model, effort) => {
    const fetchMock = mockRequest();
    await expect(createDirectorAdapterRegistry().get(protocol).complete(connection(protocol, model, effort), input)).rejects.toMatchObject({ code: "configuration" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["google-generate-content", "gemini-3-pro-preview", "medium"],
    ["google-generate-content", "gemini-3.1-pro-preview", "minimal"],
  ] as const)("preserves already-validated supplier declarations for %s / %s / %s", async (protocol, model, effort) => {
    const fetchMock = mockRequest();
    await createDirectorAdapterRegistry().get(protocol).complete(connection(protocol, model, effort), input);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe(effort);
  });

  it.each([
    ["google-generate-content", "gemini-2.5-pro"],
  ] as const)("leaves automatic native settings unchanged for %s", async (protocol, model) => {
    const fetchMock = mockRequest();
    await createDirectorAdapterRegistry().get(protocol).complete(connection(protocol, model), input);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(body.generationConfig).toBeUndefined();
  });
});

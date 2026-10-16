import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectorProtocol, ResolvedDirectorConnection } from "@super-canvas/director";
import { createDirectorAdapterRegistry } from "./index";
import { AGENT_OUTPUT_SCHEMA } from "../agent-contracts";

afterEach(() => vi.unstubAllGlobals());
const protocols: DirectorProtocol[] = ["openai-chat-completions", "generic-openai-compatible", "openai-responses", "xai-responses", "google-generate-content"];
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
describe("live model adapter requests", () => {
  it.each(protocols)("sends exactly one %s streaming request and keeps final schema validation", async protocol => {
    const raw = JSON.stringify({ decision: JSON.stringify({ type: "reply", message: "原始你好" }) });
    const split = Math.floor(raw.length / 2), first = raw.slice(0, split), last = raw.slice(split);
    const stream = protocol === "google-generate-content"
      ? event({ candidates: [{ content: { parts: [{ text: first }] } }] }) + event({ candidates: [{ content: { parts: [{ text: last }] }, finishReason: "STOP" }] })
      : protocol.includes("responses")
        ? event({ type: "response.output_item.added", output_index: 0, item: { type: "reasoning" } }) + event({ type: "response.output_text.delta", output_index: 1, delta: first }) + event({ type: "response.output_text.delta", output_index: 1, delta: last }) + event({ type: "response.completed", response: { status: "completed" } })
        : event({ choices: [{ delta: { content: first } }] }) + event({ choices: [{ delta: { content: last }, finish_reason: "stop" }] }) + "data: [DONE]\n\n";
    const fetch = vi.fn(async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);
    const connection: ResolvedDirectorConnection = { id: "fixture", name: "fixture", provider: "test", supplier: "test", baseUrl: "https://example.invalid/v1", apiKey: "fixture-not-a-real-key", model: "configured-model", protocol, enabled: true,
      capabilities: { text: true, imageInput: false, audioInput: false, videoInput: false, structuredOutput: true, toolCalling: false, nativeWebSearch: false, reasoning: false } };
    const deltas: string[] = [];
    const input = { system: "system", messages: [{ role: "user" as const, content: "你好" }], responseJsonSchema: AGENT_OUTPUT_SCHEMA, requireComplete: true, onTextDelta: (text: string) => deltas.push(text) };
    const result = await createDirectorAdapterRegistry().get(protocol).complete(connection, input);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(deltas.join("")).toBe(raw);
    expect(result.output).toEqual({ type: "reply", message: "原始你好" });
    const [url, request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    if (protocol === "google-generate-content") expect(url).toContain(":streamGenerateContent?alt=sse");
    else expect(JSON.parse(String(request.body)).stream).toBe(true);
  });
});

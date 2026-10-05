import { afterEach, describe, expect, it, vi } from "vitest";
import { streamAgentTurn } from "./agent-client";
import type { AgentTurnInput } from "./agent-contracts";

const input: AgentTurnInput = { canvasId: "canvas", sessionId: "s", requestId: "r", connectionId: "key", modelId: "text", message: "hello", attachmentAssetIds: [], selectedNodeIds: [] };
afterEach(() => vi.unstubAllGlobals());
describe("agent event stream", () => {
  it("does not emit buffered events after the caller cancels the turn", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      'data: {"type":"stage","message":"处理中"}\n\ndata: {"type":"done","status":"succeeded"}\n\n',
    )));
    const events = vi.fn(() => controller.abort());
    await expect(streamAgentTurn(input, events, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(events).toHaveBeenCalledOnce();
  });

  it("releases the stream immediately after the done event instead of waiting for EOF", async () => {
    let close!: () => void;
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"done","status":"succeeded"}\n\n'));
      close = () => { try { controller.close(); } catch { /* cancelled */ } };
    }, cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const pending = streamAgentTurn(input, () => {}, new AbortController().signal);
    try {
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce(), { timeout: 100 });
    } finally {
      close();
      await pending;
    }
    expect(body.locked).toBe(false);
  });

  it("accepts chunked CRLF events, heartbeats and a final frame without a separator", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({ start(controller) {
      for (const chunk of [': keep-alive\r\n\r\ndata: {"type":"stage",', '"message":"等待"}\r', '\n\r\ndata: {"type":"done","status":"succeeded"}']) controller.enqueue(encoder.encode(chunk));
      controller.close();
    } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const events = vi.fn();
    await streamAgentTurn(input, events, new AbortController().signal);
    expect(events.mock.calls.map(call => call[0].type)).toEqual(["stage", "done"]);
  });
  it("reports lost connections without resending", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('data: {"type":"stage","message":"处理中"}\n\n'));
    vi.stubGlobal("fetch", fetch);
    await expect(streamAgentTurn(input, () => {}, new AbortController().signal)).rejects.toThrow("中断");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

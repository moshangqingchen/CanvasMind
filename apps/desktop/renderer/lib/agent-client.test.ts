import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_AGENT_PARTIAL_FRAME_CHARACTERS, streamAgentTurn } from "./agent-client";
import type { AgentSession, AgentTurnInput } from "./agent-contracts";

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

  it("cancels an oversized unfinished frame before EOF without waiting for a caller abort or resending", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const cancel = vi.fn();
    let chunksRead = 0;
    // A bounded producer leaves the stream open after eight chunks. The old
    // parser reads all chunks and waits forever: there is no separator or EOF.
    const body = new ReadableStream<Uint8Array>({ pull(stream) {
      if (chunksRead++ < 8) stream.enqueue(encoder.encode("x".repeat(512)));
    }, cancel });
    const fetch = vi.fn().mockResolvedValue(new Response(body));
    vi.stubGlobal("fetch", fetch);
    const events = vi.fn();
    const settled = streamAgentTurn(input, events, controller.signal, { maxPartialFrameCharacters: 1024 })
      .then(() => null, error => error as Error);
    try {
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce(), { timeout: 100 });
      expect(await settled).toMatchObject({ message: expect.stringMatching(/响应过大或格式不完整.*手动重试/u) });
      expect(controller.signal.aborted).toBe(false);
      expect(chunksRead).toBeLessThanOrEqual(4); // A stream may prefetch one chunk.
      expect(events).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    } finally {
      controller.abort();
      await settled;
    }
  });

  it("limits each frame independently when one large chunk contains many valid frames", async () => {
    const frame = 'data: {"type":"stage","message":"处理中"}\n\n';
    const whole = frame.repeat(20) + 'data: {"type":"done","status":"succeeded"}\n\n';
    expect(whole.length).toBeGreaterThan(128);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(whole)));
    const events = vi.fn();
    await streamAgentTurn(input, events, new AbortController().signal, { maxPartialFrameCharacters: 128 });
    expect(events).toHaveBeenCalledTimes(21);
    expect(events.mock.calls[20][0].type).toBe("done");
  });

  it("accepts a full-size frame with a separator split across CRLF and Unicode chunks", async () => {
    const frame = `data: ${JSON.stringify({ type: "stage", message: "创作🙂".repeat(24) })}`;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(frame);
    const body = new ReadableStream({ start(stream) {
      for (let offset = 0; offset < bytes.length; offset += 7) stream.enqueue(bytes.slice(offset, offset + 7));
      for (const tail of ["\r", "\n\r", "\n", 'data: {"type":"done","status":"succeeded"}']) stream.enqueue(encoder.encode(tail));
      stream.close();
    } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const events = vi.fn();
    await streamAgentTurn(input, events, new AbortController().signal, { maxPartialFrameCharacters: frame.length });
    expect(events.mock.calls.map(call => call[0].type)).toEqual(["stage", "done"]);
    expect(events.mock.calls[0][0].message).toBe("创作🙂".repeat(24));
  });

  it("accepts a multi-megabyte complete session with 240 long messages at the normal limit", async () => {
    const session: AgentSession = { id: "long-session", canvasId: input.canvasId, title: "长对话", plans: [],
      messages: Array.from({ length: 240 }, (_, index) => ({ id: `message-${index}`,
        role: index % 2 ? "assistant" : "user", content: "创作上下文".repeat(1024),
        createdAt: "2000-01-01T00:00:00.000Z", metadata: {} })) };
    const frame = `data: ${JSON.stringify({ type: "session", session })}\n\ndata: {"type":"done","status":"succeeded"}\n\n`;
    expect(frame.length).toBeLessThan(MAX_AGENT_PARTIAL_FRAME_CHARACTERS);
    const bytes = new TextEncoder().encode(frame);
    expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024);
    const body = new ReadableStream({ start(stream) {
      for (let offset = 0; offset < bytes.length; offset += 8191) stream.enqueue(bytes.slice(offset, offset + 8191));
      stream.close();
    } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const events = vi.fn();
    await streamAgentTurn(input, events, new AbortController().signal);
    expect(events.mock.calls.map(call => call[0].type)).toEqual(["session", "done"]);
    expect(events.mock.calls[0][0].session.messages).toHaveLength(240);
    expect(events.mock.calls[0][0].session.messages[239].content).toBe(session.messages[239].content);
    expect(body.locked).toBe(false);
  });

  it.each([0, -1, Infinity, NaN, MAX_AGENT_PARTIAL_FRAME_CHARACTERS + 1])("rejects an invalid frame memory limit %s before fetching", async limit => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(streamAgentTurn(input, () => {}, new AbortController().signal, { maxPartialFrameCharacters: limit }))
      .rejects.toThrow("Invalid Agent partial-frame memory limit");
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { streamDirectorTurn } from "./director-client";

afterEach(() => vi.unstubAllGlobals());

const input = { canvasId: "canvas", message: "hello" };
const encoder = new TextEncoder();

describe("director event stream", () => {
  it("does not emit buffered events after a callback cancels the turn", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      'data: {"type":"stage","message":"处理中"}\n\ndata: {"type":"done","sessionId":"session"}\n\n',
    )));
    const events = vi.fn(() => controller.abort());
    await expect(streamDirectorTurn(input, events, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(events).toHaveBeenCalledOnce();
  });

  it("parses CRLF separators even when every byte arrives separately", async () => {
    const frames = ': keep-alive\r\n\r\ndata: {"type":"stage","message":"处理中"}\r\n\r\ndata: {"type":"done","sessionId":"session"}';
    const body = new ReadableStream({ start(controller) {
      for (const byte of encoder.encode(frames)) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const events = vi.fn();
    await streamDirectorTurn(input, events);
    expect(events.mock.calls.map(([event]) => event.type)).toEqual(["stage", "done"]);
    expect(events.mock.calls[0]?.[0].message).toBe("处理中");
    expect(body.locked).toBe(false);
  });

  it("releases the connection immediately after a terminal event", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"done","sessionId":"session"}\n\n'));
    }, cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await streamDirectorTurn(input, () => {});
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("reports an interrupted stream instead of treating the partial answer as complete", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('data: {"type":"stage","message":"处理中"}\n\n'));
    vi.stubGlobal("fetch", fetcher);
    await expect(streamDirectorTurn(input, () => {})).rejects.toThrow("连接已中断");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("cancels an idle reader when the caller aborts", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const pending = streamDirectorTurn(input, () => {}, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("cancels and unlocks a stream when event parsing fails", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode("data: broken-json\n\n"));
    }, cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(streamDirectorTurn(input, () => {})).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
vi.mock("@super-canvas/providers", () => ({ providerFetch: vi.fn() }));
import { readModelResponse, DirectorAdapterError, strictDecisionFromCandidates } from "./shared";

const connection = { supplier: "测试供应商", apiKey: "not-a-real-key" };
const encoder = new TextEncoder();
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;

function controlledResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel: cancelled });
  return { response: new Response(body, { headers: { "content-type": "text/event-stream" } }), cancelled,
    write: (text: string) => controller.enqueue(encoder.encode(text)), close: () => controller.close() };
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe("live upstream SSE transport", () => {
  it("publishes chat deltas before response completion, then preserves the final envelope and usage", async () => {
    const transport = controlledResponse(), deltas: string[] = [];
    const result = readModelResponse(transport.response, connection, text => deltas.push(text));
    transport.write(frame({ choices: [{ index: 0, delta: { content: '{"type":"reply","message":"你' } }] }));
    await tick(); expect(deltas).toEqual(['{"type":"reply","message":"你']);
    transport.write(frame({ choices: [{ index: 0, delta: { content: '好"}' }, finish_reason: "stop" }] }));
    transport.write(frame({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }));
    transport.write("data: [DONE]\r\n\r\n"); transport.close();
    await expect(result).resolves.toMatchObject({ choices: [{ message: { content: '{"type":"reply","message":"你好"}' }, finish_reason: "stop" }], usage: { total_tokens: 7 } });
  });
  it("decodes Responses deltas with explicit completion and citations", async () => {
    const transport = controlledResponse(), deltas: string[] = [];
    const result = readModelResponse(transport.response, connection, text => deltas.push(text));
    transport.write(frame({ type: "response.output_item.added", output_index: 0, item: { type: "reasoning" } }));
    transport.write(frame({ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "第一段" }));
    await tick(); expect(deltas).toEqual(["第一段"]);
    transport.write(frame({ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "第二段" }));
    transport.write(frame({ type: "response.completed", response: { status: "completed", usage: { total_tokens: 9 }, output: [{ type: "message", content: [{ type: "output_text", annotations: [{ url_citation: { url: "https://source.invalid" } }] }] }] } }));
    transport.close();
    await expect(result).resolves.toMatchObject({ status: "completed", output_text: "第一段第二段", usage: { total_tokens: 9 } });
  });
  it.each(["chat", "responses", "google"] as const)("returns a completed %s result without waiting for EOF or a heartbeat timeout", async protocol => {
    const transport = controlledResponse();
    const pending = readModelResponse(transport.response, connection);
    if (protocol === "chat") {
      transport.write(frame({ choices: [{ delta: { content: "完整结果" }, finish_reason: "stop" }] }));
      await tick(); expect(transport.cancelled).not.toHaveBeenCalled();
      transport.write(frame({ choices: [], usage: { total_tokens: 7 } }));
      transport.write("data: [DONE]\r\n\r\n");
    } else if (protocol === "responses") {
      transport.write(frame({ type: "response.output_text.delta", output_index: 1, delta: "完整结果" }));
      transport.write(frame({ type: "response.completed", response: { status: "completed", usage: { total_tokens: 7 } } }));
    } else transport.write(frame({ candidates: [{ content: { parts: [{ text: "完整结果" }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 7 } }));
    await vi.waitFor(() => expect(transport.cancelled).toHaveBeenCalledTimes(1), { timeout: 200 });
    const result = await pending;
    expect(result).toBeTruthy();
    expect(JSON.stringify(result)).toContain("完整结果");
    expect(transport.response.body?.locked).toBe(false);
  });
  it("aggregates Google candidate text incrementally without exposing thought parts", async () => {
    const transport = controlledResponse(), deltas: string[] = [];
    const result = readModelResponse(transport.response, connection, text => deltas.push(text));
    transport.write(frame({ candidates: [{ index: 0, content: { parts: [{ text: "不显示思考", thought: true }, { text: "你好" }] } }] }));
    await tick(); expect(deltas).toEqual(["你好"]);
    transport.write(frame({ candidates: [{ index: 0, content: { parts: [{ text: "，继续" }] }, finishReason: "STOP", groundingMetadata: { groundingChunks: [{ web: { uri: "https://source.invalid" } }] } }], usageMetadata: { totalTokenCount: 11 } }));
    transport.close();
    await expect(result).resolves.toMatchObject({ candidates: [{ content: { parts: [{ text: "你好，继续" }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 11 } });
  });
  it("handles UTF-8 and CRLF split at every byte boundary", async () => {
    const raw = frame({ choices: [{ delta: { content: "中文😀" }, finish_reason: "stop" }] });
    const bytes = encoder.encode(raw);
    const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
    const deltas: string[] = [];
    await readModelResponse(response, connection, text => deltas.push(text));
    expect(deltas).toEqual(["中文😀"]);
  });
  it("fails a truncated or malformed stream after previews without treating it as a completed response", async () => {
    const transport = controlledResponse(), deltas: string[] = [];
    const result = readModelResponse(transport.response, connection, text => deltas.push(text));
    transport.write(frame({ choices: [{ delta: { content: "收到的半句话" } }] }));
    await tick(); expect(deltas).toEqual(["收到的半句话"]);
    transport.close();
    await expect(result).rejects.toThrow("完成前中断");
    await expect(readModelResponse(new Response("data: {broken}\n\n", { headers: { "content-type": "text/event-stream" } }), connection)).rejects.toBeInstanceOf(DirectorAdapterError);
  });
  it("cancels the reader when stopped, with no further deltas", async () => {
    const transport = controlledResponse(), abort = new AbortController(), deltas: string[] = [];
    const result = readModelResponse(transport.response, connection, text => deltas.push(text), abort.signal);
    transport.write(frame({ choices: [{ delta: { content: "先到这里" } }] }));
    await tick(); abort.abort(new Error("user stopped"));
    await expect(result).rejects.toThrow("user stopped");
    expect(transport.cancelled).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(["先到这里"]);
  });
  it("keeps ordinary JSON providers compatible and never emits error bodies as a reply", async () => {
    const delta = vi.fn();
    await expect(readModelResponse(new Response(JSON.stringify({ choices: [{ message: { content: "完整回复" } }] })), connection, delta)).resolves.toMatchObject({ choices: [{ message: { content: "完整回复" } }] });
    await expect(readModelResponse(new Response(JSON.stringify({ error: { message: "insufficient balance" } }), { status: 400 }), connection, delta)).rejects.toThrow("拒绝了请求");
    expect(delta).not.toHaveBeenCalled();
  });
  it("routes malformed complete JSON to schema repair instead of a confirmed reply fallback", () => {
    const invalid = '{"type":"tool","message":"已执行';
    expect(strictDecisionFromCandidates([invalid], { type: "object" })).toBe(invalid);
    expect(strictDecisionFromCandidates(["```json\n{broken}\n```"], { type: "object" })).toBe("```json\n{broken}\n```");
    expect(strictDecisionFromCandidates(["这是普通自然回答"], { type: "object" })).toEqual({ type: "reply", message: "这是普通自然回答" });
  });
});

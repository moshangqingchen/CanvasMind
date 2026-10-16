import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { accountingFromResponse, createEvaluationTransport } from "./transport";
import { countHttpAttempts } from "./budget";
import { EVALUATION_TEMP } from "./paths";
import { testSelection } from "./test-fixture";
function directory() { mkdirSync(EVALUATION_TEMP, { recursive: true }); return mkdtempSync(join(EVALUATION_TEMP, "transport-test-")); }
const snapshot = testSelection();
const request = { method: "POST", body: JSON.stringify({ model: snapshot.connection.model, messages: [{ content: "文字" }] }) };
const url = `${snapshot.connection.baseUrl}/chat/completions`;
const identity = () => ({ phase: "baseline" as const, caseId: "fake", connectionId: snapshot.connection.id,
  modelId: snapshot.connection.model, intent: "chat" as const });
describe("metered text transport", () => {
  it("durably reserves before send and redacts request/provider evidence", async () => {
    const ledgerDirectory = directory();
    const send = vi.fn(async (_url, init) => {
      expect(existsSync(join(ledgerDirectory, "0001.reserve.json"))).toBe(true);
      expect(init.redirect).toBe("manual");
      return new Response(JSON.stringify({ choices: [], usage: { total_tokens: 12 }, debug: snapshot.connection.apiKey }));
    });
    const transport = createEvaluationTransport({ connection: snapshot.connection, identity,
      inputSummary: () => `input ${snapshot.connection.apiKey}`, ledgerDirectory, send, secrets: [snapshot.connection.apiKey] });
    await transport.fetch(url, request);
    const saved = readFileSync(join(ledgerDirectory, "0001.result.json"), "utf8");
    expect(saved).not.toContain(snapshot.connection.apiKey);
    expect(JSON.parse(saved).accounting.usage.total_tokens).toBe(12);
    expect(transport.calls()).toBe(1);
  });
  it("each compatibility attempt gets its own slot; credit/network errors stop all later calls", async () => {
    const ledgerDirectory = directory();
    const send = vi.fn().mockResolvedValueOnce(new Response('{"error":"unsupported endpoint route"}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{"error":"credit balance exhausted"}', { status: 400 }));
    const transport = createEvaluationTransport({ connection: snapshot.connection, identity,
      inputSummary: () => "fixture", ledgerDirectory, send, secrets: [] });
    await transport.fetch(url, request);
    expect(transport.stopped()).toBeUndefined();
    await transport.fetch(url.replace("chat/completions", "responses"), request);
    expect(transport.stopped()).toContain("上游失败");
    await expect(transport.fetch(url, request)).rejects.toThrow("已停止");
    expect(countHttpAttempts(ledgerDirectory)).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("rejected media costs zero slots; a network failure consumes exactly one", async () => {
    const ledgerDirectory = directory();
    const send = vi.fn().mockRejectedValue(new Error("network"));
    const transport = createEvaluationTransport({ connection: snapshot.connection, identity,
      inputSummary: () => "fixture", ledgerDirectory, send, secrets: [] });
    await expect(transport.fetch(url.replace("chat/completions", "images/generations"), request)).rejects.toThrow();
    expect(countHttpAttempts(ledgerDirectory)).toBe(0);
    await expect(transport.fetch(url, request)).rejects.toThrow("network");
    await expect(transport.fetch(url, request)).rejects.toThrow("已停止");
    expect(countHttpAttempts(ledgerDirectory)).toBe(1);
    expect(send).toHaveBeenCalledOnce();
  });
  it("logs returned stream usage without inventing prices", () => {
    const raw = 'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\ndata: [DONE]\n';
    expect(accountingFromResponse(raw)).toEqual({ usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } });
    expect(accountingFromResponse('{"choices":[]}')).toEqual({});
    expect(accountingFromResponse('data: {"type":"response.completed","response":{"usage":{"total_tokens":7},"cost":0.01}}\n'))
      .toEqual({ usage: { total_tokens: 7 }, cost: 0.01 });
  });
});

import { describe, expect, it } from "vitest";
import { createModelStream } from "../../lib/director-adapters/model-stream";
import { AgentMessageProjection } from "../../lib/agent-stream-message";
import { strictDecisionFromCandidates } from "../../lib/director-adapters/shared";
import { AGENT_OUTPUT_SCHEMA, AgentDecisionSchema } from "../../lib/agent-contracts";

const frame = (value: unknown) => `data: ${JSON.stringify(value)}`;
const fail = (_kind: string, detail?: unknown): never => { throw new Error(String(detail ?? "stream failed")); };
describe("independent streaming review regressions", () => {
  it("streams the first assistant text even when Responses reasoning occupies output index 0", () => {
    const deltas: string[] = [];
    const stream = createModelStream(fail, text => deltas.push(text));
    stream.accept(frame({ type: "response.output_item.added", output_index: 0, item: { type: "reasoning" } }));
    stream.accept(frame({ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: '{"type":"reply","message":"你好"}' }));
    expect(deltas).toEqual(['{"type":"reply","message":"你好"}']);
    stream.accept(frame({ type: "response.completed", response: { status: "completed" } }));
    expect(stream.finish()).toMatchObject({ status: "completed", output_text: '{"type":"reply","message":"你好"}' });
  });
  it("never exposes Google thought text and does not accept an unterminated preview as a final result", () => {
    const deltas: string[] = [];
    const stream = createModelStream(fail, text => deltas.push(text));
    stream.accept(frame({ candidates: [{ index: 0, content: { parts: [{ thought: true, text: "secret reasoning" }, { text: "可见预览" }] } }] }));
    expect(deltas).toEqual(["可见预览"]);
    expect(() => stream.finish()).toThrow("interrupted");
  });
  it("keeps artifact internals and escaped JSON envelopes out of the preview", () => {
    const projection = new AgentMessageProjection();
    expect(projection.push(JSON.stringify({ type: "artifact", message: "成果说明", artifact: { content: "不在delta里显示", message: "嵌套非回复" } }))).toBe("成果说明");
  });
  it("keeps ordinary prose fallback but never confirms malformed structured decisions as replies", () => {
    expect(strictDecisionFromCandidates(["普通自然语言回复"], AGENT_OUTPUT_SCHEMA)).toEqual({ type: "reply", message: "普通自然语言回复" });
    for (const malformed of ['{"type":"tool","tool":"read_canvas","message":"未完成的协议', '```json\n{"type":"reply","message":\n```']) {
      const candidate = strictDecisionFromCandidates([malformed], AGENT_OUTPUT_SCHEMA);
      expect(AgentDecisionSchema.safeParse(candidate).success).toBe(false);
      expect(candidate).not.toMatchObject({ type: "reply" });
    }
  });
});

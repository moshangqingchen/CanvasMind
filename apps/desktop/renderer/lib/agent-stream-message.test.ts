import { describe, expect, it } from "vitest";
import { AgentMessageProjection } from "./agent-stream-message";

describe("incremental assistant message projection", () => {
  const message = "先看结论：暖金主视觉。\n标题用“秋日好物”，保留 \\ 素材路径；灯光 ✨😀。";
  it.each(["top", "decision-string", "decision-object", "fence"])("extracts %s messages across every possible split", shape => {
    const decision = { type: "reply", message };
    const encoded = shape === "decision-string" ? JSON.stringify({ decision: JSON.stringify(decision) })
      : shape === "decision-object" ? JSON.stringify({ decision }) : shape === "fence" ? `\`\`\`json\n${JSON.stringify(decision)}\n\`\`\`` : JSON.stringify(decision);
    for (let cut = 0; cut <= encoded.length; cut++) {
      const projection = new AgentMessageProjection();
      expect(projection.push(encoded.slice(0, cut)) + projection.push(encoded.slice(cut))).toBe(message);
    }
    const projection = new AgentMessageProjection();
    expect(Array.from({ length: encoded.length }, (_, index) => projection.push(encoded.slice(index, index + 1))).join("")).toBe(message);
  });
  it("emits readable text before the JSON object has finished without exposing envelopes", () => {
    const projection = new AgentMessageProjection();
    expect(projection.push('{"decision":"{\\"type\\":\\"reply\\",\\"message\\":\\"你好')).toBe("你好");
    expect(projection.push('，先定版式')).toBe("，先定版式");
    expect(projection.push('\\"}"}')).toBe("");
  });
  it("waits for complete unicode escapes and surrogate pairs", () => {
    const projection = new AgentMessageProjection();
    expect(projection.push('{"message":"\\u4f')).toBe("");
    expect(projection.push('60\\uD83D')).toBe("你");
    expect(projection.push('\\uDE00"}')).toBe("😀");
  });
  it("does not stream artifact fields, quoted keys or later malformed JSON syntax", () => {
    const projection = new AgentMessageProjection();
    expect(projection.push('{"artifact":{"message":"隐藏","content":"\\"message\\":\\"不是回复\\""},"message":"可见')).toBe("可见");
    expect(projection.push('\\q BAD SYNTAX')).toBe("");
  });
  it("supports ordinary non-JSON replies without waiting for completion and bounds previews", () => {
    const projection = new AgentMessageProjection();
    expect(projection.push("结论先行")).toBe("结论先行");
    expect(projection.push("a".repeat(40_000)).length).toBe(32_000 - 4);
    expect(projection.push("more")).toBe("");
  });
});

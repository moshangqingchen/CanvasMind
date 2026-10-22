import { describe, expect, it } from "vitest";
import { agentConversationItems, agentMarkdown, agentPlanRequest, agentRelativeTime, agentReplyContext, hasAgentTurnReply, safeAgentLink } from "./agent-presentation";
import type { AgentMessage, AgentSession } from "./agent-contracts";
describe("agent presentation", () => {
  it("groups observations without changing their data or order", () => {
    const message = (id: string, kind: string): AgentMessage => ({ id, role: "assistant", content: id, createdAt: "", metadata: { kind } });
    const original = [message("a", "tool"), message("b", "tool"), message("c", "reply"), message("d", "tool")];
    const result = agentConversationItems(original);
    expect(result).toHaveLength(3);
    expect(result[0].metadata.steps).toEqual(original.slice(0, 2));
    expect(original[0].metadata.kind).toBe("tool");
  });
  it("keeps chat conversion as a new explicit planning request", () => {
    const text = agentPlanRequest("做纸雕", "侧光、低饱和");
    expect(text).toContain("待我检查"); expect(text).toContain("不执行生成");
    expect(text).toContain("做纸雕"); expect(text).toContain("侧光、低饱和");
  });
  it("parses professional text and incomplete code without executing HTML", () => {
    const blocks = agentMarkdown("## 构图\n\n**主体**\n\n- 侧光\n- 留白\n\n| 镜头 | 时间 |\n| --- | --- |\n| 近景 | 3秒 |\n\n> 注释\n\n```html\n<script>x()</script>");
    expect(blocks.map(b => b.kind)).toEqual(["heading", "paragraph", "list", "table", "quote", "code"]);
    expect(blocks.at(-1)).toMatchObject({ text: "<script>x()</script>" });
    expect(agentMarkdown("<img src=x onerror=alert(1)>")[0]).toMatchObject({ kind: "paragraph" });
  });
  it("refuses script and local resource links", () => {
    expect(safeAgentLink("javascript:alert(1)")).toBeUndefined();
    expect(safeAgentLink("file:///C:/private")).toBeUndefined();
    expect(safeAgentLink("https://example.com")).toBe("https://example.com/");
  });
  it("preserves fenced code indentation and literal markup through the active message parser", () => {
    expect(agentMarkdown("说明\n```html\r\n  <script>alert(1)</script>\r\n```\n完成")).toEqual([
      { kind: "paragraph", text: "说明" },
      { kind: "code", language: "html", text: "  <script>alert(1)</script>" },
      { kind: "paragraph", text: "完成" },
    ]);
    expect(agentMarkdown("```js\npartial")).toEqual([{ kind: "code", language: "js", text: "partial" }]);
    expect(agentMarkdown("```\na\n```\n```ts\nb\n```").filter(block => block.kind === "code")).toHaveLength(2);
  });
  it("reconciles only a durable final reply for the same request", () => {
    const session: AgentSession = { id:"s", canvasId:"c", title:"", plans:[], messages:[{ id:"m", role:"assistant", content:"partial", createdAt:"", metadata:{ requestId:"a", kind:"tool" } }] };
    expect(hasAgentTurnReply(session, "a")).toBe(false);
    session.messages[0].metadata.kind = "message";
    expect(hasAgentTurnReply(session, "a")).toBe(true);
    expect(hasAgentTurnReply(session, "another")).toBe(false);
  });
  it("uses saved timestamps and leaves unavailable dates blank", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(agentRelativeTime(undefined, now)).toBe("—");
    expect(agentRelativeTime("not a date", now)).toBe("—");
    expect(agentRelativeTime("2026-10-16T11:56:00Z", now)).toBe("4 分钟前");
    expect(agentRelativeTime("2026-10-14T12:00:00Z", now)).toBe("2 天前");
  });
  it("converts only the selected reply's own user references, never other history", () => {
    const make = (id: string, role: AgentMessage["role"], assets: unknown[]): AgentMessage => ({ id, role, content:id, createdAt:"", metadata:{ attachmentAssetIds:assets } });
    const messages = [make("old", "user", ["unrelated"]), make("old-reply", "assistant", []), make("current", "user", ["reference", "reference", 7]), make("reply", "assistant", ["injected"]), make("future", "user", ["future"])];
    expect(agentReplyContext(messages, "reply")).toEqual({ message:"current", attachmentAssetIds:["reference"] });
    expect(agentReplyContext(messages, "missing")).toEqual({ message:"", attachmentAssetIds:[] });
  });
});

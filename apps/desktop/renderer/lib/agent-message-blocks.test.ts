import { describe, expect, it } from "vitest";
import { agentMessageBlocks } from "./agent-message-blocks";

describe("agent message code presentation", () => {
  it("preserves prose and code indentation, including markup as literal text", () => {
    expect(agentMessageBlocks("说明\n```html\r\n  <script>alert(1)</script>\r\n```\n完成")).toEqual([
      { kind: "text", text: "说明\n" },
      { kind: "code", language: "html", text: "  <script>alert(1)</script>" },
      { kind: "text", text: "\n完成" },
    ]);
  });
  it("keeps incomplete streamed fences visible and supports multiple blocks", () => {
    expect(agentMessageBlocks("```js\npartial")).toEqual([{ kind: "text", text: "```js\npartial" }]);
    expect(agentMessageBlocks("```\na\n```\n```ts\nb\n```").filter(block => block.kind === "code")).toHaveLength(2);
  });
});

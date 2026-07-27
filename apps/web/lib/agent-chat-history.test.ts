import { describe, expect, it } from "vitest";
import {
  AGENT_HISTORY_MAX_CHARACTERS,
  agentApiHistory,
  agentHistoryStorageKey,
  legacyAgentHistoryStorageKey,
  successfulAgentHistory,
  type AgentHistoryMessage,
} from "./agent-chat-history";

function turn(
  id: string,
  userText = `user-${id}`,
  assistantText = `assistant-${id}`,
): AgentHistoryMessage[] {
  return [
    { id: `${id}-user`, role: "user", text: userText },
    { id: `${id}-assistant`, role: "assistant", text: assistantText },
  ];
}

describe("agent chat history", () => {
  it("sends a successful complete turn to the API", () => {
    expect(agentApiHistory(turn("one"))).toEqual([
      { role: "user", content: "user-one" },
      { role: "assistant", content: "assistant-one" },
    ]);
  });

  it("excludes the entire failed turn, including its user message", () => {
    const failed = turn("failed");
    failed[1] = { ...failed[1], error: true };
    expect(successfulAgentHistory([...turn("good"), ...failed])).toEqual(
      turn("good"),
    );
  });

  it("excludes orphaned, pending, and streaming turns", () => {
    expect(
      successfulAgentHistory([
        { id: "orphan-user", role: "user", text: "orphan" },
        { id: "pending-user", role: "user", text: "pending" },
        {
          id: "pending-assistant",
          role: "assistant",
          text: "pending",
          pending: true,
        },
        { id: "stream-user", role: "user", text: "stream" },
        {
          id: "stream-assistant",
          role: "assistant",
          text: "stream",
          streaming: true,
        },
      ]),
    ).toEqual([]);
  });

  it("keeps only the latest ten successful turns", () => {
    const messages = Array.from({ length: 12 }, (_, index) => turn(String(index))).flat();
    const result = successfulAgentHistory(messages);
    expect(result).toHaveLength(20);
    expect(result[0].id).toBe("2-user");
    expect(result.at(-1)?.id).toBe("11-assistant");
  });

  it("keeps a contiguous recent history within the character limit", () => {
    const halfLimit = Math.floor(AGENT_HISTORY_MAX_CHARACTERS / 2);
    const messages = [
      ...turn("old", "o".repeat(halfLimit), "a"),
      ...turn("new", "n".repeat(halfLimit), "b"),
    ];
    expect(successfulAgentHistory(messages).map((message) => message.id)).toEqual([
      "new-user",
      "new-assistant",
    ]);
  });

  it("uses a new storage namespace so legacy polluted history is not loaded", () => {
    expect(agentHistoryStorageKey("canvas-1")).toBe(
      "super-canvas:agent-history:v2:canvas-1",
    );
    expect(agentHistoryStorageKey("canvas-1")).not.toBe(
      legacyAgentHistoryStorageKey("canvas-1"),
    );
  });
});

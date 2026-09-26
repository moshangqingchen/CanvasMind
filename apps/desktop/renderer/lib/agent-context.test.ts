import { describe, expect, it } from "vitest";
import { AGENT_CONTEXT_CHARACTERS, boundedAgentContext, clipContextText, compactObservation, observationPage } from "./agent-context";

describe("agent context budgets", () => {
  it("bounds combined text while preserving the current request and latest observation", () => {
    const request = "用户最后确认的需求".repeat(3000);
    const messages = [
      ...Array.from({ length: 40 }, () => ({ role: "assistant" as const, content: "旧内容".repeat(8000) })),
      { role: "user" as const, content: request },
      { role: "assistant" as const, content: "最新工具结果：模型 ID image-2" },
    ];
    const bounded = boundedAgentContext("系统规则".repeat(6000), messages, request);
    expect(bounded.system.length + bounded.messages.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(AGENT_CONTEXT_CHARACTERS);
    expect(bounded.messages.some(m => m.content === request)).toBe(true);
    expect(bounded.messages.at(-1)?.content).toContain("image-2");
    expect(messages).toHaveLength(42);
  });
  it("marks omitted content and obeys even very small limits", () => {
    for (const limit of [1, 10, 100, 1000]) expect(clipContextText("x".repeat(2000), limit).length).toBeLessThanOrEqual(limit);
    expect(clipContextText("x".repeat(2000), 100)).toContain("省略");
  });
  it("returns parseable JSON and explicit truncation for oversized observations", () => {
    const value = compactObservation({ prompt: "长描述".repeat(30_000), id: "asset-1" }, 2000);
    const encoded = JSON.stringify(value);
    expect(encoded.length).toBeLessThanOrEqual(2000);
    expect(JSON.parse(encoded).truncated).toBe(true);
    expect(encoded).toContain("asset-1");
    const escaped = compactObservation(Array.from({ length: 300 }, () => ({ details: '"\\\n'.repeat(5000) })), 1000);
    expect(JSON.stringify(escaped).length).toBeLessThanOrEqual(1000);
  });
  it("supports complete pagination without duplicating or losing inventory IDs", () => {
    const items = Array.from({ length: 83 }, (_, i) => ({ id: `model-${i}`, prompt: "text".repeat(700) }));
    const seen: unknown[] = [];
    let offset: number | undefined = 0;
    while (offset !== undefined) {
      const page: ReturnType<typeof observationPage> = observationPage(items, { offset, limit: 30 });
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(16_000);
      seen.push(...page.items);
      offset = page.nextOffset;
    }
    expect(seen).toEqual(items);
  });
});

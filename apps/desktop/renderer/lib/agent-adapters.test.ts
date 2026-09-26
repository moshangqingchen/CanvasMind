import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectorProtocol } from "@super-canvas/director";
import { createDirectorAdapterRegistry } from "./director-adapters";
import { AGENT_OUTPUT_SCHEMA, AgentDecisionSchema } from "./agent-contracts";
afterEach(() => vi.unstubAllGlobals());
describe("portable agent decisions across channels", () => {
  it.each<DirectorProtocol>([
    "openai-chat-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generate-content",
    "xai-responses",
    "generic-openai-compatible",
  ])(
    "accepts an artifact through %s without narrowing it to a director reply",
    async (protocol) => {
      const artifact = {
        type: "artifact",
        message: "文字成果",
        artifact: { kind: "text", title: "广告文案", content: "风吹过海岸" },
      };
      const envelope = { decision: JSON.stringify(artifact) };
      const output = JSON.stringify(envelope);
      let body: Record<string, unknown> = {};
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          body = JSON.parse(init.body);
          const payload =
            protocol === "anthropic-messages"
              ? {
                  content: [
                    {
                      type: "tool_use",
                      name: "submit_director_decision",
                      input: envelope,
                    },
                  ],
                }
              : protocol === "google-generate-content"
                ? { candidates: [{ content: { parts: [{ text: output }] } }] }
                : protocol.includes("responses")
                  ? {
                      output: [
                        {
                          type: "message",
                          content: [{ type: "output_text", text: output }],
                        },
                      ],
                    }
                  : { choices: [{ message: { content: output } }] };
          return new Response(JSON.stringify(payload), {
            headers: { "content-type": "application/json" },
          });
        }),
      );
      const result = await createDirectorAdapterRegistry()
        .get(protocol)
        .complete(
          {
            id: "agent",
            name: "test",
            provider: "test",
            supplier: "test",
            baseUrl: "https://agent.example.test/v1",
            apiKey: "test-key",
            model: "explicit-model",
            enabled: true,
            protocol,
            capabilities: {
              text: true,
              imageInput: true,
              audioInput: false,
              videoInput: false,
              structuredOutput: true,
              toolCalling: true,
              reasoning: false,
              nativeWebSearch: false,
            },
          },
          {
            system: "返回创作成果",
            messages: [{ role: "user", content: "写一句文案" }],
            responseJsonSchema: AGENT_OUTPUT_SCHEMA,
          },
        );
      expect(AgentDecisionSchema.parse(result.output).type).toBe("artifact");
      expect(JSON.stringify(body)).toContain("decision");
      expect(JSON.stringify(body)).not.toContain("secret-director");
    },
  );
});

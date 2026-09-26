import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DirectorAdapterInput,
  DirectorProtocol,
  ResolvedDirectorConnection,
} from "@super-canvas/director";
import { createDirectorAdapterRegistry, adapterFinishReason } from "./index";

const protocols: DirectorProtocol[] = [
  "openai-chat-completions",
  "generic-openai-compatible",
  "openai-responses",
  "xai-responses",
  "anthropic-messages",
  "google-generate-content",
];
const structured = {
  type: "graphic-design-extraction",
  complete: true,
  images: [],
};
const input: DirectorAdapterInput = {
  system: "提取客户原文",
  messages: [{ role: "user", content: "不要删减" }],
  responseJsonSchema: { type: "object" },
  requireComplete: true,
  maxOutputTokens: 32768,
};
function connection(protocol: DirectorProtocol): ResolvedDirectorConnection {
  return {
    id: "extraction",
    name: "test",
    provider: "test",
    supplier: "test",
    baseUrl: "https://example.test/v1",
    apiKey: "test-key",
    model: "configured-model",
    protocol,
    enabled: true,
    capabilities: {
      text: true,
      imageInput: true,
      audioInput: false,
      videoInput: false,
      structuredOutput: true,
      toolCalling: false,
      nativeWebSearch: false,
      reasoning: false,
    },
  };
}
function payload(
  protocol: DirectorProtocol,
  complete: boolean,
  reasonPresent = true,
) {
  const text = JSON.stringify(structured);
  if (protocol === "anthropic-messages")
    return {
      content: [{ type: "text", text }],
      ...(reasonPresent
        ? { stop_reason: complete ? "end_turn" : "max_tokens" }
        : {}),
    };
  if (protocol === "google-generate-content")
    return {
      candidates: [
        {
          content: { parts: [{ text }] },
          ...(reasonPresent
            ? { finishReason: complete ? "STOP" : "MAX_TOKENS" }
            : {}),
        },
      ],
    };
  if (protocol.includes("responses"))
    return {
      output: [{ type: "message", content: [{ type: "output_text", text }] }],
      ...(reasonPresent
        ? {
            status: complete ? "completed" : "incomplete",
            ...(!complete
              ? { incomplete_details: { reason: "max_output_tokens" } }
              : {}),
          }
        : {}),
    };
  return {
    choices: [
      {
        message: { content: text },
        ...(reasonPresent
          ? { finish_reason: complete ? "stop" : "length" }
          : {}),
      },
    ],
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("strict complete extraction through model adapters", () => {
  it.each(protocols)(
    "accepts completed %s output and forwards the explicit output budget",
    async (protocol) => {
      let body: Record<string, unknown> = {};
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init: RequestInit) => {
          body = JSON.parse(String(init.body));
          return Response.json(payload(protocol, true));
        }),
      );
      const result = await createDirectorAdapterRegistry()
        .get(protocol)
        .complete(connection(protocol), input);
      expect(result.output).toEqual(structured);
      expect(result.finishReason).toBe("complete");
      if (protocol.includes("responses"))
        expect(body.max_output_tokens).toBe(32768);
      else if (protocol === "google-generate-content")
        expect(body.generationConfig).toMatchObject({ maxOutputTokens: 32768 });
      else if (protocol === "openai-chat-completions")
        expect(body.max_completion_tokens).toBe(32768);
      else expect(body.max_tokens).toBe(32768);
      expect(body.tools).toBeUndefined();
    },
  );

  it.each(protocols)(
    "rejects length-limited %s output even if it is valid complete-looking JSON",
    async (protocol) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(payload(protocol, false))),
      );
      await expect(
        createDirectorAdapterRegistry()
          .get(protocol)
          .complete(connection(protocol), input),
      ).rejects.toMatchObject({
        code: "invalid_response",
        message: expect.stringContaining("长度上限"),
      });
    },
  );

  it.each(protocols)(
    "rejects unknown %s termination only for strict callers",
    async (protocol) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(payload(protocol, true, false))),
      );
      const adapter = createDirectorAdapterRegistry().get(protocol);
      await expect(
        adapter.complete(connection(protocol), input),
      ).rejects.toMatchObject({ code: "invalid_response" });
      const normal = await adapter.complete(connection(protocol), {
        ...input,
        requireComplete: false,
      });
      expect(normal.output).toEqual(structured);
      expect(normal.finishReason).toBe("unknown");
    },
  );

  it("keeps protocol-specific refusal and tool termination out of strict extraction", () => {
    for (const [protocol, value] of [
      [
        "openai-chat-completions",
        { choices: [{ finish_reason: "content_filter" }] },
      ],
      ["anthropic-messages", { stop_reason: "tool_use" }],
      ["google-generate-content", { candidates: [{ finishReason: "SAFETY" }] }],
      [
        "openai-responses",
        { status: "completed", output: [{ content: [{ type: "refusal" }] }] },
      ],
      [
        "xai-responses",
        { status: "completed", output: [{ status: "incomplete" }] },
      ],
      [
        "openai-responses",
        {
          status: "completed",
          incomplete_details: { reason: "max_output_tokens" },
        },
      ],
    ] as const) {
      expect(() => adapterFinishReason(value, protocol, input)).toThrow();
    }
  });

  it("supports Responses gateways that expose a Chat Completions finish reason", () => {
    expect(
      adapterFinishReason(
        { choices: [{ finish_reason: "stop" }] },
        "openai-responses",
        input,
      ),
    ).toBe("complete");
    expect(() =>
      adapterFinishReason(
        { choices: [{ finish_reason: "length" }] },
        "xai-responses",
        input,
      ),
    ).toThrow();
  });

  it("uses max_completion_tokens for explicitly enabled reasoning chat models", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return Response.json(payload("openai-chat-completions", true));
      }),
    );
    await createDirectorAdapterRegistry()
      .get("openai-chat-completions")
      .complete(
        { ...connection("openai-chat-completions"), reasoningEffort: "low" },
        input,
      );
    expect(body.max_completion_tokens).toBe(32768);
    expect(body.max_tokens).toBeUndefined();
  });

  it("uses the standard completion budget for reasoning models without an explicit effort setting", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return Response.json(payload("openai-chat-completions", true));
      }),
    );
    const configured = connection("openai-chat-completions");
    await createDirectorAdapterRegistry()
      .get(configured.protocol)
      .complete(
        {
          ...configured,
          capabilities: { ...configured.capabilities, reasoning: true },
        },
        input,
      );
    expect(body.max_completion_tokens).toBe(32768);
    expect(body.max_tokens).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
  });

  it.each([undefined, "low"])(
    "keeps the generic gateway token field with reasoning effort %s",
    async (reasoningEffort) => {
      let body: Record<string, unknown> = {};
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init: RequestInit) => {
          body = JSON.parse(String(init.body));
          return Response.json(payload("generic-openai-compatible", true));
        }),
      );
      const configured = connection("generic-openai-compatible");
      await createDirectorAdapterRegistry()
        .get(configured.protocol)
        .complete(
          {
            ...configured,
            reasoningEffort,
            capabilities: { ...configured.capabilities, reasoning: true },
          },
          input,
        );
      expect(body.max_tokens).toBe(32768);
      expect(body.max_completion_tokens).toBeUndefined();
    },
  );

  it("cancels an oversized streaming provider response without buffering the full body", async () => {
    let cancelled = false;
    let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream)),
    );
    await expect(
      createDirectorAdapterRegistry()
        .get("openai-chat-completions")
        .complete(connection("openai-chat-completions"), input),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(cancelled).toBe(true);
    expect(chunks).toBeLessThanOrEqual(4);
  });
});

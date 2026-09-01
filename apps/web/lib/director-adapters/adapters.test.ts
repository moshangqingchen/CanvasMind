import type {
  DirectorAdapterInput,
  DirectorConnection,
  DirectorProtocol,
} from "@super-canvas/director";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  capabilitiesFromVerifiedModel,
  createDirectorAdapterRegistry,
  DIRECTOR_ADAPTER_TIMEOUT_MS,
  DirectorAdapterError,
} from "./index";

const fetchMock = vi.fn();

const capabilities = {
  text: true,
  imageInput: true,
  audioInput: false,
  videoInput: false,
  structuredOutput: true,
  toolCalling: true,
  nativeWebSearch: true,
  reasoning: true,
};

function connection(
  protocol: DirectorProtocol,
  overrides: Partial<DirectorConnection> = {},
): DirectorConnection {
  return {
    id: `connection-${protocol}`,
    name: protocol,
    provider: protocol,
    supplier: "测试供应商",
    baseUrl: "https://director.example.test/v1",
    apiKey: "secret-director-api-key",
    protocol,
    model: "director-model",
    enabled: true,
    capabilities,
    ...overrides,
  };
}

const input: DirectorAdapterInput = {
  system: "你是超级导演。",
  messages: [{ role: "user", content: "规划一张产品主视觉" }],
};

const reply = JSON.stringify({ type: "reply", message: "方案已整理。" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("director adapter registry", () => {
  it("registers every supported protocol", () => {
    const registry = createDirectorAdapterRegistry();
    for (const protocol of [
      "openai-responses",
      "openai-chat-completions",
      "anthropic-messages",
      "google-generate-content",
      "xai-responses",
      "generic-openai-compatible",
    ] as const) {
      expect(registry.get(protocol).protocol).toBe(protocol);
    }
  });
});

describe("capability probes", () => {
  it("verifies every OpenAI-compatible protocol against the live model endpoint", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: "director-model",
            input_modalities: ["text", "image"],
            context_window: 128_000,
            capabilities: { native_web_search: false },
          }),
          { status: 200 },
        ),
      ),
    );
    const registry = createDirectorAdapterRegistry();
    for (const protocol of [
      "openai-responses",
      "openai-chat-completions",
      "xai-responses",
      "generic-openai-compatible",
    ] as const) {
      const adapter = registry.get(protocol);
      expect(adapter.probeCapabilities).toBeTypeOf("function");
      const result = await adapter.probeCapabilities!(connection(protocol));
      expect(result).toMatchObject({
        text: true,
        imageInput: true,
        nativeWebSearch: false,
        contextWindow: 128_000,
        probeSource: "live",
      });
      expect(Date.parse(result.probedAt ?? "")).not.toBeNaN();
    }
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://director.example.test/v1/models/director-model",
      "https://director.example.test/v1/models/director-model",
      "https://director.example.test/v1/models/director-model",
      "https://director.example.test/v1/models/director-model",
    ]);
  });

  it("enables only capabilities explicitly reported by live model metadata", () => {
    const baseline = connection("generic-openai-compatible", {
      capabilities: {
        text: true,
        imageInput: false,
        audioInput: false,
        videoInput: false,
        structuredOutput: false,
        toolCalling: false,
        nativeWebSearch: false,
        reasoning: false,
      },
    });
    const result = capabilitiesFromVerifiedModel(baseline, {
      id: "director-model",
      input_modalities: ["text", "image"],
      capabilities: {
        structured_outputs: true,
        tool_calling: true,
        native_web_search: false,
      },
    });

    expect(result).toMatchObject({
      text: true,
      imageInput: true,
      audioInput: false,
      structuredOutput: true,
      toolCalling: true,
      nativeWebSearch: false,
      probeSource: "live",
    });
  });

  it("uses Anthropic's authenticated model lookup", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "director-model" }), { status: 200 }),
    );
    const adapter = createDirectorAdapterRegistry().get("anthropic-messages");
    const result = await adapter.probeCapabilities!(
      connection("anthropic-messages"),
    );
    expect(result.probeSource).toBe("live");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://director.example.test/v1/models/director-model");
    expect(init.headers).toMatchObject({
      "x-api-key": "secret-director-api-key",
      "anthropic-version": "2023-06-01",
    });
  });

  it("requires Gemini's live descriptor to support generateContent", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: "models/gemini-pro",
            supportedGenerationMethods: ["embedContent"],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: "models/gemini-pro",
            supportedGenerationMethods: ["generateContent"],
            inputTokenLimit: 1_000_000,
          }),
          { status: 200 },
        ),
      );
    const adapter = createDirectorAdapterRegistry().get(
      "google-generate-content",
    );
    await expect(
      adapter.probeCapabilities!(
        connection("google-generate-content", { model: "gemini-pro" }),
      ),
    ).rejects.toMatchObject({
      code: "configuration",
      message: "所选 Gemini 模型不支持 generateContent",
    });
    await expect(
      adapter.probeCapabilities!(
        connection("google-generate-content", { model: "gemini-pro" }),
      ),
    ).resolves.toMatchObject({
      contextWindow: 1_000_000,
      probeSource: "live",
    });
  });

  it("falls back to a live model list only for unsupported retrieve endpoints", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "not found" } }), {
          status: 404,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "director-model", modalities: ["text"] }],
          }),
          { status: 200 },
        ),
      );
    const adapter = createDirectorAdapterRegistry().get(
      "generic-openai-compatible",
    );
    const result = await adapter.probeCapabilities!(
      connection("generic-openai-compatible"),
    );
    expect(result).toMatchObject({
      text: true,
      imageInput: false,
      probeSource: "live",
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://director.example.test/v1/models/director-model",
      "https://director.example.test/v1/models",
    ]);
  });

  it("falls back when a gateway returns an error envelope for model lookup", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "model lookup unsupported" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [{ id: "director-model", modalities: ["text"] }],
          }),
          { status: 200 },
        ),
      );
    const adapter = createDirectorAdapterRegistry().get(
      "generic-openai-compatible",
    );
    await expect(
      adapter.probeCapabilities!(connection("generic-openai-compatible")),
    ).resolves.toMatchObject({
      text: true,
      imageInput: false,
      probeSource: "live",
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://director.example.test/v1/models/director-model",
      "https://director.example.test/v1/models",
    ]);
  });
});

describe("Responses adapters", () => {
  it("bounds native search, enforces JSON schema, and extracts sources", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: "web_search_call",
              action: {
                sources: [
                  {
                    title: "官方资料",
                    url: "https://source.example.test/reference",
                  },
                ],
              },
            },
            {
              type: "message",
              content: [{ type: "output_text", text: reply }],
            },
          ],
          usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const adapter = createDirectorAdapterRegistry().get("openai-responses");
    const result = await adapter.complete(connection("openai-responses"), {
      ...input,
      useNativeSearch: true,
      maxSearchCalls: 99,
    });

    expect(result.output).toEqual({ type: "reply", message: "方案已整理。" });
    expect(result.sources).toMatchObject([
      {
        title: "官方资料",
        url: "https://source.example.test/reference",
        evidence: "C",
      },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://director.example.test/v1/responses");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.max_tool_calls).toBe(3);
    expect(body.include).toEqual(["web_search_call.action.sources"]);
    expect(body.text).toMatchObject({
      format: { type: "json_schema", strict: true },
    });
  });

  it("uses the same safe Responses contract for xAI", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ output_text: reply }), { status: 200 }),
    );
    const adapter = createDirectorAdapterRegistry().get("xai-responses");
    await expect(
      adapter.complete(connection("xai-responses"), input),
    ).resolves.toMatchObject({ output: { type: "reply" } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://director.example.test/v1/responses",
    );
  });

  it("accepts parsed JSON fields returned by Responses-compatible gateways", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_json",
                  parsed: { type: "reply", message: "网关解析结果" },
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(
      createDirectorAdapterRegistry()
        .get("openai-responses")
        .complete(connection("openai-responses"), input),
    ).resolves.toMatchObject({
      output: { type: "reply", message: "网关解析结果" },
    });
  });

  it("accepts chat-style choices returned by a Responses-compatible gateway", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ type: "reply", message: "兼容外壳" }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(
      createDirectorAdapterRegistry()
        .get("openai-responses")
        .complete(connection("openai-responses"), input),
    ).resolves.toMatchObject({ output: { message: "兼容外壳" } });
  });

  it("falls back to JSON instructions when Responses structured output is unavailable", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ output_text: reply }), { status: 200 }),
    );
    await createDirectorAdapterRegistry()
      .get("openai-responses")
      .complete(
        connection("openai-responses", {
          capabilities: { ...capabilities, structuredOutput: false },
        }),
        input,
      );
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(body).not.toHaveProperty("text");
  });
});

describe("Chat Completions adapters", () => {
  it("supports strict OpenAI and generic-compatible chat payloads", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: `\`\`\`json\n${reply}\n\`\`\`` } }],
            usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
          }),
          { status: 200 },
        ),
      ),
    );
    const registry = createDirectorAdapterRegistry();
    for (const protocol of [
      "openai-chat-completions",
      "generic-openai-compatible",
    ] as const) {
      const result = await registry
        .get(protocol)
        .complete(connection(protocol), input);
      expect(result.output).toEqual({ type: "reply", message: "方案已整理。" });
    }
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true },
    });
  });

  it("accepts parsed and tool-call decision fields from compatible gateways", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  parsed: { type: "reply", message: "parsed 结果" },
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      function: {
                        arguments: JSON.stringify({
                          type: "reply",
                          message: "tool 结果",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    const adapter = createDirectorAdapterRegistry().get(
      "generic-openai-compatible",
    );
    await expect(
      adapter.complete(connection("generic-openai-compatible"), input),
    ).resolves.toMatchObject({ output: { message: "parsed 结果" } });
    await expect(
      adapter.complete(connection("generic-openai-compatible"), input),
    ).resolves.toMatchObject({ output: { message: "tool 结果" } });
  });

  it("downgrades plain text from non-structured gateways to a safe reply", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: "当前网关暂不支持严格 JSON，我先给你文字建议。" } },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(
      createDirectorAdapterRegistry()
        .get("generic-openai-compatible")
        .complete(
          connection("generic-openai-compatible", {
            capabilities: { ...capabilities, structuredOutput: false },
          }),
          input,
        ),
    ).resolves.toMatchObject({
      output: {
        type: "reply",
        message: "当前网关暂不支持严格 JSON，我先给你文字建议。",
      },
    });
  });

  it("supports legacy completion-style text envelopes", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { text: JSON.stringify({ type: "reply", message: "旧式返回" }) },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(
      createDirectorAdapterRegistry()
        .get("generic-openai-compatible")
        .complete(connection("generic-openai-compatible"), input),
    ).resolves.toMatchObject({ output: { message: "旧式返回" } });
  });
});

describe("native provider adapters", () => {
  it("forces an Anthropic tool result and parses its input", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: "submit_director_decision",
              input: { type: "reply", message: "Claude 方案" },
            },
          ],
          usage: { input_tokens: 5, output_tokens: 4 },
        }),
        { status: 200 },
      ),
    );
    const result = await createDirectorAdapterRegistry()
      .get("anthropic-messages")
      .complete(connection("anthropic-messages"), input);
    expect(result.output).toEqual({ type: "reply", message: "Claude 方案" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://director.example.test/v1/messages");
    expect(init.headers).toMatchObject({
      "x-api-key": "secret-director-api-key",
      "anthropic-version": "2023-06-01",
    });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.tool_choice).toMatchObject({
      type: "tool",
      name: "submit_director_decision",
    });
  });

  it("lets Claude search at most three times before submitting a decision", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            {
              type: "web_search_tool_result",
              content: [
                {
                  type: "web_search_result",
                  title: "Claude 搜索资料",
                  url: "https://claude-source.example.test/page",
                },
              ],
            },
            {
              type: "tool_use",
              name: "submit_director_decision",
              input: { type: "reply", message: "Claude 搜索方案" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await createDirectorAdapterRegistry()
      .get("anthropic-messages")
      .complete(connection("anthropic-messages"), {
        ...input,
        useNativeSearch: true,
        maxSearchCalls: 99,
      });
    expect(result.sources[0]).toMatchObject({
      title: "Claude 搜索资料",
      url: "https://claude-source.example.test/page",
    });
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as { tools: Array<Record<string, unknown>>; tool_choice: unknown };
    expect(body.tools[0]).toMatchObject({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 3,
    });
    expect(body.tool_choice).toMatchObject({ type: "auto" });
  });

  it("accepts Claude JSON text when custom tool use is unavailable", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: "text", text: reply }] }),
        { status: 200 },
      ),
    );
    await expect(
      createDirectorAdapterRegistry()
        .get("anthropic-messages")
        .complete(
          connection("anthropic-messages", {
            capabilities: { ...capabilities, toolCalling: false },
          }),
          input,
        ),
    ).resolves.toMatchObject({ output: { type: "reply" } });
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("uses Gemini JSON schema and extracts grounding sources", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: reply }] },
              groundingMetadata: {
                groundingChunks: [
                  {
                    web: {
                      uri: "https://gemini-source.example.test/page",
                      title: "Gemini 资料",
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 6,
            candidatesTokenCount: 2,
            totalTokenCount: 8,
          },
        }),
        { status: 200 },
      ),
    );
    const result = await createDirectorAdapterRegistry()
      .get("google-generate-content")
      .complete(
        connection("google-generate-content", { model: "gemini-pro" }),
        { ...input, useNativeSearch: true },
      );
    expect(result.sources[0]).toMatchObject({
      title: "Gemini 资料",
      url: "https://gemini-source.example.test/page",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://director.example.test/v1/models/gemini-pro:generateContent",
    );
    expect(init.headers).toMatchObject({
      "x-goog-api-key": "secret-director-api-key",
    });
    const body = JSON.parse(String(init.body)) as {
      generationConfig: Record<string, unknown>;
      tools: Array<Record<string, unknown>>;
    };
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: { type: "object" },
    });
    expect(body.tools).toEqual([{ googleSearch: {} }]);
  });

  it("lets Gemini fall back to JSON instructions without schema support", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: reply }] } }],
        }),
        { status: 200 },
      ),
    );
    await createDirectorAdapterRegistry()
      .get("google-generate-content")
      .complete(
        connection("google-generate-content", {
          model: "gemini-pro",
          capabilities: { ...capabilities, structuredOutput: false },
        }),
        input,
      );
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(body).not.toHaveProperty("generationConfig");
  });
});

describe("adapter safety", () => {
  it("rejects a structurally invalid decision", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: {
                  type: "reply",
                  message: "内容",
                  unexpected: true,
                },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(
      createDirectorAdapterRegistry()
        .get("openai-chat-completions")
        .complete(connection("openai-chat-completions"), input),
    ).rejects.toMatchObject({
      code: "invalid_response",
      message: "导演模型未按约定返回有效的结构化决策",
    });
  });

  it("redacts secrets and base64 content from upstream errors", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message:
              "bad key secret-director-api-key data:image/png;base64,aGVsbG8=",
          },
        }),
        { status: 400 },
      ),
    );
    let caught: unknown;
    try {
      await createDirectorAdapterRegistry()
        .get("openai-responses")
        .complete(connection("openai-responses"), input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DirectorAdapterError);
    expect((caught as Error).message).not.toContain("secret-director-api-key");
    expect((caught as Error).message).not.toContain("aGVsbG8=");
  });

  it("rejects private endpoints unless explicitly allowed", async () => {
    await expect(
      createDirectorAdapterRegistry()
        .get("openai-responses")
        .complete(
          connection("openai-responses", {
            baseUrl: "http://127.0.0.1:9000/v1",
          }),
          input,
        ),
    ).rejects.toMatchObject({ code: "configuration" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts a stalled upstream request at the bounded timeout", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            (init.signal as AbortSignal).addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          }),
      );
      const pending = createDirectorAdapterRegistry()
        .get("openai-responses")
        .complete(connection("openai-responses"), input);
      const assertion = expect(pending).rejects.toMatchObject({
        code: "timeout",
        message: "导演模型请求超时",
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(DIRECTOR_ADAPTER_TIMEOUT_MS);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

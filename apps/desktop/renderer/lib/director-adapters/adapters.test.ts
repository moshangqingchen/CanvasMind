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

describe("supplier site roots and API paths", () => {
  it.each([
    ["openai-chat-completions", "chat/completions"],
    ["generic-openai-compatible", "chat/completions"],
    ["openai-responses", "responses"],
    ["xai-responses", "responses"],
  ] as const)("routes %s from a supplier site root to its versioned API", async (protocol, endpoint) => {
    fetchMock.mockImplementation(async (url: string) => url === `https://director.example.test/v1/${endpoint}`
      ? new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }))
      : new Response("<!doctype html><html><body>Supplier homepage</body></html>", { headers: { "content-type": "text/html" } }));
    const result = await createDirectorAdapterRegistry().get(protocol)
      .complete(connection(protocol, { baseUrl: "https://director.example.test" }), input);
    expect(result.output).toEqual({ type: "reply", message: "方案已整理。" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://director.example.test/v1/${endpoint}`);
  });

  it.each(["/v1", "/v1/", "/gateway/openai/v1", "/custom-prefix"])("preserves the explicitly configured API prefix %s", async prefix => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: reply } }] })));
    await createDirectorAdapterRegistry().get("openai-chat-completions")
      .complete(connection("openai-chat-completions", { baseUrl: `https://director.example.test${prefix}` }), input);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://director.example.test${prefix.replace(/\/$/u, "")}/chat/completions`);
  });

  it.each([
    ["anthropic-messages", "/v1/messages", { content: [{ type: "text", text: reply }] }],
    ["google-generate-content", "/v1beta/models/director-model:generateContent", { candidates: [{ content: { parts: [{ text: reply }] } }] }],
  ] as const)("uses the native API version for a %s site root", async (protocol, path, payload) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(payload)));
    const result = await createDirectorAdapterRegistry().get(protocol)
      .complete(connection(protocol, { baseUrl: "https://director.example.test" }), input);
    expect(result.output).toEqual({ type: "reply", message: "方案已整理。" });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://director.example.test${path}`);
  });
});

describe("multimodal attachment transport", () => {
  it("sends a normal MP3 upload with the API's mp3 format", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: reply } }] })));
    await createDirectorAdapterRegistry().get("openai-chat-completions").complete(connection("openai-chat-completions", {
      capabilities: { ...capabilities, audioInput: true },
    }), { ...input, attachments: [{ kind: "audio", mimeType: "audio/mpeg", url: "data:audio/mpeg;base64,AQID" }] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages.at(-1).content).toContainEqual({ type: "input_audio", input_audio: { format: "mp3", data: "AQID" } });
  });
  it("sends image, video and audio bytes to declared Gemini inputs", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] } }] })));
    await createDirectorAdapterRegistry().get("google-generate-content").complete(connection("google-generate-content", {
      capabilities: { ...capabilities, audioInput: true, videoInput: true },
    }), { ...input, attachments: [
      { kind: "image", url: "data:image/png;base64,AQID" },
      { kind: "video", url: "data:video/mp4;base64,AQID" },
      { kind: "audio", url: "data:audio/mpeg;base64,AQID" },
    ] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.contents.at(-1).parts.slice(1)).toEqual(["image/png", "video/mp4", "audio/mpeg"].map(mimeType => ({ inlineData: { mimeType, data: "AQID" } })));
  });
});

describe("gateway SSE compatibility", () => {
  const sse = (events: unknown[], end = true) => new Response(
    events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join("") + (end ? "data: [DONE]\r\n\r\n" : ""),
    { headers: { "content-type": "text/event-stream" } },
  );
  it.each([
    "openai-chat-completions", "generic-openai-compatible", "openai-responses", "xai-responses",
  ] as const)("uses streaming on the first request to a stream-only %s endpoint", async protocol => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.stream !== true) return Response.json({ error: { message: 'streaming is required: this endpoint only accepts "stream": true' } }, { status: 400 });
      if (!protocol.includes("responses")) expect(body.stream_options).toEqual({ include_usage: true });
      return protocol.includes("responses")
        ? sse([
            { type: "response.output_text.delta", delta: reply },
            { type: "response.completed", response: { status: "completed" } },
          ], false)
        : sse([{ choices: [{ index: 0, delta: { content: reply }, finish_reason: "stop" }] }]);
    });
    const result = await createDirectorAdapterRegistry().get(protocol).complete(connection(protocol), { ...input, requireComplete: true });
    expect(result.output).toEqual({ type: "reply", message: "方案已整理。" });
    expect(result.finishReason).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("aggregates chat deltas and preserves usage", async () => {
    fetchMock.mockResolvedValue(sse([
      { choices: [{ index: 0, delta: { content: '{"type":"reply",' } }] },
      { choices: [{ index: 0, delta: { content: '"message":"正常返回"}' }, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } },
    ]));
    const result = await createDirectorAdapterRegistry().get("openai-chat-completions").complete(connection("openai-chat-completions"), input);
    expect(result.output).toEqual({ type: "reply", message: "正常返回" });
    expect(result.usage?.totalTokens).toBe(11);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("aggregates Responses deltas and completion metadata", async () => {
    fetchMock.mockResolvedValue(sse([
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: '{"type":"reply","message":' },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: '"正常返回"}' },
      { type: "response.completed", response: { status: "completed", usage: { input_tokens: 5, output_tokens: 6, total_tokens: 11 } } },
    ], false));
    const result = await createDirectorAdapterRegistry().get("openai-responses").complete(connection("openai-responses"), input);
    expect(result.output).toEqual({ type: "reply", message: "正常返回" });
    expect(result.finishReason).toBe("complete");
    expect(result.usage?.totalTokens).toBe(11);
  });
  it.each([
    ["openai-chat-completions", [{ choices: [], usage: { completion_tokens: 0 } }]],
    ["openai-chat-completions", [{ choices: [{ delta: { content: "" }, finish_reason: "stop" }] }]],
    ["openai-responses", [{ type: "response.completed", response: { status: "completed", output: [] } }]],
  ] as const)("rejects empty %s results without inventing a reply", async (protocol, events) => {
    fetchMock.mockResolvedValue(sse([...events]));
    await expect(createDirectorAdapterRegistry().get(protocol).complete(connection(protocol), { ...input, responseJsonSchema: { type: "object" } })).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects an interrupted stream even when partial content forms valid JSON", async () => {
    fetchMock.mockResolvedValue(sse([{ choices: [{ delta: { content: reply } }] }], false));
    await expect(createDirectorAdapterRegistry().get("openai-chat-completions").complete(connection("openai-chat-completions"), input)).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("redacts upstream stream failures", async () => {
    fetchMock.mockResolvedValue(sse([{ type: "response.failed", response: { error: { message: "bad secret-director-api-key" } } }]));
    await expect(createDirectorAdapterRegistry().get("openai-responses").complete(connection("openai-responses"), input)).rejects.toThrow("bad ***");
  });
  it("preserves an SSE error event without a redundant JSON type field", async () => {
    fetchMock.mockResolvedValue(new Response('event: error\ndata: {"message":"capacity exhausted secret-director-api-key"}\n\n', {
      headers: { "content-type": "text/event-stream" },
    }));
    await expect(createDirectorAdapterRegistry().get("openai-responses").complete(connection("openai-responses"), input)).rejects.toThrow("capacity exhausted ***");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("decodes fragmented UTF-8 frames and retains chat citations", async () => {
    const bytes = new TextEncoder().encode([
      { choices: [{ index: 0, delta: { content: reply, annotations: [{ url_citation: { url: "https://example.com/source", title: "来源" } }] }, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } },
    ].map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n");
    let offset = 0;
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) { controller.close(); return; }
        controller.enqueue(bytes.slice(offset, offset + 7));
        offset += 7;
      },
    }), { headers: { "content-type": "text/event-stream" } }));
    const result = await createDirectorAdapterRegistry().get("openai-chat-completions").complete(connection("openai-chat-completions"), input);
    expect(result.output).toEqual({ type: "reply", message: "方案已整理。" });
    expect(result.usage?.totalTokens).toBe(7);
    expect(result.sources).toContainEqual(expect.objectContaining({ url: "https://example.com/source", title: "来源" }));
  });
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
  it.each(["text/html; charset=utf-8", "text/plain"])("identifies a successful HTTP response containing a webpage (%s)", async contentType => {
    fetchMock.mockResolvedValue(new Response("<!doctype html><html>secret-director-api-key</html>", { headers: { "content-type": contentType } }));
    await expect(createDirectorAdapterRegistry().get("openai-chat-completions")
      .complete(connection("openai-chat-completions"), input)).rejects.toMatchObject({
      code: "invalid_response", message: "供应商返回了网页内容，请核对供应商文档中的 API 地址和接口路径",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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

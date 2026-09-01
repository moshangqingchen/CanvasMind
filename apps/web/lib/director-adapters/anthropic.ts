import {
  DIRECTOR_DECISION_JSON_SCHEMA,
  type DirectorAdapterInput,
  type DirectorAdapterResult,
  type DirectorConnection,
  type DirectorModelAdapter,
} from "@super-canvas/director";
import {
  adapterEndpoint,
  adapterHeaders,
  assertAttachmentCapabilities,
  boundedSearchCalls,
  dataUri,
  DirectorAdapterError,
  isRecord,
  lastUserMessageIndex,
  normalizeSources,
  requestJson,
  strictDecisionFromCandidates,
  structuredSystemPrompt,
  usageFrom,
  type SourceCandidate,
} from "./shared";
import { probeAnthropicCapabilities } from "./probe";

function anthropicMessages(input: DirectorAdapterInput) {
  const messages: Array<Record<string, unknown>> = input.messages.map(
    (message) => ({
      role: message.role,
      content: message.content,
    }),
  );
  if (!input.attachments?.length) return messages;
  if (input.attachments.some((attachment) => attachment.kind !== "image")) {
    throw new DirectorAdapterError(
      "unsupported_input",
      "Claude Messages 导演协议当前只接受图片附件",
    );
  }
  const lastUser = lastUserMessageIndex(messages);
  const previous = lastUser >= 0 ? messages[lastUser] : undefined;
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text:
        previous && typeof previous.content === "string"
          ? previous.content
          : "请分析附件并完成导演任务。",
    },
  ];
  for (const attachment of input.attachments) {
    const inline = dataUri(attachment.url);
    content.push({
      type: "image",
      source: inline
        ? { type: "base64", media_type: inline.mimeType, data: inline.data }
        : { type: "url", url: attachment.url },
    });
  }
  if (lastUser >= 0) messages[lastUser] = { role: "user", content };
  else messages.push({ role: "user", content });
  return messages;
}

function anthropicResult(payload: unknown): {
  decision: unknown;
  text?: string;
  sources: SourceCandidate[];
} {
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    return { decision: null, sources: [] };
  }
  let decision: unknown = null;
  const text: string[] = [];
  const sources: SourceCandidate[] = [];
  for (const block of payload.content) {
    if (!isRecord(block)) continue;
    if (
      block.type === "tool_use" &&
      block.name === "submit_director_decision"
    ) {
      decision = block.input;
    }
    if (block.type === "text" && typeof block.text === "string") {
      text.push(block.text);
      if (Array.isArray(block.citations)) {
        for (const citation of block.citations) {
          if (isRecord(citation)) sources.push(citation);
        }
      }
    }
    if (
      block.type === "web_search_tool_result" &&
      Array.isArray(block.content)
    ) {
      for (const result of block.content) {
        if (isRecord(result)) sources.push(result);
      }
    }
  }
  const joined = text.join("\n").trim();
  return {
    decision: decision ?? (joined || null),
    ...(joined ? { text: joined } : {}),
    sources,
  };
}

export class AnthropicMessagesAdapter implements DirectorModelAdapter {
  readonly protocol = "anthropic-messages" as const;
  probeCapabilities = probeAnthropicCapabilities;

  async complete(
    connection: DirectorConnection,
    input: DirectorAdapterInput,
  ): Promise<DirectorAdapterResult> {
    assertAttachmentCapabilities(connection, input);
    const nativeSearch =
      Boolean(input.useNativeSearch) && connection.capabilities.nativeWebSearch;
    const decisionTool = connection.capabilities.toolCalling
      ? {
          name: "submit_director_decision",
          description: "Submit the final validated director decision.",
          input_schema: DIRECTOR_DECISION_JSON_SCHEMA,
          strict: true,
        }
      : null;
    const tools = [
      ...(nativeSearch
        ? [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: boundedSearchCalls(input),
            },
          ]
        : []),
      ...(decisionTool ? [decisionTool] : []),
    ];
    const payload = await requestJson(
      connection,
      adapterEndpoint(connection, "/messages"),
      {
        method: "POST",
        headers: adapterHeaders(connection, {
          "x-api-key": connection.apiKey,
          "anthropic-version": "2023-06-01",
        }),
        body: JSON.stringify({
          model: connection.model,
          system: structuredSystemPrompt(input.system),
          messages: anthropicMessages(input),
          max_tokens: 8_192,
          ...(tools.length ? { tools } : {}),
          ...(decisionTool
            ? {
                tool_choice: nativeSearch
                  ? { type: "auto", disable_parallel_tool_use: true }
                  : {
                      type: "tool",
                      name: "submit_director_decision",
                      disable_parallel_tool_use: true,
                    },
              }
            : {}),
        }),
      },
      input.signal,
    );
    const result = anthropicResult(payload);
    if (result.decision === null) {
      throw new DirectorAdapterError(
        "invalid_response",
        "Claude 没有提交结构化导演决策",
      );
    }
    const usage =
      isRecord(payload) && isRecord(payload.usage)
        ? usageFrom(payload.usage, {
            input: "input_tokens",
            output: "output_tokens",
            total: "total_tokens",
          })
        : undefined;
    return {
      output: strictDecisionFromCandidates(
        [result.decision],
      ),
      ...(result.text ? { text: result.text } : {}),
      sources: normalizeSources(result.sources),
      ...(usage ? { usage } : {}),
    };
  }
}

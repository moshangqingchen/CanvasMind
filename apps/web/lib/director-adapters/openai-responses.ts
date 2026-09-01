import {
  DIRECTOR_DECISION_JSON_SCHEMA,
  type DirectorAdapterInput,
  type DirectorAdapterResult,
  type DirectorConnection,
  type DirectorModelAdapter,
  type DirectorProtocol,
} from "@super-canvas/director";
import {
  adapterEndpoint,
  adapterHeaders,
  assertAttachmentCapabilities,
  boundedSearchCalls,
  DirectorAdapterError,
  isRecord,
  lastUserMessageIndex,
  normalizeSources,
  requestJson,
  strictDecisionFromCandidates,
  structuredFields,
  structuredSystemPrompt,
  usageFrom,
  type SourceCandidate,
} from "./shared";
import { probeOpenAICompatibleCapabilities } from "./probe";

function responseInput(input: DirectorAdapterInput) {
  const messages = input.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  if (!input.attachments?.length) return messages;
  if (input.attachments.some((item) => item.kind !== "image")) {
    throw new DirectorAdapterError(
      "unsupported_input",
      "Responses 导演协议当前只接受图片附件",
    );
  }
  const lastUser = lastUserMessageIndex(messages);
  const content = [
    {
      type: "input_text",
      text:
        lastUser >= 0
          ? messages[lastUser]!.content
          : "请分析附件并完成导演任务。",
    },
    ...input.attachments.map((attachment) => ({
      type: "input_image",
      image_url: attachment.url,
      detail: "auto",
    })),
  ];
  if (lastUser >= 0) {
    return messages.map((message, index) =>
      index === lastUser ? { ...message, content } : message,
    );
  }
  return [...messages, { role: "user" as const, content }];
}

function responseText(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  if (Array.isArray(payload.output)) {
    const text = payload.output
    .flatMap((item) => {
      if (!isRecord(item) || !Array.isArray(item.content)) return [];
      return item.content.flatMap((part) =>
        isRecord(part) &&
        (part.type === "output_text" || part.type === "text") &&
        typeof part.text === "string"
          ? [part.text]
          : [],
      );
    })
    .join("\n")
    .trim();
    if (text) return text;
  }
  // Some gateways accept /responses but still serialize the result using the
  // Chat Completions envelope. Keep the protocol tolerant at the decoding
  // boundary; request semantics remain Responses-specific.
  if (Array.isArray(payload.choices)) {
    const text = payload.choices
      .flatMap((choice) => {
        if (!isRecord(choice)) return [];
        if (typeof choice.text === "string") return [choice.text];
        if (!isRecord(choice.message)) return [];
        return typeof choice.message.content === "string"
          ? [choice.message.content]
          : Array.isArray(choice.message.content)
            ? choice.message.content.flatMap((part) =>
                isRecord(part) && typeof part.text === "string"
                  ? [part.text]
                  : [],
              )
            : [];
      })
      .join("\n")
      .trim();
    return text || null;
  }
  return null;
}

function responseDecisionCandidates(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const candidates: unknown[] = [];
  candidates.push(...structuredFields(payload));
  if (typeof payload.output_text === "string") candidates.push(payload.output_text);
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!isRecord(item)) continue;
      candidates.push(...structuredFields(item));
      if (Array.isArray(item.content)) {
        for (const part of item.content) {
          if (!isRecord(part)) continue;
          candidates.push(...structuredFields(part));
          if (part.type === "output_json" || part.type === "json") {
            candidates.push(part.value, part.data, part.content);
          }
        }
      }
    }
  }
  const text = responseText(payload);
  if (text) candidates.push(text);
  if (Array.isArray(payload.choices)) {
    for (const choice of payload.choices) {
      if (!isRecord(choice)) continue;
      candidates.push(...structuredFields(choice));
      if (isRecord(choice.message)) {
        candidates.push(...structuredFields(choice.message));
      }
    }
  }
  return candidates.filter((candidate) => candidate !== undefined && candidate !== null);
}

function responseSources(payload: unknown): SourceCandidate[] {
  if (!isRecord(payload)) return [];
  const candidates: SourceCandidate[] = [];
  if (Array.isArray(payload.citations)) {
    for (const citation of payload.citations) {
      if (typeof citation === "string") candidates.push({ url: citation });
      else if (isRecord(citation)) candidates.push(citation);
    }
  }
  if (!Array.isArray(payload.output)) return candidates;
  for (const item of payload.output) {
    if (!isRecord(item)) continue;
    if (isRecord(item.action) && Array.isArray(item.action.sources)) {
      for (const source of item.action.sources) {
        if (isRecord(source)) candidates.push(source);
      }
    }
    if (!Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!isRecord(part) || !Array.isArray(part.annotations)) continue;
      for (const annotation of part.annotations) {
        if (!isRecord(annotation)) continue;
        if (isRecord(annotation.url_citation)) {
          candidates.push(annotation.url_citation);
        } else {
          candidates.push(annotation);
        }
      }
    }
  }
  return candidates;
}

export class OpenAIResponsesAdapter implements DirectorModelAdapter {
  readonly protocol: DirectorProtocol;

  constructor(protocol: "openai-responses" | "xai-responses") {
    this.protocol = protocol;
  }

  probeCapabilities = probeOpenAICompatibleCapabilities;

  async complete(
    connection: DirectorConnection,
    input: DirectorAdapterInput,
  ): Promise<DirectorAdapterResult> {
    assertAttachmentCapabilities(connection, input);
    const nativeSearch =
      Boolean(input.useNativeSearch) && connection.capabilities.nativeWebSearch;
    const payload = await requestJson(
      connection,
      adapterEndpoint(connection, "/responses"),
      {
        method: "POST",
        headers: adapterHeaders(connection, {
          authorization: `Bearer ${connection.apiKey}`,
        }),
        body: JSON.stringify({
          model: connection.model,
          instructions: structuredSystemPrompt(input.system),
          input: responseInput(input),
          store: false,
          ...(connection.capabilities.structuredOutput
            ? {
                text: {
                  format: {
                    type: "json_schema",
                    name: "director_decision",
                    strict: true,
                    schema: DIRECTOR_DECISION_JSON_SCHEMA,
                  },
                },
              }
            : {}),
          ...(connection.reasoningEffort
            ? { reasoning: { effort: connection.reasoningEffort } }
            : {}),
          ...(nativeSearch
            ? {
                tools: [{ type: "web_search" }],
                tool_choice: "auto",
                max_tool_calls: boundedSearchCalls(input),
                include: ["web_search_call.action.sources"],
              }
            : {}),
        }),
      },
      input.signal,
    );
    const text = responseText(payload);
    const candidates = responseDecisionCandidates(payload);
    if (!candidates.length) {
      throw new DirectorAdapterError(
        "invalid_response",
        "导演模型没有返回结构化决策",
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
      output: strictDecisionFromCandidates(candidates),
      ...(text ? { text } : {}),
      sources: normalizeSources(responseSources(payload)),
      ...(usage ? { usage } : {}),
    };
  }
}

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
  adapterOutputTokenLimit,
  adapterFinishReason,
  assertAttachmentCapabilities,
  dataUri,
  DirectorAdapterError,
  isRecord,
  lastUserMessageIndex,
  normalizeSources,
  requestJson,
  strictDecisionFromCandidates,
  structuredFields,
  textFromStructuredValue,
  structuredSystemPrompt,
  usageFrom,
  type SourceCandidate,
} from "./shared";
import { probeOpenAICompatibleCapabilities } from "./probe";

function chatMessages(input: DirectorAdapterInput) {
  const messages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content: structuredSystemPrompt(input.system, input.responseJsonSchema),
    },
    ...input.messages,
  ];
  if (!input.attachments?.length) return messages;
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
    if (attachment.kind === "image") {
      content.push({
        type: "image_url",
        image_url: { url: attachment.url, detail: "auto" },
      });
      continue;
    }
    if (attachment.kind === "audio") {
      const parsed = dataUri(attachment.url);
      const subtype = parsed?.mimeType.split("/").at(-1);
      const format = subtype && (({ mpeg: "mp3", "x-wav": "wav", wave: "wav", mp4: "m4a" } as Record<string, string>)[subtype] ?? subtype);
      if (
        !parsed ||
        !format ||
        !["wav", "mp3", "m4a", "webm"].includes(format)
      ) {
        throw new DirectorAdapterError(
          "unsupported_input",
          "Chat Completions 音频附件必须是受支持的 base64 data URI",
        );
      }
      content.push({
        type: "input_audio",
        input_audio: { data: parsed.data, format },
      });
      continue;
    }
    throw new DirectorAdapterError(
      "unsupported_input",
      "Chat Completions 导演协议当前不接受视频附件",
    );
  }
  if (lastUser >= 0) messages[lastUser] = { role: "user", content };
  else messages.push({ role: "user", content });
  return messages;
}

function chatResult(payload: unknown): {
  decision: unknown[];
  text: string | null;
  sources: SourceCandidate[];
} {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return { decision: [], text: null, sources: [] };
  }
  const first = payload.choices[0];
  if (!isRecord(first)) {
    return { decision: [], text: null, sources: [] };
  }
  // A few OpenAI-compatible gateways still return completion-style
  // `choices[0].text` while exposing the chat endpoint. Treat the choice as
  // the message envelope in that case.
  const message = isRecord(first.message) ? first.message : first;
  const textParts: string[] = [];
  if (typeof message.content === "string") textParts.push(message.content);
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (!isRecord(part)) continue;
      const partText = textFromStructuredValue(part);
      if (partText) textParts.push(partText);
    }
  }
  const text = textParts.join("\n").trim();
  const candidates: unknown[] = structuredFields(message);
  if (isRecord(message.content)) {
    candidates.push(message.content, ...structuredFields(message.content));
    candidates.push(message.content.value, message.content.data);
  }
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (isRecord(part)) candidates.push(...structuredFields(part));
    }
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (!isRecord(call)) continue;
      candidates.push(...structuredFields(call));
      if (isRecord(call.function)) {
        candidates.push(...structuredFields(call.function));
      }
    }
  }
  candidates.push(text || null);
  const sources: SourceCandidate[] = [];
  for (const value of [message.annotations, payload.citations]) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string") sources.push({ url: item });
      else if (isRecord(item) && isRecord(item.url_citation)) {
        sources.push(item.url_citation);
      } else if (isRecord(item)) sources.push(item);
    }
  }
  return { decision: candidates, text: text || null, sources };
}

export class OpenAIChatAdapter implements DirectorModelAdapter {
  readonly protocol: DirectorProtocol;

  constructor(
    protocol: "openai-chat-completions" | "generic-openai-compatible",
  ) {
    this.protocol = protocol;
  }

  probeCapabilities = probeOpenAICompatibleCapabilities;

  async complete(
    connection: DirectorConnection,
    input: DirectorAdapterInput,
  ): Promise<DirectorAdapterResult> {
    assertAttachmentCapabilities(connection, input);
    const outputTokens = adapterOutputTokenLimit(input);
    const payload = await requestJson(
      connection,
      adapterEndpoint(connection, "/chat/completions"),
      {
        method: "POST",
        headers: adapterHeaders(connection, {
          authorization: `Bearer ${connection.apiKey}`,
        }),
        body: JSON.stringify({
          model: connection.model,
          messages: chatMessages(input),
          stream: true,
          stream_options: { include_usage: true },
          ...(outputTokens !== undefined
            ? // The standard Chat Completions contract uses this budget for both
              // reasoning and ordinary models. An optional effort setting does
              // not identify a model's protocol or whether it reasons. Generic
              // gateways retain their established max_tokens compatibility.
              this.protocol === "openai-chat-completions"
              ? { max_completion_tokens: outputTokens }
              : { max_tokens: outputTokens }
            : {}),
          ...(connection.reasoningEffort
            ? { reasoning_effort: connection.reasoningEffort }
            : {}),
          ...(connection.capabilities.structuredOutput
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "director_decision",
                    strict: true,
                    schema:
                      input.responseJsonSchema ?? DIRECTOR_DECISION_JSON_SCHEMA,
                  },
                },
              }
            : {}),
        }),
      },
      input.signal,
    );
    const finishReason = adapterFinishReason(payload, this.protocol, input);
    const result = chatResult(payload);
    if (!result.decision.length) {
      throw new DirectorAdapterError(
        "invalid_response",
        "导演模型没有返回结构化决策",
      );
    }
    const usage =
      isRecord(payload) && isRecord(payload.usage)
        ? usageFrom(payload.usage, {
            input: "prompt_tokens",
            output: "completion_tokens",
            total: "total_tokens",
          })
        : undefined;
    return {
      output: strictDecisionFromCandidates(
        result.decision,
        input.responseJsonSchema,
      ),
      ...(result.text ? { text: result.text } : {}),
      sources: normalizeSources(result.sources),
      finishReason,
      ...(usage ? { usage } : {}),
    };
  }
}

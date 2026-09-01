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
    { role: "system", content: structuredSystemPrompt(input.system) },
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
      const format = parsed?.mimeType.split("/").at(-1);
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
  // A few OpenAI-compatible gateways put the only useful JSON in a reasoning
  // field when content is empty. It is still schema-validated below.
  for (const key of ["reasoning_content", "reasoning"] as const) {
    if (typeof message[key] === "string" && message[key].trim()) {
      textParts.push(message[key]);
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
          stream: false,
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
                    schema: DIRECTOR_DECISION_JSON_SCHEMA,
                  },
                },
              }
            : {}),
        }),
      },
      input.signal,
    );
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
      output: strictDecisionFromCandidates(result.decision),
      ...(result.text ? { text: result.text } : {}),
      sources: normalizeSources(result.sources),
      ...(usage ? { usage } : {}),
    };
  }
}

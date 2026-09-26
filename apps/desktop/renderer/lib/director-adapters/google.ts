import {
  DIRECTOR_DECISION_JSON_SCHEMA,
  type DirectorAdapterInput,
  type DirectorAdapterResult,
  type DirectorAttachment,
  type DirectorConnection,
  type DirectorModelAdapter,
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
  structuredSystemPrompt,
  usageFrom,
  type SourceCandidate,
} from "./shared";
import { probeGoogleCapabilities } from "./probe";

function geminiReasoning(connection: DirectorConnection): Record<string, unknown> {
  const effort = connection.reasoningEffort;
  if (!effort) return {};
  const model = connection.model.replace(/^models\//u, "").toLowerCase();
  if (/^gemini-2\.5(?:-|$)/u.test(model))
    throw new DirectorAdapterError("configuration", "Gemini 2.5 的当前协议使用思考预算，请选择自动；不会将思考档位换算成未经声明的预算");
  // Model-specific choices are validated against this connection's catalog.
  // Preserve provider declarations instead of narrowing them to public defaults.
  const allowed = ["minimal", "low", "medium", "high"];
  if (!allowed.includes(effort))
    throw new DirectorAdapterError("configuration", "此 Gemini 模型不支持所选思考档位，请选择自动或该模型已声明的档位");
  // This adapter uses generateContent. Interactions uses a different snake-case
  // schema; never forward an OpenAI reasoning_effort or fabricate a token budget.
  return { thinkingConfig: { thinkingLevel: effort } };
}

function defaultMimeType(attachment: DirectorAttachment): string {
  if (attachment.mimeType) return attachment.mimeType;
  if (attachment.kind === "image") return "image/jpeg";
  if (attachment.kind === "audio") return "audio/mpeg";
  return "video/mp4";
}

function geminiContents(input: DirectorAdapterInput) {
  const contents: Array<Record<string, unknown>> = input.messages.map(
    (message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }),
  );
  if (!input.attachments?.length) return contents;
  const lastUser = lastUserMessageIndex(contents);
  const existing = lastUser >= 0 ? contents[lastUser] : undefined;
  const parts: Array<Record<string, unknown>> =
    existing && Array.isArray(existing.parts)
      ? [...(existing.parts as Array<Record<string, unknown>>)]
      : [{ text: "请分析附件并完成导演任务。" }];
  for (const attachment of input.attachments) {
    const inline = dataUri(attachment.url);
    parts.push(
      inline
        ? { inlineData: { mimeType: inline.mimeType, data: inline.data } }
        : {
            fileData: {
              mimeType: defaultMimeType(attachment),
              fileUri: attachment.url,
            },
          },
    );
  }
  if (lastUser >= 0) contents[lastUser] = { role: "user", parts };
  else contents.push({ role: "user", parts });
  return contents;
}

function geminiResult(payload: unknown): {
  decision: unknown[];
  text: string | null;
  sources: SourceCandidate[];
} {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    return { decision: [], text: null, sources: [] };
  }
  const first = payload.candidates[0];
  if (!isRecord(first)) return { decision: [], text: null, sources: [] };
  const candidates: unknown[] = [
    ...structuredFields(first),
    ...(isRecord(first.content) ? structuredFields(first.content) : []),
  ];
  const textParts: string[] = [];
  if (isRecord(first.content) && Array.isArray(first.content.parts)) {
    for (const part of first.content.parts) {
      if (!isRecord(part)) continue;
      candidates.push(...structuredFields(part));
      if (part.type === "json" || part.type === "output_json") {
        candidates.push(part.value, part.data, part.content);
      }
      if (typeof part.text === "string") textParts.push(part.text);
    }
  }
  const text = textParts.join("\n").trim();
  candidates.push(text || null);
  const sources: SourceCandidate[] = [];
  if (
    isRecord(first.groundingMetadata) &&
    Array.isArray(first.groundingMetadata.groundingChunks)
  ) {
    for (const chunk of first.groundingMetadata.groundingChunks) {
      if (isRecord(chunk) && isRecord(chunk.web)) {
        sources.push({
          url: chunk.web.uri,
          title: chunk.web.title,
        });
      }
    }
  }
  return { decision: candidates, text: text || null, sources };
}

export class GoogleGenerateContentAdapter implements DirectorModelAdapter {
  readonly protocol = "google-generate-content" as const;
  probeCapabilities = probeGoogleCapabilities;

  async complete(
    connection: DirectorConnection,
    input: DirectorAdapterInput,
  ): Promise<DirectorAdapterResult> {
    assertAttachmentCapabilities(connection, input);
    const outputTokens = adapterOutputTokenLimit(input);
    const reasoning = geminiReasoning(connection);
    const model = connection.model.replace(/^models\//u, "");
    const nativeSearch =
      Boolean(input.useNativeSearch) && connection.capabilities.nativeWebSearch;
    const payload = await requestJson(
      connection,
      adapterEndpoint(
        connection,
        `/models/${encodeURIComponent(model)}:generateContent`,
      ),
      {
        method: "POST",
        headers: adapterHeaders(connection, {
          "x-goog-api-key": connection.apiKey,
        }),
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: structuredSystemPrompt(
                  input.system,
                  input.responseJsonSchema,
                ),
              },
            ],
          },
          contents: geminiContents(input),
          ...(connection.reasoningEffort || connection.capabilities.structuredOutput ||
          outputTokens !== undefined
            ? {
                generationConfig: {
                  ...reasoning,
                  ...(outputTokens !== undefined
                    ? { maxOutputTokens: outputTokens }
                    : {}),
                  ...(connection.capabilities.structuredOutput
                    ? {
                        responseMimeType: "application/json",
                        responseJsonSchema:
                          input.responseJsonSchema ??
                          DIRECTOR_DECISION_JSON_SCHEMA,
                      }
                    : {}),
                },
              }
            : {}),
          ...(nativeSearch ? { tools: [{ googleSearch: {} }] } : {}),
        }),
      },
      input.signal,
    );
    const finishReason = adapterFinishReason(payload, this.protocol, input);
    const result = geminiResult(payload);
    if (!result.decision.length) {
      throw new DirectorAdapterError(
        "invalid_response",
        "Gemini 没有返回结构化导演决策",
      );
    }
    const usage =
      isRecord(payload) && isRecord(payload.usageMetadata)
        ? usageFrom(payload.usageMetadata, {
            input: "promptTokenCount",
            output: "candidatesTokenCount",
            total: "totalTokenCount",
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

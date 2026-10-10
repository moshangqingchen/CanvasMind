import {
  DIRECTOR_DECISION_JSON_SCHEMA,
  parseDirectorDecision,
  type DirectorAdapterInput,
  type DirectorConnection,
  type DirectorFinishReason,
  type DirectorProtocol,
  type DirectorSource,
} from "@super-canvas/director";
import { providerFetch } from "@super-canvas/providers";

export const DIRECTOR_ADAPTER_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_DETAIL_LENGTH = 500;

export type JsonRecord = Record<string, unknown>;

export class DirectorAdapterError extends Error {
  readonly code:
    | "aborted"
    | "configuration"
    | "invalid_response"
    | "network"
    | "timeout"
    | "unsupported_input"
    | "upstream";
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    code: DirectorAdapterError["code"],
    message: string,
    options?: { status?: number; retryable?: boolean },
  ) {
    super(message);
    this.name = "DirectorAdapterError";
    this.code = code;
    this.status = options?.status;
    this.retryable = options?.retryable ?? false;
  }
}

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function adapterOutputTokenLimit(
  input: DirectorAdapterInput,
): number | undefined {
  if (input.maxOutputTokens === undefined) return undefined;
  if (
    !Number.isSafeInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    input.maxOutputTokens > 131_072
  ) {
    throw new DirectorAdapterError("configuration", "模型输出长度上限无效");
  }
  return input.maxOutputTokens;
}

/** Normalize native termination without treating valid partial JSON as success. */
export function adapterFinishReason(
  payload: unknown,
  protocol: DirectorProtocol,
  input: DirectorAdapterInput,
): DirectorFinishReason {
  let reason: DirectorFinishReason = "unknown";
  if (isRecord(payload)) {
    const choice =
      Array.isArray(payload.choices) && isRecord(payload.choices[0])
        ? payload.choices[0]
        : undefined;
    const chatReason = choice?.finish_reason;
    if (protocol === "anthropic-messages") {
      if (["end_turn", "stop_sequence"].includes(String(payload.stop_reason)))
        reason = "complete";
      else if (payload.stop_reason === "max_tokens") reason = "length";
      else if (payload.stop_reason === "tool_use") reason = "tool_call";
      else if (payload.stop_reason === "refusal") reason = "blocked";
    } else if (protocol === "google-generate-content") {
      const candidate =
        Array.isArray(payload.candidates) && isRecord(payload.candidates[0])
          ? payload.candidates[0]
          : undefined;
      if (candidate?.finishReason === "STOP") reason = "complete";
      else if (candidate?.finishReason === "MAX_TOKENS") reason = "length";
      else if (
        candidate?.finishReason &&
        candidate.finishReason !== "FINISH_REASON_UNSPECIFIED"
      )
        reason = "blocked";
      else if (
        isRecord(payload.promptFeedback) &&
        payload.promptFeedback.blockReason
      )
        reason = "blocked";
    } else if (
      (protocol === "openai-responses" || protocol === "xai-responses") &&
      payload.status !== undefined
    ) {
      if (payload.status === "completed") reason = "complete";
      if (isRecord(payload.incomplete_details))
        reason =
          payload.incomplete_details.reason === "max_output_tokens"
            ? "length"
            : "blocked";
      if (payload.status === "failed") reason = "blocked";
      if (Array.isArray(payload.output)) {
        if (
          payload.output.some(
            (item) => isRecord(item) && item.status === "incomplete",
          )
        )
          reason = "length";
        if (
          payload.output.some(
            (item) =>
              isRecord(item) &&
              Array.isArray(item.content) &&
              item.content.some(
                (part) => isRecord(part) && part.type === "refusal",
              ),
          )
        )
          reason = "blocked";
      }
    } else if (chatReason === "stop") reason = "complete";
    else if (chatReason === "length") reason = "length";
    else if (chatReason === "content_filter") reason = "blocked";
    else if (chatReason === "tool_calls" || chatReason === "function_call")
      reason = "tool_call";
  }
  if (input.requireComplete && reason !== "complete") {
    throw new DirectorAdapterError(
      "invalid_response",
      reason === "length"
        ? "模型输出达到长度上限，完整结果未采用，请分批处理"
        : "模型没有确认完整返回结果，请重试或检查模型协议",
    );
  }
  return reason;
}

export function lastUserMessageIndex(
  messages: readonly Record<string, unknown>[],
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function privateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") {
    return true;
  }
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return (
      host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")
    );
  }
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function adapterEndpoint(
  connection: DirectorConnection,
  path: string,
): string {
  let url: URL;
  try {
    url = new URL(connection.baseUrl);
  } catch {
    throw new DirectorAdapterError(
      "configuration",
      "导演模型连接的 API 地址无效",
    );
  }
  if (url.username || url.password) {
    throw new DirectorAdapterError(
      "configuration",
      "导演模型连接的 API 地址不能包含身份凭据",
    );
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && connection.allowLocalhost)
  ) {
    throw new DirectorAdapterError(
      "configuration",
      "导演模型连接必须使用 HTTPS；本地开发地址需显式允许",
    );
  }
  if (privateHostname(url.hostname) && !connection.allowLocalhost) {
    throw new DirectorAdapterError(
      "configuration",
      "导演模型连接不能访问未授权的本地或私有网络地址",
    );
  }
  // Supplier connections store the site root for catalogs and shared canvas
  // Keys. Standard OpenAI/Anthropic calls need /v1, while explicitly supplied
  // gateway prefixes and versioned paths must remain intact.
  const basePath = url.pathname.replace(/\/+$/u, "");
  const defaultPath = connection.protocol === "google-generate-content" ? "/v1beta" : "/v1";
  url.pathname = `${basePath || defaultPath}/${path.replace(/^\//u, "")}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

const RESERVED_HEADERS = new Set([
  "authorization",
  "content-length",
  "content-type",
  "host",
  "x-api-key",
  "x-goog-api-key",
]);

export function adapterHeaders(
  connection: DirectorConnection,
  required: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(connection.headers ?? {})) {
    if (!RESERVED_HEADERS.has(name.toLowerCase()) && value.trim()) {
      headers[name] = value;
    }
  }
  return { ...headers, "content-type": "application/json", ...required };
}

function redact(value: string, secrets: readonly string[]): string {
  let result = value;
  for (const secret of secrets) {
    if (secret.length >= 4) result = result.replaceAll(secret, "***");
  }
  return result
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer ***")
    .replace(/(?:sk|xai|AIza)[-_A-Za-z0-9]{8,}/gu, "***")
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=_-]+/giu, "data:…")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_ERROR_DETAIL_LENGTH);
}

function upstreamDetail(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (!isRecord(payload)) return null;
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.detail === "string") return payload.detail;
  if (typeof payload.error === "string") return payload.error;
  if (isRecord(payload.error)) return upstreamDetail(payload.error);
  return null;
}

type ResponseConnection = Pick<DirectorConnection, "supplier" | "apiKey">;

function upstreamMessage(
  connection: ResponseConnection,
  status: number,
  payload: unknown,
): string {
  const detail = upstreamDetail(payload);
  const safe = detail ? redact(detail, [connection.apiKey]) : "";
  const suffix = safe ? `：${safe}` : "";
  if (status === 401 || status === 403) {
    return `${connection.supplier}导演模型身份验证失败${suffix}`;
  }
  if (status === 429)
    return `${connection.supplier}导演模型当前已限流${suffix}`;
  if (status >= 500) return `${connection.supplier}导演模型暂时不可用${suffix}`;
  return `${connection.supplier}导演模型拒绝了请求${suffix}`;
}

async function boundedResponseText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new DirectorAdapterError(
          "invalid_response",
          "导演模型返回的数据超过安全大小限制",
        );
      }
      parts.push(decoder.decode(part.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    reader.releaseLock();
  }
}

/** Aggregate streamed model output into the same envelope as a JSON response. */
function eventStreamPayload(raw: string, connection: ResponseConnection): unknown {
  const choices = new Map<number, JsonRecord>();
  const responseParts = new Map<string, string>();
  let response: JsonRecord = {};
  let usage: unknown;
  let citations: unknown[] = [];
  let terminal = false;
  let responses = false;
  for (const frame of raw.replace(/\r\n?/gu, "\n").split("\n\n")) {
    const lines = frame.split("\n");
    const eventName = lines.filter(line => line.startsWith("event:")).at(-1)?.slice(6).trim();
    const data = lines.filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart()).join("\n");
    if (!data) continue;
    if (data.trim() === "[DONE]") { terminal = true; continue; }
    let event: unknown;
    try { event = JSON.parse(data); } catch {
      throw new DirectorAdapterError("invalid_response", "模型返回了无法解析的流式数据");
    }
    if (!isRecord(event)) continue;
    const eventType = typeof event.type === "string" ? event.type : eventName;
    if (event.error || eventType === "error" || eventType === "response.failed") {
      const detail = isRecord(event.response) ? event.response : event;
      throw new DirectorAdapterError("upstream", upstreamMessage(connection, 502, detail), { status: 502 });
    }
    if (Array.isArray(event.citations)) citations = event.citations;
    if (Array.isArray(event.choices)) {
      for (const item of event.choices) {
        if (!isRecord(item)) continue;
        const index = typeof item.index === "number" ? item.index : 0;
        const previous = choices.get(index) ?? { index, message: { role: "assistant", content: "" } };
        const message = previous.message as JsonRecord;
        if (isRecord(item.message)) Object.assign(message, item.message);
        const delta = isRecord(item.delta) ? item.delta : item;
        for (const key of ["content", "text"] as const) {
          if (typeof delta[key] === "string") message.content = String(message.content ?? "") + delta[key];
          else if (Array.isArray(delta[key])) message.content = String(message.content ?? "") + (textFromStructuredValue(delta[key]) ?? "");
        }
        if (delta.parsed !== undefined) message.parsed = delta.parsed;
        if (Array.isArray(delta.annotations)) {
          message.annotations = [...(Array.isArray(message.annotations) ? message.annotations : []), ...delta.annotations];
        }
        if (Array.isArray(delta.tool_calls)) {
          const calls = Array.isArray(message.tool_calls) ? message.tool_calls as JsonRecord[] : [];
          for (const call of delta.tool_calls) {
            if (!isRecord(call)) continue;
            const n = typeof call.index === "number" ? call.index : 0;
            const prior = calls[n] ?? { function: {} };
            if (isRecord(call.function)) {
              const fn = isRecord(prior.function) ? prior.function : {};
              for (const key of ["name", "arguments"] as const)
                if (typeof call.function[key] === "string") fn[key] = String(fn[key] ?? "") + call.function[key];
              prior.function = fn;
            }
            calls[n] = prior;
          }
          message.tool_calls = calls;
        }
        if (item.finish_reason) { previous.finish_reason = item.finish_reason; terminal = true; }
        choices.set(index, previous);
      }
      if (event.usage) usage = event.usage;
    }
    if (eventType?.startsWith("response.")) {
      responses = true;
      if (isRecord(event.response)) response = { ...response, ...event.response };
      if (eventType === "response.output_text.delta" && typeof event.delta === "string") {
        const key = `${event.output_index ?? 0}:${event.content_index ?? 0}`;
        responseParts.set(key, (responseParts.get(key) ?? "") + event.delta);
      }
      if (eventType === "response.output_text.done" && typeof event.text === "string")
        responseParts.set(`${event.output_index ?? 0}:${event.content_index ?? 0}`, event.text);
      if (eventType === "response.completed") { response.status = "completed"; terminal = true; }
      if (eventType === "response.incomplete")
        throw new DirectorAdapterError("invalid_response", "模型未完整返回结果，请调整输出长度或分批处理");
    }
  }
  if (!terminal) throw new DirectorAdapterError("invalid_response", "模型连接在结果完成前中断，请检查记录后重试");
  if (responses) {
    if (response.status !== "completed") throw new DirectorAdapterError("invalid_response", "模型连接在结果完成前中断，请检查记录后重试");
    return { ...response, ...(responseParts.size ? { output_text: [...responseParts.values()].join("\n") } : {}) };
  }
  return { choices: [...choices.values()].sort((a, b) => Number(a.index) - Number(b.index)), usage, citations };
}

/** Decode JSON or SSE once, retaining size limits and sanitized provider errors. */
export async function readModelResponse(
  response: Response,
  connection: ResponseConnection,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new DirectorAdapterError("invalid_response", "导演模型返回的数据超过安全大小限制");
  }
  const raw = await boundedResponseText(response);
  let payload: unknown = null;
  if (raw) {
    try {
      payload = response.ok && (/text\/event-stream/iu.test(response.headers.get("content-type") ?? "") || /^(?:event:|data:|:)/u.test(raw.trimStart()))
        ? eventStreamPayload(raw, connection)
        : JSON.parse(raw) as unknown;
    } catch (error) {
      if (error instanceof DirectorAdapterError) throw error;
      if (response.ok) {
        throw new DirectorAdapterError(
          "invalid_response",
          /text\/html/iu.test(response.headers.get("content-type") ?? "") || /^\s*(?:<!doctype\s+html|<html\b)/iu.test(raw)
            ? "供应商返回了网页内容，请核对供应商文档中的 API 地址和接口路径"
            : "模型接口返回的数据格式无效，请检查供应商接口或响应格式",
        );
      }
      payload = raw;
    }
  }
  if (!response.ok) {
    throw new DirectorAdapterError("upstream", upstreamMessage(connection, response.status, payload), {
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  return payload;
}

export async function requestJson(
  connection: DirectorConnection,
  url: string,
  init: RequestInit,
  externalSignal?: AbortSignal,
): Promise<unknown> {
  if (!connection.apiKey.trim()) {
    throw new DirectorAdapterError(
      "configuration",
      "导演模型连接尚未配置 API Key",
    );
  }

  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DIRECTOR_ADAPTER_TIMEOUT_MS);

  try {
    if (controller.signal.aborted) {
      throw new DirectorAdapterError("aborted", "导演模型请求已取消");
    }
    // Provider gateways may require the configured HTTP proxy (the same
    // transport used by canvas generation and model catalog requests). Using
    // native fetch here bypasses that route and presents as a misleading
    // generic network failure on TUN/Fake-IP networks.
    const response = await providerFetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    return await readModelResponse(response, connection);
  } catch (error) {
    if (error instanceof DirectorAdapterError) throw error;
    if (controller.signal.aborted) {
      throw new DirectorAdapterError(
        timedOut ? "timeout" : "aborted",
        timedOut ? "导演模型请求超时" : "导演模型请求已取消",
        { retryable: timedOut },
      );
    }
    throw new DirectorAdapterError(
      "network",
      `无法连接${connection.supplier}导演模型`,
      { retryable: true },
    );
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abort);
  }
}

/**
 * Gateways expose structured output under different envelope fields. Try each
 * explicitly supplied candidate, but keep the same schema gate for every one.
 */
export function strictDecisionFromCandidates(
  candidates: readonly unknown[],
  customSchema?: Readonly<Record<string, unknown>>,
): unknown {
  if (customSchema) {
    const unwrap = (value: unknown): unknown => {
      if (isRecord(value) && typeof value.decision === "string")
        return JSON.parse(value.decision);
      if (isRecord(value) && isRecord(value.decision)) return value.decision;
      return value;
    };
    for (const candidate of candidates) {
      try {
        const value = unwrap(
          typeof candidate === "string"
            ? JSON.parse(
                candidate
                  .trim()
                  .replace(/^```(?:json)?\s*/u, "")
                  .replace(/\s*```$/u, ""),
              )
            : candidate,
        );
        // Provider envelopes (content arrays, message objects, parts) are not
        // decisions. Continue to the extracted JSON/text candidate instead.
        if (
          isRecord(value) &&
          typeof value.type === "string" &&
          !["message", "output_text", "text", "tool_use"].includes(value.type)
        )
          return value;
      } catch {
        /* Try the next provider representation. */
      }
    }
    const message = candidates.find((c): c is string => typeof c === "string" && Boolean(c.trim()));
    if (message) return { type: "reply", message: message.trim().slice(0, 32_000) };
    throw new DirectorAdapterError("invalid_response", "模型未返回可用内容，请检查记录后重试");
  }
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    try {
      return parseDirectorDecision(candidate);
    } catch {
      // Try the next provider-specific representation before failing closed.
    }
  }
  // Models without native structured-output support may still follow the
  // instruction only approximately and return a normal explanation (or a
  // JSON-looking string with missing fields). Treat that as a non-executable
  // reply instead of surfacing a protocol error. It can never reach the paid
  // media path because only a schema-valid `proposal` is executable.
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const text = candidate.trim();
    if (!text) continue;
    return { type: "reply", message: text.slice(0, 32_000) };
  }
  // Some gateways wrap ordinary text in a minimal object while omitting the
  // decision discriminator. Accept only a small, explicit shape so malformed
  // structured payloads still fail closed instead of being misinterpreted.
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const keys = Object.keys(candidate);
    if (keys.some((key) => !["message", "text"].includes(key))) continue;
    const text =
      typeof candidate.message === "string"
        ? candidate.message.trim()
        : typeof candidate.text === "string"
          ? candidate.text.trim()
          : "";
    if (text) return { type: "reply", message: text.slice(0, 32_000) };
  }
  throw new DirectorAdapterError(
    "invalid_response",
    "导演模型未按约定返回有效的结构化决策",
  );
}

export function structuredFields(record: JsonRecord): unknown[] {
  return [
    record.parsed,
    record.json,
    record.decision,
    record.text,
    record.output_text,
    record.content,
    record.arguments,
    record.input,
    record.structuredData,
    record.structured_data,
    record.output_json,
    record.value,
    record.data,
  ].filter((value) => value !== undefined && value !== null);
}

export function textFromStructuredValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const text = value
      .flatMap((part) => {
        if (typeof part === "string") return [part];
        if (!isRecord(part)) return [];
        return [part.text, part.output_text, part.content].filter(
          (item): item is string => typeof item === "string",
        );
      })
      .join("\n")
      .trim();
    return text || null;
  }
  if (isRecord(value)) {
    for (const key of ["text", "output_text", "content", "value"] as const) {
      if (typeof value[key] === "string" && value[key].trim()) {
        return value[key].trim();
      }
    }
  }
  return null;
}

export function structuredSystemPrompt(
  system: string,
  schema?: Readonly<Record<string, unknown>>,
): string {
  return [
    system,
    "只返回一个符合下面 JSON Schema 的 JSON 对象，不要使用 Markdown 代码块，也不要添加解释。即使当前接口不支持原生 response_format，也必须把该对象作为纯文本 JSON 返回。",
    JSON.stringify(schema ?? DIRECTOR_DECISION_JSON_SCHEMA),
  ].join("\n\n");
}

export function boundedSearchCalls(input: DirectorAdapterInput): number {
  return Math.min(3, Math.max(1, Math.trunc(input.maxSearchCalls ?? 3)));
}

export function assertAttachmentCapabilities(
  connection: DirectorConnection,
  input: DirectorAdapterInput,
): void {
  for (const attachment of input.attachments ?? []) {
    const supported =
      (attachment.kind === "image" && connection.capabilities.imageInput) ||
      (attachment.kind === "audio" && connection.capabilities.audioInput) ||
      (attachment.kind === "video" && connection.capabilities.videoInput);
    if (!supported) {
      throw new DirectorAdapterError(
        "unsupported_input",
        `当前导演模型不支持${attachment.kind === "image" ? "图片" : attachment.kind === "audio" ? "音频" : "视频"}输入`,
      );
    }
  }
}

export function dataUri(
  value: string,
): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=_-]+)$/u.exec(value);
  return match ? { mimeType: match[1]!, data: match[2]! } : null;
}

export interface SourceCandidate {
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
}

export function normalizeSources(
  candidates: readonly SourceCandidate[],
): DirectorSource[] {
  const capturedAt = new Date().toISOString();
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    if (typeof candidate.url !== "string") return [];
    let url: URL;
    try {
      url = new URL(candidate.url);
    } catch {
      return [];
    }
    if (!["http:", "https:"].includes(url.protocol) || seen.has(url.href)) {
      return [];
    }
    seen.add(url.href);
    const title =
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim().slice(0, 300)
        : url.hostname;
    const snippet =
      typeof candidate.snippet === "string" && candidate.snippet.trim()
        ? candidate.snippet.trim().slice(0, 1_000)
        : undefined;
    return [
      {
        title,
        url: url.href,
        capturedAt,
        evidence: "C" as const,
        ...(snippet ? { snippet } : {}),
      },
    ];
  });
}

export function usageFrom(
  payload: unknown,
  keys: {
    input: string;
    output: string;
    total: string;
  },
) {
  if (!isRecord(payload)) return undefined;
  const number = (key: string) =>
    typeof payload[key] === "number" && Number.isFinite(payload[key])
      ? payload[key]
      : undefined;
  const inputTokens = number(keys.input);
  const outputTokens = number(keys.output);
  const totalTokens = number(keys.total);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

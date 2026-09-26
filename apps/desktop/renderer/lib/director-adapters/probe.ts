import type {
  DirectorConnection,
  DirectorModelCapabilities,
} from "@super-canvas/director";
import {
  adapterEndpoint,
  adapterHeaders,
  DirectorAdapterError,
  isRecord,
  requestJson,
  type JsonRecord,
} from "./shared";

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) =>
    typeof item === "string" ? [item.toLowerCase()] : [],
  );
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function explicitBoolean(
  records: readonly JsonRecord[],
  keys: readonly string[],
): boolean | undefined {
  for (const record of records) {
    for (const key of keys) {
      if (typeof record[key] === "boolean") return record[key];
    }
  }
  return undefined;
}

/** A successful model lookup verifies availability and honors explicit metadata. */
export function capabilitiesFromVerifiedModel(
  connection: DirectorConnection,
  model: JsonRecord,
): DirectorModelCapabilities {
  const metadata = isRecord(model.metadata) ? model.metadata : {};
  const capabilities = isRecord(model.capabilities) ? model.capabilities : {};
  const records = [model, metadata, capabilities];
  // Older profiles could contain hand-edited capability flags. They are not
  // evidence about the selected model, so discard them unless the provider's
  // model record explicitly reports the capability.
  const legacyManual = connection.capabilities.probeSource === "manual";
  const baseline = legacyManual
    ? {
        ...connection.capabilities,
        imageInput: false,
        audioInput: false,
        videoInput: false,
        structuredOutput: connection.protocol !== "generic-openai-compatible",
        toolCalling: connection.protocol === "anthropic-messages",
        nativeWebSearch: false,
        reasoning: false,
      }
    : connection.capabilities;
  const modalities =
    strings(model.input_modalities) ??
    strings(model.modalities) ??
    strings(metadata.input_modalities) ??
    strings(capabilities.input_modalities) ??
    strings(capabilities.modalities);
  const resolveInput = (
    kind: "text" | "image" | "audio" | "video",
    declared: boolean,
    keys: readonly string[],
  ) =>
    modalities !== null
      ? modalities.includes(kind)
      : (explicitBoolean(records, keys) ?? declared);
  const resolveBoolean = (declared: boolean, keys: readonly string[]) =>
    explicitBoolean(records, keys) ?? declared;
  const contextWindow =
    finitePositive(model.context_window) ??
    finitePositive(model.inputTokenLimit) ??
    finitePositive(model.input_token_limit) ??
    finitePositive(metadata.context_window) ??
    connection.capabilities.contextWindow;

  return {
    text: resolveInput("text", baseline.text, [
      "text_input",
      "text",
    ]),
    imageInput: resolveInput("image", baseline.imageInput, [
      "image_input",
      "vision",
    ]),
    audioInput: resolveInput("audio", baseline.audioInput, [
      "audio_input",
    ]),
    videoInput: resolveInput("video", baseline.videoInput, [
      "video_input",
    ]),
    structuredOutput: resolveBoolean(baseline.structuredOutput, [
      "structured_output",
      "structured_outputs",
      "json_schema",
    ]),
    toolCalling: resolveBoolean(baseline.toolCalling, [
      "tool_calling",
      "tools",
      "function_calling",
    ]),
    nativeWebSearch: resolveBoolean(baseline.nativeWebSearch, [
      "native_web_search",
      "web_search",
    ]),
    reasoning: resolveBoolean(baseline.reasoning, ["reasoning"]),
    ...(contextWindow ? { contextWindow } : {}),
    probedAt: new Date().toISOString(),
    probeSource: "live",
  };
}

function requireModelRecord(
  payload: unknown,
  expectedModel: string,
): JsonRecord {
  if (!isRecord(payload)) {
    throw new DirectorAdapterError(
      "invalid_response",
      "模型探测端点没有返回模型信息",
    );
  }
  const normalizeId = (value: unknown) =>
    typeof value === "string" ? value.trim().replace(/^models\//u, "") : null;
  const expected = normalizeId(expectedModel);
  const recordId = normalizeId(payload.id ?? payload.name);
  if (recordId === expected) return payload;

  const recordsFrom = (value: unknown): JsonRecord[] => {
    if (Array.isArray(value)) return value.filter(isRecord);
    if (!isRecord(value)) return [];
    if (value.id !== undefined || value.name !== undefined) return [value];
    return Object.entries(value).flatMap(([id, item]) =>
      isRecord(item) ? [{ id, ...item }] : [],
    );
  };

  // Gateways commonly wrap a single-model lookup in the same envelope used
  // by their list endpoint. Accept only the explicitly selected model; do
  // not treat another returned model as a successful probe.
  for (const collection of [payload.data, payload.models]) {
    const match = recordsFrom(collection).find(
      (item) => normalizeId(item.id ?? item.name) === expected,
    );
    if (match) return match;
  }
  if (isRecord(payload.model)) {
    const nestedId = normalizeId(payload.model.id ?? payload.model.name);
    if (nestedId === expected) return payload.model;
  }
  if (normalizeId(payload.model) === expected) return payload;
  const returnedId = recordId ?? "未知";
  if (returnedId !== expected) {
    const keys = Object.keys(payload).slice(0, 12).join(", ");
    throw new DirectorAdapterError(
      "configuration",
      `模型探测结果与当前导演模型不一致（返回模型：${returnedId}；字段：${keys || "无"}）`,
    );
  }
  return payload;
}

function listedModel(payload: unknown, expectedModel: string): JsonRecord {
  if (!isRecord(payload)) {
    throw new DirectorAdapterError(
      "invalid_response",
      "模型列表端点没有返回可验证的模型目录",
    );
  }
  const expected = expectedModel.replace(/^models\//u, "");
  const recordsFrom = (value: unknown): JsonRecord[] => {
    if (Array.isArray(value)) return value.filter(isRecord);
    if (!isRecord(value)) return [];
    if (value.id !== undefined || value.name !== undefined) return [value];
    return Object.entries(value).flatMap(([id, item]) =>
      isRecord(item) ? [{ id, ...item }] : [],
    );
  };
  const match = [payload.data, payload.models]
    .flatMap(recordsFrom)
    .find(
      (item) =>
        typeof (item.id ?? item.name) === "string" &&
        String(item.id ?? item.name).replace(/^models\//u, "") === expected,
    );
  if (!isRecord(match)) {
    throw new DirectorAdapterError(
      "configuration",
      "当前连接的实时模型目录不包含所选导演模型",
    );
  }
  return match;
}

export async function probeOpenAICompatibleCapabilities(
  connection: DirectorConnection,
  signal?: AbortSignal,
): Promise<DirectorModelCapabilities> {
  const headers = adapterHeaders(connection, {
    authorization: `Bearer ${connection.apiKey}`,
  });
  let model: JsonRecord;
  try {
    const payload = await requestJson(
      connection,
      adapterEndpoint(
        connection,
        `/models/${encodeURIComponent(connection.model)}`,
      ),
      { method: "GET", headers },
      signal,
    );
    model = requireModelRecord(payload, connection.model);
  } catch (error) {
    if (
      !(error instanceof DirectorAdapterError) ||
      !(
        (error.code === "upstream" && [404, 405].includes(error.status ?? 0)) ||
        // Some gateways answer an unsupported per-model lookup with HTTP 200
        // and an `{ error: ... }` envelope. Treat that shape like a missing
        // endpoint and fall back to their list endpoint before failing.
        error.code === "configuration" ||
        error.code === "invalid_response"
      )
    ) {
      throw error;
    }
    const payload = await requestJson(
      connection,
      adapterEndpoint(connection, "/models"),
      { method: "GET", headers },
      signal,
    );
    model = listedModel(payload, connection.model);
  }
  return capabilitiesFromVerifiedModel(connection, model);
}

export async function probeAnthropicCapabilities(
  connection: DirectorConnection,
  signal?: AbortSignal,
): Promise<DirectorModelCapabilities> {
  const payload = await requestJson(
    connection,
    adapterEndpoint(
      connection,
      `/models/${encodeURIComponent(connection.model)}`,
    ),
    {
      method: "GET",
      headers: adapterHeaders(connection, {
        "x-api-key": connection.apiKey,
        "anthropic-version": "2023-06-01",
      }),
    },
    signal,
  );
  return capabilitiesFromVerifiedModel(
    connection,
    requireModelRecord(payload, connection.model),
  );
}

export async function probeGoogleCapabilities(
  connection: DirectorConnection,
  signal?: AbortSignal,
): Promise<DirectorModelCapabilities> {
  const expectedModel = connection.model.replace(/^models\//u, "");
  const payload = await requestJson(
    connection,
    adapterEndpoint(connection, `/models/${encodeURIComponent(expectedModel)}`),
    {
      method: "GET",
      headers: adapterHeaders(connection, {
        "x-goog-api-key": connection.apiKey,
      }),
    },
    signal,
  );
  const model = requireModelRecord(payload, expectedModel);
  if (
    Array.isArray(model.supportedGenerationMethods) &&
    !model.supportedGenerationMethods.includes("generateContent")
  ) {
    throw new DirectorAdapterError(
      "configuration",
      "所选 Gemini 模型不支持 generateContent",
    );
  }
  return capabilitiesFromVerifiedModel(connection, model);
}

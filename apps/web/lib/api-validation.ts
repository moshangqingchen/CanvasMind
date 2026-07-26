import {
  CreateRunRequestSchema,
  PointSchema,
  PortCollectionSchema,
  WorkflowEdgeSchema,
  WorkflowNodeSchema,
  validateGraph,
  type GraphValidationIssue,
} from "@super-canvas/core";
import type { JsonObject } from "@super-canvas/db";
import { z } from "zod";

const MAX_IDENTIFIER_LENGTH = 128;
export const MAX_JSON_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_SMALL_JSON_BODY_BYTES = 128 * 1024;
const FORBIDDEN_OBJECT_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "cookie",
  "set-cookie",
]);
const SENSITIVE_HEADER_PATTERN =
  /(?:authorization|cookie|token|secret|signature|credential|api[-_]?key)/iu;
const SENSITIVE_CONFIG_KEY_PATTERN =
  /^(?:api[-_]?key|access[-_]?token|token|secret|password|credential|private[-_]?key)$/iu;

const IdentifierSchema = z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH);
const CanvasTitleSchema = z.string().trim().min(1).max(160);

const CanvasNodeDataSchema = z
  .object({
    inputs: PortCollectionSchema.optional(),
    outputs: PortCollectionSchema.optional(),
    inputPorts: PortCollectionSchema.optional(),
    outputPorts: PortCollectionSchema.optional(),
  })
  .passthrough();

const CanvasNodeSchema = WorkflowNodeSchema.extend({
  data: CanvasNodeDataSchema.optional(),
});

const CanvasDrawingStrokeSchema = z
  .object({
    id: IdentifierSchema,
    color: z.string().regex(/^#[0-9a-f]{6}$/iu),
    width: z.number().finite().positive().max(96),
    points: z.array(PointSchema).min(1).max(4_000),
  })
  .strict();

export const CanvasGraphSchema = z
  .object({
    schemaVersion: z.literal(1),
    nodes: z.array(CanvasNodeSchema).max(1_000),
    edges: z.array(WorkflowEdgeSchema).max(5_000),
    drawings: z.array(CanvasDrawingStrokeSchema).max(1_000).optional(),
    viewport: PointSchema.extend({
      zoom: z.number().finite().positive().max(8),
    }),
  })
  .strict();

export const CreateCanvasRequestSchema = z
  .object({
    id: IdentifierSchema.optional(),
    title: CanvasTitleSchema.optional(),
    graph: CanvasGraphSchema,
  })
  .strict();

export const UpdateCanvasRequestSchema = z
  .object({
    title: CanvasTitleSchema.optional(),
    graph: CanvasGraphSchema,
  })
  .strict();

export { CreateRunRequestSchema };

export const ProviderKindSchema = z.enum(["openai", "runway", "rest", "fake"]);

interface JsonInspectionState {
  readonly seen: WeakSet<object>;
  entries: number;
}

interface JsonInspectionIssue {
  readonly path: Array<string | number>;
  readonly message: string;
}

function inspectJsonValue(
  value: unknown,
  path: Array<string | number>,
  depth: number,
  state: JsonInspectionState,
  insideHeaders = false,
): JsonInspectionIssue | null {
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return null;
  }
  if (typeof value === "string") {
    return value.length <= 65_536
      ? null
      : { path, message: "字符串长度不能超过 65536 个字符" };
  }
  if (typeof value !== "object") {
    return { path, message: "配置只能包含 JSON 值" };
  }
  if (depth > 20) {
    return { path, message: "配置嵌套层级不能超过 20 层" };
  }
  if (state.seen.has(value)) {
    return { path, message: "配置不能包含循环引用" };
  }
  state.seen.add(value);

  if (Array.isArray(value)) {
    if (insideHeaders) {
      return { path, message: "headers 必须是请求头对象" };
    }
    if (value.length > 1_000) {
      return { path, message: "配置数组最多包含 1000 项" };
    }
    for (let index = 0; index < value.length; index += 1) {
      const issue = inspectJsonValue(
        value[index],
        [...path, index],
        depth + 1,
        state,
        false,
      );
      if (issue) return issue;
    }
    return null;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return { path, message: "配置必须是普通 JSON 对象" };
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 1_000) {
    return { path, message: "单个配置对象最多包含 1000 个字段" };
  }
  state.entries += entries.length;
  if (state.entries > 10_000) {
    return { path, message: "配置字段总数不能超过 10000" };
  }

  for (const [key, child] of entries) {
    if (key.length > 256) {
      return { path: [...path, key], message: "配置字段名过长" };
    }
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      return {
        path: [...path, key],
        message: `配置中不允许使用 ${key} 字段`,
      };
    }
    if (
      insideHeaders &&
      (SENSITIVE_HEADER_NAMES.has(key.trim().toLowerCase()) ||
        SENSITIVE_HEADER_PATTERN.test(key))
    ) {
      return {
        path: [...path, key],
        message: `${key} 必须通过 apiKey 字段配置，不能以明文请求头保存`,
      };
    }
    if (!insideHeaders && SENSITIVE_CONFIG_KEY_PATTERN.test(key)) {
      return {
        path: [...path, key],
        message: `${key} must be stored through the encrypted apiKey field`,
      };
    }
    if (insideHeaders && typeof child !== "string") {
      return {
        path: [...path, key],
        message: "请求头值必须是字符串",
      };
    }
    const issue = inspectJsonValue(
      child,
      [...path, key],
      depth + 1,
      state,
      key.toLowerCase() === "headers",
    );
    if (issue) return issue;
  }
  return null;
}

export const SafeJsonObjectSchema = z
  .unknown()
  .superRefine((value, context) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "config 必须是 JSON 对象",
      });
      return;
    }
    const issue = inspectJsonValue(value, [], 0, {
      seen: new WeakSet<object>(),
      entries: 0,
    });
    if (issue) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: issue.path,
        message: issue.message,
      });
    }
  })
  .transform((value) => value as JsonObject);

export const ProviderConnectionRequestSchema = z
  .object({
    id: IdentifierSchema.optional(),
    name: z.string().trim().min(1).max(120),
    provider: ProviderKindSchema,
    apiKey: z.string().min(1).max(32_768).optional(),
    config: SafeJsonObjectSchema.optional(),
  })
  .strict();

const AgentChatContentPartSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      text: z.string().trim().min(1).max(16_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("image_url"),
      image_url: z
        .object({
          url: z.string().trim().min(1).max(7_500_000),
          detail: z.enum(["auto", "low", "high"]).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("input_audio"),
      input_audio: z
        .object({
          data: z.string().trim().min(1).max(7_500_000),
          format: z.enum(["wav", "mp3", "m4a", "webm"]),
        })
        .strict(),
    })
    .strict(),
]);

const AgentChatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.union([
      z.string().trim().min(1).max(16_000),
      z.array(AgentChatContentPartSchema).min(1).max(12),
    ]),
  })
  .strict();

export const AgentChatRequestSchema = z
  .object({
    connectionId: IdentifierSchema,
    model: IdentifierSchema,
    reasoningEffort: z
      .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
      .optional(),
    messages: z.array(AgentChatMessageSchema).min(1).max(40),
    context: z
      .object({
        label: z.string().trim().min(1).max(240),
        prompt: z.string().trim().max(16_000).optional(),
        assetKind: z.enum(["image", "video", "audio"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const total = value.messages.reduce(
      (sum, message) =>
        sum +
        (typeof message.content === "string"
          ? message.content.length
          : message.content.reduce(
              (parts, part) =>
                parts + (part.type === "text" ? part.text.length : 256),
              0,
            )),
      value.context?.prompt?.length ?? 0,
    );
    if (total > 64_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messages"],
        message: "对话上下文总长度不能超过 64000 个字符",
      });
    }
  });

export const RunsQuerySchema = z
  .object({
    canvasId: IdentifierSchema.optional(),
  })
  .strict();

export const RouteIdentifierSchema = IdentifierSchema;

export type ApiValidationResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly response: Response };

type JsonBodyResult =
  | { readonly success: true; readonly data: unknown }
  | { readonly success: false; readonly response: Response };

async function readRequestBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | "too_large"> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isSafeInteger(parsedLength) && parsedLength > maxBytes)
      return "too_large";
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        // Do not await cancel on a tee'd Request clone: the promise waits for
        // the other branch to finish, which would deadlock callers that still
        // need to verify/parse the original request.
        void reader.cancel();
        return "too_large";
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function requestBodyExceedsLimit(
  request: Request,
  maxBytes: number,
): Promise<boolean> {
  try {
    return (await readRequestBytes(request, maxBytes)) === "too_large";
  } catch {
    return true;
  }
}

export async function readJsonBody(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<JsonBodyResult> {
  let bytes: Uint8Array | "too_large";
  try {
    bytes = await readRequestBytes(request, maxBytes);
  } catch {
    return {
      success: false,
      response: Response.json(
        { error: "请求体必须是有效的 JSON" },
        { status: 400 },
      ),
    };
  }
  if (bytes === "too_large") {
    return {
      success: false,
      response: Response.json({ error: "请求体过大" }, { status: 413 }),
    };
  }
  try {
    const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/u, "");
    return {
      success: true,
      data: text.length === 0 ? undefined : JSON.parse(text),
    };
  } catch {
    return {
      success: false,
      response: Response.json(
        { error: "请求体必须是有效的 JSON" },
        { status: 400 },
      ),
    };
  }
}

function validationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
    message: issue.message,
  }));
}

export function validationError(
  error: z.ZodError,
  message = "请求参数无效",
): Response {
  return Response.json(
    { error: message, issues: validationIssues(error) },
    { status: 400 },
  );
}

export async function parseJsonRequest<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<ApiValidationResult<z.infer<TSchema>>> {
  const body = await readJsonBody(request, maxBytes);
  if (!body.success) return body;

  const parsed = schema.safeParse(body.data);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, response: validationError(parsed.error) };
}

export function validateCanvasGraphSemantics(
  graph: z.infer<typeof CanvasGraphSchema>,
): readonly GraphValidationIssue[] {
  return validateGraph(graph, {
    checkPorts: true,
    checkRequiredInputs: false,
  }).errors;
}

export function graphValidationError(
  issues: readonly GraphValidationIssue[],
): Response {
  return Response.json(
    {
      error: "画布图包含无效连接",
      issues: issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        ...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
        ...(issue.edgeId ? { edgeId: issue.edgeId } : {}),
        ...(issue.portId ? { portId: issue.portId } : {}),
        ...(issue.path ? { path: issue.path } : {}),
      })),
    },
    { status: 422 },
  );
}

export function searchParamsToObject(
  searchParams: URLSearchParams,
): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = Object.create(
    null,
  ) as Record<string, string | string[]>;
  for (const [key, value] of searchParams) {
    const current = values[key];
    values[key] =
      current === undefined
        ? value
        : Array.isArray(current)
          ? [...current, value]
          : [current, value];
  }
  return values;
}

export function parseRouteIdentifier(
  value: string,
  label: string,
): ApiValidationResult<string> {
  const parsed = RouteIdentifierSchema.safeParse(value);
  return parsed.success
    ? { success: true, data: parsed.data }
    : {
        success: false,
        response: validationError(parsed.error, `${label}无效`),
      };
}

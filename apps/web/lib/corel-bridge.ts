import { timingSafeEqual } from "node:crypto";
import { readJsonBody } from "./api-validation";

export const COREL_OPERATIONS = [
  "image.generate",
  "image.edit",
  "image.remove-background",
  "image.upscale",
  "image.ocr",
  "image.vectorize",
] as const;

export type CorelOperation = (typeof COREL_OPERATIONS)[number];

export interface CorelBridgeRequest {
  clientRequestId?: string;
  operation: CorelOperation;
  prompt?: string;
  referenceAssetIds?: string[];
  connectionId?: string;
  model?: string;
  parameters?: Record<string, string | number | boolean>;
}

const MAX_BODY_BYTES = 256_000;
const MAX_PROMPT_LENGTH = 16_000;
const MAX_ID_LENGTH = 256;
const MAX_REFERENCE_ASSETS = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
}

function boundedIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_REFERENCE_ASSETS) return [];
  return [
    ...new Set(
      value.flatMap((item) => {
        const id = text(item, MAX_ID_LENGTH);
        return id ? [id] : [];
      }),
    ),
  ];
}

function boundedParameters(
  value: unknown,
): Record<string, string | number | boolean> {
  if (!isRecord(value)) return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/u.test(key)) continue;
    if (typeof item === "boolean") result[key] = item;
    else if (typeof item === "number" && Number.isFinite(item))
      result[key] = item;
    else if (typeof item === "string" && item.length <= 256) result[key] = item;
  }
  return result;
}

export async function parseCorelBridgeRequest(
  request: Request,
): Promise<
  | { success: true; data: CorelBridgeRequest }
  | { success: false; response: Response }
> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES)
    return {
      success: false,
      response: Response.json({ error: "Corel 请求体过大" }, { status: 413 }),
    };
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.success) return body;
  const payload = body.data;
  if (!isRecord(payload))
    return {
      success: false,
      response: Response.json({ error: "Corel 请求格式无效" }, { status: 400 }),
    };
  const operation = payload.operation;
  if (
    typeof operation !== "string" ||
    !(COREL_OPERATIONS as readonly string[]).includes(operation)
  )
    return {
      success: false,
      response: Response.json(
        {
          error: `不支持的 Corel 操作，可选值：${COREL_OPERATIONS.join(", ")}`,
        },
        { status: 422 },
      ),
    };
  const prompt = text(payload.prompt, MAX_PROMPT_LENGTH);
  const referenceAssetIds = boundedIdList(payload.referenceAssetIds);
  if (operation === "image.edit" && referenceAssetIds.length === 0)
    return {
      success: false,
      response: Response.json(
        { error: "参考图改图至少需要一张参考图" },
        { status: 422 },
      ),
    };
  if (
    (operation === "image.generate" || operation === "image.edit") &&
    !prompt &&
    referenceAssetIds.length === 0
  )
    return {
      success: false,
      response: Response.json(
        { error: "生图或改图至少需要提示词或一张参考图" },
        { status: 422 },
      ),
    };
  return {
    success: true,
    data: {
      ...(text(payload.clientRequestId, MAX_ID_LENGTH)
        ? { clientRequestId: text(payload.clientRequestId, MAX_ID_LENGTH) }
        : {}),
      operation: operation as CorelOperation,
      ...(prompt ? { prompt } : {}),
      referenceAssetIds,
      ...(text(payload.connectionId, MAX_ID_LENGTH)
        ? { connectionId: text(payload.connectionId, MAX_ID_LENGTH) }
        : {}),
      ...(text(payload.model, MAX_ID_LENGTH)
        ? { model: text(payload.model, MAX_ID_LENGTH) }
        : {}),
      parameters: boundedParameters(payload.parameters),
    },
  };
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function corelBridgeAccess(request: Request): Response | null {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (
    host !== "127.0.0.1" &&
    host !== "localhost" &&
    host !== "::1" &&
    host !== "[::1]"
  )
    return Response.json(
      { error: "Corel 桥接接口只允许本机访问" },
      { status: 403 },
    );
  const configured =
    process.env.SUPER_CANVAS_COREL_TOKEN?.trim() ||
    process.env.COREL_BRIDGE_TOKEN?.trim();
  const supplied = request.headers.get("x-super-canvas-corel-token") ?? "";
  if (configured && !sameSecret(configured, supplied))
    return Response.json({ error: "Corel 桥接令牌无效" }, { status: 401 });
  return null;
}

export function corelBridgeCors(request: Request): Headers {
  const headers = new Headers({
    vary: "Origin, Access-Control-Request-Private-Network",
    "cache-control": "no-store",
  });
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      const configuredOrigin = process.env.PUBLIC_BASE_URL
        ? new URL(process.env.PUBLIC_BASE_URL).origin
        : new URL(request.url).origin;
      if (
        ["http:", "https:"].includes(parsed.protocol) &&
        parsed.origin === configuredOrigin
      ) {
        headers.set("access-control-allow-origin", origin);
        headers.set(
          "access-control-allow-methods",
          "GET, POST, DELETE, OPTIONS",
        );
        headers.set(
          "access-control-allow-headers",
          "Content-Type, X-Super-Canvas-Corel-Token",
        );
        headers.set("access-control-max-age", "600");
        if (
          request.headers.get("access-control-request-private-network") ===
          "true"
        )
          headers.set("access-control-allow-private-network", "true");
      }
    } catch {
      // Ignore malformed Origin; the normal loopback check still applies.
    }
  }
  return headers;
}

export function withCorelBridgeHeaders(
  request: Request,
  response: Response,
): Response {
  for (const [name, value] of corelBridgeCors(request))
    response.headers.set(name, value);
  return response;
}

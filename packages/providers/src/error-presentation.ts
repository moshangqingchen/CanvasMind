import type { ProviderOperation } from "./contracts.js";
import {
  ProviderHttpError,
  providerTransportErrorCode,
  type ProviderErrorKind,
  type ProviderRequestPhase,
} from "./http.js";

export interface ProviderErrorPresentation {
  message: string;
  type: string;
  code: string;
  api: string;
  docsUrl?: string;
}

export interface ProviderErrorContext {
  provider: string;
  operation?: ProviderOperation;
}

interface ExtractedProviderError {
  message?: string;
  code?: string;
  type?: string;
}

const OPENAI_ERROR_DOCS =
  "https://platform.openai.com/docs/guides/error-codes/api-errors";
const RUNWAY_ERROR_DOCS =
  "https://docs.dev.runwayml.com/errors/errors/";
const RUNWAY_TASK_FAILURE_DOCS =
  "https://docs.dev.runwayml.com/errors/task-failures/";

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function errorField(value: unknown): ExtractedProviderError {
  if (typeof value === "string") {
    const message = nonEmptyString(value);
    if (!message) return {};
    const code = /\b(SAFETY\.[A-Z0-9._-]+)\b/u.exec(message)?.[1];
    return { message, ...(code ? { code } : {}) };
  }
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const nested =
    record["error"] && record["error"] !== value
      ? errorField(record["error"])
      : {};
  const message =
    nonEmptyString(record["message"]) ??
    nonEmptyString(record["detail"]) ??
    nonEmptyString(record["failure"]) ??
    nested.message;
  const code =
    nonEmptyString(record["code"]) ??
    nonEmptyString(record["error_code"]) ??
    nested.code;
  const type = nonEmptyString(record["type"]) ?? nested.type;
  return {
    ...(message ? { message } : {}),
    ...(code ? { code } : {}),
    ...(type ? { type } : {}),
  };
}

function apiDetails(context: ProviderErrorContext): {
  api: string;
  docsUrl?: string;
} {
  if (context.provider === "openai") {
    return {
      api: context.operation?.startsWith("image")
        ? "OpenAI Images API"
        : "OpenAI API",
      docsUrl: OPENAI_ERROR_DOCS,
    };
  }
  if (context.provider === "runway") {
    return {
      api: "Runway 视频生成 API",
      docsUrl: RUNWAY_ERROR_DOCS,
    };
  }
  if (context.provider === "rest") return { api: "自定义 REST API" };
  if (context.provider === "fake") return { api: "本地模拟 API" };
  return { api: `${context.provider} API` };
}

function phaseLabel(phase?: ProviderRequestPhase): string {
  switch (phase) {
    case "connect":
      return "连接";
    case "submit":
      return "提交";
    case "poll":
      return "查询任务";
    case "cancel":
      return "取消任务";
    case "archive":
      return "下载结果";
    default:
      return "请求";
  }
}

function codeFor(
  extracted: ExtractedProviderError,
  status?: number,
  fallback?: string,
): string {
  return (
    extracted.code ??
    extracted.type ??
    (status === undefined ? undefined : `HTTP ${status}`) ??
    fallback ??
    "provider_error"
  );
}

function includesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function classifiedPresentation(input: {
  rawMessage?: string;
  extracted: ExtractedProviderError;
  kind?: ProviderErrorKind;
  phase?: ProviderRequestPhase;
  status?: number;
  context: ProviderErrorContext;
}): ProviderErrorPresentation {
  const { rawMessage, extracted, kind, phase, status, context } = input;
  const api = apiDetails(context);
  const searchable = [rawMessage, extracted.message, extracted.code, extracted.type]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  const embeddedStatus = /(?:http|gateway(?: error)?)\D{0,12}([45]\d{2})/iu.exec(
    searchable,
  )?.[1];
  const effectiveStatus =
    status ?? (embeddedStatus === undefined ? undefined : Number(embeddedStatus));
  let message: string;
  let type: string;
  let fallbackCode: string | undefined;

  if (
    includesAny(searchable, [
      "content moderation",
      "content_moderation",
      "content policy",
      "content_policy",
      "safety system",
      "safety violation",
      "safety.input",
      "safety.output",
      "rejected by content",
      "moderation_blocked",
    ])
  ) {
    message =
      "内容审核未通过：提示词或参考素材被内容安全系统拒绝，请修改后重新提交。";
    type = "内容审核错误";
    fallbackCode = "content_moderation";
  } else if (
    includesAny(searchable, [
      "insufficient_quota",
      "quota exceeded",
      "billing hard limit",
      "credits exhausted",
    ])
  ) {
    message = "API 额度不足，请检查账户余额、计费状态或用量上限。";
    type = "额度或计费错误";
    fallbackCode = "insufficient_quota";
  } else if (
    kind === "authentication" ||
    effectiveStatus === 401 ||
    effectiveStatus === 403 ||
    includesAny(searchable, [
      "api key is required",
      "api key is not configured",
      "invalid api key",
      "authentication failed",
    ])
  ) {
    message = "API 身份验证失败，请检查密钥、权限和接口地址。";
    type = "身份验证错误";
    fallbackCode = effectiveStatus === 403 ? "HTTP 403" : "HTTP 401";
  } else if (kind === "rate_limit" || effectiveStatus === 429) {
    message = "API 请求过于频繁或已达到用量限制，请稍后重试。";
    type = "速率限制错误";
    fallbackCode = "HTTP 429";
  } else if (kind === "timeout") {
    message = `API ${phaseLabel(phase)}超时，请稍后重试。`;
    type = "请求超时错误";
    fallbackCode = "request_timeout";
  } else if (kind === "network") {
    message = `API ${phaseLabel(phase)}时网络连接失败，请检查网络和接口地址。`;
    type = "网络连接错误";
    fallbackCode = "network_error";
  } else if (
    effectiveStatus === 502 ||
    effectiveStatus === 503 ||
    effectiveStatus === 504
  ) {
    message = `上游 API 暂时不可用（HTTP ${effectiveStatus}），请稍后重试。`;
    type = "网关或上游服务错误";
    fallbackCode = `HTTP ${effectiveStatus}`;
  } else if (effectiveStatus !== undefined && effectiveStatus >= 500) {
    message = `上游 API 服务异常（HTTP ${effectiveStatus}），请稍后重试。`;
    type = "供应商服务错误";
    fallbackCode = `HTTP ${effectiveStatus}`;
  } else if (kind === "invalid_response") {
    message = "API 返回的数据格式不符合接入约定，请检查响应映射。";
    type = "响应格式错误";
    fallbackCode = "invalid_response";
  } else if (
    kind === "invalid_request" ||
    (effectiveStatus !== undefined && effectiveStatus >= 400) ||
    includesAny(searchable, [
      "invalid request",
      "unsupported parameter",
      "prompt is required",
      "input image",
      "must be",
    ])
  ) {
    message = "API 拒绝了当前请求，请检查模型、参数、提示词和素材格式。";
    type = "请求参数错误";
    fallbackCode =
      effectiveStatus === undefined
        ? "invalid_request"
        : `HTTP ${effectiveStatus}`;
  } else if (searchable.includes("intentional fake provider failure")) {
    message = "模拟供应商按测试场景返回了生成失败。";
    type = "模拟测试错误";
    fallbackCode = "fake_provider_failure";
  } else {
    message =
      "供应商未能完成生成任务，请根据错误代码和对应 API 文档检查请求内容或服务状态。";
    type = "供应商生成错误";
    fallbackCode = "generation_failed";
  }

  const docsUrl =
    context.provider === "runway" && type === "内容审核错误"
      ? RUNWAY_TASK_FAILURE_DOCS
      : api.docsUrl;
  return {
    message,
    type,
    code: codeFor(extracted, effectiveStatus, fallbackCode),
    api: api.api,
    ...(docsUrl ? { docsUrl } : {}),
  };
}

export function presentProviderError(
  error: unknown,
  context: ProviderErrorContext,
): ProviderErrorPresentation {
  if (error instanceof ProviderHttpError) {
    const extracted = errorField(error.details.responseBody);
    const transportCode = providerTransportErrorCode(error.details.cause);
    return classifiedPresentation({
      rawMessage: error.message,
      extracted:
        extracted.code || !transportCode
          ? extracted
          : { ...extracted, code: transportCode },
      kind: error.details.kind,
      phase: error.details.phase,
      ...(error.details.status === undefined
        ? {}
        : { status: error.details.status }),
      context,
    });
  }
  const rawMessage = error instanceof Error ? error.message : String(error);
  return classifiedPresentation({
    rawMessage,
    extracted: errorField(rawMessage),
    context,
  });
}

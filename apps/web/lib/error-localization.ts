export interface LocalizedRunError {
  message: string;
  type?: string;
  code?: string;
  api?: string;
  docsUrl?: string;
}

interface ErrorContext {
  provider?: string | undefined;
}

const OPENAI_ERROR_DOCS =
  "https://platform.openai.com/docs/guides/error-codes/api-errors";
const RUNWAY_ERROR_DOCS =
  "https://docs.dev.runwayml.com/errors/errors/";
const RUNWAY_TASK_FAILURE_DOCS =
  "https://docs.dev.runwayml.com/errors/task-failures/";

function safeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeDocsUrl(value: unknown): string | undefined {
  const url = safeText(value);
  return url &&
    /^https:\/\/(?:platform\.openai\.com|developers\.openai\.com|docs\.dev\.runwayml\.com)\//u.test(
      url,
    )
    ? url
    : undefined;
}

function apiDetails(provider?: string): { api?: string; docsUrl?: string } {
  if (provider === "openai")
    return { api: "OpenAI Images API", docsUrl: OPENAI_ERROR_DOCS };
  if (provider === "runway")
    return { api: "Runway 视频生成 API", docsUrl: RUNWAY_ERROR_DOCS };
  if (provider === "rest") return { api: "自定义 REST API" };
  if (provider === "fake") return { api: "本地模拟 API" };
  return {};
}

function structuredError(value: unknown): LocalizedRunError | null {
  if (typeof value === "string") {
    const message = safeText(value);
    return message ? { message } : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const message = safeText(record.message);
  if (!message) return null;
  const type = safeText(record.type);
  const code = safeText(record.code);
  const api = safeText(record.api);
  const docsUrl = safeDocsUrl(record.docsUrl);
  return {
    message,
    ...(type ? { type } : {}),
    ...(code ? { code } : {}),
    ...(api ? { api } : {}),
    ...(docsUrl ? { docsUrl } : {}),
  };
}

export function localizeRunError(
  value: unknown,
  context: ErrorContext = {},
): LocalizedRunError | null {
  const error = structuredError(value);
  if (!error) return null;
  if (error.type || error.code || error.api) return error;

  const raw = error.message;
  const normalized = raw.toLowerCase();
  const api = apiDetails(context.provider);
  const embeddedStatus = /(?:http|gateway(?: error)?)\D{0,12}([45]\d{2})/iu.exec(
    normalized,
  )?.[1];
  const safetyCode = /\b(SAFETY\.[A-Z0-9._-]+)\b/u.exec(raw)?.[1];

  if (
    [
      "content moderation",
      "content_moderation",
      "content policy",
      "content_policy",
      "rejected by content",
      "safety.input",
      "safety.output",
    ].some((pattern) => normalized.includes(pattern))
  ) {
    const docsUrl =
      context.provider === "runway"
        ? RUNWAY_TASK_FAILURE_DOCS
        : api.docsUrl;
    return {
      message:
        "内容审核未通过：提示词或参考素材被内容安全系统拒绝，请修改后重新提交。",
      type: "内容审核错误",
      code: safetyCode ?? "content_moderation",
      ...(api.api ? { api: api.api } : {}),
      ...(docsUrl ? { docsUrl } : {}),
    };
  }

  if (embeddedStatus === "502" || embeddedStatus === "503" || embeddedStatus === "504") {
    return {
      message: `上游 API 暂时不可用（HTTP ${embeddedStatus}），请稍后重试。`,
      type: "网关或上游服务错误",
      code: `HTTP ${embeddedStatus}`,
      ...(api.api ? { api: api.api } : {}),
      ...(api.docsUrl ? { docsUrl: api.docsUrl } : {}),
    };
  }

  if (normalized.includes("system under load") || normalized.includes("overloaded")) {
    return {
      message: "上游 API 当前负载过高，请稍后重试。",
      type: "供应商服务错误",
      code: "provider_overloaded",
      ...(api.api ? { api: api.api } : {}),
      ...(api.docsUrl ? { docsUrl: api.docsUrl } : {}),
    };
  }

  if (
    normalized.includes("api key") ||
    normalized.includes("authentication") ||
    normalized.includes("unauthorized")
  ) {
    return {
      message: "API 身份验证失败，请检查密钥、权限和接口地址。",
      type: "身份验证错误",
      code: embeddedStatus ? `HTTP ${embeddedStatus}` : "authentication_error",
      ...(api.api ? { api: api.api } : {}),
      ...(api.docsUrl ? { docsUrl: api.docsUrl } : {}),
    };
  }

  if (normalized.includes("rate limit") || embeddedStatus === "429") {
    return {
      message: "API 请求过于频繁或已达到用量限制，请稍后重试。",
      type: "速率限制错误",
      code: "HTTP 429",
      ...(api.api ? { api: api.api } : {}),
      ...(api.docsUrl ? { docsUrl: api.docsUrl } : {}),
    };
  }

  if (normalized.includes("timed out") || normalized.includes("timeout")) {
    return {
      message: "API 请求超时，请稍后重试。",
      type: "请求超时错误",
      code: "request_timeout",
      ...(api.api ? { api: api.api } : {}),
      ...(api.docsUrl ? { docsUrl: api.docsUrl } : {}),
    };
  }

  if (/^[\x00-\x7f\s]+$/u.test(raw)) {
    return {
      message: "供应商返回了生成错误，请检查接入参数或稍后重试。",
      type: "供应商生成错误",
      code: embeddedStatus ? `HTTP ${embeddedStatus}` : "generation_failed",
      ...(api.api ? { api: api.api } : {}),
      ...(api.docsUrl ? { docsUrl: api.docsUrl } : {}),
    };
  }

  return error;
}

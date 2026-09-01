import {
  providerSupplierLabel,
  providerSupplierWebsite,
} from "@super-canvas/providers/suppliers";

export interface LocalizedRunError {
  message: string;
  type?: string;
  code?: string;
  api?: string;
  statusCode?: number;
  providerMessage?: string;
  docsUrl?: string;
  actionUrl?: string;
  actionLabel?: string;
}

interface ErrorContext {
  provider?: string | undefined;
  supplier?: string | undefined;
  supplierWebsiteUrl?: string | undefined;
}

const OPENAI_ERROR_DOCS =
  "https://platform.openai.com/docs/guides/error-codes/api-errors";
const WEAI_ERROR_DOCS = "https://docs.we-ai.cc/guides/image-generation.html";
const MIKOTO_GEMINI_ERROR_DOCS =
  "https://api.mikoto.vip/custom/0dcbf4f93685de2d";
const RUNWAY_ERROR_DOCS = "https://docs.dev.runwayml.com/errors/errors/";
const RUNWAY_TASK_FAILURE_DOCS =
  "https://docs.dev.runwayml.com/errors/task-failures/";

function safeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeHttpsUrl(value: unknown): string | undefined {
  const url = safeText(value);
  if (!url) return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function supplierApiLabel(label: string): string {
  return /\bAPI$/iu.test(label) ? label : `${label} API`;
}

function apiDetails(
  provider?: string,
  supplier?: string,
  configuredWebsite?: string,
): {
  api?: string;
  docsUrl?: string;
  supplierLabel?: string;
  websiteUrl?: string;
} {
  const supplierKey = supplier ?? provider;
  const supplierLabel = supplierKey
    ? providerSupplierLabel(supplierKey)
    : undefined;
  const websiteUrl =
    safeHttpsUrl(configuredWebsite) ?? providerSupplierWebsite(supplierKey);
  if (provider === "openai")
    return {
      api: "OpenAI Images API",
      docsUrl: OPENAI_ERROR_DOCS,
      supplierLabel,
      websiteUrl,
    };
  if (provider === "weai")
    return {
      api: supplier === "mikoto" ? "MikotoPro Gemini API" : "We-AI Images API",
      docsUrl:
        supplier === "mikoto" ? MIKOTO_GEMINI_ERROR_DOCS : WEAI_ERROR_DOCS,
      supplierLabel,
      websiteUrl,
    };
  if (provider === "runway")
    return {
      api: "Runway 视频生成 API",
      docsUrl: RUNWAY_ERROR_DOCS,
      supplierLabel,
      websiteUrl,
    };
  if (provider === "rest")
    return {
      api:
        supplier && supplierLabel
          ? supplierApiLabel(supplierLabel)
          : "自定义 REST API",
      ...(supplierLabel ? { supplierLabel } : {}),
      ...(websiteUrl ? { websiteUrl } : {}),
    };
  if (provider === "fake") return { api: "本地模拟 API", supplierLabel };
  return { supplierLabel, websiteUrl };
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
  const statusCode =
    typeof record.statusCode === "number" &&
    Number.isInteger(record.statusCode) &&
    record.statusCode >= 100 &&
    record.statusCode <= 599
      ? record.statusCode
      : undefined;
  const providerMessage = safeText(record.providerMessage);
  const docsUrl = safeHttpsUrl(record.docsUrl);
  const actionUrl = safeHttpsUrl(record.actionUrl);
  const actionLabel = safeText(record.actionLabel);
  return {
    message,
    ...(type ? { type } : {}),
    ...(code ? { code } : {}),
    ...(api ? { api } : {}),
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(providerMessage ? { providerMessage } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    ...(actionUrl ? { actionUrl } : {}),
    ...(actionUrl && actionLabel ? { actionLabel } : {}),
  };
}

function isBalanceError(value: string, embeddedStatus?: string): boolean {
  if (embeddedStatus === "402") return true;
  return [
    "insufficient_quota",
    "insufficient_user_quota",
    "insufficient_balance",
    "quota exceeded",
    "billing hard limit",
    "credits exhausted",
    "insufficient credit",
    "insufficient funds",
    "insufficient balance",
    "balance not enough",
    "not enough balance",
    "payment required",
    "余额不足",
    "余额不够",
    "额度不足",
    "可用额度不足",
    "账户欠费",
    "请充值",
    "充值后重试",
  ].some((pattern) => value.includes(pattern));
}

export function localizeRunError(
  value: unknown,
  context: ErrorContext = {},
): LocalizedRunError | null {
  let error = structuredError(value);
  if (!error) return null;

  if (
    context.provider === "weai" &&
    context.supplier === "mikoto" &&
    error.api === "We-AI Images API"
  ) {
    error = {
      ...error,
      api: "MikotoPro Gemini API",
      docsUrl: MIKOTO_GEMINI_ERROR_DOCS,
    };
  }

  const raw = error.message;
  const normalized = [raw, error.type, error.code]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
  const api = apiDetails(
    context.provider,
    context.supplier,
    context.supplierWebsiteUrl,
  );
  const embeddedStatus =
    /(?:http|gateway(?: error)?)\D{0,12}([45]\d{2})/iu.exec(normalized)?.[1];
  const safetyCode = /\b(SAFETY\.[A-Z0-9._-]+)\b/u.exec(raw)?.[1];

  if (
    error.code === "artifact_archive_failed" ||
    raw.includes("供应商任务已完成，但输出归档失败")
  ) {
    return {
      ...error,
      message: "图片已经生成完成，但下载到素材库时中断，可以直接取回现有结果。",
      type: "结果归档错误",
      code: "artifact_archive_failed",
    };
  }

  if (isBalanceError(normalized, embeddedStatus)) {
    const supplierLabel = api.supplierLabel ?? "供应商";
    return {
      ...error,
      message: `${supplierLabel}：账户余额或可用额度不足，请充值或检查计费状态后重试。`,
      type: "余额不足",
      code:
        error.code ??
        (embeddedStatus ? `HTTP ${embeddedStatus}` : "insufficient_quota"),
      ...(error.api ? {} : api.api ? { api: api.api } : {}),
      ...(error.actionUrl
        ? {}
        : api.websiteUrl
          ? {
              actionUrl: api.websiteUrl,
              actionLabel: `前往${supplierLabel}官网查看余额`,
            }
          : {}),
    };
  }

  if (error.type === "内容审核错误") return error;

  if (
    [
      "content moderation",
      "content_moderation",
      "content policy",
      "content_policy",
      "rejected by content",
      "safety.input",
      "safety.output",
      "image_safety",
      "input_safety",
      "output_safety",
    ].some((pattern) => normalized.includes(pattern))
  ) {
    const docsUrl =
      context.provider === "runway" ? RUNWAY_TASK_FAILURE_DOCS : api.docsUrl;
    return {
      ...error,
      message:
        "内容审核未通过：提示词或参考素材被内容安全系统拒绝，请修改后重新提交。",
      type: "内容审核错误",
      code: error.code ?? safetyCode ?? "content_moderation",
      ...(api.api ? { api: api.api } : {}),
      ...(docsUrl ? { docsUrl } : {}),
    };
  }

  if (error.type || error.code || error.api) return error;

  if (
    embeddedStatus === "502" ||
    embeddedStatus === "503" ||
    embeddedStatus === "504"
  ) {
    return {
      message: `上游 API 暂时不可用（HTTP ${embeddedStatus}），请稍后重试。`,
      type: "网关或上游服务错误",
      code: `HTTP ${embeddedStatus}`,
      ...(api.api ? { api: api.api } : {}),
      ...(api.docsUrl ? { docsUrl: api.docsUrl } : {}),
    };
  }

  if (
    normalized.includes("system under load") ||
    normalized.includes("overloaded")
  ) {
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

import type { ProviderOperation } from "./contracts.js";
import {
  ProviderHttpError,
  providerTransportErrorCode,
  type ProviderErrorKind,
  type ProviderRequestPhase,
} from "./http.js";
import { providerSupplierLabel, providerSupplierProfile } from "./suppliers.js";

export interface ProviderErrorPresentation {
  message: string;
  type: string;
  code: string;
  api: string;
  statusCode?: number;
  providerMessage?: string;
  docsUrl?: string;
  actionUrl?: string;
  actionLabel?: string;
}

export interface ProviderErrorContext {
  provider: string;
  operation?: ProviderOperation;
  supplier?: string;
  supplierWebsiteUrl?: string;
}

interface ExtractedProviderError {
  message?: string;
  code?: string;
  type?: string;
}

const OPENAI_ERROR_DOCS =
  "https://platform.openai.com/docs/guides/error-codes/api-errors";
const WEAI_ERROR_DOCS = "https://docs.we-ai.cc/guides/image-generation.html";
const MIKOTO_GEMINI_ERROR_DOCS =
  "https://api.mikoto.vip/custom/0dcbf4f93685de2d";
const RUNWAY_ERROR_DOCS = "https://docs.dev.runwayml.com/errors/errors/";
const RUNWAY_TASK_FAILURE_DOCS =
  "https://docs.dev.runwayml.com/errors/task-failures/";

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function safeProviderMessage(value: unknown): string | undefined {
  const message = nonEmptyString(value);
  if (!message) return undefined;
  const redacted = message
    .replace(/data:[^,\s;]+;base64,[a-z0-9+/=_-]+/giu, "data:[redacted]")
    .replace(/\b((?:bearer|basic))\s+[a-z0-9._~+/=-]+/giu, "$1 [redacted]")
    .replace(
      /((?:authorization|proxy-authorization|x-api-key|api[-_]?key|token|secret|password|credential|signature)\s*[:=]\s*)[^\s,;]+/giu,
      "$1[redacted]",
    )
    .trim();
  return redacted ? redacted.slice(0, 2_048) : undefined;
}

function supplierApiLabel(label: string): string {
  return /\bAPI$/iu.test(label) ? label : `${label} API`;
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
    nonEmptyString(record["msg"]) ??
    nonEmptyString(record["detail"]) ??
    nonEmptyString(record["reason"]) ??
    nonEmptyString(record["title"]) ??
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
  supplierLabel: string;
  websiteUrl?: string;
} {
  const explicitSupplier = context.supplier?.trim();
  const supplierKey = explicitSupplier || context.provider;
  const supplier = providerSupplierProfile(supplierKey);
  const supplierLabel = providerSupplierLabel(supplierKey);
  const configuredWebsite = nonEmptyString(context.supplierWebsiteUrl);
  const websiteUrl =
    configuredWebsite?.startsWith("https://") === true
      ? configuredWebsite
      : supplier?.websiteUrl;
  if (context.provider === "openai") {
    return {
      api: context.operation?.startsWith("image")
        ? "OpenAI Images API"
        : "OpenAI API",
      docsUrl: OPENAI_ERROR_DOCS,
      supplierLabel,
      ...(websiteUrl ? { websiteUrl } : {}),
    };
  }
  if (context.provider === "weai") {
    return {
      api:
        supplierKey === "mikoto" ? "MikotoPro Gemini API" : "We-AI Images API",
      docsUrl:
        supplierKey === "mikoto" ? MIKOTO_GEMINI_ERROR_DOCS : WEAI_ERROR_DOCS,
      supplierLabel,
      ...(websiteUrl ? { websiteUrl } : {}),
    };
  }
  if (context.provider === "runway") {
    return {
      api: "Runway 视频生成 API",
      docsUrl: RUNWAY_ERROR_DOCS,
      supplierLabel,
      ...(websiteUrl ? { websiteUrl } : {}),
    };
  }
  if (context.provider === "rest")
    return {
      api:
        explicitSupplier && supplier
          ? supplierApiLabel(supplierLabel)
          : "自定义 REST API",
      supplierLabel,
      ...(supplier?.errorDocsUrl ? { docsUrl: supplier.errorDocsUrl } : {}),
      ...(websiteUrl ? { websiteUrl } : {}),
    };
  if (context.provider === "fake")
    return { api: "本地模拟 API", supplierLabel };
  return {
    api: `${context.provider} API`,
    supplierLabel,
    ...(supplier?.errorDocsUrl ? { docsUrl: supplier.errorDocsUrl } : {}),
    ...(websiteUrl ? { websiteUrl } : {}),
  };
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
  const searchable = [
    rawMessage,
    extracted.message,
    extracted.code,
    extracted.type,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  const embeddedStatus =
    /(?:http|gateway(?: error)?)\D{0,12}([45]\d{2})/iu.exec(searchable)?.[1];
  const effectiveStatus =
    status ??
    (embeddedStatus === undefined ? undefined : Number(embeddedStatus));
  let message: string;
  let type: string;
  let fallbackCode: string | undefined;
  let balanceIssue = false;

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
      "image_safety",
      "input_safety",
      "output_safety",
      "rejected by content",
      "moderation_blocked",
    ])
  ) {
    message =
      "内容审核未通过：提示词或参考素材被内容安全系统拒绝，请修改后重新提交。";
    type = "内容审核错误";
    fallbackCode = "content_moderation";
  } else if (
    effectiveStatus === 402 ||
    includesAny(searchable, [
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
    ])
  ) {
    message = `${api.supplierLabel}：账户余额或可用额度不足，请充值或检查计费状态后重试。`;
    type = "余额不足";
    fallbackCode = "insufficient_quota";
    balanceIssue = true;
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
  } else if (
    includesAny(searchable, [
      "generation timed out",
      "generation timeout",
      "timed out after",
      "task timed out",
    ])
  ) {
    message = "供应商生成任务超时，未能返回结果，请稍后重试。";
    type = "供应商任务超时";
    fallbackCode = "generation_timeout";
  } else if (kind === "timeout") {
    message = `API ${phaseLabel(phase)}超时，请稍后重试。`;
    type = "请求超时错误";
    fallbackCode = "request_timeout";
  } else if (
    kind === "network" &&
    context.supplier === "cyberafei" &&
    extracted.code === "UND_ERR_SOCKET"
  ) {
    message =
      "赛博阿飞或其上游在生成过程中断开了长连接；鉴权和接口地址正常。请求可能已经被受理，请先核对供应商日志与扣费记录，不要立即重复提交。";
    type = "供应商连接中断";
    fallbackCode = "UND_ERR_SOCKET";
  } else if (kind === "network" && extracted.code === "EACCES") {
    message =
      "API 提交时本机拒绝了网络连接（EACCES）。请确认服务端已加载 HTTP_PROXY/HTTPS_PROXY 代理，或关闭 TUN/Fake-IP 直连后重试。";
    type = "本机网络权限错误";
    fallbackCode = "EACCES";
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
  } else if (
    includesAny(searchable, ["response_too_large", "provider response exceeds"])
  ) {
    message =
      "API 返回的图片数据超过了本地安全读取上限。请优先让供应商返回图片 URL，或降低单次生成张数后重试。";
    type = "响应过大";
    fallbackCode = "response_too_large";
  } else if (
    includesAny(searchable, [
      "empty_response",
      "provider returned an empty response",
    ])
  ) {
    message =
      "API 已返回成功状态，但响应内容为空。供应商可能已收到任务，请先核对任务和扣费记录，再决定是否重试。";
    type = "空响应错误";
    fallbackCode = "empty_response";
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
    ...(balanceIssue && api.websiteUrl
      ? {
          actionUrl: api.websiteUrl,
          actionLabel: `前往${api.supplierLabel}官网查看余额`,
        }
      : {}),
  };
}

export function presentProviderError(
  error: unknown,
  context: ProviderErrorContext,
): ProviderErrorPresentation {
  if (error instanceof ProviderHttpError) {
    const extracted = errorField(error.details.responseBody);
    const transportCode = providerTransportErrorCode(error.details.cause);
    const presentation = classifiedPresentation({
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
    const providerMessage = safeProviderMessage(extracted.message);
    const distinctProviderMessage =
      providerMessage &&
      providerMessage !== presentation.code &&
      providerMessage !== extracted.type
        ? providerMessage
        : undefined;
    return {
      ...presentation,
      ...(error.details.status === undefined
        ? {}
        : { statusCode: error.details.status }),
      ...(distinctProviderMessage
        ? { providerMessage: distinctProviderMessage }
        : {}),
    };
  }
  const rawMessage = error instanceof Error ? error.message : String(error);
  const extracted = errorField(rawMessage);
  const presentation = classifiedPresentation({
    rawMessage,
    extracted,
    context,
  });
  const providerMessage = safeProviderMessage(extracted.message);
  const shouldExposeProviderMessage =
    presentation.type === "供应商生成错误" ||
    presentation.type === "供应商任务超时";
  return {
    ...presentation,
    ...(shouldExposeProviderMessage &&
    providerMessage &&
    providerMessage !== presentation.message
      ? { providerMessage }
      : {}),
  };
}

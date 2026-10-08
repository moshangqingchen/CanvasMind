import type { ProviderOperation } from "./contracts.js";
import {
  ProviderHttpError,
  providerTransportErrorCode,
  type ProviderErrorKind,
  type ProviderRequestPhase,
} from "./http.js";
import { providerSupplierLabel, providerSupplierProfile } from "./suppliers.js";
import { extractProviderChargeEvidence, type ProviderChargeEvidence } from "./charge-evidence.js";
export { extractProviderChargeEvidence, type ProviderChargeEvidence } from "./charge-evidence.js";

export type ProviderFailureCategory = "insufficient_balance" | "local_network" | "network" |
  "supplier_capacity" | "supplier_error" | "authentication" | "rate_limit" |
  "invalid_request" | "content_policy" | "local_storage" | "unknown";

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
  transport?: NonNullable<ProviderHttpError["details"]["transport"]>;
  phase?: ProviderRequestPhase;
  retryable?: boolean;
  submissionMayHaveOccurred?: boolean;
  failureCategory?: ProviderFailureCategory;
  charge?: ProviderChargeEvidence;
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
    .replace(/\bhttps?:\/\/[^\s<>"']+/giu, raw => {
      try {
        const url = new URL(raw);
        let changed = false;
        if (url.username || url.password) {
          url.username = "[redacted]";
          url.password = "";
          changed = true;
        }
        for (const name of [...url.searchParams.keys()]) {
          if (/(?:authorization|api[-_]?key|(?:access|refresh)[_-]?token|token|secret|password|credential|signature|^key$|^sig$)$/iu.test(name)) {
            url.searchParams.set(name, "[redacted]");
            changed = true;
          }
        }
        return changed ? url.toString() : raw;
      } catch {
        return raw.replace(/(https?:\/\/)[^\s/]*@/giu, "$1[redacted]@");
      }
    })
    .replace(
      /(["']?(?:authorization|proxy-authorization|x-api-key|x-goog-api-key|xi-api-key|api[\s_-]?key|(?:access|refresh)[_-]?token|token|secret|password|credential|signature)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/giu,
      '$1"[redacted]"',
    )
    .replace(
      /((?:authorization|proxy-authorization|x-api-key|x-goog-api-key|xi-api-key|api[\s_-]?key|(?:access|refresh)[_-]?token|token|secret|password|credential|signature)\s*[:=]\s*)[^\s,;&]+/giu,
      "$1[redacted]",
    )
    .trim();
  return redacted ? redacted.slice(0, 2_048) : undefined;
}

function supplierApiLabel(label: string): string {
  return /\bAPI$/iu.test(label) ? label : `${label} API`;
}

function errorField(value: unknown, depth = 0): ExtractedProviderError {
  if (depth > 6) return {};
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
      ? errorField(record["error"], depth + 1)
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
    safeProviderMessage(extracted.code)?.slice(0, 256) ??
    safeProviderMessage(extracted.type)?.slice(0, 256) ??
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
  submissionMayHaveOccurred?: boolean;
  requestNotSent?: boolean;
  context: ProviderErrorContext;
}): ProviderErrorPresentation {
  const { rawMessage, extracted, kind, phase, status, submissionMayHaveOccurred, requestNotSent, context } = input;
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
  let failureCategory: ProviderFailureCategory = "unknown";
  const unavailableAccounts = includesAny(searchable, [
    "no available compatible accounts", "no_available_compatible_accounts", "no available accounts", "no_available_accounts",
    "no available account", "no_available_account", "account pool exhausted", "account_pool_empty", "no available channel",
    "no_available_channel", "no healthy upstream", "pool_unavailable", "无可用账号", "没有可用账号", "无可用账户",
    "供应商没号", "供应商无号", "号池已空", "账号池耗尽", "无可用通道", "没有可用渠道",
  ]) || /(?:upstream|supplier|channel|上游|供应商|通道|号池).{0,48}(?:insufficient.*(?:balance|quota|credit)|quota exhausted|余额不足|额度不足|账号耗尽)/u.test(searchable);
  const overloaded = includesAny(searchable, ["system under load", "model is overloaded", "adobe throttled", "overloaded", "capacity exhausted", "供应商繁忙", "供应商容量不足"]);
  const networkFailure = kind === "network" || ["UND_ERR_SOCKET", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETDOWN", "ENETUNREACH", "EADDRNOTAVAIL", "PROVIDER_NETWORK_DISCOVERY_FAILED"].includes(extracted.code ?? "") ||
    includesAny(searchable, ["fetch failed", "failed to fetch", "network request failed"]);

  if (/\bcontent_blocked_24h\b/u.test(searchable)) {
    message = "供应商提示：相同内容此前被上游拒绝，当前处于 24 小时拦截期。请检查内容是否符合平台规则，并联系供应商或等待限制结束；反复提交相同内容无法解决。";
    type = "内容被临时拦截";
    failureCategory = "content_policy";
    fallbackCode = "content_blocked_24h";
  } else if (
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
      "内容审核",
      "安全审核未通过",
      "内容不合规",
    ])
  ) {
    message =
      "内容审核未通过：提示词或参考素材被内容安全系统拒绝，请修改后重新提交。";
    type = "内容审核错误";
    failureCategory = "content_policy";
    fallbackCode = "content_moderation";
  } else if (unavailableAccounts) {
    message = "供应商当前没有适用于所选模型或线路的可用账号，" +
      (phase === "submit" && submissionMayHaveOccurred === true
        ? "本次提交结果未知。请先核对原任务和扣费记录，不要重复提交。"
        : "未能完成本次生成。请等待供应商恢复或核对该线路状态；本次费用仍需核对。");
    type = "供应商无可用兼容账号";
    failureCategory = "supplier_capacity";
    fallbackCode = "provider_no_compatible_accounts";
  } else if (overloaded) {
    message = phase === "submit" && submissionMayHaveOccurred === true
      ? "供应商模型当前繁忙，本次提交结果未知。请先核对原任务和扣费记录，不要重复提交。"
      : "供应商模型当前繁忙，未能完成本次生成，请稍后重试。";
    type = "供应商繁忙";
    failureCategory = "supplier_capacity";
    fallbackCode = "provider_overloaded";
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
    failureCategory = "insufficient_balance";
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
      "invalid_api_key",
      "invalid access token",
      "unauthorized",
    ])
  ) {
    message = "API 身份验证失败，请检查密钥、权限和接口地址。";
    type = "身份验证错误";
    failureCategory = "authentication";
    fallbackCode = effectiveStatus === 403 ? "HTTP 403" : "HTTP 401";
  } else if (kind === "rate_limit" || effectiveStatus === 429 || includesAny(searchable, ["rate_limit", "rate limit", "too many requests", "请求过于频繁"])) {
    message = "API 请求过于频繁或已达到用量限制，请稍后重试。";
    type = "速率限制错误";
    failureCategory = "rate_limit";
    fallbackCode = "HTTP 429";
  } else if (effectiveStatus === 524) {
    message =
      "请求链路中的网关等待上游响应超时（HTTP 524）。" +
      (phase === "submit" && submissionMayHaveOccurred !== false
        ? "请求可能仍在生成或已扣费，请先核对供应商任务与扣费记录，不要重复提交。"
        : "请稍后核对供应商服务或原任务状态。") +
      "延长本地等待时间无法解除此网关限制。";
    type = "请求链路网关超时";
    failureCategory = "network";
    fallbackCode = "HTTP 524";
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
    failureCategory = "supplier_error";
    fallbackCode = "generation_timeout";
  } else if (kind === "timeout") {
    message = phase === "submit" && submissionMayHaveOccurred !== false
      ? "API 提交超时，任务结果尚未确认。请先核对原任务和扣费记录，不要重复提交。"
      : `API ${phaseLabel(phase)}超时，请检查连接后恢复原操作。`;
    type = "请求超时错误";
    failureCategory = "network";
    fallbackCode = "request_timeout";
  } else if (networkFailure && extracted.code === "UND_ERR_SOCKET") {
    message = phase === "submit"
      ? "API 提交过程中连接中断，未收到完整响应。供应商可能仍在生成或已扣费，请先核对原任务和账单，不要重复提交。"
      : `API ${phaseLabel(phase)}时连接中断，未收到完整响应。请核对网络和供应商服务。`;
    type = "连接中断";
    failureCategory = "network";
    fallbackCode = "UND_ERR_SOCKET";
  } else if (networkFailure && extracted.code === "PROVIDER_NETWORK_DISCOVERY_FAILED") {
    message = phase === "submit"
      ? submissionMayHaveOccurred === false && requestNotSent === true
        ? "暂时无法确认可用的生图连接，尚未向供应商提交请求。请检查网络后重试。"
        : "生图连接异常，本次提交结果尚未确认。请先核对原任务和扣费记录，不要重复提交。"
      : "暂时无法确认可用连接，请检查网络后恢复原任务操作并核对供应商状态。";
    type = "连接准备失败";
    failureCategory = "network";
    fallbackCode = "PROVIDER_NETWORK_DISCOVERY_FAILED";
  } else if (kind === "network" && ["EACCES", "EPERM", "ENETDOWN", "ENETUNREACH", "EADDRNOTAVAIL"].includes(extracted.code ?? "") &&
    (requestNotSent === true || submissionMayHaveOccurred === false)) {
    message =
      `API ${phaseLabel(phase)}前，本机未能建立可用网络连接（${extracted.code}）。请检查 HTTP_PROXY/HTTPS_PROXY、网卡和网络权限后重试。`;
    type = "本机网络权限错误";
    failureCategory = "local_network";
    fallbackCode = extracted.code;
  } else if (networkFailure) {
    message = `API ${phaseLabel(phase)}时网络连接失败，请检查网络和接口地址。`;
    type = "网络连接错误";
    failureCategory = "network";
    fallbackCode = "network_error";
  } else if (
    effectiveStatus === 502 ||
    effectiveStatus === 503 ||
    effectiveStatus === 504
  ) {
    message = `上游 API 暂时不可用（HTTP ${effectiveStatus}）` +
      (phase === "submit" && submissionMayHaveOccurred !== false
        ? "，本次提交结果未知。请先核对原任务和扣费记录，不要重复提交。"
        : phase === "poll"
          ? "，原任务查询暂时中断。请恢复原任务查询并核对供应商状态。"
          : "。请核对供应商状态和原任务记录，再决定是否重新生成。");
    type = "网关或上游服务错误";
    failureCategory = "supplier_error";
    fallbackCode = `HTTP ${effectiveStatus}`;
  } else if (effectiveStatus !== undefined && effectiveStatus >= 500) {
    message = `上游 API 服务异常（HTTP ${effectiveStatus}），请稍后重试。`;
    type = "供应商服务错误";
    failureCategory = "supplier_error";
    fallbackCode = `HTTP ${effectiveStatus}`;
  } else if (
    includesAny(searchable, ["response_too_large", "provider response exceeds"])
  ) {
    message =
      "API 返回的图片数据超过了本地安全读取上限。请优先让供应商返回图片 URL，或降低单次生成张数后重试。";
    type = "响应过大";
    failureCategory = "supplier_error";
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
    failureCategory = "supplier_error";
    fallbackCode = "empty_response";
  } else if (kind === "invalid_response") {
    message = "API 返回的数据格式不符合接入约定，请检查响应映射。";
    type = "响应格式错误";
    failureCategory = "supplier_error";
    fallbackCode = "invalid_response";
  } else if (["ENOSPC", "EDQUOT", "EROFS", "EIO"].includes(extracted.code ?? "") || includesAny(searchable, ["no space left on device", "disk full", "磁盘空间不足", "本地存储失败"])) {
    message = "本地保存失败：请检查磁盘空间和存储目录权限。已生成的任务请优先重新保存结果，避免重复生成。";
    type = "本地保存错误";
    failureCategory = "local_storage";
    fallbackCode = extracted.code ?? "local_storage_error";
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
    failureCategory = "invalid_request";
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
    failureCategory = kind === "provider" || extracted.code || extracted.type ? "supplier_error" : "unknown";
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
    failureCategory,
    charge: { status: "unknown", source: "unconfirmed" },
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
    const transportCode = providerTransportErrorCode(error.details.cause) ?? error.details.transport?.errorCode;
    const presentation = classifiedPresentation({
      rawMessage: error.message,
      extracted:
        extracted.code || !transportCode
          ? extracted
          : { ...extracted, code: transportCode },
      kind: error.details.kind,
      phase: error.details.phase,
      submissionMayHaveOccurred: error.details.submissionMayHaveOccurred,
      ...(error.details.requestNotSent ? { requestNotSent: true } : {}),
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
    let charge = extractProviderChargeEvidence(error.details.responseBody);
    const definitelyBeforeSubmission = error.details.requestNotSent === true ||
      ["PROVIDER_NETWORK_DISCOVERY_FAILED", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "EADDRNOTAVAIL", "UND_ERR_CONNECT_TIMEOUT", "EACCES", "EPERM"].includes(transportCode ?? "");
    if (charge.status === "unknown" && error.details.phase === "submit" &&
      error.details.submissionMayHaveOccurred === false && error.details.status === undefined &&
      error.details.responseBody === undefined && definitelyBeforeSubmission) {
      charge = { status: "not_charged", source: "not_submitted" };
    }
    return {
      ...presentation,
      charge,
      phase: error.details.phase,
      retryable: error.details.retryable,
      submissionMayHaveOccurred: error.details.submissionMayHaveOccurred,
      ...(error.details.transport ? { transport: error.details.transport } : {}),
      ...(error.details.status === undefined
        ? {}
        : { statusCode: error.details.status }),
      ...(distinctProviderMessage
        ? { providerMessage: distinctProviderMessage }
        : {}),
    };
  }
  const extracted = errorField(typeof error === "object" && error !== null ? error : String(error));
  const rawMessage = error instanceof Error ? error.message : extracted.message ?? String(error);
  const presentation = classifiedPresentation({
    rawMessage,
    extracted,
    context,
  });
  const providerMessage = safeProviderMessage(extracted.message);
  const shouldExposeProviderMessage =
    presentation.type === "供应商生成错误" ||
    presentation.type === "供应商无可用兼容账号" ||
    presentation.type === "供应商繁忙" ||
    presentation.type === "供应商任务超时";
  return {
    ...presentation,
    charge: extractProviderChargeEvidence(error),
    ...(shouldExposeProviderMessage &&
    providerMessage &&
    providerMessage !== presentation.message
      ? { providerMessage }
      : {}),
  };
}

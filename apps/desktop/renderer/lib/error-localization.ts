import {
  providerSupplierLabel,
  providerSupplierWebsite,
} from "@super-canvas/providers/suppliers";
import type { ProviderErrorPresentation } from "@super-canvas/providers";

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
  phase?: ProviderErrorPresentation["phase"];
  retryable?: boolean;
  submissionMayHaveOccurred?: boolean;
  transport?: ProviderErrorPresentation["transport"];
  failureCategory?: ProviderErrorPresentation["failureCategory"];
  charge?: ProviderErrorPresentation["charge"];
}

interface ErrorContext {
  provider?: string | undefined;
  supplier?: string | undefined;
  supplierWebsiteUrl?: string | undefined;
  status?: string | undefined;
  providerTaskStatus?: string | undefined;
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

/** Retain diagnostic evidence, never arbitrary response/header fields from old records. */
function safeTransport(value: unknown): LocalizedRunError["transport"] {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  if ((source.stage !== "awaiting_headers" && source.stage !== "reading_body") ||
      typeof source.elapsedMs !== "number" || !Number.isFinite(source.elapsedMs) || source.elapsedMs < 0 ||
      typeof source.responseBytes !== "number" || !Number.isSafeInteger(source.responseBytes) || source.responseBytes < 0) return undefined;
  const result: NonNullable<LocalizedRunError["transport"]> = {
    stage: source.stage, elapsedMs: source.elapsedMs, responseBytes: source.responseBytes,
  };
  for (const key of ["socketBytesRead", "socketBytesWritten", "localPort", "remotePort"] as const) {
    const count = source[key];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) result[key] = count;
  }
  for (const key of ["localAddress", "remoteAddress"] as const) {
    const address = safeText(source[key]);
    if (address && address.length <= 64 && /^[0-9a-f:.]+$/iu.test(address)) result[key] = address;
  }
  const errorCode = safeText(source.errorCode);
  if (errorCode && /^[A-Z0-9_]{1,80}$/u.test(errorCode)) result.errorCode = errorCode;
  if (["physical-direct", "system", "system-fake-ip", "explicit-proxy"].includes(String(source.route)))
    result.route = source.route as NonNullable<typeof result.route>;
  if (["normal_dns", "transport_constraints", "physical_tls_unreachable"].includes(String(source.fallbackReason)))
    result.fallbackReason = source.fallbackReason as NonNullable<typeof result.fallbackReason>;
  return result;
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
  const phase = ["connect", "submit", "poll", "cancel", "archive"].includes(String(record.phase))
    ? record.phase as LocalizedRunError["phase"] : undefined;
  const transport = safeTransport(record.transport);
  const categories = ["insufficient_balance", "local_network", "network", "supplier_capacity", "supplier_error", "authentication", "rate_limit", "invalid_request", "content_policy", "local_storage", "unknown"];
  const failureCategory = categories.includes(String(record.failureCategory))
    ? record.failureCategory as LocalizedRunError["failureCategory"] : undefined;
  const charge = safeCharge(record.charge);
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
    ...(phase ? { phase } : {}),
    ...(typeof record.retryable === "boolean" ? { retryable: record.retryable } : {}),
    ...(typeof record.submissionMayHaveOccurred === "boolean" ? { submissionMayHaveOccurred: record.submissionMayHaveOccurred } : {}),
    ...(transport ? { transport } : {}),
    ...(failureCategory ? { failureCategory } : {}),
    ...(charge ? { charge } : {}),
  };
}

/** Stored drafts may predate the server whitelist; accept billing evidence only. */
function safeCharge(value: unknown): LocalizedRunError["charge"] {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!["charged", "not_charged", "refunded", "unknown"].includes(String(record.status)) ||
      !["provider_response", "not_submitted", "unconfirmed"].includes(String(record.source))) return undefined;
  if (record.status === "unknown" || record.source === "unconfirmed" ||
      (record.source === "not_submitted" && record.status !== "not_charged"))
    return { status: "unknown", source: "unconfirmed" };
  const amount = typeof record.amount === "number" && Number.isFinite(record.amount) && record.amount >= 0
    ? record.amount : undefined;
  if ((record.status === "not_charged" && record.amount !== undefined && amount !== 0) ||
      (record.status === "charged" && amount === 0)) return { status: "unknown", source: "unconfirmed" };
  const currency = typeof record.currency === "string" && /^(?:[A-Za-z][A-Za-z0-9_-]{0,15}|[¥￥$€£]|元|人民币|积分|点数|额度)$/u.test(record.currency)
    ? record.currency : undefined;
  return {
    status: record.status as NonNullable<LocalizedRunError["charge"]>["status"],
    source: record.source as NonNullable<LocalizedRunError["charge"]>["source"],
    ...(amount === undefined ? {} : { amount }),
    ...(currency ? { currency } : {}),
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
  const normalized = [raw, error.type, error.code, error.providerMessage]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
  const api = apiDetails(
    context.provider,
    context.supplier,
    context.supplierWebsiteUrl,
  );
  const embeddedStatus = error.statusCode === undefined
    ? /(?:http|gateway(?: error)?)\D{0,12}([45]\d{2})/iu.exec(normalized)?.[1]
    : String(error.statusCode);
  const safetyCode = /\b(SAFETY\.[A-Z0-9._-]+)\b/u.exec(raw)?.[1];

  if (
    error.code === "artifact_archive_failed" ||
    raw.includes("供应商任务已完成，但输出归档失败")
  ) {
    const privateAddressReason = "Provider output URL resolves to a private address";
    const archiveReason = raw.replace(/^供应商任务已完成，但输出归档失败[：:]\s*/u, "");
    const privateAddressBlocked = [archiveReason, error.providerMessage]
      .some((reason) => reason?.toLowerCase().includes(privateAddressReason.toLowerCase()));
    return {
      ...error,
      message: privateAddressBlocked
        ? "图片已生成，但原图链接解析到了内网或保留地址，下载被安全检查拦截。请检查代理或 DNS 设置，修复后取回现有结果。"
        : "图片已生成，但保存到素材库失败，可尝试取回现有结果。",
      type: "结果归档错误",
      code: "artifact_archive_failed",
      // Expose only this known diagnostic, never arbitrary URLs or signed data
      // from an older archive message. Existing provider evidence stays intact.
      ...(privateAddressBlocked && !error.providerMessage
        ? { providerMessage: privateAddressReason }
        : {}),
    };
  }

  // Public error snapshots omit action URLs; restore this known supplier action
  // before returning an already localized, explicitly classified balance error.
  if (error.failureCategory === "insufficient_balance" && !error.actionUrl && api.websiteUrl) {
    error = {
      ...error,
      actionUrl: api.websiteUrl,
      actionLabel: `前往${api.supplierLabel ?? "供应商"}官网查看余额`,
    };
  }

  // A structured server classification is stronger evidence than words quoted
  // in providerMessage (for example an upstream account's insufficient balance).
  if (error.failureCategory && error.failureCategory !== "unknown") {
    if (/[\u3400-\u9fff]/u.test(raw)) return error;
    const descriptions: Record<Exclude<NonNullable<LocalizedRunError["failureCategory"]>, "unknown">, [string, string]> = {
      insufficient_balance: ["账户余额或可用额度不足，请检查所选渠道的余额与计费状态。", "余额不足"],
      local_network: ["本机网络连接未建立，请检查本机网络、代理或权限设置，并核对原任务状态。", "本机网络连接异常"],
      network: ["网络连接未正常完成，暂不能确认问题发生在本机、代理还是供应商侧。请核对原任务状态和账单。", "网络链路异常"],
      supplier_capacity: ["供应商当前没有足够的可用账号或处理容量，未能完成本次生成。请核对供应商状态、原任务和账单。", "供应商容量不足"],
      supplier_error: ["供应商未能完成本次生成。请核对供应商状态、原任务和账单，再决定是否重新生成。", "供应商生成错误"],
      authentication: ["API 身份验证失败，请检查密钥、权限和接口地址，并核对原任务。", "身份验证错误"],
      rate_limit: ["请求频率或并发超过限制。请降低并发，并核对原任务状态后再决定是否重新生成。", "速率限制错误"],
      invalid_request: ["请求参数不符合所选模型的要求，请根据原始错误核对参数和素材。", "请求参数错误"],
      content_policy: ["内容审核未通过，请根据审核原因修改提示词或参考素材。", "内容审核错误"],
      local_storage: ["本地保存未完成，请检查磁盘空间和保存目录权限，并核对原任务结果。", "本地保存错误"],
    };
    const [message, type] = descriptions[error.failureCategory];
    return { ...error, message, type: error.type ?? type };
  }

  const upstreamCapacity = /(?:upstream|account[_ ]?pool|channel|上游|号池|账号池|通道)[\s\S]{0,48}(?:insufficient[\s\S]{0,24}(?:balance|quota|credit)|quota exhausted|余额不足|额度不足|账号耗尽)/iu.test(normalized);

  if (isBalanceError(normalized, embeddedStatus) && !upstreamCapacity) {
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

  if (upstreamCapacity || ["no available compatible accounts", "no_available_compatible_accounts"].some(pattern => normalized.includes(pattern)) ||
      error.code === "provider_no_compatible_accounts") {
    const uncertain = error.submissionMayHaveOccurred === true ||
      (error.phase === "submit" && embeddedStatus !== undefined && Number(embeddedStatus) >= 500) ||
      (context.status === "needs_attention" && error.phase !== "poll" && context.providerTaskStatus !== "failed");
    return {
      ...error,
      message: "供应商当前没有适用于所选模型或线路的可用账号，" +
        (uncertain
          ? "本次提交结果未知。请先核对原任务和扣费记录，不要重复提交。"
          : "未能完成本次生成。请等待供应商恢复或核对该线路状态；本次费用仍需核对。"),
      type: "供应商无可用兼容账号",
      code: error.code && error.code !== "generation_failed" ? error.code : "provider_no_compatible_accounts",
      ...(error.api ? {} : api.api ? { api: api.api } : {}),
      ...(error.docsUrl ? {} : api.docsUrl ? { docsUrl: api.docsUrl } : {}),
      ...(error.providerMessage ? {} : /no[_ ]available[_ ]compatible[_ ]accounts/iu.test(raw) ? { providerMessage: raw } : {}),
    };
  }

  if (error.type === "内容审核错误") return error;

  if (error.code === "UND_ERR_SOCKET" && raw === "API 提交时网络连接失败，请检查网络和接口地址。") {
    return {
      ...error,
      message: "API 提交过程中连接中断，未收到完整响应。供应商可能仍在生成或已扣费，请先核对原任务和账单，不要重复提交。",
      type: "连接中断",
    };
  }

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

  if (
    normalized.includes("system under load") ||
    normalized.includes("overloaded") ||
    normalized.includes("adobe throttled")
  ) {
    return {
      ...error,
      message: error.submissionMayHaveOccurred === true ||
        (context.status === "needs_attention" && error.phase !== "poll" && context.providerTaskStatus !== "failed")
        ? "供应商模型当前繁忙，本次提交结果未知。请先核对原任务和扣费记录，不要重复提交。"
        : "供应商模型当前繁忙，未能完成本次生成，请稍后重试。",
      type: "供应商繁忙",
      code: error.code && error.code !== "generation_failed" ? error.code : "provider_overloaded",
      ...(error.api ? {} : api.api ? { api: api.api } : {}),
      ...(error.docsUrl ? {} : api.docsUrl ? { docsUrl: api.docsUrl } : {}),
    };
  }

  if (["502", "503", "504"].includes(embeddedStatus ?? "")) {
    const uncertain = error.submissionMayHaveOccurred === true ||
      (error.phase === "submit" && error.submissionMayHaveOccurred !== false) ||
      (context.status === "needs_attention" && error.phase !== "poll" && context.providerTaskStatus !== "failed");
    const queryInterrupted = error.phase === "poll";
    const confirmedFailure = context.providerTaskStatus === "failed";
    return {
      ...error,
      message: `上游 API 暂时不可用（HTTP ${embeddedStatus}）` +
        (uncertain
          ? "，本次提交结果未知。请先核对原任务和扣费记录，不要重复提交。"
          : queryInterrupted
            ? "，原任务查询暂时中断。请恢复原任务查询并核对供应商状态。"
            : confirmedFailure
              ? "，供应商已将原任务标记为生成失败。请核对原任务和扣费记录，再决定是否重新生成。"
              : "。请核对供应商状态和原任务记录，再决定是否重新生成。"),
      type: "网关或上游服务错误",
      code: error.code ?? `HTTP ${embeddedStatus}`,
      ...(error.api ? {} : api.api ? { api: api.api } : {}),
      ...(error.docsUrl ? {} : api.docsUrl ? { docsUrl: api.docsUrl } : {}),
    };
  }

  if (error.type || error.code || error.api) return error;

  if (
    normalized.includes("api key") ||
    normalized.includes("authentication") ||
    normalized.includes("unauthorized")
  ) {
    return {
      ...error,
      message: "API 身份验证失败，请检查密钥、权限和接口地址。",
      type: "身份验证错误",
      code: embeddedStatus ? `HTTP ${embeddedStatus}` : "authentication_error",
      ...(api.api ? { api: api.api } : {}),
      ...(api.docsUrl ? { docsUrl: api.docsUrl } : {}),
    };
  }

  if (normalized.includes("rate limit") || embeddedStatus === "429") {
    return {
      ...error,
      message: "API 请求过于频繁或已达到用量限制，请稍后重试。",
      type: "速率限制错误",
      code: "HTTP 429",
      ...(api.api ? { api: api.api } : {}),
      ...(api.docsUrl ? { docsUrl: api.docsUrl } : {}),
    };
  }

  if (normalized.includes("timed out") || normalized.includes("timeout")) {
    return {
      ...error,
      message: "API 请求超时，请稍后重试。",
      type: "请求超时错误",
      code: "request_timeout",
      ...(api.api ? { api: api.api } : {}),
      ...(api.docsUrl ? { docsUrl: api.docsUrl } : {}),
    };
  }

  if (/^[\x00-\x7f\s]+$/u.test(raw)) {
    return {
      ...error,
      message: "供应商返回了生成错误，请检查接入参数或稍后重试。",
      type: "供应商生成错误",
      code: embeddedStatus ? `HTTP ${embeddedStatus}` : "generation_failed",
      ...(api.api ? { api: api.api } : {}),
      ...(api.docsUrl ? { docsUrl: api.docsUrl } : {}),
    };
  }

  return error;
}

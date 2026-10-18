import type { LocalizedRunError } from "./error-localization";

type FeedbackKind = "references" | "moderation" | "quota" | "balance" | "authentication" | "timeout" | "busy" | "capacity" | "network" | "parameters" | "storage" | "supplier" | "unknown";

const messages: Record<Exclude<FeedbackKind, "unknown">, { cause: string; action: string }> = {
  references: { cause: "参考素材准备失败，公网原图读取未完成；本次尚未提交生成。", action: "本次未产生生成费用。请稍后重试，程序会先重新检查素材链接。" },
  moderation: { cause: "提示词或参考素材未通过内容审核。", action: "调整提示词或素材，并查看供应商的审核说明。" },
  quota: { cause: "当前渠道的可用额度已用完。", action: "检查所选分组的额度和用量限制。" },
  balance: { cause: "当前渠道的账户余额不足。", action: "检查所选渠道的余额和计费账户。" },
  authentication: { cause: "当前密钥无效，或没有访问该模型和分组的权限。", action: "检查密钥、模型权限和接口地址。" },
  timeout: { cause: "等待响应超时，暂时无法确认原任务是否完成。", action: "先核对原任务状态和账单，再决定是否重新生成。" },
  busy: { cause: "供应商繁忙，或当前请求频率、并发超过限制。", action: "等待服务恢复或降低并发，先核对原任务。" },
  capacity: { cause: "供应商当前没有可用的上游资源。", action: "先核对原任务状态和账单，再考虑稍后重试或更换供应商。" },
  network: { cause: "网络连接中断，暂时无法确认原任务状态。", action: "检查网络与代理，并核对原任务。" },
  parameters: { cause: "请求中的参数或参考素材不符合要求。", action: "根据错误详情检查尺寸、数量和参考素材。" },
  storage: { cause: "结果下载或本地保存遇到问题。", action: "检查磁盘和目录权限，优先取回已有结果。" },
  supplier: { cause: "供应商返回了服务异常。", action: "查看原始错误，向供应商提供任务编号排查。" },
};

/** Require the recorded local non-submission evidence; a missing task ID is insufficient. */
export function isUnsubmittedReferenceFailure(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const error = value as Record<string, unknown>;
  const charge = error.charge && typeof error.charge === "object" && !Array.isArray(error.charge)
    ? error.charge as Record<string, unknown> : undefined;
  return error.code === "LOCAL_REFERENCE_ASSET_PREFLIGHT_FAILED" && error.source === "local_validation" &&
    error.submissionMayHaveOccurred === false && charge?.status === "not_charged" && charge.source === "not_submitted" &&
    (charge.amount === undefined || charge.amount === 0);
}

function classifyText(text: string): FeedbackKind | undefined {
  if (/content[_ -]?(?:policy|moderation|blocked|filter)|moderation[_ -]?(?:blocked|failed)|image[_ -]?safety|safety[_ -](?:violation|blocked|filter|system)|nsfw|内容审核|内容政策|审核未通过|敏感内容|违规/iu.test(text)) return "moderation";
  if (/insufficient[_ -]?quota|quota[_ -]?(?:exceeded|exhausted)|usage[_ -]?limit|额度不足|额度用完|配额|exceeded.{0,20}quota/iu.test(text)) return "quota";
  if (/insufficient[_ -]?balance|balance[_ -]?(?:not[_ -]?enough|insufficient)|余额不足|余额不够|欠费/iu.test(text)) return "balance";
  if (/invalid[_ -]?(?:api[_ -]?)?key|incorrect[_ -]?(?:api[_ -]?)?key|unauthori[sz]ed|authentication|permission[_ -]?denied|access[_ -]?denied|forbidden|无权限|权限不足|密钥无效|无效.*密钥|密钥.*错误|身份验证/iu.test(text)) return "authentication";
  if (/time[_ -]?out|timed[_ -]?out|ETIMEDOUT|UND_ERR_(?:HEADERS|BODY|CONNECT)_TIMEOUT|超时/iu.test(text)) return "timeout";
  if (/rate[_ -]?limit|too[_ -]?many[_ -]?requests|overload|server[_ -]?busy|no[_ -]?available|no[_ -]?compatible|无可用.*账号|繁忙|并发|限流|速率限制/iu.test(text)) return "busy";
  return undefined;
}

/** Presentation only: retains raw evidence and never changes retry or billing decisions. */
export function resultFailureFeedback(error?: LocalizedRunError | null, rawError?: unknown) {
  const original = rawError && typeof rawError === "object" ? rawError as Record<string, unknown> : undefined;
  const originalText = typeof rawError === "string" ? rawError : undefined;
  const originalMessage = typeof original?.message === "string" ? original.message : originalText;
  const originalProviderMessage = typeof original?.providerMessage === "string" ? original.providerMessage : undefined;
  const code = typeof original?.code === "string" ? original.code : error?.code;
  const providerMessage = originalProviderMessage ?? error?.providerMessage;
  const raw = providerMessage ?? originalMessage ?? error?.localMessage ?? error?.message ?? "未记录原始错误。";
  if (isUnsubmittedReferenceFailure(original ?? error))
    return { kind: "references" as const, raw, ...messages.references };
  // Supplier evidence must not compete with a translated label such as
  // “余额不足” attached to an insufficient_quota response by older localization.
  const translatedFallback = providerMessage ? "" : [original?.type, error?.type, error?.message].filter(value => typeof value === "string").join(" ");
  const statusKind = error?.statusCode === 402 ? "balance"
    : error?.statusCode === 401 || error?.statusCode === 403 ? "authentication"
      : error?.statusCode === 408 || error?.statusCode === 504 ? "timeout"
        : error?.statusCode === 429 || error?.statusCode === 503 ? "busy" : undefined;
  const categoryKind = ({ content_policy: "moderation", insufficient_balance: "balance", authentication: "authentication", rate_limit: "busy", supplier_capacity: "capacity", network: "network", local_network: "network", invalid_request: "parameters", local_storage: "storage", supplier_error: "supplier", unknown: "unknown" } as const)[error?.failureCategory ?? "unknown"];
  const kind: FeedbackKind = error?.failureCategory === "supplier_capacity" || original?.failureCategory === "supplier_capacity" ? "capacity"
    : classifyText(code ?? "") ?? classifyText(providerMessage ?? originalMessage ?? "") ?? classifyText(translatedFallback) ?? statusKind ?? categoryKind;
  return { kind, raw, ...(kind === "unknown" ? { cause: raw, action: "查看完整错误详情，并核对原任务状态。" } : messages[kind]) };
}

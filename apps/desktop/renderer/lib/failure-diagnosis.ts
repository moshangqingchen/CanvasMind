import type { LocalizedRunError } from "./error-localization";

type FailureCategory = NonNullable<LocalizedRunError["failureCategory"]>;

const categoryLabels: Record<FailureCategory, string> = {
  insufficient_balance: "余额或额度不足",
  local_network: "本机网络连接异常",
  network: "网络链路异常",
  supplier_capacity: "供应商暂无可用账号或容量",
  supplier_error: "供应商服务异常",
  authentication: "密钥或访问权限异常",
  rate_limit: "请求频率或并发超限",
  invalid_request: "请求参数不符合要求",
  content_policy: "内容审核未通过",
  local_storage: "本地保存异常",
  unknown: "原因待确认",
};

function legacyCategory(error: LocalizedRunError | null | undefined): FailureCategory {
  // Legacy records have no trustworthy local-network or charge attribution.
  const text = [error?.type, error?.code, error?.message].filter(Boolean).join(" ");
  if (/余额不足|额度不足|insufficient[_ ](?:balance|quota)/iu.test(text)) return "insufficient_balance";
  if (/无可用兼容账号|供应商繁忙|provider_no_compatible_accounts|provider_overloaded/iu.test(text)) return "supplier_capacity";
  if (/身份验证|authentication|unauthorized/iu.test(text)) return "authentication";
  if (/速率限制|rate.limit/iu.test(text)) return "rate_limit";
  if (/内容审核|content_moderation|image_safety/iu.test(text)) return "content_policy";
  if (/网络连接|连接中断|请求超时|UND_ERR_|ECONN|ETIMEDOUT/iu.test(text)) return "network";
  if (/请求参数错误/iu.test(text)) return "invalid_request";
  if (/供应商生成错误|网关或上游服务错误/iu.test(text)) return "supplier_error";
  return "unknown";
}

const nextSteps: Record<FailureCategory, string> = {
  insufficient_balance: "检查所选渠道的余额、额度与计费账户，补足后再决定是否重新生成。",
  local_network: "检查本机网络、代理和 DNS 设置，恢复连接后核对原任务。",
  network: "检查网络、代理和供应商状态；目前不能确认故障发生在哪一侧。",
  supplier_capacity: "等待供应商补充可用账号或恢复容量，也可核对所选模型和分组是否可用。",
  supplier_error: "查看供应商状态与原始错误；向供应商提供原任务号以便排查。",
  authentication: "检查当前渠道的 API 密钥、权限和接口地址。",
  rate_limit: "降低并发或等待限流恢复，再核对原任务状态。",
  invalid_request: "按错误详情检查模型、尺寸、数量和参考素材等参数。",
  content_policy: "根据审核原因修改提示词或参考素材。",
  local_storage: "检查磁盘空间和保存目录权限，修复后核对原任务。",
  unknown: "查看技术详情与供应商原始错误，核对原任务状态。",
};

export function failureDiagnosis(error: LocalizedRunError | null | undefined, options: {
  status?: string;
  providerTaskStatus?: string;
  recoveryAction?: string;
} = {}) {
  const cancelled = options.status === "cancelled";
  const category = error?.failureCategory ?? legacyCategory(error);
  const charge = error?.charge ?? { status: "unknown" as const, source: "unconfirmed" as const };
  const chargeStatus = charge.status;
  const chargeLabel = { charged: "已扣费", not_charged: "未扣费", refunded: "已退款", unknown: "扣费待确认" }[chargeStatus];
  const amountLabel = chargeStatus !== "unknown" && charge.amount !== undefined
    ? `${chargeStatus === "refunded" ? "退款金额 " : ""}${charge.amount} ${charge.currency ?? "（币种 / 单位未提供）"}`
    : "未提供";
  const chargeSource = charge.source === "provider_response"
    ? "供应商本次响应"
    : charge.source === "not_submitted"
      ? "请求尚未发送（本地确认）"
      : `供应商未返回本次扣费凭据；${cancelled ? "取消" : "失败"}不代表未扣费`;
  const nextStep = cancelled
    ? "请核对供应商原任务是否已停止，以及本次扣费或退款记录。取消不等于退款。"
    : options.providerTaskStatus === "succeeded" || options.recoveryAction === "resume_archive"
    ? "生成结果已在供应商侧完成。修复下载或保存问题后，取回已有结果，无需重新生成。"
    : nextSteps[category];
  const billingStep = chargeStatus === "unknown" || chargeStatus === "charged"
    ? "重新生成前先核对原任务和账单，避免重复提交。"
    : "再次生成会提交新请求，按供应商规则计费。";
  return {
    regionLabel: cancelled ? "取消信息" : "失败诊断",
    reasonLabel: cancelled ? "取消原因" : "失败原因",
    category,
    categoryLabel: cancelled ? "任务已取消" : categoryLabels[category],
    reason: error?.message ?? (cancelled ? "该任务已取消，未记录具体原因。" : "没有记录具体错误，请查看任务记录或联系供应商。"),
    chargeStatus,
    chargeLabel,
    amountLabel,
    chargeSource,
    nextStep: `${nextStep}${billingStep}`,
  };
}

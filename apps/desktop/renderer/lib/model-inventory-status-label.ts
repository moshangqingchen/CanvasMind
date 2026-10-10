import type { ModelDirectoryDenialCode } from "./model-inventory-failure";

const groupDenialLabels: Record<ModelDirectoryDenialCode, string> = {
  GROUP_DELETED: "分组已删除",
  GROUP_DISABLED: "分组已停用",
  GROUP_NOT_ALLOWED: "当前账号无此分组权限",
};

/** Short display text only; never changes a connection, its Key or model grants. */
export function modelInventoryStatusLabel(status: string, config: Readonly<Record<string, unknown>> = {}): string {
  if (status === "live") return "模型列表已确认";
  if (status === "empty") return "本次未返回模型";
  if (status !== "unauthorized") return "模型可用性待确认";

  const upstreamCode = config.modelScanUpstreamErrorCode;
  if (typeof upstreamCode === "string" && Object.hasOwn(groupDenialLabels, upstreamCode))
    return groupDenialLabels[upstreamCode as ModelDirectoryDenialCode];
  if (config.modelScanHttpStatus === 403) return "Key 无目录权限";
  if (config.modelScanHttpStatus === 401) return "Key 鉴权失败";
  if (config.modelScanErrorCode === "permission_denied") return "Key 无目录权限";
  if (config.modelScanErrorCode === "invalid_credentials") return "Key 鉴权失败";
  return "Key 鉴权或权限待确认";
}

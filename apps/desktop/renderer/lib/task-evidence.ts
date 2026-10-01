import { providerSupplierLabel } from "@super-canvas/providers/suppliers";
import type { RunSnapshot, RunTaskEvidence } from "../components/types";

export function taskConnectionLabel(request?: RunSnapshot["nodes"][number]["request"]): string {
  const name = request?.connectionName?.trim();
  const supplier = request?.supplier?.trim();
  // The adapter name (for example openai) does not prove a direct official connection.
  const label = name || (supplier && !supplier.startsWith("custom:") ? providerSupplierLabel(supplier) : "供应商未记录");
  const group = request?.modelGroup?.trim();
  return group && !label.includes(group) ? `${label} · ${group}` : label;
}

export function taskOutcomeLabel(status?: string, evidence?: RunTaskEvidence, recoveryAction?: string): string | undefined {
  if (status === "needs_attention") {
    if (recoveryAction === "resume_archive" || evidence?.status === "succeeded") return "生成成功，结果待取回";
    if (evidence?.status === "failed") return "已接单，生成失败";
    return evidence ? "已接单，查询需处理" : "提交结果未知";
  }
  if (status === "failed") {
    if (evidence?.status === "succeeded") return "生成成功，结果保存失败";
    return evidence ? "已接单，任务失败" : "生成失败";
  }
  return undefined;
}

export function taskOutcomeNote(status?: string, evidence?: RunTaskEvidence, recoveryAction?: string): string | undefined {
  if (status === "needs_attention") {
    if (recoveryAction === "resume_archive" || evidence?.status === "succeeded") return "供应商已经完成生成。取回只会下载现有结果，不会重新提交。费用请到供应商核对。";
    if (evidence?.status === "failed") return "供应商已接单并返回失败。请核对原任务与扣费记录；重新生成会提交新任务。";
    return evidence
      ? "已取得供应商任务号。可继续查询原任务；重新生成会提交新任务，费用请到供应商核对。"
      : "未取得供应商任务号，提交和费用尚未确认。请先核对供应商任务与扣费记录，再决定是否重新生成。";
  }
  if (status === "failed" && evidence) return evidence.status === "succeeded"
    ? "供应商已完成原任务，本地结果保存失败。请先核对或取回原结果，费用请到供应商核对。"
    : evidence.status === "failed"
      ? "供应商已接单并返回失败。费用请到供应商核对；重新生成会提交新任务。"
      : "已取得供应商任务号，任务处理出现错误。请先核对原任务与扣费记录；重新生成会提交新任务。";
  return undefined;
}

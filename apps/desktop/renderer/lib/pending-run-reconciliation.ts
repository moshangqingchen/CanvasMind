export const PENDING_RUN_CREATION_GRACE_MS = 60_000;

export function pendingGeneratedResultLabel(status: unknown, phase?: string): string {
  if (status === "succeeded") return "已完成";
  if (status === "failed" || status === "needs_attention") return "需要处理";
  if (status === "cancelled") return "已取消";
  if (status === "blocked") return "等待上游";
  if (status === "queued") return "等待开始";
  if (status === "submitting" || status === "running") {
    const label = ({ cloud_queued: "云端已接收，等待派发", waiting_provider: "等待供应商响应", generating: "正在生成", receiving: "正在接收供应商结果", cloud_saving: "云端正在保存结果", downloading: "正在取回结果" } as Record<string, string>)[phase ?? ""];
    if (label) return label;
  }
  if (status === "submitting") return "正在提交";
  if (status === "archiving") return "已生成，正在下载保存";
  if (status === "cancel_requested") return "正在取消";
  return "正在生成";
}

/**
 * A generated result is eligible for run reconciliation only while its
 * request can still change state. Terminal results may retain historical
 * metadata, but polling them as pending work causes an endless autosave loop.
 */
export function isPendingGeneratedResultStatus(status: unknown): boolean {
  return (
    status === undefined ||
    status === "blocked" ||
    status === "queued" ||
    status === "submitting" ||
    status === "running" ||
    status === "archiving" ||
    status === "cancel_requested"
  );
}

export function shouldMarkPendingRunMissing(input: {
  requestId: string;
  generatedCreatedAt?: string;
  matchedRequestIds: ReadonlySet<string>;
  submittingAtFetchStart: ReadonlySet<string>;
  submittingNow: ReadonlySet<string>;
  now?: number;
}): boolean {
  if (input.matchedRequestIds.has(input.requestId)) return false;
  // A lookup that began while POST /api/runs was still in flight is not an
  // authoritative negative result. The POST may persist the run before this
  // older GET resolves, which previously produced a false orphan error.
  if (
    input.submittingAtFetchStart.has(input.requestId) ||
    input.submittingNow.has(input.requestId)
  )
    return false;

  const createdAt = Date.parse(input.generatedCreatedAt ?? "");
  if (!Number.isFinite(createdAt)) return false;
  return (input.now ?? Date.now()) - createdAt >= PENDING_RUN_CREATION_GRACE_MS;
}

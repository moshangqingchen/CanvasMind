import { cangyuanResultRetention } from "@super-canvas/providers";

/** A supplier's retention notice is not an expiry timestamp. Completion time
 * may be absent from an old response; never derive it from submission or a poll. */
export function resultRetentionForInput(input: Readonly<Record<string, unknown>>, kind: string) {
  const saved = input.providerResultRetention;
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    const row = saved as Record<string, unknown>;
    const policy = cangyuanResultRetention(typeof row.sourceUrl === "string" ? row.sourceUrl : undefined, kind);
    if (policy) return policy;
  }
  return cangyuanResultRetention(typeof input.supplierWebsiteUrl === "string" ? input.supplierWebsiteUrl : undefined, kind);
}

export function resultRetentionNote(input: Readonly<Record<string, unknown>>, kind: string): string {
  const retention = resultRetentionForInput(input, kind);
  return retention ? `；供应商说明${kind === "video" ? "视频" : "图片"}结果链接在生成完成后保留 ${retention.label}，确切到期时间未返回时不能判定已过期。已有任务和原始响应仍保留` : "";
}

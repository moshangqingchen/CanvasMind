/** Supplier retention is guidance measured after generation, never a task timeout.
 * Source was read for the 2026-10-14 audit; the notice supplied no publication date.
 */
export function cangyuanResultRetention(baseUrl: string | undefined, kind: string | undefined): {
  seconds: 7200 | 86400; label: string; sourceUrl: string; checkedAt: string;
  startsAt: "generation-completed"; certainty: "supplier-declared";
} | undefined {
  try {
    const url = new URL(baseUrl ?? "");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port ||
      !["ai.cangyuansuanli.cn", "direct-api.cangyuansuanli.cn"].includes(url.hostname)) return undefined;
  } catch { return undefined; }
  if (kind !== "image" && kind !== "video") return undefined;
  return { seconds: kind === "image" ? 7200 : 86400, label: kind === "image" ? "2 小时" : "1 天",
    sourceUrl: "https://ai.cangyuansuanli.cn/api/notice", checkedAt: "2026-10-14T23:26:53.636Z",
    startsAt: "generation-completed", certainty: "supplier-declared" };
}

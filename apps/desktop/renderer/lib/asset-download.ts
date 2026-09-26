"use client";
export function assetDownloadPath(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/content?download=1`;
}
/** All transfers stay within the authenticated desktop origin. */
export async function canvasRequestUrlPreferLocal(path: string): Promise<URL> {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin) throw new Error("素材请求必须使用当前 App 的本地服务");
  return url;
}
export async function downloadAssetPreferLocal(assetId: string, filename?: string): Promise<"current-origin"> {
  const url = await canvasRequestUrlPreferLocal(assetDownloadPath(assetId));
  const anchor = document.createElement("a");
  anchor.href = url.toString(); anchor.download = filename ?? ""; anchor.rel = "noopener"; anchor.hidden = true;
  document.body.append(anchor); anchor.click(); anchor.remove();
  return "current-origin";
}

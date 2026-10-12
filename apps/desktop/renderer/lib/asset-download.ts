"use client";
export type ImageDownloadFormat = "original" | "png" | "jpg" | "webp";

export function assetDownloadPath(
  assetId: string,
  format: ImageDownloadFormat = "original",
): string {
  const path = `/api/assets/${encodeURIComponent(assetId)}/content?download=1`;
  return format === "original" ? path : `${path}&format=${format}`;
}
/** All transfers stay within the authenticated desktop origin. */
export async function canvasRequestUrlPreferLocal(path: string): Promise<URL> {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin)
    throw new Error("素材请求必须使用当前 App 的本地服务");
  return url;
}
function clickDownload(href: string, filename?: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename ?? "";
  anchor.rel = "noopener";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export async function downloadAssetPreferLocal(
  assetId: string,
  filename?: string,
  format: ImageDownloadFormat = "original",
): Promise<"current-origin"> {
  const url = await canvasRequestUrlPreferLocal(
    assetDownloadPath(assetId, format),
  );
  if (format === "original") {
    clickDownload(url.toString(), filename);
    return "current-origin";
  }

  // Fetch conversions first so a failed conversion stays in the dialog instead
  // of downloading an error document or navigating away from the canvas.
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error("图片转换下载失败，请重试");
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "图片转换失败，请重试",
    );
  }
  const expectedMime = format === "jpg" ? "image/jpeg" : `image/${format}`;
  const blob = await response.blob();
  if (blob.type.split(";")[0] !== expectedMime || blob.size === 0)
    throw new Error("下载结果格式不正确，请重试");

  let downloadName = `${(filename || "image").replace(/\.(png|jpe?g|webp|gif|avif|heic|heif|tiff?|bmp|svg)$/iu, "")}.${format}`;
  const encodedName = /filename\*=UTF-8''([^;]+)/iu.exec(
    response.headers.get("content-disposition") ?? "",
  )?.[1];
  if (encodedName) {
    try {
      downloadName = decodeURIComponent(encodedName);
    } catch {
      /* Use the local filename fallback. */
    }
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    clickDownload(objectUrl, downloadName);
  } finally {
    // Give the browser time to hand the Blob to its download manager.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
  return "current-origin";
}

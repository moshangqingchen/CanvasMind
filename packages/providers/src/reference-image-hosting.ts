import type { FetchImplementation, ProviderAssetInput } from "./contracts.js";
import { fetchProviderJson, providerFetch } from "./http.js";

export function referenceImageHostingEnabled(settings: Readonly<Record<string, unknown>> | undefined): boolean {
  return settings?.referenceImageHosting === "litterbox-24h";
}

/** Explicit per-connection opt-in. Provider keys are never sent to the host. */
export async function uploadTemporaryReferenceImages(
  assets: readonly ProviderAssetInput[],
  fetchImpl: FetchImplementation = providerFetch,
): Promise<ProviderAssetInput[]> {
  for (const asset of assets) {
    if (asset.url?.startsWith("https://")) continue;
    if (asset.kind !== "image" || !asset.mimeType.startsWith("image/") || !asset.data?.byteLength)
      throw new Error("临时链接目前仅支持本地参考图片；当前生成尚未提交。");
    if (asset.data.byteLength > 200 * 1024 * 1024)
      throw new Error("参考图片超过临时图床的 200 MB 限制；当前生成尚未提交。");
  }
  const hosted: ProviderAssetInput[] = [];
  for (const asset of assets) {
    if (asset.url?.startsWith("https://")) { hosted.push(asset); continue; }
    const body = new FormData();
    body.append("reqtype", "fileupload");
    body.append("time", "24h");
    const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[asset.mimeType] ?? "img";
    body.append("fileToUpload", new Blob([new Uint8Array(asset.data!)], { type: asset.mimeType }), `reference.${extension}`);
    try {
      const result = await fetchProviderJson<unknown>(fetchImpl,
        "https://litterbox.catbox.moe/resources/internals/api.php",
        { method: "POST", body }, { phase: "connect", timeoutMs: 120_000, maxResponseBytes: 4096 });
      const url = typeof result === "string" ? new URL(result.trim()) : null;
      if (!url || url.protocol !== "https:" || url.hostname !== "litter.catbox.moe" || url.username || url.password || url.port)
        throw new Error("invalid upload response");
      // Preserve IDs and roles/order; only the provider-facing copy gets a URL.
      hosted.push({ ...asset, url: url.href });
    } catch {
      throw new Error("参考图临时上传失败，请检查网络或稍后再试；当前生成尚未提交。");
    }
  }
  return hosted;
}

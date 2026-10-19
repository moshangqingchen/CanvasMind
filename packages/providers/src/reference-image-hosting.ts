import type { FetchImplementation, ProviderAssetInput } from "./contracts.js";
import { fetchProviderJson, providerFetch } from "./http.js";
import { MaterialPreparationError, prepareMaterial } from "./material-preparation.js";
import { distinctAssetSources } from "./asset-preparation-cache.js";
import { verifyReferenceOriginal } from "./reference-original-probe.server.js";

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
      throw new MaterialPreparationError("read", { detail: "临时链接目前仅支持本地参考图片" });
    if (asset.data.byteLength > 200 * 1024 * 1024)
      throw new MaterialPreparationError("read", { detail: "参考图片超过临时图床的 200 MB 限制" });
  }
  const sources = distinctAssetSources(assets);
  const urls = new Map<string, string>();
  for (const asset of sources) {
    if (asset.url?.startsWith("https://")) continue;
    const body = new FormData();
    body.append("reqtype", "fileupload");
    body.append("time", "24h");
    const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[asset.mimeType] ?? "img";
    body.append("fileToUpload", new Blob([new Uint8Array(asset.data!)], { type: asset.mimeType }), `reference.${extension}`);
    await prepareMaterial("upload", async () => {
      const result = await fetchProviderJson<unknown>(fetchImpl,
        "https://litterbox.catbox.moe/resources/internals/api.php",
        { method: "POST", body }, { phase: "prepare", timeoutMs: 120_000, maxResponseBytes: 4096 });
      const url = typeof result === "string" ? new URL(result.trim()) : null;
      if (!url || url.protocol !== "https:" || url.hostname !== "litter.catbox.moe" || url.username || url.password || url.port)
        throw new MaterialPreparationError("upload", { detail: "临时图床返回无效素材链接" });
      await verifyReferenceOriginal(url.href, asset, assets.findIndex(item => item.id === asset.id), { fetch: fetchImpl, timeoutMs: 120_000 });
      // Preserve IDs and roles/order; only the provider-facing copy gets a URL.
      urls.set(asset.id, url.href);
    });
  }
  return assets.map(asset => urls.has(asset.id) ? { ...asset, url: urls.get(asset.id)! } : asset);
}

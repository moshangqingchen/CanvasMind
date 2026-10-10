import type { FetchImplementation, ProviderAssetInput, ResolvedProviderConnection } from "./contracts.js";
import { assetToBlob, fetchProviderJson, mergeHeaders, providerFetch, ProviderHttpError, requireApiKey } from "./http.js";
import { jiasuImageOrigin } from "./jiasu-image-contract.js";

interface MediaOptions { fetch?: FetchImplementation; requestTimeoutMs?: number }
interface UploadTicket { url?: string; put?: { url?: string; method?: string; headers?: Record<string, string> } }

export function jiasuPublicMediaUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && host.includes(".") &&
      !/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/u.test(host) && !host.endsWith(".local");
  } catch { return false; }
}

/** Supplier-owned free initialization + storage PUT; local data never enters a paid JSON request. */
export async function uploadJiasuMedia(connection: ResolvedProviderConnection, assets: readonly ProviderAssetInput[], options: MediaOptions = {}): Promise<ProviderAssetInput[]> {
  const origin = jiasuImageOrigin(connection.baseUrl);
  if (!origin) throw new Error("佳速素材上传需要当前官方 API 来源");
  const fetch = options.fetch ?? providerFetch;
  const prepared: Array<{ index: number; blob: Blob; asset: ProviderAssetInput; name: string }> = [];
  for (let index = 0; index < assets.length; index++) {
    const asset = assets[index]!;
    // A URL-only public input is already usable, but explicit bytes take precedence.
    if (!asset.data && jiasuPublicMediaUrl(asset.url)) continue;
    const blob = await assetToBlob(asset, fetch);
    if (!blob.size || blob.size > 512 * 1024 * 1024) throw new Error("佳速每个直传素材必须大于零且不超过 512 MB");
    prepared.push({ index, blob, asset, name: asset.filename ?? `${asset.id}.${asset.mimeType.split("/")[1] ?? "bin"}` });
  }
  const result = [...assets];
  // The documented limit is per initialization request, not an invented generation limit.
  for (let offset = 0; offset < prepared.length; offset += 20) {
    const batch = prepared.slice(offset, offset + 20);
    const receipt = await fetchProviderJson<{ success?: boolean; message?: string; data?: { items?: UploadTicket[] } }>(fetch,
      `${origin}/v1/media/uploads`, { method: "POST", headers: mergeHeaders(connection.headers, {
        Authorization: `Bearer ${requireApiKey(connection)}`, "content-type": "application/json",
      }), body: JSON.stringify({ items: batch.map(item => ({ name: item.name, content_type: item.asset.mimeType, size: item.blob.size, kind: item.asset.kind })) }) },
      { phase: "archive", timeoutMs: options.requestTimeoutMs ?? 120_000, idempotent: false });
    const tickets = receipt.data?.items;
    if (receipt.success !== true || !Array.isArray(tickets) || tickets.length !== batch.length)
      throw new ProviderHttpError("佳速免费素材初始化没有返回全部直传凭证；生成尚未提交", {
        kind: "invalid_response", phase: "archive", retryable: false, submissionMayHaveOccurred: false,
      });
    for (let index = 0; index < batch.length; index++) {
      const item = batch[index]!;
      const ticket = tickets[index]!;
      if (!jiasuPublicMediaUrl(ticket.url) || !jiasuPublicMediaUrl(ticket.put?.url) || ticket.put?.method && ticket.put.method !== "PUT")
        throw new ProviderHttpError("佳速素材初始化返回无效 CDN 或直传地址；生成尚未提交", {
          kind: "invalid_response", phase: "archive", retryable: false, submissionMayHaveOccurred: false,
        });
      // The presigned PUT receives only its own storage headers, never the API credential.
      await fetchProviderJson(fetch, ticket.put!.url!, { method: "PUT", ...(ticket.put?.headers ? { headers: ticket.put.headers } : {}), body: item.blob },
        { phase: "archive", timeoutMs: options.requestTimeoutMs ?? 120_000, idempotent: true, allowEmpty: true });
      const { data: _bytes, ...publicAsset } = item.asset;
      result[item.index] = { ...publicAsset, url: ticket.url! };
    }
  }
  return result;
}

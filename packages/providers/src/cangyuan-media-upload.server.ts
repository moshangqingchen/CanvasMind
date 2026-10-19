import { createHash } from "node:crypto";
import type { FetchImplementation, ProviderAssetInput, ResolvedProviderConnection, ValidationIssue } from "./contracts.js";
import { assetToBlob, fetchProviderJson, mergeHeaders, parseDataUrl, providerFetch, ProviderHttpError, requireApiKey } from "./http.js";
import { CANGYUAN_UPLOAD_LIMITS, cangyuanMediaUploadOrigin } from "./cangyuan-media-upload-contract.js";
import { MaterialPreparationError, prepareMaterial } from "./material-preparation.js";

export const cangyuanLocalMedia = (asset: ProviderAssetInput): boolean => asset.data !== undefined || asset.url?.startsWith("data:") === true;
export function cangyuanMediaUploadInputIssues(assets: readonly ProviderAssetInput[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const asset of assets) {
    if (!cangyuanLocalMedia(asset)) continue;
    const parsed = !asset.data && asset.url ? parseDataUrl(asset.url) : undefined;
    const mime = (parsed?.mimeType ?? asset.mimeType).split(";", 1)[0]!.trim().toLowerCase();
    const bytes = asset.data?.byteLength ?? parsed?.data.byteLength;
    const limit = CANGYUAN_UPLOAD_LIMITS[mime];
    if (!mime.startsWith(`${asset.kind}/`) || limit === undefined)
      issues.push({ path: "assets", code: "invalid_media_type", message: "沧元本地直传仅支持 PNG/JPEG/WebP、MP4/WebM、WAV/MP3/M4A。" });
    else if (!bytes || bytes > limit)
      issues.push({ path: "assets", code: "invalid_media_size", message: `沧元本地${asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "图片"}直传须大于零且不超过 ${limit / 1024 / 1024} MB。` });
  }
  return issues;
}
function publicHttps(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && host.includes(".") &&
      !/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.|\[)/u.test(host) && !host.endsWith(".local");
  } catch { return false; }
}
interface UploadTicket { upload_url?: unknown; url?: unknown; expires_in?: unknown; headers?: unknown }
const invalidTicket = () => new MaterialPreparationError("sign", { detail: "沧元本地素材上传凭证无效", cause: new ProviderHttpError("沧元本地素材上传凭证无效", {
  kind: "invalid_response", phase: "prepare", retryable: false, submissionMayHaveOccurred: false,
}) });

/** Sign + PUT original bytes; never sends the supplier credential to object storage. */
export async function uploadCangyuanMedia(connection: ResolvedProviderConnection, assets: readonly ProviderAssetInput[],
  options: { fetch?: FetchImplementation; requestTimeoutMs?: number } = {}): Promise<ProviderAssetInput[]> {
  const origin = cangyuanMediaUploadOrigin(connection.baseUrl);
  if (!origin) throw new MaterialPreparationError("initialize", { detail: "沧元素材直传需要当前官方 API 来源" });
  const issues = cangyuanMediaUploadInputIssues(assets);
  if (issues.length) throw new MaterialPreparationError("read", { detail: issues.map(issue => issue.message).join("；") });
  const fetch = options.fetch ?? providerFetch, key = requireApiKey(connection), result = [...assets];
  // Validate all inputs before the first signing request.
  const prepared = await Promise.all(assets.map(async (asset, index) => cangyuanLocalMedia(asset)
    ? { index, asset, blob: await prepareMaterial("read", () => assetToBlob(asset, fetch)) } : undefined));
  for (const item of prepared) {
    if (!item) continue;
    const data = new Uint8Array(await prepareMaterial("read", () => item.blob.arrayBuffer()));
    const ticket = await prepareMaterial("sign", () => fetchProviderJson<UploadTicket>(fetch, `${origin}/v1/images/uploads`, {
      method: "POST", headers: mergeHeaders(connection.headers, { Authorization: `Bearer ${key}`, "content-type": "application/json" }),
      body: JSON.stringify({ bytes: data.byteLength, content_type: item.blob.type,
        content_md5: createHash("md5").update(data).digest("base64") }),
    }, { phase: "prepare", timeoutMs: options.requestTimeoutMs ?? 120_000, idempotent: false }));
    if (!publicHttps(ticket.upload_url) || !publicHttps(ticket.url) || typeof ticket.expires_in !== "number" || ticket.expires_in <= 0 ||
        !ticket.headers || typeof ticket.headers !== "object" || Array.isArray(ticket.headers)) throw invalidTicket();
    const headers = Object.entries(ticket.headers);
    if (headers.some(([name, value]) => typeof value !== "string" || !name || /[\r\n]/u.test(name + value) || value.includes(key))) throw invalidTicket();
    await prepareMaterial("upload", () => fetchProviderJson(fetch, ticket.upload_url as string, { method: "PUT", headers: Object.fromEntries(headers) as Record<string, string>, body: data },
      { phase: "prepare", timeoutMs: options.requestTimeoutMs ?? 120_000, idempotent: true, allowEmpty: true }));
    const { data: _local, ...asset } = item.asset;
    result[item.index] = { ...asset, url: ticket.url };
  }
  return result;
}

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createProviderAssetToken, hasProviderHttpProxy, providerFetch } from "@super-canvas/providers";
import type { ProviderAssetInput } from "@super-canvas/providers";

interface ChannelState { enabled: boolean; ready: boolean; baseUrl: string; updatedAt: number; instance: string; desktopPublicProbe?: boolean }
/** An enabled private channel must never silently fall back to a public host. */
export function localReferenceChannelConfigured(): boolean {
  if (process.env.SUPERCANVAS_DESKTOP !== "true" || !process.env.SUPERCANVAS_REFERENCE_CHANNEL_FILE) return false;
  try { return JSON.parse(readFileSync(process.env.SUPERCANVAS_REFERENCE_CHANNEL_FILE, "utf8")).enabled === true; }
  catch { return false; }
}
export function localReferenceChannel(): ChannelState | null {
  if (process.env.SUPERCANVAS_DESKTOP !== "true" || !process.env.SUPERCANVAS_REFERENCE_CHANNEL_FILE) return null;
  try {
    const value = JSON.parse(readFileSync(process.env.SUPERCANVAS_REFERENCE_CHANNEL_FILE, "utf8")) as ChannelState;
    const url = new URL(value.baseUrl);
    if (!value.enabled || !value.ready || !Number.isFinite(value.updatedAt) || Date.now() - value.updatedAt > 90_000 ||
      value.updatedAt > Date.now() + 5000 || url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
      url.search || url.hash || !value.instance || !process.env.MASTER_KEY) return null;
    return value;
  } catch { return null; }
}

type LocalReferenceOriginal = Pick<ProviderAssetInput, "id" | "mimeType" | "data">;
type ProbeCode = "ok" | "missing_original" | "http" | "mime" | "length" | "hash" | "network" | "timeout";
export interface LocalReferenceAssetDiagnostic {
  /** One-based file position (zero is instance health) and an opaque identifier. */
  assetIndex: number;
  assetReference: string;
  code: ProbeCode;
  attempts: number;
  durationMs: number;
  httpStatus?: number;
  expectedMime?: string;
  actualMime?: string;
  expectedBytes?: number;
  actualBytes?: number;
}

export class LocalReferenceChannelError extends Error {
  readonly code = "LOCAL_REFERENCE_ASSET_PREFLIGHT_FAILED";
  readonly source = "local_validation";
  constructor(message: string, readonly diagnostics: readonly LocalReferenceAssetDiagnostic[] = []) {
    super(`${message}；当前生成尚未提交。这是本机素材通道检查结果，并非供应商生成响应。`);
    this.name = "LocalReferenceChannelError";
  }
}

const ASSET_PROBE_TIMEOUT_MS = 60_000;
const PROBE_ATTEMPTS = 2;
const PROBE_CONCURRENCY = 2;
type ProbeFetch = (url: string, init: RequestInit) => Promise<Response>;
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function mimeType(value: string | null | undefined): string | undefined {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mime && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mime) ? mime : undefined;
}
function cancelBody(response: Response): void { void response.body?.cancel().catch(() => {}); }

/** Only reference preflight reads may use the app's authenticated system-network relay. */
function referenceProbeFetch(channel: ChannelState): ProbeFetch {
  if (channel.desktopPublicProbe !== true) return providerFetch;
  try {
    // An explicitly configured provider proxy remains authoritative, even when
    // this desktop supports the native-network probe relay.
    if (hasProviderHttpProxy()) return providerFetch;
  } catch {
    throw new LocalReferenceChannelError("已配置的供应商 HTTP 代理无效，请检查代理配置");
  }
  const desktopToken = process.env.SUPERCANVAS_DESKTOP_TOKEN;
  if (!desktopToken?.trim())
    throw new LocalReferenceChannelError("本机素材通道的桌面私有鉴权凭据缺失，请重新打开桌面程序后重试");
  const origin = new URL(channel.baseUrl).origin;
  return (url, init) => {
    const publicUrl = new URL(url);
    if (publicUrl.origin !== origin || !/^\/api\/provider-assets\/[^/]+$/u.test(publicUrl.pathname) ||
        publicUrl.searchParams.size !== 1 || !publicUrl.searchParams.has("token"))
      throw new LocalReferenceChannelError("本机素材通道检查地址无效");
    const relayUrl = new URL(publicUrl.pathname.replace("/api/provider-assets/", "/api/reference-channel-probe/"), "http://127.0.0.1:3210");
    relayUrl.search = publicUrl.search;
    // Use the platform fetch directly for loopback. providerFetch would apply
    // provider network selection/proxies to this private authenticated request.
    // HTTP(S)_PROXY is already covered by hasProviderHttpProxy above.
    return globalThis.fetch(relayUrl.href, { ...init, headers: { "x-supercanvas-desktop-token": desktopToken } });
  };
}

/** Keep the body read under the same deadline, including a stalled streaming response. */
function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("reference probe timed out"));
    if (signal.aborted) { void operation.catch(() => {}); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    operation.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => {
      signal.removeEventListener("abort", abort); reject(error);
    });
  });
}

async function probeAsset(url: string, original: LocalReferenceOriginal, index: number, timeoutMs = ASSET_PROBE_TIMEOUT_MS, fetchProbe: ProbeFetch = providerFetch): Promise<LocalReferenceAssetDiagnostic> {
  const startedAt = Date.now();
  const finish = (diagnostic: Omit<LocalReferenceAssetDiagnostic, "durationMs">): LocalReferenceAssetDiagnostic =>
    ({ ...diagnostic, durationMs: Math.max(0, Date.now() - startedAt) });
  const base = { assetIndex: index + 1, assetReference: sha256(original.id).slice(0, 12),
    expectedMime: mimeType(original.mimeType), expectedBytes: original.data?.byteLength };
  if (!original.data?.byteLength || !base.expectedMime)
    return finish({ ...base, code: "missing_original", attempts: 0 });
  const expectedHash = sha256(original.data);
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let actualBytes = 0;
    try {
      response = await withAbort(fetchProbe(url, { method: "GET", redirect: "error", signal, cache: "no-store" }), signal);
      const info = { ...base, attempts: attempt, httpStatus: response.status };
      if (response.status !== 200) {
        cancelBody(response);
        if (attempt < PROBE_ATTEMPTS && (response.status === 408 || response.status === 429 || response.status >= 500)) {
          await new Promise(resolve => setTimeout(resolve, 250));
          continue;
        }
        return finish({ ...info, code: "http" });
      }
      const actualMime = mimeType(response.headers.get("content-type"));
      if (actualMime !== base.expectedMime) {
        cancelBody(response);
        return finish({ ...info, code: "mime", ...(actualMime ? { actualMime } : {}) });
      }
      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) !== base.expectedBytes)) {
        cancelBody(response);
        return finish({ ...info, actualMime, code: "length" });
      }
      reader = response.body?.getReader();
      const hash = createHash("sha256");
      if (reader) while (true) {
        const chunk = await withAbort(reader.read(), signal);
        if (chunk.done) break;
        actualBytes += chunk.value.byteLength;
        if (actualBytes > original.data.byteLength)
          return finish({ ...info, actualMime, actualBytes, code: "length" });
        hash.update(chunk.value);
      }
      if (actualBytes !== original.data.byteLength)
        return finish({ ...info, actualMime, actualBytes, code: "length" });
      return finish({ ...info, actualMime, actualBytes, code: hash.digest("hex") === expectedHash ? "ok" : "hash" });
    } catch {
      // Never retain fetch's exception text: it can contain the complete signed URL.
      if (attempt === PROBE_ATTEMPTS)
        return finish({ ...base, attempts: attempt, ...(response ? { httpStatus: response.status } : {}), actualBytes,
          code: signal.aborted ? "timeout" : "network" });
    } finally {
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      else if (response) cancelBody(response);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("unreachable reference probe state");
}

const failureDetail = (item: LocalReferenceAssetDiagnostic): string => {
  const reason: Record<ProbeCode, string> = { ok: "通过", missing_original: "缺少可核对的本地原文件或 MIME",
    http: `HTTP ${item.httpStatus ?? "异常"}`, mime: "返回的文件类型与本地原文件不符", length: "返回的文件字节数与本地原文件不符",
    hash: "返回内容与本地原文件不一致", network: "公网读取中断或连接失败", timeout: "公网读取超时" };
  return `${item.assetIndex === 0 ? "通道实例探针" : `第 ${item.assetIndex} 项素材`}：${reason[item.code]}`;
};

/** Validate these exact one-hour URLs and complete original bytes before any paid submission. */
export async function localReferenceUrls(assetIds: readonly string[], originals: readonly LocalReferenceOriginal[]): Promise<string[]> {
  const channel = localReferenceChannel();
  if (!channel) throw new LocalReferenceChannelError("本机素材通道未连通，请在设置的“素材通道”中连接后重试");
  if (!assetIds.length) return [];
  const fetchProbe = referenceProbeFetch(channel);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const urlFor = (id: string, lifetime: number) => {
    const url = new URL(`/api/provider-assets/${encodeURIComponent(id)}`, channel.baseUrl);
    url.searchParams.set("token", createProviderAssetToken({ assetId: id, secret: process.env.MASTER_KEY!, expiresInSeconds: lifetime, nowSeconds }));
    return url.href;
  };
  const health = await probeAsset(urlFor("_health", 30), { id: "_health", mimeType: "text/plain", data: Buffer.from(channel.instance) }, -1, 12_000, fetchProbe);
  if (health.code !== "ok") {
    throw new LocalReferenceChannelError(`本机素材通道暂时无法从公网访问（${failureDetail(health)}），请检查网络后重试`, [health]);
  }
  const uniqueIds = [...new Set(assetIds)];
  const urls = new Map(uniqueIds.map(id => [id, urlFor(id, 3600)]));
  const byId = new Map(originals.map(asset => [asset.id, asset]));
  const diagnostics: LocalReferenceAssetDiagnostic[] = new Array(uniqueIds.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, uniqueIds.length) }, async () => {
    while (next < uniqueIds.length) {
      const index = next++;
      const id = uniqueIds[index]!;
      const original = byId.get(id) ?? { id, mimeType: "" };
      diagnostics[index] = await probeAsset(urls.get(id)!, original, assetIds.indexOf(id), ASSET_PROBE_TIMEOUT_MS, fetchProbe);
    }
  }));
  const failed = diagnostics.filter(item => item.code !== "ok");
  if (failed.length) throw new LocalReferenceChannelError(`本机素材通道原文件检查失败（${failed.map(failureDetail).join("；")}）`, diagnostics);
  return assetIds.map(id => urls.get(id)!);
}

import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile, realpath, stat } from "node:fs/promises";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { getOrCreateAssetPreview } from "../../../../lib/asset-preview";
import {
  MAX_SMALL_JSON_BODY_BYTES,
  readJsonBody,
} from "../../../../lib/api-validation";
import {
  isLoopbackHost,
  normalizeHostHeader,
} from "../../../../lib/public-auth";
import { jsonError, repository, storage } from "../../../../lib/server";
import {
  detectMediaMimeType,
  MAX_PROXY_UPLOAD_BYTES,
  mediaKindForMime,
  sanitizedAssetExtension,
  validateMediaCompleteness,
} from "../media-utils";

const MAX_SOURCES_PER_DROP = 12;
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const SOURCE_IMPORT_CONCURRENCY = 2;

class MediaSourceImportError extends Error {
  public override readonly name = "MediaSourceImportError";
}

async function mapSourcesWithConcurrency<T>(
  sources: readonly string[],
  mapper: (source: string, index: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(sources.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(SOURCE_IMPORT_CONCURRENCY, sources.length) },
    async () => {
      while (nextIndex < sources.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(sources[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

// Keep Turbopack from treating request-provided desktop paths as build-time
// dependencies and tracing the entire workspace into this route.
async function realExternalPath(filePath: string): Promise<string> {
  return realpath(/* turbopackIgnore: true */ filePath);
}

async function statExternalPath(filePath: string) {
  return stat(/* turbopackIgnore: true */ filePath);
}

async function readExternalBytes(filePath: string) {
  return readFile(/* turbopackIgnore: true */ filePath);
}

function localBridgeAccessHeaders(request: Request): Headers {
  const headers = new Headers({
    vary: "Origin, Access-Control-Request-Private-Network",
  });
  const origin = request.headers.get("origin");
  let allowedOrigin: string | undefined;
  try {
    allowedOrigin = process.env.PUBLIC_BASE_URL
      ? new URL(process.env.PUBLIC_BASE_URL).origin
      : undefined;
  } catch {
    allowedOrigin = undefined;
  }
  if (!origin || origin !== allowedOrigin) return headers;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type");
  headers.set("access-control-max-age", "600");
  headers.set("cross-origin-resource-policy", "cross-origin");
  if (request.headers.get("access-control-request-private-network") === "true")
    headers.set("access-control-allow-private-network", "true");
  return headers;
}

function applyLocalBridgeAccess(request: Request, response: Response) {
  for (const [name, value] of localBridgeAccessHeaders(request))
    response.headers.set(name, value);
  return response;
}

export function OPTIONS(request: Request) {
  const headers = localBridgeAccessHeaders(request);
  return new Response(null, {
    status: headers.has("access-control-allow-origin") ? 204 : 403,
    headers,
  });
}

function privateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return true;
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export function isPublicMediaAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0] ?? "";
  const version = isIP(normalized);
  if (version === 4) return !privateIpv4(normalized);
  if (version !== 6) return false;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) === 4 && !privateIpv4(mapped);
  }
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

async function assertPublicRemoteUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new MediaSourceImportError("只能下载 HTTP/HTTPS 素材地址");
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  )
    throw new MediaSourceImportError("不允许从内网地址下载素材");
  const literalVersion = isIP(hostname);
  const addresses = literalVersion
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (
    addresses.length === 0 ||
    addresses.some((entry) => !isPublicMediaAddress(entry.address))
  )
    throw new MediaSourceImportError("素材地址不可达或指向内网");
}

async function readResponseWithLimit(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROXY_UPLOAD_BYTES
  )
    throw new MediaSourceImportError("素材超过 500 MB");
  if (!response.body) throw new MediaSourceImportError("下载结果为空");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_PROXY_UPLOAD_BYTES) {
        await reader.cancel();
        throw new MediaSourceImportError("素材超过 500 MB");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total <= 0) throw new MediaSourceImportError("下载结果为空");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function nameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/iu.exec(value)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim().replace(/^"|"$/gu, ""));
    } catch {
      // Fall through to the plain filename form.
    }
  }
  return (
    /filename\s*=\s*"([^"]+)"/iu.exec(value)?.[1] ??
    /filename\s*=\s*([^;]+)/iu.exec(value)?.[1]?.trim() ??
    null
  );
}

function safeSourceName(value: string | null | undefined): string {
  const cleaned = (value ?? "")
    .replace(/[\u0000-\u001f]/gu, "")
    .replace(/[\\/:*?"<>|]/gu, "_")
    .trim();
  return cleaned.slice(0, 220) || `拖入素材-${Date.now()}`;
}

async function downloadRemoteSource(source: string): Promise<{
  bytes: Uint8Array;
  name: string;
  sourceHost: string;
}> {
  let current: URL;
  try {
    current = new URL(source);
  } catch {
    throw new MediaSourceImportError("素材地址无效");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      await assertPublicRemoteUrl(current);
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "image/*,video/*;q=0.9,audio/*;q=0.8,*/*;q=0.1",
          "user-agent": "SuperCanvas/0.1 media-import",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location || redirect === MAX_REDIRECTS)
          throw new MediaSourceImportError("素材下载重定向过多");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok)
        throw new MediaSourceImportError(
          `素材下载失败（HTTP ${response.status}）`,
        );
      const contentName = nameFromContentDisposition(
        response.headers.get("content-disposition"),
      );
      let pathName = current.pathname.split("/").filter(Boolean).at(-1);
      if (pathName) {
        try {
          pathName = decodeURIComponent(pathName);
        } catch {
          // Keep the undecoded path segment.
        }
      }
      return {
        bytes: await readResponseWithLimit(response),
        name: safeSourceName(contentName || pathName),
        sourceHost: current.hostname,
      };
    }
  } catch (error) {
    if (error instanceof MediaSourceImportError) throw error;
    if (error instanceof DOMException && error.name === "AbortError")
      throw new MediaSourceImportError("素材下载超时");
    throw new MediaSourceImportError("无法下载该素材");
  } finally {
    clearTimeout(timeout);
  }
  throw new MediaSourceImportError("无法下载该素材");
}

function localPathFromSource(source: string): string | null {
  if (/^[a-z]:[\\/]/iu.test(source)) return source;
  try {
    const parsed = new URL(source);
    return parsed.protocol === "file:" ? fileURLToPath(parsed) : null;
  } catch {
    return null;
  }
}

function localMediaRoots(): string[] {
  const home = os.homedir();
  return [
    os.tmpdir(),
    path.join(home, "Desktop"),
    path.join(home, "Downloads"),
    path.join(home, "Pictures"),
    path.join(home, "Videos"),
    path.join(home, "Documents"),
  ];
}

async function readAllowedLocalSource(source: string): Promise<{
  bytes: Uint8Array;
  name: string;
}> {
  const candidate = localPathFromSource(source);
  if (!candidate || !path.isAbsolute(candidate))
    throw new MediaSourceImportError("本机素材路径无效");
  const target = await realExternalPath(candidate).catch(() => null);
  if (!target) throw new MediaSourceImportError("微信缓存文件已失效");
  const roots = (
    await Promise.all(
      localMediaRoots().map((root) => realExternalPath(root).catch(() => null)),
    )
  ).filter((root): root is string => Boolean(root));
  const allowed = roots.some((root) => {
    const relative = path.relative(root, target);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  });
  if (!allowed)
    throw new MediaSourceImportError("本机素材不在允许导入的用户目录中");
  const info = await statExternalPath(target).catch(() => null);
  if (!info?.isFile()) throw new MediaSourceImportError("本机素材不存在");
  if (info.size <= 0) throw new MediaSourceImportError("微信提供的文件为空");
  if (info.size > MAX_PROXY_UPLOAD_BYTES)
    throw new MediaSourceImportError("素材超过 500 MB");
  return {
    bytes: new Uint8Array(await readExternalBytes(target)),
    name: safeSourceName(path.basename(target)),
  };
}

async function normalizeImportedMedia(
  bytes: Uint8Array,
  name: string,
): Promise<{ bytes: Uint8Array; mimeType: string; name: string }> {
  let normalizedBytes = bytes;
  let mimeType = detectMediaMimeType(bytes);
  if (!mimeType || !mediaKindForMime(mimeType)) {
    try {
      const metadata = await sharp(bytes, { failOn: "error" }).metadata();
      if (
        !metadata.format ||
        !new Set(["heif", "avif", "tiff", "jp2", "bmp"]).has(metadata.format)
      )
        throw new Error("unsupported");
      normalizedBytes = new Uint8Array(
        await sharp(bytes, { failOn: "error" })
          .rotate()
          .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
          .toBuffer(),
      );
      mimeType = "image/jpeg";
    } catch {
      throw new MediaSourceImportError(
        "下载到的内容不是可导入的图片、视频或音频",
      );
    }
  }
  if (mimeType === "image/gif") {
    try {
      normalizedBytes = new Uint8Array(
        await sharp(bytes, { failOn: "error" })
          .rotate()
          .png()
          .toBuffer(),
      );
      mimeType = "image/png";
    } catch {
      throw new MediaSourceImportError("GIF 图片无法转换为 PNG");
    }
  }
  if (!mediaKindForMime(mimeType))
    throw new MediaSourceImportError("该媒体格式暂时无法导入");
  if (!validateMediaCompleteness(normalizedBytes, mimeType))
    throw new MediaSourceImportError("素材文件不完整或已损坏");
  const extension = sanitizedAssetExtension(name, mimeType);
  const base = safeSourceName(name).replace(/\.[^.]+$/u, "");
  return {
    bytes: normalizedBytes,
    mimeType,
    name: `${base || "拖入素材"}.${extension}`,
  };
}

async function storeImportedSource(source: string, requestIsLoopback: boolean) {
  const localPath = localPathFromSource(source);
  const loaded = localPath
    ? requestIsLoopback
      ? await readAllowedLocalSource(source)
      : (() => {
          throw new MediaSourceImportError("本机路径只能通过本机画布服务导入");
        })()
    : await downloadRemoteSource(source);
  const normalized = await normalizeImportedMedia(loaded.bytes, loaded.name);
  const kind = mediaKindForMime(normalized.mimeType)!;
  const id = randomUUID();
  const extension = sanitizedAssetExtension(
    normalized.name,
    normalized.mimeType,
  );
  const storageKey = `assets/${id}/original.${extension}`;
  await storage.put(storageKey, normalized.bytes, normalized.mimeType);
  const asset = await repository.saveAsset({
    id,
    name: normalized.name,
    kind,
    mimeType: normalized.mimeType,
    size: normalized.bytes.byteLength,
    storageKey,
    metadata: {
      source: localPath ? "desktop-drop" : "remote-drop",
      ...(!localPath && "sourceHost" in loaded
        ? { sourceHost: loaded.sourceHost }
        : {}),
    },
  });
  if (asset.kind === "image")
    void getOrCreateAssetPreview(storage, asset, 640)
      .then(() => getOrCreateAssetPreview(storage, asset, 160))
      .catch(() => undefined);
  return {
    ...asset,
    url: `/api/assets/${encodeURIComponent(asset.id)}/content`,
  };
}

async function handlePost(request: Request): Promise<Response> {
  const parsed = await readJsonBody(request, MAX_SMALL_JSON_BODY_BYTES);
  if (!parsed.success) return parsed.response;
  const sources =
    parsed.data &&
    typeof parsed.data === "object" &&
    !Array.isArray(parsed.data) &&
    Array.isArray((parsed.data as Record<string, unknown>).sources)
      ? (parsed.data as { sources: unknown[] }).sources
      : null;
  if (
    !sources ||
    sources.length === 0 ||
    sources.length > MAX_SOURCES_PER_DROP ||
    sources.some(
      (source) =>
        typeof source !== "string" ||
        source.length === 0 ||
        source.length > 16_384,
    )
  )
    return jsonError("请提供 1-12 个有效的素材地址");

  const requestIsLoopback = isLoopbackHost(
    normalizeHostHeader(new URL(request.url).host),
  );
  const results = await mapSourcesWithConcurrency(
    sources as string[],
    async (source, index) => {
      try {
        return {
          index,
          asset: await storeImportedSource(source, requestIsLoopback),
        };
      } catch (error) {
        return {
          index,
          error: error instanceof Error ? error.message : "素材导入失败",
        };
      }
    },
  );
  const assets = results.flatMap((result) =>
    "asset" in result ? [result.asset] : [],
  );
  const failures = results.flatMap((result) =>
    "error" in result ? [{ index: result.index, message: result.error }] : [],
  );
  return Response.json(
    { assets, failures },
    {
      status: assets.length > 0 ? 201 : 422,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  return applyLocalBridgeAccess(request, await handlePost(request));
}

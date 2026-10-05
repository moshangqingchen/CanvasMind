import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import {
  hasProviderHttpProxy,
  fetchWithProviderHttpProxy,
  fetchWithPinnedProviderHttpProxy,
  resolvePublicIpv4Addresses,
} from "@super-canvas/providers";
import { readRecoveredArtifact } from "./recovered-artifacts.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

export interface ResolvedAddress {
  address: string;
  family: number;
}

interface ResolvedArtifactAddress extends ResolvedAddress {
  /** HTTP Fake-IP recovery must retain the independently validated destination. */
  pinProxyTarget?: true;
}

export interface RemoteTransportResponse {
  status: number;
  location?: string;
  contentType?: string;
  bytes: Uint8Array;
}

export type RemoteDownloadTransport = (
  url: URL,
  resolved: ResolvedAddress,
  signal: AbortSignal,
  maxBytes: number,
) => Promise<RemoteTransportResponse>;

export interface RemoteDownloadOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  resolve?: (hostname: string) => Promise<readonly ResolvedAddress[]>;
  /** Independent public DNS used only for HTTP hostnames behind Fake-IP DNS. */
  resolvePublic?: (
    hostname: string,
    signal: AbortSignal,
  ) => Promise<readonly ResolvedAddress[]>;
  transport?: RemoteDownloadTransport;
  /** Local original files staged by an explicit archive recovery operation. */
  recoveryDirectory?: string;
}

export interface RemoteDownloadResult {
  bytes: Uint8Array;
  contentType?: string;
}

interface RemoteStreamResponse {
  status: number;
  location?: string;
  contentType?: string;
  chunks: AsyncIterable<Uint8Array>;
  close(): void | Promise<void>;
}

async function* singleChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function artifactDownloadMaxBytes(): number {
  return positiveInteger(
    process.env.ARTIFACT_MAX_DOWNLOAD_BYTES,
    DEFAULT_MAX_BYTES,
  );
}

function ipv4IsPublic(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [a = 0, b = 0, c = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return ipv4IsPublic(address);
  if (family !== 6) return false;

  // URL literals and DNS can spell the same IPv4-mapped address with dotted
  // bytes or hexadecimal words. Apply the IPv4 policy to both consistently.
  let normalized: string;
  try {
    normalized = new URL(`http://[${address}]`).hostname.replace(/^\[|\]$/gu, "");
  } catch {
    // Scoped/link-local addresses cannot be remote artifact destinations.
    return false;
  }
  const mapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/u.exec(normalized);
  if (mapped) {
    const high = Number.parseInt(mapped[1]!, 16);
    const low = Number.parseInt(mapped[2]!, 16);
    return ipv4IsPublic(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  const [firstSegment, secondSegment] = normalized.split(":", 2);
  const first = Number.parseInt(firstSegment ?? "", 16);
  if (first === 0x2001 && Number.parseInt(secondSegment ?? "", 16) === 0xdb8) return false;
  if (!firstSegment) return false;
  return first >= 0x2000 && first <= 0x3fff;
}

function isFakeIpDnsAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split(".").map(Number);
  return first === 198 && second !== undefined && second >= 18 && second <= 19;
}

function parseRemoteUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Provider output URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Provider output URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("Provider output URL must not contain credentials");
  }
  return url;
}

async function resolvePublicAddress(
  url: URL,
  resolve: NonNullable<RemoteDownloadOptions["resolve"]>,
  resolvePublic: NonNullable<RemoteDownloadOptions["resolvePublic"]>,
  signal: AbortSignal,
): Promise<ResolvedArtifactAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  if (
    hostname.toLowerCase() === "localhost" ||
    hostname.toLowerCase().endsWith(".localhost") ||
    hostname.includes("%")
  ) {
    throw new Error("Provider output URL resolves to a forbidden host");
  }
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolve(hostname);
  if (addresses.length === 0) {
    throw new Error("Provider output hostname did not resolve");
  }
  const hasOnlyFakeIpDns =
    literalFamily === 0 &&
    addresses.every(({ address }) => isFakeIpDnsAddress(address));
  if (url.protocol === "http:" && hasOnlyFakeIpDns) {
    // Plain HTTP cannot authenticate the original hostname over a Fake-IP
    // route. Resolve it independently and pin the verified public destination
    // instead; never fall back to the original Fake-IP on discovery failure.
    const publicAddresses = await resolvePublic(hostname, signal);
    if (
      publicAddresses.length === 0 ||
      publicAddresses.some(({ address }) => !isPublicNetworkAddress(address))
    ) {
      throw new Error(
        "Provider output URL did not resolve to a public address",
      );
    }
    return { ...publicAddresses[0]!, pinProxyTarget: true };
  }
  // Clash/Mihomo Fake-IP mode maps public hostnames into RFC 2544's
  // 198.18.0.0/15 range. Only permit that mapping for HTTPS hostnames: an IP
  // literal remains blocked, and TLS still authenticates the original host.
  const canUseFakeIpDns = url.protocol === "https:" && hasOnlyFakeIpDns;
  if (
    addresses.some(
      ({ address }) =>
        !isPublicNetworkAddress(address) &&
        !(canUseFakeIpDns && isFakeIpDnsAddress(address)),
    )
  ) {
    throw new Error("Provider output URL resolves to a private address");
  }
  return addresses[0]!;
}

function requestPinned(
  url: URL,
  resolved: ResolvedAddress,
  signal: AbortSignal,
  maxBytes: number,
): Promise<RemoteStreamResponse> {
  return new Promise((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    const options: RequestOptions = {
      protocol: url.protocol,
      hostname: resolved.address,
      family: resolved.family,
      port: url.port || undefined,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      headers: {
        accept: "image/*,video/*,application/octet-stream;q=0.8,*/*;q=0.1",
        host: url.host,
      },
      signal,
      ...(url.protocol === "https:" && isIP(hostname) === 0
        ? { servername: hostname }
        : {}),
    };
    const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requester(options, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      const contentType = response.headers["content-type"];
      if (status < 200 || status >= 300) {
        response.destroy();
        resolve({
          status,
          location,
          chunks: singleChunk(new Uint8Array()),
          close() {},
        });
        return;
      }
      const declaredLength = Number(response.headers["content-length"]);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.destroy();
        reject(new Error(`Provider output exceeds ${maxBytes} bytes`));
        return;
      }
      // Keep the socket paused until the storage consumer requests bytes.
      response.on("error", () => {});
      resolve({
        status,
        contentType,
        chunks: response,
        close: () => {
          response.destroy();
        },
      });
    });
    request.once("error", (error) => {
      reject(
        signal.aborted
          ? new Error("Provider output download timed out")
          : error,
      );
    });
    request.end();
  });
}

// The user-configured proxy owns routing, including HTTPS Fake-IP mappings.
// HTTP Fake-IP recovery pins its independently verified IP through the proxy.
// Keep URL/DNS checks and redirect handling in downloadRemoteArtifact; never
// send provider credentials or automatically follow an unchecked redirect.
async function requestThroughProviderProxy(
  url: URL,
  resolved: ResolvedArtifactAddress,
  signal: AbortSignal,
  maxBytes: number,
): Promise<RemoteStreamResponse> {
  if (signal.aborted) throw new Error("Provider output download timed out");
  const target = new URL(url.href);
  if (resolved.pinProxyTarget) {
    target.hostname =
      isIP(resolved.address) === 6 ? `[${resolved.address}]` : resolved.address;
  }
  const headers = {
    accept: "image/*,video/*,application/octet-stream;q=0.8,*/*;q=0.1",
  };
  const response = resolved.pinProxyTarget
    ? await fetchWithPinnedProviderHttpProxy(target.href, {
        host: url.host,
        headers,
        signal,
        proxyOverride: process.env.ARTIFACT_HTTP_PROXY,
      })
    : await fetchWithProviderHttpProxy(
        target.href,
        { method: "GET", redirect: "manual", signal, headers },
        process.env.ARTIFACT_HTTP_PROXY,
      );
  if (signal.aborted) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("Provider output download timed out");
  }
  const status = response.status;
  const location = response.headers.get("location") ?? undefined;
  const contentType = response.headers.get("content-type") ?? undefined;
  if (status < 200 || status >= 300) {
    void response.body?.cancel().catch(() => undefined);
    return {
      status,
      location,
      contentType,
      chunks: singleChunk(new Uint8Array()),
      close() {},
    };
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`Provider output exceeds ${maxBytes} bytes`);
  }
  const chunks = (async function* () {
    const reader = response.body?.getReader();
    if (!reader) return;
    try {
      while (true) {
        const { done, value } = await abortable(reader.read(), signal);
        if (done) break;
        yield value;
      }
    } finally {
      // Cancellation starts synchronously, but a custom stream's cleanup may
      // never settle. It must not hide the timeout or the storage error.
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  })();
  return {
    status,
    contentType,
    chunks,
    close: async () => {
      await chunks.return(undefined);
      void response.body?.cancel().catch(() => undefined);
    },
  };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("Provider output download timed out"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    // Observe the operation even when the deadline expired before the wait.
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export async function downloadRemoteArtifact(
  value: string,
  options: RemoteDownloadOptions = {},
): Promise<RemoteDownloadResult> {
  return consumeRemoteArtifact(
    value,
    async (source, contentType) => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of source) {
        chunks.push(chunk);
        size += chunk.byteLength;
      }
      const joined = Buffer.concat(chunks, size);
      return {
        bytes: new Uint8Array(
          joined.buffer,
          joined.byteOffset,
          joined.byteLength,
        ),
        ...(contentType ? { contentType } : {}),
      };
    },
    options,
  );
}

/** The consumer must exhaust the iterable before committing its result. */
export async function consumeRemoteArtifact<T>(
  value: string,
  consume: (
    chunks: AsyncIterable<Uint8Array>,
    contentType?: string,
  ) => Promise<T>,
  options: RemoteDownloadOptions = {},
): Promise<T> {
  const timeoutMs =
    options.timeoutMs ??
    positiveInteger(
      process.env.ARTIFACT_DOWNLOAD_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    );
  const maxBytes = options.maxBytes ?? artifactDownloadMaxBytes();
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const resolve =
    options.resolve ??
    ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));
  const resolvePublic =
    options.resolvePublic ??
    (async (hostname: string, signal: AbortSignal) =>
      (
        await resolvePublicIpv4Addresses(
          hostname,
          AbortSignal.any([signal, AbortSignal.timeout(6_000)]),
        )
      ).map((address) => ({ address, family: 4 })));
  const transport = options.transport
    ? async (
        ...args: Parameters<RemoteDownloadTransport>
      ): Promise<RemoteStreamResponse> => {
        const response = await options.transport!(...args);
        return { ...response, chunks: singleChunk(response.bytes), close() {} };
      }
    : hasProviderHttpProxy(process.env.ARTIFACT_HTTP_PROXY)
      ? requestThroughProviderProxy
      : requestPinned;
  let current = parseRemoteUrl(value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      const resolved = await abortable(
        resolvePublicAddress(
          current,
          resolve,
          resolvePublic,
          controller.signal,
        ),
        controller.signal,
      );
      const recovered = await abortable(
        readRecoveredArtifact(
          current.href,
          maxBytes,
          options.recoveryDirectory,
        ),
        controller.signal,
      );
      if (recovered)
        return await consume(
          singleChunk(recovered.bytes),
          recovered.contentType,
        );
      const response = await abortable(
        transport(current, resolved, controller.signal, maxBytes),
        controller.signal,
      );
      try {
        if (response.status >= 300 && response.status < 400) {
          if (!response.location) {
            throw new Error("Provider output redirect is missing a location");
          }
          if (redirect === maxRedirects) {
            throw new Error("Provider output redirected too many times");
          }
          const next = parseRemoteUrl(new URL(response.location, current).href);
          if (current.protocol === "https:" && next.protocol !== "https:") {
            throw new Error(
              "Provider output redirect must not downgrade HTTPS",
            );
          }
          if (
            next.origin !== current.origin &&
            (current.protocol !== "https:" || next.protocol !== "https:")
          ) {
            throw new Error(
              "Provider output cross-origin redirects must use HTTPS",
            );
          }
          current = next;
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          throw new Error(
            `Provider output download failed with HTTP ${response.status}`,
          );
        }
        const bounded = (async function* () {
          let size = 0;
          for await (const chunk of response.chunks) {
            if (controller.signal.aborted)
              throw new Error("Provider output download timed out");
            size += chunk.byteLength;
            if (size > maxBytes)
              throw new Error(`Provider output exceeds ${maxBytes} bytes`);
            yield chunk;
          }
          if (controller.signal.aborted)
            throw new Error("Provider output download timed out");
        })();
        try {
          return await consume(bounded, response.contentType);
        } finally {
          await bounded.return(undefined);
        }
      } finally {
        await response.close();
      }
    }
    throw new Error("Provider output redirected too many times");
  } finally {
    clearTimeout(timeout);
  }
}

import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

export interface ResolvedAddress {
  address: string;
  family: number;
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
  transport?: RemoteDownloadTransport;
}

export interface RemoteDownloadResult {
  bytes: Uint8Array;
  contentType?: string;
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
  const [a = 0, b = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 88) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0) return false;
  if (a >= 224) return false;
  return true;
}

export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return ipv4IsPublic(address);
  if (family !== 6) return false;

  const normalized = address.toLowerCase().split("%")[0] ?? "";
  const dottedTail = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (dottedTail) return ipv4IsPublic(dottedTail);
  if (normalized.startsWith("2001:db8:")) return false;
  const firstSegment = normalized.split(":", 1)[0];
  if (!firstSegment) return false;
  const first = Number.parseInt(firstSegment, 16);
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
): Promise<ResolvedAddress> {
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
  // Clash/Mihomo Fake-IP mode maps public hostnames into RFC 2544's
  // 198.18.0.0/15 range. Only permit that mapping for HTTPS hostnames: an IP
  // literal remains blocked, and TLS still authenticates the original host.
  const canUseFakeIpDns =
    literalFamily === 0 &&
    url.protocol === "https:" &&
    addresses.every(({ address }) => isFakeIpDnsAddress(address));
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
): Promise<RemoteTransportResponse> {
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
      if (status >= 300 && status < 400 && location) {
        response.resume();
        resolve({ status, location, bytes: new Uint8Array() });
        return;
      }
      const declaredLength = Number(response.headers["content-length"]);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.destroy();
        reject(new Error(`Provider output exceeds ${maxBytes} bytes`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer | Uint8Array | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.byteLength;
        if (size > maxBytes) {
          response.destroy(
            new Error(`Provider output exceeds ${maxBytes} bytes`),
          );
          return;
        }
        chunks.push(bytes);
      });
      response.once("error", reject);
      response.once("end", () => {
        resolve({
          status,
          ...(contentType ? { contentType } : {}),
          bytes: new Uint8Array(Buffer.concat(chunks, size)),
        });
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

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new Error("Provider output download timed out"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("Provider output download timed out"));
    signal.addEventListener("abort", abort, { once: true });
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
  const transport = options.transport ?? requestPinned;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let current = parseRemoteUrl(value);

  try {
    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      const resolved = await abortable(
        resolvePublicAddress(current, resolve),
        controller.signal,
      );
      const response = await transport(
        current,
        resolved,
        controller.signal,
        maxBytes,
      );
      if (response.status >= 300 && response.status < 400) {
        if (!response.location) {
          throw new Error("Provider output redirect is missing a location");
        }
        if (redirect === maxRedirects) {
          throw new Error("Provider output redirected too many times");
        }
        const next = parseRemoteUrl(new URL(response.location, current).href);
        if (current.protocol === "https:" && next.protocol !== "https:") {
          throw new Error("Provider output redirect must not downgrade HTTPS");
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
      if (response.bytes.byteLength > maxBytes) {
        throw new Error(`Provider output exceeds ${maxBytes} bytes`);
      }
      return {
        bytes: response.bytes,
        ...(response.contentType ? { contentType: response.contentType } : {}),
      };
    }
    throw new Error("Provider output redirected too many times");
  } finally {
    clearTimeout(timeout);
  }
}

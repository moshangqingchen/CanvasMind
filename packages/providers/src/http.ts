import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import {
  fetch as undiciFetch,
  FormData as UndiciFormData,
  ProxyAgent,
} from "undici";

import type {
  FetchImplementation,
  ProviderAssetInput,
  ResolvedProviderConnection,
} from "./contracts.js";

export type ProviderRequestPhase =
  "connect" | "submit" | "poll" | "cancel" | "archive";

export type ProviderErrorKind =
  | "authentication"
  | "rate_limit"
  | "invalid_request"
  | "provider"
  | "network"
  | "timeout"
  | "invalid_response";

export class ProviderHttpError extends Error {
  public override readonly name = "ProviderHttpError";

  public constructor(
    message: string,
    public readonly details: {
      kind: ProviderErrorKind;
      phase: ProviderRequestPhase;
      retryable: boolean;
      /** True when blindly retrying could create a second paid generation. */
      submissionMayHaveOccurred: boolean;
      status?: number;
      responseBody?: unknown;
      cause?: unknown;
    },
  ) {
    super(message);
  }
}

export interface ProviderFetchOptions {
  phase: ProviderRequestPhase;
  timeoutMs?: number;
  /** Explicitly allow an exact loopback host for a user-managed local gateway. */
  allowLoopback?: boolean;
  /** Upper bound for the response body. Defaults are suitable for provider task metadata. */
  maxResponseBytes?: number;
  /** Set only when the remote endpoint honors this request's idempotency key. */
  idempotent?: boolean;
  allowEmpty?: boolean;
}

const DEFAULT_JSON_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_BINARY_RESPONSE_BYTES = 200 * 1024 * 1024;

let providerProxyUrl = "";
let providerProxy: ProxyAgent | undefined;

/**
 * Resolve the proxy at request time instead of module-load time. Next.js can
 * initialize the provider bundle before the local launcher has finished
 * loading `.local-public.env`; a one-time lookup would then silently fall
 * back to a direct connection (which commonly fails with EACCES on TUN/Fake-IP
 * networks).
 */
function currentProviderProxy(): ProxyAgent | undefined {
  const configured =
    process.env["PROVIDER_HTTP_PROXY"]?.trim() ||
    process.env["HTTPS_PROXY"]?.trim() ||
    process.env["HTTP_PROXY"]?.trim() ||
    "";
  if (configured === providerProxyUrl) return providerProxy;
  providerProxyUrl = configured;
  if (!configured) {
    providerProxy = undefined;
    return undefined;
  }
  try {
    providerProxy = new ProxyAgent(configured);
  } catch {
    providerProxy = undefined;
  }
  return providerProxy;
}

/**
 * Provider requests must use the same local proxy as the browser on machines
 * with a TUN/Fake-IP adapter. A caller can still inject a fetch implementation
 * in tests or for a provider-specific transport.
 */
const undiciProviderFetch = undiciFetch as unknown as FetchImplementation;

/**
 * Node's built-in fetch and the npm `undici` package each have their own
 * FormData implementation. A FormData object created by one implementation
 * is serialized as `[object FormData]` by the other instead of multipart
 * form-data. Keep the call sites on the platform FormData API, then convert
 * it at the transport boundary before using the npm undici client.
 */
function normalizeProviderRequestInit(
  init: RequestInit | undefined,
): RequestInit | undefined {
  if (!init?.body || typeof globalThis.FormData !== "function") return init;

  const body = init.body;
  if (
    !(body instanceof globalThis.FormData) ||
    body instanceof UndiciFormData
  ) {
    return init;
  }

  const form = new UndiciFormData();
  for (const [name, value] of body.entries()) {
    if (typeof value === "string") {
      form.append(name, value);
      continue;
    }

    const filename =
      typeof value.name === "string" && value.name.trim()
        ? value.name
        : "blob";
    form.append(name, value, filename);
  }

  return { ...init, body: form as unknown as BodyInit };
}

export const providerFetch: FetchImplementation = (input, init) => {
  // Keep test-injected/global fetch semantics unchanged. Production requests
  // use the npm undici client so the configured ProxyAgent remains supported.
  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true") {
    return fetch(input, init);
  }

  const normalizedInit = normalizeProviderRequestInit(init);
  const proxy = currentProviderProxy();
  return undiciProviderFetch(
    input,
    proxy === undefined
      ? normalizedInit
      : ({ ...normalizedInit, dispatcher: proxy } as RequestInit & {
          dispatcher: ProxyAgent;
        }),
  );
};

class ProviderResponseTooLargeError extends Error {
  public constructor(public readonly maxBytes: number) {
    super(`Provider response exceeds the ${maxBytes} byte limit`);
  }
}

class UnsafeProviderEndpointError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

const DEFINITELY_PRE_SUBMISSION_CODES = new Set([
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function statusKind(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limit";
  if (status >= 400 && status < 500) return "invalid_request";
  return "provider";
}

function isReservedTestHost(hostname: string): boolean {
  return hostname === "test" || hostname.endsWith(".test");
}

function parseIpv4(value: string): readonly number[] | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== parts[index],
    )
  ) {
    return undefined;
  }
  return octets;
}

function isBlockedIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const [first, second] = octets;
  if (first === undefined) return false;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second !== undefined && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/gu, "");
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    return isBlockedIpv4(normalized.slice("::ffff:".length));
  }
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return false;
}

/**
 * Provider credentials must never be sent to loopback, private-network, or
 * cloud metadata endpoints. RFC-reserved `.test` names are used by injected
 * fetch implementations in tests and are intentionally exempt from DNS lookup.
 */
export async function assertSafeProviderEndpoint(
  url: string,
  options: { allowLoopback?: boolean } = {},
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeProviderEndpointError(
      "Provider endpoint is not a valid URL",
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new UnsafeProviderEndpointError(
      "Provider endpoint must use HTTP or HTTPS",
    );
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeProviderEndpointError(
      "Provider endpoint must not include credentials",
    );
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (isReservedTestHost(hostname)) return;
  if (
    options.allowLoopback === true &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
  )
    return;
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".internal") ||
    isBlockedAddress(hostname)
  ) {
    throw new UnsafeProviderEndpointError(
      "Provider endpoint resolves to a local or private network address",
    );
  }

  // Resolve all records instead of accepting a hostname solely on its name.
  // This stops simple DNS aliases for private networks before credentials are
  // sent. A lookup failure is left to fetch so it retains normal network error
  // classification and compatibility with custom transports.
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.some((entry) => isBlockedAddress(entry.address))) {
      throw new UnsafeProviderEndpointError(
        "Provider endpoint resolves to a local or private network address",
      );
    }
  } catch (error) {
    if (error instanceof UnsafeProviderEndpointError) throw error;
  }
}

function responseContentLength(response: Response): number | undefined {
  const raw = response.headers.get("content-length");
  if (raw === null || !/^\d+$/u.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declaredLength = responseContentLength(response);
  if (declaredLength !== undefined && declaredLength > maxBytes) {
    throw new ProviderResponseTooLargeError(maxBytes);
  }

  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > maxBytes)
      throw new ProviderResponseTooLargeError(maxBytes);
    return data;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ProviderResponseTooLargeError(maxBytes);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

function statusRetryable(
  status: number,
  options: ProviderFetchOptions,
): boolean {
  if (status === 429) return true;
  if (status < 500) return false;
  return options.phase !== "submit" || options.idempotent === true;
}

export function providerTransportErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof current !== "object" || current === null || seen.has(current))
      return undefined;
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (typeof record["code"] === "string") return record["code"].toUpperCase();
    current = record["cause"];
  }
  return undefined;
}

function submissionMayHaveOccurred(
  phase: ProviderRequestPhase,
  status?: number,
  error?: unknown,
): boolean {
  if (phase !== "submit") return false;
  if (status === undefined) {
    const code = providerTransportErrorCode(error);
    if (code !== undefined && DEFINITELY_PRE_SUBMISSION_CODES.has(code)) {
      return false;
    }
    return true;
  }
  // An explicit 4xx rejection means the provider did not accept a task. A
  // lost successful body, transport failure, or 5xx can be ambiguous and must
  // not be blindly retried.
  return !(status >= 400 && status < 500);
}

async function readResponseBody(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = new TextDecoder().decode(
    await readResponseBytes(response, maxBytes),
  );
  if (text.length === 0) return undefined;
  if (contentType.includes("json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text.slice(0, 4_096);
    }
  }
  return text.slice(0, 4_096);
}

export async function fetchProviderJson<T>(
  fetchImpl: FetchImplementation,
  url: string,
  init: RequestInit,
  options: ProviderFetchOptions,
): Promise<T> {
  try {
    await assertSafeProviderEndpoint(
      url,
      options.allowLoopback ? { allowLoopback: true } : {},
    );
  } catch (error) {
    throw new ProviderHttpError("Provider endpoint is not allowed", {
      kind: "invalid_request",
      phase: options.phase,
      retryable: false,
      submissionMayHaveOccurred: false,
      cause: error,
    });
  }
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
    });
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const mayHaveOccurred = submissionMayHaveOccurred(
      options.phase,
      undefined,
      error,
    );
    clearTimeout(timeout);
    throw new ProviderHttpError(
      timedOut
        ? "Provider request timed out"
        : "Provider network request failed",
      {
        kind: timedOut ? "timeout" : "network",
        phase: options.phase,
        retryable:
          !mayHaveOccurred ||
          options.phase !== "submit" ||
          options.idempotent === true,
        submissionMayHaveOccurred: mayHaveOccurred,
        cause: error,
      },
    );
  }

  let body: unknown;
  try {
    body = await readResponseBody(
      response,
      options.maxResponseBytes ?? DEFAULT_JSON_RESPONSE_BYTES,
    );
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof ProviderResponseTooLargeError && !response.ok) {
      body = `Provider response exceeded ${error.maxBytes} bytes`;
    } else {
      throw new ProviderHttpError("Unable to read provider response", {
        kind:
          error instanceof ProviderResponseTooLargeError
            ? "invalid_response"
            : "network",
        phase: options.phase,
        retryable: options.phase !== "submit" || options.idempotent === true,
        submissionMayHaveOccurred: submissionMayHaveOccurred(
          options.phase,
          response.status,
        ),
        status: response.status,
        ...(error instanceof ProviderResponseTooLargeError
          ? {
              responseBody: {
                code: "response_too_large",
                message: error.message,
              },
            }
          : {}),
        cause: error,
      });
    }
  }
  clearTimeout(timeout);
  if (!response.ok) {
    throw new ProviderHttpError(`Provider returned HTTP ${response.status}`, {
      kind: statusKind(response.status),
      phase: options.phase,
      status: response.status,
      retryable: statusRetryable(response.status, options),
      submissionMayHaveOccurred: submissionMayHaveOccurred(
        options.phase,
        response.status,
      ),
      responseBody: body,
    });
  }
  if (body === undefined && options.allowEmpty !== true) {
    throw new ProviderHttpError("Provider returned an empty response", {
      kind: "invalid_response",
      phase: options.phase,
      retryable: false,
      submissionMayHaveOccurred: submissionMayHaveOccurred(
        options.phase,
        response.status,
      ),
      status: response.status,
      responseBody: {
        code: "empty_response",
        message: "Provider returned an empty response",
      },
    });
  }
  return body as T;
}

export async function fetchProviderBytes(
  fetchImpl: FetchImplementation,
  url: string,
  options: Omit<ProviderFetchOptions, "allowEmpty">,
): Promise<{ data: Uint8Array; mimeType?: string }> {
  try {
    await assertSafeProviderEndpoint(
      url,
      options.allowLoopback ? { allowLoopback: true } : {},
    );
  } catch (error) {
    throw new ProviderHttpError("Provider endpoint is not allowed", {
      kind: "invalid_request",
      phase: options.phase,
      retryable: false,
      submissionMayHaveOccurred: false,
      cause: error,
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 60_000,
  );
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) {
      throw new ProviderHttpError(
        `Asset download returned HTTP ${response.status}`,
        {
          kind: statusKind(response.status),
          phase: options.phase,
          status: response.status,
          retryable: statusRetryable(response.status, options),
          submissionMayHaveOccurred: false,
        },
      );
    }
    const data = await readResponseBytes(
      response,
      options.maxResponseBytes ?? DEFAULT_BINARY_RESPONSE_BYTES,
    );
    const mimeType = response.headers.get("content-type") ?? undefined;
    return mimeType === undefined ? { data } : { data, mimeType };
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error;
    const timedOut = controller.signal.aborted;
    throw new ProviderHttpError(
      timedOut
        ? "Asset download timed out"
        : error instanceof ProviderResponseTooLargeError
          ? "Provider asset response is too large"
          : "Asset download failed",
      {
        kind: timedOut
          ? "timeout"
          : error instanceof ProviderResponseTooLargeError
            ? "invalid_response"
            : "network",
        phase: options.phase,
        retryable: true,
        submissionMayHaveOccurred: false,
        cause: error,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;
}

export function mergeHeaders(
  ...sources: readonly (HeadersInit | undefined)[]
): Headers {
  const result = new Headers();
  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => result.set(key, value));
  }
  return result;
}

export function requireApiKey(connection: ResolvedProviderConnection): string {
  if (!connection.apiKey) {
    throw new ProviderHttpError("Provider API key is not configured", {
      kind: "authentication",
      phase: "connect",
      retryable: false,
      submissionMayHaveOccurred: false,
    });
  }
  return connection.apiKey;
}

function parseDataUrl(
  url: string,
): { data: Uint8Array; mimeType: string } | undefined {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/su.exec(url);
  if (!match) return undefined;
  const mimeType = match[1] || "application/octet-stream";
  const payload = match[3] ?? "";
  const data = match[2]
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return { data, mimeType };
}

export async function assetToBlob(
  asset: ProviderAssetInput,
  fetchImpl: FetchImplementation,
): Promise<Blob> {
  const asArrayBuffer = (data: Uint8Array): ArrayBuffer => {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
  };
  if (asset.data)
    return new Blob([asArrayBuffer(asset.data)], { type: asset.mimeType });
  if (!asset.url)
    throw new Error(`Asset ${asset.id} has neither bytes nor a URL`);
  const dataUrl = parseDataUrl(asset.url);
  if (dataUrl)
    return new Blob([asArrayBuffer(dataUrl.data)], { type: dataUrl.mimeType });
  const downloaded = await fetchProviderBytes(fetchImpl, asset.url, {
    phase: "archive",
  });
  return new Blob([asArrayBuffer(downloaded.data)], {
    type: downloaded.mimeType ?? asset.mimeType,
  });
}

export function assetAsUrl(asset: ProviderAssetInput): string | undefined {
  if (asset.url) return asset.url;
  if (!asset.data) return undefined;
  return `data:${asset.mimeType};base64,${Buffer.from(asset.data).toString("base64")}`;
}

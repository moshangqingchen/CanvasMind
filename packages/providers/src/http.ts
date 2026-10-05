import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AsyncLocalStorage } from "node:async_hooks";
import { channel } from "node:diagnostics_channel";
import type { Readable } from "node:stream";
import { createAutoNetworkConnector } from "./direct-network.js";

import {
  Agent,
  fetch as undiciFetch,
  request as undiciRequest,
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
      /** Positive evidence that execution stopped before sending any request. */
      requestNotSent?: true;
      status?: number;
      responseBody?: unknown;
      cause?: unknown;
      /** Non-sensitive transport evidence; never request headers, URLs or bodies. */
      transport?: {
        elapsedMs: number;
        stage: "awaiting_headers" | "reading_body";
        responseBytes: number;
        errorCode?: string;
        socketBytesRead?: number;
        socketBytesWritten?: number;
        localAddress?: string;
        remoteAddress?: string;
        localPort?: number;
        remotePort?: number;
        route?: "physical-direct" | "system" | "system-fake-ip" | "explicit-proxy";
        fallbackReason?: "normal_dns" | "transport_constraints" | "physical_tls_unreachable";
      };
    },
  ) {
    super(message);
  }
}

export interface ProviderFetchOptions {
  phase: ProviderRequestPhase;
  /** Zero waits for the response until completion or explicit cancellation. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Explicitly allow an exact loopback host for a user-managed local gateway. */
  allowLoopback?: boolean;
  /** Upper bound for the response body. Defaults are suitable for provider task metadata. */
  maxResponseBytes?: number;
  /** Set only when the remote endpoint honors this request's idempotency key. */
  idempotent?: boolean;
  allowEmpty?: boolean;
  cloudPolling?: {
    urlTemplate: string; method: string; headers: Record<string, string>; body?: string;
    submitMapping?: Record<string, unknown>; pollMapping?: Record<string, unknown>;
    statusMap?: Readonly<Record<string, string>>; intervalMs?: number;
  };
}

export type ProviderSubmitTransport = (url: string, init: RequestInit, options: ProviderFetchOptions) => Promise<Response>;
const submitTransport = new AsyncLocalStorage<ProviderSubmitTransport>();

/** Scoped to one paid submission, never to catalog reads or other concurrent runs. */
export function withProviderSubmitTransport<T>(transport: ProviderSubmitTransport, work: () => Promise<T>): Promise<T> {
  return submitTransport.run(transport, work);
}
export const providerSubmitTransportActive = () => Boolean(submitTransport.getStore());
export type ProviderSubmissionPhase = "cloud_queued" | "waiting_provider" | "generating" | "receiving" | "cloud_saving" | "downloading";
const submissionProgress = new AsyncLocalStorage<(phase: ProviderSubmissionPhase) => Promise<void>>();
const submissionSignal = new AsyncLocalStorage<AbortSignal>();
export function withProviderSubmissionProgress<T>(progress: (phase: ProviderSubmissionPhase) => Promise<void>, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return submissionProgress.run(progress, () => signal ? submissionSignal.run(signal, work) : work());
}

const DEFAULT_JSON_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_BINARY_RESPONSE_BYTES = 200 * 1024 * 1024;

const providerProxies = new Map<string, ProxyAgent>();
const providerTimeoutAgents = new Map<number, Agent>();
const requestTransportTimeout = new AsyncLocalStorage<number>();
const TCP_KEEPALIVE = { keepAlive: true, keepAliveInitialDelay: 30_000 };
const autoNetworkConnector = createAutoNetworkConnector();

type TransportPath = Pick<NonNullable<ProviderHttpError["details"]["transport"]>, "localAddress" | "remoteAddress" | "localPort" | "remotePort" | "route" | "fallbackReason">;
interface RequestTransportTrace { origin: string; path: TransportPath }
interface TransportTraceRegistry {
  scope: AsyncLocalStorage<RequestTransportTrace>;
  requests: WeakMap<object, RequestTransportTrace>;
}
const traceGlobal = globalThis as typeof globalThis & { __superCanvasProviderTransportTrace?: TransportTraceRegistry };
const transportTrace = traceGlobal.__superCanvasProviderTransportTrace ??= (() => {
  const registry: TransportTraceRegistry = { scope: new AsyncLocalStorage(), requests: new WeakMap() };
  channel("undici:request:create").subscribe(message => {
    const request = (message as { request?: object & { origin?: unknown } }).request;
    const trace = registry.scope.getStore();
    // Connector DNS reads share the async context but are not this request.
    if (request && trace && String(request.origin) === trace.origin) registry.requests.set(request, trace);
  });
  channel("undici:client:sendHeaders").subscribe(message => {
    const { request, socket } = message as { request?: object; socket?: object };
    const trace = request && registry.requests.get(request);
    if (!trace || !socket) return;
    recordSocketPath(trace.path, socket);
    const route = (socket as Record<symbol, unknown>)[Symbol.for("super-canvas.provider-route")];
    if (trace.path.route !== "explicit-proxy" && ["physical-direct", "system", "system-fake-ip"].includes(String(route)))
      trace.path.route = route as NonNullable<TransportPath["route"]>;
    const fallback = (socket as Record<symbol, unknown>)[Symbol.for("super-canvas.provider-fallback-reason")];
    if (["normal_dns", "transport_constraints", "physical_tls_unreachable"].includes(String(fallback)))
      trace.path.fallbackReason = fallback as NonNullable<TransportPath["fallbackReason"]>;
  });
  return registry;
})();

function recordSocketPath(path: TransportPath, socket: object): void {
  for (const field of ["localAddress", "remoteAddress"] as const) {
    const address = (socket as Record<string, unknown>)[field];
    if (typeof address === "string" && isIP(address)) path[field] = address;
  }
  for (const field of ["localPort", "remotePort"] as const) {
    const port = (socket as Record<string, unknown>)[field];
    if (typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535) path[field] = port;
  }
  if (path.route !== "explicit-proxy" && /^198\.(?:18|19)\./u.test(path.remoteAddress ?? "")) path.route = "system-fake-ip";
}

class ProviderProxyConfigurationError extends Error {
  public readonly code = "INVALID_PROVIDER_PROXY";
  constructor() { super("Configured provider proxy is invalid; no provider request was sent"); }
}

function transportTimeoutOptions(timeoutMs?: number): {
  headersTimeout: number;
  bodyTimeout: number;
} | undefined {
  if (
    typeof timeoutMs !== "number" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0
  ) return undefined;
  return { headersTimeout: timeoutMs, bodyTimeout: timeoutMs };
}

function currentProviderTimeoutAgent(timeoutMs?: number): Agent | undefined {
  const options = transportTimeoutOptions(timeoutMs);
  if (!options) return undefined;
  const cached = providerTimeoutAgents.get(options.headersTimeout);
  if (cached) return cached;
  const agent = new Agent({ ...options, connect: autoNetworkConnector });
  providerTimeoutAgents.set(options.headersTimeout, agent);
  return agent;
}

/**
 * An explicitly configured proxy always takes precedence over automatic
 * network selection. Invalid proxy settings must never enable direct access.
 */
function currentProviderProxy(
  override?: string,
  timeoutMs?: number,
): ProxyAgent | undefined {
  const configured =
    override?.trim() ||
    process.env["PROVIDER_HTTP_PROXY"]?.trim() ||
    process.env["HTTPS_PROXY"]?.trim() ||
    process.env["HTTP_PROXY"]?.trim() ||
    "";
  if (!configured) return undefined;
  const timeoutOptions = transportTimeoutOptions(timeoutMs);
  const cacheKey = JSON.stringify([configured, timeoutOptions?.headersTimeout]);
  const cached = providerProxies.get(cacheKey);
  if (cached) return cached;
  try {
    if (!["http:", "https:", "socks:", "socks5:"].includes(new URL(configured).protocol))
      throw new ProviderProxyConfigurationError();
    const proxy = new ProxyAgent({ uri: configured, ...timeoutOptions,
      ...(timeoutOptions ? { requestTls: TCP_KEEPALIVE, proxyTls: TCP_KEEPALIVE } : {}),
    });
    providerProxies.set(cacheKey, proxy);
    return proxy;
  } catch {
    // URL parser errors may contain proxy credentials. Do not retain their
    // messages or causes, and never fall through to the direct dispatcher.
    throw new ProviderProxyConfigurationError();
  }
}

/** Whether downloads should use the same explicitly configured provider proxy. */
export function hasProviderHttpProxy(override?: string): boolean {
  return currentProviderProxy(override) !== undefined;
}

/**
 * Explicit proxy settings remain authoritative. Otherwise, the shared
 * connector selects the local network before sending any provider bytes.
 * Callers can inject a fetch implementation for tests or custom transports.
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

export const fetchWithProviderHttpProxy = (
  input: Parameters<FetchImplementation>[0],
  init?: Parameters<FetchImplementation>[1],
  proxyOverride?: string,
  timeoutMs?: number,
): ReturnType<FetchImplementation> => {
  // Keep test-injected/global fetch semantics unchanged. Production requests
  // use the npm undici client so the configured ProxyAgent remains supported.
  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true") {
    return fetch(input, init);
  }

  const normalizedInit = normalizeProviderRequestInit(init);
  const effectiveTimeoutMs = timeoutMs ?? requestTransportTimeout.getStore();
  // Undici's default header/body timers are 300 seconds, independent of the
  // caller's AbortSignal. An explicit request budget must reach the transport
  // for long synchronous generations, including those using a CONNECT proxy.
  const proxy = currentProviderProxy(proxyOverride, effectiveTimeoutMs);
  const dispatcher = proxy ?? currentProviderTimeoutAgent(effectiveTimeoutMs);
  const trace = transportTrace.scope.getStore();
  if (trace) trace.path.route = proxy ? "explicit-proxy" : "system";
  return undiciProviderFetch(
    input,
    dispatcher === undefined
      ? normalizedInit
      : ({ ...normalizedInit, dispatcher } as RequestInit & {
          dispatcher: Agent | ProxyAgent;
        }),
  );
};

function providerBodyToWeb(body: Readable): ReadableStream<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  let closed = false;
  // Undici may emit an AbortError when destroyed before the first pull. Its
  // iterator still observes active read errors; this covers cancellation gaps.
  body.on("error", () => {});
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        // Cancellation closes the Web controller before an in-flight Node read
        // settles. Never enqueue or error into that already-closed controller.
        if (closed) return;
        if (done) {
          closed = true;
          controller.close();
        } else {
          controller.enqueue(
            value instanceof Uint8Array ? value : Buffer.from(value),
          );
        }
      } catch (error) {
        if (closed) return;
        closed = true;
        controller.error(error);
      }
    },
    async cancel(reason) {
      closed = true;
      body.destroy(reason instanceof Error ? reason : undefined);
      await iterator.return?.().catch(() => undefined);
    },
  });
}

/**
 * Fetch replaces Host with the URL authority. Pinned plain-HTTP artifact
 * downloads need the validated IP as their authority and the original virtual
 * host in their headers, so use Undici's lower-level request API on this path.
 * The runtime remains responsible for validating the destination and redirects.
 */
export async function fetchWithPinnedProviderHttpProxy(
  url: string,
  options: {
    host: string;
    headers?: HeadersInit;
    signal: AbortSignal;
    proxyOverride?: string;
  },
): Promise<Response> {
  if (new URL(url).protocol !== "http:") {
    throw new Error("Pinned proxy artifact download must use HTTP");
  }
  const headers = new Headers(options.headers);
  headers.set("host", options.host);
  // Unlike fetch, request returns the encoded wire bytes. Keep artifact bytes
  // in their original media format instead of accidentally archiving gzip.
  headers.set("accept-encoding", "identity");
  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true") {
    return fetch(url, {
      method: "GET",
      headers: Object.fromEntries(headers),
      redirect: "manual",
      signal: options.signal,
    });
  }
  const timeoutMs = requestTransportTimeout.getStore();
  const dispatcher =
    currentProviderProxy(options.proxyOverride, timeoutMs) ??
    currentProviderTimeoutAgent(timeoutMs);
  const response = await undiciRequest(url, {
    method: "GET",
    headers: Object.fromEntries(headers),
    signal: options.signal,
    // The lower-level request API does not follow redirects. This dispatcher
    // has no redirect interceptor; each next hop remains the runtime's job.
    ...(dispatcher ? { dispatcher } : {}),
  });
  const contentEncoding = response.headers["content-encoding"];
  const encodings = (
    Array.isArray(contentEncoding) ? contentEncoding : [contentEncoding ?? ""]
  ).flatMap((value) =>
    value.split(",").map((entry) => entry.trim().toLowerCase()),
  );
  const emptyBody = [204, 205, 304].includes(response.statusCode);
  if (
    response.statusCode >= 200 &&
    response.statusCode < 300 &&
    !emptyBody &&
    encodings.some((encoding) => encoding && encoding !== "identity")
  ) {
    // Undici reports destruction as a body AbortError. Observe it before
    // cancelling so our explicit encoding error is the only caller failure.
    response.body.on("error", () => {});
    response.body.destroy();
    throw new Error("Provider output Content-Encoding must be identity");
  }
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      responseHeaders.append(name, item);
    }
  }
  const discardBody =
    emptyBody || response.statusCode < 200 || response.statusCode >= 300;
  if (discardBody) {
    // Only successful entity bodies can be artifacts. Cancel other bodies
    // directly, retaining status/Location without waiting for error payloads.
    response.body.on("error", () => {});
    response.body.destroy();
  }
  return new Response(discardBody ? null : providerBodyToWeb(response.body), {
    status: response.statusCode,
    headers: responseHeaders,
  });
}

export const providerFetch: FetchImplementation = fetchWithProviderHttpProxy;

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
  "PROVIDER_NETWORK_DISCOVERY_FAILED",
  "ECONNREFUSED",
  "ENETUNREACH",
  "ENETDOWN",
  "EADDRNOTAVAIL",
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
  // URL normalization also compresses expanded DNS answers and converts an
  // IPv4-mapped dotted suffix to its two hexadecimal words.
  let normalized: string;
  try {
    normalized = new URL(`http://[${address.replace(/^\[|\]$/gu, "")}]`)
      .hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  } catch {
    return true;
  }
  if (normalized === "::" || normalized === "::1") return true;
  const mapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/u.exec(normalized);
  if (mapped) {
    const high = Number.parseInt(mapped[1]!, 16);
    const low = Number.parseInt(mapped[2]!, 16);
    return isBlockedIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  const [first, second] = normalized.split(":", 2).map(value => Number.parseInt(value, 16));
  // Only global unicast addresses can receive provider credentials. This also
  // excludes multicast, deprecated site-local and IPv4-compatible forms.
  return first === undefined || !Number.isFinite(first) || first < 0x2000 || first > 0x3fff ||
    (first === 0x2001 && second === 0xdb8);
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

/** Bound custom transports and DNS as well as fetch, and observe late failures. */
function withRequestSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    void work.then(
      value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

function awaitProviderResponse(work: Promise<Response>, signal: AbortSignal): Promise<Response> {
  return withRequestSignal(work.then(response => {
    if (signal.aborted) {
      void response.body?.cancel().catch(() => undefined);
      signal.throwIfAborted();
    }
    return response;
  }), signal);
}

async function validateRequestEndpoint(
  url: string,
  options: ProviderFetchOptions,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<void> {
  try {
    signal.throwIfAborted();
    await withRequestSignal(assertSafeProviderEndpoint(
      url,
      options.allowLoopback ? { allowLoopback: true } : {},
    ), signal);
    signal.throwIfAborted();
  } catch (error) {
    const timedOut = timeoutSignal.aborted;
    const cancelled = !timedOut && signal.aborted;
    throw new ProviderHttpError(
      timedOut ? "Provider request timed out"
        : cancelled ? "Provider request was cancelled" : "Provider endpoint is not allowed",
      {
        kind: timedOut ? "timeout" : cancelled ? "network" : "invalid_request",
        phase: options.phase,
        retryable: timedOut,
        submissionMayHaveOccurred: false,
        requestNotSent: true,
        cause: error,
      },
    );
  }
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
  progress?: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const declaredLength = responseContentLength(response);
  if (declaredLength !== undefined && declaredLength > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new ProviderResponseTooLargeError(maxBytes);
  }

  if (!response.body) {
    const read = response.arrayBuffer();
    const data = new Uint8Array(await (signal ? withRequestSignal(read, signal) : read));
    progress?.(data.byteLength);
    if (data.byteLength > maxBytes)
      throw new ProviderResponseTooLargeError(maxBytes);
    return data;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let completed = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      const read = reader.read();
      const next = await (signal ? withRequestSignal(read, signal) : read);
      if (next.done) { completed = true; break; }
      length += next.value.byteLength;
      progress?.(length);
      if (length > maxBytes) {
        throw new ProviderResponseTooLargeError(maxBytes);
      }
      chunks.push(next.value);
    }
  } finally {
    // A custom stream may not listen to fetch's signal. Cancel its pending
    // read explicitly, without letting a stalled cancellation block the caller.
    if (!completed) void reader.cancel().catch(() => undefined);
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

function transportEvidence(
  error: unknown,
  startedAt: number,
  stage: "awaiting_headers" | "reading_body",
  responseBytes: number,
  path?: TransportPath,
): NonNullable<ProviderHttpError["details"]["transport"]> {
  const evidence: NonNullable<ProviderHttpError["details"]["transport"]> = {
    elapsedMs: Math.max(0, Date.now() - startedAt), stage, responseBytes, ...path,
  };
  const code = providerTransportErrorCode(error);
  if (code && /^[A-Z0-9_]{1,80}$/u.test(code)) evidence.errorCode = code;
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof current !== "object" || current === null || seen.has(current)) break;
    seen.add(current);
    const value = current as Record<string, unknown>;
    const socket = value["socket"];
    if (typeof socket === "object" && socket !== null) {
      for (const [field, target] of [["bytesRead", "socketBytesRead"], ["bytesWritten", "socketBytesWritten"]] as const) {
        const count = (socket as Record<string, unknown>)[field];
        if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) evidence[target] = count;
      }
      recordSocketPath(evidence, socket);
    }
    current = value["cause"];
  }
  return evidence;
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
  progress?: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = new TextDecoder().decode(
    await readResponseBytes(response, maxBytes, progress, signal),
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
  const startedAt = Date.now();
  const signals = [init.signal, options.signal, submissionSignal.getStore()].filter((signal): signal is AbortSignal => Boolean(signal));
  const callerSignal = signals.length ? AbortSignal.any(signals) : undefined;
  const controller = new AbortController();
  const cloudTransport = options.phase === "submit" ? submitTransport.getStore() : undefined;
  const timeoutMs = cloudTransport ? 31 * 60_000 : options.timeoutMs ?? 60_000;
  const timeout = timeoutMs === 0 ? undefined : setTimeout(() => controller.abort(), timeoutMs);
  const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal;
  try {
    await validateRequestEndpoint(url, options, signal, controller.signal);
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
  const trace: RequestTransportTrace = { origin: new URL(url).origin, path: {} };
  let response: Response;
  let receivedResponse: Response | undefined;
  let requestStarted = false;
  try {
    const requestInit: RequestInit = {
      ...init,
      signal,
      redirect: "error",
    };
    const progress = options.phase === "submit" && !cloudTransport ? submissionProgress.getStore() : undefined;
    if (progress) await withRequestSignal(progress("waiting_provider"), signal);
    // Progress persistence can yield to cancellation; no supplier call may
    // start after that boundary, even if a custom transport ignores signals.
    signal.throwIfAborted();
    requestStarted = true;
    response = await awaitProviderResponse(cloudTransport
      ? cloudTransport(url, requestInit, options)
      : transportTrace.scope.run(trace, () => requestTransportTimeout.run(timeoutMs, () => fetchImpl(url, requestInit))), signal);
    receivedResponse = response;
    if (progress && response.ok) await withRequestSignal(progress("receiving"), signal);
  } catch (error) {
    // The body reader has not taken ownership while a progress callback is
    // running. Release the response here if that callback fails or stalls.
    void receivedResponse?.body?.cancel().catch(() => undefined);
    if (error instanceof ProviderProxyConfigurationError && !receivedResponse) {
      clearTimeout(timeout);
      throw new ProviderHttpError(error.message, {
        kind: "invalid_request", phase: options.phase, retryable: false,
        submissionMayHaveOccurred: false,
        requestNotSent: true,
        transport: transportEvidence(error, startedAt, "awaiting_headers", 0, trace.path),
      });
    }
    const timedOut = controller.signal.aborted;
    const cancelled = !timedOut && callerSignal?.aborted === true;
    const mayHaveOccurred = requestStarted && submissionMayHaveOccurred(
      options.phase,
      receivedResponse?.status,
      error,
    );
    clearTimeout(timeout);
    // A receiving-progress callback runs after the provider answered. Its own
    // connection error cannot turn this accepted request into a safe retry.
    if (error instanceof ProviderHttpError && !receivedResponse) throw error;
    throw new ProviderHttpError(
      timedOut
        ? "Provider request timed out"
        : cancelled
          ? "Provider request was cancelled"
          : "Provider network request failed",
      {
        kind: timedOut ? "timeout" : "network",
        phase: options.phase,
        retryable:
          !cancelled &&
          (!mayHaveOccurred ||
            options.phase !== "submit" ||
            options.idempotent === true),
        submissionMayHaveOccurred: mayHaveOccurred,
        ...(!receivedResponse && (!requestStarted || DEFINITELY_PRE_SUBMISSION_CODES.has(providerTransportErrorCode(error) ?? "")) ? { requestNotSent: true as const } : {}),
        transport: transportEvidence(error, startedAt, "awaiting_headers", 0, trace.path),
        cause: error,
      },
    );
  }

  let body: unknown;
  let responseBytes = 0;
  try {
    body = await readResponseBody(
      response,
      options.maxResponseBytes ?? DEFAULT_JSON_RESPONSE_BYTES,
      bytes => { responseBytes = bytes; },
      signal,
    );
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof ProviderResponseTooLargeError && !response.ok) {
      body = `Provider response exceeded ${error.maxBytes} bytes`;
    } else {
      const timedOut = controller.signal.aborted;
      const cancelled = !timedOut && callerSignal?.aborted === true;
      throw new ProviderHttpError(
        timedOut
          ? "Provider request timed out"
          : cancelled
            ? "Provider request was cancelled"
            : "Unable to read provider response",
        {
          kind:
            error instanceof ProviderResponseTooLargeError
              ? "invalid_response"
              : timedOut ? "timeout" : "network",
          phase: options.phase,
          retryable: !cancelled && !(error instanceof ProviderResponseTooLargeError) &&
            (options.phase !== "submit" || options.idempotent === true),
          submissionMayHaveOccurred: submissionMayHaveOccurred(
            options.phase,
            response.status,
          ),
          status: response.status,
          transport: transportEvidence(error, startedAt, "reading_body", responseBytes, trace.path),
          ...(error instanceof ProviderResponseTooLargeError
            ? {
                responseBody: {
                  code: "response_too_large",
                  message: error.message,
                },
              }
            : {}),
          cause: error,
        },
      );
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
      transport: transportEvidence(undefined, startedAt, "reading_body", responseBytes, trace.path),
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
  if (cloudTransport && response.headers.has("x-supercanvas-upstream-task")) {
    return { __superCanvasCloudPoll: decodeURIComponent(response.headers.get("x-supercanvas-upstream-task")!), remote: body } as T;
  }
  return body as T;
}

export async function fetchProviderBytes(
  fetchImpl: FetchImplementation,
  url: string,
  options: Omit<ProviderFetchOptions, "allowEmpty">,
): Promise<{ data: Uint8Array; mimeType?: string }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const timeout = timeoutMs === 0 ? undefined : setTimeout(() => controller.abort(), timeoutMs);
  const signals = [options.signal, submissionSignal.getStore()].filter((signal): signal is AbortSignal => Boolean(signal));
  const callerSignal = signals.length ? AbortSignal.any(signals) : undefined;
  const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal;
  try {
    await validateRequestEndpoint(url, options, signal, controller.signal);
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
  const trace: RequestTransportTrace = { origin: new URL(url).origin, path: {} };
  let stage: "awaiting_headers" | "reading_body" = "awaiting_headers";
  let responseBytes = 0;
  try {
    signal.throwIfAborted();
    const response = await awaitProviderResponse(transportTrace.scope.run(trace, () => requestTransportTimeout.run(timeoutMs, () => fetchImpl(url, {
      signal,
      redirect: "error",
    }))), signal);
    stage = "reading_body";
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new ProviderHttpError(
        `Asset download returned HTTP ${response.status}`,
        {
          kind: statusKind(response.status),
          phase: options.phase,
          status: response.status,
          retryable: statusRetryable(response.status, options),
          submissionMayHaveOccurred: false,
          transport: transportEvidence(undefined, startedAt, stage, responseBytes, trace.path),
        },
      );
    }
    const data = await readResponseBytes(
      response,
      options.maxResponseBytes ?? DEFAULT_BINARY_RESPONSE_BYTES,
      bytes => { responseBytes = bytes; },
      signal,
    );
    const mimeType = response.headers.get("content-type") ?? undefined;
    return mimeType === undefined ? { data } : { data, mimeType };
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error;
    if (error instanceof ProviderProxyConfigurationError) {
      throw new ProviderHttpError(error.message, {
        kind: "invalid_request", phase: options.phase, retryable: false,
        submissionMayHaveOccurred: false,
        transport: transportEvidence(error, startedAt, stage, responseBytes, trace.path),
      });
    }
    const timedOut = controller.signal.aborted;
    const cancelled = !timedOut && callerSignal?.aborted === true;
    throw new ProviderHttpError(
      timedOut
        ? "Asset download timed out"
        : cancelled ? "Asset download was cancelled"
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
        retryable: !cancelled && !(error instanceof ProviderResponseTooLargeError),
        submissionMayHaveOccurred: false,
        transport: transportEvidence(error, startedAt, stage, responseBytes, trace.path),
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

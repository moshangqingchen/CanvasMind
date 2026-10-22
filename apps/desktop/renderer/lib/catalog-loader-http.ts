import { ModelInventoryReadError } from "./model-inventory-failure";

/** A collector receives its transport from the read dispatcher. It must never
 * fall back to a process fetch, repeat an HTTP request, or open a site session. */
export interface CatalogLoaderReadOptions {
  fetch: typeof fetch;
  signal?: AbortSignal;
  checkedAt?: string;
  /** Total directory headers/body deadline, bounded by the existing 60s read budget. */
  timeoutMs?: number;
}

/** Consume one bounded response. No response body escapes a failed read. */
export async function readCatalogLoaderText(url: string, options: CatalogLoaderReadOptions,
  maximumBytes = 4 * 1024 * 1024): Promise<string> {
  options.signal?.throwIfAborted();
  const timeoutMs = Math.min(options.timeoutMs ?? 60_000, 60_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new ModelInventoryReadError("invalid_configuration");
  const deadline = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(new ModelInventoryReadError("timeout")), timeoutMs);
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void (reader ? reader.cancel(signal.reason) : response?.body?.cancel(signal.reason))?.catch(() => undefined); };
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => { cancel(); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const transfer = async () => {
    response = await options.fetch(url, { method: "GET", cache: "no-store", redirect: "error", signal });
    // A custom transport can ignore cancellation and deliver headers later.
    if (signal.aborted) { cancel(); signal.throwIfAborted(); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ModelInventoryReadError(response.status === 401 ? "invalid_credentials"
        : response.status === 403 ? "permission_denied" : response.status === 429 ? "rate_limited"
          : response.status >= 500 ? "directory_unavailable" : "invalid_response", response.status);
    }
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximumBytes)) {
      await response.body?.cancel().catch(() => undefined);
      throw new ModelInventoryReadError("incomplete_directory", response.status);
    }
    if (!response.body) return "";
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0, text = "";
    try {
      while (true) {
        signal.throwIfAborted();
        const next = await reader.read();
        signal.throwIfAborted();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > maximumBytes) throw new ModelInventoryReadError("incomplete_directory", response.status);
        text += decoder.decode(next.value, { stream: true });
      }
      return text + decoder.decode();
    } catch (error) { cancel(); throw error; }
    finally { reader.releaseLock(); }
  };
  try {
    return await Promise.race([transfer(), aborted]);
  } catch (error) {
    cancel();
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
}

export async function readCatalogLoaderJson(url: string, options: CatalogLoaderReadOptions,
  maximumBytes?: number): Promise<unknown> {
  const text = await readCatalogLoaderText(url, options, maximumBytes);
  try { return JSON.parse(text) as unknown; }
  catch { throw new ModelInventoryReadError("invalid_response", 200); }
}

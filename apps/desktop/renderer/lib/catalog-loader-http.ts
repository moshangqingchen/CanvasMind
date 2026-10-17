import { ModelInventoryReadError } from "./model-inventory-failure";

/** A collector receives its transport from the read dispatcher. It must never
 * fall back to a process fetch, repeat an HTTP request, or open a site session. */
export interface CatalogLoaderReadOptions {
  fetch: typeof fetch;
  signal?: AbortSignal;
  checkedAt?: string;
}

/** Consume one bounded response. No response body escapes a failed read. */
export async function readCatalogLoaderText(url: string, options: CatalogLoaderReadOptions,
  maximumBytes = 4 * 1024 * 1024): Promise<string> {
  options.signal?.throwIfAborted();
  const response = await options.fetch(url, { method: "GET", cache: "no-store", redirect: "error", signal: options.signal });
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
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximumBytes) throw new ModelInventoryReadError("incomplete_directory", response.status);
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}

export async function readCatalogLoaderJson(url: string, options: CatalogLoaderReadOptions,
  maximumBytes?: number): Promise<unknown> {
  const text = await readCatalogLoaderText(url, options, maximumBytes);
  try { return JSON.parse(text) as unknown; }
  catch { throw new ModelInventoryReadError("invalid_response", 200); }
}

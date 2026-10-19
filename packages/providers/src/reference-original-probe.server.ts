import { createHash } from "node:crypto";
import type { ProviderAssetInput } from "./contracts.js";
import { assertSafeProviderEndpoint, ProviderHttpError, providerFetch } from "./http.js";
import { MaterialPreparationError } from "./material-preparation.js";

export type ReferenceOriginal = Pick<ProviderAssetInput, "id" | "mimeType" | "data">;
export type ReferenceProbeCode = "ok" | "missing_original" | "url" | "http" | "mime" | "length" | "hash" | "network" | "timeout";
export interface ReferenceOriginalDiagnostic {
  assetIndex: number;
  assetReference: string;
  code: ReferenceProbeCode;
  attempts: number;
  durationMs: number;
  httpStatus?: number;
  expectedMime?: string;
  actualMime?: string;
  expectedBytes?: number;
  actualBytes?: number;
}
interface ProbeOptions {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  attempts?: number;
  /** The private original channel retains its existing exact MIME contract. */
  strictMime?: boolean;
  /** Native/CDN links may follow at most five individually checked HTTPS hops. */
  followRedirects?: boolean;
}
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const mimeType = (value: string | null | undefined) => {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mime && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mime) ? mime : undefined;
};
const cancelBody = (response: Response) => { void response.body?.cancel().catch(() => {}); };
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
function referenceUrl(value: string, base?: string): URL | undefined {
  try {
    const parsed = new URL(value, base);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash) return parsed;
  } catch { /* Invalid or unsafe redirect destinations never reach fetch. */ }
  return;
}
/** A streaming body and endpoint validation share the same bounded deadline. */
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

/** Read original bytes without credentials or conversion; private channels reject redirects. */
export async function probeReferenceOriginal(url: string, original: ReferenceOriginal, index: number,
  options: ProbeOptions = {}): Promise<ReferenceOriginalDiagnostic> {
  const startedAt = Date.now();
  const finish = (diagnostic: Omit<ReferenceOriginalDiagnostic, "durationMs">): ReferenceOriginalDiagnostic =>
    ({ ...diagnostic, durationMs: Math.max(0, Date.now() - startedAt) });
  const expectedMime = mimeType(original.mimeType), expectedBytes = original.data?.byteLength;
  const base = { assetIndex: index + 1, assetReference: sha256(original.id).slice(0, 12),
    ...(expectedMime ? { expectedMime } : {}), ...(expectedBytes === undefined ? {} : { expectedBytes }) };
  if (!original.data?.byteLength || !expectedMime)
    return finish({ ...base, code: "missing_original", attempts: 0 });
  if (!referenceUrl(url)) return finish({ ...base, code: "url", attempts: 0 });
  const expectedHash = sha256(original.data), attempts = options.attempts ?? 2;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const signal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
    let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let actualBytes = 0;
    try {
      let target = url;
      for (let redirects = 0; ; redirects++) {
        await withAbort(assertSafeProviderEndpoint(target), signal);
        response = await withAbort((options.fetch ?? providerFetch)(target, { method: "GET",
          redirect: options.followRedirects ? "manual" : "error", signal, cache: "no-store",
          credentials: "omit", referrerPolicy: "no-referrer" }), signal);
        if (!options.followRedirects || !redirectStatuses.has(response.status)) break;
        const location = response.headers.get("location");
        const destination = location ? referenceUrl(location, target) : undefined;
        cancelBody(response);
        if (!destination) return finish({ ...base, attempts: attempt, httpStatus: response.status, code: "url" });
        if (redirects >= 5) return finish({ ...base, attempts: attempt, httpStatus: response.status, code: "http" });
        target = destination.href;
      }
      const info = { ...base, attempts: attempt, httpStatus: response.status };
      if (response.status !== 200) {
        cancelBody(response);
        if (attempt < attempts && (response.status === 408 || response.status === 429 || response.status >= 500)) {
          await new Promise(resolve => setTimeout(resolve, 250)); continue;
        }
        return finish({ ...info, code: "http" });
      }
      const actualMime = mimeType(response.headers.get("content-type"));
      if (!actualMime || (options.strictMime === false ? actualMime.startsWith("text/") : actualMime !== expectedMime)) {
        cancelBody(response);
        return finish({ ...info, code: "mime", ...(actualMime ? { actualMime } : {}) });
      }
      const declaredLength = response.headers.get("content-length");
      if (!response.headers.has("content-encoding") && declaredLength !== null &&
        (!/^\d+$/u.test(declaredLength) || Number(declaredLength) !== base.expectedBytes)) {
        cancelBody(response); return finish({ ...info, actualMime, code: "length" });
      }
      reader = response.body?.getReader();
      const hash = createHash("sha256");
      if (reader) while (true) {
        const chunk = await withAbort(reader.read(), signal);
        if (chunk.done) break;
        actualBytes += chunk.value.byteLength;
        if (actualBytes > original.data.byteLength) return finish({ ...info, actualMime, actualBytes, code: "length" });
        hash.update(chunk.value);
      }
      if (actualBytes !== original.data.byteLength) return finish({ ...info, actualMime, actualBytes, code: "length" });
      return finish({ ...info, actualMime, actualBytes, code: hash.digest("hex") === expectedHash ? "ok" : "hash" });
    } catch {
      // Fetch exceptions may embed complete signed URLs; diagnostics never do.
      if (attempt === attempts) return finish({ ...base, attempts: attempt,
        ...(response ? { httpStatus: response.status } : {}), actualBytes, code: signal.aborted ? "timeout" : "network" });
    } finally {
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      else if (response) cancelBody(response);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("unreachable reference probe state");
}

/** Native upload links get one free read; retries never repeat an upload or generation. */
export async function verifyReferenceOriginal(url: string, original: ReferenceOriginal, index = 0,
  options: Omit<ProbeOptions, "strictMime" | "followRedirects"> = {}): Promise<void> {
  const diagnostic = await probeReferenceOriginal(url, original, index, { ...options, strictMime: false, followRedirects: true, attempts: options.attempts ?? 1 });
  if (diagnostic.code === "ok") return;
  throw new MaterialPreparationError("verify", { detail: "公开链接未能完整读取对应原文件", diagnostics: [diagnostic],
    cause: new ProviderHttpError("原文件公开链接校验失败", { kind: "invalid_response", phase: "prepare", retryable: false,
      submissionMayHaveOccurred: false, ...(diagnostic.httpStatus === undefined ? {} : { status: diagnostic.httpStatus }) }) });
}

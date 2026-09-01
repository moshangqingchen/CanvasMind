"use client";

const DEFAULT_LOCAL_CANVAS_ORIGIN = "http://127.0.0.1:3210";
const LOCAL_PROBE_TIMEOUT_MS = 1_200;
const LOCAL_SUCCESS_CACHE_MS = 30_000;
const LOCAL_FAILURE_CACHE_MS = 5_000;

let cachedAvailability: { available: boolean; expiresAt: number } | undefined;
let pendingAvailability: Promise<boolean> | undefined;

function localCanvasOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_LOCAL_DOWNLOAD_ORIGIN?.trim();
  if (!configured) return DEFAULT_LOCAL_CANVAS_ORIGIN;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return DEFAULT_LOCAL_CANVAS_ORIGIN;
    }
    return parsed.origin;
  } catch {
    return DEFAULT_LOCAL_CANVAS_ORIGIN;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

export function assetDownloadPath(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/content?download=1`;
}

async function probeLocalCanvas(): Promise<boolean> {
  const now = Date.now();
  if (cachedAvailability && cachedAvailability.expiresAt > now) {
    return cachedAvailability.available;
  }
  if (pendingAvailability) return pendingAvailability;

  pendingAvailability = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      LOCAL_PROBE_TIMEOUT_MS,
    );
    let available = false;
    try {
      const response = await fetch(`${localCanvasOrigin()}/api/health`, {
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
        signal: controller.signal,
      });
      if (response.ok) {
        const body = (await response.json()) as { ok?: unknown };
        available = body.ok === true;
      }
    } catch {
      available = false;
    } finally {
      window.clearTimeout(timeout);
    }
    cachedAvailability = {
      available,
      expiresAt:
        Date.now() +
        (available ? LOCAL_SUCCESS_CACHE_MS : LOCAL_FAILURE_CACHE_MS),
    };
    pendingAvailability = undefined;
    return available;
  })();

  return pendingAvailability;
}

/**
 * Uses the local service for large same-computer transfers while keeping the
 * current public origin as the fallback for remote browsers.
 */
export async function canvasRequestUrlPreferLocal(path: string): Promise<URL> {
  return (await canvasRequestUrlsWithFallback(path))[0]!;
}

/**
 * Returns both routes to the same canvas service in preferred order. Uploads
 * can retry the alternate route when Cloudflare or Chromium's private-network
 * checks interrupt one of them.
 */
export async function canvasRequestUrlsWithFallback(
  path: string,
): Promise<URL[]> {
  const currentUrl = new URL(path, window.location.origin);
  if (isLoopbackHostname(window.location.hostname)) return [currentUrl];

  const localUrl = new URL(path, localCanvasOrigin());
  return (await probeLocalCanvas())
    ? [localUrl, currentUrl]
    : [currentUrl, localUrl];
}

function triggerDownload(url: URL, filename?: string): void {
  const anchor = document.createElement("a");
  anchor.href = url.toString();
  anchor.download = filename ?? "";
  anchor.rel = "noopener";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Downloads directly from the local canvas service when this browser runs on
 * the same computer. Public/tunnel access remains the automatic fallback.
 */
export async function downloadAssetPreferLocal(
  assetId: string,
  filename?: string,
): Promise<"local" | "current-origin"> {
  const path = assetDownloadPath(assetId);
  const url = await canvasRequestUrlPreferLocal(path);
  triggerDownload(url, filename);
  return url.origin === window.location.origin ? "current-origin" : "local";
}

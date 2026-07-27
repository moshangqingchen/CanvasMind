/**
 * Best-effort in-process throttle for the single-user login endpoint. It is not
 * a distributed limiter — the deployment target is one web container — but it
 * turns an unlimited online password guess into a few attempts per window.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_CLIENT = 8;
const MAX_FAILURES_GLOBAL = 40;
const MAX_TRACKED_CLIENTS = 1_000;

interface Bucket {
  failures: number[];
}

interface LimiterState {
  clients: Map<string, Bucket>;
  global: number[];
}

const stateKey = "__superCanvasLoginLimiter";

function getState(): LimiterState {
  const scope = globalThis as typeof globalThis & {
    [stateKey]?: LimiterState;
  };
  if (!scope[stateKey]) {
    scope[stateKey] = { clients: new Map(), global: [] };
  }
  return scope[stateKey];
}

function prune(timestamps: number[], now: number): number[] {
  const cutoff = now - WINDOW_MS;
  let index = 0;
  while (index < timestamps.length && timestamps[index]! <= cutoff) index += 1;
  return index === 0 ? timestamps : timestamps.slice(index);
}

/** Derives a throttle key from proxy headers, falling back to a shared bucket. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  const candidate = first || request.headers.get("x-real-ip")?.trim() || "";
  return candidate.slice(0, 64) || "unknown";
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Seconds until the caller may retry; only meaningful when blocked. */
  retryAfterSeconds: number;
}

export function checkLoginAllowed(
  key: string,
  now = Date.now(),
): RateLimitVerdict {
  const state = getState();
  state.global = prune(state.global, now);

  const bucket = state.clients.get(key);
  const failures = bucket ? prune(bucket.failures, now) : [];
  if (bucket) {
    if (failures.length === 0) state.clients.delete(key);
    else bucket.failures = failures;
  }

  const blockedBy =
    failures.length >= MAX_FAILURES_PER_CLIENT
      ? failures[failures.length - MAX_FAILURES_PER_CLIENT]
      : state.global.length >= MAX_FAILURES_GLOBAL
        ? state.global[state.global.length - MAX_FAILURES_GLOBAL]
        : undefined;

  if (blockedBy === undefined) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((blockedBy + WINDOW_MS - now) / 1000),
    ),
  };
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const state = getState();
  state.global = [...prune(state.global, now), now];

  const bucket = state.clients.get(key);
  if (bucket) {
    bucket.failures = [...prune(bucket.failures, now), now];
    return;
  }
  if (state.clients.size >= MAX_TRACKED_CLIENTS) {
    // Drop the oldest tracked client so a spray of unique IPs cannot grow the
    // map without bound; the global counter still covers that case.
    const oldest = state.clients.keys().next();
    if (!oldest.done) state.clients.delete(oldest.value);
  }
  state.clients.set(key, { failures: [now] });
}

export function recordLoginSuccess(key: string): void {
  getState().clients.delete(key);
}

/** Test seam. */
export function resetLoginRateLimit(): void {
  const scope = globalThis as typeof globalThis & {
    [stateKey]?: LimiterState;
  };
  delete scope[stateKey];
}

export const LOGIN_RATE_LIMIT = {
  WINDOW_MS,
  MAX_FAILURES_PER_CLIENT,
  MAX_FAILURES_GLOBAL,
} as const;

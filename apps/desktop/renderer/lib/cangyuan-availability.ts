import {
  fetchProviderJson,
  joinUrl,
  providerFetch,
} from "@super-canvas/providers";
import { CANGYUAN_IMAGE_BASE_URL } from "./provider-presets";
import type {
  CangyuanAvailabilityItem,
  CangyuanAvailabilityPace,
  CangyuanAvailabilityRoute,
  CangyuanAvailabilitySnapshot,
  CangyuanAvailabilityStatus,
  CangyuanAvailabilityTimeline,
} from "./cangyuan-availability-types";

export type * from "./cangyuan-availability-types";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function status(value: unknown): CangyuanAvailabilityStatus {
  return value === "available" ||
    value === "degraded" ||
    value === "unavailable"
    ? value
    : "unknown";
}

function timeline(value: unknown): CangyuanAvailabilityTimeline | null {
  if (!record(value) || !Array.isArray(value.statuses)) return null;
  const { started_at: start, ended_at: end, bucket_seconds: bucket } = value;
  if (
    typeof start !== "number" ||
    !Number.isFinite(start) ||
    start < 0 ||
    typeof end !== "number" ||
    !Number.isFinite(end) ||
    end < start ||
    bucket !== 600
  )
    return null;
  const removed = Math.max(0, value.statuses.length - 48);
  const alignedStart = Math.floor(start / bucket) * bucket;
  const startedAt = Math.max(start, alignedStart + removed * bucket);
  if (startedAt > end) return null;
  const bucketCount = Math.ceil((end - alignedStart) / bucket);
  const statuses = value.statuses.slice(removed, bucketCount).map(status);
  if (!statuses.length) return null;
  return {
    startedAt,
    endedAt: Math.min(end, alignedStart + (removed + statuses.length) * bucket),
    bucketSeconds: bucket,
    statuses,
  };
}

function pace(value: unknown): CangyuanAvailabilityPace | undefined {
  if (
    !record(value) ||
    (value.kind !== "first_token" && value.kind !== "generation") ||
    typeof value.ms !== "number" ||
    !Number.isFinite(value.ms) ||
    value.ms < 0
  )
    return undefined;
  return { kind: value.kind, ms: value.ms };
}

function route(value: unknown): CangyuanAvailabilityRoute | undefined {
  if (!record(value) || typeof value.name !== "string" || !value.name.trim())
    return undefined;
  const latestStatus = status(value.latest_status);
  const cause =
    (latestStatus === "degraded" || latestStatus === "unavailable") &&
    (value.cause === "slow" || value.cause === "down")
      ? value.cause
      : undefined;
  const duration = pace(value.pace);
  return {
    name: value.name.trim(),
    latestStatus,
    ...(cause ? { cause } : {}),
    ...(duration ? { pace: duration } : {}),
    timeline: timeline(value.timeline),
  };
}

/** Accept the current documented contract, and expose only public service fields. */
export function parseCangyuanAvailabilityPayload(
  payload: unknown,
): CangyuanAvailabilitySnapshot {
  if (
    !record(payload) ||
    typeof payload.ready !== "boolean" ||
    typeof payload.enabled !== "boolean" ||
    !Array.isArray(payload.data) ||
    payload.success === false
  ) {
    throw new Error("沧元渠道可用性返回格式不完整");
  }
  const items: CangyuanAvailabilityItem[] = [];
  if (payload.ready && payload.enabled) {
    for (const value of payload.data) {
      const parsed = route(value);
      if (!parsed || !record(value)) continue;
      const routes = Array.isArray(value.routes)
        ? value.routes
            .map(route)
            .filter((r): r is CangyuanAvailabilityRoute => !!r)
        : [];
      const category = ["text", "image", "video", "audio"].includes(
        String(value.category),
      )
        ? String(value.category)
        : "unknown";
      items.push({ ...parsed, category, routes });
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    enabled: payload.enabled,
    ready: payload.ready,
    items,
  };
}

export async function fetchCangyuanAvailability(
  apiKey: string,
): Promise<CangyuanAvailabilitySnapshot> {
  const payload = await fetchProviderJson<unknown>(
    providerFetch,
    joinUrl(CANGYUAN_IMAGE_BASE_URL, "/v1/availability"),
    {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    },
    { phase: "connect", timeoutMs: 12_000, maxResponseBytes: 4 * 1024 * 1024 },
  );
  return parseCangyuanAvailabilityPayload(payload);
}

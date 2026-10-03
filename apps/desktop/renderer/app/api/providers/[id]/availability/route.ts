import { createHash } from "node:crypto";
import { decryptSecret } from "@super-canvas/providers";
import {
  fetchCangyuanAvailability,
  type CangyuanAvailabilitySnapshot,
  type CangyuanAvailabilityStatus,
} from "../../../../../lib/cangyuan-availability";
import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { requireServerMasterKey } from "../../../../../lib/master-key";
import { isCangyuanImagePreset } from "../../../../../lib/provider-presets";
import { matchesSupplierTemplate } from "../../../../../lib/supplier-template-source";
import { jsonError, repository } from "../../../../../lib/server";

const CATEGORIES = new Set(["text", "image", "video", "audio"]);
const STATUSES = new Set<CangyuanAvailabilityStatus>([
  "available",
  "degraded",
  "unavailable",
  "unknown",
]);
const AVAILABILITY_CACHE_TTL_MS = 30_000;
type AvailabilityCacheEntry = {
  expiresAt: number;
  snapshot?: CangyuanAvailabilitySnapshot;
  lastReady?: CangyuanAvailabilitySnapshot;
  pending?: Promise<CangyuanAvailabilitySnapshot>;
  error?: { message: string; status: number };
};
const AVAILABILITY_CACHE_KEY = "__superCanvasCangyuanAvailability";

function availabilityCache(): Map<string, AvailabilityCacheEntry> {
  const scope = globalThis as typeof globalThis & {
    [AVAILABILITY_CACHE_KEY]?: Map<string, AvailabilityCacheEntry>;
  };
  return (scope[AVAILABILITY_CACHE_KEY] ??= new Map());
}

function filterAvailability(
  snapshot: CangyuanAvailabilitySnapshot,
  filters: {
    name?: string;
    category?: string;
    latestStatus?: string;
  },
): CangyuanAvailabilitySnapshot {
  const items = snapshot.items.flatMap((item) => {
    if (filters.category && item.category !== filters.category) return [];
    const productMatches = !filters.name || item.name === filters.name;
    const routes = item.routes.filter(
      (route) =>
        (productMatches || route.name === filters.name) &&
        (!filters.latestStatus || route.latestStatus === filters.latestStatus),
    );
    const productStatusMatches =
      !filters.latestStatus || item.latestStatus === filters.latestStatus;
    if (productMatches && productStatusMatches)
      return [{ ...item, routes: filters.latestStatus ? routes : item.routes }];
    return routes.length ? [{ ...item, routes }] : [];
  });
  return { ...snapshot, items };
}

function publicSnapshot(
  entry: AvailabilityCacheEntry,
  filters: Parameters<typeof filterAvailability>[1],
  cached: boolean,
) {
  if (entry.error) return jsonError(entry.error.message, entry.error.status);
  const snapshot = entry.snapshot!;
  return Response.json({
    ...filterAvailability(snapshot, filters),
    source: !snapshot.ready ? "stale" : cached ? "cache" : "live",
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "连接 ID");
  if (!parsedId.success) return parsedId.response;
  const connection = await repository.getConnection(parsedId.data);
  if (!connection) return jsonError("供应商连接不存在", 404);
  if (
    !isCangyuanImagePreset(String(connection.config.preset)) ||
    !matchesSupplierTemplate(connection)
  )
    return jsonError("只有官方沧元连接支持渠道可用性查询", 422);
  if (!connection.encryptedSecret)
    return jsonError("当前沧元连接尚未配置 API Key", 409);

  const searchParams = new URL(request.url).searchParams;
  const category = searchParams.get("category") ?? undefined;
  if (category && !CATEGORIES.has(category))
    return jsonError("category 必须是 text、image、video 或 audio", 400);
  const latestStatus = searchParams.get("latest_status") ?? undefined;
  if (latestStatus && !STATUSES.has(latestStatus as CangyuanAvailabilityStatus))
    return jsonError(
      "latest_status 必须是 available、degraded、unavailable 或 unknown",
      400,
    );
  const filters = {
    name: searchParams.get("name")?.trim() || undefined,
    category,
    latestStatus,
  };

  try {
    const apiKey = decryptSecret(
      connection.encryptedSecret,
      requireServerMasterKey(),
    );
    const { supplierId, supplierSourceId } = connection.config;
    // The endpoint publishes a public snapshot, not this token's model permissions.
    // Keys belonging to one configured account/source must share its 30-second limit.
    // Independent legacy connections can only be safely identified by their Key.
    const keyIdentity = "key:" + createHash("sha256").update(apiKey).digest("hex");
    const cacheKey =
      typeof supplierId === "string" &&
      supplierId &&
      typeof supplierSourceId === "string" &&
      supplierSourceId
        ? JSON.stringify(["account", supplierId, supplierSourceId])
        : keyIdentity;
    const cache = availabilityCache();
    // The same exact Key always belongs to the same user, including duplicate
    // supplier records. Alias both identities without mixing model permissions.
    const candidates = [cache.get(cacheKey), cache.get(keyIdentity)].filter(
      (entry): entry is AvailabilityCacheEntry => !!entry,
    );
    const reusable = candidates.find(entry => entry.pending) ??
      candidates.sort((a, b) => b.expiresAt - a.expiresAt).find(entry => entry.expiresAt > Date.now());
    if (reusable) {
      cache.set(cacheKey, reusable);
      cache.set(keyIdentity, reusable);
      if (reusable.pending) await reusable.pending;
      return publicSnapshot(reusable, filters, true);
    }

    if (cache.size >= 128) {
      const oldest = [...cache].find(
        ([, entry]) => !entry.pending && entry.expiresAt <= Date.now(),
      );
      if (oldest) cache.delete(oldest[0]);
    }
    const entry: AvailabilityCacheEntry = {
      expiresAt: 0,
      lastReady: candidates.map(item => item.lastReady).filter(
        (snapshot): snapshot is CangyuanAvailabilitySnapshot => !!snapshot,
      ).sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0],
    };
    cache.set(cacheKey, entry);
    cache.set(keyIdentity, entry);
    entry.pending = (async () => {
      try {
        // window_days is obsolete. Read the entire snapshot once and filter locally.
        const current = await fetchCangyuanAvailability(apiKey);
        if (!current.enabled) entry.lastReady = undefined;
        else if (current.ready) entry.lastReady = current;
        entry.snapshot =
          !current.ready && current.enabled && entry.lastReady
            ? { ...entry.lastReady, ready: false }
            : current;
      } catch (error) {
        const upstreamStatus =
          error && typeof error === "object" && "details" in error
            ? (error.details as { status?: number } | undefined)?.status
            : undefined;
        // Never return an upstream body/message: it may echo an Authorization header.
        entry.error =
          upstreamStatus === 429
            ? {
                message: "沧元渠道可用性查询过于频繁，请至少等待 30 秒后重试",
                status: 429,
              }
            : {
                message: "沧元渠道可用性暂时读取失败，请稍后重试",
                status: 502,
              };
      } finally {
        entry.expiresAt = Date.now() + AVAILABILITY_CACHE_TTL_MS;
        entry.pending = undefined;
      }
      return (
        entry.snapshot ?? {
          checkedAt: "",
          enabled: true,
          ready: false,
          items: [],
        }
      );
    })();
    await entry.pending;
    return publicSnapshot(entry, filters, false);
  } catch {
    return jsonError("沧元渠道可用性暂时读取失败，请检查连接配置后重试", 502);
  }
}

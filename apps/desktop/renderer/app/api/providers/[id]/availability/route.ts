import { decryptSecret } from "@super-canvas/providers";
import {
  fetchCangyuanAvailability,
  type CangyuanAvailabilitySnapshot,
  type CangyuanAvailabilityStatus,
} from "../../../../../lib/cangyuan-catalog";
import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { requireServerMasterKey } from "../../../../../lib/master-key";
import { jsonError, repository } from "../../../../../lib/server";

const WINDOW_DAYS = new Set([7, 15, 30]);
const CATEGORIES = new Set(["text", "image", "video", "audio"]);
const STATUSES = new Set<CangyuanAvailabilityStatus>([
  "operational",
  "degraded",
  "unavailable",
  "unknown",
]);
const AVAILABILITY_CACHE_TTL_MS = 30_000;
type AvailabilityCacheEntry = {
  expiresAt: number;
  snapshot?: CangyuanAvailabilitySnapshot;
  pending?: Promise<CangyuanAvailabilitySnapshot>;
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
  const items = snapshot.items.filter(
    (item) =>
      (!filters.name || item.name === filters.name) &&
      (!filters.category || item.category === filters.category) &&
      (!filters.latestStatus || item.latestStatus === filters.latestStatus),
  );
  return { ...snapshot, items };
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
  if (connection.config.preset !== "cangyuan-gpt-image-2")
    return jsonError("只有沧元连接支持可用性查询", 422);
  if (!connection.encryptedSecret)
    return jsonError("当前沧元连接尚未配置 API Key", 409);

  const searchParams = new URL(request.url).searchParams;
  const requestedWindow = Number(searchParams.get("window_days") ?? "7");
  const windowDays = WINDOW_DAYS.has(requestedWindow)
    ? (requestedWindow as 7 | 15 | 30)
    : 7;
  const category = searchParams.get("category") ?? undefined;
  if (category && !CATEGORIES.has(category))
    return jsonError("category 必须是 text、image、video 或 audio", 400);
  const latestStatus = searchParams.get("latest_status") ?? undefined;
  if (
    latestStatus &&
    !STATUSES.has(latestStatus as CangyuanAvailabilityStatus)
  )
    return jsonError(
      "latest_status 必须是 operational、degraded、unavailable 或 unknown",
      400,
    );

  try {
    const apiKey = decryptSecret(
      connection.encryptedSecret,
      requireServerMasterKey(),
    );
    const name = searchParams.get("name")?.trim() || undefined;
    // The upstream endpoint allows only one request per account every 30
    // seconds. Cache the complete per-connection snapshot, then apply query
    // filters locally so different UI filters cannot accidentally bypass that
    // upstream limit.
    const cacheKey = parsedId.data;
    const cache = availabilityCache();
    const cached = cache.get(cacheKey);
    if (cached?.snapshot && cached.expiresAt > Date.now())
      return Response.json({
        ...filterAvailability(cached.snapshot, {
          name,
          category,
          latestStatus,
        }),
        source: "cache" as const,
      });

    const pending =
      cached?.pending ??
      fetchCangyuanAvailability(apiKey, {
        windowDays,
      });
    cache.set(cacheKey, { expiresAt: 0, pending });
    let result: CangyuanAvailabilitySnapshot;
    try {
      result = await pending;
    } catch (error) {
      cache.delete(cacheKey);
      throw error;
    }
    cache.set(cacheKey, {
      expiresAt: Date.now() + AVAILABILITY_CACHE_TTL_MS,
      snapshot: result,
    });
    return Response.json({
      ...filterAvailability(result, { name, category, latestStatus }),
      source: "live" as const,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "上游请求失败";
    return jsonError(`沧元可用性接口读取失败：${message}`, 502);
  }
}

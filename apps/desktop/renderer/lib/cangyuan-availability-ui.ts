import type { ModelDescriptor } from "@super-canvas/providers";
import type { CangyuanAvailabilityItem, CangyuanAvailabilityRoute, CangyuanAvailabilitySnapshot,
  CangyuanAvailabilityStatus, CangyuanAvailabilityTimeline } from "./cangyuan-availability-types";

export type ModelAvailabilityLoadState = "idle" | "loading" | "ready" | "error" | "preparing" | "disabled";
// Allow two 60-second reads and a little transport time before expiring a result.
export const MODEL_AVAILABILITY_MAX_AGE_MS = 150_000;
export const CANGYUAN_AVAILABILITY_REFRESH_MS = 60_000;
export const CANGYUAN_AVAILABILITY_LABELS: Record<CangyuanAvailabilityStatus, string> = {
  available: "正常", degraded: "波动", unavailable: "暂不可用", unknown: "未知",
};

/** A cached successful probe must never look like a current healthy result. */
export function modelAvailabilityBadgeState(availability: CangyuanAvailabilityRoute | undefined,
  loadState: ModelAvailabilityLoadState, checkedAt: string | undefined, now = Date.now()) {
  if (loadState === "disabled") return { tone: "disabled", label: "监测已停用" };
  if (loadState === "preparing") return { tone: "preparing", label: "准备中" };
  if (loadState === "error") return { tone: "error", label: availability ? "更新失败" : "查询失败" };
  const checked = checkedAt ? Date.parse(checkedAt) : NaN;
  if (availability && (!Number.isFinite(checked) || now - checked > MODEL_AVAILABILITY_MAX_AGE_MS))
    return { tone: "stale", label: "已过期" };
  if (availability) return { tone: availability.latestStatus, label: CANGYUAN_AVAILABILITY_LABELS[availability.latestStatus] };
  return { tone: loadState, label: loadState === "loading" ? "查询中" : "未监测" };
}

export interface ResolvedCangyuanAvailability extends CangyuanAvailabilityRoute {
  category: string;
  productName: string;
}

/** Public routes describe service state, never a Key's model authorization. */
export function cangyuanAvailabilityForModel(
  model: Pick<ModelDescriptor, "id" | "name">,
  items: readonly CangyuanAvailabilityItem[],
  options: { category?: string; group?: string } = {},
): ResolvedCangyuanAvailability | undefined {
  const routeName = (options.category === "text" ? options.group : model.id)?.trim();
  if (!routeName) return undefined;
  const products = items.filter(item => !options.category || item.category === options.category);
  // Always resolve the actual callable model/group before looking at a product.
  for (const product of products) {
    const route = product.routes.find(item => item.name === routeName);
    if (route) return { ...route, category: product.category, productName: product.name };
  }
  // Some products themselves have the callable ID and no separate routes.
  const product = products.find(item => item.routes.length === 0 && item.name === routeName);
  return product ? { ...product, category: product.category, productName: product.name } : undefined;
}

export interface ModelAvailabilitySnapshot {
  connectionId: string;
  items: CangyuanAvailabilityItem[];
  checkedAt?: string;
  state: ModelAvailabilityLoadState;
}

/** A not-ready response may reuse history, but cannot renew its freshness. */
export function receiveModelAvailabilitySnapshot(previous: ModelAvailabilitySnapshot, connectionId: string,
  incoming: CangyuanAvailabilitySnapshot & { source?: "live" | "cache" | "stale" }): ModelAvailabilitySnapshot {
  if (!incoming.enabled) return { connectionId, items: [], checkedAt: incoming.checkedAt, state: "disabled" };
  if (!incoming.ready) {
    const serverHistory = incoming.items.length > 0 && Number.isFinite(Date.parse(incoming.checkedAt));
    return { connectionId,
      items: serverHistory ? incoming.items : previous.connectionId === connectionId ? previous.items : [],
      checkedAt: serverHistory ? incoming.checkedAt : previous.connectionId === connectionId ? previous.checkedAt : undefined,
      state: "preparing" };
  }
  return { connectionId, items: incoming.items, checkedAt: incoming.checkedAt,
    state: incoming.source === "stale" ? "error" : "ready" };
}

export interface CangyuanAvailabilityBucket {
  startedAt: number;
  endedAt: number;
  status: CangyuanAvailabilityStatus;
}

/** Supplier buckets align to the clock, with partial edges clipped to the recorded range. */
export function cangyuanAvailabilityBuckets(timeline: CangyuanAvailabilityTimeline | null): CangyuanAvailabilityBucket[] {
  if (!timeline || !Number.isFinite(timeline.startedAt) || !Number.isFinite(timeline.endedAt) ||
    !Number.isFinite(timeline.bucketSeconds) || timeline.bucketSeconds <= 0 || timeline.endedAt <= timeline.startedAt) return [];
  const alignedStart = Math.floor(timeline.startedAt / timeline.bucketSeconds) * timeline.bucketSeconds;
  const earliest = Math.max(timeline.startedAt, timeline.endedAt - 8 * 60 * 60);
  return timeline.statuses.map((status, index) => ({
    startedAt: Math.max(earliest, alignedStart + index * timeline.bucketSeconds),
    endedAt: Math.min(timeline.endedAt, alignedStart + (index + 1) * timeline.bucketSeconds),
    status,
  })).filter(bucket => bucket.endedAt > bucket.startedAt).slice(-48);
}

export function cangyuanPaceLabel(availability: CangyuanAvailabilityRoute): string {
  const pace = availability.pace;
  if (!pace || !Number.isFinite(pace.ms) || pace.ms < 0) return "本周期暂无耗时样本";
  const duration = pace.ms < 1000 ? `${Math.round(pace.ms)} 毫秒` : `${Number((pace.ms / 1000).toFixed(1))} 秒`;
  return `${pace.kind === "first_token" ? "首字时间" : "生成耗时"}中位数 ${duration}`;
}

export function cangyuanAvailabilityTitle(availability: CangyuanAvailabilityRoute | undefined,
  loadState: ModelAvailabilityLoadState, checkedAt?: string): string {
  const state = modelAvailabilityBadgeState(availability, loadState, checkedAt);
  if (!availability) return state.tone === "preparing" ? "渠道监测数据准备中" : state.tone === "disabled" ? "渠道监测已停用" :
    state.tone === "error" ? "沧元可用性查询失败" : state.tone === "loading" ? "正在读取渠道可用性" : "监测接口暂未收录当前模型或分组";
  const parts = [state.label];
  if (["error", "stale", "preparing"].includes(state.tone)) parts.push("以下为上次监测记录，当前状态待确认");
  if (availability.cause) parts.push(availability.cause === "slow" ? "响应变慢" : "服务异常");
  parts.push(cangyuanPaceLabel(availability), "正常表示服务当前开放，不是调用成功率承诺");
  return parts.join(" · ");
}

import type { ModelDescriptor } from "@super-canvas/providers";
import type { CangyuanAvailabilityView } from "./client-api";

export type ModelAvailabilityLoadState = "idle" | "loading" | "ready" | "error";
export const MODEL_AVAILABILITY_MAX_AGE_MS = 90_000;

/** A cached successful probe must never look like a current healthy result. */
export function modelAvailabilityBadgeState(availability: CangyuanAvailabilityView | undefined,
  loadState: ModelAvailabilityLoadState, checkedAt: string | undefined, now = Date.now()) {
  if (loadState === "error") return { tone: "error", label: availability ? "更新失败" : "查询失败" };
  const checked = checkedAt ? Date.parse(checkedAt) : NaN;
  if (availability && (!Number.isFinite(checked) || now - checked > MODEL_AVAILABILITY_MAX_AGE_MS))
    return { tone: "stale", label: "已过期" };
  if (availability) return { tone: availability.latestStatus,
    label: ({ operational: "可用", degraded: "波动", unavailable: "不可用", unknown: "未知" })[availability.latestStatus] };
  return { tone: loadState, label: loadState === "loading" ? "查询中" : "未监测" };
}

function canonicalModelName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(][^()（）]*(?:[)）]|$)/gu, "")
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");
}

/** Matches the availability API's model names to canvas descriptors. */
export function cangyuanAvailabilityForModel(
  model: Pick<ModelDescriptor, "id" | "name">,
  items: readonly CangyuanAvailabilityView[],
): CangyuanAvailabilityView | undefined {
  const exactId = model.id.trim().toLowerCase();
  const exactMatch = items.find(
    (item) => item.name.trim().toLowerCase() === exactId,
  );
  if (exactMatch) return exactMatch;

  const candidates = new Set([
    canonicalModelName(model.id),
    canonicalModelName(model.name),
  ]);
  return items.find((item) => candidates.has(canonicalModelName(item.name)));
}

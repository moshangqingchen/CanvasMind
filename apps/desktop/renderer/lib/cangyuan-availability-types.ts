/** Published service state; it does not describe a Key's access or success rate. */
export type CangyuanAvailabilityStatus =
  "available" | "degraded" | "unavailable" | "unknown";

export interface CangyuanAvailabilityTimeline {
  /** Unix timestamps in seconds, as returned by the supplier. */
  startedAt: number;
  endedAt: number;
  bucketSeconds: number;
  statuses: CangyuanAvailabilityStatus[];
}

export interface CangyuanAvailabilityPace {
  kind: "first_token" | "generation";
  /** Current median duration. Absence means the cycle has no sample. */
  ms: number;
}

export interface CangyuanAvailabilityRoute {
  name: string;
  latestStatus: CangyuanAvailabilityStatus;
  cause?: "slow" | "down";
  pace?: CangyuanAvailabilityPace;
  timeline: CangyuanAvailabilityTimeline | null;
}

export interface CangyuanAvailabilityItem extends CangyuanAvailabilityRoute {
  category: string;
  /** Exact callable model IDs or text group IDs; product lines are not models. */
  routes: CangyuanAvailabilityRoute[];
}

export interface CangyuanAvailabilitySnapshot {
  /** Time of the successful read; retained when ready=false reuses old data. */
  checkedAt: string;
  enabled: boolean;
  ready: boolean;
  items: CangyuanAvailabilityItem[];
}

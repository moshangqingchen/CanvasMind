/** Official monitoring observations. They never define model capability or price. */
export interface SupplierChannelPlazaObservation {
  sourceUrl: string;
  checkedAt: string;
  range: "90m" | "24h" | "7d" | "30d";
  status?: string;
  score?: number | null;
  latencyMs?: number | null;
  successRate?: number | null;
  monitorProfile?: string;
  scoreSource?: string;
  bindable?: boolean;
  samples?: Array<number | null> | null;
  sampleFailed?: boolean[] | null;
  sampleBucketSeconds?: number;
  samplesEndAt?: string;
  healthWindow?: { clamped?: boolean; errorRetentionDays?: number };
}
export interface SupplierChannelPlazaEvidence {
  supplierGroupId: string;
  source: "official-channel-plaza";
  checkedAt: string;
  status: "live" | "partial";
  categories: Array<{ id: string; name?: string; count?: number }>;
  observations: SupplierChannelPlazaObservation[];
  failedReads: Array<{ sourceUrl: string; httpStatus: number }>;
}
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const text = (value: unknown) => typeof value === "string" ? value.slice(0, 256) : undefined;
export const MONSTER_CHANNEL_PLAZA_RANGES = ["90m", "24h", "7d", "30d"] as const;

export async function readMonsterChannelPlaza(
  siteUrl: string,
  checkedAt: string,
  probe: (url: string) => Promise<{ status: number; payload?: unknown }>,
): Promise<Map<string, SupplierChannelPlazaEvidence>> {
  const result = new Map<string, SupplierChannelPlazaEvidence>();
  if (siteUrl !== "https://api.eaheng.com") return result;
  const categoryUrl = `${siteUrl}/api/v1/plaza/categories`;
  const reads = await Promise.all([probe(categoryUrl), ...MONSTER_CHANNEL_PLAZA_RANGES.map(range => probe(`${siteUrl}/api/v1/plaza?range=${range}`))]);
  const data = (value: unknown) => {
    const envelope = record(value);
    return envelope && envelope.success !== false && (!envelope.code || envelope.code === 200) ? record(envelope.data) : undefined;
  };
  const categoryData = data(reads[0]!.payload);
  const categories = Array.isArray(categoryData?.categories) ? categoryData.categories.flatMap(value => {
    const row = record(value), id = text(row?.id), name = text(row?.name), count = number(row?.count);
    return id ? [{ id, ...(name !== undefined ? { name } : {}), ...(count !== undefined ? { count } : {}) }] : [];
  }) : [];
  const failedReads = reads.flatMap((read, index) => read.status === 200 && (index ? Array.isArray(data(read.payload)?.groups) : Array.isArray(categoryData?.categories))
    ? [] : [{ sourceUrl: index ? `${siteUrl}/api/v1/plaza?range=${MONSTER_CHANNEL_PLAZA_RANGES[index - 1]}` : categoryUrl, httpStatus: read.status }]);
  for (const [index, range] of MONSTER_CHANNEL_PLAZA_RANGES.entries()) {
    const read = reads[index + 1]!, payload = data(read.payload);
    if (read.status !== 200 || !Array.isArray(payload?.groups)) continue;
    const health = record(payload.health_window);
    for (const value of payload.groups) {
      const row = record(value), id = row?.id;
      if (!row || !(typeof id === "number" && Number.isSafeInteger(id) && id >= 0 || typeof id === "string" && /^\d+$/u.test(id))) continue;
      const supplierGroupId = String(id);
      const evidence: SupplierChannelPlazaEvidence = result.get(supplierGroupId) ?? { supplierGroupId, source: "official-channel-plaza" as const, checkedAt,
        status: failedReads.length ? "partial" as const : "live" as const,
        categories: categories.filter(category => Array.isArray(row.categories) && row.categories.includes(category.id)), observations: [], failedReads };
      const observation: SupplierChannelPlazaObservation = { sourceUrl: `${siteUrl}/api/v1/plaza?range=${range}`, checkedAt, range };
      for (const [target, field] of [["status", "status"], ["monitorProfile", "monitor_profile"], ["scoreSource", "score_source"], ["samplesEndAt", "samples_end_at"]] as const) {
        const value = text(row[field]); if (value !== undefined) observation[target] = value;
      }
      for (const [target, field] of [["score", "score"], ["latencyMs", "latency_ms"], ["successRate", "success_rate"]] as const) {
        const value = row[field] === null ? null : number(row[field]); if (value !== undefined) observation[target] = value;
      }
      if (typeof row.bindable === "boolean") observation.bindable = row.bindable;
      if (row.samples === null || Array.isArray(row.samples) && row.samples.every(value => value === null || number(value) !== undefined)) observation.samples = row.samples as Array<number | null> | null;
      if (row.sample_failed === null || Array.isArray(row.sample_failed) && row.sample_failed.every(value => typeof value === "boolean")) observation.sampleFailed = row.sample_failed as boolean[] | null;
      const bucketSeconds = number(row.sample_bucket_seconds); if (bucketSeconds !== undefined) observation.sampleBucketSeconds = bucketSeconds;
      const retention = number(health?.error_retention_days);
      if (health) observation.healthWindow = { ...(typeof health.clamped === "boolean" ? { clamped: health.clamped } : {}),
        ...(retention !== undefined ? { errorRetentionDays: retention } : {}) };
      evidence.observations.push(observation); result.set(supplierGroupId, evidence);
    }
  }
  return result;
}

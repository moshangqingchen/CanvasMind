import { createHash } from "node:crypto";
import {
  HANG_PRICE_URL, parseHangChatPrices, parseJiasuVideoApiExampleTemplate, parseSynoraLedgerPrices, parseWeAiLegacyGroup,
  supplierDirectoryPayloadComplete, SYNORA_LEDGER_URL, SYNORA_NOTIFICATIONS_URL, WEAI_LEGACY_MODELS_URL,
  type JiasuVideoApiExampleTemplate, type ModelDescriptor, type SupplierLedgerPrice, type WeAiLegacyGroupEvidence,
  type WeAiLegacyGroupOption,
} from "@super-canvas/providers";
import { readCatalogLoaderJson, readCatalogLoaderText, type CatalogLoaderReadOptions } from "./catalog-loader-http";
import { ModelInventoryReadError } from "./model-inventory-failure";

export interface CatalogSupplementEntry {
  entryId: string;
  sourceUrl: string;
  role: "catalog-offer" | "price" | "schema" | "health";
  authKind: "anonymous" | "site-account";
  groupId?: number;
  expectedGroup?: WeAiLegacyGroupOption;
  expectedGroupSetSha256?: string;
}
export interface CatalogSupplementReadInput {
  entryId: string;
  sourceUrl: string;
  groupId?: number;
  expectedGroup?: WeAiLegacyGroupOption;
  expectedGroupSetSha256?: string;
  modelIds?: readonly string[];
}
interface MonsterHealthObservation {
  supplierGroupId: string;
  sourceUrl: string;
  checkedAt: string;
  range: string;
  categoryIds?: string[];
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
export type CatalogSupplementEvidence =
  | { kind: "ledger-samples"; samples: SupplierLedgerPrice[]; coverage: "first-page"; pageSize: 100 }
  | { kind: "announcement-links"; notices: Array<{ modelId: string; supplierGroupId: "115"; publishedAt: string; sourceUrl: string }>; coverage: "matching-models" }
  | { kind: "weai-legacy"; availableGroups: WeAiLegacyGroupOption[]; selected?: WeAiLegacyGroupEvidence; groupSetSha256: string }
  | { kind: "published-chat-prices"; rows: ReturnType<typeof parseHangChatPrices>["rows"]; coverage: "declared-chat-prices" }
  | { kind: "jiasu-script-index"; scriptCount: number }
  | { kind: "jiasu-video-template"; template: JiasuVideoApiExampleTemplate }
  | { kind: "monster-health"; categories?: Array<{ id: string; name?: string; count?: number }>; range?: string; observations: MonsterHealthObservation[] };
export interface CatalogSupplementReadResult {
  sourceUrl: string;
  checkedAt: string;
  complete: boolean;
  status: "live" | "empty";
  models: ModelDescriptor[];
  evidence: CatalogSupplementEvidence;
  entries: CatalogSupplementEntry[];
}

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 256;
const invalid = () => new ModelInventoryReadError("invalid_response");
const groupDigest = (groups: WeAiLegacyGroupOption[]) => createHash("sha256").update(JSON.stringify([...groups].sort((a, b) => a.id - b.id))).digest("hex");
const anonymous = (options: CatalogLoaderReadOptions): CatalogLoaderReadOptions => ({ ...options,
  fetch: (input, init) => options.fetch(input, { ...init, credentials: "omit", headers: {} }) });

function checkedUrl(input: CatalogSupplementReadInput): URL {
  const url = new URL(input.sourceUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw invalid();
  const exact = (target: string) => url.href === target;
  const kind = input.entryId.split(":")[0];
  const allowed = kind === "synora-usage" ? exact(SYNORA_LEDGER_URL)
    : kind === "synora-announcements" ? exact(SYNORA_NOTIFICATIONS_URL)
    : kind === "weai-legacy-index" ? exact(WEAI_LEGACY_MODELS_URL)
    : kind === "weai-legacy-group" ? Number.isSafeInteger(input.groupId) && (input.groupId ?? -1) >= 0 && exact(`${WEAI_LEGACY_MODELS_URL}?group_id=${input.groupId}`)
    : kind === "hang-pricing" ? exact(HANG_PRICE_URL)
    : kind === "jiasu-index" ? exact("https://ai.jiasuapi.com/")
    : kind === "jiasu-script" ? url.origin === "https://ai.jiasuapi.com" && /^\/static\/js\/index\.[a-f\d]+\.js$/u.test(url.pathname) && !url.search
    : kind === "monster-categories" ? exact("https://api.eaheng.com/api/v1/plaza/categories")
    : kind === "monster-range" ? url.origin === "https://api.eaheng.com" && url.pathname === "/api/v1/plaza" && /^\?range=(?:90m|24h|7d|30d)$/u.test(url.search) : false;
  if (!allowed) throw invalid();
  return url;
}

function envelopeRows(payload: unknown): unknown[] {
  const root = record(payload);
  if (!root || root.success === false || root.error || root.code !== undefined && ![0, 200, "0", "200"].includes(root.code as number | string)) throw invalid();
  const rows = Array.isArray(root.data) ? root.data : record(root.data)?.items;
  if (!Array.isArray(rows)) throw invalid();
  return rows;
}

/** Exactly one declared GET. Discovery returns entries; it never performs their HTTP or writes anything. */
export async function collectCatalogSupplementRead(input: CatalogSupplementReadInput, options: CatalogLoaderReadOptions): Promise<CatalogSupplementReadResult> {
  const url = checkedUrl(input), sourceUrl = url.href, checkedAt = options.checkedAt ?? new Date().toISOString();
  const kind = input.entryId.split(":")[0];
  const result = (evidence: CatalogSupplementEvidence, complete: boolean, entries: CatalogSupplementEntry[] = [], models: ModelDescriptor[] = []): CatalogSupplementReadResult =>
    ({ sourceUrl, checkedAt, complete, status: models.length || entries.length ? "live" : "empty", models, evidence, entries });

  if (kind === "jiasu-index" || kind === "jiasu-script") {
    const body = await readCatalogLoaderText(sourceUrl, anonymous(options), kind === "jiasu-index" ? 512 * 1024 : 8 * 1024 * 1024);
    if (kind === "jiasu-script") {
      const template = parseJiasuVideoApiExampleTemplate(body, sourceUrl, checkedAt);
      if (!template) throw invalid();
      return { ...result({ kind: "jiasu-video-template", template }, true), status: "live" };
    }
    const paths = [...new Set([...body.matchAll(/<script\b[^>]*\bsrc=["'](\/static\/js\/index\.[a-f\d]+\.js)["']/giu)].map(match => match[1]!))];
    if (!paths.length) throw invalid();
    const entries = paths.map(path => ({ entryId: `jiasu-script:${path}`, sourceUrl: `${url.origin}${path}`, role: "schema" as const, authKind: "anonymous" as const }));
    return result({ kind: "jiasu-script-index", scriptCount: entries.length }, true, entries);
  }

  const publicRead = ["hang-pricing"].includes(kind);
  const payload = await readCatalogLoaderJson(sourceUrl, publicRead ? anonymous(options) : options);
  if (kind === "synora-usage") {
    const rows = envelopeRows(payload);
    if (rows.some(value => {
      const row = record(value);
      return !row || !text(row.model) || !text(row.created_at) || !Number.isFinite(Date.parse(row.created_at)) || !text(row.billing_mode);
    })) throw invalid();
    const samples = parseSynoraLedgerPrices(payload, { supplierSiteUrl: "https://synoralink.com", checkedAt });
    return { ...result({ kind: "ledger-samples", samples, coverage: "first-page", pageSize: 100 }, rows.length <= 100 && supplierDirectoryPayloadComplete(payload)),
      status: samples.length ? "live" : "empty" };
  }
  if (kind === "synora-announcements") {
    const rows = envelopeRows(payload), notices: Extract<CatalogSupplementEvidence, { kind: "announcement-links" }>["notices"] = [];
    for (const value of rows) {
      const row = record(value);
      if (!row || !text(row.created_at) || !Number.isFinite(Date.parse(row.created_at)) || typeof row.title !== "string" || typeof row.content !== "string") throw invalid();
      if (!row.title.includes("全参") || !/价格|涨价|降价/u.test(row.title)) continue;
      for (const modelId of input.modelIds ?? []) {
        if (!text(modelId)) continue;
        const escaped = modelId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        if (new RegExp(`(?<![\\w.-])${escaped}(?![\\w.-])`, "u").test(row.content)) notices.push({ modelId, supplierGroupId: "115", publishedAt: row.created_at, sourceUrl });
      }
    }
    return { ...result({ kind: "announcement-links", notices, coverage: "matching-models" }, supplierDirectoryPayloadComplete(payload)), status: notices.length ? "live" : "empty" };
  }
  if (kind === "weai-legacy-index" || kind === "weai-legacy-group") {
    const parsed = parseWeAiLegacyGroup(payload, checkedAt, kind === "weai-legacy-group" ? input.groupId : undefined);
    if (!parsed) throw invalid();
    const groupSetSha256 = groupDigest(parsed.availableGroups);
    if (kind === "weai-legacy-group" && (!input.expectedGroup || parsed.selected?.group.id !== input.expectedGroup.id ||
        parsed.selected.group.name !== input.expectedGroup.name || parsed.selected.group.platform !== input.expectedGroup.platform ||
        !input.expectedGroupSetSha256 || input.expectedGroupSetSha256 !== groupSetSha256)) throw invalid();
    const selected = parsed.selected, entries = kind === "weai-legacy-index" ? parsed.availableGroups.filter(group => group.id !== selected?.group.id).map(group => ({
      entryId: `weai-legacy-group:${group.id}`, sourceUrl: `${WEAI_LEGACY_MODELS_URL}?group_id=${group.id}`, groupId: group.id,
      expectedGroup: group, expectedGroupSetSha256: groupSetSha256, role: "catalog-offer" as const, authKind: "site-account" as const,
    })) : [];
    const models: ModelDescriptor[] = selected?.models.map(model => ({ id: model.id, name: model.id, operations: [],
      metadata: { catalogGroup: selected.group.name, supplierGroupId: String(selected.group.id), publicCatalogOnly: true } })) ?? [];
    return result({ kind: "weai-legacy", availableGroups: parsed.availableGroups, ...(selected ? { selected } : {}), groupSetSha256 }, supplierDirectoryPayloadComplete(payload), entries, models);
  }
  if (kind === "hang-pricing") {
    const parsed = parseHangChatPrices(payload, "https://api.hangzhale.com", checkedAt);
    return { ...result({ kind: "published-chat-prices", rows: parsed.rows, coverage: "declared-chat-prices" }, parsed.complete && supplierDirectoryPayloadComplete(payload)), status: parsed.rows.length ? "live" : "empty" };
  }
  const root = record(payload), data = record(root?.data);
  if (!root || root.success === false || root.error || root.code !== undefined && ![0, 200].includes(root.code as number) || !data) throw invalid();
  if (kind === "monster-categories") {
    if (!Array.isArray(data.categories)) throw invalid();
    const categories: NonNullable<Extract<CatalogSupplementEvidence, { kind: "monster-health" }>["categories"]> = [];
    for (const value of data.categories) {
      const row = record(value);
      if (!row || !text(row.id) || row.name !== undefined && !text(row.name) || row.count !== undefined && !finite(row.count)) throw invalid();
      categories.push({ id: row.id, ...(text(row.name) ? { name: row.name } : {}), ...(finite(row.count) ? { count: row.count } : {}) });
    }
    return { ...result({ kind: "monster-health", categories, observations: [] }, supplierDirectoryPayloadComplete(payload)), status: categories.length ? "live" : "empty" };
  }
  if (!Array.isArray(data.groups)) throw invalid();
  const range = url.searchParams.get("range")!, observations: MonsterHealthObservation[] = [];
  for (const value of data.groups) {
    const row = record(value), id = row?.id;
    if (!row || !(typeof id === "number" && Number.isSafeInteger(id) && id >= 0 || typeof id === "string" && /^\d+$/u.test(id))) throw invalid();
    const observation: MonsterHealthObservation = { supplierGroupId: String(id), sourceUrl, checkedAt, range };
    if (row.categories !== undefined) {
      if (!Array.isArray(row.categories) || row.categories.some(value => !text(value))) throw invalid();
      observation.categoryIds = [...new Set(row.categories as string[])];
    }
    for (const [target, key] of [["status", "status"], ["monitorProfile", "monitor_profile"], ["scoreSource", "score_source"], ["samplesEndAt", "samples_end_at"]] as const) {
      if (row[key] !== undefined && !text(row[key])) throw invalid();
      if (text(row[key])) observation[target] = row[key];
    }
    for (const [target, key] of [["score", "score"], ["latencyMs", "latency_ms"], ["successRate", "success_rate"]] as const) {
      if (row[key] !== undefined && row[key] !== null && !finite(row[key])) throw invalid();
      if (row[key] === null || finite(row[key])) observation[target] = row[key];
    }
    if (typeof row.bindable === "boolean") observation.bindable = row.bindable;
    if (row.samples !== undefined) {
      if (row.samples !== null && (!Array.isArray(row.samples) || row.samples.some(value => value !== null && !finite(value)))) throw invalid();
      observation.samples = row.samples as Array<number | null> | null;
    }
    if (row.sample_failed !== undefined) {
      if (row.sample_failed !== null && (!Array.isArray(row.sample_failed) || row.sample_failed.some(value => typeof value !== "boolean"))) throw invalid();
      observation.sampleFailed = row.sample_failed as boolean[] | null;
    }
    if (finite(row.sample_bucket_seconds)) observation.sampleBucketSeconds = row.sample_bucket_seconds;
    const health = record(data.health_window);
    if (health) observation.healthWindow = { ...(typeof health.clamped === "boolean" ? { clamped: health.clamped } : {}),
      ...(finite(health.error_retention_days) ? { errorRetentionDays: health.error_retention_days } : {}) };
    observations.push(observation);
  }
  return { ...result({ kind: "monster-health", range, observations }, supplierDirectoryPayloadComplete(payload)), status: observations.length ? "live" : "empty" };
}

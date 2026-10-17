import { scanProviderModelCatalog, supplierDirectoryPayloadComplete, type ModelDescriptor } from "@super-canvas/providers";
import { createHash } from "node:crypto";
import {
  assertCompleteModelInventoryPayload, balanceError, modelInventoryFailure, ModelInventoryReadError,
  type ModelInventoryFailure,
} from "./model-inventory-failure";
import { readBoundedModelJson } from "./supplier-scan-utils";
import {
  mergeMonsterNativeImageCatalog, mikotoNativeImageCatalogUrl, monsterNativeImageCatalogUrl,
} from "./monster-native-image-catalog";
import { CHENTU_CATALOG_SOURCE, chentuCatalogFromPricing } from "./chentu-catalog";
import { CYBERAFEI_CATALOG_SOURCE, cyberAfeiCatalogFromPricing } from "./cyberafei-catalog";
import { MIAOWU_CATALOG_SOURCE, miaowuCatalogFromPricing, miaowuModelsForGroup } from "./miaowu-catalog";
import { MIAOWU_BASE_URL } from "./miaowu-presets";
import { parseMiaowuImageSchema, type MiaowuImageSchemaContract } from "./miaowu-image-schema";
import { parseMiaowuVideoSchema, type MiaowuVideoSchemaContract } from "./miaowu-video-schema";

/** A single source's facts. No saved fallback, repository or publication is involved. */
export interface InventoryCollectorResult {
  models: ModelDescriptor[];
  groups?: Array<{ id: string; label: string; modelIds: readonly string[] }>;
  complete: boolean;
  status: "live" | "empty" | "failed" | "unauthorized";
  checkedAt: string;
  sourceUrl?: string;
  attemptedUrls?: string[];
  failure?: { code: string; httpStatus?: number };
}

/** Required transport keeps every request under the caller's scheduling authority. */
export interface InventoryCollectorOptions {
  fetch: typeof fetch;
  now?: () => string;
}

type CollectorInput = {
  baseUrl: string;
  apiKey: string;
  protocol?: string;
  defaultModel?: string;
};

const sampleAt = (options: InventoryCollectorOptions) => options.now?.() ?? new Date().toISOString();

async function traced<T extends InventoryCollectorResult>(options: InventoryCollectorOptions, work: (options: InventoryCollectorOptions) => Promise<T>): Promise<T> {
  const attemptedUrls: string[] = [];
  const result = await work({ ...options, fetch: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.username || url.password || [...url.searchParams.keys()].some(key => /^(?:api[_-]?key|key|token|access_token|authorization|cookie|password)$/iu.test(key)))
      throw new ModelInventoryReadError("invalid_configuration");
    attemptedUrls.push(url.toString());
    return options.fetch(input, init);
  } });
  return { ...result, ...(attemptedUrls.length ? { sourceUrl: attemptedUrls.at(-1) } : {}), attemptedUrls };
}

function failedResponse(response: Response, errorPayload: unknown, options: InventoryCollectorOptions): InventoryCollectorResult {
  return balanceError(errorPayload) || response.status === 402
    ? failed({ code: "insufficient_balance", httpStatus: response.status }, options)
    : failed(modelInventoryFailure(undefined, response), options);
}

function failed(failure: Pick<ModelInventoryFailure, "code" | "httpStatus"> | { code: string; httpStatus?: number }, options: InventoryCollectorOptions): InventoryCollectorResult {
  return { models: [], complete: false, status: ["invalid_credentials", "permission_denied"].includes(failure.code) ? "unauthorized" : "failed",
    checkedAt: sampleAt(options), failure: { code: failure.code, ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}) } };
}

function apiBase(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new ModelInventoryReadError("invalid_configuration");
  return url.toString().replace(/\/+$/u, "");
}

async function readJson(url: string, options: InventoryCollectorOptions, apiKey?: string, native = false): Promise<{ response: Response; payload?: unknown; errorPayload?: unknown }> {
  const response = await options.fetch(url, { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
    ...(apiKey ? { headers: native ? { "x-goog-api-key": apiKey } : { Authorization: `Bearer ${apiKey}` } } : {}) });
  if (!response.ok) {
    // Gateways report an exhausted balance as 401/402/403 with a JSON code.
    // Read only that bounded error body; other failures are discarded.
    if ([401, 402, 403].includes(response.status)) {
      try { return { response, errorPayload: await readBoundedModelJson(response) }; }
      catch { return { response }; }
    }
    await response.body?.cancel();
    return { response };
  }
  try { return { response, payload: await readBoundedModelJson(response) }; }
  catch { throw new ModelInventoryReadError("invalid_response", response.status); }
}

function assertListComplete(payload: unknown, nativeIds = false): void {
  assertCompleteModelInventoryPayload(payload);
  if (!supplierDirectoryPayloadComplete(payload)) throw new ModelInventoryReadError("incomplete_directory");
  const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const root = record(payload);
  const collections = Array.isArray(payload) ? [payload] : root ? [root.data, root.models, root.items, root.result] : [];
  const entries = collections.flatMap(value => Array.isArray(value) ? value : record(value)
    ? Object.entries(record(value)!).flatMap(([id, row]) => record(row) ? [{ id, ...record(row) }] : []) : []);
  // Existing parsers truncate identifiers at 256 code units. A truncated name
  // cannot become a new complete inventory or match another group's quote.
  const oversized = (value: unknown) => typeof value === "string" && value.trim().length > 256;
  for (const value of entries) {
    const row = record(value);
    if (!row) continue;
    const rawId = nativeIds ? row.name : row.id ?? row.model_name ?? row.model ?? row.name;
    const id = nativeIds && typeof rawId === "string" ? rawId.trim().replace(/^models\//u, "") : rawId;
    if (oversized(id) || !nativeIds && [row.id, row.model_name, row.model].some(oversized) ||
        [row.group, row.model_group, row.modelGroup, row.category, row.channel].some(oversized) ||
        Array.isArray(row.enable_groups) && row.enable_groups.some(oversized)) throw new ModelInventoryReadError("incomplete_directory");
    if (nativeIds && typeof id === "string" && !id.trim()) throw new ModelInventoryReadError("invalid_response");
  }
  for (const value of [root?.group_ratio, root?.usable_group])
    if (record(value) && Object.keys(record(value)!).some(oversized)) throw new ModelInventoryReadError("incomplete_directory");
}

/** /models alternatives are one logical source. Denials and indeterminate failures are final. */
async function readGenericKeyInventory(input: CollectorInput, options: InventoryCollectorOptions): Promise<InventoryCollectorResult> {
  try {
    if (!input.apiKey.trim()) return failed({ code: "invalid_configuration" }, options);
    const base = apiBase(input.baseUrl), google = input.protocol === "google-generate-content";
    const candidates = [...new Set([`${base}/models`, `${base.replace(/\/v1(?:beta)?$/u, "")}/${google ? "v1beta" : "v1"}/models`])];
    for (const [index, url] of candidates.entries()) {
      const hasAlternative = index < candidates.length - 1;
      let read: Awaited<ReturnType<typeof readJson>>;
      try { read = await readJson(url, options, input.apiKey, google); }
      catch (error) {
        // A site root often serves its web page at /models. Like the manual
        // scanner, treat a non-JSON 200 as a miss and try the versioned path.
        if (hasAlternative && error instanceof ModelInventoryReadError && error.code === "invalid_response") continue;
        throw error;
      }
      const { response, payload, errorPayload } = read;
      if (!response.ok) {
        if ([404, 405, 415].includes(response.status) && hasAlternative) continue;
        return failedResponse(response, errorPayload, options);
      }
      try { assertListComplete(payload); }
      catch (error) {
        if (hasAlternative && error instanceof ModelInventoryReadError && error.code === "invalid_response") continue;
        throw error;
      }
      const checkedAt = sampleAt(options);
      const scan = scanProviderModelCatalog(payload, { baseUrl: base, checkedAt, defaultModel: input.defaultModel });
      return { ...scan, complete: true, status: scan.models.length ? "live" : "empty" };
    }
    return failed({ code: "directory_unavailable" }, options);
  } catch (error) { return failed(modelInventoryFailure(error), options); }
}

/** The authenticated native list has its own receipt; it never swallows the generic receipt. */
async function readNativeKeyInventory(input: { config: Readonly<Record<string, unknown>>; apiKey: string }, options: InventoryCollectorOptions): Promise<InventoryCollectorResult> {
  try {
    const url = monsterNativeImageCatalogUrl(input.config) ?? mikotoNativeImageCatalogUrl(input.config);
    if (!url || !input.apiKey.trim()) return failed({ code: "invalid_configuration" }, options);
    const { response, payload, errorPayload } = await readJson(url, options, input.apiKey, true);
    if (!response.ok) return failedResponse(response, errorPayload, options);
    assertListComplete(payload, true);
    const records = (payload as { models?: unknown }).models;
    if (!Array.isArray(records) || records.some(row => !row || typeof row !== "object" || typeof row.name !== "string" || !row.name.trim() ||
        !Array.isArray(row.supportedGenerationMethods) || row.supportedGenerationMethods.some((method: unknown) => typeof method !== "string" || !method.trim())))
      throw new ModelInventoryReadError("invalid_response");
    const scan = mergeMonsterNativeImageCatalog({ models: [], groups: [], checkedAt: sampleAt(options) }, payload, "", String(input.config.baseUrl));
    return { ...scan, checkedAt: sampleAt(options), complete: true, status: scan.models.length ? "live" : "empty" };
  } catch (error) { return failed(modelInventoryFailure(error), options); }
}

type PublicCatalogSnapshot = { marketplaceGroups: Array<{ id: string; models: Array<{ id: string }> }>; groups?: Record<string, ModelDescriptor[]> };

/** A generic parser's quote has no proven group multiplier/conditions. Retain identity only. */
function barePublicOffer(id: string, group?: string): ModelDescriptor {
  return { id, name: id, operations: [], metadata: { publicCatalogOnly: true, ...(group ? { catalogGroup: group } : {}) } };
}

async function collectPublicCatalog(url: string, parse: (payload: Record<string, unknown>) => PublicCatalogSnapshot, options: InventoryCollectorOptions): Promise<InventoryCollectorResult> {
  try {
    const { response, payload } = await readJson(url, options);
    if (!response.ok) return failed(modelInventoryFailure(undefined, response), options);
    assertListComplete(payload);
    const entries = (payload as { data?: unknown }).data;
    if (!Array.isArray(entries) || entries.some(row => !row || typeof row !== "object" || row.enable_groups !== undefined &&
        (!Array.isArray(row.enable_groups) || row.enable_groups.some((id: unknown) => typeof id !== "string" || !id.trim()))))
      throw new ModelInventoryReadError("invalid_response");
    const snapshot = parse(payload as Record<string, unknown>), checkedAt = sampleAt(options);
    const generic = scanProviderModelCatalog(payload, { checkedAt, baseUrl: new URL(url).origin });
    const models: ModelDescriptor[] = [];
    const groups = new Map(snapshot.marketplaceGroups.map(group => [group.id, new Set(group.models.map(model => model.id))]));
    // Generic IDs can exceed a specialised parser's supported operation set.
    // Keep those offers without inventing a transport or borrowing another group price.
    for (const group of generic.groups) {
      if (group.id === "默认群组") continue;
      const ids = groups.get(group.id) ?? new Set<string>();
      for (const id of group.modelIds) ids.add(id);
      groups.set(group.id, ids);
    }
    for (const [group, ids] of groups) {
      for (const id of ids) {
        const descriptor = snapshot.groups?.[group]?.find(model => model.id === id);
        if (descriptor) models.push({ ...descriptor, metadata: { ...descriptor.metadata, catalogGroup: group } });
        else if (generic.models.some(model => model.id === id)) models.push(barePublicOffer(id, group));
        else throw new ModelInventoryReadError("invalid_response");
      }
    }
    for (const model of generic.models.filter(model => !models.some(current => current.id === model.id))) {
      models.push(barePublicOffer(model.id));
    }
    return { models, groups: [...groups].map(([id, ids]) => ({ id, label: id, modelIds: [...ids] })),
      checkedAt, complete: true, status: models.length ? "live" : "empty" };
  } catch (error) { return failed(modelInventoryFailure(error), options); }
}

/** Fresh anonymous offers, not Key membership. No global or persistent catalog cache. */
export const collectGenericKeyInventory = (input: CollectorInput, options: InventoryCollectorOptions) => traced(options, tracedOptions => readGenericKeyInventory(input, tracedOptions));
export const collectNativeKeyInventory = (input: { config: Readonly<Record<string, unknown>>; apiKey: string }, options: InventoryCollectorOptions) => traced(options, tracedOptions => readNativeKeyInventory(input, tracedOptions));
export const collectChentuPublicCatalog = (options: InventoryCollectorOptions) => traced(options, tracedOptions => collectPublicCatalog(CHENTU_CATALOG_SOURCE, chentuCatalogFromPricing, tracedOptions));
export const collectCyberAfeiPublicCatalog = (options: InventoryCollectorOptions) => traced(options, tracedOptions => collectPublicCatalog(CYBERAFEI_CATALOG_SOURCE, cyberAfeiCatalogFromPricing, tracedOptions));
export const collectMiaowuPublicCatalog = (options: InventoryCollectorOptions) => traced(options, tracedOptions => collectPublicCatalog(MIAOWU_CATALOG_SOURCE, payload => {
  const snapshot = miaowuCatalogFromPricing(payload);
  return { marketplaceGroups: snapshot.marketplaceGroups,
    groups: Object.fromEntries(snapshot.marketplaceGroups.map(group => [group.id, miaowuModelsForGroup(snapshot, group.id)])) };
}, tracedOptions));

export type ChentuCapabilitiesCollectorResult = InventoryCollectorResult & {
  capabilities?: Array<{ modelId: string; sizes: Array<{ value: string; ratio?: string }> }>;
};

/** Same-Key image-size declarations, collected without first resolving public models. */
async function readChentuImageCapabilities(apiKey: string, options: InventoryCollectorOptions): Promise<ChentuCapabilitiesCollectorResult> {
  try {
    if (!apiKey.trim()) return failed({ code: "invalid_configuration" }, options);
    const url = `${new URL(CHENTU_CATALOG_SOURCE).origin}/v1/image/model-capabilities`;
    const { response, payload, errorPayload } = await readJson(url, options, apiKey);
    if (!response.ok) return failedResponse(response, errorPayload, options);
    assertListComplete(payload);
    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data)) throw new ModelInventoryReadError("invalid_response");
    const capabilities: NonNullable<ChentuCapabilitiesCollectorResult["capabilities"]> = [];
    for (const row of data) {
      if (!row || typeof row !== "object" || typeof row.model !== "string" || !row.model.trim() || !Array.isArray(row.sizes) ||
          capabilities.some(value => value.modelId === row.model)) throw new ModelInventoryReadError("invalid_response");
      const sizes: Array<{ value: string; ratio?: string }> = [];
      for (const size of row.sizes) {
        if (!size || typeof size !== "object" || typeof size.value !== "string") throw new ModelInventoryReadError("invalid_response");
        const pixels = /^(\d+)x(\d+)$/u.exec(size.value);
        if (size.value !== "auto" && (!pixels || Number(pixels[1]) < 16 || Number(pixels[2]) < 16)) throw new ModelInventoryReadError("invalid_response");
        if (size.ratio !== undefined && typeof size.ratio !== "string") throw new ModelInventoryReadError("invalid_response");
        if (sizes.some(value => value.value === size.value)) throw new ModelInventoryReadError("invalid_response");
        sizes.push({ value: size.value, ...(size.ratio ? { ratio: size.ratio } : {}) });
      }
      if (!sizes.some(size => size.value !== "auto")) throw new ModelInventoryReadError("invalid_response");
      capabilities.push({ modelId: row.model.trim(), sizes });
    }
    return { models: [], capabilities, complete: true, status: capabilities.length ? "live" : "empty", checkedAt: sampleAt(options) };
  } catch (error) { return failed(modelInventoryFailure(error), options); }
}

/** Dream's authenticated list is independent from both /models and per-model schemas. */
async function readMiaowuMediaInventory(apiKey: string, options: InventoryCollectorOptions): Promise<InventoryCollectorResult> {
  try {
    if (!apiKey.trim()) return failed({ code: "invalid_configuration" }, options);
    const { response, payload, errorPayload } = await readJson(`${MIAOWU_BASE_URL}/v1/dream/model_list`, options, apiKey);
    if (!response.ok) return failedResponse(response, errorPayload, options);
    assertListComplete(payload);
    const rows = (payload as { data?: unknown }).data;
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || typeof row.id !== "string" || !row.id.trim() || !["image", "video"].includes(row.type)))
      throw new ModelInventoryReadError("invalid_response");
    const checkedAt = sampleAt(options);
    const scan = scanProviderModelCatalog({ data: rows.map(row => ({ id: row.id, output_modalities: [row.type] })) }, { checkedAt });
    return { ...scan, complete: true, status: scan.models.length ? "live" : "empty" };
  } catch (error) { return failed(modelInventoryFailure(error), options); }
}

export type MiaowuSchemaCollectorResult = InventoryCollectorResult & {
  contract?: MiaowuImageSchemaContract | MiaowuVideoSchemaContract;
  normalizedSchemaSha256?: string;
};

/** One model, one schema. A rejected schema never changes either directory's completeness. */
async function readMiaowuSchema(id: string, kind: "image" | "video", apiKey: string, options: InventoryCollectorOptions): Promise<MiaowuSchemaCollectorResult> {
  try {
    if (!id.trim() || !apiKey.trim()) return failed({ code: "invalid_configuration" }, options);
    const { response, payload, errorPayload } = await readJson(`${MIAOWU_BASE_URL}/v1/dream/model_schema?model=${encodeURIComponent(id)}`, options, apiKey);
    if (!response.ok) return failedResponse(response, errorPayload, options);
    let contract: MiaowuImageSchemaContract | MiaowuVideoSchemaContract;
    try { contract = kind === "image" ? parseMiaowuImageSchema(id, payload) : parseMiaowuVideoSchema(id, payload); }
    catch { return failed({ code: "invalid_response" }, options); }
    return { models: [], status: "live", complete: true, checkedAt: sampleAt(options), contract,
      normalizedSchemaSha256: createHash("sha256").update(JSON.stringify(contract)).digest("hex") };
  } catch (error) { return failed(modelInventoryFailure(error), options); }
}

export const collectChentuImageCapabilities = (apiKey: string, options: InventoryCollectorOptions) => traced(options, tracedOptions => readChentuImageCapabilities(apiKey, tracedOptions));
export const collectMiaowuMediaInventory = (apiKey: string, options: InventoryCollectorOptions) => traced(options, tracedOptions => readMiaowuMediaInventory(apiKey, tracedOptions));
export const collectMiaowuSchema = (id: string, kind: "image" | "video", apiKey: string, options: InventoryCollectorOptions) => traced(options, tracedOptions => readMiaowuSchema(id, kind, apiKey, tracedOptions));

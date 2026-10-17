import { parseSupplierCatalog, parseSupplierKeyGroups, parseSupplierPricingChannels, supplierDirectoryPayloadComplete,
  type DiscoveredSupplierGroup, type ModelDescriptor } from "@super-canvas/providers";
import { readCatalogLoaderJson, type CatalogLoaderReadOptions } from "./catalog-loader-http";
import { ModelInventoryReadError } from "./model-inventory-failure";

export type GenericSupplierSourceEntry = "pricing" | "plaza" | "newapi-groups" | "sub2api-groups" |
  "pricing-channels" | "available-channels" | "status";
export interface GenericSupplierSourceRead {
  models: ModelDescriptor[];
  groups: DiscoveredSupplierGroup[];
  complete: boolean;
  checkedAt: string;
  dependencies?: Record<string, number | string>;
}
const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const identifier = (value: unknown): boolean => typeof value === "string" && !!value.trim() && value.trim().length <= 256;
const rowId = (value: unknown): boolean => typeof value === "string" ? identifier(value)
  : identifier(object(value)?.id ?? object(value)?.model_name ?? object(value)?.model ?? object(value)?.name);
/** Match the existing parser's stable-ID normalization. A repeated identity
 * must not disappear inside its Map while the source is called exhaustive. */
function uniqueGroupIdentities(entries: readonly unknown[]): boolean {
  const seen = new Set<string>();
  for (const value of entries) {
    const row = object(value);
    if (!row) return false;
    const raw = row.id, number = typeof raw === "number" ? raw
      : typeof raw === "string" && /^\d+$/u.test(raw.trim()) ? Number(raw) : NaN;
    const name = row.name ?? row.id;
    const identity = Number.isSafeInteger(number) && number >= 0 ? `site-id:${number}`
      : typeof name === "string" && identifier(name) ? `name:${name.trim()}` : undefined;
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
  }
  return true;
}
const successful = (payload: unknown): boolean => {
  const root = object(payload);
  return (!root || !root.error && root.success !== false && root.success !== "false") &&
    (root?.code === undefined || root.code === null || [0, 200, "0", "200", "ok", "success"].includes(root.code as string | number));
};

/** A site-account transport may contain credentials, so it is usable only on
 * this exact origin and gateway prefix. No alternative endpoint is dispatched. */
function validateSource(urlValue: string, siteValue: string): string {
  try {
    const url = new URL(urlValue), site = new URL(siteValue);
    const safe = (value: URL) => value.protocol === "https:" && !value.username && !value.password && !value.search && !value.hash;
    const prefix = site.pathname.replace(/\/$/u, "");
    if (!safe(url) || !safe(site) || url.origin !== site.origin || prefix && !url.pathname.startsWith(`${prefix}/`))
      throw new Error("unsafe");
    return url.href;
  } catch { throw new ModelInventoryReadError("invalid_configuration"); }
}

function catalogShape(payload: unknown): boolean {
  const root = object(payload), data = object(root?.data), groups = root?.groups ?? data?.groups;
  if (Array.isArray(groups)) return groups.length <= 500 && uniqueGroupIdentities(groups) && groups.every(value => {
    const group = object(value);
    return !!group && identifier(group.name ?? group.id) && Array.isArray(group.models) && group.models.length <= 3000 && group.models.every(rowId);
  });
  const rows = Array.isArray(payload) ? payload : [root?.data, root?.models, root?.items, data?.data, data?.models, data?.items].find(Array.isArray);
  return Array.isArray(rows) && rows.every(value => {
    if (!rowId(value)) return false;
    const row = object(value);
    return row?.enable_groups === undefined || Array.isArray(row.enable_groups) && row.enable_groups.every(identifier);
  });
}

function groupShape(payload: unknown, kind: "newapi" | "sub2api"): boolean {
  const root = object(payload), data = root?.data;
  if (kind === "sub2api") {
    const entries = Array.isArray(data) ? data : object(data)?.groups;
    return Array.isArray(entries) && entries.length <= 500 && uniqueGroupIdentities(entries) && entries.every(value => identifier(object(value)?.name));
  }
  const entries = object(data);
  return !!entries && Object.keys(entries).length <= 500 &&
    uniqueGroupIdentities(Object.keys(entries).map(name => ({ name }))) && Object.entries(entries).every(([id, value]) =>
    identifier(id) && !!object(value) && ("desc" in object(value)! || "ratio" in object(value)!));
}

function channelShape(payload: unknown): boolean {
  const root = object(payload), data = root?.data, channels = Array.isArray(data) ? data : object(data)?.channels;
  return Array.isArray(channels) && channels.length <= 500 && channels.every(value => {
    const channel = object(value);
    return !!channel && supplierDirectoryPayloadComplete(channel) && Array.isArray(channel.platforms) && channel.platforms.every(value => {
      const platform = object(value);
      return !!platform && supplierDirectoryPayloadComplete(platform) && Array.isArray(platform.groups) && uniqueGroupIdentities(platform.groups) &&
        platform.groups.every(value => identifier(object(value)?.name)) && Array.isArray(platform.supported_models) &&
        platform.supported_models.length <= 3000 && platform.supported_models.every(value => !!object(value) && rowId(value));
    });
  });
}

function descriptors(groups: readonly DiscoveredSupplierGroup[]): ModelDescriptor[] {
  return groups.flatMap(group => group.models.map(model => ({ id: model.id, name: model.name ?? model.id, operations: [],
    ...(model.inputKinds ? { inputKinds: model.inputKinds } : {}), ...(model.outputKinds ? { outputKinds: model.outputKinds } : {}),
    ...(model.limits ? { limits: model.limits } : {}), metadata: { ...model.metadata, catalogGroup: group.id,
      ...(group.supplierGroupId ? { supplierGroupId: group.supplierGroupId } : {}), publicCatalogOnly: true,
      ...(model.priceLabel ? { priceLabel: model.priceLabel } : {}) } })));
}

/** Read exactly one logical endpoint through the caller's transport. The
 * account/public source role remains in the outer read plan, never Key access. */
export async function collectGenericSupplierSource(input: { url: string; siteUrl: string; entry: GenericSupplierSourceEntry },
  options: CatalogLoaderReadOptions): Promise<GenericSupplierSourceRead> {
  const url = validateSource(input.url, input.siteUrl), checkedAt = options.checkedAt ?? new Date().toISOString();
  const payload = await readCatalogLoaderJson(url, options);
  const envelopeComplete = successful(payload) && supplierDirectoryPayloadComplete(payload);
  if (input.entry === "status") {
    const root = object(payload), data = object(root?.data);
    const dependencies: Record<string, number | string> = {};
    for (const key of ["quota_display_type", "custom_currency_symbol", "custom_currency_exchange_rate", "usd_exchange_rate", "quota_per_unit"]) {
      const value = data?.[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 || typeof value === "string" && value.length <= 32)
        dependencies[key] = value;
    }
    return { models: [], groups: [], complete: envelopeComplete && !!data, checkedAt, dependencies };
  }
  let groups: DiscoveredSupplierGroup[], shape: boolean, parserComplete = true;
  if (input.entry === "newapi-groups" || input.entry === "sub2api-groups") {
    const kind = input.entry === "newapi-groups" ? "newapi" : "sub2api";
    const parsed = parseSupplierKeyGroups(payload, kind, { supplierSiteUrl: input.siteUrl });
    groups = parsed ?? []; shape = groupShape(payload, kind); parserComplete = parsed !== null;
  } else if (input.entry === "pricing-channels" || input.entry === "available-channels") {
    const currency = new URL(input.siteUrl).hostname === "token.secure-skill.com" ? "CNY" : undefined;
    groups = parseSupplierPricingChannels(payload, currency, { supplierSiteUrl: input.siteUrl, checkedAt, sourceUrl: url });
    shape = channelShape(payload);
  } else {
    const parsed = parseSupplierCatalog(payload, { supplierSiteUrl: input.siteUrl, checkedAt });
    groups = parsed.groups; shape = catalogShape(payload); parserComplete = parsed.recognized && parsed.complete !== false;
  }
  return { models: descriptors(groups), groups, complete: envelopeComplete && shape && parserComplete, checkedAt };
}

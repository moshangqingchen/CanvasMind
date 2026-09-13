import { fetchProviderJson, providerFetch, ProviderHttpError } from "./http.js";
import type { FetchImplementation } from "./contracts.js";
import { catalogPriceLabel } from "./catalog-pricing.js";

export type SupplierSiteKind =
  "auto" | "newapi" | "sub2api" | "openai-compatible";
export interface DiscoveredSupplierModel {
  id: string;
  name?: string;
  capability: "image" | "video" | "chat" | "other";
  protocol?:
    | "openai-images"
    | "openai-videos"
    | "chat-completions"
    | "responses"
    | "gemini"
    | "unknown";
  priceLabel?: string;
}
export interface DiscoveredSupplierGroup {
  id: string;
  label: string;
  source: "catalog";
  models: DiscoveredSupplierModel[];
}
export interface SupplierCatalogDiscovery {
  groups: DiscoveredSupplierGroup[];
  kind: SupplierSiteKind;
  status: "live" | "empty" | "failed" | "unauthorized";
  checkedAt: string;
  error?: string;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, 256) : "";
const values = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(text).filter(Boolean)
    : text(value)
      ? [text(value)]
      : [];

/** Credentials and query strings are never retained in supplier URLs. */
export function normalizeSupplierUrl(value: string): string {
  if (!value.trim()) return "";
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("地址必须使用 HTTP 或 HTTPS");
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "地址中不能包含账号、密码、查询参数或片段，请在站点登录栏填写账号密码",
    );
  return url.toString().replace(/\/+$/u, "");
}

/** Matches the CDR store: preserve gateway prefixes, remove only API version suffixes. */
export function normalizeSupplierSiteBase(value: string): string {
  return normalizeSupplierUrl(value).replace(/\/(?:v1|v1beta)$/iu, "");
}

export function supplierDirectoryBase(value: string): string {
  return normalizeSupplierSiteBase(
    value.replace(
      /\/(?:api\/pricing|api\/v1\/model-plaza|api\/v1\/groups\/available|api\/user\/self\/groups|api\/status|setup\/status|v1\/models|console\/token|dashboard|model-plaza|model-market|marketplace|models|pricing|keys)\/?$/iu,
      "",
    ),
  );
}

/** Read only the group options used by the API-key page, never its key list. */
export function parseSupplierKeyGroups(
  payload: unknown,
  kind: "newapi" | "sub2api",
): DiscoveredSupplierGroup[] | null {
  const root = record(payload);
  if (
    root?.success === false ||
    (typeof root?.code === "number" && root.code !== 0 && root.code !== 200)
  )
    return null;
  const data: unknown = root?.data ?? payload;
  const groups = new Map<string, DiscoveredSupplierGroup>();
  const add = (id: string, label: string) => {
    if (id && groups.size < 500 && !groups.has(id))
      groups.set(id, { id, label: label || id, source: "catalog", models: [] });
  };
  if (kind === "sub2api") {
    const entries = Array.isArray(data) ? data : record(data)?.groups;
    if (!Array.isArray(entries)) return null;
    for (const entry of entries) {
      const group = record(entry);
      if (!group) continue;
      // Keep the same name-based identity as model-plaza and saved connections.
      const name = text(group.name);
      add(name, text(group.label) || name);
    }
    if (entries.length && !groups.size) return null;
  } else {
    if (!root || !("data" in root)) return null;
    const entries = record(data);
    if (!entries) return null;
    for (const [id, value] of Object.entries(entries)) {
      const group = record(value);
      if (group && ("desc" in group || "ratio" in group))
        add(text(id), text(group.desc) || text(id));
    }
    if (Object.keys(entries).length && !groups.size) return null;
  }
  return [...groups.values()];
}

function modelFrom(value: unknown): DiscoveredSupplierModel | undefined {
  const item = typeof value === "string" ? { id: value } : record(value);
  if (!item) return undefined;
  const id = text(item.id ?? item.model_name ?? item.model ?? item.name);
  if (!id) return undefined;
  const endpoints = [
    ...values(item.supported_endpoint_types),
    ...values(item.endpoints),
    text(item.protocol),
  ].join(" ");
  const hint = `${id} ${text(item.type)} ${text(item.capability)} ${endpoints}`;
  const capability: DiscoveredSupplierModel["capability"] =
    /video|kling|sora|veo|seedance|hailuo|视频/iu.test(hint)
      ? "video"
      : /image|dall[-_ ]?e|flux|seedream|imagen|sdxl|图像|绘图/iu.test(hint)
        ? "image"
        : /chat|responses|gpt|claude|gemini|grok|qwen|deepseek|llama|对话/iu.test(
              hint,
            )
          ? "chat"
          : "other";
  const protocol: DiscoveredSupplierModel["protocol"] =
    /gemini|generatecontent/iu.test(endpoints)
      ? "gemini"
      : /responses/iu.test(endpoints)
        ? "responses"
        : /chat/iu.test(endpoints)
          ? "chat-completions"
          : /image/iu.test(endpoints)
            ? "openai-images"
            : /video/iu.test(endpoints)
              ? "openai-videos"
              : "unknown";
  const pricing = record(item.pricing);
  const priceLabel =
    catalogPriceLabel(item) ??
    text(
      item.price_label ??
        item.priceLabel ??
        pricing?.label ??
        (typeof item.price === "string" ? item.price : undefined),
    );
  return {
    id,
    name: text(item.display_name ?? item.name) || id,
    capability,
    protocol,
    ...(priceLabel ? { priceLabel } : {}),
  };
}

/** Parse public New API pricing, Sub2API model plaza, and OpenAI model lists. */
export function parseSupplierCatalog(
  payload: unknown,
  priceDisplay: { currency?: string; multiplier?: number } = {},
): {
  groups: DiscoveredSupplierGroup[];
  kind: SupplierSiteKind;
  recognized: boolean;
} {
  const root = record(payload);
  const data = record(root?.data);
  const nestedGroups = root?.groups ?? data?.groups;
  const byGroup = new Map<string, DiscoveredSupplierGroup>();
  const add = (id: string, label: string, model?: DiscoveredSupplierModel) => {
    if (!id || (byGroup.size >= 500 && !byGroup.has(id))) return;
    const group = byGroup.get(id) ?? {
      id,
      label: label || id,
      source: "catalog",
      models: [],
    };
    if (
      model &&
      group.models.length < 3000 &&
      !group.models.some((item) => item.id === model.id)
    )
      group.models.push(model);
    byGroup.set(id, group);
  };
  if (Array.isArray(nestedGroups)) {
    for (const raw of nestedGroups) {
      const group = record(raw);
      if (!group) continue;
      const id = text(group.name ?? group.id);
      const label = text(group.label ?? group.description ?? group.name) || id;
      add(id, label);
      for (const model of Array.isArray(group.models) ? group.models : [])
        add(id, label, modelFrom(model));
    }
    return { groups: [...byGroup.values()], kind: "sub2api", recognized: true };
  }
  const ratios = record(root?.group_ratio ?? data?.group_ratio);
  const usable = record(root?.usable_group ?? data?.usable_group);
  const rawItems = Array.isArray(payload)
    ? payload
    : ([
        root?.data,
        root?.models,
        root?.items,
        data?.data,
        data?.models,
        data?.items,
      ].find((item) => Array.isArray(item) && item.length > 0) ??
      [
        root?.data,
        root?.models,
        root?.items,
        data?.data,
        data?.models,
        data?.items,
      ].find(Array.isArray));
  const entries = Array.isArray(rawItems) ? rawItems : [];
  const isNewApi = Boolean(
    ratios ||
    usable ||
    entries.some((item) => record(item)?.model_name !== undefined),
  );
  for (const id of Object.keys(usable ?? {}))
    add(text(id), text(usable?.[id]) || text(id));
  const allGroupModels: Array<{
    model: DiscoveredSupplierModel;
    raw: unknown;
  }> = [];
  const withGroupPrice = (
    model: DiscoveredSupplierModel,
    raw: unknown,
    id: string,
  ) => {
    const explicitCurrency = text(
      record(record(raw)?.pricing)?.currency ??
        record(raw)?.currency ??
        root?.currency ??
        data?.currency,
    );
    const multiplier =
      Number(ratios?.[id] ?? 1) *
      (explicitCurrency ? 1 : (priceDisplay.multiplier ?? 1));
    const currency = text(
      root?.currency ?? data?.currency ?? priceDisplay.currency,
    );
    const priceLabel = catalogPriceLabel(raw, {
      newApi: isNewApi,
      multiplier,
      ...(currency ? { currency } : {}),
    });
    return priceLabel ? { ...model, priceLabel } : model;
  };
  for (const raw of entries) {
    const item = record(raw);
    const model = modelFrom(raw);
    if (!model) continue;
    const enabled = values(item?.enable_groups);
    const memberships = enabled.length
      ? enabled
      : values(
          item?.enable_group ??
            item?.groups ??
            item?.group ??
            item?.model_group ??
            item?.modelGroup ??
            item?.category ??
            item?.channel,
        );
    if (memberships.includes("all")) allGroupModels.push({ model, raw });
    for (const id of memberships.length
      ? memberships.filter((group) => group !== "all")
      : isNewApi
        ? []
        : ["默认群组"])
      add(id, text(usable?.[id]) || id, withGroupPrice(model, raw, id));
  }
  for (const { model, raw } of allGroupModels)
    for (const group of byGroup.values())
      add(group.id, group.label, withGroupPrice(model, raw, group.id));
  return {
    groups: [...byGroup.values()],
    kind: isNewApi ? "newapi" : "openai-compatible",
    recognized: Array.isArray(rawItems) || isNewApi,
  };
}

export function supplierModelUrls(apiUrl: string): string[] {
  const base = normalizeSupplierUrl(apiUrl).replace(/\/(?:v1\/)?models$/u, "");
  if (!base) return [];
  const url = new URL(base);
  const pathname = url.pathname.replace(/\/+$/u, "");
  return [
    ...new Set(
      /\/v1$/u.test(pathname)
        ? [`${base}/models`]
        : [`${base}/v1/models`, `${base}/models`],
    ),
  ];
}

export async function discoverSupplierCatalog(
  input: {
    siteUrl: string;
    apiUrl: string;
    kind?: SupplierSiteKind;
    token?: string;
  },
  fetchImpl: FetchImplementation = providerFetch,
): Promise<SupplierCatalogDiscovery> {
  const checkedAt = new Date().toISOString();
  let kind = input.kind ?? "auto";
  const siteUrl = supplierDirectoryBase(input.siteUrl || input.apiUrl);
  if (!siteUrl)
    return {
      groups: [],
      kind,
      status: "failed",
      checkedAt,
      error: "请先填写官网、目录地址或 API 地址",
    };
  const probe = async (
    url: string,
    headers?: Record<string, string>,
  ): Promise<{ status: number; payload?: unknown }> => {
    try {
      const payload = await fetchProviderJson(
        fetchImpl,
        url,
        { method: "GET", cache: "no-store", ...(headers ? { headers } : {}) },
        {
          phase: "connect",
          timeoutMs: 8000,
          maxResponseBytes: 4 * 1024 * 1024,
        },
      );
      return { status: 200, payload };
    } catch (error) {
      return {
        status:
          error instanceof ProviderHttpError ? (error.details.status ?? 0) : 0,
      };
    }
  };
  const success = (
    parsed: ReturnType<typeof parseSupplierCatalog>,
    detected: SupplierSiteKind,
  ): SupplierCatalogDiscovery => ({
    groups: parsed.groups,
    kind: detected,
    status: parsed.groups.length ? "live" : "empty",
    checkedAt,
  });
  const unavailable = (
    message: string,
    unauthorized = false,
  ): SupplierCatalogDiscovery => ({
    groups: [],
    kind,
    status: unauthorized ? "unauthorized" : "failed",
    checkedAt,
    error: message,
  });
  const siteHeaders = (
    platform: "newapi" | "sub2api",
  ): Record<string, string> | undefined => {
    if (!input.token?.trim() || !input.siteUrl) return undefined;
    const token = input.token.trim();
    const split = token.lastIndexOf(":");
    const userId =
      platform === "newapi" &&
      split > 0 &&
      /^\d+$/u.test(token.slice(split + 1))
        ? token.slice(split + 1)
        : undefined;
    return {
      authorization: `Bearer ${userId ? token.slice(0, split) : token}`,
      ...(userId ? { "New-Api-User": userId } : {}),
    };
  };
  const keyGroups = async (
    platform: "newapi" | "sub2api",
  ): Promise<SupplierCatalogDiscovery | undefined> => {
    const path =
      platform === "sub2api"
        ? "/api/v1/groups/available"
        : "/api/user/self/groups";
    const result = await probe(`${siteUrl}${path}`, siteHeaders(platform));
    const groups =
      result.status === 200
        ? parseSupplierKeyGroups(result.payload, platform)
        : null;
    if (groups)
      return {
        groups,
        kind: platform,
        status: groups.length ? "live" : "empty",
        checkedAt,
      };
    if ([401, 403].includes(result.status))
      return {
        groups: [],
        kind: platform,
        status: "unauthorized",
        checkedAt,
        error:
          "模型广场未提供分组，API 密钥页面的分组列表需要登录；请填写站点账号密码后重新扫描",
      };
    return undefined;
  };
  const fallbackGroups = async (
    platform: "newapi" | "sub2api",
    fallback: SupplierCatalogDiscovery,
  ) => (await keyGroups(platform)) ?? fallback;

  // CDR probe order is significant: a recognized (including login-gated) platform stops inference.
  if (kind === "auto" || kind === "newapi") {
    const pricingUrl = `${siteUrl}/api/pricing`;
    let pricing = await probe(pricingUrl);
    if ([401, 403].includes(pricing.status) && siteHeaders("newapi"))
      pricing = await probe(pricingUrl, siteHeaders("newapi"));
    const payload = record(pricing.payload);
    const parsed = parseSupplierCatalog(pricing.payload);
    if (
      pricing.status === 200 &&
      payload &&
      "data" in payload &&
      payload.success !== false &&
      parsed.recognized
    ) {
      if (parsed.groups.length) {
        // New API can display its USD accounting prices in a configured local currency.
        const rows = Array.isArray(payload.data) ? payload.data : [];
        if (
          rows.some((row) => {
            const r = record(row);
            return (
              r &&
              (typeof r.model_price === "number" ||
                typeof r.model_ratio === "number")
            );
          })
        ) {
          const status = await probe(`${siteUrl}/api/status`);
          const settings = record(record(status.payload)?.data);
          const currency = text(settings?.quota_display_type);
          const exchange = Number(settings?.usd_exchange_rate);
          if (currency === "CNY" && Number.isFinite(exchange) && exchange > 0)
            return success(
              parseSupplierCatalog(pricing.payload, {
                currency,
                multiplier: exchange,
              }),
              "newapi",
            );
        }
        return success(parsed, "newapi");
      }
      return fallbackGroups("newapi", success(parsed, "newapi"));
    }
    if (pricing.status === 401 || pricing.status === 403) {
      kind = "newapi";
      return fallbackGroups(
        "newapi",
        unavailable(
          "模型广场与 API 密钥分组列表暂不可用；可填写站点账号密码重试，或手动添加分组",
          true,
        ),
      );
    }
  }
  if (kind === "auto" || kind === "sub2api") {
    let plaza = await probe(`${siteUrl}/api/v1/model-plaza`);
    if ([401, 403].includes(plaza.status) && input.token && input.siteUrl)
      plaza = await probe(`${siteUrl}/api/v1/model-plaza`, {
        authorization: `Bearer ${input.token.trim()}`,
      });
    const data = record(record(plaza.payload)?.data);
    if (plaza.status === 200 && data && Array.isArray(data.groups)) {
      const parsed = parseSupplierCatalog(plaza.payload);
      if (parsed.groups.length) return success(parsed, "sub2api");
      return fallbackGroups("sub2api", success(parsed, "sub2api"));
    }
    if (plaza.status === 401 || plaza.status === 403) {
      kind = "sub2api";
      return fallbackGroups(
        "sub2api",
        unavailable(
          "模型广场与 API 密钥分组列表需要登录，请填写站点账号密码后重新扫描",
          true,
        ),
      );
    }
  }
  if (kind === "auto") {
    const status = await probe(`${siteUrl}/api/status`);
    const data = record(record(status.payload)?.data);
    if (
      status.status === 200 &&
      data &&
      ["system_name", "HeaderNavModules", "version", "quota_per_unit"].some(
        (key) => key in data,
      )
    ) {
      kind = "newapi";
      return fallbackGroups(
        "newapi",
        unavailable(
          "已识别 NewAPI，但模型广场与 API 密钥分组列表均不可用；请填写站点账号密码重试或手动添加分组",
        ),
      );
    }
    const setup = await probe(`${siteUrl}/setup/status`);
    const payload = record(setup.payload);
    const setupData = record(payload?.data);
    if (
      setup.status === 200 &&
      payload &&
      "code" in payload &&
      setupData &&
      "needs_setup" in setupData
    ) {
      kind = "sub2api";
      return fallbackGroups(
        "sub2api",
        unavailable(
          "已识别 Sub2API，但模型广场与 API 密钥分组列表均不可用；请填写站点账号密码重试或手动添加分组",
        ),
      );
    }
  }
  if (kind === "newapi" || kind === "sub2api") {
    return fallbackGroups(
      kind,
      unavailable(
        "模型广场与 API 密钥分组列表均未返回可用分组，可手动添加分组并配置 Key",
      ),
    );
  }
  if (kind === "auto") {
    let gated: SupplierCatalogDiscovery | undefined;
    for (const platform of ["newapi", "sub2api"] as const) {
      const result = await keyGroups(platform);
      if (result?.status === "live" || result?.status === "empty")
        return result;
      gated ??= result;
    }
    if (gated) return gated;
  }
  if (kind === "auto" || kind === "openai-compatible") {
    kind = "openai-compatible";
    // Public model lists may aid generic discovery. The site login token is NEVER an API key.
    for (const url of supplierModelUrls(input.apiUrl || siteUrl)) {
      const models = await probe(url);
      const parsed = parseSupplierCatalog(models.payload);
      if (models.status === 200 && parsed.recognized)
        return success(parsed, kind);
      if (models.status === 401 || models.status === 403) break;
    }
  }
  return unavailable(
    "未读取到分组或模型目录，可以手动添加分组并配置 Key 后扫描模型",
  );
}

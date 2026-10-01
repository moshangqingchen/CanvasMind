import type { SupplierState, SupplierRecord as StoredSupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { PROVIDER_SUPPLIER_PROFILES } from "@super-canvas/providers/suppliers";
import {
  invalidateModelCache,
  type ProviderConnectionView,
} from "./client-api";
import {
  providerConnectionGroup,
  providerConnectionSupplierKey,
  providerConnectionUsage,
} from "./provider-connection-options";

export type SupplierKind = "auto" | "newapi" | "sub2api" | "openai-compatible";
export type SupplierSiteAuthMode = "password" | "access-token";
export type SupplierSiteLoginInput =
  | { authMode?: "password"; username: string; password: string }
  | { authMode: "access-token"; accessToken?: string; userId?: string | null };
export interface SupplierSiteLoginSummary {
  configured: boolean;
  /** Missing on older responses; those use the account/password method. */
  authMode?: SupplierSiteAuthMode;
  username?: string;
  userId?: string;
}
export type SupplierModelProtocol =
  | "openai-images"
  | "openai-videos"
  | "chat-completions"
  | "responses"
  | "gemini"
  | "rest"
  | "anthropic-messages"
  | "google-generate-content"
  | "xai-responses"
  | "generic-openai-compatible"
  | "unknown";
export interface SupplierCatalogModel {
  id: string;
  name?: string;
  capability: "image" | "video" | "chat" | "other";
  protocol?: SupplierModelProtocol;
  priceLabel?: string;
  inputKinds?: ModelDescriptor["inputKinds"];
  outputKinds?: ModelDescriptor["outputKinds"];
  limits?: ModelDescriptor["limits"];
  metadata?: ModelDescriptor["metadata"];
}
export interface SupplierCatalogGroup {
  id: string;
  label: string;
  source?: "manual" | "catalog";
  status?: "available" | "missing";
  models: SupplierCatalogModel[];
  details?: StoredSupplierRecord["catalog"]["groups"][number]["details"];
}
export interface SupplierRecord {
  state?: Omit<SupplierState, "siteLogin">;
  siteLogin?: SupplierSiteLoginSummary;
  id: string;
  name: string;
  supplierKey: string;
  siteUrl: string;
  apiUrl: string;
  kind: SupplierKind;
  catalog: { groups: SupplierCatalogGroup[] };
  scanStatus: "unscanned" | "live" | "empty" | "failed" | "unauthorized";
  scannedAt?: string;
  scanLastSuccessAt?: string;
  scanError?: string;
  scanErrorCode?: StoredSupplierRecord["scanErrorCode"];
  scanRetryable?: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface SupplierInput {
  name: string;
  supplierKey?: string;
  siteUrl?: string;
  apiUrl?: string;
  kind?: SupplierKind;
}
export interface ManualSupplierModel extends SupplierCatalogModel {
  capability: "image" | "video" | "chat";
  protocol: SupplierModelProtocol;
}

async function supplierRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : undefined;
    throw new Error(
      typeof error === "string"
        ? error
        : `供应商请求失败（HTTP ${response.status}）`,
    );
  }
  if (payload === null) throw new Error("供应商返回了无效响应，请重试。");
  return payload as T;
}

export function fetchSuppliers(): Promise<SupplierRecord[]> {
  return supplierRequest("/api/suppliers");
}
export function createSupplier(input: SupplierInput): Promise<SupplierRecord> {
  return supplierRequest("/api/suppliers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function updateSupplier(
  id: string,
  input: Partial<SupplierInput> & {
    catalog?: { groups: SupplierCatalogGroup[] };
    expectedRevision?: number;
    visibility?: "visible" | "hidden";
    generationTransport?: "local" | "cloudflare";
    siteLogin?: SupplierSiteLoginInput | null;
  },
): Promise<SupplierRecord> {
  return supplierRequest(`/api/suppliers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function scanSupplier(
  id: string,
  token?: string,
  expectedRevision?: number,
): Promise<SupplierRecord> {
  return supplierRequest(`/api/suppliers/${encodeURIComponent(id)}/scan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...(token?.trim() ? { token: token.trim() } : {}),
      expectedRevision,
    }),
  });
}

export async function deleteManualSupplierGroup(
  id: string,
  groupId: string,
  expectedRevision: number,
): Promise<SupplierRecord> {
  const supplier = await supplierRequest<SupplierRecord>(
    `/api/suppliers/${encodeURIComponent(id)}/groups`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId, expectedRevision }),
    },
  );
  return supplier;
}

/** Settings must report upstream failure instead of treating cached models as a successful scan. */
export async function readSupplierModels(
  id: string,
  refresh: boolean,
  options: { cachedOnly?: boolean } = {},
): Promise<{ models: ModelDescriptor[]; status?: string; checkedAt?: string; lastSuccessAt?: string; source?: string }> {
  const query = new URLSearchParams({ fresh: String(Date.now()) });
  if (options.cachedOnly) query.set("cached", "1");
  else if (refresh) query.set("refresh", "1");
  const response = await fetch(
    `/api/providers/${encodeURIComponent(id)}/models?${query}`,
    { cache: "no-store" },
  );
  const payload: unknown = await response.json().catch(() => null);
  const status = response.headers.get("X-Model-Scan-Status") ?? undefined;
  if (
    !response.ok ||
    status === "unauthorized" ||
    (!options.cachedOnly && (status === "failed" || status === "stale"))
  ) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : undefined;
    throw new Error(
      typeof error === "string"
        ? error
        : status === "unauthorized"
          ? "这把 Key 暂无访问权限，请检查后重试。"
          : status === "stale"
            ? "本次扫描未完成，已有模型与配置已保留，请稍后重试。"
            : `模型扫描失败（HTTP ${response.status}），已保留保存的配置。`,
    );
  }
  if (!Array.isArray(payload))
    throw new Error("模型列表格式无效，已保留保存的配置。");
  if (refresh && !options.cachedOnly) invalidateModelCache(id);
  return {
    models: payload as ModelDescriptor[], status,
    checkedAt: response.headers.get("X-Model-Scan-Checked-At") ?? undefined,
    lastSuccessAt: response.headers.get("X-Model-Scan-Last-Success-At") ?? undefined,
    source: response.headers.get("X-Model-Scan-Source") ?? undefined,
  };
}

export function supplierOwnsConnection(
  supplier: Pick<SupplierRecord, "id" | "supplierKey"> & {
    apiUrl?: string;
    state?: SupplierRecord["state"];
    record?: SupplierRecord;
  },
  connection: ProviderConnectionView,
): boolean {
  if (connection.config.supplierArchived === true) return false;
  const savedId = connection.config.supplierId;
  if (typeof savedId === "string" && savedId.length > 0) {
    const state = supplier.state ?? supplier.record?.state;
    if (
      state &&
      connection.config.supplierSourceId &&
      connection.config.supplierSourceId !== state.sourceId
    )
      return false;
    return savedId === supplier.id;
  }
  if (providerConnectionSupplierKey(connection) !== supplier.supplierKey)
    return false;
  const apiIdentity = (value: unknown) => {
    try {
      return typeof value === "string" && value.trim()
        ? cleanSupplierAddress(value).replace(/\/v1(?:beta)?$/iu, "")
        : "";
    } catch {
      return "";
    }
  };
  const connectionAddress = apiIdentity(connection.config.baseUrl);
  const supplierAddress = apiIdentity(supplier.apiUrl);
  const officialOpenAiAddress = (address: string) =>
    !address || new URL(address).hostname === "api.openai.com";
  const branded =
    PROVIDER_SUPPLIER_PROFILES.some(
      (profile) => profile.key === supplier.supplierKey,
    ) &&
    supplier.supplierKey !== "rest" &&
    (supplier.supplierKey !== "openai" ||
      (officialOpenAiAddress(connectionAddress) &&
        officialOpenAiAddress(supplierAddress)));
  return supplierAddress ? connectionAddress === supplierAddress : branded;
}

export function findSupplierGroupConnection(
  connections: readonly ProviderConnectionView[],
  groupId: string,
  usage: "canvas" | "agent" | "disabled",
): ProviderConnectionView | undefined {
  return connections.find(
    (connection) =>
      (providerConnectionGroup(connection) === groupId || connection.config.accountKeyGroup === groupId) &&
      providerConnectionUsage(connection) === usage,
  );
}

export function manualModelsForConnection(
  connection?: ProviderConnectionView,
): ManualSupplierModel[] {
  const values = connection?.config.manualModels;
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is ManualSupplierModel =>
    Boolean(
      value &&
      typeof value === "object" &&
      typeof value.id === "string" &&
      typeof value.protocol === "string" &&
      ["image", "video", "chat"].includes(value.capability),
    ),
  );
}

export function manualModelProtocols(
  provider: string,
  usage: "canvas" | "agent" | "disabled",
  config?: Record<string, unknown>,
  capability?: "image" | "video" | "chat",
): SupplierModelProtocol[] {
  const capabilities = manualModelCapabilities(provider, usage, config);
  if (capability && !capabilities.includes(capability)) return [];
  const protocols: SupplierModelProtocol[] = [];
  if (!capability || capability !== "chat") {
    if (provider === "weai" && capabilities.includes("image")) protocols.push(
      String(config?.protocol ?? "").startsWith("gemini") || config?.modelGroup === "gemini香蕉"
        ? "gemini" : "openai-images",
    );
    if (provider === "openai" && capabilities.includes("image")) protocols.push("openai-images");
    if (provider === "rest" && capabilities.some(value => value !== "chat")) protocols.push("rest");
  }
  if ((!capability || capability === "chat") && capabilities.includes("chat")) protocols.push(
    "chat-completions", "responses", "anthropic-messages", "google-generate-content",
    "xai-responses", "generic-openai-compatible",
  );
  return protocols;
}

export function manualModelCapabilities(
  provider: string,
  usage: "canvas" | "agent" | "disabled",
  config?: Record<string, unknown>,
): Array<"image" | "video" | "chat"> {
  if (usage === "disabled") return [];
  if (provider === "openai" || provider === "weai") return ["image", "chat"];
  if (provider !== "rest") return [];
  const connector = config?.connector as
    { models?: ModelDescriptor[] } | undefined;
  const models = Array.isArray(connector?.models) ? connector.models : [];
  return [...(["image", "video"] as const).filter((capability) =>
    models.some((model) =>
      model.operations?.includes(
        capability === "image" ? "image.generate" : "video.generate",
      ),
    ),
  ), "chat"];
}

export function cleanSupplierAddress(input: string): string {
  const text = input.trim();
  if (!text) return "";
  const url = new URL(/^https?:\/\//iu.test(text) ? text : `https://${text}`);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("请填写不含账户密码的 HTTP 或 HTTPS 地址。");
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/u, "");
}

export function fetchSupplierImpact(id: string): Promise<{
  revision: number;
  groups: number;
  keys: number;
  canvasReferences: number;
  unfinishedRuns: number;
}> {
  return supplierRequest(`/api/suppliers/${encodeURIComponent(id)}`);
}
export function deleteSupplier(
  id: string,
  expectedRevision: number,
): Promise<SupplierRecord> {
  return supplierRequest(`/api/suppliers/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision }),
  });
}
export function restoreSupplierSource(
  id: string,
  sourceId: string,
  expectedRevision: number,
): Promise<SupplierRecord> {
  return supplierRequest(`/api/suppliers/${encodeURIComponent(id)}/history`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceId, expectedRevision }),
  });
}

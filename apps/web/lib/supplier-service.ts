import { matchesSupplierTemplate } from "./supplier-template-source";
import { createHash, randomUUID } from "node:crypto";
import {
  SupplierConflictError,
  referencesConnections,
  runUsesConnections,
  type SupplierSourceArchive,
  type SupplierState,
  type ProviderConnectionRecord,
  type SupplierRecord,
} from "@super-canvas/db";
import {
  discoverSupplierCatalog,
  normalizeSupplierUrl,
  normalizeSupplierSiteBase,
  supplierDirectoryBase,
  PROVIDER_SUPPLIER_PROFILES,
  encryptSecret,
  decryptSecret,
  loginSupplierSite,
  SupplierLoginError,
} from "@super-canvas/providers";
import { z } from "zod";
import { repository } from "./server";
import { supplierKeyForConnection } from "./supplier-identity";
import { requireServerMasterKey } from "./master-key";
import { isScannedSupplierGroup } from "./supplier-group-source";

const url = z
  .string()
  .trim()
  .max(2048)
  .transform((value, context) => {
    try {
      return normalizeSupplierUrl(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "请填写不含凭据、查询参数的 HTTP(S) 地址",
      });
      return z.NEVER;
    }
  });
export const SupplierModelSchema = z
  .object({
    id: z.string().trim().min(1).max(256),
    name: z.string().trim().max(256).optional(),
    capability: z.enum(["image", "video", "chat", "other"]),
    protocol: z
      .enum([
        "openai-images",
        "openai-videos",
        "chat-completions",
        "responses",
        "gemini",
        "rest",
        "unknown",
      ])
      .optional(),
    priceLabel: z.string().trim().max(256).optional(),
  })
  .strict();
const SupplierGroupSchema = z
  .object({
    id: z.string().trim().min(1).max(256),
    label: z.string().trim().min(1).max(256),
    source: z.enum(["manual", "catalog"]).optional(),
    models: z.array(SupplierModelSchema).max(3000),
    status: z.enum(["available", "missing"]).optional(),
  })
  .strict();
export const SupplierInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    siteUrl: url.optional(),
    apiUrl: url.optional(),
    kind: z.enum(["auto", "newapi", "sub2api", "openai-compatible"]).optional(),
    supplierKey: z.string().trim().min(1).max(128).optional(),
    catalog: z
      .object({ groups: z.array(SupplierGroupSchema).max(500) })
      .strict()
      .optional(),
  })
  .strict();
export const SupplierPatchSchema = SupplierInputSchema.partial().extend({
  expectedRevision: z.number().int().nonnegative().optional(),
  visibility: z.enum(["visible", "hidden"]).optional(),
  siteLogin: z
    .object({
      username: z.string().trim().min(1).max(256),
      password: z.string().min(1).max(4096),
    })
    .strict()
    .nullable()
    .optional(),
});
export const SupplierScanSchema = z
  .object({
    token: z.string().trim().min(1).max(32768).optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();

export class SupplierServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Strip server-only credentials from every supplier response. */
export function publicSupplierRecord(supplier: SupplierRecord) {
  const { siteLogin, ...state } = supplier.state ?? {};
  return {
    ...supplier,
    ...(supplier.state ? { state } : {}),
    ...(siteLogin
      ? { siteLogin: { username: siteLogin.username, configured: true } }
      : {}),
  };
}
const builtins = new Map(
  PROVIDER_SUPPLIER_PROFILES.map((profile) => [profile.key, profile]),
);
/** Prevent a slower scan from replacing a newer scan in this desktop server. */

const string = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const safeUrl = (value: unknown) => {
  try {
    return normalizeSupplierUrl(string(value));
  } catch {
    return "";
  }
};
const isBrandedSupplier = (namespace: string, address: string) =>
  builtins.has(namespace) &&
  namespace !== "rest" &&
  (namespace !== "openai" ||
    !address ||
    new URL(address).hostname === "api.openai.com");
export function legacySupplierId(
  connection: Pick<ProviderConnectionRecord, "provider" | "config">,
): string {
  const namespace = supplierKeyForConnection(connection);
  const address = normalizeSupplierSiteBase(safeUrl(connection.config.baseUrl));
  const branded = isBrandedSupplier(namespace, address);
  const identity = `${namespace}|${address}`;
  return `supplier-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function oldBrandedId(c: ProviderConnectionRecord) {
  return `supplier-${createHash("sha256").update(supplierKeyForConnection(c)).digest("hex").slice(0, 24)}`;
}
function legacySupplier(connection: ProviderConnectionRecord): SupplierRecord {
  const supplierKey = supplierKeyForConnection(connection);
  const profile = builtins.get(supplierKey);
  const apiUrl = safeUrl(connection.config.baseUrl);
  return {
    id: string(connection.config.supplierId) || legacySupplierId(connection),
    supplierKey,
    name: profile?.label ?? supplierKey,
    apiUrl,
    siteUrl:
      safeUrl(connection.config.supplierWebsiteUrl) ||
      (matchesSupplierTemplate(connection)
        ? safeUrl(profile?.websiteUrl)
        : "") ||
      normalizeSupplierSiteBase(apiUrl),
    kind: "auto",
    catalog: { groups: [] },
    scanStatus: "unscanned",
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

/** Derive old suppliers without writing on a page load. Saved connection IDs stay intact. */
export async function listSupplierRecords(): Promise<SupplierRecord[]> {
  const [stored, connections] = await Promise.all([
    repository.listSuppliers(),
    repository.listConnections(),
  ]);
  // Existing persisted suppliers migrate once. Derived legacy entries remain read-only until saved.
  const normalized: SupplierRecord[] = [];
  for (const record of stored) {
    if (record.state) {
      normalized.push(record);
      continue;
    }
    const owned = connections.filter((c) => owns(record, c));
    const migrated = initialize(record, owned);
    try {
      normalized.push(
        await repository.commitSupplier({
          supplier: {
            ...migrated.supplier,
            state: { ...migrated.supplier.state!, revision: 1 },
          },
          expectedRevision: 0,
          expectedConnections: owned,
          connections: migrated.connections,
        }),
      );
    } catch (e) {
      if (!(e instanceof SupplierConflictError)) throw e;
      normalized.push((await repository.getSupplier(record.id)) ?? record);
    }
  }
  const byId = new Map(normalized.map((supplier) => [supplier.id, supplier]));
  for (const connection of connections) {
    const supplier = legacySupplier(connection);
    if (!connection.config.supplierId && byId.has(oldBrandedId(connection)))
      continue;
    if (!byId.has(supplier.id)) byId.set(supplier.id, supplier);
  }
  return [...byId.values()];
}
export async function getSupplierRecord(
  id: string,
): Promise<SupplierRecord | null> {
  return (
    (await listSupplierRecords()).find((supplier) => supplier.id === id) ?? null
  );
}

export function mergeSupplierCatalog(
  current: SupplierRecord["catalog"],
  incoming: SupplierRecord["catalog"],
  scanning = false,
): SupplierRecord["catalog"] {
  const groups = new Map<string, SupplierRecord["catalog"]["groups"][number]>();
  for (const group of current.groups)
    groups.set(
      group.id,
      scanning && group.source !== "manual"
        ? { ...group, status: "missing" }
        : group,
    );
  for (const group of incoming.groups) {
    // Returned public entries are display data; PATCH cannot rewrite them as trusted scans.
    if (!scanning && group.source === "catalog") continue;
    groups.set(group.id, {
      ...group,
      source: scanning ? "catalog" : "manual",
      status: "available",
    });
  }
  return { groups: [...groups.values()] };
}

const owns = (s: SupplierRecord, c: ProviderConnectionRecord) =>
  c.config.supplierId === s.id ||
  (!c.config.supplierId &&
    (legacySupplierId(c) === s.id || oldBrandedId(c) === s.id));
const addresses = (s: Pick<SupplierRecord, "siteUrl" | "apiUrl">) => ({
  siteUrl: supplierDirectoryBase(s.siteUrl || s.apiUrl),
  apiUrl:
    /\/(?:dashboard|model-plaza|model-market|marketplace|pricing|models)\/?$/iu.test(
      s.apiUrl || s.siteUrl,
    )
      ? supplierDirectoryBase(s.apiUrl || s.siteUrl)
      : normalizeSupplierUrl(s.apiUrl || supplierDirectoryBase(s.siteUrl)),
});
const fingerprint = (s: Pick<SupplierRecord, "siteUrl" | "apiUrl">) => {
  const a = addresses(s);
  return createHash("sha256")
    .update(`${a.siteUrl}|${normalizeSupplierSiteBase(a.apiUrl)}`)
    .digest("hex");
};
const currentConnections = (
  s: SupplierRecord,
  cs: ProviderConnectionRecord[],
) =>
  cs.filter(
    (c) =>
      c.config.supplierArchived !== true &&
      c.config.supplierSourceId === s.state?.sourceId,
  );
function connectionSummary(c: ProviderConnectionRecord) {
  const scanned = Array.isArray(c.config.scannedModelIds)
    ? c.config.scannedModelIds.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
  const manual = Array.isArray(c.config.manualModels)
    ? c.config.manualModels.flatMap((m) =>
        m && typeof m === "object" && "id" in m && typeof m.id === "string"
          ? [m.id]
          : [],
      )
    : [];
  return {
    id: c.id,
    name: c.name,
    group: String(c.config.modelGroup || "默认群组"),
    modelIds: [...new Set([...scanned, ...manual])],
    usage: String(c.config.usage || "canvas"),
    keyConfigured: Boolean(c.encryptedSecret),
  };
}
function archive(
  s: SupplierRecord,
  cs: ProviderConnectionRecord[],
  reason: SupplierSourceArchive["reason"] = "address-change",
): SupplierSourceArchive {
  return {
    id: s.state!.sourceId,
    siteUrl: s.siteUrl,
    apiUrl: s.apiUrl,
    kind: s.kind,
    catalog: s.catalog,
    connectionIds: currentConnections(s, cs).map((c) => c.id),
    connections: currentConnections(s, cs).map(connectionSummary),
    archivedAt: new Date().toISOString(),
    reason,
  };
}
function invalidateInventory(config: ProviderConnectionRecord["config"]) {
  const next = { ...config };
  for (const key of [
    "modelScanCheckedAt",
    "scannedModelIds",
    "modelScanGroups",
    "modelCatalogModels",
    "modelProtocolTemplate",
    "weAiLivePricing",
    "unavailableModels",
    "unknownModels",
    "catalogCheckedAt",
    "catalogSource",
    "modelScanRequestId",
  ])
    delete next[key];
  next.modelScanStatus = "unscanned";
  next.modelCatalogSource = "unverified";
  return next;
}
function initialize(
  s: SupplierRecord,
  cs: ProviderConnectionRecord[],
): { supplier: SupplierRecord; connections: ProviderConnectionRecord[] } {
  if (s.state) return { supplier: s, connections: cs };
  const sourceId = randomUUID();
  const normalized = addresses(s);
  const state: SupplierState = {
    version: 1,
    revision: 0,
    visibility: "visible",
    sourceId,
    fingerprint: fingerprint(s),
    history: [],
  };
  if (s.catalog.groups.length)
    state.history.push({
      id: randomUUID(),
      ...normalized,
      kind: s.kind,
      catalog: s.catalog,
      connectionIds: [],
      archivedAt: new Date().toISOString(),
      reason: "legacy-unverified",
    });
  const historic = new Map<string, SupplierSourceArchive>();
  const connections = cs.map((c) => {
    const apiUrl = safeUrl(c.config.baseUrl);
    if (
      normalizeSupplierSiteBase(apiUrl) ===
      normalizeSupplierSiteBase(normalized.apiUrl)
    )
      return {
        ...c,
        config: { ...c.config, supplierId: s.id, supplierSourceId: sourceId },
      };
    let h = historic.get(apiUrl);
    if (!h) {
      h = {
        id: randomUUID(),
        siteUrl: supplierDirectoryBase(apiUrl),
        apiUrl,
        kind: s.kind,
        catalog: { groups: [] },
        connectionIds: [],
        archivedAt: new Date().toISOString(),
        reason: "legacy-unverified",
      };
      historic.set(apiUrl, h);
    }
    h.connectionIds.push(c.id);
    h.connections = [...(h.connections ?? []), connectionSummary(c)];
    return {
      ...c,
      config: {
        ...c.config,
        supplierId: s.id,
        supplierSourceId: h.id,
        supplierArchived: true,
      },
    };
  });
  state.history.push(...historic.values());
  return {
    supplier: {
      ...s,
      ...normalized,
      state,
      catalog: { groups: [] },
      scanStatus: "unscanned",
      scanError: undefined,
      scannedAt: undefined,
    },
    connections,
  };
}
async function context(id: string, expectedRevision?: number) {
  const original = await getSupplierRecord(id);
  if (!original || original.state?.visibility === "deleted")
    throw new SupplierServiceError("供应商不存在或已删除", 404);
  if (
    expectedRevision !== undefined &&
    expectedRevision !== (original.state?.revision ?? 0)
  )
    throw new SupplierConflictError();
  const expectedConnections = (await repository.listConnections()).filter((c) =>
    owns(original, c),
  );
  return {
    ...initialize(original, expectedConnections),
    expectedConnections,
    expectedRevision: original.state?.revision ?? 0,
  };
}
async function commit(
  ctx: Awaited<ReturnType<typeof context>>,
  supplier: SupplierRecord,
  connections = ctx.connections,
  deleteConnectionIds?: string[],
) {
  return repository.commitSupplier({
    supplier: {
      ...supplier,
      state: { ...supplier.state!, revision: ctx.expectedRevision + 1 },
    },
    expectedRevision: ctx.expectedRevision,
    expectedConnections: ctx.expectedConnections,
    connections,
    deleteConnectionIds,
  });
}
export async function createSupplierRecord(
  input: z.infer<typeof SupplierInputSchema>,
): Promise<SupplierRecord> {
  const id = randomUUID();
  const a = addresses({
    siteUrl: input.siteUrl ?? "",
    apiUrl: input.apiUrl ?? "",
  });
  return repository.commitSupplier({
    expectedRevision: 0,
    expectedConnections: [],
    connections: [],
    supplier: {
      id,
      name: input.name,
      supplierKey: input.supplierKey || `custom-${id}`,
      ...a,
      kind: input.kind ?? "auto",
      catalog: mergeSupplierCatalog(
        { groups: [] },
        input.catalog ?? { groups: [] },
      ),
      scanStatus: "unscanned",
      state: {
        version: 1,
        revision: 1,
        visibility: "visible",
        sourceId: randomUUID(),
        fingerprint: fingerprint(a),
        history: [],
      },
    },
  });
}
export async function patchSupplierRecord(
  id: string,
  input: z.infer<typeof SupplierPatchSchema>,
): Promise<SupplierRecord> {
  const ctx = await context(id, input.expectedRevision);
  const s = ctx.supplier;
  if (input.supplierKey && input.supplierKey !== s.supplierKey)
    throw new SupplierServiceError(
      "供应商命名空间不能修改，请新增独立供应商",
      409,
    );
  const { catalog, expectedRevision, visibility, siteLogin, ...patch } = input;
  const next = {
    ...s,
    ...patch,
    ...addresses({
      siteUrl: input.siteUrl ?? s.siteUrl,
      apiUrl: input.apiUrl ?? s.apiUrl,
    }),
    state: {
      ...s.state!,
      visibility: visibility ?? s.state!.visibility,
      scanId: undefined,
    },
  };
  const changed = fingerprint(next) !== s.state!.fingerprint;
  let connections = ctx.connections;
  if (changed) {
    delete next.state.siteLogin;
    next.state.history = [...s.state!.history, archive(s, connections)];
    connections = connections.map((c) => ({
      ...c,
      config: { ...c.config, supplierArchived: true },
    }));
    next.state.sourceId = randomUUID();
    next.state.fingerprint = fingerprint(next);
    next.catalog = { groups: [] };
  } else if (input.kind && input.kind !== s.kind) {
    next.catalog = {
      groups: s.catalog.groups.filter((g) => g.source === "manual"),
    };
    connections = connections.map((c) =>
      c.config.supplierArchived === true
        ? c
        : { ...c, config: invalidateInventory(c.config) },
    );
  }
  if (siteLogin === null) delete next.state.siteLogin;
  else if (siteLogin) {
    if (!next.siteUrl)
      throw new SupplierServiceError("保存登录信息前请填写站点地址");
    next.state.siteLogin = {
      username: siteLogin.username,
      encryptedPassword: encryptSecret(
        siteLogin.password,
        requireServerMasterKey(),
      ),
      siteUrl: supplierDirectoryBase(next.siteUrl),
    };
  }
  if (
    changed ||
    siteLogin !== undefined ||
    (input.kind && input.kind !== s.kind)
  ) {
    next.scanStatus = "unscanned";
    next.scannedAt = undefined;
    next.scanError = undefined;
  }
  if (catalog) next.catalog = mergeSupplierCatalog(next.catalog, catalog);
  return commit(ctx, next, connections);
}

/** Called before any credentials leave the server, including legacy records. */
export async function assertCurrentSupplierConnection(
  connection: ProviderConnectionRecord,
): Promise<void> {
  if (connection.config.supplierArchived === true)
    throw new SupplierServiceError(
      "此连接已归档，请恢复历史配置或重新选择当前供应商连接",
      409,
    );
  if (!connection.config.supplierId) return;
  const s = await getSupplierRecord(String(connection.config.supplierId));
  if (!s || s.state?.visibility === "deleted")
    throw new SupplierServiceError("供应商已删除，请重新选择连接", 409);
  if (
    (s.state && connection.config.supplierSourceId !== s.state.sourceId) ||
    normalizeSupplierSiteBase(safeUrl(connection.config.baseUrl)) !==
      normalizeSupplierSiteBase(addresses(s).apiUrl)
  )
    throw new SupplierServiceError(
      "连接属于旧地址，请在历史配置中恢复或重新选择连接",
      409,
    );
}
export async function supplierConfigForConnection(input: {
  provider: string;
  config: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (!input.config.supplierId) return input.config;
  const ctx = await context(string(input.config.supplierId));
  let s = ctx.supplier;
  if (s.supplierKey !== supplierKeyForConnection(input))
    throw new SupplierServiceError("分组不能关联到其他供应商的命名空间", 409);
  if (
    !(await repository.getSupplier(s.id)) ||
    !(await repository.getSupplier(s.id))?.state
  )
    s = await commit(ctx, s);
  if (
    (input.config.supplierSourceId &&
      input.config.supplierSourceId !== s.state!.sourceId) ||
    input.config.supplierArchived === true
  )
    throw new SupplierServiceError("此分组已归档，请重新选择当前分组", 409);
  if (
    input.config.baseUrl &&
    normalizeSupplierSiteBase(safeUrl(input.config.baseUrl)) !==
      normalizeSupplierSiteBase(s.apiUrl)
  )
    throw new SupplierServiceError(
      "请先在供应商连接地址中修改 API 地址，旧配置将自动归档",
      409,
    );
  return {
    ...input.config,
    baseUrl: s.apiUrl,
    supplierId: s.id,
    supplierSourceId: s.state!.sourceId,
  };
}

export async function scanSupplierRecord(
  id: string,
  token?: string,
  expectedRevision?: number,
): Promise<SupplierRecord> {
  const ctx = await context(id, expectedRevision);
  if (token && !ctx.supplier.siteUrl)
    throw new SupplierServiceError("使用临时站点令牌时请明确填写站点地址");
  const scanId = randomUUID();
  const supplier = await commit(ctx, {
    ...ctx.supplier,
    state: { ...ctx.supplier.state!, scanId },
  });
  const initialConnections = currentConnections(
    supplier,
    (await repository.listConnections()).filter((c) => owns(supplier, c)),
  );
  let result: Awaited<ReturnType<typeof discoverSupplierCatalog>>;
  try {
    const savedLogin = supplier.state?.siteLogin;
    const session =
      savedLogin &&
      savedLogin.siteUrl === supplierDirectoryBase(supplier.siteUrl)
        ? await loginSupplierSite({
            siteUrl: supplier.siteUrl,
            kind: supplier.kind,
            credentials: {
              username: savedLogin.username,
              password: decryptSecret(
                savedLogin.encryptedPassword,
                requireServerMasterKey(),
              ),
            },
          })
        : undefined;
    result = await discoverSupplierCatalog(
      {
        siteUrl: supplier.siteUrl,
        apiUrl: supplier.apiUrl,
        kind: session?.kind ?? supplier.kind,
        ...(session ? {} : { token }),
      },
      session?.fetch,
    );
  } catch (error) {
    result = {
      groups: [],
      kind: supplier.kind,
      checkedAt: new Date().toISOString(),
      status:
        error instanceof SupplierLoginError && error.status !== 502
          ? "unauthorized"
          : "failed",
      error:
        error instanceof SupplierLoginError
          ? error.message
          : "保存的站点登录信息无法使用，请重新填写账号密码",
    };
  }
  const isCurrent = async () => {
    const now = await getSupplierRecord(id);
    return (
      now?.state?.scanId === scanId &&
      now.state.sourceId === supplier.state!.sourceId &&
      now.state.revision === supplier.state!.revision
    );
  };
  if (!(await isCurrent())) return (await getSupplierRecord(id))!;
  let connectionFailure = false;
  for (const connection of initialConnections) {
    if (
      !connection.encryptedSecret ||
      !(await isCurrent()) ||
      JSON.stringify(await repository.getConnection(connection.id)) !==
        JSON.stringify(connection)
    )
      continue;
    try {
      const { GET } = await import("../app/api/providers/[id]/models/route");
      const response = await GET(
        new Request(
          `http://localhost/api/providers/${encodeURIComponent(connection.id)}/models?refresh=1`,
        ),
        { params: Promise.resolve({ id: connection.id }) },
      );
      if (
        !response.ok ||
        response.headers.get("X-Model-Scan-Status") === "stale"
      )
        connectionFailure = true;
    } catch {
      connectionFailure = true;
    }
  }
  if (!(await isCurrent())) return (await getSupplierRecord(id))!;
  const latest = await context(id, supplier.state!.revision);
  const failed = result.status === "failed" || result.status === "unauthorized";
  const next = {
    ...latest.supplier,
    catalog: failed
      ? latest.supplier.catalog
      : mergeSupplierCatalog(
          latest.supplier.catalog,
          { groups: result.groups },
          true,
        ),
    scanStatus: result.status,
    scannedAt: result.checkedAt,
    scanError: failed
      ? `${latest.supplier.catalog.groups.length ? "历史缓存，本次刷新失败：" : "当前地址扫描失败："}${result.error ?? "目录不可用"}`
      : connectionFailure
        ? "目录已更新；部分分组 Key 刷新失败，请查看分组状态"
        : undefined,
  };
  // Missing entries stay solely in the collapsed history, never the current count.
  try {
    return await commit(latest, next);
  } catch (error) {
    if (error instanceof SupplierConflictError)
      return (await getSupplierRecord(id))!;
    throw error;
  }
}

export async function supplierImpact(id: string) {
  const ctx = await context(id);
  const ids = new Set(ctx.connections.map((c) => c.id));
  const [canvases, runs] = await Promise.all([
    repository.listCanvases(),
    repository.listRuns(),
  ]);
  const groups = new Set(
    ctx.connections.map(
      (c) =>
        `${c.config.supplierSourceId}:${c.config.modelGroup || "默认群组"}`,
    ),
  );
  for (const g of ctx.supplier.catalog.groups)
    groups.add(`${ctx.supplier.state!.sourceId}:${g.id}`);
  for (const h of ctx.supplier.state!.history)
    for (const g of h.catalog.groups) groups.add(`${h.id}:${g.id}`);
  return {
    revision: ctx.expectedRevision,
    groups: groups.size,
    keys: ctx.connections.filter((c) => c.encryptedSecret).length,
    canvasReferences: canvases.reduce(
      (n, c) =>
        n +
        (Array.isArray(c.graph.nodes)
          ? c.graph.nodes.filter((node) => referencesConnections(node, ids))
              .length
          : 0),
      0,
    ),
    unfinishedRuns: runs.filter(
      (r) =>
        ["queued", "running", "needs_attention"].includes(r.status) &&
        runUsesConnections(r, ids),
    ).length,
  };
}
export async function deleteSupplierRecord(
  id: string,
  expectedRevision: number,
) {
  const ctx = await context(id, expectedRevision);
  const s = ctx.supplier;
  return commit(
    ctx,
    {
      ...s,
      name: "已删除供应商",
      siteUrl: "",
      apiUrl: "",
      catalog: { groups: [] },
      scanStatus: "unscanned",
      scannedAt: undefined,
      scanError: undefined,
      state: {
        ...s.state!,
        visibility: "deleted",
        sourceId: randomUUID(),
        fingerprint: "",
        history: [],
        scanId: undefined,
        siteLogin: undefined,
      },
    },
    [],
    ctx.connections.map((c) => c.id),
  );
}
export async function deleteManualSupplierGroup(
  id: string,
  groupId: string,
  expectedRevision: number,
) {
  const ctx = await context(id, expectedRevision);
  const supplier = ctx.supplier;
  const group = supplier.catalog.groups.find((item) => item.id === groupId);
  const members = currentConnections(supplier, ctx.connections).filter(
    (connection) =>
      String(connection.config.modelGroup || "默认群组") === groupId,
  );
  const manual =
    !isScannedSupplierGroup(group) && Boolean(group || members.length);
  if (!manual) throw new SupplierServiceError("只能删除手动添加的分组", 400);
  const deleted = new Set(members.map((connection) => connection.id));
  return commit(
    ctx,
    {
      ...supplier,
      catalog: {
        groups: supplier.catalog.groups.filter((item) => item.id !== groupId),
      },
      state: { ...supplier.state!, scanId: undefined },
    },
    ctx.connections.filter((connection) => !deleted.has(connection.id)),
    [...deleted],
  );
}
export async function restoreSupplierHistory(
  id: string,
  sourceId: string,
  expectedRevision: number,
) {
  const ctx = await context(id, expectedRevision);
  const s = ctx.supplier;
  const h = s.state!.history.find((h) => h.id === sourceId);
  if (!h) throw new SupplierServiceError("历史配置不存在", 404);
  const next = {
    ...s,
    siteUrl: h.siteUrl,
    apiUrl: h.apiUrl,
    kind: h.kind,
    catalog: h.catalog,
    scanStatus: "unscanned" as const,
    scannedAt: undefined,
    scanError: undefined,
    state: {
      ...s.state!,
      sourceId: h.id,
      siteLogin: undefined,
      fingerprint: fingerprint(h),
      scanId: undefined,
      history: [
        ...s.state!.history.filter((h) => h.id !== sourceId),
        archive(s, ctx.connections, "restored"),
      ],
    },
  };
  const connections = ctx.connections.map((c) => ({
    ...c,
    config: {
      ...c.config,
      supplierArchived: !h.connectionIds.includes(c.id),
      ...(h.connectionIds.includes(c.id) ? { supplierSourceId: h.id } : {}),
    },
  }));
  return commit(ctx, next, connections);
}

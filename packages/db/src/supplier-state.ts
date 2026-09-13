import { isDeepStrictEqual } from "node:util";
import {
  SupplierConflictError,
  type ConnectionSaveOptions,
  type ProviderConnectionRecord,
  type SupplierCommit,
  type SupplierRecord,
  type WorkflowRunRecord,
} from "./types.js";
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export function referencesConnections(
  value: unknown,
  ids: ReadonlySet<string>,
): boolean {
  if (Array.isArray(value))
    return value.some((v) => referencesConnections(v, ids));
  const o = object(value);
  if (
    (typeof o.connectionId === "string" && ids.has(o.connectionId)) ||
    (typeof o.id === "string" && ids.has(o.id) && "encryptedSecret" in o)
  )
    return true;
  return Object.values(o).some(
    (v) => v && typeof v === "object" && referencesConnections(v, ids),
  );
}
export function runUsesConnections(
  run: Pick<
    WorkflowRunRecord,
    "scope" | "nodeId" | "nodeIds" | "revisionGraph"
  >,
  ids: ReadonlySet<string>,
): boolean {
  return runNodes(run).some((n) => referencesConnections(n, ids));
}
/** Preserve public history while erasing credential-bearing execution snapshots. */
export function scrubConnectionSecrets(
  value: unknown,
  ids: ReadonlySet<string>,
  inherited = false,
): unknown {
  if (Array.isArray(value))
    return value.map((v) => scrubConnectionSecrets(v, ids, inherited));
  if (!value || typeof value !== "object") return value;
  const o = object(value);
  const matched =
    inherited ||
    ids.has(String(o.connectionId ?? "")) ||
    ids.has(String(o.id ?? ""));
  return Object.fromEntries(
    Object.entries(o).map(([k, v]) => [
      k,
      matched &&
      ["encryptedSecret", "apiKey", "authorization", "x-api-key"].includes(k)
        ? null
        : scrubConnectionSecrets(v, ids, matched),
    ]),
  );
}
export function assertSupplierCommit(
  input: SupplierCommit,
  current: SupplierRecord | null,
  connections: ProviderConnectionRecord[],
  runs: WorkflowRunRecord[],
): void {
  if ((current?.state?.revision ?? 0) !== input.expectedRevision)
    throw new SupplierConflictError();
  const expected = new Map(input.expectedConnections.map((c) => [c.id, c]));
  const owned = connections.filter(
    (c) => c.config.supplierId === input.supplier.id || expected.has(c.id),
  );
  if (
    owned.length !== expected.size ||
    owned.some((c) => !isDeepStrictEqual(c, expected.get(c.id)))
  )
    throw new SupplierConflictError("分组配置已改变，请刷新后重试");
  const deleted = new Set(input.deleteConnectionIds ?? []);
  if (
    runs.some(
      (r) =>
        ["queued", "running", "needs_attention"].includes(r.status) &&
        runUsesConnections(r, deleted),
    )
  )
    throw new SupplierConflictError(
      "供应商仍有未完成运行，请先完成或取消相关运行",
    );
}
export function assertConnectionSave(
  input: Omit<ProviderConnectionRecord, "createdAt" | "updatedAt">,
  previous: ProviderConnectionRecord | null,
  supplier: SupplierRecord | null,
  options: ConnectionSaveOptions = {},
): void {
  if (options.expected && !isDeepStrictEqual(previous, options.expected))
    throw new SupplierConflictError("模型扫描或分组配置已改变，请重新读取");
  if (
    previous?.config.supplierArchived === true ||
    input.config.supplierArchived === true
  )
    throw new SupplierConflictError("此连接已归档，请在供应商历史配置中恢复");
  if (
    supplier?.state &&
    (supplier.state.visibility === "deleted" ||
      input.config.supplierSourceId !== supplier.state.sourceId)
  )
    throw new SupplierConflictError("供应商来源已改变，请重新选择当前分组");
  if (
    previous?.config.supplierSourceId &&
    input.config.supplierSourceId !== previous.config.supplierSourceId
  )
    throw new SupplierConflictError();
}

function runNodes(
  run: Pick<
    WorkflowRunRecord,
    "scope" | "nodeId" | "nodeIds" | "revisionGraph"
  >,
): unknown[] {
  const nodes = Array.isArray(run.revisionGraph.nodes)
    ? run.revisionGraph.nodes
    : [];
  if (run.scope === "all") return nodes;
  const selected = new Set(
    run.scope === "selection" ? (run.nodeIds ?? []) : [run.nodeId ?? ""],
  );
  if (run.scope === "downstream") {
    const edges = Array.isArray(run.revisionGraph.edges)
      ? run.revisionGraph.edges
      : [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of edges) {
        const edge = object(e);
        if (
          selected.has(String(edge.source)) &&
          !selected.has(String(edge.target))
        ) {
          selected.add(String(edge.target));
          changed = true;
        }
      }
    }
  }
  return nodes.filter((n) => selected.has(String(object(n).id)));
}
/** Checked in the same transaction as creation so deletion and confirmed execution cannot race. */
export function assertRunConnections(
  run: Pick<
    WorkflowRunRecord,
    "scope" | "nodeId" | "nodeIds" | "revisionGraph"
  >,
  connections: ProviderConnectionRecord[],
  suppliers: SupplierRecord[],
): void {
  const byId = new Map(connections.map((c) => [c.id, c]));
  for (const n of runNodes(run)) {
    const data = object(object(n).data);
    const frozen = object(data.__runtimeConnection);
    const id = String(data.connectionId ?? frozen.id ?? "");
    if (!id || id === "fake-default") continue;
    const c = byId.get(id);
    if (!c)
      throw new SupplierConflictError("连接已删除，请为画布节点重新选择连接");
    const parent = suppliers.find((s) => s.id === c.config.supplierId);
    if (
      c.config.supplierArchived === true ||
      parent?.state?.visibility === "deleted" ||
      (parent?.state && parent.state.sourceId !== c.config.supplierSourceId)
    )
      throw new SupplierConflictError(
        "连接已归档或来源已改变，请重新选择当前供应商分组",
      );
    if (["empty", "unauthorized"].includes(String(c.config.modelScanStatus)))
      throw new SupplierConflictError(
        "此连接返回空模型列表或鉴权失败，请刷新或重新配置 Key",
      );
    if (
      Array.isArray(c.config.scannedModelIds) &&
      data.model &&
      !c.config.scannedModelIds.includes(data.model)
    )
      throw new SupplierConflictError(
        "当前 Key 扫描未返回此模型，请重新选择可用模型",
      );
    if (
      Object.keys(frozen).length &&
      ((frozen.encryptedSecret ?? null) !== (c.encryptedSecret ?? null) ||
        !isDeepStrictEqual(frozen.config, c.config))
    )
      throw new SupplierConflictError(
        "连接配置已改变，执行预检已失效，请重新检查并确认",
      );
  }
}

export function frozenCredentialIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    const o = object(v);
    if (typeof o.id === "string" && typeof o.encryptedSecret === "string")
      ids.add(o.id);
    Object.values(o).forEach((c) => {
      if (c && typeof c === "object") visit(c);
    });
  };
  visit(value);
  return ids;
}
export function assertSnapshotCredentials(
  value: unknown,
  connections: ProviderConnectionRecord[],
): void {
  const live = new Set(connections.map((c) => c.id));
  for (const id of frozenCredentialIds(value))
    if (!live.has(id))
      throw new SupplierConflictError("供应商已删除，旧执行快照不能再次保存");
}

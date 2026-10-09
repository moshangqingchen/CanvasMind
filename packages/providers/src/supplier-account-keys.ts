import { fetchProviderJson, ProviderHttpError } from "./http.js";
import type { FetchImplementation } from "./contracts.js";
import { supplierDirectoryBase } from "./supplier-catalog.js";

/** Server-only values. Never include these entries in a browser response or log. */
export interface SupplierAccountKey {
  id: string;
  group: string;
  /** The site's numeric group identity, independent of its editable name. */
  supplierGroupId?: string;
  apiKey: string;
  name: string;
}
export interface SupplierAccountKeys {
  keys: SupplierAccountKey[];
  skipped: number;
  complete: boolean;
  checkedAt: string;
  error?: string;
}
const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const supplierGroupId = (value: unknown): string | undefined => {
  const number = typeof value === "number" ? value : /^\d+$/u.test(text(value)) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? String(number) : undefined;
};
const fullKey = (value: unknown) => {
  const key = text(value);
  return key.length >= 16 && key.length <= 4096 && !/[\s*…]/u.test(key) && !key.includes("...") ? key : "";
};
function payloadData(value: unknown): unknown {
  const root = object(value);
  if (!root || root.success === false ||
    (typeof root.code === "number" && ![0, 200].includes(root.code))) throw new Error("Invalid key response");
  return root.data ?? value;
}
function active(row: Record<string, unknown>, kind: "newapi" | "sub2api", now: number) {
  if (row.deleted_at || (kind === "sub2api" ? row.status !== "active" : row.status !== 1)) return false;
  if (kind === "newapi") {
    if (typeof row.expired_time === "number" && row.expired_time > 0 && row.expired_time * 1000 <= now) return false;
    if (row.unlimited_quota === false && typeof row.remain_quota === "number" && row.remain_quota <= 0) return false;
  } else {
    if (typeof row.expires_at === "string" && Date.parse(row.expires_at) <= now) return false;
    if (typeof row.quota === "number" && row.quota > 0 && Number(row.quota_used) >= row.quota) return false;
  }
  return true;
}

/** Read existing account keys, including pagination and NewAPI's read-only reveal endpoint. */
export async function readSupplierAccountKeys(
  input: { siteUrl: string; kind: "newapi" | "sub2api" },
  sessionFetch: FetchImplementation,
): Promise<SupplierAccountKeys> {
  const result: SupplierAccountKeys = { keys: [], skipped: 0, complete: false, checkedAt: new Date().toISOString() };
  const base = supplierDirectoryBase(input.siteUrl);
  const read = async (path: string, method = "GET") => payloadData(await fetchProviderJson(
    sessionFetch, `${base}${path}`, { method, cache: "no-store" },
    { phase: "connect", timeoutMs: 12000, maxResponseBytes: 4 * 1024 * 1024 },
  ));
  const seen = new Set<string>();
  let readCount = 0;
  try {
    const groupNames = new Map<string, string>();
    if (input.kind === "sub2api") {
      const groups = await read("/api/v1/groups/available").catch(() => []);
      for (const raw of Array.isArray(groups) ? groups : []) {
        const group = object(raw);
        const id = supplierGroupId(group?.id);
        if (group && id !== undefined && text(group.name)) groupNames.set(id, text(group.name));
      }
    }
    for (let page = 1; page <= 50; page++) {
      const data = await read(input.kind === "sub2api"
        ? `/api/v1/keys?page=${page}&page_size=100`
        : `/api/token/?p=${page}&page_size=100`);
      const envelope = object(data);
      const rows = Array.isArray(data) ? data : envelope?.items;
      if (!Array.isArray(rows)) throw new Error("Invalid key list");
      let added = 0;
      for (const raw of rows) {
        const row = object(raw);
        const id = String(row?.id ?? "");
        if (!row || !/^\d+$/u.test(id)) { result.skipped++; continue; }
        if (seen.has(id)) continue;
        seen.add(id); added++; readCount++;
        if (!active(row, input.kind, Date.now())) { result.skipped++; continue; }
        const embeddedGroup = object(row.group);
        const assignedGroupId = input.kind === "sub2api" ? supplierGroupId(row.group_id) : undefined;
        const embeddedGroupId = input.kind === "sub2api" ? supplierGroupId(embeddedGroup?.id) : undefined;
        // Conflicting identities cannot safely bind a Key to either group.
        if (assignedGroupId !== undefined && embeddedGroupId !== undefined && assignedGroupId !== embeddedGroupId) {
          result.skipped++; continue;
        }
        const officialGroupId = assignedGroupId ?? embeddedGroupId;
        const group = input.kind === "newapi" ? text(row.group)
          : (officialGroupId !== undefined ? groupNames.get(officialGroupId) : undefined) || text(embeddedGroup?.name) || "";
        if (!group || group.length > 256) { result.skipped++; continue; }
        let key = fullKey(row.key);
        if (!key) {
          try {
            const revealed = object(await read(input.kind === "sub2api" ? `/api/v1/keys/${id}` : `/api/token/${id}/key`, input.kind === "sub2api" ? "GET" : "POST"));
            key = fullKey(revealed?.key);
          } catch { /* A restricted key stays unimported; never copy a mask. */ }
        }
        if (!key) { result.skipped++; continue; }
        if (input.kind === "newapi" && !key.startsWith("sk-")) key = `sk-${key}`;
        result.keys.push({ id, group, ...(officialGroupId !== undefined ? { supplierGroupId: officialGroupId } : {}),
          apiKey: key, name: text(row.name).slice(0, 256) });
      }
      const total = typeof envelope?.total === "number" ? envelope.total : undefined;
      if (!rows.length || (total !== undefined ? readCount >= total : rows.length < 100)) {
        result.complete = true;
        return result;
      }
      if (!added) break;
    }
    result.error = "密钥列表未完整返回；已读取部分可以同步，请稍后重试。";
  } catch (error) {
    const status = error instanceof ProviderHttpError ? error.details.status : undefined;
    result.error = status === 401 || status === 403
      ? "站点不允许当前账号读取 API 密钥，可继续手动填写。"
      : "已有 API 密钥读取未完成，可稍后重新扫描；现有 Key 已保留。";
  }
  return result;
}

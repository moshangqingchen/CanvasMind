import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { CatalogInventoryState } from "./catalog-inventory-policy";

interface DescriptorArchive {
  schemaVersion: 1;
  codec: "deflate-raw-base64";
  sha256: string;
  originalBytes: number;
  descriptorCount: number;
  body: string;
}
type StoredInventory = CatalogInventoryState & { tk1688DescriptorArchive?: DescriptorArchive };
export const TK1688_ARCHIVE_LIMITS = { poolBytes: 32 * 1024 * 1024, expandedDescriptorBytes: 32 * 1024 * 1024,
  logicalStateBytes: 64 * 1024 * 1024, references: 20_000, sources: 32 } as const;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const invalid = (): never => { throw new Error("词元内部目录描述引用损坏，已停止投影"); };
function descriptorRows(value: CatalogInventoryState, bounded = true): ModelDescriptor[] {
  if (!Array.isArray(value.visibleModels) || !Array.isArray(value.historicalModels) || !value.sources ||
    bounded && Object.keys(value.sources).length > TK1688_ARCHIVE_LIMITS.sources) return invalid();
  const arrays = [value.visibleModels, value.historicalModels.map(row => row.descriptor)];
  for (const source of Object.values(value.sources)) {
    if (!Array.isArray(source.acceptedModels) || source.candidate && !Array.isArray(source.candidate.models)) return invalid();
    arrays.push(source.acceptedModels, source.candidate?.models ?? []);
  }
  if (bounded && arrays.reduce((sum, rows) => sum + rows.length, 0) > TK1688_ARCHIVE_LIMITS.references) return invalid();
  return arrays.flat();
}

/** Storage only: every parameter, price, refusal, historical descriptor and
 * provenance value is restored before the membership policy sees the state. */
export function hydrateCatalogTk1688Inventory(value: CatalogInventoryState | undefined): CatalogInventoryState | undefined {
  if (!value) return;
  const stored = value as StoredInventory, archive = stored.tk1688DescriptorArchive;
  if (!archive) {
    if (descriptorRows(value, false).some(row => row?.metadata?.catalogStoredDescriptor !== undefined)) return invalid();
    return value;
  }
  const rows = descriptorRows(value);
  if (archive.schemaVersion !== 1 || archive.codec !== "deflate-raw-base64" || !Number.isSafeInteger(archive.originalBytes) ||
    archive.originalBytes < 1 || archive.originalBytes > TK1688_ARCHIVE_LIMITS.poolBytes || !/^[a-f0-9]{64}$/u.test(archive.sha256) ||
    !Number.isSafeInteger(archive.descriptorCount) || archive.descriptorCount < 0 || archive.descriptorCount > TK1688_ARCHIVE_LIMITS.references ||
    typeof archive.body !== "string" || archive.body.length > TK1688_ARCHIVE_LIMITS.poolBytes ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(archive.body)) return invalid();
  let pool: Record<string, ModelDescriptor>;
  try {
    const bytes = inflateRawSync(Buffer.from(archive.body, "base64"), { maxOutputLength: archive.originalBytes });
    if (bytes.length !== archive.originalBytes || digest(bytes) !== archive.sha256) return invalid();
    pool = JSON.parse(bytes.toString("utf8"));
  } catch { return invalid(); }
  if (!pool || typeof pool !== "object" || Array.isArray(pool) || Object.keys(pool).length !== archive.descriptorCount) return invalid();
  const sizes = new Map<string, number>();
  for (const [ref, row] of Object.entries(pool)) {
    if (!row || typeof row.id !== "string" || typeof row.name !== "string" || !Array.isArray(row.operations)) return invalid();
    const json = JSON.stringify(row);
    if (digest(json) !== ref) return invalid();
    sizes.set(ref, Buffer.byteLength(json));
  }
  let expandedBytes = 0;
  for (const row of rows) {
    const ref = row?.metadata?.catalogStoredDescriptor;
    if (ref !== undefined && typeof ref !== "string") return invalid();
    if (typeof ref === "string") {
      if (!sizes.has(ref) || pool[ref]?.id !== row.id) return invalid();
      expandedBytes += sizes.get(ref)!;
    } else expandedBytes += Buffer.byteLength(JSON.stringify(row) ?? "");
    if (expandedBytes > TK1688_ARCHIVE_LIMITS.expandedDescriptorBytes) return invalid();
  }
  const model = (row: ModelDescriptor): ModelDescriptor => {
    const ref = row.metadata?.catalogStoredDescriptor;
    // A legacy/manual refresh may replace visible rows while preserving the
    // archive containing the independently owned source/history rows.
    if (typeof ref !== "string") return structuredClone(row);
    const original = Object.hasOwn(pool, ref) ? pool[ref] : undefined;
    if (!original || original.id !== row.id) return invalid();
    return structuredClone(original);
  };
  const result = { ...stored, visibleModels: stored.visibleModels.map(model),
    historicalModels: stored.historicalModels.map(row => ({ ...row, descriptor: model(row.descriptor) })),
    sources: Object.fromEntries(Object.entries(stored.sources).map(([key, source]) => [key, { ...source,
      acceptedModels: source.acceptedModels.map(model), ...(source.candidate ? { candidate: { ...source.candidate, models: source.candidate.models.map(model) } } : {}) }])) };
  delete result.tk1688DescriptorArchive;
  if (Buffer.byteLength(JSON.stringify(result)) > TK1688_ARCHIVE_LIMITS.logicalStateBytes) return invalid();
  return result;
}

/** The final connection menu stays complete. Internal source/visible/history
 * copies reference one lossless archive instead of duplicating full contracts. */
export function compactCatalogTk1688Inventory(value: CatalogInventoryState): CatalogInventoryState {
  const original = hydrateCatalogTk1688Inventory(value)!;
  let expandedBytes = 0;
  for (const row of descriptorRows(original)) {
    expandedBytes += Buffer.byteLength(JSON.stringify(row));
    if (expandedBytes > TK1688_ARCHIVE_LIMITS.expandedDescriptorBytes) return invalid();
  }
  if (Buffer.byteLength(JSON.stringify(original)) > TK1688_ARCHIVE_LIMITS.logicalStateBytes) return invalid();
  const pool: Record<string, ModelDescriptor> = {};
  const model = (row: ModelDescriptor): ModelDescriptor => {
    const json = JSON.stringify(row), ref = digest(json);
    pool[ref] ??= JSON.parse(json) as ModelDescriptor;
    return { id: row.id, name: row.name, operations: [...row.operations], metadata: { catalogStoredDescriptor: ref,
      ...(row.metadata?.canvasRunnable === false ? { canvasRunnable: false,
        ...(typeof row.metadata.canvasUnavailableReason === "string" ? { canvasUnavailableReason: row.metadata.canvasUnavailableReason } : {}) } : {}) } };
  };
  const result: StoredInventory = { ...original, visibleModels: original.visibleModels.map(model),
    historicalModels: original.historicalModels.map(row => ({ ...row, descriptor: model(row.descriptor) })),
    sources: Object.fromEntries(Object.entries(original.sources).map(([key, source]) => [key, { ...source,
      acceptedModels: source.acceptedModels.map(model), ...(source.candidate ? { candidate: { ...source.candidate, models: source.candidate.models.map(model) } } : {}) }])) };
  const bytes = Buffer.from(JSON.stringify(pool));
  if (bytes.length > TK1688_ARCHIVE_LIMITS.poolBytes) return invalid();
  const body = deflateRawSync(bytes).toString("base64");
  if (body.length > TK1688_ARCHIVE_LIMITS.poolBytes) return invalid();
  result.tk1688DescriptorArchive = { schemaVersion: 1, codec: "deflate-raw-base64", sha256: digest(bytes), originalBytes: bytes.length,
    descriptorCount: Object.keys(pool).length, body };
  return result;
}

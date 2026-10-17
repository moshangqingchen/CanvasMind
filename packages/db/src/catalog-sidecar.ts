import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const CATALOG_STORAGE_SETTING = "supplierCatalogPipelineStorage:v1";
const NOTICE_CURSORS = "supplier-catalog-pipeline-notice-cursors:v1";
export const isCatalogSidecarSetting = (key: string): boolean => key.startsWith("supplierCatalogPipeline:") || key === NOTICE_CURSORS;
export const catalogSidecarDirectory = (path: string): string => basename(path) === "super-canvas.json"
  ? join(dirname(path), "catalog-pipeline") : `${path}.catalog-pipeline`;
export const catalogSidecarPath = (path: string, key: string): string => join(catalogSidecarDirectory(path), `${sha256(key)}.json`);
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

interface Anchor { transactionId: string; sha256: string }
interface StorageMarker { schemaVersion: 1; entries: Record<string, Anchor> }
interface Version {
  anchor: Anchor;
  sequence: number;
  transactionId: string;
  sha256: string;
  value: unknown;
}
interface Sidecar { schemaVersion: 1; key: string; committed?: Version; prepared?: Version }
export interface CatalogSidecarPrepared { marker: StorageMarker; documents: Map<string, Sidecar> }
type Replace = (path: string, contents: string) => Promise<void>;
const hashValue = (value: unknown): string => sha256(JSON.stringify(value));
const fail = (): never => { throw new Error("目录检查独立状态缺失、损坏或事务标记不一致；已停止写入，请恢复完整备份"); };
const anchorEquals = (a: Anchor | undefined, b: Anchor | undefined): boolean => Boolean(a && b && a.transactionId === b.transactionId && a.sha256 === b.sha256);
function validAnchor(value: unknown): value is Anchor {
  if (!value || typeof value !== "object") return false;
  const row = value as Anchor;
  return typeof row.transactionId === "string" && row.transactionId.length > 0 && /^[a-f0-9]{64}$/u.test(row.sha256);
}
function assertVersion(value: Version | undefined): void {
  if (value === undefined) return;
  if (!validAnchor(value.anchor) || !Number.isSafeInteger(value.sequence) || value.sequence < 1 ||
    typeof value.transactionId !== "string" || !value.transactionId || hashValue(value.value) !== value.sha256) fail();
}

/** Storage-only projection. MemoryRepository retains its existing API and CAS.
 * Main markers select one side of a prepared write; recovery never replays a
 * catalog patch, dispatch, counter or network request. */
export class CatalogSidecarStore {
  private marker: StorageMarker = { schemaVersion: 1, entries: {} };
  private readonly documents = new Map<string, Sidecar>();
  private readonly durableReferences = new Map<string, unknown>();
  readonly settings: Record<string, unknown>;

  constructor(private readonly databasePath: string, settings: Record<string, unknown> = {}) {
    this.settings = { ...settings };
    const marker = settings[CATALOG_STORAGE_SETTING];
    if (marker !== undefined) {
      if (!marker || typeof marker !== "object" || (marker as StorageMarker).schemaVersion !== 1 ||
        !(marker as StorageMarker).entries || typeof (marker as StorageMarker).entries !== "object" || Array.isArray((marker as StorageMarker).entries)) fail();
      this.marker = structuredClone(marker as StorageMarker);
      for (const [key, anchor] of Object.entries(this.marker.entries)) {
        if (!isCatalogSidecarSetting(key) || !validAnchor(anchor)) fail();
        // A previous client may preserve the marker but recreate inline state.
        // That is an unsupported competing writer, not a second migration.
        if (Object.hasOwn(settings, key)) fail();
        let document!: Sidecar;
        try { document = JSON.parse(readFileSync(catalogSidecarPath(databasePath, key), "utf8")) as Sidecar; }
        catch { fail(); }
        if (document.schemaVersion !== 1 || document.key !== key) fail();
        assertVersion(document.committed); assertVersion(document.prepared);
        if (document.prepared && (document.prepared.transactionId !== document.prepared.anchor.transactionId ||
          document.prepared.sha256 !== document.prepared.anchor.sha256)) fail();
        const selected = anchorEquals(document.prepared?.anchor, anchor) ? document.prepared : document.committed;
        if (!selected || !anchorEquals(selected.anchor, anchor)) fail();
        this.settings[key] = selected!.value;
        // An aborted prepare remains invisible; normalize it at the next barrier.
        this.documents.set(key, { schemaVersion: 1, key, committed: selected,
          ...(document.prepared ? { prepared: selected } : {}) });
      }
    }
    delete this.settings[CATALOG_STORAGE_SETTING];
  }

  adoptReferences(settings: Record<string, unknown>): void {
    for (const [key, document] of this.documents) {
      const value = settings[key];
      this.durableReferences.set(key, value); this.settings[key] = value;
      // MemoryRepository clones its load input. Keep only that owned copy,
      // rather than retaining a second large parsed namespace for all runtime.
      const committed = document.committed ? { ...document.committed, value } : undefined;
      this.documents.set(key, { schemaVersion: 1, key, committed,
        ...(document.prepared && committed ? { prepared: committed } : {}) });
    }
  }

  mainSettings(settings: Record<string, unknown>, marker = this.marker): Record<string, unknown> {
    const ordinary = Object.fromEntries(Object.entries(settings).filter(([key]) => !isCatalogSidecarSetting(key) && key !== CATALOG_STORAGE_SETTING));
    return Object.keys(marker.entries).length ? { ...ordinary, [CATALOG_STORAGE_SETTING]: marker } : ordinary;
  }

  hasUnmigrated(settings: Record<string, unknown>): boolean {
    return Object.keys(settings).some(key => isCatalogSidecarSetting(key) && !this.marker.entries[key]);
  }

  async recover(replace: Replace): Promise<void> {
    for (const [key, document] of this.documents) {
      if (!document.prepared) continue;
      const normalized: Sidecar = { schemaVersion: 1, key, committed: document.committed };
      await replace(catalogSidecarPath(this.databasePath, key), JSON.stringify(normalized));
      this.documents.set(key, normalized);
    }
  }

  async prepare(settings: Record<string, unknown>, replace: Replace): Promise<CatalogSidecarPrepared> {
    const marker = structuredClone(this.marker), documents = new Map<string, Sidecar>();
    for (const [key, value] of Object.entries(settings)) {
      if (!isCatalogSidecarSetting(key) || this.marker.entries[key] && this.durableReferences.get(key) === value) continue;
      const previous = this.documents.get(key)?.committed, digest = hashValue(value), transactionId = randomUUID();
      const anchor = { transactionId, sha256: digest };
      const prepared: Version = { anchor, sequence: (previous?.sequence ?? 0) + 1, transactionId, sha256: digest, value };
      const document: Sidecar = { schemaVersion: 1, key, ...(previous ? { committed: previous } : {}), prepared };
      // Retain the previously committed version until the main atomic rename.
      await replace(catalogSidecarPath(this.databasePath, key), JSON.stringify(document));
      marker.entries[key] = anchor; documents.set(key, document);
    }
    return { marker, documents };
  }

  accept(prepared: CatalogSidecarPrepared, settings: Record<string, unknown>): void {
    this.marker = prepared.marker;
    for (const [key, document] of prepared.documents) {
      const version = document.prepared!;
      this.documents.set(key, { schemaVersion: 1, key, committed: version, prepared: version });
      this.durableReferences.set(key, settings[key]); this.settings[key] = settings[key];
    }
  }

  async writeState(key: string, value: unknown, replace: Replace, publish: () => Promise<void>): Promise<boolean> {
    const anchor = this.marker.entries[key], previous = this.documents.get(key)?.committed;
    if (!anchor || !previous) return false;
    if (!anchorEquals(previous.anchor, anchor)) fail();
    const committed: Version = { anchor, sequence: previous.sequence + 1, transactionId: randomUUID(), sha256: hashValue(value), value };
    const document: Sidecar = { schemaVersion: 1, key, committed };
    const path = catalogSidecarPath(this.databasePath, key);
    try { await replace(path, JSON.stringify(document)); }
    catch (error) {
      // A directory-fsync or injected failure can happen after atomic rename.
      // Do not expose old counters when the replacement already committed.
      let onDisk: Sidecar | undefined;
      try { onDisk = JSON.parse(readFileSync(path, "utf8")) as Sidecar; } catch { /* Original failure remains authoritative. */ }
      if (onDisk?.committed?.transactionId === committed.transactionId) {
        this.documents.set(key, document); this.durableReferences.set(key, value); this.settings[key] = value; await publish();
      }
      throw error;
    }
    this.documents.set(key, document); this.durableReferences.set(key, value); this.settings[key] = value; await publish();
    return true;
  }
}

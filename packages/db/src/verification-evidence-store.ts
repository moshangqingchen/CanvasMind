import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { SupplierVerificationRecord } from "./supplier-verification.js";

export const VERIFICATION_EVIDENCE_SETTING = "supplierVerificationEvidenceStorage:v1";

/** A storage reference, never a replacement for the repository's public DTO. */
export interface VerificationEvidenceReference {
  schemaVersion: 1;
  id: string;
  revision: number;
  sha256: string;
  byteLength: number;
}

export interface VerificationEvidenceSnapshot {
  schemaVersion: 1;
  entries: Record<string, VerificationEvidenceReference>;
}

export interface VerificationEvidenceHashProof {
  id: string;
  revision: number;
  sha256: string;
  byteLength: number;
}

export type StoredVerificationSummary = SupplierVerificationRecord & {
  verificationEvidenceStorageVersion: 1;
};

/** Normalize only JSON representation: retain every field and array ordering. */
export function canonicalVerificationJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("Invalid verification evidence JSON");
  const canonical = (item: unknown): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical((item as Record<string, unknown>)[key])}`).join(",")}}`;
  };
  return canonical(JSON.parse(json) as unknown);
}

export function verificationEvidenceHash(value: unknown): string {
  return createHash("sha256").update(canonicalVerificationJson(value), "utf8").digest("hex");
}

function validateReference(value: unknown): asserts value is VerificationEvidenceReference {
  const reference = value as Partial<VerificationEvidenceReference> | null;
  if (!reference || reference.schemaVersion !== 1 || typeof reference.id !== "string"
    || !Number.isSafeInteger(reference.revision) || reference.revision! < 0
    || typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(reference.sha256)
    || !Number.isSafeInteger(reference.byteLength) || reference.byteLength! < 2) {
    throw new Error("Invalid verification evidence reference");
  }
}

export function readVerificationEvidenceSnapshot(value: unknown): VerificationEvidenceSnapshot | undefined {
  if (value === undefined) return undefined;
  const snapshot = value as Partial<VerificationEvidenceSnapshot> | null;
  if (!snapshot || snapshot.schemaVersion !== 1 || !snapshot.entries
    || typeof snapshot.entries !== "object" || Array.isArray(snapshot.entries)) {
    throw new Error("Invalid verification evidence snapshot");
  }
  for (const [id, reference] of Object.entries(snapshot.entries)) {
    validateReference(reference);
    if (reference.id !== id) throw new Error("Verification evidence identity mismatch");
  }
  return snapshot as VerificationEvidenceSnapshot;
}

function verifyContents(contents: Buffer, reference: VerificationEvidenceReference): SupplierVerificationRecord {
  if (contents.byteLength !== reference.byteLength
    || createHash("sha256").update(contents).digest("hex") !== reference.sha256) {
    throw new Error("Verification evidence integrity mismatch");
  }
  let record: SupplierVerificationRecord;
  try { record = JSON.parse(contents.toString("utf8")) as SupplierVerificationRecord; }
  catch { throw new Error("Invalid verification evidence JSON"); }
  if (!record || record.id !== reference.id || record.revision !== reference.revision
    || record.schemaVersion !== 1 || !Array.isArray(record.cases)
    || !Array.isArray(record.evidence) || !Array.isArray(record.skipped)) {
    throw new Error("Verification evidence identity mismatch");
  }
  return record;
}

/** Required v1 fields stay readable by old versions, but no tasks can resume.
 * The complete record remains exclusively in the immutable evidence object. */
export function verificationEvidenceSummary(record: SupplierVerificationRecord): StoredVerificationSummary {
  return {
    id: record.id,
    schemaVersion: record.schemaVersion,
    revision: record.revision,
    sourceId: record.sourceId,
    policyVersion: record.policyVersion,
    limit: record.limit,
    used: record.used,
    round: record.round,
    paused: true,
    pauseReason: "safety",
    reason: "完整核验证据已独立保存，请使用支持该格式的版本查看。",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    cases: [],
    evidence: [],
    skipped: [],
    verificationEvidenceStorageVersion: 1,
  };
}

/** Immutable, whole-record, content-addressed evidence. There is deliberately
 * no garbage collection: old requests, responses and charge evidence survive
 * later edits. A failed main-snapshot replacement leaves only a safe orphan. */
export class VerificationEvidenceStore {
  constructor(private readonly directory: string, private readonly replaceFile: typeof rename = rename) {}

  private path(reference: VerificationEvidenceReference): string {
    validateReference(reference);
    // IDs and user-controlled paths are never used in a filename.
    return join(this.directory, `${reference.sha256}.json`);
  }

  readRecordSync(reference: VerificationEvidenceReference): SupplierVerificationRecord {
    return verifyContents(readFileSync(this.path(reference)), reference);
  }

  async writeRecord(record: SupplierVerificationRecord): Promise<VerificationEvidenceReference> {
    const contents = Buffer.from(canonicalVerificationJson(record), "utf8");
    const reference: VerificationEvidenceReference = {
      schemaVersion: 1, id: record.id, revision: record.revision,
      sha256: createHash("sha256").update(contents).digest("hex"), byteLength: contents.byteLength,
    };
    // Validate the payload before creating any durable reference.
    verifyContents(contents, reference);
    const path = this.path(reference);
    try {
      verifyContents(await readFile(path), reference);
      return reference;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `${reference.sha256}.${process.pid}.${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx");
      try { await file.writeFile(contents); await file.sync(); }
      finally { await file.close(); }
      try { await this.replaceFile(temporary, path); }
      catch (error) {
        // Another writer may have installed the identical immutable object.
        // Never replace a corrupt existing object with an unverified guess.
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw error;
        verifyContents(await readFile(path), reference);
      }
      const directory = await open(this.directory, "r").catch((error: NodeJS.ErrnoException) => {
        // Windows does not expose directory fsync through this API. The blob
        // itself is always flushed before the main snapshot can reference it.
        if (process.platform === "win32" && ["EPERM", "EACCES", "EISDIR"].includes(error.code ?? "")) return undefined;
        throw error;
      });
      if (directory) {
        try {
          await directory.sync().catch((error: NodeJS.ErrnoException) => {
            if (process.platform === "win32" && ["EPERM", "EACCES", "EISDIR", "EINVAL"].includes(error.code ?? "")) return;
            throw error;
          });
        }
        finally { await directory.close(); }
      }
      // A migration is acknowledged only after complete bytes read back.
      verifyContents(await readFile(path), reference);
      return reference;
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  async ensureRecords(records: readonly SupplierVerificationRecord[]): Promise<{
    references: VerificationEvidenceSnapshot;
    summaries: StoredVerificationSummary[];
    hashProofs: VerificationEvidenceHashProof[];
  }> {
    const entries: Record<string, VerificationEvidenceReference> = Object.create(null) as Record<string, VerificationEvidenceReference>;
    const summaries: StoredVerificationSummary[] = [];
    const hashProofs: VerificationEvidenceHashProof[] = [];
    for (const record of records) {
      if (Object.hasOwn(entries, record.id)) throw new Error("Duplicate verification evidence identity");
      const reference = await this.writeRecord(record);
      entries[record.id] = reference;
      summaries.push(verificationEvidenceSummary(record));
      hashProofs.push({ id: record.id, revision: record.revision, sha256: reference.sha256, byteLength: reference.byteLength });
    }
    return { references: { schemaVersion: 1, entries }, summaries, hashProofs };
  }

  hydrateRecordsSync(rows: readonly SupplierVerificationRecord[], snapshotValue: unknown): SupplierVerificationRecord[] {
    const references = readVerificationEvidenceSnapshot(snapshotValue)?.entries;
    const seen = new Set<string>();
    const result = rows.map(row => {
      if (seen.has(row.id)) throw new Error("Duplicate verification evidence identity");
      seen.add(row.id);
      const reference = references && Object.hasOwn(references, row.id) ? references[row.id] : undefined;
      const summary = (row as Partial<StoredVerificationSummary>).verificationEvidenceStorageVersion;
      if (!reference) {
        if (summary !== undefined) throw new Error("Missing verification evidence reference");
        return row;
      }
      if (summary !== 1 || row.revision !== reference.revision) throw new Error("Verification evidence summary mismatch");
      return this.readRecordSync(reference);
    });
    if (references && Object.keys(references).some(id => !seen.has(id))) throw new Error("Missing verification evidence summary");
    return result;
  }
}

import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileRepository } from "../src/file.js";
import { MemoryRepository } from "../src/memory.js";
import type { SupplierVerificationRecord } from "../src/supplier-verification.js";
import {
  VERIFICATION_EVIDENCE_SETTING,
  VerificationEvidenceStore,
  verificationEvidenceHash,
  type VerificationEvidenceSnapshot,
} from "../src/verification-evidence-store.js";

const root = fileURLToPath(new URL("../../../.codex-temp/verification-file-tests/", import.meta.url));
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of directories.splice(0)) {
    if (!resolve(path).startsWith(resolve(root) + sep)) throw new Error("Unsafe test cleanup");
    await rm(path, { recursive: true, force: true });
  }
});

async function pathFor() {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "evidence-"));
  directories.push(directory);
  return join(directory, "super-canvas.json");
}

function fixture(): SupplierVerificationRecord {
  return {
    id: "supplier", schemaVersion: 1, revision: 0, sourceId: "source", policyVersion: 2, limit: 1, used: 1, round: 1,
    paused: false, createdAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T00:00:00.000Z",
    cases: [{ id: "case", requestId: "request", supplierId: "supplier", sourceId: "source", connectionId: "connection", group: "group", supplierGroupId: "official-group",
      modelId: "complete-model-id", provider: "fixture", fingerprint: "fingerprint", dedupeKey: "dedupe", resolution: "4K", quality: "max", ratio: "1:1",
      expectedWidth: 4096, expectedHeight: 4096, parameters: { quality: "max", n: 1 }, status: "succeeded",
      createdAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T00:00:00.000Z", assetId: "original-asset", actualWidth: 4096, actualHeight: 4096,
      task: { providerTaskId: "original-task", result: { requestId: "original-request", response: { data: [{ b64_json: "ZmFrZQ==".repeat(8192) }] }, unknownResponseField: { "10": true, "2": null, content: "中文原文" } } },
      actualCharge: { amount: 0.123, currency: "CNY", unit: "image", checkedAt: "2026-10-17T00:00:00.000Z", requestId: "original-request", taskId: "original-task" } }],
    evidence: [{ id: "evidence", supplierId: "supplier", sourceId: "source", connectionId: "connection", group: "group", modelId: "complete-model-id", operation: "image.generate",
      kind: "test", checkedAt: "2026-10-17T00:00:00.000Z", excerpt: "完整证据", fingerprint: "fingerprint", status: "verified" }],
    skipped: [{ connectionId: "connection", modelId: "skipped-model", reason: "original-reason" }],
  };
}

async function inlineSeed(path: string) {
  const memory = new MemoryRepository();
  await memory.saveCanvas({ id: "canvas", graph: { nodes: [], edges: [] } });
  const record = await memory.saveSupplierVerification(fixture(), 0);
  await writeFile(path, JSON.stringify(memory.exportSnapshot()));
  return record;
}

interface DiskSnapshot {
  applicationSettings: Record<string, unknown>;
  supplierVerifications: Array<SupplierVerificationRecord & { verificationEvidenceStorageVersion?: number }>;
}
const disk = async (path: string) => JSON.parse(await readFile(path, "utf8")) as DiskSnapshot;
const evidenceDirectory = (path: string) => join(dirname(path), "supplier-verification-evidence");
const manifest = (snapshot: DiskSnapshot) => snapshot.applicationSettings[VERIFICATION_EVIDENCE_SETTING] as VerificationEvidenceSnapshot;
const crash = () => Object.assign(new Error("fixture-crash"), { code: "EIO" });

describe("FileRepository verification evidence integration", () => {
  it("migrates an inline record without semantic loss and makes normal repository reads transparent", async () => {
    const path = await pathFor(), record = await inlineSeed(path), beforeHash = verificationEvidenceHash(record);
    const repository = new FileRepository(path);
    expect((await disk(path)).supplierVerifications[0]!.cases).toHaveLength(1);
    await repository.flush();
    const stored = await disk(path);
    expect(stored.supplierVerifications[0]).toMatchObject({ id: record.id, revision: record.revision, paused: true, cases: [], evidence: [], skipped: [], verificationEvidenceStorageVersion: 1 });
    expect(manifest(stored).entries.supplier!.sha256).toBe(beforeHash);
    expect(Buffer.byteLength(JSON.stringify(stored.supplierVerifications))).toBeLessThan(1024);
    const reopened = new FileRepository(path);
    expect(await reopened.getSupplierVerification(record.id)).toEqual(record);
    expect(await reopened.listSupplierVerifications()).toEqual([record]);
    expect(verificationEvidenceHash(await reopened.getSupplierVerification(record.id))).toBe(beforeHash);
    expect(await reopened.getApplicationSetting(VERIFICATION_EVIDENCE_SETTING)).toBeUndefined();
    expect(reopened.exportSnapshot().applicationSettings?.[VERIFICATION_EVIDENCE_SETTING]).toBeUndefined();
  });

  it("keeps the old full snapshot if migration fails before the main rename, and retry reuses the safe orphan", async () => {
    const path = await pathFor(), record = await inlineSeed(path), original = await readFile(path);
    let fail = true;
    const repository = new FileRepository(path, async (from, to) => {
      if (String(to) === path && fail) throw crash();
      return rename(from, to);
    });
    await expect(repository.flush()).rejects.toThrow("fixture-crash");
    expect(await readFile(path)).toEqual(original);
    expect(await new FileRepository(path).getSupplierVerification(record.id)).toEqual(record);
    const files = await readdir(evidenceDirectory(path));
    expect(files).toEqual([`${verificationEvidenceHash(record)}.json`]);
    fail = false;
    await repository.flush();
    expect(await new FileRepository(path).getSupplierVerification(record.id)).toEqual(record);
    expect(await readdir(evidenceDirectory(path))).toEqual(files);
  });

  it("never installs a main reference when writing the complete evidence object fails", async () => {
    const path = await pathFor(), record = await inlineSeed(path), original = await readFile(path);
    const repository = new FileRepository(path);
    const write = vi.spyOn(VerificationEvidenceStore.prototype, "writeRecord").mockRejectedValueOnce(crash());
    await expect(repository.flush()).rejects.toThrow("fixture-crash");
    expect(await readFile(path)).toEqual(original);
    expect(await new FileRepository(path).getSupplierVerification(record.id)).toEqual(record);
    write.mockRestore();
    await repository.flush();
    expect(await new FileRepository(path).getSupplierVerification(record.id)).toEqual(record);
  });

  it("reopens complete evidence if the process stops after the main atomic rename", async () => {
    const path = await pathFor(), record = await inlineSeed(path);
    let failed = false;
    const repository = new FileRepository(path, async (from, to) => {
      await rename(from, to);
      if (String(to) === path && !failed) { failed = true; throw crash(); }
    });
    await expect(repository.flush()).rejects.toThrow("fixture-crash");
    expect((await disk(path)).supplierVerifications[0]!.verificationEvidenceStorageVersion).toBe(1);
    expect(await new FileRepository(path).getSupplierVerification(record.id)).toEqual(record);
    await repository.flush();
    expect(await new FileRepository(path).getSupplierVerification(record.id)).toEqual(record);
  });

  it("keeps both complete evidence versions after a real verification revision", async () => {
    const path = await pathFor(), original = await inlineSeed(path), repository = new FileRepository(path);
    await repository.flush();
    const oldReference = manifest(await disk(path)).entries.supplier!;
    const input = (await repository.getSupplierVerification(original.id))!;
    input.reason = "user changed metadata";
    const next = await repository.saveSupplierVerification(input, input.revision);
    const nextReference = manifest(await disk(path)).entries.supplier!;
    expect(next.revision).toBe(original.revision + 1);
    expect(nextReference.sha256).not.toBe(oldReference.sha256);
    const store = new VerificationEvidenceStore(evidenceDirectory(path));
    expect(store.readRecordSync(oldReference)).toEqual(original);
    expect(store.readRecordSync(nextReference)).toEqual(next);
    expect(await new FileRepository(path).getSupplierVerification(original.id)).toEqual(next);
    expect(await readdir(evidenceDirectory(path))).toHaveLength(2);
  });

  it("does not hash, serialize or rewrite unchanged evidence on ordinary foreground saves", async () => {
    const path = await pathFor();
    await inlineSeed(path);
    const writes = vi.spyOn(VerificationEvidenceStore.prototype, "writeRecord");
    let mainWrites = 0;
    const repository = new FileRepository(path, async (from, to) => { if (String(to) === path) mainWrites++; await rename(from, to); });
    await repository.flush();
    expect(writes).toHaveBeenCalledTimes(1);
    const reference = manifest(await disk(path));
    for (let index = 0; index < 3; index++) await repository.saveCanvas({ id: "canvas", graph: { nodes: [], edges: [], content: index } });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(mainWrites).toBe(4);
    expect(manifest(await disk(path))).toEqual(reference);
    expect(await readdir(evidenceDirectory(path))).toHaveLength(1);
  });

  it("never trusts caller-owned or returned DTO mutations as cached evidence", async () => {
    const path = await pathFor(), original = await inlineSeed(path), repository = new FileRepository(path);
    await repository.flush();
    const publicRecord = (await repository.getSupplierVerification(original.id))!;
    publicRecord.cases[0]!.actualCharge!.amount = 999;
    publicRecord.cases[0]!.task!.unknown = "caller mutation";
    await repository.saveCanvas({ id: "canvas", graph: { nodes: [], edges: [], content: "ordinary save" } });
    expect(await new FileRepository(path).getSupplierVerification(original.id)).toEqual(original);
    const saved = await repository.saveSupplierVerification(publicRecord, publicRecord.revision);
    publicRecord.cases[0]!.actualCharge!.amount = 1234;
    saved.cases[0]!.actualCharge!.amount = 5678;
    expect((await repository.getSupplierVerification(original.id))!.cases[0]!.actualCharge!.amount).toBe(999);
    await repository.saveCanvas({ id: "canvas", graph: { nodes: [], edges: [], content: "second ordinary save" } });
    expect((await new FileRepository(path).getSupplierVerification(original.id))!.cases[0]!.actualCharge!.amount).toBe(999);
  });

  it("fails closed on a missing evidence object without deleting or replacing the main snapshot", async () => {
    const path = await pathFor();
    await inlineSeed(path);
    await new FileRepository(path).flush();
    const before = await readFile(path), reference = manifest(await disk(path)).entries.supplier!;
    await unlink(join(evidenceDirectory(path), `${reference.sha256}.json`));
    expect(() => new FileRepository(path)).toThrow();
    expect(await readFile(path)).toEqual(before);
  });

  it("fails closed on corruption, even if a replacement JSON body still parses", async () => {
    const path = await pathFor();
    await inlineSeed(path);
    await new FileRepository(path).flush();
    const before = await readFile(path), reference = manifest(await disk(path)).entries.supplier!;
    const blob = join(evidenceDirectory(path), `${reference.sha256}.json`);
    const contents = JSON.parse(await readFile(blob, "utf8")) as SupplierVerificationRecord;
    contents.cases[0]!.actualCharge!.amount = 999;
    await writeFile(blob, JSON.stringify(contents));
    expect(() => new FileRepository(path)).toThrow("integrity mismatch");
    expect(await readFile(path)).toEqual(before);
  });

  it("rejects an old writer changing the safe summary revision and keeps the archived original", async () => {
    const path = await pathFor(), original = await inlineSeed(path);
    await new FileRepository(path).flush();
    const stored = await disk(path), reference = manifest(stored).entries.supplier!;
    stored.supplierVerifications[0]!.revision++;
    await writeFile(path, JSON.stringify(stored));
    expect(() => new FileRepository(path)).toThrow("summary mismatch");
    expect(new VerificationEvidenceStore(evidenceDirectory(path)).readRecordSync(reference)).toEqual(original);
  });

  it("exports a complete portable snapshot instead of summaries or file references", async () => {
    const path = await pathFor(), original = await inlineSeed(path), repository = new FileRepository(path);
    await repository.flush();
    const portable = repository.exportSnapshot();
    expect(portable.supplierVerifications).toEqual([original]);
    expect(portable.applicationSettings?.[VERIFICATION_EVIDENCE_SETTING]).toBeUndefined();
    const copiedPath = await pathFor();
    await writeFile(copiedPath, JSON.stringify(portable));
    const copied = new FileRepository(copiedPath);
    expect(await copied.getSupplierVerification(original.id)).toEqual(original);
    await copied.flush();
    expect(await new FileRepository(copiedPath).getSupplierVerification(original.id)).toEqual(original);
    expect(verificationEvidenceHash(await new FileRepository(copiedPath).getSupplierVerification(original.id))).toBe(verificationEvidenceHash(original));
  });

  it("does not mistake prototype properties for cached references during mixed inline migration", async () => {
    const path = await pathFor();
    await inlineSeed(path);
    await new FileRepository(path).flush();
    const stored = await disk(path);
    const legacy = fixture();
    legacy.id = "constructor";
    legacy.revision = 1;
    stored.supplierVerifications.push(legacy);
    await writeFile(path, JSON.stringify(stored));
    const repository = new FileRepository(path);
    expect(await repository.getSupplierVerification(legacy.id)).toEqual(legacy);
    await repository.flush();
    expect(await new FileRepository(path).getSupplierVerification(legacy.id)).toEqual(legacy);
    const references = manifest(await disk(path));
    expect(Object.hasOwn(references.entries, legacy.id)).toBe(true);
    expect(references.entries[legacy.id]!.sha256).toBe(verificationEvidenceHash(legacy));
  });

  it("supports the inline benchmark seed without providing an existing external snapshot downgrade", async () => {
    const path = await pathFor(), original = await inlineSeed(path);
    const inline = new FileRepository(path, rename, { verificationEvidence: "inline" });
    await inline.saveCanvas({ id: "canvas", graph: { nodes: [], edges: [], content: "benchmark C" } });
    const storedInline = await disk(path);
    expect(storedInline.supplierVerifications).toEqual([original]);
    expect(storedInline.applicationSettings[VERIFICATION_EVIDENCE_SETTING]).toBeUndefined();
    await new FileRepository(path).flush();
    expect(() => new FileRepository(path, rename, { verificationEvidence: "inline" })).toThrow("Cannot downgrade");
    expect(await new FileRepository(path).getSupplierVerification(original.id)).toEqual(original);
  });
});

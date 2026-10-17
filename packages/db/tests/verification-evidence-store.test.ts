import { mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SupplierVerificationRecord } from "../src/supplier-verification.js";
import {
  canonicalVerificationJson,
  readVerificationEvidenceSnapshot,
  verificationEvidenceHash,
  verificationEvidenceSummary,
  VerificationEvidenceStore,
  type VerificationEvidenceReference,
} from "../src/verification-evidence-store.js";

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "verification-evidence-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function fixture(id = "supplier", revision = 7): SupplierVerificationRecord {
  return {
    id, schemaVersion: 1, revision, sourceId: "source", policyVersion: 2, limit: 1, used: 1, round: 1,
    paused: false, createdAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T01:00:00.000Z",
    cases: [{
      id: "case", requestId: "request", supplierId: id, sourceId: "source", connectionId: "connection", group: "original group",
      supplierGroupId: "official-group", modelId: "complete-model-id", provider: "fixture", fingerprint: "fingerprint", dedupeKey: "dedupe",
      resolution: "4K", quality: "max", ratio: "1:1", expectedWidth: 4096, expectedHeight: 4096, parameters: { n: 1, quality: "max" },
      status: "succeeded", createdAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T01:00:00.000Z",
      task: { providerTaskId: "original-task", result: { requestId: "original-request", response: { data: [{ b64_json: "aGVsbG8=".repeat(32_768) }] },
        signedUrl: "https://fixture.invalid/result?token=fake", rawLog: "未截断的响应正文\n中文\"转义\"\u0000", extension: { unknownField: [null, true, 0, "\ud800"] } } },
      assetId: "original-asset", actualWidth: 4096, actualHeight: 4096,
      actualCharge: { amount: 0.123456, currency: "CNY", unit: "image", checkedAt: "2026-10-17T01:00:00.000Z", requestId: "original-request", taskId: "original-task", precision: 6 },
    }],
    evidence: [{ id: "evidence", supplierId: id, sourceId: "source", connectionId: "connection", group: "original group", modelId: "complete-model-id",
      operation: "image.generate", kind: "test", checkedAt: "2026-10-17T01:00:00.000Z", excerpt: "每条证据、原始任务和实扣都保留", fingerprint: "fingerprint", status: "verified", actualWidth: 4096, actualHeight: 4096 }],
    skipped: [{ connectionId: "connection", modelId: "another-model", reason: "fixture reason" }],
    coverage: [{ connectionId: "connection", group: "original group", modelId: "complete-model-id" }],
    connectionBlocks: [{ connectionId: "old-connection", fingerprint: "original-fingerprint", kind: "authentication", reason: "fixture" }],
  };
}

describe("immutable verification evidence store", () => {
  it("round-trips every original field, request, response, charge, image bytes and unknown extension", async () => {
    const path = await directory();
    const store = new VerificationEvidenceStore(path);
    const record = fixture();
    const batch = await store.ensureRecords([record]);
    const restored = store.hydrateRecordsSync(batch.summaries, batch.references);
    expect(restored).toEqual([record]);
    expect(batch.hashProofs).toEqual([{ id: record.id, revision: record.revision, sha256: verificationEvidenceHash(record), byteLength: Buffer.byteLength(canonicalVerificationJson(record)) }]);
    expect(verificationEvidenceHash(restored[0])).toBe(batch.hashProofs[0]!.sha256);
    const raw = await readFile(join(path, `${batch.hashProofs[0]!.sha256}.json`), "utf8");
    expect(raw).toBe(canonicalVerificationJson(record));
    expect(Buffer.byteLength(JSON.stringify(batch.summaries))).toBeLessThan(1024);
  });

  it("canonical hashes ignore object order and retain arrays, all fields and JSON string semantics", () => {
    expect(verificationEvidenceHash({ b: 2, a: { z: 1, x: ["中文", "\ud800", "\\"] } }))
      .toBe(verificationEvidenceHash({ a: { x: ["中文", "\ud800", "\\"], z: 1 }, b: 2 }));
    expect(verificationEvidenceHash({ rows: [1, 2] })).not.toBe(verificationEvidenceHash({ rows: [2, 1] }));
    expect(verificationEvidenceHash({ field: "original" })).not.toBe(verificationEvidenceHash({}));
    expect(canonicalVerificationJson({ omitted: undefined, array: [undefined, NaN] })).toBe('{"array":[null,null]}');
    expect(canonicalVerificationJson({ "2": "two", "10": "ten" })).toBe('{"10":"ten","2":"two"}');
    expect(() => canonicalVerificationJson(undefined)).toThrow("Invalid verification evidence JSON");
  });

  it("preserves prototype-looking JSON keys without changing or executing them", async () => {
    const store = new VerificationEvidenceStore(await directory());
    const record = fixture("__proto__");
    record.cases[0]!.task = JSON.parse('{"__proto__":{"polluted":true},"constructor":"original"}') as Record<string, unknown>;
    const batch = await store.ensureRecords([record]);
    expect(store.hydrateRecordsSync(batch.summaries, JSON.parse(JSON.stringify(batch.references)))).toEqual([record]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(store.hydrateRecordsSync([fixture("constructor")], { schemaVersion: 1, entries: {} })).toEqual([fixture("constructor")]);
  });

  it("does not write another blob for identical normalized content", async () => {
    const path = await directory();
    let replacements = 0;
    const store = new VerificationEvidenceStore(path, async (from, to) => { replacements++; await rename(from, to); });
    const record = fixture();
    const first = await store.writeRecord(record);
    const second = await store.writeRecord(JSON.parse(JSON.stringify(record)) as SupplierVerificationRecord);
    expect(second).toEqual(first);
    expect(replacements).toBe(1);
    expect(await readdir(path)).toEqual([`${first.sha256}.json`]);
  });

  it("keeps prior complete evidence versions after later revisions", async () => {
    const store = new VerificationEvidenceStore(await directory());
    const first = fixture();
    const firstRef = await store.writeRecord(first);
    const next = fixture("supplier", 8);
    next.reason = "later metadata update";
    const nextRef = await store.writeRecord(next);
    expect(nextRef.sha256).not.toBe(firstRef.sha256);
    expect(store.readRecordSync(firstRef)).toEqual(first);
    expect(store.readRecordSync(nextRef)).toEqual(next);
  });

  it("leaves an old main-snapshot reference valid when the next blob installation fails", async () => {
    const path = await directory();
    const old = fixture();
    const first = await new VerificationEvidenceStore(path).writeRecord(old);
    const failure = new VerificationEvidenceStore(path, async () => { throw new Error("fixture disk failure"); });
    await expect(failure.writeRecord(fixture("supplier", 8))).rejects.toThrow("fixture disk failure");
    expect(failure.readRecordSync(first)).toEqual(old);
    expect(await readdir(path)).toEqual([`${first.sha256}.json`]);
  });

  it("makes prepared-but-unreferenced evidence a safe orphan and retry is idempotent", async () => {
    const path = await directory();
    const store = new VerificationEvidenceStore(path);
    const old = await store.ensureRecords([fixture()]);
    // Simulates a crash after evidence fsync but before the main snapshot rename.
    const prepared = await store.ensureRecords([fixture("supplier", 8)]);
    expect(store.hydrateRecordsSync(old.summaries, old.references)).toEqual([fixture()]);
    expect(await new VerificationEvidenceStore(path).ensureRecords([fixture("supplier", 8)])).toEqual(prepared);
    expect(await readdir(path)).toHaveLength(2);
  });

  it("leaves legacy inline records unchanged until a complete evidence reference can be committed", async () => {
    const store = new VerificationEvidenceStore(await directory());
    const record = fixture();
    expect(store.hydrateRecordsSync([record], undefined)).toEqual([record]);
    expect(record.paused).toBe(false);
    const summary = verificationEvidenceSummary(record);
    expect(summary).toMatchObject({ paused: true, pauseReason: "safety", cases: [], evidence: [], skipped: [], verificationEvidenceStorageVersion: 1 });
    expect(summary.id).toBe(record.id);
    expect(summary.revision).toBe(record.revision);
    expect(summary.used).toBe(record.used);
    expect(record.cases).toHaveLength(1);
  });

  it("rejects missing evidence rather than replacing it with an empty record", async () => {
    const path = await directory();
    const store = new VerificationEvidenceStore(path);
    const batch = await store.ensureRecords([fixture()]);
    await unlink(join(path, `${batch.hashProofs[0]!.sha256}.json`));
    expect(() => store.hydrateRecordsSync(batch.summaries, batch.references)).toThrow();
  });

  it("rejects hash mismatches and never overwrites corrupt evidence", async () => {
    const path = await directory();
    const store = new VerificationEvidenceStore(path);
    const record = fixture();
    const reference = await store.writeRecord(record);
    const blob = join(path, `${reference.sha256}.json`);
    const contents = await readFile(blob);
    contents[20] = contents[20] === 65 ? 66 : 65;
    await writeFile(blob, contents);
    expect(() => store.readRecordSync(reference)).toThrow("Verification evidence integrity mismatch");
    await expect(store.writeRecord(record)).rejects.toThrow("Verification evidence integrity mismatch");
    expect(await readFile(blob)).toEqual(contents);
  });

  it("rejects wrong byte counts, record identities and revisions", async () => {
    const store = new VerificationEvidenceStore(await directory());
    const reference = await store.writeRecord(fixture());
    expect(() => store.readRecordSync({ ...reference, byteLength: reference.byteLength + 1 })).toThrow("integrity mismatch");
    expect(() => store.readRecordSync({ ...reference, id: "different-supplier" })).toThrow("identity mismatch");
    expect(() => store.readRecordSync({ ...reference, revision: 100 })).toThrow("identity mismatch");
  });

  it("rejects path traversal before reading any file", async () => {
    const store = new VerificationEvidenceStore(await directory());
    for (const sha256 of ["../state", "A".repeat(64), "a".repeat(63), `a${"/".repeat(63)}`]) {
      expect(() => store.readRecordSync({ schemaVersion: 1, id: "id", revision: 1, sha256, byteLength: 100 })).toThrow("Invalid verification evidence reference");
    }
    expect(() => store.readRecordSync({ schemaVersion: 2 } as unknown as VerificationEvidenceReference)).toThrow("Invalid verification evidence reference");
  });

  it("rejects old-version summary writes and missing manifests instead of overwriting archived originals", async () => {
    const store = new VerificationEvidenceStore(await directory());
    const batch = await store.ensureRecords([fixture()]);
    expect(() => store.hydrateRecordsSync([{ ...batch.summaries[0]!, revision: 8 }], batch.references)).toThrow("summary mismatch");
    expect(() => store.hydrateRecordsSync(batch.summaries, undefined)).toThrow("Missing verification evidence reference");
    expect(() => store.hydrateRecordsSync([], batch.references)).toThrow("Missing verification evidence summary");
    expect(() => store.hydrateRecordsSync([fixture()], batch.references)).toThrow("summary mismatch");
  });

  it("rejects malformed manifests, duplicate rows and incompatible versions", async () => {
    const store = new VerificationEvidenceStore(await directory());
    const batch = await store.ensureRecords([fixture()]);
    expect(() => readVerificationEvidenceSnapshot({ schemaVersion: 2, entries: {} })).toThrow("Invalid verification evidence snapshot");
    expect(() => readVerificationEvidenceSnapshot({ schemaVersion: 1, entries: [] })).toThrow("Invalid verification evidence snapshot");
    expect(() => readVerificationEvidenceSnapshot({ schemaVersion: 1, entries: { other: batch.references.entries.supplier } })).toThrow("identity mismatch");
    expect(() => store.hydrateRecordsSync([fixture(), fixture()], undefined)).toThrow("Duplicate verification evidence identity");
    await expect(store.ensureRecords([fixture(), fixture()])).rejects.toThrow("Duplicate verification evidence identity");
  });

  it("does not retain public mutable DTOs as trusted immutable evidence", async () => {
    const store = new VerificationEvidenceStore(await directory());
    const record = fixture();
    const first = await store.writeRecord(record);
    record.cases[0]!.actualCharge!.amount = 123;
    const next = await store.writeRecord(record);
    expect(next.sha256).not.toBe(first.sha256);
    const restored = store.readRecordSync(first);
    restored.cases[0]!.actualCharge!.amount = 456;
    expect(store.readRecordSync(first).cases[0]!.actualCharge!.amount).toBe(0.123456);
  });
});

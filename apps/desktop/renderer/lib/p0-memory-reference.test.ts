import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateMemorySnapshotReference } from "../e2e/helpers/p0-memory-reference";

const prefix = "supercanvas-p0-memory-reference-test-";
const created = new Set<string>();
const expectedBuildId = "same-frozen-production-build";
const phases = ["start", "idle-end", "operations-end"] as const;
const validSummary = () => ({ completed: true, formalEvidenceValid: true, diagnosticOnly: false,
  invalidReasons: [], measuredIdleMs: 1_200_011, measuredOperationMs: 300_006 });
const validManifest = () => ({ snapshots: true, runtimeBuildId: expectedBuildId });

async function fixture(summary: unknown = validSummary(), manifest: unknown = validManifest()) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.add(dir);
  await writeFile(join(dir, "summary.json"), JSON.stringify(summary));
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
  // Intentionally not valid snapshot JSON: validation must stat the bodies,
  // never load/parse large heaps merely to authorize the independent curve run.
  for (const phase of phases) await writeFile(join(dir, `${phase}.post-gc.heapsnapshot`), `opaque ${phase} snapshot body`);
  return dir;
}

afterEach(async () => {
  for (const dir of created) {
    const target = resolve(dir);
    // Recursive cleanup is restricted to this test's own mkdtemp children.
    if (!isAbsolute(target) || dirname(target).toLowerCase() !== resolve(tmpdir()).toLowerCase() || !basename(target).startsWith(prefix))
      throw new Error("Refusing cleanup outside owned snapshot-reference test directories");
    await rm(target, { recursive: true, force: true });
  }
  created.clear();
});

describe("P0 curve-only snapshot reference", () => {
  it("requires an explicit directory and expected build without touching files", async () => {
    for (const value of [undefined, "", " "]) {
      await expect(validateMemorySnapshotReference(value, expectedBuildId)).rejects.toThrow("referenceDir");
      await expect(validateMemorySnapshotReference("unread-reference", value)).rejects.toThrow("expectedBuildId");
    }
  });

  it("returns only bounded identity/file metadata for a full matching reference without reading heap bodies", async () => {
    const dir = await fixture();
    const result = await validateMemorySnapshotReference(dir, expectedBuildId);
    expect(result).toEqual({ referenceDir: await realpath(dir), buildId: expectedBuildId,
      summaryPath: join(await realpath(dir), "summary.json"), manifestPath: join(await realpath(dir), "manifest.json"),
      measuredIdleMs: 1_200_011, measuredOperationMs: 300_006, snapshotBodiesRead: false,
      snapshots: phases.map(phase => ({ phase, path: join(result.referenceDir, `${phase}.post-gc.heapsnapshot`),
        bytes: Buffer.byteLength(`opaque ${phase} snapshot body`) })) });
    expect(result.snapshots.every(snapshot => isAbsolute(snapshot.path))).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(4096);
  });

  it.each([
    { completed: false }, { completed: undefined }, { formalEvidenceValid: false }, { formalEvidenceValid: undefined },
    { diagnosticOnly: true }, { diagnosticOnly: undefined }, { invalidReasons: ["available-memory-below-8-GiB"] },
    { invalidReasons: undefined }, { invalidReasons: "" }, { measuredIdleMs: 1_199_999 },
    { measuredIdleMs: undefined }, { measuredIdleMs: "1200000" }, { measuredOperationMs: 299_999 },
    { measuredOperationMs: undefined }, { measuredOperationMs: "300000" },
  ])("rejects incomplete, invalid, diagnostic or short source metadata: %j", async patch => {
    const dir = await fixture({ ...validSummary(), ...patch });
    await expect(validateMemorySnapshotReference(dir, expectedBuildId)).rejects.toThrow("Snapshot reference");
  });

  it.each([
    { snapshots: false }, { snapshots: undefined }, { snapshots: "true" },
    { runtimeBuildId: "different-build" }, { runtimeBuildId: undefined },
  ])("rejects a curve-only or different-build manifest: %j", async patch => {
    const dir = await fixture(validSummary(), { ...validManifest(), ...patch });
    await expect(validateMemorySnapshotReference(dir, expectedBuildId)).rejects.toThrow("Snapshot reference");
  });

  it.each(phases)("requires nonempty regular files for %s", async phase => {
    const dir = await fixture();
    const path = join(dir, `${phase}.post-gc.heapsnapshot`);
    await rm(path);
    await expect(validateMemorySnapshotReference(dir, expectedBuildId)).rejects.toThrow(`${phase}.post-gc.heapsnapshot`);
    await writeFile(path, "");
    await expect(validateMemorySnapshotReference(dir, expectedBuildId)).rejects.toThrow("nonempty regular file");
    await rm(path);
    await mkdir(path);
    await expect(validateMemorySnapshotReference(dir, expectedBuildId)).rejects.toThrow("nonempty regular file");
  });

  it.each(["summary.json", "manifest.json"])("rejects missing, malformed, array or oversized %s metadata", async name => {
    const dir = await fixture();
    const path = join(dir, name);
    await rm(path);
    await expect(validateMemorySnapshotReference(dir, expectedBuildId)).rejects.toThrow("Snapshot reference");
    for (const text of ["{ broken JSON", "[]", " ".repeat(2 * 1024 * 1024 + 1)]) {
      await writeFile(path, text);
      await expect(validateMemorySnapshotReference(dir, expectedBuildId)).rejects.toThrow("Snapshot reference");
    }
  });

  it("does not reclassify or rewrite an originally invalid result", async () => {
    const dir = await fixture({ ...validSummary(), formalEvidenceValid: false, invalidReasons: ["available-memory-below-8-GiB"] });
    const before = await readFile(join(dir, "summary.json"), "utf8");
    await expect(validateMemorySnapshotReference(dir, expectedBuildId)).rejects.toThrow("formally valid");
    expect(await readFile(join(dir, "summary.json"), "utf8")).toBe(before);
  });
});

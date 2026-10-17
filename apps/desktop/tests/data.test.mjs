import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, unlink, utimes, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { encryptSecret } from "@super-canvas/providers/credentials";
import { initializeProfile, loadProfile, discoverSource, parseEnvironment, validateSnapshot, within, databaseSidecarRoots } from "../src/data.mjs";
import { FileRepository, catalogObservationIdentity } from "../../../packages/db/dist/index.js";
import { backendEnvironment, isAppUrl, externalUrl } from "../src/policy.mjs";

const snapshot = () => ({ version: 2, canvases: [], revisions: [], assets: [], connections: [], runs: [], nodeRuns: [], webhookKeys: [], directorProfiles: [], directorSessions: [], directorMessages: [], directorProposals: [] });
const protect = (text) => Buffer.from(`test-protected:${text}`);
const decrypt = (bytes) => bytes.toString().slice("test-protected:".length);

test("migration retains credentials including frozen task credentials, files and original database", async () => {
  const root = await mkdtemp(join(tmpdir(), "画布 migration "));
  try {
    const source = join(root, "old"); const target = join(root, "new");
    await mkdir(join(source, "apps/web/data"), { recursive: true });
    await mkdir(join(source, "apps/web/storage"), { recursive: true });
    await mkdir(join(source, "项目"), { recursive: true });
    await writeFile(join(source, "apps/web/storage/a.bin"), "asset");
    await writeFile(join(source, "项目/output.txt"), "archived");
    const encrypted = encryptSecret("not-a-real-api-key", "old-master");
    const data = snapshot();
    data.assets.push({ id: "a", storageKey: "a.bin", size: 5 });
    data.connections.push({ id: "c", encryptedSecret: encrypted });
    data.runs.push({ id: "r", status: "needs_attention", revisionGraph: { frozen: { encryptedSecret: encrypted } } });
    const original = JSON.stringify(data);
    await writeFile(join(source, "apps/web/data/super-canvas.json"), original);
    await writeFile(join(source, ".local-public.env"), "MASTER_KEY=old-master\nPUBLIC_BASE_URL=https://old.example\nHTTPS_PROXY=http://localhost:9000");
    await initializeProfile(target, { source: await discoverSource(source), encrypt: protect, ensureStopped: async () => {} });
    const loaded = await loadProfile(target, decrypt);
    assert.equal(loaded.masterKey, "old-master");
    assert.equal(loaded.network.PUBLIC_BASE_URL, undefined);
    assert.equal(await readFile(join(source, "apps/web/data/super-canvas.json"), "utf8"), original);
    assert.equal(await readFile(join(target, "profile/storage/a.bin"), "utf8"), "asset");
    assert.equal(await readFile(join(target, "profile/projects/output.txt"), "utf8"), "archived");
    assert.equal(await readFile(join(target, "profile/backups/imported-database.json"), "utf8"), original);
    await assert.rejects(initializeProfile(target, { encrypt: protect }), /已经存在/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid source credentials and active jobs cannot produce a usable profile", () => {
  const data = snapshot(); data.runs.push({ status: "running" });
  assert.throws(() => validateSnapshot(data, "key"), /未完成任务/);
  data.runs = [{ status: "failed", revisionGraph: { encryptedSecret: encryptSecret("old", "wrong-key") } }];
  assert.throws(() => validateSnapshot(data, "key"), /无法解密/);
  assert.throws(() => within("C:/data", "../secret"), /越界/);
});

test("missing assets leave original intact and do not activate partial migration", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-missing-"));
  try {
    const source = join(root, "source"); await mkdir(join(source, "data"), { recursive: true });
    const data = snapshot(); data.assets.push({ id: "missing", size: 4, storageKey: "missing.bin" });
    await writeFile(join(source, "data/super-canvas.json"), JSON.stringify(data));
    await assert.rejects(initializeProfile(join(root, "target"), { source: await discoverSource(source), encrypt: protect, ensureStopped: async () => {} }), /素材缺失/);
    await assert.rejects(stat(join(root, "target/profile")), { code: "ENOENT" });
    assert.deepEqual(await readdir(join(root, "target")), []);
    assert.equal(JSON.parse(await readFile(join(source, "data/super-canvas.json"))).assets.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed encryption removes temporary migration files and allows retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-encryption-failure-"));
  try {
    await assert.rejects(initializeProfile(root, { encrypt: () => { throw new Error("encryption failed"); } }), /encryption failed/);
    assert.deepEqual(await readdir(root), []);
    await initializeProfile(root, { encrypt: protect });
    assert.equal(typeof (await loadProfile(root, decrypt)).masterKey, "string");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("profile secrets survive reload and decryption failure never resets them", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-secrets-"));
  try {
    const created = await initializeProfile(root, { encrypt: protect });
    assert.equal((await loadProfile(root, decrypt)).masterKey, created.masterKey);
    const bytes = await readFile(join(root, "profile/secrets.bin"));
    await assert.rejects(loadProfile(root, () => { throw new Error("DPAPI unavailable"); }), /不会自动重置/);
    assert.deepEqual(await readFile(join(root, "profile/secrets.bin")), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a source write during migration prevents activation of a stale snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-race-"));
  try {
    const source = join(root, "source"); await mkdir(join(source, "data"), { recursive: true });
    const path = join(source, "data/super-canvas.json");
    await writeFile(path, JSON.stringify(snapshot()));
    let probes = 0;
    await assert.rejects(initializeProfile(join(root, "target"), {
      source: await discoverSource(source), encrypt: protect,
      ensureStopped: async () => { if (++probes === 2) await writeFile(path, JSON.stringify({ ...snapshot(), changed: true })); },
    }), /数据发生变化/);
    await assert.rejects(stat(join(root, "target/profile")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("old managed installations locate project archives inside their active release", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-installed-"));
  try {
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data/super-canvas.json"), JSON.stringify(snapshot()));
    const release = join(root, "releases/v0.2.20");
    await mkdir(join(release, "apps/web/项目"), { recursive: true });
    await writeFile(join(root, "active-release.txt"), release);
    assert.equal((await discoverSource(root)).projects, join(release, "apps/web/项目"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runtime inherits only allowed environment and never publishes the old asset origin", () => {
  const env = backendEnvironment({ DATABASE_URL: "secret", NODE_OPTIONS: "--require evil.js", PUBLIC_BASE_URL: "https://old", SystemRoot: "C:/Windows" }, "C:/Data", 34567, "session", { masterKey: "key", network: { PUBLIC_BASE_URL: "https://old", HTTPS_PROXY: "http://proxy", ARTIFACT_HTTP_PROXY: "http://downloads" } });
  assert.equal(env.DATABASE_URL, undefined); assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.PUBLIC_BASE_URL, undefined);
  assert.equal(env.HOSTNAME, "127.0.0.1"); assert.equal(env.HTTPS_PROXY, "http://proxy");
  assert.equal(env.ARTIFACT_HTTP_PROXY, "http://downloads");
  assert.equal(isAppUrl("http://127.0.0.1:34567/api/assets", "http://127.0.0.1:34567"), true);
  assert.equal(isAppUrl("http://127.0.0.1:34568", "http://127.0.0.1:34567"), false);
  assert.equal(externalUrl("file:///C:/Windows/notepad.exe"), null);
  assert.equal(externalUrl("https://user:password@example.com"), null);
  assert.deepEqual(parseEnvironment('\uFEFFMASTER_KEY="some-key"\n# comment\nPORT=3210'), { MASTER_KEY: "some-key", PORT: "3210" });
});

async function storageFixture(root) {
  const sourceRoot = join(root, "source"), database = join(sourceRoot, "data/super-canvas.json");
  const repository = new FileRepository(database);
  const supplier = await repository.saveSupplier({ id: "supplier", name: "Fixture", supplierKey: "fixture",
    siteUrl: "https://fixture.invalid", apiUrl: "https://fixture.invalid/v1", kind: "newapi", scanStatus: "live", catalog: { groups: [] } });
  const connection = await repository.saveConnection({ id: "connection", provider: "openai", name: "Fixture",
    encryptedSecret: encryptSecret("fictional-api-key", "local-development-master-key"), config: { supplierId: supplier.id, baseUrl: supplier.apiUrl } });
  await repository.updateCatalogPipelineState({ identity: catalogObservationIdentity(supplier, [connection]), expectedMode: "daily",
    state: [{ key: "queue", value: { status: "deferred", due: "2099-01-01T00:00:00Z" } }] });
  await repository.setApplicationSetting("supplier-catalog-pipeline-notice-cursors:v1", { "supplier/changes": 4 });
  const firstRecord = await repository.saveSupplierVerification({ id: supplier.id, schemaVersion: 1, revision: 0, sourceId: "fixture-source",
    policyVersion: 2, limit: 0, used: 0, round: 1, paused: true, pauseReason: "safety", createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z",
    cases: [], evidence: [], skipped: [], originalResponse: { requestId: "original-fictional-request", payload: "未截断的原始正文".repeat(2000) } }, 0);
  await repository.saveSupplierVerification({ ...firstRecord, originalResponse: { ...firstRecord.originalResponse, extra: "second revision" } }, firstRecord.revision);
  await repository.flush();
  return { source: await discoverSource(sourceRoot), database, supplier, expected: repository.exportSnapshot() };
}

async function treeHashes(root) {
  const entries = [];
  const walk = async directory => {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const target = join(directory, file.name);
      if (file.isDirectory()) await walk(target);
      else entries.push([target.slice(root.length), createHash("sha256").update(await readFile(target)).digest("hex")]);
    }
  };
  await walk(root); return entries.sort(([left], [right]) => left.localeCompare(right));
}

test("new storage import preserves cold-open state, complete evidence history and a cold-openable backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-sidecar-complete-"));
  try {
    const fixture = await storageFixture(root), target = join(root, "target");
    const original = await readFile(fixture.database), sourceRoots = databaseSidecarRoots(fixture.database);
    const before = await Promise.all(sourceRoots.map(treeHashes));
    await initializeProfile(target, { source: fixture.source, encrypt: protect, ensureStopped: async () => {} });
    const current = join(target, "profile/data/super-canvas.json"), backup = join(target, "profile/backups/imported-database.json");
    assert.deepEqual(new FileRepository(current).exportSnapshot(), fixture.expected);
    assert.deepEqual(new FileRepository(backup).exportSnapshot(), fixture.expected);
    assert.deepEqual(await readFile(fixture.database), original);
    assert.deepEqual(await Promise.all(sourceRoots.map(treeHashes)), before);
    assert.deepEqual(await Promise.all(databaseSidecarRoots(current).map(treeHashes)), before);
    assert.deepEqual(await Promise.all(databaseSidecarRoots(backup).map(treeHashes)), before);
    assert.equal((await readdir(sourceRoots[1])).length, 2, "both historical immutable blobs remain");
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const kind of ["missing-state", "corrupt-state", "changed-state", "missing-evidence", "corrupt-evidence", "changed-evidence"]) {
  test(`${kind} prevents profile activation and leaves the selected source intact`, async () => {
    const root = await mkdtemp(join(tmpdir(), `canvas-${kind}-`));
    try {
      const fixture = await storageFixture(root), target = join(root, "target"), [pipeline, evidence] = databaseSidecarRoots(fixture.database);
      const main = JSON.parse(await readFile(fixture.database, "utf8"));
      const file = kind.endsWith("state")
        ? join(pipeline, `${createHash("sha256").update("supplierCatalogPipeline:supplier").digest("hex")}.json`)
        : join(evidence, `${main.applicationSettings["supplierVerificationEvidenceStorage:v1"].entries.supplier.sha256}.json`);
      if (kind.startsWith("missing")) await unlink(file);
      else if (kind.startsWith("changed")) {
        const changed = JSON.parse(await readFile(file, "utf8"));
        if (kind.endsWith("state")) changed.committed.value.entries.queue.status = "tampered";
        else changed.originalResponse.requestId = "different-request";
        await writeFile(file, JSON.stringify(changed), "utf8");
      } else await writeFile(file, "{corrupt-json", "utf8");
      const original = await readFile(fixture.database), before = await Promise.all([pipeline, evidence].map(treeHashes));
      await assert.rejects(initializeProfile(target, { source: fixture.source, encrypt: protect, ensureStopped: async () => {} }), /独立状态或核验证据/);
      await assert.rejects(stat(join(target, "profile")), { code: "ENOENT" });
      assert.deepEqual(await readdir(target), []);
      assert.deepEqual(await readFile(fixture.database), original);
      assert.deepEqual(await Promise.all([pipeline, evidence].map(treeHashes)), before);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("import reads a main-committed prepared state without finalizing or modifying the source", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-sidecar-prepared-"));
  try {
    const fixture = await storageFixture(root), pipeline = databaseSidecarRoots(fixture.database)[0];
    const file = join(pipeline, `${createHash("sha256").update("supplierCatalogPipeline:supplier").digest("hex")}.json`);
    const document = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ schemaVersion: 1, key: document.key, prepared: document.committed }), "utf8");
    const original = await readFile(file), target = join(root, "target");
    await initializeProfile(target, { source: fixture.source, encrypt: protect, ensureStopped: async () => {} });
    assert.deepEqual(new FileRepository(join(target, "profile/data/super-canvas.json")).exportSnapshot(), fixture.expected);
    assert.deepEqual(new FileRepository(join(target, "profile/backups/imported-database.json")).exportSnapshot(), fixture.expected);
    assert.deepEqual(await readFile(file), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("sidecar source changes with identical size and mtime are rejected by the final content hash after the stopped check", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-sidecar-race-"));
  try {
    const fixture = await storageFixture(root), target = join(root, "target"), pipeline = databaseSidecarRoots(fixture.database)[0];
    const file = join(pipeline, `${createHash("sha256").update("supplierCatalogPipeline:supplier").digest("hex")}.json`);
    // Fix representable integer seconds so the test changes content only.
    await utimes(file, new Date("2026-10-17T00:00:00Z"), new Date("2026-10-17T00:00:00Z"));
    const info = await stat(file), original = await readFile(file, "utf8"); let probes = 0;
    await assert.rejects(initializeProfile(target, { source: fixture.source, encrypt: protect, ensureStopped: async () => {
      if (++probes !== 2) return;
      const changed = original.replace("deferred", "requeued");
      assert.notEqual(changed, original); assert.equal(Buffer.byteLength(changed), Buffer.byteLength(original));
      await writeFile(file, changed, "utf8"); await utimes(file, info.atime, info.mtime);
    } }), /数据发生变化/);
    const after = await stat(file); assert.equal(after.size, info.size); assert.equal(after.mtimeMs, info.mtimeMs);
    assert.equal(probes, 2); await assert.rejects(stat(join(target, "profile")), { code: "ENOENT" });
    assert.deepEqual(await readdir(target), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const type of ["root", "child"]) {
  test(`an auxiliary ${type} symlink cannot be imported`, async t => {
    const root = await mkdtemp(join(tmpdir(), `canvas-sidecar-link-${type}-`));
    try {
      const fixture = await storageFixture(root), pipeline = databaseSidecarRoots(fixture.database)[0], target = join(root, "target");
      const linked = join(root, "unrelated"), original = await readFile(fixture.database);
      await mkdir(linked); await writeFile(join(linked, "history.bin"), "unrelated");
      try {
        if (type === "root") { await rm(pipeline, { recursive: true }); await symlink(linked, pipeline, process.platform === "win32" ? "junction" : "dir"); }
        else await symlink(linked, join(pipeline, "nested-link"), process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) { t.skip("symlinks unavailable in this environment"); return; }
        throw error;
      }
      await assert.rejects(initializeProfile(target, { source: fixture.source, encrypt: protect, ensureStopped: async () => {} }), /符号链接|独立状态或核验证据/);
      await assert.rejects(stat(join(target, "profile")), { code: "ENOENT" });
      assert.deepEqual(await readFile(fixture.database), original);
      assert.equal(await readFile(join(linked, "history.bin"), "utf8"), "unrelated");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

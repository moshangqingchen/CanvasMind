import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptSecret } from "@super-canvas/providers/credentials";
import { initializeProfile, loadProfile, discoverSource, parseEnvironment, validateSnapshot, within } from "../src/data.mjs";
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

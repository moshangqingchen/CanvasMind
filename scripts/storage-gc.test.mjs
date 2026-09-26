import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, access, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = fileURLToPath(new URL("./storage-gc.mjs", import.meta.url));
async function fixture(t) {
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, "supercanvas-gc-test-"));
  t.after(async () => {
    assert.equal(dirname(root), temporaryRoot);
    assert.ok(basename(root).startsWith("supercanvas-gc-test-"));
    await rm(root, { recursive: true, force: true });
  });
  const storage = join(root, "storage"), database = join(root, "database.json");
  await mkdir(storage);
  await writeFile(database, '\uFEFF{"assets":[{"id":"live","storageKey":"assets/live.png"}]}');
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, LOCAL_DATABASE_PATH: database, LOCAL_STORAGE_PATH: storage },
  });
  return { root, storage, run };
}

test("GC preserves live media, defaults to dry-run, and removes empty orphan folders", async (t) => {
  const { storage, run } = await fixture(t);
  await mkdir(join(storage, "assets"));
  await mkdir(join(storage, "previews", "orphan"), { recursive: true });
  await writeFile(join(storage, "assets", "live.png"), "live");
  const orphan = join(storage, "previews", "orphan", "thumb.png");
  await writeFile(orphan, "orphan");
  const preview = run();
  assert.equal(preview.status, 0, preview.stderr);
  await access(orphan);
  const applied = run("--apply");
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(await readFile(join(storage, "assets", "live.png"), "utf8"), "live");
  await assert.rejects(access(join(storage, "previews", "orphan")), { code: "ENOENT" });
});

test("GC refuses a managed-root junction before deleting anything outside storage", async (t) => {
  const { root, storage, run } = await fixture(t);
  const external = join(root, "external");
  await mkdir(external);
  await writeFile(join(external, "important.png"), "keep");
  await symlink(external, join(storage, "assets"), process.platform === "win32" ? "junction" : "dir");
  const result = run("--apply");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic link/u);
  assert.equal(await readFile(join(external, "important.png"), "utf8"), "keep");
});

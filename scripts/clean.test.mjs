import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyCleanup, planCleanup, validateCleanupTarget } from "./clean.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "supercanvas-clean-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), tmpdir());
    assert.match(path.basename(root), /^supercanvas-clean-test-/u);
    await rm(root, { recursive: true, force: true });
  });
  const put = async (name) => {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "keep or regenerate");
  };
  return { root, put };
}

test("normal cleanup removes stale builds while keeping the desktop ready to start and all user data", async (t) => {
  const { root, put } = await fixture(t);
  const removed = [
    "apps/desktop/renderer/.next-old/cache.bin",
    "apps/desktop/renderer/test-results-run/test.png",
    ".codex-temp/deploy-web-test-2/.next/cache.bin",
  ];
  const preserved = [
    "apps/desktop/renderer/.next-desktop/server.js",
    "apps/desktop/stage/node.exe",
    "apps/desktop/dist/main.cjs",
    "packages/core/dist/index.js",
    "apps/desktop/renderer/data/super-canvas.json",
    "apps/desktop/renderer/storage/original.jpg",
    ".codex-temp/deploy-web-test-2/data/super-canvas.json",
    ".codex-temp/deploy-web-test-2/storage/original.jpg",
    ".codex-temp/paid-reference/result.png",
    "项目/archive/original.jpg",
    "backups/database.json",
    "apps/desktop/release/SuperCanvas-Setup-0.2.22-x64.exe",
    "apps/installed-App/dist/main.js",
  ];
  for (const name of [...removed, ...preserved]) await put(name);
  const plan = await planCleanup(root);
  assert.equal(plan.length, 3);
  for (const name of removed) assert.ok(await readFile(path.join(root, name))); // planning is read-only
  await applyCleanup(root, plan);
  for (const name of removed)
    await assert.rejects(lstat(path.join(root, name)), { code: "ENOENT" });
  for (const name of preserved)
    assert.ok(await readFile(path.join(root, name)));
});

test("deep cleanup is limited to source workspaces, never installed app copies", async (t) => {
  const { root, put } = await fixture(t);
  await put("apps/desktop/stage/runtime.bin");
  await put("apps/desktop/renderer/.next-desktop/server.js");
  await put("packages/core/dist/index.js");
  await put("node_modules/dependency/index.js");
  await put("apps/installed-App/node_modules/runtime/index.js");
  await put("apps/installed-App/dist/main.js");
  const plan = await planCleanup(root, { deep: true });
  assert.ok(plan.some((entry) => entry.path === "apps/desktop/stage"));
  await applyCleanup(root, plan);
  assert.ok(await readFile(path.join(root, "apps/installed-App/dist/main.js")));
  assert.ok(
    await readFile(
      path.join(root, "apps/installed-App/node_modules/runtime/index.js"),
    ),
  );
});

test("normal cleanup includes historical UI test outputs while preserving unrelated hidden folders", async (t) => {
  const { root, put } = await fixture(t);
  const removed = [
    "apps/desktop/renderer/.ui-regression-results/.last-run.json",
    "apps/desktop/renderer/.ui-image-design-results/test/screenshot.png",
    "apps/desktop/renderer/.ui-library-scroll-results/report.txt",
  ];
  const preserved = [
    "apps/desktop/renderer/.ui-assets/original.png",
    "apps/desktop/renderer/.ui-regression-results-backup/report.txt",
    "apps/installed-App/.ui-regression-results/report.txt",
  ];
  for (const name of [...removed, ...preserved]) await put(name);
  const plan = await planCleanup(root);
  assert.deepEqual(
    plan.map((entry) => entry.path),
    [
      "apps/desktop/renderer/.ui-image-design-results",
      "apps/desktop/renderer/.ui-library-scroll-results",
      "apps/desktop/renderer/.ui-regression-results",
    ],
  );
  await applyCleanup(root, plan);
  for (const name of removed)
    await assert.rejects(lstat(path.join(root, name)), { code: "ENOENT" });
  for (const name of preserved)
    assert.ok(await readFile(path.join(root, name)));
});

test("rejects workspace root, outside paths and non-generated paths in supplied plans", async (t) => {
  const { root, put } = await fixture(t);
  await put("apps/desktop/renderer/data/super-canvas.json");
  await assert.rejects(validateCleanupTarget(root, "."), /escapes/u);
  await assert.rejects(validateCleanupTarget(root, "../outside"), /escapes/u);
  await assert.rejects(
    applyCleanup(root, [{ path: "apps/desktop/renderer/data" }]),
    /Not a generated/u,
  );
  assert.ok(await readFile(path.join(root, "apps/desktop/renderer/data/super-canvas.json")));
});

test("rejects linked ancestors and never follows links inside generated output", async (t) => {
  const { root, put } = await fixture(t);
  await put("protected/sentinel.txt");
  await mkdir(path.join(root, "apps/desktop/renderer/.next-old"), { recursive: true });
  await symlink(
    path.join(root, "protected"),
    path.join(root, "apps/desktop/renderer/.next-old/link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await symlink(
    path.join(root, "protected"),
    path.join(root, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    validateCleanupTarget(root, "linked/sentinel.txt"),
    /symbolic link/u,
  );
  const plan = await planCleanup(root);
  assert.equal(plan[0].bytes, 0);
  await applyCleanup(root, plan);
  assert.ok(await readFile(path.join(root, "protected/sentinel.txt")));
});

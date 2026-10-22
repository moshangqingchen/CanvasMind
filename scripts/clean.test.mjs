import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, symlink, lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { applyCleanup, planCleanup, validateCleanupTarget } from "./clean.mjs";
import { createMaintenanceFixture } from "./test-fixture.mjs";

async function fixture(t) {
  const root = await createMaintenanceFixture(t, "supercanvas-clean-test-");
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

test("normal and deep cleanup preserve original audit evidence, generated media and complete backups", async (t) => {
  const { root, put } = await fixture(t);
  const preserved = [
    ".codex-logs/2026-10-17-supplier-live-image-check/original-response.private.json",
    ".codex-logs/2026-10-17-supplier-live-image-check/billing-before.json",
    ".codex-logs/2026-10-17-supplier-protocol-repair/installed-readonly-final-v2/readback-by-supplier.json",
    ".codex-logs/2026-10-17-supplier-protocol-repair/repair-local-final/plan.private.json",
    ".codex-logs/2026-10-17-supplier-protocol-repair/repair-local-final/applied.json",
    ".codex-logs/2026-10-17-supplier-protocol-repair/build.log",
    "output/imagegen/transparent-reference/original.png",
    "output/supplier-recheck-20261017/c/sources.json",
    "backups/before-repair/profile/data/super-canvas.json",
    "backups/before-repair/profile/secrets.bin",
  ];
  for (const name of preserved) await put(name);
  await put("apps/desktop/renderer/.next-old/cache.bin");
  for (const deep of [false, true]) {
    const plan = await planCleanup(root, { deep });
    assert.ok(
      plan.every(
        (entry) =>
          !/^(?:\.codex-logs|output|backups)(?:\/|$)/u.test(entry.path),
      ),
    );
    await applyCleanup(root, plan);
    for (const name of preserved)
      assert.equal(
        await readFile(path.join(root, name), "utf8"),
        "keep or regenerate",
      );
    for (const forbidden of [
      ".codex-logs",
      ".codex-logs/2026-10-17-supplier-protocol-repair",
      "output/imagegen",
      "backups",
    ])
      await assert.rejects(
        applyCleanup(root, [{ path: forbidden }]),
        /Not a generated/u,
      );
  }
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
  assert.ok(
    await readFile(
      path.join(root, "apps/desktop/renderer/data/super-canvas.json"),
    ),
  );
});

test("protects tracked files even when they match generated output names", async (t) => {
  const { root, put } = await fixture(t);
  const tracked = [
    "out/source.ts",
    "packages/core/dist/retained.js",
    "contract.log",
  ];
  for (const name of [...tracked, "apps/desktop/renderer/.next-old/cache.bin"])
    await put(name);
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  execFileSync("git", ["add", "--", ...tracked], {
    cwd: root,
    windowsHide: true,
  });
  const plan = await planCleanup(root, { deep: true });
  assert.deepEqual(
    plan.map((entry) => entry.path),
    ["apps/desktop/renderer/.next-old"],
  );
  await applyCleanup(root, plan);
  for (const name of tracked) assert.ok(await readFile(path.join(root, name)));
  await assert.rejects(
    applyCleanup(root, [{ path: "out" }]),
    /Not a generated/u,
  );
});

test("rechecks the Git index before applying an earlier cleanup plan", async (t) => {
  const { root, put } = await fixture(t);
  await put("out/retained.ts");
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  const plan = await planCleanup(root);
  assert.equal(plan[0].path, "out");
  execFileSync("git", ["add", "out/retained.ts"], {
    cwd: root,
    windowsHide: true,
  });
  await assert.rejects(applyCleanup(root, plan), /Not a generated/u);
  assert.ok(await readFile(path.join(root, "out/retained.ts")));
});

test("refuses cleanup when the checkout index cannot be read", async (t) => {
  const { root, put } = await fixture(t);
  await put("out/cache.bin");
  await writeFile(path.join(root, ".git"), "gitdir: missing-checkout\n");
  await assert.rejects(planCleanup(root));
  await assert.rejects(applyCleanup(root, [{ path: "out" }]));
  assert.ok(await readFile(path.join(root, "out/cache.bin")));
});

test(
  "matches tracked paths without case sensitivity on Windows",
  { skip: process.platform !== "win32" },
  async (t) => {
    const { root, put } = await fixture(t);
    await put(".next-cache/source.ts");
    execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
    const object = execFileSync(
      "git",
      ["hash-object", "-w", ".next-cache/source.ts"],
      { cwd: root, windowsHide: true, encoding: "utf8" },
    ).trim();
    execFileSync(
      "git",
      [
        "update-index",
        "--add",
        "--cacheinfo",
        "100644",
        object,
        ".next-CACHE/source.ts",
      ],
      { cwd: root, windowsHide: true },
    );
    assert.deepEqual(await planCleanup(root), []);
    await assert.rejects(
      applyCleanup(root, [{ path: ".next-cache" }]),
      /Not a generated/u,
    );
    assert.ok(await readFile(path.join(root, ".next-cache/source.ts")));
  },
);

test("rejects linked ancestors and never follows links inside generated output", async (t) => {
  const { root, put } = await fixture(t);
  await put("protected/sentinel.txt");
  await mkdir(path.join(root, "apps/desktop/renderer/.next-old"), {
    recursive: true,
  });
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

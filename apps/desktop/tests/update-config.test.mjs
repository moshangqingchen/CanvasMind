import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { configureUpdates } from "../src/update-config.mjs";
const require = createRequire(import.meta.url);
const { NsisUpdater } = require("electron-updater");

test("missing packaged configuration recovers checks and the real updater download cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "supercanvas-update-config-"));
  try {
    const app = { version: "0.2.36", name: "SuperCanvas", isPackaged: true,
      appUpdateConfigPath: join(root, "missing/app-update.yml"), userDataPath: root, baseCachePath: root };
    const updater = new NsisUpdater(null, app);
    updater.logger = null;
    const path = await configureUpdates(updater, join(root, "missing"), join(root, "profile"));
    const config = JSON.parse(await readFile(path, "utf8"));
    assert.equal(config.repo, "CanvasMind");
    assert.equal(config.owner, "moshangqingchen");
    const helper = await updater.getOrCreateDownloadHelper();
    assert.ok(helper);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("packaged signing policy is retained", async () => {
  const root = await mkdtemp(join(tmpdir(), "supercanvas-update-config-"));
  try {
    await mkdir(join(root, "resources"));
    const configPath = join(root, "resources/app-update.yml");
    const original = "provider: github\npublisherName: Trusted Publisher\n";
    await writeFile(configPath, original);
    const fake = { setFeedURL(value) { this.feed = value; } };
    await configureUpdates(fake, join(root, "resources"), join(root, "profile"));
    assert.equal(fake.updateConfigPath, configPath);
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

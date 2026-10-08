import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { DesktopUpdater } from "../src/updater.mjs";

test("updates require separate download and apply actions and expose failure without exiting", async () => {
  const fake = new EventEmitter(); let downloaded = 0, applied = 0;
  fake.checkForUpdates = async () => { fake.emit("checking-for-update"); fake.emit("update-available", { version: "0.2.22" }); };
  fake.downloadUpdate = async () => { downloaded++; fake.emit("download-progress", { transferred: 5, total: 10 }); fake.emit("update-downloaded", { version: "0.2.22" }); };
  const controller = new DesktopUpdater(fake, "0.2.21", { apply: async () => { applied++; } });
  assert.equal(fake.autoDownload, false); assert.equal(fake.autoInstallOnAppQuit, false);
  assert.equal(fake.fullChangelog, true);
  await controller.action("check"); assert.equal(controller.snapshot().phase, "available"); assert.equal(downloaded, 0);
  await assert.rejects(controller.action("apply"), /尚未下载/);
  await controller.action("download"); assert.equal(controller.snapshot().phase, "ready"); assert.equal(applied, 0);
  await controller.action("apply"); assert.equal(applied, 1);
  fake.emit("error", new Error("offline")); assert.equal(controller.snapshot().phase, "failed"); assert.equal(applied, 1);
  await assert.rejects(controller.action("execute-command"), /无效/);
});

test("deferred versions stay quiet and development builds cannot install updates", async () => {
  const fake = new EventEmitter(); fake.checkForUpdates = async () => fake.emit("update-available", { version: "2.0.0" });
  const controller = new DesktopUpdater(fake, "1.0.0");
  await controller.action("check"); await controller.action("defer"); await controller.action("check");
  assert.equal(controller.snapshot().phase, "idle");
  const development = new DesktopUpdater(new EventEmitter(), "1.0.0", { packaged: false });
  await assert.rejects(development.action("apply"), /开发模式/);
});

test("release notes are normalized for the update dialog and missing config errors are readable", async () => {
  const fake = new EventEmitter();
  fake.checkForUpdates = async () => fake.emit("update-available", {
    version: "0.2.36",
    releaseNotes: [{ note: "修复更新配置" }, { note: "展示 Release 说明" }],
  });
  const controller = new DesktopUpdater(fake, "0.2.21");
  await controller.action("check");
  assert.equal(controller.snapshot().latest.notes, "修复更新配置\n展示 Release 说明");
  fake.emit("error", new Error("ENOENT: no such file or directory, open app-update.yml"));
  assert.match(controller.snapshot().error, /完整安装包/);
});

test("failed checks never count as success and retries clear stale errors", async () => {
  const fake = new EventEmitter();
  fake.checkForUpdates = async () => { throw new Error("net::ERR_CONNECTION_RESET"); };
  const controller = new DesktopUpdater(fake, "0.2.37", { currentNotes: "本版修复" });
  await controller.action("check");
  assert.equal(controller.snapshot().phase, "failed");
  assert.equal(controller.snapshot().lastSuccessfulCheckAt, undefined);
  assert.equal(controller.snapshot().currentNotes, "本版修复");
  fake.checkForUpdates = async () => fake.emit("update-not-available", { version: "0.2.37" });
  await controller.action("check");
  assert.equal(controller.snapshot().error, undefined);
  assert.ok(controller.snapshot().lastSuccessfulCheckAt);
});

function downloadFixture(options = {}) {
  const fake = new EventEmitter();
  fake.checkForUpdates = async () => fake.emit("update-available", { version: "0.2.68" });
  fake.downloadUpdate = async () => {};
  const records = [];
  const controller = new DesktopUpdater(fake, "0.2.67", { diagnostic: record => records.push(record), ...options });
  return { fake, controller, records };
}

test("rates use actual differential transfer totals, invalid metrics stay unknown, and 100% still waits for verification", async t => {
  const { fake, controller } = downloadFixture(); t.after(() => controller.stopProgressTimer());
  await controller.action("check"); await controller.action("download");
  fake.emit("download-progress", { transferred: 5 * 1024 * 1024, total: 20 * 1024 * 1024, bytesPerSecond: 512 * 1024 });
  assert.equal(controller.snapshot().progress.estimatedRemainingSeconds, 30);
  fake.emit("download-progress", { transferred: Infinity, total: NaN, bytesPerSecond: -1 });
  assert.deepEqual(controller.snapshot().progress, { downloadedBytes: 0 });
  fake.emit("download-progress", { transferred: 20, total: 20, bytesPerSecond: 2 });
  assert.equal(controller.snapshot().progress.estimatedRemainingSeconds, 0);
  assert.equal(controller.snapshot().phase, "downloading");
  await assert.rejects(controller.action("apply"), /尚未下载/);
  fake.emit("update-downloaded", { version: "0.2.68" });
  assert.equal(controller.snapshot().phase, "ready"); assert.equal(controller.snapshot().progress, undefined);
});

test("a stopped transfer clears stale speed and ETA, then resumes with fresh metrics", async t => {
  let now = 10;
  const { fake, controller } = downloadFixture({ now: () => now }); t.after(() => controller.stopProgressTimer());
  await controller.action("check"); await controller.action("download");
  fake.emit("download-progress", { transferred: 10, total: 100, bytesPerSecond: 3 });
  now += 10_000; controller.refreshProgress();
  assert.equal(controller.snapshot().progress.bytesPerSecond, 0); assert.equal(controller.snapshot().progress.estimatedRemainingSeconds, undefined);
  fake.emit("download-progress", { transferred: 40, total: 100, bytesPerSecond: 10 });
  assert.equal(controller.snapshot().progress.estimatedRemainingSeconds, 6);
  fake.emit("error", Object.assign(new Error("net reset https://secret.example/?token=hidden"), { code: "ECONNRESET" }));
  assert.equal(controller.snapshot().progress, undefined);
  assert.equal(controller.snapshot().diagnostic.code, "ECONNRESET");
  await controller.action("download");
  assert.equal(controller.snapshot().diagnostic, undefined); assert.equal(controller.snapshot().progress, undefined);
  assert.equal(controller.snapshot().download.mode, "preparing");
});

test("observed differential fallback resets old transfer progress and records only classified diagnostics", async t => {
  const fake = new EventEmitter(); const records = [];
  fake.checkForUpdates = async () => fake.emit("update-available", { version: "0.2.68" });
  fake.httpExecutor = { download: async () => {} };
  fake.differentialDownloadInstaller = async () => {
    fake.emit("download-progress", { transferred: 5, total: 10, bytesPerSecond: 1 });
    fake.logger.error("Cannot download differentially, fallback to full download: HttpError: 403 Forbidden\nhttps://user:pass@example.invalid/?token=hidden");
    return true;
  };
  fake.downloadUpdate = async () => { await fake.differentialDownloadInstaller(); await fake.httpExecutor.download(); };
  const controller = new DesktopUpdater(fake, "0.2.67", { diagnostic: record => records.push(record) }); t.after(() => controller.stopProgressTimer());
  await controller.action("check"); await controller.action("download"); await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.snapshot().download.mode, "full"); assert.equal(controller.snapshot().download.fallback, true);
  assert.equal(controller.snapshot().progress, undefined);
  assert.equal(controller.snapshot().diagnostic.statusCode, 403);
  assert.equal(records.filter(record => record.event === "fallback").length, 1);
  assert.doesNotMatch(JSON.stringify(records), /user:pass|https:|token=|hidden/);
  fake.emit("download-progress", { transferred: 1, total: 100, bytesPerSecond: 10 });
  assert.equal(controller.snapshot().progress.estimatedRemainingSeconds, 10);
});

test("verified cache completion requires observed transport hooks and notification/log failures never stop the updater", async () => {
  for (const observed of [true, false]) {
    const fake = new EventEmitter();
    fake.checkForUpdates = async () => fake.emit("update-available", { version: "0.2.68" });
    if (observed) { fake.httpExecutor = { download: async () => {} }; fake.differentialDownloadInstaller = async () => false; }
    fake.downloadUpdate = async () => fake.emit("update-downloaded", { version: "0.2.68" });
    const controller = new DesktopUpdater(fake, "0.2.67", { diagnostic: () => Promise.reject(new Error("disk unavailable")), changed() { throw new Error("renderer unavailable"); } });
    await controller.action("check"); await controller.action("download");
    assert.equal(controller.snapshot().phase, "ready");
    assert.equal(controller.snapshot().download.mode, observed ? "cached" : "preparing");
  }
  await new Promise(resolve => setImmediate(resolve));
});

test("failure events and Promise rejection retain the operation stage without duplicate records, including retries", async () => {
  const records = [], fake = new EventEmitter();
  const error = Object.assign(new Error("synthetic network failure"), { code: "ECONNRESET" });
  fake.checkForUpdates = async () => { fake.emit("error", error); throw error; };
  fake.downloadUpdate = async () => { fake.emit("error", error); throw error; };
  const controller = new DesktopUpdater(fake, "0.2.67", { diagnostic: record => records.push(record) });
  for (let attempt = 1; attempt <= 2; attempt++) {
    await controller.action("check");
    assert.equal(controller.snapshot().diagnostic.stage, "check");
    assert.equal(records.filter(record => record.event === "error").length, attempt);
  }
  fake.emit("update-available", { version: "0.2.68" });
  await controller.action("download"); await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.snapshot().diagnostic.stage, "download");
  assert.equal(records.filter(record => record.event === "error").length, 3);
  for (const phase of ["waiting_for_idle", "applying"]) {
    controller.patch({ phase });
    fake.emit("error", error);
    assert.equal(controller.snapshot().diagnostic.stage, "apply");
  }
  assert.equal(records.filter(record => record.event === "error").length, 5);
});

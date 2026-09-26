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

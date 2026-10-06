import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
const requestExit = source.slice(source.indexOf("async function requestExit("), source.indexOf("\nif (locked)"));

function fixture() {
  const calls = [];
  const context = {
    waitingExit: false, quitting: false, backend: undefined, applyUpdate: false,
    exitTimer: 1, updateTimer: 2, clearInterval: timer => calls.push(["clear", timer]),
    rendererRecovery: { stop: () => calls.push(["recovery-stop"]) },
    stopDevelopmentWatchers: async () => calls.push(["watchers-stop"]),
    updater: { patch: value => calls.push(["phase", value.phase]) },
    electronUpdater: { autoUpdater: { quitAndInstall: (...args) => calls.push(["install", ...args]) } },
    app: { quit: () => calls.push(["quit"]) },
    runtimeRequest: () => { throw new Error("A stopped backend cannot be drained"); },
    prepareRenderer: () => { throw new Error("A stopped backend cannot save the renderer"); },
  };
  vm.runInNewContext(requestExit, context);
  return { context, calls };
}

test("a downloaded update still starts its installer after the local service has stopped", async () => {
  const { context, calls } = fixture();
  await context.requestExit(true);
  assert.equal(context.quitting, true);
  assert.equal(context.applyUpdate, true);
  assert.deepEqual(calls, [["clear", 1], ["clear", 2], ["recovery-stop"], ["watchers-stop"], ["phase", "applying"], ["install", false, true]]);
});

test("ordinary exit without a backend never installs an update", async () => {
  const { context, calls } = fixture();
  await context.requestExit();
  assert.equal(context.quitting, true);
  assert.equal(context.applyUpdate, false);
  assert.deepEqual(calls.at(-1), ["quit"]);
  assert.equal(calls.some(call => call[0] === "install"), false);
});

test("repeated apply requests cannot run two installers while shutdown cleanup is pending", async () => {
  const { context, calls } = fixture();
  let release;
  context.stopDevelopmentWatchers = () => new Promise(resolve => { release = resolve; });
  const first = context.requestExit(true);
  await context.requestExit(true);
  assert.equal(calls.some(call => call[0] === "install"), false);
  release();
  await first;
  assert.equal(calls.filter(call => call[0] === "install").length, 1);
  assert.equal(calls.some(call => call[0] === "quit"), false);
});

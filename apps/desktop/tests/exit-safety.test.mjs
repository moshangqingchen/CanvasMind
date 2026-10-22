import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { exitActivityIsIdle, exitWaitPresentation } from "../src/exit-policy.mjs";

const source = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
const exitFunctions = source.slice(source.indexOf("function readExitActivity("), source.indexOf("\nif (locked)"));
const idle = { draining: true, activeRuns: 0, activeVerifications: 0, activeWrites: 0 };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(read = async () => idle) {
  const calls = [], polls = new Map();
  let nextTimer = 10;
  const context = {
    waitingExit: false, quitting: false, backend: {}, applyUpdate: false, intentionalStop: false,
    cancellingExit: undefined, exitLifecycle: Promise.resolve(), exitEpoch: 0,
    exitTimer: undefined, updateTimer: 2,
    clearInterval: timer => { calls.push(["clear", timer]); polls.delete(timer); },
    setInterval: callback => { const id = nextTimer++; polls.set(id, callback); return id; },
    exitActivityIsIdle, exitWaitPresentation,
    exitProgress: { progress: (phase, install, activity) => calls.push(["progress", phase, install, activity]),
      event: event => calls.push(["event", event]), error: message => calls.push(["error", message]) },
    rendererRecovery: { stop: () => calls.push(["recovery-stop"]), resume: () => calls.push(["recovery-resume"]) },
    prepareRenderer: async () => {}, referenceChannel: undefined, development: true,
    stopOwnedChild: async () => calls.push(["child-stop"]), stopDevelopmentWatchers: async () => {},
    window: { isDestroyed: () => false, destroy: () => calls.push(["destroy"]) },
    updater: { patch: value => calls.push(["phase", value.phase]) },
    electronUpdater: { autoUpdater: { quitAndInstall: () => calls.push(["install"]) } },
    app: { quit: () => calls.push(["quit"]) },
    dialog: { showMessageBox: async (_window, options) => { calls.push(["dialog", options.type]); return { response: 0 }; } },
    send: (channel, value) => calls.push(["send", channel, value]), show: () => {}, redact: String,
    runtimeRequest: async (path, body) => { calls.push(["request", body]); return read(body); },
  };
  vm.runInNewContext(exitFunctions, context);
  return { context, calls, polls, poll: () => {
    assert.equal(polls.size, 1, "exactly one idle monitor should be running");
    return [...polls.values()][0]();
  } };
}

test("the last snapshot must confirm a drained backend and complete, consistent counts", () => {
  assert.equal(exitActivityIsIdle(idle), true);
  assert.equal(exitActivityIsIdle({ ...idle, activeRuns: 1, activeVerifications: 1 }), false);
  assert.equal(exitActivityIsIdle({ ...idle, activeWrites: 1 }), false);
  for (const activity of [undefined, null, {}, { ...idle, draining: false }, { ...idle, draining: undefined },
    { ...idle, activeRuns: undefined }, { ...idle, activeWrites: null }, { ...idle, activeVerifications: undefined },
    { ...idle, activeRuns: "0" }, { ...idle, activeWrites: -1 }, { ...idle, activeRuns: 0.5 },
    { ...idle, activeRuns: NaN }, { ...idle, activeRuns: Infinity }, { ...idle, activeVerifications: 1 }]) {
    assert.throws(() => exitActivityIsIdle(activity), /无法确认/);
  }
});

test("work appearing in either final read keeps the app and its monitor alive until confirmed idle", async () => {
  const snapshots = [idle, { ...idle, activeRuns: 1 }, idle, { ...idle, activeWrites: 1 }, idle, idle];
  const { context, calls, polls, poll } = fixture(async () => snapshots.shift());
  await context.requestExit();
  assert.equal(context.quitting, false);
  assert.equal(calls.some(call => call[0] === "destroy" || (call[0] === "clear" && call[1] === 2)), false);
  assert.equal(polls.size, 1);
  await poll();
  assert.equal(context.quitting, false);
  assert.equal(polls.size, 1);
  await poll();
  assert.equal(context.quitting, true);
  assert.equal(calls.filter(call => call[0] === "quit").length, 1);
  assert.equal(polls.size, 0);
  assert.equal(snapshots.length, 0);
});

for (const stage of ["initial", "final", "poll"]) {
  test(`unknown ${stage} activity cannot close or install and returns to the app`, async () => {
    const snapshots = stage === "initial" ? [{}] : stage === "final" ? [idle, {}] : [{ ...idle, activeWrites: 1 }, {}];
    const { context, calls, polls, poll } = fixture(async body => body?.draining === false ? idle : snapshots.shift());
    await context.requestExit(true);
    if (stage === "poll") await poll();
    assert.equal(context.quitting, false);
    assert.equal(context.waitingExit, false);
    assert.equal(polls.size, 0);
    assert.equal(calls.some(call => ["destroy", "child-stop", "quit", "install"].includes(call[0])), false);
    assert.equal(calls.some(call => call[0] === "dialog" && call[1] === "error"), true);
    assert.equal(calls.some(call => call[0] === "clear" && call[1] === 2), false);
    assert.equal(snapshots.length, 0);
  });
}

test("slow polling and final confirmation cannot overlap another poll", async () => {
  const firstRead = deferred(), lastRead = deferred();
  let reads = 0;
  const { context, calls, poll } = fixture(async body => {
    if (body) return { ...idle, activeRuns: 1 };
    return ++reads === 1 ? firstRead.promise : lastRead.promise;
  });
  await context.requestExit();
  const active = poll();
  await settle();
  await poll();
  assert.equal(reads, 1);
  firstRead.resolve(idle);
  await settle();
  await poll();
  assert.equal(reads, 2);
  assert.equal(context.quitting, false);
  lastRead.resolve(idle);
  await active;
  assert.equal(calls.filter(call => call[0] === "quit").length, 1);
});

test("cancel waits for an in-flight drain and blocks repeated exit until resume completes", async () => {
  const draining = deferred(), resuming = deferred();
  const { context, calls } = fixture(async body => body?.draining ? draining.promise : resuming.promise);
  const first = context.requestExit(true);
  await settle();
  const cancelled = context.cancelExit();
  await context.requestExit();
  await settle();
  assert.deepEqual(calls.filter(call => call[0] === "request").map(call => call[1]?.draining), [true]);
  draining.resolve(idle);
  await settle();
  assert.deepEqual(calls.filter(call => call[0] === "request").map(call => call[1]?.draining), [true, false]);
  await context.requestExit();
  assert.equal(context.waitingExit, false);
  assert.equal(context.quitting, false);
  resuming.resolve({ ...idle, draining: false });
  await Promise.all([first, cancelled]);
  assert.equal(context.cancellingExit, undefined);
  assert.equal(context.applyUpdate, false);
  assert.equal(calls.some(call => ["destroy", "quit", "install"].includes(call[0])), false);
});

test("cancelling while the final read is pending discards its idle result", async () => {
  const finalRead = deferred();
  const { context, calls } = fixture(async body => body ? idle : finalRead.promise);
  const exit = context.requestExit();
  await settle();
  const cancel = context.cancelExit();
  finalRead.resolve(idle);
  await Promise.all([exit, cancel]);
  assert.equal(context.quitting, false);
  assert.equal(context.waitingExit, false);
  assert.equal(calls.some(call => ["destroy", "quit", "install"].includes(call[0])), false);
});

test("a queued request cannot change the lifecycle of a replacement backend", async () => {
  const gate = deferred();
  const { context, calls } = fixture();
  context.exitLifecycle = gate.promise;
  const request = context.readExitActivity({ draining: false });
  context.backend = {};
  gate.resolve();
  await assert.rejects(request, /本地服务已变化/);
  assert.equal(calls.some(call => call[0] === "request"), false);
});

test("cancel after closing starts cannot invalidate the committed shutdown", async () => {
  const { context, calls } = fixture();
  await context.requestExit(true);
  const epoch = context.exitEpoch;
  await context.cancelExit();
  assert.equal(context.exitEpoch, epoch);
  assert.equal(context.applyUpdate, true);
  assert.equal(calls.filter(call => call[0] === "install").length, 1);
  assert.equal(calls.some(call => call[0] === "request" && call[1]?.draining === false), false);
});

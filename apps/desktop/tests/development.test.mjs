import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { backendEnvironment, isAppRequestUrl } from "../src/policy.mjs";
import { developmentCommands, stopOwnedChild } from "../src/development.mjs";

test("development only authenticates its own HMR socket and keeps HTTP origin rules", () => {
  const origin = "http://127.0.0.1:43210";
  assert.equal(isAppRequestUrl(`${origin}/api/assets`, origin, false), true);
  assert.equal(isAppRequestUrl("ws://127.0.0.1:43210/_next/hmr?id=fixture", origin, true), true);
  for (const [url, development] of [
    ["ws://127.0.0.1:43210/_next/hmr", false],
    ["ws://127.0.0.1:43211/_next/hmr", true],
    ["ws://localhost:43210/_next/hmr", true],
    ["ws://127.0.0.1:43210/api/assets", true],
    ["ws://secret@127.0.0.1:43210/_next/hmr", true],
    ["http://127.0.0.1:43211/api/assets", true],
  ]) assert.equal(isAppRequestUrl(url, origin, development), false);
});

test("desktop forwards only bounded runtime concurrency settings", () => {
  const make = (parent) => backendEnvironment(parent, resolve("fixture"), 43210, "fixture-token", { masterKey: "fixture-master" });
  const valid = make({ RUNTIME_RUN_CONCURRENCY: "1", RUNTIME_GLOBAL_CONCURRENCY: "64", RUNTIME_PROVIDER_CONCURRENCY: "2", RUNTIME_CONNECTION_CONCURRENCY: "16" });
  assert.equal(valid.RUNTIME_RUN_CONCURRENCY, "1");
  assert.equal(valid.RUNTIME_GLOBAL_CONCURRENCY, "64");
  assert.equal(valid.RUNTIME_CONNECTION_CONCURRENCY, "16");
  for (const value of ["0", "65", "-1", "1.5", "2e1", " 2", "02", "Infinity"]) {
    assert.equal(make({ RUNTIME_GLOBAL_CONCURRENCY: value }).RUNTIME_GLOBAL_CONCURRENCY, undefined);
  }
  assert.equal(make({ NODE_OPTIONS: "--require secret.cjs", MASTER_KEY: "foreign" }).NODE_OPTIONS, undefined);
});

test("development starts source Next on loopback with the hook and watches every shared package", () => {
  const workspace = resolve("fixture-workspace");
  const hook = resolve("runtime-hook.cjs");
  const plan = developmentCommands(workspace, process.execPath, hook, 43210);
  assert.deepEqual(plan.server.args.slice(-4), ["--hostname", "127.0.0.1", "--port", "43210"]);
  assert.ok(plan.server.args.includes("dev"));
  assert.equal(plan.watchers.length, 6);
  for (const command of [plan.server, ...plan.watchers]) {
    assert.equal(command.executable, process.execPath);
    assert.deepEqual(command.args.slice(0, 2), ["--require", hook]);
    assert.equal(command.args.some((arg) => arg.includes("stage")), false);
  }
  assert.throws(() => developmentCommands(workspace, "node", hook, 43210), /absolute/);
});

test("owned development child and its fork exit when their parent disconnects", async () => {
  const hook = fileURLToPath(new URL("../src/runtime-hook.cjs", import.meta.url));
  const parentSource = `const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['--require', process.env.FIXTURE_HOOK, '-e', 'setInterval(() => {}, 1000)'], { env: process.env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    process.send({ pid: child.pid }); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["--require", hook, "-e", parentSource], { env: { ...process.env, FIXTURE_HOOK: hook, SUPERCANVAS_DESKTOP: "true", SUPERCANVAS_DESKTOP_DEV: "true", SUPERCANVAS_DESKTOP_TOKEN: "fixture" }, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  try {
    const [{ pid }] = await once(child, "message");
    await stopOwnedChild(child);
    assert.equal(child.exitCode, 0);
    const deadline = Date.now() + 5000;
    let alive = true;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); } catch { alive = false; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(alive, false, "forked worker must not survive the owned CLI parent");
  } finally { await stopOwnedChild(child); }
});

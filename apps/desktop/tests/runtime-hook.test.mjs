import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createConnection } from "node:net";
import { request as httpRequest } from "node:http";
import { createRequire } from "node:module";

const hookPath = fileURLToPath(new URL("../src/runtime-hook.cjs", import.meta.url));
const testHeaders = { "x-supercanvas-desktop-token": "isolated-test-session" };
const rendererRequire = createRequire(new URL("../renderer/package.json", import.meta.url));
const nextPipePath = rendererRequire.resolve("next/dist/server/pipe-readable.js");

async function startFixture(fixture) {
  const child = spawn(process.execPath, ["--require", hookPath, "-e", fixture], {
    env: { ...process.env, SUPERCANVAS_DESKTOP: "true", SUPERCANVAS_DESKTOP_TOKEN: "isolated-test-session" },
    stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true,
  });
  const [{ port }] = await once(child, "message");
  return { child, origin: `http://127.0.0.1:${port}` };
}

function startWrite(origin) {
  const request = httpRequest(`${origin}/write`, { method: "POST", headers: testHeaders });
  request.on("error", () => {});
  request.end();
  return request;
}

async function readState(origin) {
  return (await fetch(`${origin}/status`, { headers: testHeaders })).json();
}

test("disconnected async handler keeps writes counted until its delayed write actually completes", async () => {
  const { child, origin } = await startFixture(`
    const http = require('node:http'); let release; let persisted = 0;
    process.on('message', message => { if (message.type === 'release') release(); });
    const server = http.createServer(async (req, res) => {
      if (req.url === '/write') {
        res.once('close', () => process.send({ closed: true }));
        process.send({ started: true });
        await new Promise(resolve => { release = resolve; });
        persisted++;
        if (!res.destroyed) res.end('done');
        process.send({ completed: true });
        return;
      }
      res.end(JSON.stringify({ ...globalThis.__superCanvasDesktopLifecycle, persisted }));
    });
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  `);
  try {
    const started = once(child, "message");
    const request = startWrite(origin);
    assert.deepEqual((await started)[0], { started: true });
    const closed = once(child, "message");
    request.destroy();
    assert.deepEqual((await closed)[0], { closed: true });
    assert.deepEqual(await readState(origin), { draining: false, writes: 1, persisted: 0 });
    const completed = once(child, "message");
    child.send({ type: "release" });
    assert.deepEqual((await completed)[0], { completed: true });
    assert.deepEqual(await readState(origin), { draining: false, writes: 0, persisted: 1 });
  } finally { if (child.exitCode === null) child.kill(); }
});

test("real Next response pipe skips end after disconnect while the hook still protects delayed writes", async () => {
  const { child, origin } = await startFixture(`
    const http = require('node:http');
    const { pipeToNodeResponse } = require(${JSON.stringify(nextPipePath)});
    let release; let persisted = 0; let endCalls = 0;
    process.on('message', message => { if (message.type === 'release') release(); });
    const server = http.createServer(async (req, res) => {
      if (req.url === '/write') {
        const end = res.end;
        res.end = function (...args) { endCalls++; return end.apply(this, args); };
        res.once('close', () => process.send({ closed: true }));
        process.send({ started: true });
        await new Promise(resolve => { release = resolve; });
        persisted++;
        await pipeToNodeResponse(Response.json({ saved: true }).body, res);
        process.send({ completed: true }); return;
      }
      res.end(JSON.stringify({ ...globalThis.__superCanvasDesktopLifecycle, persisted, endCalls }));
    });
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  `);
  try {
    const started = once(child, "message");
    const request = startWrite(origin); await started;
    const closed = once(child, "message"); request.destroy(); await closed;
    assert.deepEqual(await readState(origin), { draining: false, writes: 1, persisted: 0, endCalls: 0 });
    const completed = once(child, "message"); child.send({ type: "release" }); await completed;
    assert.deepEqual(await readState(origin), { draining: false, writes: 0, persisted: 1, endCalls: 0 });
  } finally { if (child.exitCode === null) child.kill(); }
});

test("real Next streaming pipe abort returns without end and awaits handler cleanup before release", async () => {
  const { child, origin } = await startFixture(`
    const http = require('node:http');
    const { pipeToNodeResponse } = require(${JSON.stringify(nextPipePath)});
    let release; let persisted = 0; let endCalls = 0; let cancelled = false;
    process.on('message', message => { if (message.type === 'release') release(); });
    const server = http.createServer(async (req, res) => {
      if (req.url === '/write') {
        const end = res.end;
        res.end = function (...args) { endCalls++; return end.apply(this, args); };
        const body = new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode('started')); },
          cancel() { cancelled = true; },
        });
        await pipeToNodeResponse(body, res);
        process.send({ pipelineReturned: true });
        await new Promise(resolve => { release = resolve; });
        persisted++;
        process.send({ completed: true }); return;
      }
      res.end(JSON.stringify({ ...globalThis.__superCanvasDesktopLifecycle, persisted, endCalls, cancelled }));
    });
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  `);
  try {
    const abort = new AbortController();
    const response = await fetch(`${origin}/write`, { method: "POST", headers: testHeaders, signal: abort.signal });
    assert.equal(response.status, 200);
    const pipelineReturned = once(child, "message"); abort.abort(); await pipelineReturned;
    assert.deepEqual(await readState(origin), { draining: false, writes: 1, persisted: 0, endCalls: 0, cancelled: true });
    const completed = once(child, "message"); child.send({ type: "release" }); await completed;
    assert.deepEqual(await readState(origin), { draining: false, writes: 0, persisted: 1, endCalls: 0, cancelled: true });
  } finally { if (child.exitCode === null) child.kill(); }
});

test("disconnected callback handler stays fail-closed until it explicitly ends the response", async () => {
  const { child, origin } = await startFixture(`
    const http = require('node:http'); let held;
    process.on('message', message => { if (message.type === 'release') { held.end('done'); process.send({ completed: true }); } });
    const server = http.createServer((req, res) => {
      if (req.url === '/write') {
        held = res; res.once('close', () => process.send({ closed: true }));
        process.send({ started: true }); return;
      }
      res.end(JSON.stringify(globalThis.__superCanvasDesktopLifecycle));
    });
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  `);
  try {
    const started = once(child, "message");
    const request = startWrite(origin);
    await started;
    const closed = once(child, "message");
    request.destroy(); await closed;
    assert.equal((await readState(origin)).writes, 1);
    const completed = once(child, "message");
    child.send({ type: "release" }); await completed;
    assert.equal((await readState(origin)).writes, 0);
  } finally { if (child.exitCode === null) child.kill(); }
});

test("releasing an aborted HTTP request leaves an independent producer counted until its final write", async () => {
  const { child, origin } = await startFixture(`
    const http = require('node:http'); let release; let persisted = 0;
    process.on('message', message => { if (message.type === 'release') release(); });
    const server = http.createServer(async (req, res) => {
      const state = globalThis.__superCanvasDesktopLifecycle;
      if (req.url === '/write') {
        state.writes++;
        void (async () => {
          try { await new Promise(resolve => { release = resolve; }); persisted++; }
          finally { state.writes--; process.send({ completed: true }); }
        })();
        res.once('close', () => process.send({ closed: true }));
        process.send({ started: true });
        await new Promise(resolve => res.once('close', resolve));
        return;
      }
      res.end(JSON.stringify({ ...state, persisted }));
    });
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  `);
  try {
    const started = once(child, "message");
    const request = startWrite(origin); await started;
    assert.deepEqual(await readState(origin), { draining: false, writes: 2, persisted: 0 });
    const closed = once(child, "message"); request.destroy(); await closed;
    assert.deepEqual(await readState(origin), { draining: false, writes: 1, persisted: 0 });
    const completed = once(child, "message"); child.send({ type: "release" }); await completed;
    assert.deepEqual(await readState(origin), { draining: false, writes: 0, persisted: 1 });
  } finally { if (child.exitCode === null) child.kill(); }
});

test("normal async response finishes exactly once", async () => {
  const { child, origin } = await startFixture(`
    const http = require('node:http');
    const server = http.createServer({ keepAlive: true }, async (req, res) => {
      await Promise.resolve();
      res.end(req.url === '/write' ? 'done' : JSON.stringify(globalThis.__superCanvasDesktopLifecycle));
    });
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  `);
  try {
    assert.equal(await (await fetch(`${origin}/write`, { method: "POST", headers: testHeaders })).text(), "done");
    assert.deepEqual(await readState(origin), { draining: false, writes: 0 });
    assert.deepEqual(await readState(origin), { draining: false, writes: 0 });
  } finally { if (child.exitCode === null) child.kill(); }
});

test("native once, listener ordering and mutation remain intact and unknown listeners block abort release", async () => {
  const { child, origin } = await startFixture(`
    const http = require('node:http'); const calls = []; let release;
    process.on('message', message => { if (message.type === 'release') release(); });
    const later = () => { calls.push('later'); };
    const server = http.createServer(async function (req, res) {
      if (req.url === '/write') {
        calls.push(this === server ? 'handler' : 'wrong-this');
        server.removeListener('request', later);
        res.once('close', () => process.send({ closed: true }));
        process.send({ started: true });
        await new Promise(resolve => { release = resolve; });
        process.send({ completed: true }); return;
      }
      res.end(JSON.stringify({ ...globalThis.__superCanvasDesktopLifecycle, calls }));
    });
    server.once('request', () => calls.push('once'));
    server.on('request', later);
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  `);
  try {
    const started = once(child, "message");
    const request = startWrite(origin);
    await started;
    const closed = once(child, "message"); request.destroy(); await closed;
    const completed = once(child, "message"); child.send({ type: "release" }); await completed;
    const state = await readState(origin);
    assert.equal(state.writes, 1);
    assert.deepEqual(state.calls, ["handler", "once", "later"]);
    assert.deepEqual((await readState(origin)).calls, ["handler", "once", "later"]);
  } finally { if (child.exitCode === null) child.kill(); }
});

test("observing async listeners preserves native captureRejections", async () => {
  const { child, origin } = await startFixture(`
    const events = require('node:events'); events.captureRejections = true;
    const http = require('node:http');
    const server = http.createServer(async () => { throw new Error('isolated rejection'); });
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  `);
  try {
    const response = await fetch(`${origin}/write`, { method: "POST", headers: testHeaders });
    assert.equal(response.status, 500);
    assert.equal(await response.text(), "Internal Server Error");
    assert.equal(child.exitCode, null);
  } finally { if (child.exitCode === null) child.kill(); }
});

test("runtime gate counts in-flight writes, drains new requests, and requires its launch token", async () => {
  const fixture = `
    const http = require('node:http'); let held;
    const server = http.createServer((req, res) => {
      const state = globalThis.__superCanvasDesktopLifecycle;
      if (req.url === '/hold') { held = res; process.send({ held: true }); return; }
      if (req.url === '/api/desktop/lifecycle' && req.method === 'POST') state.draining = true;
      if (req.url === '/release') { held.end('done'); }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(state));
    });
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  `;
  const child = spawn(process.execPath, ["--require", fileURLToPath(new URL("../src/runtime-hook.cjs", import.meta.url)), "-e", fixture], {
    env: { ...process.env, SUPERCANVAS_DESKTOP: "true", SUPERCANVAS_DESKTOP_TOKEN: "isolated-test-session" }, stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true,
  });
  try {
    const [{ port }] = await once(child, "message");
    const origin = `http://127.0.0.1:${port}`;
    const headers = { "x-supercanvas-desktop-token": "isolated-test-session" };
    assert.equal((await fetch(`${origin}/status`)).status, 401);
    const holdStarted = once(child, "message");
    const pending = fetch(`${origin}/hold`, { method: "POST", headers });
    await holdStarted;
    assert.equal((await (await fetch(`${origin}/status`, { headers })).json()).writes, 1);
    await fetch(`${origin}/api/desktop/lifecycle`, { headers, method: "POST" });
    assert.equal((await fetch(`${origin}/new`, { headers, method: "POST" })).status, 503);
    await fetch(`${origin}/release`, { headers }); await pending;
    assert.equal((await (await fetch(`${origin}/status`, { headers })).json()).writes, 0);
    const closed = once(child, "exit"); child.send({ type: "shutdown" });
    assert.equal((await closed)[0], 0);
  } finally { if (child.exitCode === null) child.kill(); }
});

test("websocket upgrades require the launch token in development too", async () => {
  const fixture = `const http = require('node:http');
    const server = http.createServer((req, res) => res.end('ok'));
    server.on('upgrade', (req, socket) => socket.end('HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\n\\r\\n'));
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));`;
  const child = spawn(process.execPath, ["--require", fileURLToPath(new URL("../src/runtime-hook.cjs", import.meta.url)), "-e", fixture], {
    env: { ...process.env, SUPERCANVAS_DESKTOP: "true", SUPERCANVAS_DESKTOP_DEV: "true", SUPERCANVAS_DESKTOP_TOKEN: "isolated-ws-session" }, stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true,
  });
  try {
    const [{ port }] = await once(child, "message");
    const upgrade = (token) => new Promise((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      let result = "";
      socket.setTimeout(5000, () => socket.destroy(new Error("Upgrade timed out")));
      socket.on("error", reject);
      socket.on("data", (chunk) => { result += chunk; });
      socket.on("end", () => resolve(result));
      socket.on("connect", () => socket.write(`GET /_next/hmr HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${token ? `x-supercanvas-desktop-token: ${token}\r\n` : ""}\r\n`));
    });
    assert.match(await upgrade(), /^HTTP\/1\.1 401 /);
    assert.match(await upgrade("wrong"), /^HTTP\/1\.1 401 /);
    assert.match(await upgrade("isolated-ws-session"), /^HTTP\/1\.1 101 /);
    assert.equal((await fetch(`http://127.0.0.1:${port}/_next/hmr`)).status, 401);
  } finally { if (child.exitCode === null) child.kill(); }
});

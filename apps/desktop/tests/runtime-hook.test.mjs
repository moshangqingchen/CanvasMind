import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createConnection } from "node:net";

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

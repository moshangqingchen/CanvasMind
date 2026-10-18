import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { createLoopbackOriginFetch } from "../src/reference-origin-http.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fetchOrigin = createLoopbackOriginFetch({ origin, desktopToken: "test-desktop-token" });
  return { server, origin, fetchOrigin, url: `${origin}/api/assets/a/content`,
    async close() { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); } };
}

test("loopback transport preserves original bytes/MIME/ranges and isolates desktop authentication", async () => {
  const calls = [], bytes = Buffer.from([0, 1, 2, 255, 13, 10]);
  const f = await fixture((req, res) => {
    calls.push({ method: req.method, headers: req.headers });
    res.writeHead(req.headers.range ? 206 : 200, { "content-type": "image/png", "content-length": bytes.length,
      "content-range": "bytes 0-5/6", "accept-ranges": "bytes", "set-cookie": "private", "x-private": "private" });
    res.end(req.method === "HEAD" ? undefined : bytes);
  });
  try {
    const response = await f.fetchOrigin(f.url, { headers: { range: "bytes=0-5", cookie: "incoming", authorization: "incoming",
      "x-supercanvas-desktop-token": "untrusted", "accept-encoding": "gzip" } });
    assert.equal(response.status, 206);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("content-range"), "bytes 0-5/6");
    assert.equal(response.headers.get("connection"), "close");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("x-private"), null);
    assert.equal(calls[0].headers["x-supercanvas-desktop-token"], "test-desktop-token");
    assert.equal(calls[0].headers["accept-encoding"], "identity");
    assert.equal(calls[0].headers.connection, "close");
    assert.equal(calls[0].headers.cookie, undefined);
    assert.equal(calls[0].headers.authorization, undefined);
    const head = await f.fetchOrigin(f.url, { method: "HEAD" });
    assert.equal(head.body, null);
    assert.equal(head.headers.get("content-length"), String(bytes.length));
  } finally { await f.close(); }
});

test("loopback transport rejects arbitrary targets and never follows a redirect or accepts encoded wire bytes", async () => {
  let calls = 0, mode = "redirect";
  const f = await fixture((_req, res) => {
    calls++;
    if (mode === "redirect") res.writeHead(302, { location: "/api/management" });
    else res.writeHead(200, { "content-encoding": "gzip", "content-type": "image/png" });
    res.end("wire bytes");
  });
  try {
    for (const target of ["http://example.com/api/assets/a/content", f.origin + "/api/management", f.url + "?download=1",
      f.url + "#secret", f.url.replace("127.0.0.1", "localhost")])
      await assert.rejects(f.fetchOrigin(target), { code: "ERR_LOOPBACK_TARGET_INVALID" });
    await assert.rejects(f.fetchOrigin(f.url, { method: "POST", body: "x" }), { code: "ERR_LOOPBACK_TARGET_INVALID" });
    assert.equal(calls, 0);
    await assert.rejects(f.fetchOrigin(f.url), { code: "ERR_LOOPBACK_REDIRECT" });
    assert.equal(calls, 1);
    mode = "encoded";
    await assert.rejects(f.fetchOrigin(f.url), { code: "ERR_LOOPBACK_ENCODING" });
    assert.equal(calls, 2);
  } finally { await f.close(); }
});

test("loopback transport propagates truncation and remains available for the next complete request", async () => {
  let broken = true;
  const f = await fixture((_req, res) => {
    res.writeHead(200, { "content-length": "6", "content-type": "image/png" });
    if (broken) { res.write("abc"); setTimeout(() => res.destroy(), 15); }
    else res.end("abcdef");
  });
  try {
    const response = await f.fetchOrigin(f.url);
    await assert.rejects(response.arrayBuffer());
    broken = false;
    assert.equal(await (await f.fetchOrigin(f.url)).text(), "abcdef");
  } finally { await f.close(); }
});

test("loopback transport abort and Web body cancellation close their owned sockets", async () => {
  let closed = 0;
  const f = await fixture((_req, res) => {
    res.writeHead(200, { "content-length": "1000000" }); res.write("first");
    res.once("close", () => closed++);
  });
  try {
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(f.fetchOrigin(f.url, { signal: aborted.signal }));
    const controller = new AbortController();
    const response = await f.fetchOrigin(f.url, { signal: controller.signal });
    const reading = response.arrayBuffer(); controller.abort();
    await assert.rejects(reading);
    const cancelled = await f.fetchOrigin(f.url);
    await cancelled.body.cancel();
    const deadline = Date.now() + 1000;
    while (closed < 2 && Date.now() < deadline) await delay(5);
    assert.equal(closed, 2);
  } finally { await f.close(); }
});

test("loopback transport handles null-body statuses and a paced consumer beyond the server idle timeout", async () => {
  const bytes = Buffer.alloc(1024 * 1024, 173);
  let mode = "empty";
  const f = await fixture((_req, res) => {
    if (mode === "empty") { res.writeHead(204); res.end(); }
    else { res.writeHead(200, { "content-length": bytes.length, "content-type": "image/jpeg" }); res.end(bytes); }
  });
  f.server.keepAliveTimeout = 5;
  try {
    assert.equal((await f.fetchOrigin(f.url)).body, null);
    mode = "bytes";
    const reader = (await f.fetchOrigin(f.url)).body.getReader();
    const hash = createHash("sha256"); let size = 0;
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; hash.update(chunk.value); await delay(8); }
    assert.equal(size, bytes.length);
    assert.equal(hash.digest("hex"), createHash("sha256").update(bytes).digest("hex"));
  } finally { await f.close(); }
});

test("loopback transport factory is serializable with explicit builtin dependencies for main QA", async () => {
  const f = await fixture((_req, res) => res.end("original"));
  try {
    const factory = (0, eval)(`(${createLoopbackOriginFetch.toString()})`);
    const fetchOrigin = factory({ origin: f.origin, desktopToken: "test-desktop-token", httpRequest: request, toWeb: Readable.toWeb });
    assert.equal(await (await fetchOrigin(f.url)).text(), "original");
  } finally { await f.close(); }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProviderAssetToken, verifyProviderAssetToken } from "@super-canvas/providers/provider-asset-token";
import { startReferenceGateway, referenceConfiguration, referenceChannelErrorCode, ReferenceChannel } from "../src/reference-channel.mjs";

const token = Buffer.from(JSON.stringify({ a: "a".repeat(32), t: "5d1109de-fadc-4a98-9a1d-191e83236d21", s: "test-only-credential-12345" })).toString("base64");
test("reference settings accept the existing install command without exposing the credential", () => {
  const saved = referenceConfiguration({ enabled: true, baseUrl: "https://assets.example.com", tunnelToken: `cloudflared.exe service install ${token}` });
  assert.equal(saved.tunnelToken, token);
  assert.equal(referenceConfiguration({ enabled: false }, saved).tunnelToken, token);
  assert.equal(referenceConfiguration({ enabled: true, baseUrl: saved.baseUrl }, saved).tunnelToken, token);
  for (const baseUrl of ["http://assets.example.com", "https://user:pass@example.com", "https://127.0.0.1", "https://example.com/path", "https://example.com?x=1", "https://host.local"]) {
    assert.throws(() => referenceConfiguration({ enabled: true, baseUrl, tunnelToken: token }));
  }
});

test("gateway denies management paths, mutations and invalid links before accessing the backend", async () => {
  const calls = [];
  const gateway = await startReferenceGateway({ origin: "http://127.0.0.1:43210", desktopToken: "desktop-private", secret: "test-key", instance: "isolated", port: 0,
    fetchImpl: async (...args) => { calls.push(args); return new Response("asset"); } });
  const url = `http://127.0.0.1:${gateway.port}`;
  try {
    for (const path of ["/", "/api/providers", "/api/assets/a/content", "/api/provider-assets/a", "/api/provider-assets/a?token=invalid", "/api/provider-assets/a%2f..%2fproviders?token=invalid"]) {
      assert.ok([403, 404].includes((await fetch(url + path)).status));
    }
    assert.equal((await fetch(url + "/api/provider-assets/a", { method: "POST" })).status, 405);
    const wrong = createProviderAssetToken({ assetId: "other", secret: "test-key" });
    const expired = createProviderAssetToken({ assetId: "a", secret: "test-key", nowSeconds: 1 });
    for (const value of [wrong, expired]) assert.equal((await fetch(`${url}/api/provider-assets/a?token=${value}`)).status, 403);
    assert.equal(calls.length, 0);
  } finally { await gateway.close(); }
});

test("gateway streams only the signed asset, keeps headers private and denies extra query parameters", async () => {
  const calls = [];
  const gateway = await startReferenceGateway({ origin: "http://127.0.0.1:43210", desktopToken: "desktop-private", secret: "test-key", instance: "isolated", port: 0,
    fetchImpl: async (url, options) => { calls.push({ url: url.href, options }); return new Response("abc", { status: 206, headers: { "content-type": "image/png", "content-length": "3", "content-range": "bytes 0-2/30", "set-cookie": "private", "x-supercanvas-desktop-token": "private" } }); } });
  const url = `http://127.0.0.1:${gateway.port}/api/provider-assets/a?token=${createProviderAssetToken({ assetId: "a", secret: "test-key" })}`;
  try {
    const response = await fetch(url, { headers: { range: "bytes=0-2", cookie: "incoming", authorization: "incoming", "x-supercanvas-desktop-token": "attacker" } });
    assert.equal(response.status, 206); assert.equal(await response.text(), "abc");
    assert.equal(response.headers.get("set-cookie"), null); assert.equal(response.headers.get("x-supercanvas-desktop-token"), null);
    assert.equal(response.headers.get("cache-control"), "private, no-store, no-transform");
    assert.equal(calls[0].url, "http://127.0.0.1:43210/api/assets/a/content");
    assert.deepEqual(calls[0].options.headers, { "x-supercanvas-desktop-token": "desktop-private", "accept-encoding": "identity", connection: "close", range: "bytes=0-2" });
    assert.equal((await fetch(url + "&download=1")).status, 403);
    const head = await fetch(url, { method: "HEAD" }); assert.equal(await head.text(), "");
    assert.equal(calls.at(-1).options.method, "HEAD");
    const health = `http://127.0.0.1:${gateway.port}/api/provider-assets/_health?token=${createProviderAssetToken({ assetId: "_health", secret: "test-key" })}`;
    assert.equal(await (await fetch(health)).text(), "isolated");
  } finally { await gateway.close(); }
});

test("private public probes require both desktop authentication and an exact signed asset", async () => {
  const calls = [];
  const gateway = await startReferenceGateway({ origin: "http://127.0.0.1:43210", desktopToken: "desktop-private", secret: "test-key", instance: "isolated", port: 0,
    publicBaseUrl: "https://assets.example.com", publicFetchImpl: async (...args) => { calls.push(args); return new Response("asset"); } });
  const base = `http://127.0.0.1:${gateway.port}/api/reference-channel-probe/a`;
  const signature = createProviderAssetToken({ assetId: "a", secret: "test-key" });
  const headers = { "x-supercanvas-desktop-token": "desktop-private" };
  try {
    assert.equal(gateway.publicProbe, true);
    for (const supplied of [undefined, "wrong", "desktop-privatf"]) {
      assert.equal((await fetch(`${base}?token=${signature}`, { headers: supplied ? { "x-supercanvas-desktop-token": supplied } : {} })).status, 403);
    }
    for (const query of ["", "?token=invalid", `?token=${signature}&url=https://untrusted.example.com`, `?token=${signature}&token=${signature}`])
      assert.equal((await fetch(base + query, { headers })).status, 403);
    const wrongAsset = createProviderAssetToken({ assetId: "other", secret: "test-key" });
    assert.equal((await fetch(`${base}?token=${wrongAsset}`, { headers })).status, 403);
    assert.equal((await fetch(`${base}?token=${signature}`, { method: "POST", headers })).status, 405);
    assert.equal(calls.length, 0);
  } finally { await gateway.close(); }
});

test("private probes fetch the original public URL through the public transport without forwarding private headers", async () => {
  const publicCalls = [], localCalls = [];
  const gateway = await startReferenceGateway({ origin: "http://127.0.0.1:43210", desktopToken: "desktop-private", secret: "test-key", instance: "local-instance", port: 0,
    fetchImpl: async (...args) => { localCalls.push(args); return new Response("local"); },
    publicBaseUrl: "https://assets.example.com", publicFetchImpl: async (url, options) => {
      publicCalls.push({ url, options });
      return new Response(url.pathname.endsWith("/_health") ? "public-instance" : "abc", { headers: { "content-type": "image/png", "content-length": url.pathname.endsWith("/_health") ? "15" : "3", "set-cookie": "private" } });
    } });
  const base = `http://127.0.0.1:${gateway.port}`;
  try {
    for (const id of ["a", "_health"]) {
      const signature = createProviderAssetToken({ assetId: id, secret: "test-key" });
      const response = await fetch(`${base}/api/reference-channel-probe/${id}?token=${signature}`, { headers: {
        "x-supercanvas-desktop-token": "desktop-private", cookie: "incoming", authorization: "incoming", range: "bytes=0-2" } });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), id === "_health" ? "public-instance" : "abc");
      assert.equal(response.headers.get("set-cookie"), null);
      const call = publicCalls.at(-1);
      assert.equal(call.url.href, `https://assets.example.com/api/provider-assets/${id}?token=${signature}`);
      assert.deepEqual(call.options.headers, { "accept-encoding": "identity" });
      assert.equal(call.options.credentials, "omit");
      assert.equal(call.options.redirect, "error");
      assert.equal(call.options.cache, "no-store");
    }
    assert.equal(localCalls.length, 0);
    const localUrl = `${base}/api/provider-assets/a?token=${createProviderAssetToken({ assetId: "a", secret: "test-key" })}`;
    assert.equal(await (await fetch(localUrl)).text(), "local");
    assert.equal(localCalls.length, 1);
    assert.equal(publicCalls.length, 2);
  } finally { await gateway.close(); }
});

test("private probe preserves public failures and decoded bytes without a misleading compressed length", async () => {
  let mode = "http", cancelled = 0;
  const gateway = await startReferenceGateway({ origin: "http://127.0.0.1:43210", desktopToken: "desktop-private", secret: "test-key", instance: "isolated", port: 0,
    publicBaseUrl: "https://assets.example.com", publicFetchImpl: async () => {
      if (mode === "http") return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 530 });
      if (mode === "redirect") throw new TypeError("private URL redirect failed");
      return new Response("original", { headers: { "content-type": "image/png", "content-length": "99", "content-encoding": "gzip" } });
    } });
  const url = `http://127.0.0.1:${gateway.port}/api/reference-channel-probe/a?token=${createProviderAssetToken({ assetId: "a", secret: "test-key" })}`;
  const headers = { "x-supercanvas-desktop-token": "desktop-private" };
  try {
    assert.equal((await fetch(url, { headers })).status, 530);
    assert.equal(cancelled, 1);
    mode = "redirect";
    assert.equal((await fetch(url, { headers })).status, 502);
    mode = "encoded";
    const response = await fetch(url, { headers });
    assert.equal(response.headers.get("content-length"), null);
    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(await response.text(), "original");
  } finally { await gateway.close(); }
});

test("reference diagnostics retain only allowlisted machine error codes", () => {
  assert.equal(referenceChannelErrorCode(new Error("net::ERR_HTTP2_PROTOCOL_ERROR")), "ERR_HTTP2_PROTOCOL_ERROR");
  assert.equal(referenceChannelErrorCode(new TypeError("terminated", { cause: Object.assign(new Error("private"), { code: "UND_ERR_SOCKET" }) })), "UND_ERR_SOCKET");
  for (const error of [new Error("https://private.test/?token=ERR_HTTP2_PROTOCOL_ERROR"),
    new Error("private ERR_HTTP2_PROTOCOL_ERROR"), Object.assign(new Error("private"), { code: "ERR_PRIVATE_TOKEN" })])
    assert.equal(referenceChannelErrorCode(error), undefined);
});

test("local origin fetch requests identity and does not reuse the compressed length after decoding", async () => {
  const diagnostics = [], calls = [];
  const gateway = await startReferenceGateway({ origin: "http://127.0.0.1:43210", desktopToken: "desktop-private", secret: "test-key", instance: "isolated", port: 0,
    onDiagnostic: value => diagnostics.push(value), fetchImpl: async (_url, options) => {
      calls.push(options);
      return new Response("original", { headers: { "content-type": "image/png", "content-length": "99", "content-encoding": "gzip" } });
    } });
  const url = `http://127.0.0.1:${gateway.port}/api/provider-assets/a?token=${createProviderAssetToken({ assetId: "a", secret: "test-key" })}`;
  try {
    const response = await fetch(url);
    assert.equal(response.headers.get("content-length"), null);
    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(await response.text(), "original");
    assert.equal(calls[0].headers["accept-encoding"], "identity");
    assert.ok(diagnostics.some(value => value.outcome === "transferred" && value.source === "local_origin" && value.actualBytes === 8 && value.expectedBytes === undefined));
  } finally { await gateway.close(); }
});

test("default loopback transport uses one response connection and a slow consumer reaches EOF with every original byte", async () => {
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 123, 173);
  const requests = [], diagnostics = [];
  const backend = createServer((req, res) => {
    requests.push(req.headers);
    res.writeHead(200, { "content-type": "image/png", "content-length": bytes.length });
    res.end(bytes);
  });
  backend.keepAliveTimeout = 1;
  await new Promise(resolve => backend.listen(0, "127.0.0.1", resolve));
  let gateway;
  try {
    gateway = await startReferenceGateway({ origin: `http://127.0.0.1:${backend.address().port}`, desktopToken: "desktop-private",
      secret: "test-key", instance: "isolated", port: 0, onDiagnostic: value => diagnostics.push(value) });
    const url = `http://127.0.0.1:${gateway.port}/api/provider-assets/a?token=${createProviderAssetToken({ assetId: "a", secret: "test-key" })}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { cookie: "incoming", authorization: "incoming" } });
    const chunks = [], reader = response.body.getReader();
    let complete = false;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { complete = true; break; }
      chunks.push(Buffer.from(chunk.value));
      await new Promise(resolve => setTimeout(resolve, 3));
    }
    reader.releaseLock();
    assert.equal(complete, true);
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(Number(response.headers.get("content-length")), bytes.length);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].connection, "close");
    assert.equal(requests[0]["x-supercanvas-desktop-token"], "desktop-private");
    assert.equal(requests[0]["accept-encoding"], "identity");
    assert.equal(requests[0].cookie, undefined);
    assert.equal(requests[0].authorization, undefined);
    assert.ok(diagnostics.some(value => value.outcome === "transferred" && value.source === "local_origin" &&
      value.expectedBytes === bytes.length && value.actualBytes === bytes.length));
    assert.equal(diagnostics.some(value => value.outcome === "transfer_failed"), false);
  } finally {
    await gateway?.close();
    await new Promise(resolve => { backend.close(resolve); backend.closeAllConnections(); });
  }
});

test("default loopback transport rejects redirects and encoded wire bytes before exposing a body and can recover", async () => {
  let mode = "redirect", calls = 0;
  const diagnostics = [];
  const backend = createServer((_req, res) => {
    calls++;
    if (mode === "redirect") res.writeHead(302, { location: "/api/management" });
    else if (mode === "encoded") res.writeHead(200, { "content-encoding": "gzip", "content-type": "image/png" });
    else res.writeHead(200, { "content-type": "image/png", "content-length": "8" });
    res.end("original");
  });
  await new Promise(resolve => backend.listen(0, "127.0.0.1", resolve));
  const gateway = await startReferenceGateway({ origin: `http://127.0.0.1:${backend.address().port}`, desktopToken: "desktop-private",
    secret: "test-key", instance: "isolated", port: 0, onDiagnostic: value => diagnostics.push(value) });
  const url = `http://127.0.0.1:${gateway.port}/api/provider-assets/a?token=${createProviderAssetToken({ assetId: "a", secret: "test-key" })}`;
  try {
    for (const [value, code] of [["redirect", "ERR_LOOPBACK_REDIRECT"], ["encoded", "ERR_LOOPBACK_ENCODING"]]) {
      mode = value;
      const response = await fetch(url);
      assert.equal(response.status, 502);
      assert.equal(await response.text(), "");
      assert.ok(diagnostics.some(item => item.source === "local_origin" && item.outcome === "transfer_failed" && item.errorCode === code));
    }
    mode = "complete";
    const response = await fetch(url);
    assert.equal(await response.text(), "original");
    assert.equal(calls, 3, "a rejected redirect must never reach a second backend path");
    assert.ok(diagnostics.some(item => item.outcome === "transferred" && item.expectedBytes === 8 && item.actualBytes === 8));
  } finally {
    await gateway.close();
    await new Promise(resolve => { backend.close(resolve); backend.closeAllConnections(); });
  }
});

test("private relay rejects silent short and oversized bodies and records exact original byte completion", async () => {
  const diagnostics = [];
  let mode = "short";
  const gateway = await startReferenceGateway({ origin: "http://127.0.0.1:43210", desktopToken: "desktop-private", secret: "test-key", instance: "isolated", port: 0,
    onDiagnostic: value => diagnostics.push(value), publicBaseUrl: "https://assets.example.com", publicFetchImpl: async () => {
      if (mode === "network") throw new Error("net::ERR_HTTP2_PROTOCOL_ERROR");
      return new Response(mode === "short" ? "abc" : mode === "long" ? "abcd" : "original-bytes", {
        headers: { "content-type": "image/png", "content-length": mode === "short" ? "6" : mode === "long" ? "3" : "14" },
      });
    } });
  const url = `http://127.0.0.1:${gateway.port}/api/reference-channel-probe/a?token=${createProviderAssetToken({ assetId: "a", secret: "test-key" })}`;
  const headers = { "x-supercanvas-desktop-token": "desktop-private" };
  try {
    for (const current of ["short", "long"]) {
      mode = current;
      await assert.rejects(async () => { const response = await fetch(url, { headers }); await response.arrayBuffer(); });
      const diagnostic = diagnostics.at(-1);
      assert.equal(diagnostic.outcome, "transfer_failed");
      assert.equal(diagnostic.source, "public_probe");
      assert.equal(diagnostic.requestComplete, true);
      assert.equal(diagnostic.errorCode, "ERR_REFERENCE_LENGTH_MISMATCH");
      assert.equal(diagnostic.expectedBytes, current === "short" ? 6 : 3);
      assert.equal(diagnostic.actualBytes, current === "short" ? 3 : 4);
    }
    mode = "network";
    assert.equal((await fetch(url, { headers })).status, 502);
    assert.equal(diagnostics.at(-1).errorCode, "ERR_HTTP2_PROTOCOL_ERROR");
    mode = "complete";
    assert.equal(await (await fetch(url, { headers })).text(), "original-bytes");
    assert.deepEqual(diagnostics.at(-1), { stage: "asset", outcome: "transferred", source: "public_probe", status: 200,
      expectedBytes: 14, actualBytes: 14, requestComplete: true, durationMs: diagnostics.at(-1).durationMs });
    const recorded = JSON.stringify(diagnostics);
    for (const privateValue of ["assets.example.com", "desktop-private", "test-key", new URL(url).searchParams.get("token")])
      assert.equal(recorded.includes(privateValue), false);
  } finally { await gateway.close(); }
});

test("gateway preserves suffix ranges and unsatisfied-range metadata for media seeking", async () => {
  const calls = [];
  const gateway = await startReferenceGateway({ origin: "http://127.0.0.1:43210", desktopToken: "desktop-private", secret: "test-key", instance: "isolated", port: 0,
    fetchImpl: async (_url, options) => {
      calls.push(options);
      if (options.headers.range === "bytes=-3") return new Response("end", { status: 206, headers: { "content-range": "bytes 7-9/10", "content-length": "3" } });
      return new Response(null, { status: 416, headers: { "content-range": "bytes */10", "set-cookie": "private" } });
    } });
  const url = `http://127.0.0.1:${gateway.port}/api/provider-assets/a?token=${createProviderAssetToken({ assetId: "a", secret: "test-key" })}`;
  try {
    const suffix = await fetch(url, { headers: { range: "bytes=-3" } });
    assert.equal(suffix.status, 206);
    assert.equal(await suffix.text(), "end");
    assert.equal(suffix.headers.get("content-range"), "bytes 7-9/10");
    assert.equal(calls[0].headers.range, "bytes=-3");
    const unsatisfied = await fetch(url, { headers: { range: "bytes=10-" } });
    assert.equal(unsatisfied.status, 416);
    assert.equal(unsatisfied.headers.get("content-range"), "bytes */10");
    assert.equal(unsatisfied.headers.get("accept-ranges"), "bytes");
    assert.equal(unsatisfied.headers.get("set-cookie"), null);
  } finally { await gateway.close(); }
});

test("disabled channel retains encrypted credentials across restarts but publishes no secrets or ready state", async () => {
  const root = await mkdtemp(join(tmpdir(), "supercanvas-reference-test-"));
  const protect = async value => Buffer.from(value.split("").reverse().join(""));
  const unprotect = async value => value.toString().split("").reverse().join("");
  try {
    await mkdir(join(root, "profile"));
    const channel = new ReferenceChannel({ root, protect, unprotect });
    await channel.load();
    await channel.configure({ enabled: true, baseUrl: "https://assets.example.com", tunnelToken: token });
    await channel.configure({ enabled: false });
    const loaded = new ReferenceChannel({ root, protect, unprotect }); await loaded.load();
    assert.equal(loaded.snapshot().tokenConfigured, true); assert.equal(loaded.snapshot().enabled, false);
    assert.equal(JSON.stringify(loaded.snapshot()).includes(token), false);
    const status = await readFile(channel.statusPath, "utf8");
    assert.equal(status.includes(token), false); assert.equal(JSON.parse(status).ready, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function healthFixture(fetchImpl, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "supercanvas-reference-health-"));
  await mkdir(join(root, "profile"));
  const channel = new ReferenceChannel({ root, fetchImpl, ...options });
  channel.config = { enabled: true, baseUrl: "https://assets.example.com" };
  channel.runtime = { secret: "isolated-health-secret" };
  channel.gateway = { close: async () => {} };
  return { channel, async close() { await channel.stop(); await rm(root, { recursive: true, force: true }); } };
}

test("failed reference health checks release unread response bodies", async () => {
  let cancelled = false;
  const fixture = await healthFixture(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 }));
  try {
    await fixture.channel.check();
    assert.equal(fixture.channel.phase, "connecting");
    assert.equal(cancelled, true, "an upstream error body must release its connection");
  } finally { await fixture.close(); }
});

test("reference health checks stop reading an oversized success response", async () => {
  let cancelled = false;
  const fixture = await healthFixture(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(4096)); controller.enqueue(new Uint8Array(1)); controller.close(); },
    cancel() { cancelled = true; },
  })));
  try {
    await fixture.channel.check();
    assert.equal(fixture.channel.phase, "connecting");
    assert.equal(cancelled, true, "a health reply is bounded instead of buffering an arbitrary upstream page");
  } finally { await fixture.close(); }
});

test("stopping the reference channel aborts its pending health check", async () => {
  let pendingSignal;
  let complete;
  const fixture = await healthFixture((_url, options) => new Promise((resolve, reject) => {
    complete = resolve;
    pendingSignal = options.signal;
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  }));
  const check = fixture.channel.check();
  try {
    await fixture.channel.stop();
    assert.equal(pendingSignal.aborted, true);
    assert.equal(fixture.channel.phase, "disabled");
  } finally { complete(new Response("late")); await check; await fixture.close(); }
});

test("a complete reference health reply still marks only the current instance ready", async () => {
  const fixture = await healthFixture(async () => new Response(fixture.channel.instance));
  try {
    await fixture.channel.check();
    assert.equal(fixture.channel.phase, "ready");
    fixture.channel.fetchImpl = async () => new Response("another-instance");
    await fixture.channel.check();
    assert.equal(fixture.channel.phase, "connecting");
  } finally { await fixture.close(); }
});

test("a slow response cancellation cannot keep the health checker busy", async () => {
  let finishCancellation;
  const cancellation = new Promise(resolve => { finishCancellation = resolve; });
  const fixture = await healthFixture(async () => new Response(new ReadableStream({ cancel() { return cancellation; } }), { status: 503 }));
  const check = fixture.channel.check();
  let deadline;
  try {
    const completed = await Promise.race([check.then(() => true), new Promise(resolve => { deadline = setTimeout(() => resolve(false), 100); })]);
    assert.equal(completed, true, "response cleanup must not block the next health check");
  } finally { clearTimeout(deadline); finishCancellation(); await check; await fixture.close(); }
});

test("a transient timeout is retried once without publishing a false disconnect", async () => {
  let calls = 0;
  const states = [], diagnostics = [];
  const fixture = await healthFixture(async () => {
    if (++calls === 1) throw new DOMException("private-signed-url?token=do-not-record", "TimeoutError");
    return new Response(fixture.channel.instance);
  }, { onState: value => states.push(value), onDiagnostic: value => diagnostics.push(value) });
  try {
    await fixture.channel.publish("ready", "previous successful check");
    states.length = 0;
    await fixture.channel.check();
    assert.equal(calls, 2);
    assert.deepEqual(states.map(value => value.phase), ["ready"]);
    assert.equal(fixture.channel.snapshot().diagnostics.attempts, 2);
    assert.equal(fixture.channel.snapshot().diagnostics.recoveredFrom, "timeout");
    assert.equal(diagnostics.length, 1);
    assert.equal(JSON.stringify(diagnostics).includes("do-not-record"), false);
  } finally { await fixture.close(); }
});

test("persistent network failure clears old ready state after a bounded round and can recover", async () => {
  const diagnostics = [];
  const fixture = await healthFixture(async () => new Response(fixture.channel.instance), { onDiagnostic: value => diagnostics.push(value) });
  try {
    await fixture.channel.check();
    const lastSuccessAt = fixture.channel.snapshot().diagnostics.lastSuccessAt;
    let calls = 0;
    fixture.channel.fetchImpl = async () => {
      calls++;
      throw new TypeError("https://private.test/?token=private-token", { cause: Object.assign(new Error("private-secret"), { code: "EAI_AGAIN" }) });
    };
    await fixture.channel.check();
    assert.equal(calls, 2);
    assert.equal(fixture.channel.phase, "connecting");
    const status = JSON.parse(await readFile(fixture.channel.statusPath, "utf8"));
    assert.equal(status.ready, false);
    assert.equal(status.diagnostics.kind, "dns");
    assert.equal(status.diagnostics.lastSuccessAt, lastSuccessAt);
    assert.equal(status.diagnostics.attempts, 2);
    const recorded = JSON.stringify({ status, diagnostics, snapshot: fixture.channel.snapshot() });
    for (const privateValue of ["private-token", "private-secret", "private.test", "isolated-health-secret"])
      assert.equal(recorded.includes(privateValue), false);
    fixture.channel.fetchImpl = async () => new Response(fixture.channel.instance);
    await fixture.channel.check();
    assert.equal(fixture.channel.phase, "ready");
    assert.equal(fixture.channel.snapshot().diagnostics.attempts, 1);
    assert.equal(fixture.channel.snapshot().diagnostics.kind, undefined);
  } finally { await fixture.close(); }
});

test("health retries transient HTTP failures but not denied signatures or a different instance", async () => {
  for (const status of [408, 429, 503, 403, 404, 200]) {
    let calls = 0;
    const fixture = await healthFixture(async () => { calls++; return new Response("not-this-instance", { status }); });
    try {
      await fixture.channel.check();
      assert.equal(calls, [408, 429, 503].includes(status) ? 2 : 1, `HTTP ${status}`);
      assert.equal(fixture.channel.phase, "connecting");
      assert.equal(fixture.channel.snapshot().diagnostics.kind, status === 200 ? "unexpected_response" : "http");
      assert.equal(fixture.channel.snapshot().diagnostics.status, status === 200 ? undefined : status);
    } finally { await fixture.close(); }
  }
});

test("stopping a failed health request prevents its retry and stale diagnostics", async () => {
  let calls = 0, rejectRequest;
  const diagnostics = [];
  const fixture = await healthFixture(() => {
    calls++;
    return new Promise((_resolve, reject) => { rejectRequest = reject; });
  }, { onDiagnostic: value => diagnostics.push(value) });
  const check = fixture.channel.check();
  try {
    await fixture.channel.stop();
    rejectRequest(new DOMException("late failure", "TimeoutError"));
    await check;
    assert.equal(calls, 1);
    assert.equal(fixture.channel.phase, "disabled");
    assert.deepEqual(diagnostics, []);
  } finally { await fixture.close(); }
});

test("gateway rejects a broken media stream and remains available for the next original download", async () => {
  let calls = 0;
  const diagnostics = [];
  const gateway = await startReferenceGateway({ origin: "http://127.0.0.1:43210", desktopToken: "desktop-private", secret: "test-key", instance: "isolated", port: 0,
    onDiagnostic: value => diagnostics.push(value),
    fetchImpl: async () => {
      calls++;
      if (calls > 1) return new Response("original-bytes", { headers: { "content-type": "image/png", "content-length": "14" } });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          setTimeout(() => controller.error(new Error("https://private.test/?token=private-secret")), 20);
        },
      }), { headers: { "content-type": "image/png", "content-length": "6" } });
    } });
  const url = `http://127.0.0.1:${gateway.port}/api/provider-assets/a?token=${createProviderAssetToken({ assetId: "a", secret: "test-key" })}`;
  try {
    await assert.rejects(async () => { const response = await fetch(url); await response.arrayBuffer(); });
    assert.equal(calls, 1, "the gateway must not replay a failed upstream transfer");
    const response = await fetch(url);
    assert.equal(await response.text(), "original-bytes");
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(diagnostics.some(value => value.stage === "asset" && value.outcome === "transfer_failed"), true);
    assert.equal(JSON.stringify(diagnostics).includes("private-secret"), false);
    assert.equal(JSON.stringify(diagnostics).includes("private.test"), false);
  } finally { await gateway.close(); }
});

test("an unread backend error body cannot delay the gateway error response", async () => {
  let finishCancellation;
  const cancellation = new Promise(resolve => { finishCancellation = resolve; });
  const gateway = await startReferenceGateway({ origin: "http://127.0.0.1:43210", desktopToken: "desktop-private", secret: "test-key", instance: "isolated", port: 0,
    fetchImpl: async () => new Response(new ReadableStream({ cancel() { return cancellation; } }), { status: 503 }) });
  const url = `http://127.0.0.1:${gateway.port}/api/provider-assets/a?token=${createProviderAssetToken({ assetId: "a", secret: "test-key" })}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    assert.equal(response.status, 502);
  } finally { finishCancellation(); await gateway.close(); }
});

test("starting the existing tunnel preserves its transport with credentials only in its environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "supercanvas-reference-start-"));
  const programFiles = join(root, "program-files");
  const executable = join(programFiles, "cloudflared", "cloudflared.exe");
  await mkdir(join(root, "profile"));
  await mkdir(join(programFiles, "cloudflared"), { recursive: true });
  await writeFile(executable, "test fixture, never executed");
  const previousProgramFiles = process.env["ProgramFiles(x86)"];
  process.env["ProgramFiles(x86)"] = programFiles;
  const calls = [], gatewayCalls = [];
  let resolveReady, closed = 0;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const runtime = { origin: "http://127.0.0.1:43210", desktopToken: "test-desktop-token", secret: "test-health-secret" };
  const channel = new ReferenceChannel({ root,
    onState(value) { if (value.phase === "ready") resolveReady(); },
    gatewayImpl: async options => { gatewayCalls.push(options); return { publicProbe: true, close: async () => { closed++; } }; },
    spawnImpl: (file, args, options) => {
      calls.push({ file, args, options });
      const child = new EventEmitter();
      child.stderr = new EventEmitter(); child.exitCode = null;
      child.kill = () => { child.exitCode = 0; child.emit("exit", 0); return true; };
      return child;
    },
    fetchImpl: async value => {
      assert.equal(value.origin, "https://assets.example.com");
      assert.equal(value.pathname, "/api/provider-assets/_health");
      assert.equal(verifyProviderAssetToken({ assetId: "_health", secret: runtime.secret, token: value.searchParams.get("token") }), true);
      return new Response(channel.instance);
    },
  });
  channel.config = referenceConfiguration({ enabled: true, baseUrl: "https://assets.example.com", tunnelToken: token });
  let deadline;
  try {
    await channel.start(runtime);
    await Promise.race([ready, new Promise((_resolve, reject) => { deadline = setTimeout(() => reject(new Error("health check did not become ready")), 1000); })]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, executable);
    assert.deepEqual(calls[0].args, ["tunnel", "--no-autoupdate", "run"]);
    assert.equal(calls[0].options.env.TUNNEL_TOKEN, token);
    assert.equal(calls[0].args.some(value => value.includes(token)), false);
    assert.equal(calls[0].options.windowsHide, true);
    assert.equal(gatewayCalls.length, 1);
    for (const key of ["origin", "desktopToken", "secret"]) assert.equal(gatewayCalls[0][key], runtime[key]);
    assert.equal(gatewayCalls[0].instance, channel.instance);
    assert.equal(gatewayCalls[0].publicBaseUrl, channel.config.baseUrl);
    assert.equal(gatewayCalls[0].publicFetchImpl, channel.fetchImpl);
    assert.equal(channel.snapshot().phase, "ready");
    assert.equal(JSON.parse(await readFile(channel.statusPath, "utf8")).desktopPublicProbe, true);
    assert.equal(JSON.stringify(channel.snapshot()).includes(token), false);
    await channel.stop();
    assert.equal(closed, 1);
    assert.equal(channel.phase, "disabled");
    assert.equal(JSON.parse(await readFile(channel.statusPath, "utf8")).desktopPublicProbe, undefined);
  } finally {
    clearTimeout(deadline);
    await channel.stop();
    if (previousProgramFiles === undefined) delete process.env["ProgramFiles(x86)"];
    else process.env["ProgramFiles(x86)"] = previousProgramFiles;
    await rm(root, { recursive: true, force: true });
  }
});

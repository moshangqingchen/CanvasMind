import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProviderAssetToken } from "@super-canvas/providers/provider-asset-token";
import { startReferenceGateway, referenceConfiguration, ReferenceChannel } from "../src/reference-channel.mjs";

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
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(calls[0].url, "http://127.0.0.1:43210/api/assets/a/content");
    assert.deepEqual(calls[0].options.headers, { "x-supercanvas-desktop-token": "desktop-private", range: "bytes=0-2" });
    assert.equal((await fetch(url + "&download=1")).status, 403);
    const head = await fetch(url, { method: "HEAD" }); assert.equal(await head.text(), "");
    assert.equal(calls.at(-1).options.method, "HEAD");
    const health = `http://127.0.0.1:${gateway.port}/api/provider-assets/_health?token=${createProviderAssetToken({ assetId: "_health", secret: "test-key" })}`;
    assert.equal(await (await fetch(health)).text(), "isolated");
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

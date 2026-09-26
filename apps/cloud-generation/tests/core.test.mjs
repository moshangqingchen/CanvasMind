import assert from "node:assert/strict";
import { test } from "node:test";
import { handleRequest, executeGeneration, purgeJob, storeStream } from "../src/core.mjs";

class Bucket {
  values = new Map();
  async put(key, input, options = {}) {
    assert.equal(input instanceof ReadableStream, false, "R2 writes need known-length bodies");
    const bytes = new Uint8Array(await new Response(input).arrayBuffer());
    this.values.set(key, { bytes, ...options });
  }
  async createMultipartUpload(key, options) {
    const parts = []; const bucket = this;
    return { async uploadPart(partNumber, bytes) { parts.push(new Uint8Array(bytes)); return { partNumber, etag: String(partNumber) }; },
      async complete() { await bucket.put(key, Buffer.concat(parts), options); }, async abort() { parts.length = 0; } };
  }
  async get(key) {
    const value = this.values.get(key); if (!value) return null;
    return { ...value, size: value.bytes.byteLength, body: new Response(value.bytes).body,
      json: () => new Response(value.bytes).json(), text: () => new Response(value.bytes).text() };
  }
  async head(key) { return this.get(key); }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.values.delete(key); }
  async list({ prefix }) { return { objects: [...this.values.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false }; }
}
const id = "a".repeat(64);
const origin = "https://cloud.example.com";
const token = "test-cloud-token-".repeat(3);
function fixture(fetchImpl = async () => Response.json({ data: [{ b64_json: "b2ZmbGluZS1pbWFnZQ==" }] })) {
  let time = 1000; const instances = new Map(); let calls = 0;
  const env = { RESULTS: new Bucket(), RELAY_TOKEN: token, ENCRYPTION_KEY: "test-encryption-key", ALLOWED_HOSTS: "provider.example.com", clock: () => time, delay: async () => {},
    fetchImpl: async (...args) => { calls++; return fetchImpl(...args); },
    GENERATION: { async get(id) { return { async status() { if (!instances.has(id)) throw new Error("404 not found"); return { status: "running" }; } }; },
      async create(value) { if (instances.has(value.id)) throw new Error("already exists"); instances.set(value.id, value.params); } },
  };
  const req = (path = `/v1/jobs/${id}`, init = {}) => handleRequest(new Request(origin + path, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } }), env);
  async function submit(overrides = {}) {
    const manifest = { url: "https://provider.example.com/v1/images/generations", method: "POST", headers: { authorization: "Bearer private-supplier-key", "content-type": "application/json" }, ...overrides };
    const body = JSON.stringify({ model: "gpt-image-2.5-sunburst", prompt: "Offline test", quality: "max", size: "2880x2880" });
    return req(undefined, { method: "PUT", headers: { "x-supercanvas-manifest": Buffer.from(JSON.stringify(manifest)).toString("base64"), "content-length": String(Buffer.byteLength(body)) }, body });
  }
  async function start() {
    let wake; let expiry;
    const step = { do: (_name, _options, fn) => fn(), sleepUntil: (_name, date) => { expiry = +date; return new Promise(resolve => { wake = resolve; }); } };
    const done = executeGeneration(env, instances.get(id), step);
    for (let i = 0; !wake && i < 1000; i++) await new Promise(resolve => setImmediate(resolve));
    assert.ok(wake, "workflow reached its retention wait");
    return { done, expiry, expire: async () => { time = expiry; wake(); await done; } };
  }
  return { env, req, submit, start, calls: () => calls, instances, setTime: value => { time = value; } };
}

test("health is authenticated and clearly distinguishes missing R2", async () => {
  const f = fixture(); delete f.env.RESULTS;
  assert.equal((await handleRequest(new Request(origin + "/v1/health"), f.env)).status, 401);
  assert.deepEqual(await (await f.req("/v1/health")).json(), { service: "super-canvas-generation-v1", ready: false, storage: false, retentionHours: 24 });
});

test("large unknown-length responses use bounded multipart writes and reject overflow", async () => {
  const bucket = new Bucket(); const bytes = new Uint8Array(8 * 1024 * 1024 + 17).fill(37);
  await storeStream(bucket, "large", new Response(bytes).body, bytes.length);
  assert.deepEqual(bucket.values.get("large").bytes, bytes);
  await assert.rejects(storeStream(bucket, "overflow", new Response(bytes).body, 7 * 1024 * 1024));
  assert.equal(await bucket.get("overflow"), null);
});

test("cloud reference links survive the desktop closing and expire after one day", async () => {
  const f = fixture();
  const uploaded = await f.req(`/v1/references/${id}`, { method: "PUT", headers: { "content-type": "image/png", "content-length": "11" }, body: "image-bytes" });
  assert.equal(uploaded.status, 200);
  const { url } = await uploaded.json();
  assert.equal(await (await handleRequest(new Request(url), f.env)).text(), "image-bytes");
  assert.equal((await handleRequest(new Request(url.replace(/signature=.+/, "signature=bad")), f.env)).status, 401);
  f.setTime(1000 + 86400000);
  assert.equal((await handleRequest(new Request(url), f.env)).status, 410);
  assert.equal(f.calls(), 0);
});

test("a failed image copy is never reported as a safely archived cloud image", async () => {
  const f = fixture(async url => url.includes("generations") ? Response.json({ data: [{ url: "https://cdn.example.com/image.png" }] }) : new Response(null, { status: 503 }));
  await f.submit(); const run = await f.start();
  assert.equal((await (await f.req()).json()).state, "uncertain");
  assert.ok(await f.env.RESULTS.get(`jobs/${id}/response`));
  assert.equal((await f.req(`/v1/jobs/${id}/response`)).status, 409);
  await run.expire();
});
test("uploads exact parameters, encrypts supplier credentials and returns an immediate task id", async () => {
  let body; let headers;
  const f = fixture(async (_url, init) => { body = await new Response(init.body).json(); headers = new Headers(init.headers); return Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }); });
  assert.equal((await f.submit()).status, 202);
  assert.equal(f.calls(), 0);
  const manifest = [...f.env.RESULTS.values.entries()].find(([key]) => key.endsWith("manifest"))[1];
  assert.equal(new TextDecoder().decode(manifest.bytes).includes("private-supplier-key"), false);
  const run = await f.start();
  assert.equal(headers.get("authorization"), "Bearer private-supplier-key");
  assert.equal(headers.get("accept-encoding"), "identity");
  assert.deepEqual(body, { model: "gpt-image-2.5-sunburst", prompt: "Offline test", quality: "max", size: "2880x2880" });
  assert.equal([...f.env.RESULTS.values.keys()].some(key => key.startsWith("inputs/")), false);
  await run.expire();
});
test("duplicate submission and repeated download never call the supplier again", async () => {
  const f = fixture(); await f.submit(); const run = await f.start();
  await f.submit(); await f.submit();
  const one = await (await f.req(`/v1/jobs/${id}/response`)).text();
  const two = await (await f.req(`/v1/jobs/${id}/response`)).text();
  assert.equal(one, two); assert.equal(f.calls(), 1); assert.equal(f.instances.size, 1);
  await run.expire();
});
test("cloud outputs expire and are deleted after 24 hours, local copies remain", async () => {
  const f = fixture(); await f.submit(); const run = await f.start();
  const status = await (await f.req()).json();
  assert.equal(status.expiresAt - status.completedAt, 86_400_000);
  const localCopy = await (await f.req(`/v1/jobs/${id}/response`)).text();
  f.setTime(run.expiry);
  assert.equal((await f.req(`/v1/jobs/${id}/response`)).status, 410);
  await run.expire();
  assert.equal(f.env.RESULTS.values.has(`jobs/${id}/response`), false);
  assert.ok(localCopy.includes("b2ZmbGluZS1pbWFnZQ=="));
  assert.deepEqual([...f.env.RESULTS.values.keys()], [`jobs/${id}/state.json`]);
});
test("lost supplier response is uncertain and infrastructure replay cannot charge again", async () => {
  const f = fixture(async () => { throw new Error("socket closed"); });
  await f.submit(); const run = await f.start();
  assert.equal((await (await f.req()).json()).state, "uncertain");
  const replay = await f.start();
  await f.submit(); assert.equal(f.calls(), 1);
  await replay.expire(); await run.expire();
});
test("provider HTTP errors are saved verbatim for the desktop to classify, without retry", async () => {
  const f = fixture(async () => Response.json({ error: { code: "insufficient_quota" } }, { status: 429 }));
  await f.submit(); const run = await f.start();
  const response = await f.req(`/v1/jobs/${id}/response`);
  assert.equal(response.status, 429); assert.equal(response.headers.get("x-supercanvas-response"), "1");
  assert.deepEqual(await response.json(), { error: { code: "insufficient_quota" } }); assert.equal(f.calls(), 1);
  await run.expire();
});

test("long-submit transport receives exact bytes once; diagnostics omit secrets and downloads use fetch", async () => {
  const f = fixture(async url => {
    assert.equal(url, "https://cdn.example.com/picture.png");
    return new Response("image-bytes", { headers: { "content-type": "image/png" } });
  });
  let submits = 0;
  f.env.submitTransportName = () => "direct-tls";
  f.env.submitFetchImpl = async (url, init, limits) => {
    submits++;
    assert.equal(url, "https://provider.example.com/v1/images/generations");
    assert.equal(init.method, "POST");
    const bytes = await new Response(init.body).arrayBuffer();
    assert.equal(limits.bodyLength, bytes.byteLength);
    assert.equal(JSON.parse(new TextDecoder().decode(bytes)).quality, "max");
    return Response.json({ data: [{ url: "https://cdn.example.com/picture.png" }] }, { headers: { "via": "2.0 Caddy", "x-request-id": "request-123", "set-cookie": "secret-cookie", "authorization": "secret-key" } });
  };
  await f.submit(); const run = await f.start();
  const state = await (await f.req()).json();
  assert.deepEqual(state.transport, { kind: "direct-tls", startedAt: 1000, receivedAt: 1000, status: 200, headers: { via: "2.0 Caddy", "x-request-id": "request-123" } });
  const result = await (await f.req(`/v1/jobs/${id}/response`)).json();
  assert.ok(result.data[0].url.startsWith(origin));
  await f.submit(); const replay = await f.start();
  assert.equal(submits, 1); assert.equal(f.calls(), 1);
  await replay.expire(); await run.expire();
});
test("linked images are copied, signed and expire with the original job", async () => {
  const f = fixture(async url => url.includes("/generations") ? Response.json({ data: [{ url: "https://cdn.example.com/picture.png" }] }) : new Response("image-bytes", { headers: { "content-type": "image/png" } }));
  await f.submit(); const run = await f.start();
  const result = await (await f.req(`/v1/jobs/${id}/response`)).json();
  assert.ok(result.data[0].url.startsWith(origin));
  const image = await handleRequest(new Request(result.data[0].url), f.env);
  assert.equal(await image.text(), "image-bytes");
  assert.equal((await handleRequest(new Request(result.data[0].url.replace(/signature=.+/, "signature=wrong")), f.env)).status, 401);
  await run.expire();
  assert.equal((await handleRequest(new Request(result.data[0].url), f.env)).status, 410);
});
test("unapproved origins, loopback, redirects and malformed methods never receive keys", async () => {
  for (const overrides of [{ url: "https://other.example.com/v1/images" }, { url: "http://127.0.0.1/a" }, { url: "https://provider.example.com.evil.example/a" }, { method: "DELETE" }]) {
    const f = fixture(); assert.equal((await f.submit(overrides)).status, 400); assert.equal(f.instances.size, 0); assert.equal(f.calls(), 0);
  }
});
test("a durable dispatched marker without a result never replays a paid request", async () => {
  const f = fixture(); await f.submit();
  await f.env.RESULTS.put(`jobs/${id}/state.json`, JSON.stringify({ state: "running", createdAt: 1000, expiresAt: 1000 + 86_400_000 }));
  const run = await f.start(); assert.equal(f.calls(), 0); assert.equal((await (await f.req()).json()).state, "uncertain"); await run.expire();
});

test("native asynchronous providers are polled in the cloud until the image arrives", async () => {
  let submits = 0; let polls = 0;
  const f = fixture(async (url, init) => {
    if (url.endsWith("/generations")) { submits++; return Response.json({ id: "provider-job", status: "queued" }); }
    assert.equal(url, "https://provider.example.com/tasks/provider-job");
    assert.equal(init.method, "GET"); polls++;
    return Response.json(polls < 2 ? { status: "running" } : { status: "completed", data: [{ b64_json: "aW1hZ2U=" }] });
  });
  await f.submit({ polling: { urlTemplate: "https://provider.example.com/tasks/__SUPER_CANVAS_CLOUD_TASK__", method: "GET", headers: { authorization: "Bearer private-supplier-key" },
    submitMapping: { taskIdPath: "$.id", statusPath: "$.status" }, pollMapping: { statusPath: "$.status" } } });
  const run = await f.start();
  const response = await f.req(`/v1/jobs/${id}/response`);
  assert.equal(response.headers.get("x-supercanvas-upstream-task"), "provider-job");
  assert.equal((await response.json()).status, "completed"); assert.equal(submits, 1); assert.equal(polls, 2);
  await run.expire();
});

test("a pending synchronous call is waiting for acknowledgement, not confirmed generation", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  let entered; const enteredFetch = new Promise(resolve => { entered = resolve; });
  const f = fixture(async () => { entered(); await gate; return Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }); });
  await f.submit(); const starting = f.start(); await enteredFetch;
  assert.equal((await (await f.req()).json()).phase, "waiting_provider");
  release(); const run = await starting; await run.expire();
});

test("native task acknowledgement becomes generating before the final image exists", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  let entered; const enteredPoll = new Promise(resolve => { entered = resolve; });
  const f = fixture(async url => {
    if (url.endsWith("/generations")) return Response.json({ id: "accepted-task", status: "queued" });
    entered(); await gate; return Response.json({ status: "completed", data: [{ b64_json: "aW1hZ2U=" }] });
  });
  await f.submit({ polling: { urlTemplate: "https://provider.example.com/tasks/__SUPER_CANVAS_CLOUD_TASK__", method: "GET", headers: {}, submitMapping: { taskIdPath: "$.id", statusPath: "$.status" }, pollMapping: { statusPath: "$.status" } } });
  const starting = f.start(); await enteredPoll;
  assert.equal((await (await f.req()).json()).phase, "generating");
  assert.equal((await f.req(`/v1/jobs/${id}/response`)).status, 409);
  release(); const run = await starting; await run.expire();
});
